import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {JSDOM} from 'jsdom';
import {projectTitleFieldClassName} from '../dist/info-menu.js';
import {followProjectTitleCommits, reflectProjectTitle, type ReflectProjectTitleOptions} from '../dist/project-title.js';

function dom(t: TestContext) {
    const window = new JSDOM(`<body><input class="${projectTitleFieldClassName}"><input id="other"></body>`).window;
    t.after(() => window.close());
    return window;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function watch(t: TestContext) {
    const window = dom(t);
    const field = window.document.querySelector<HTMLInputElement>(`.${projectTitleFieldClassName}`);
    const state = {title: 'Cat'};
    const commits: string[] = [];
    const stop = followProjectTitleCommits(window.document, {readTitle: () => state.title, onCommit: title => commits.push(title)});
    t.after(stop);
    const enter = (isComposing = false) => field.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', isComposing, bubbles: true}));
    return {window, field, state, commits, stop, enter};
}

test('a title committed with Enter is reported once, even when the field then loses focus', async t => {
    const {field, state, commits, enter} = watch(t);
    field.focus();
    state.title = 'Dog';
    enter();
    field.blur();
    await tick();
    assert.deepEqual(commits, ['Dog']);
    field.focus();
    state.title = 'Bird';
    enter();
    await tick();
    field.blur();
    await tick();
    assert.deepEqual(commits, ['Dog', 'Bird']);
});

test('a title committed by leaving the field is reported once', async t => {
    const {field, state, commits} = watch(t);
    field.focus();
    state.title = 'Dog';
    field.dispatchEvent(new field.ownerDocument.defaultView.Event('change', {bubbles: true}));
    field.blur();
    await tick();
    assert.deepEqual(commits, ['Dog']);
});

test('Enter during IME composition, other keys, other fields and unchanged titles are not reported', async t => {
    const {window, field, state, commits, enter, stop} = watch(t);
    field.focus();
    state.title = '猫';
    enter(true);
    field.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'a', bubbles: true}));
    await tick();
    assert.deepEqual(commits, []);
    field.blur();
    await tick();
    assert.deepEqual(commits, ['猫']);
    field.focus();
    field.blur();
    await tick();
    assert.deepEqual(commits, ['猫']);
    const other = window.document.querySelector<HTMLInputElement>('#other');
    other.focus();
    state.title = 'Set by loading';
    other.blur();
    await tick();
    assert.deepEqual(commits, ['猫']);
    stop();
    field.focus();
    state.title = 'After stop';
    field.blur();
    await tick();
    assert.deepEqual(commits, ['猫']);
});

function reflect(t: TestContext, options: Partial<ReflectProjectTitleOptions>) {
    const window = dom(t);
    const calls = {renamed: [] as string[], saveNames: [] as string[], notices: [] as string[], actions: [] as string[]};
    const done = reflectProjectTitle({
        document: window.document, locale: 'ja', title: 'cat', saveName: '', location: 'browser', gitBound: false,
        async renameBrowserFolder(title) {calls.renamed.push(title);},
        setSaveName: name => calls.saveNames.push(name),
        notify: (text, action) => {calls.notices.push(text); if (action) calls.actions.push(action.label);},
        ...options
    });
    return {window, calls, done};
}

test('a browser folder is renamed to the title without a notice', async t => {
    const {calls, done} = reflect(t, {});
    await done;
    assert.deepEqual(calls, {renamed: ['cat'], saveNames: [], notices: [], actions: []});
});

test('a renaming failure is ignored', async t => {
    const {calls, done} = reflect(t, {renameBrowserFolder: () => Promise.reject(new Error('no'))});
    await done;
    assert.deepEqual(calls.notices, []);
});

test('a device folder keeps its name and says so', async t => {
    const {calls, done} = reflect(t, {location: 'device', locale: 'en'});
    await done;
    assert.deepEqual(calls.renamed, []);
    assert.deepEqual(calls.notices, ['This project folder is on your device, so its name stays as it is ' +
        '(the browser version cannot rename folders on your device).']);
});

test('a Git repository keeps its name, and both notes are joined for a device folder', async t => {
    const {calls, done} = reflect(t, {location: 'device', gitBound: true});
    await done;
    assert.deepEqual(calls.notices, ['Git のリポジトリの名前は変わりません。 この作品のフォルダは手元のフォルダなので、' +
        'フォルダ名は変わりません（ブラウザー版では手元のフォルダ名を変えられません）。']);
    const browser = reflect(t, {gitBound: true, locale: 'en'});
    await browser.done;
    assert.deepEqual(browser.calls.renamed, ['cat']);
    assert.deepEqual(browser.calls.notices, ['The Git repository keeps its name.']);
});

test('an empty title or a project outside folders changes nothing', async t => {
    for (const options of [{title: '  '}, {location: 'none' as const, title: '猫'}]) {
        const {window, calls, done} = reflect(t, options);
        await done;
        assert.deepEqual(calls, {renamed: [], saveNames: [], notices: [], actions: []});
        assert.equal(window.document.querySelector('[data-save-name-dialog]'), null);
    }
});

test('a title that cannot be a save name asks for one when the project has none', async t => {
    const {window, calls, done} = reflect(t, {title: 'Cat Adventure!', locale: 'en'});
    await new Promise(resolve => setImmediate(resolve));
    const dialog = window.document.querySelector('[data-save-name-dialog]');
    const input = dialog.querySelector<HTMLInputElement>('input[name="save-name"]');
    assert.equal(input.value, 'cat-adventure');
    input.value = 'cat-story';
    input.dispatchEvent(new window.Event('input'));
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]').click();
    await done;
    assert.deepEqual(calls, {renamed: ['Cat Adventure!'], saveNames: ['cat-story'], notices: [], actions: []});
});

test('the save name question is skipped with a save name, and a cancel or a closed project sets none', async t => {
    const named = reflect(t, {title: '猫の冒険', saveName: 'neko'});
    await named.done;
    assert.equal(named.window.document.querySelector('[data-save-name-dialog]'), null);
    const cancelled = reflect(t, {title: '猫の冒険', location: 'device'});
    await new Promise(resolve => setImmediate(resolve));
    const dialog = cancelled.window.document.querySelector('[data-save-name-dialog]');
    dialog.dispatchEvent(new cancelled.window.Event('cancel', {cancelable: true}));
    await cancelled.done;
    assert.deepEqual(cancelled.calls.saveNames, []);
    assert.equal(cancelled.calls.notices.length, 1);
    let open = true;
    const closed = reflect(t, {title: '猫の冒険', current: () => open});
    await new Promise(resolve => setImmediate(resolve));
    const input = closed.window.document.querySelector<HTMLInputElement>('[data-save-name-dialog] input');
    input.value = 'neko';
    input.dispatchEvent(new closed.window.Event('input'));
    open = false;
    closed.window.document.querySelector<HTMLButtonElement>('[data-save-name-dialog] button[type="submit"]').click();
    await closed.done;
    assert.deepEqual(closed.calls.saveNames, []);
});

test('a Git repository is renamed to the title when it is a save name, and the outcome is noted', async t => {
    const names: string[] = [];
    const renamed = reflect(t, {gitBound: true, title: 'my-urashima', async renameRepository(name) {names.push(name); return 'renamed';}});
    await renamed.done;
    assert.deepEqual(names, ['my-urashima']);
    assert.deepEqual(renamed.calls.notices, ['GitHub のリポジトリ名を「my-urashima」に変えました。']);
    const unchanged = reflect(t, {gitBound: true, renameRepository: async () => 'unchanged'});
    await unchanged.done;
    assert.deepEqual(unchanged.calls.notices, []);
    for (const [outcome, text] of [
        ['name-unavailable', /既にあるので/u], ['permission-required', /Administration/u], ['forbidden', /管理者ではない/u],
        ['not-connected', /書き込みできる接続/u], ['unknown', /確かめられませんでした/u]
    ] as const) {
        const result = reflect(t, {gitBound: true, renameRepository: async () => outcome});
        await result.done;
        assert.match(result.calls.notices[0], text, outcome);
    }
    const failed = reflect(t, {gitBound: true, renameRepository: () => Promise.reject(new Error('no')), locale: 'en'});
    await failed.done;
    assert.deepEqual(failed.calls.notices, ['Could not rename the repository.']);
});

test('a title that cannot be a save name renames the repository to the save name', async t => {
    const names: string[] = [];
    const {calls, done} = reflect(t, {gitBound: true, location: 'none', title: '浦島太郎', saveName: 'urashima',
        async renameRepository(name) {names.push(name); return 'renamed';}});
    await done;
    assert.deepEqual(names, ['urashima']);
    assert.deepEqual(calls.saveNames, []);
});

test('Desktop renames the device folder after the repository and offers to open it again', async t => {
    const order: string[] = [];
    let reopened = 0;
    const {calls, done} = reflect(t, {location: 'device', gitBound: true, title: 'my-urashima', locale: 'en',
        async renameRepository(name) {order.push('repository ' + name); return 'renamed';},
        async renameDeviceFolder(name) {order.push('folder ' + name); return 'renamed';},
        reopenDeviceFolder: () => {reopened++;},
        notify: (text, action) => {calls.notices.push(text); action?.run();}});
    await done;
    assert.deepEqual(order, ['repository my-urashima', 'folder my-urashima']);
    assert.deepEqual(calls.notices, ['Renamed the GitHub repository to “my-urashima”. ' +
        'Renamed the project folder to “my-urashima”. Open the folder again to keep working.']);
    assert.equal(reopened, 1);
    for (const [outcome, text] of [['unsaved', /保存していない変更/u], ['exists', /「cat」があるので/u],
        ['mismatch', /違うので/u], ['canceled', /変えませんでした/u]] as const) {
        const result = reflect(t, {location: 'device', renameDeviceFolder: async () => outcome, reopenDeviceFolder: () => {}});
        await result.done;
        assert.match(result.calls.notices[0], text, outcome);
        assert.deepEqual(result.calls.actions, []);
    }
});
