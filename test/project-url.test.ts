import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {setImmediate} from 'node:timers/promises';
import {openProjectURL, projectFileURL, projectURLFilename} from '../dist/project-url.js';

function fixture(t, overrides: Record<string, unknown> = {}, locale = 'ja') {
    const dom = new JSDOM('<button id="trigger">Open</button>', {url: 'https://editor.test'});
    dom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
    dom.window.HTMLDialogElement.prototype.close = function () {this.open = false;};
    const document = dom.window.document;
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    trigger.focus();
    const calls: unknown[] = [];
    const ports = {vm: {quit() {calls.push('quit');}, async loadProject(bytes) {calls.push(new TextDecoder().decode(bytes));},
        renderer: {draw() {calls.push('draw');}}},
        storage: {finish(...args) {calls.push(args);}}, isDirty: () => false,
        detachFolder: () => calls.push('detach'),
        fetch: async () => new Response('project bytes'), ...overrides};
    const done = openProjectURL(document, locale, ports);
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    const form = dialog.querySelector<HTMLFormElement>('form')!;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    const error = dialog.querySelector<HTMLElement>('[role=alert]')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('button[type=button]')!;
    const submit = (value = 'https://samples.test/story.sb3') => {
        input.value = value;
        form.dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true}));
    };
    t.after(() => {cancel.click(); dom.window.close();});
    return {dom, document, trigger, calls, done, dialog, form, input, error, cancel, submit};
}

test('URL validation requires HTTP(S) without credentials and filenames ignore queries', () => {
    for (const input of ['', 'story.sb3', 'javascript:alert(1)', 'file:///story.sb3', 'data:application/zip,a',
        'https://user:password@example.com/story.sb3']) assert.throws(() => projectFileURL(input));
    assert.equal(projectFileURL(' https://samples.test/story.sb3?download=1 ').hostname, 'samples.test');
    assert.equal(projectURLFilename(new URL('https://samples.test/%E6%B5%A6%E5%B3%B6.SB3?download=1')), '浦島.SB3');
    assert.equal(projectURLFilename(new URL('https://samples.test/download?id=1')), 'download.sb3');
    assert.equal(projectURLFilename(new URL('https://samples.test/')), 'project.sb3');
});

test('invalid input stays focused and does not fetch or load', async t => {
    const f = fixture(t, {fetch: assert.fail});
    f.submit('javascript:alert(1)');
    assert.match(f.error.textContent!, /HTTP/);
    assert.equal(f.input.getAttribute('aria-invalid'), 'true');
    assert.equal(f.document.activeElement, f.input);
    assert.deepEqual(f.calls, []);
    f.cancel.click();
    assert.equal(await f.done, 'cancelled');
    assert.equal(f.document.activeElement, f.trigger);
});

test('downloads once, then commits the local save state only after a successful load', async t => {
    let finishDownload;
    let requested;
    const response = new Promise<Response>(resolve => {finishDownload = resolve;});
    const f = fixture(t, {fetch: async (...args) => {requested = args; return response;}, loadedTitle: () => '作品名'});
    f.submit(); f.submit();
    assert.equal(f.form.getAttribute('aria-busy'), 'true');
    assert.equal(f.input.disabled, true);
    assert.deepEqual(f.calls, []);
    finishDownload(new Response('project bytes'));
    assert.equal(await f.done, 'opened');
    assert.deepEqual(f.calls, ['quit', 'project bytes', 'detach', [null, '作品名', true], 'draw']);
    assert.equal(requested[0], 'https://samples.test/story.sb3');
    assert.equal(requested[1].credentials, 'omit');
    assert.equal(f.document.querySelector('dialog'), null);
});

test('Cancel aborts a pending download and a late response cannot replace the project', async t => {
    let finishDownload;
    let signal;
    const f = fixture(t, {fetch: async (_, options) => {
        signal = options.signal;
        return new Promise(resolve => {finishDownload = resolve;});
    }});
    f.submit(); f.cancel.click();
    assert.equal(await f.done, 'cancelled');
    assert.equal(signal.aborted, true);
    finishDownload(new Response('late bytes'));
    await setImmediate();
    assert.deepEqual(f.calls, []);
});

test('404 and network/CORS failures leave the original project untouched and allow retry', async t => {
    let attempts = 0;
    const f = fixture(t, {fetch: async () => {
        attempts++;
        if (attempts === 1) return new Response('', {status: 404});
        if (attempts === 2) throw new TypeError('Failed to fetch');
        return new Response('project bytes');
    }});
    f.submit(); await setImmediate();
    assert.match(f.error.textContent!, /404/);
    assert.equal(f.input.disabled, false);
    assert.deepEqual(f.calls, []);
    f.submit(); await setImmediate();
    assert.match(f.error.textContent!, /CORS/);
    assert.deepEqual(f.calls, []);
    f.submit(); assert.equal(await f.done, 'opened');
    assert.deepEqual(f.calls.at(-2), [null, 'story', true]);
});

test('checks dirty state after download and declining replacement preserves the project', async t => {
    let dirty = false;
    let finishDownload;
    const f = fixture(t, {isDirty: () => dirty, fetch: async () => new Promise(resolve => {finishDownload = resolve;})});
    let asked = false;
    f.dom.window.confirm = () => {asked = true; return false;};
    f.submit(); dirty = true;
    finishDownload(new Response('project bytes')); await setImmediate();
    assert.equal(asked, true);
    assert.deepEqual(f.calls, []);
    assert.equal(f.form.hasAttribute('aria-busy'), false);
});

test('a failed SB3 load keeps the save target and permits another attempt; loading cannot be dismissed', async t => {
    let rejectLoad;
    const f = fixture(t, {vm: {quit() {}, loadProject: () => new Promise((_, reject) => {rejectLoad = reject;})}});
    f.submit(); await setImmediate();
    assert.equal(f.cancel.disabled, true);
    assert.equal(f.dialog.open, false, 'release the native modal so extension approval is interactive');
    f.dialog.dispatchEvent(new f.dom.window.Event('cancel', {cancelable: true}));
    assert.equal(f.dialog.isConnected, true);
    rejectLoad(new Error('Invalid ZIP')); await setImmediate();
    assert.match(f.error.textContent!, /SB3/);
    assert.equal(f.cancel.disabled, false);
    assert.equal(f.dialog.open, true, 'reopen URL input after a failed load');
    assert.deepEqual(f.calls, []);
});
