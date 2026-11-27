import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLayoutPreference, readNewLayoutPreference, newLayoutStorageKey} from '../dist/layout-preference.js';

const memory = (initial?: string) => {
    const entries = new Map(initial === undefined ? [] : [[newLayoutStorageKey, initial]]);
    return {getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); }};
};

test('new layout is opt-in and only the saved value 1 enables it', () => {
    for (const value of [undefined, '', '0', 'true', '{}']) {
        assert.equal(readNewLayoutPreference('', () => memory(value)), false);
    }
    assert.equal(readNewLayoutPreference('', () => memory('1')), true);
});

test('explicit URL overrides do not write or erase the saved preference', () => {
    const storage = memory('1');
    for (const query of ['0', '', 'true']) {
        assert.equal(readNewLayoutPreference('?twPlusStandardLayout=' + query, () => storage), false);
    }
    assert.equal(storage.getItem(newLayoutStorageKey), '1');
    assert.equal(readNewLayoutPreference('?twPlusStandardLayout=1', () => memory('0')), true);
});

test('both selections persist and are restored by a new controller', () => {
    const storage = memory();
    const choice = createLayoutPreference({storage: () => storage});
    const updates: boolean[] = [];
    const stop = choice.subscribe(() => updates.push(choice.read()));
    for (const enabled of [true, false, true]) {
        choice.setEnabled(enabled);
        assert.equal(storage.getItem(newLayoutStorageKey), enabled ? '1' : '0');
        assert.equal(createLayoutPreference({storage: () => storage}).read(), enabled);
    }
    stop();
    choice.setEnabled(false);
    assert.deepEqual(updates, [true, false, true]);
});

test('storage getter failures and quota errors still permit switching in memory', () => {
    const denied = () => { throw new Error('SecurityError'); };
    const full = () => ({getItem: () => '1', setItem: () => { throw new Error('QuotaExceededError'); }});
    for (const storage of [denied, full]) {
        const choice = createLayoutPreference({storage});
        choice.setEnabled(true);
        assert.equal(choice.read(), true);
        choice.setEnabled(false);
        assert.equal(choice.read(), false);
    }
    assert.equal(readNewLayoutPreference('', denied), false);
});

test('a menu selection supersedes the URL override even when the selected value is unchanged', () => {
    const storage = memory('1');
    const urls: boolean[] = [];
    const choice = createLayoutPreference({search: '?twPlusStandardLayout=0', storage: () => storage,
        updateURL: enabled => urls.push(enabled)});
    assert.equal(choice.read(), false);
    choice.setEnabled(false);
    assert.equal(storage.getItem(newLayoutStorageKey), '0');
    choice.setEnabled(true);
    assert.deepEqual(urls, [false, true]);
});


test('layout changes retain dirty file tabs and refuse to discard failed detached edits', async () => {
    const {JSDOM} = await import('jsdom');
    const {getDocumentWorkspace} = await import('../dist/document-workspace.js');
    const {prepareLayoutChange} = await import('../dist/layout-preference.js');
    const {pendingSurfaceEdits} = await import('@kubohiroya/turbowarp-plus-editor-windows/surfaces');
    const dom = new JSDOM('<body></body>', {pretendToBeVisual: true});
    const vm = {};
    let dirty = true;
    const session = {dispose() {}, requestClose() {}, fileEdit: {directory: {} as FileSystemDirectoryHandle,
        path: 'unsaved.txt', isDirty: () => dirty, async save() {}}};
    const disconnect = getDocumentWorkspace(vm).connect(() => {}, () => session, () => [session]);
    try {
        assert.equal(await prepareLayoutChange(vm, false, 'ja', dom.window.document), false);
        assert.match(dom.window.document.body.textContent, /保存するか閉じて/);
        assert.equal(getDocumentWorkspace(vm).fileEdits().length, 1);
        dirty = false;
        assert.equal(await prepareLayoutChange(vm, false, 'ja', dom.window.document), true);
        const stop = pendingSurfaceEdits.register(() => Promise.reject(new Error('unreachable window')));
        try {
            assert.equal(await prepareLayoutChange(vm, false, 'en', dom.window.document), false);
            assert.match(dom.window.document.body.textContent, /layout has been kept/);
        } finally { stop(); }
    } finally { disconnect(); dom.window.close(); }
});
