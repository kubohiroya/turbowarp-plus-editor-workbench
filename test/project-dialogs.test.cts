// SPDX-License-Identifier: MPL-2.0
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {createProjectDialogService} = require('../dist/project-tools/dialog.js');
const {createProjectDialogs} = createProjectDialogService({styles: {dialog: 'dialog', preview: 'preview'},
    snackbarStyles: {snackbar: 'snackbar'}, isCancelled: error => error?.code === 'CANCELLED'});
const {createAuthorHistory} = require('../dist/project-tools/history.js');
const {createProjectDiagnostics} = require('../dist/project-tools/diagnostics.js');
const {showProjectLoadFailure, projectStartURL} = require('../dist/project-load-failure.js');

const fixture = (options?: {locale?: string; format?: {format: string; source: string; manifest: {status: string}}}) => {
    const dom = new JSDOM('<button id="origin">File</button>', {url: 'https://example.test/'});
    const document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    const changes = [];
    let listener;
    let phase = 'loaded';
    const properties = {snapshot: () => ({title: 'Title', description: '<img onerror=bad> https://example.test/',
        author: '', contact: 'mailto:a@example.test', createdAt: null, updatedAt: null}),
        subscribe(fn) { listener = fn; return () => { listener = null; }; }, loadState: () => ({phase}),
        projectFormatStatus: () => options?.format,
        apply(value, format) { changes.push(format ? {...value, sb3Format: format} : value); }};
    const history = createAuthorHistory(dom.window.localStorage);
    history.remember('Recent author', 'https://contact.test');
    document.querySelector('button').focus();
    const diagnostics = createProjectDiagnostics();
    const dialogs = createProjectDialogs(document, properties, history, diagnostics, options);
    return {dom, document, dialogs, history, changes, diagnostics, load() { phase = 'loading'; listener(); }};
};
test('properties has editable recent combobox values, plain-text link preview and cancel without storing', () => {
    const f = fixture(); f.dialogs.showProperties('en');
    const dialog = f.document.querySelector('dialog');
    assert.equal(dialog.querySelector('img'), null);
    assert.equal(dialog.querySelector('a[href="https://example.test/"]').rel, 'noopener noreferrer');
    assert.equal(dialog.querySelector('a[href="mailto:a@example.test"]').target, '');
    const author = dialog.querySelector('[name="author"]');
    assert.ok(author.hasAttribute('list'));
    assert.equal(f.document.getElementById(author.getAttribute('list')).children[0].value, 'Recent author');
    author.value = 'Cancelled';
    dialog.querySelector('button[data-dialog-action="cancel"]').click();
    assert.equal(f.document.querySelector('dialog'), null);
    assert.equal(f.document.activeElement.id, 'origin');
    assert.equal(f.history.snapshot().names.includes('Cancelled'), false);
    assert.deepEqual(f.changes, []);
    f.dialogs.dispose();
});
test('diagnostics shows empty state, literal errors and earlier attempts with a copy fallback', async () => {
    const f = fixture(); f.dialogs.showDiagnostics('en');
    assert.match(f.document.querySelector('dialog').textContent, /No diagnostic events/);
    f.diagnostics.begin('Failure');
    f.diagnostics.record({type: 'project-error', code: 'LOAD_FAILED', message: '<img onerror=bad>'});
    f.diagnostics.finish({phase: 'failed'}, 'Failure');
    assert.ok(f.document.querySelector('[data-testid="project-load-failure"]'));
    assert.equal(f.document.querySelector('aside'), null);
    f.diagnostics.begin('Current'); f.diagnostics.finish({phase: 'loaded'}, 'Current');
    // A notice for a failed attempt must open that attempt even after a different project loads.
    [...f.document.querySelectorAll('[data-testid="project-load-failure"] button')].find(button => button.textContent === 'View detailed log').click();
    assert.equal(f.document.querySelector('dialog select').value, '1');
    const select = f.document.querySelector('dialog select');
    select.value = '1'; select.dispatchEvent(new f.dom.window.Event('change'));
    assert.match(f.document.querySelector('[data-testid="project-diagnostics"]').textContent, /LOAD_FAILED/);
    assert.equal(f.document.querySelector('dialog img'), null);
    [...f.document.querySelectorAll('[data-testid="project-diagnostics"] button')].find(button => button.textContent === 'Copy diagnostics').click();
    await new Promise(resolve => setImmediate(resolve));
    const text = f.document.querySelector('dialog textarea');
    assert.equal(JSON.parse(text.value).title, 'Failure');
    f.dialogs.dispose();
    assert.equal(f.document.querySelector('aside'), null);
    assert.equal(f.document.querySelector('dialog'), null);
});
test('a failure snackbar uses the host locale, preserves focus and leaves the selected project unchanged', () => {
    const f = fixture({locale: 'ja'});
    f.document.documentElement.lang = 'en';
    f.diagnostics.begin('Current');
    f.diagnostics.record({type: 'verified', id: 'sample'});
    assert.equal(f.document.querySelector('aside'), null);
    f.diagnostics.record({type: 'error', code: 'DIGEST_MISMATCH', message: '<img onerror=bad>'});
    const notice = f.document.querySelector('[data-testid="project-diagnostics-snackbar"]');
    assert.match(notice.querySelector('[role="status"]').textContent, /拡張機能を読み込めませんでした/);
    assert.equal(notice.querySelector('img'), null);
    const show = [...notice.querySelectorAll('button')].find(button => button.textContent === '詳細ログを表示');
    show.focus(); show.click();
    assert.equal(f.document.querySelector('aside'), null);
    const dialog = f.document.querySelector('[data-testid="project-diagnostics"]');
    assert.match(dialog.textContent, /DIGEST_MISMATCH/);
    dialog.dispatchEvent(new f.dom.window.Event('cancel', {cancelable: true}));
    assert.equal(f.document.activeElement.id, 'origin');
    assert.deepEqual(f.changes, []);
    f.dialogs.dispose(); f.dom.window.close();
});
test('dismissing a snackbar does not clear diagnostics or announce the same failure again', () => {
    const f = fixture();
    f.diagnostics.record({type: 'error', code: 'LOAD_FAILED'});
    const dismiss = [...f.document.querySelectorAll('aside button')].find(button => button.textContent === 'Dismiss');
    dismiss.focus(); dismiss.click();
    assert.equal(f.document.activeElement.id, 'origin');
    f.diagnostics.record({type: 'verified', id: 'another'});
    assert.equal(f.document.querySelector('aside'), null);
    assert.equal(f.diagnostics.snapshot()[0].events[0].code, 'LOAD_FAILED');
    f.dialogs.dispose(); f.dom.window.close();
});
test('a cancelled project opens a main terminal screen with actions and no failure snackbar', () => {
    const f = fixture({locale: 'ja'});
    f.diagnostics.record({type: 'project-error', code: 'CANCELLED', message: 'Declined'});
    const main = f.document.querySelector('[data-testid="project-load-failure"]');
    assert.equal(main.getAttribute('role'), 'alertdialog');
    assert.equal(main.dataset.outcome, 'cancelled');
    assert.equal(main.querySelector('h1').textContent, '作品を開けませんでした');
    assert.match(main.textContent, /読み込みを中止しました/);
    let reviews = 0;
    showProjectLoadFailure(f.document, {cancelled: true, onReview: () => {reviews++;}});
    // Later error updates preserve the callback for the same incoming project.
    showProjectLoadFailure(f.document, {cancelled: true});
    [...main.querySelectorAll('button')].find(button => button.textContent === '確認画面に戻る').click();
    assert.equal(reviews, 1);
    assert.equal(f.document.querySelector('[data-testid="project-diagnostics-snackbar"]'), null);
    const escape = new f.dom.window.Event('cancel', {cancelable: true}); main.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.ok(main.isConnected);
    assert.deepEqual(f.changes, []);
    f.load(); assert.equal(main.isConnected, false);
    f.dialogs.dispose(); f.dom.window.close();
});
test('apply submits new values and remembers them; project loading discards a stale form', () => {
    const f = fixture(); f.dialogs.showProperties('ja');
    const dialog = f.document.querySelector('dialog');
    dialog.querySelector('[name="author"]').value = 'New author';
    dialog.querySelector('form').dispatchEvent(new f.dom.window.Event('submit', {cancelable: true}));
    assert.equal(f.changes[0].author, 'New author');
    assert.equal(f.history.snapshot().names[0], 'New author');
    assert.equal(f.document.querySelector('dialog'), null);
    f.dialogs.showProperties('en'); f.load();
    assert.equal(f.document.querySelector('dialog'), null);
    f.dialogs.dispose();
});

test('only an offered, editable format change is applied; invalid manifests cannot be changed here', () => {
    const f = fixture({format: {format: 'standard', source: 'legacy', manifest: {status: 'absent'}}});
    const form = () => f.document.querySelector('[data-testid="project-properties"] form');
    const submit = () => form().dispatchEvent(new f.dom.window.Event('submit', {cancelable: true}));
    f.dialogs.showProperties('en');
    assert.equal(form().querySelector('select'), null);
    f.dialogs.showProperties('en', undefined, {offerSb3Formats: true});
    assert.equal(form().querySelector('select').value, 'standard');
    submit();
    assert.equal(f.changes.at(-1).sb3Format, undefined);
    f.dialogs.showProperties('en', undefined, {offerSb3Formats: true});
    form().querySelector('select').value = 'plus';
    submit();
    assert.equal(f.changes.at(-1).sb3Format, 'plus');
    f.dialogs.dispose(); f.dom.window.close();
    const invalid = fixture({format: {format: 'plus', source: 'explicit', manifest: {status: 'invalid'}}});
    invalid.dialogs.showProperties('en', undefined, {offerSb3Formats: true});
    const select = invalid.document.querySelector('select');
    assert.equal(select.value, 'plus');
    assert.equal(select.disabled, true);
    invalid.dialogs.dispose(); invalid.dom.window.close();
});

test('switching projects dismisses the format confirmation and discards the metadata and URI draft', async () => {
    const f = fixture({format: {format: 'plus', source: 'manifest', manifest: {status: 'valid'}}});
    const addresses = [];
    f.dialogs.showProperties('ja', {uri: 'https://example.test/old', apply: value => { addresses.push(value); }},
        {offerSb3Formats: true});
    const form = f.document.querySelector('[data-testid="project-properties"] form');
    form.querySelector('[name="sb3Format"]').value = 'standard';
    form.querySelector('[name="uri"]').value = 'https://example.test/new';
    form.dispatchEvent(new f.dom.window.Event('submit', {cancelable: true}));
    assert.equal(f.document.querySelectorAll('dialog').length, 2);
    f.load();
    await Promise.resolve();
    assert.equal(f.document.querySelectorAll('dialog').length, 0);
    assert.deepEqual(f.changes, []);
    assert.deepEqual(addresses, []);
    f.dialogs.dispose(); f.dom.window.close();
});

test('a directly opened result disables Back and a real preceding page enables it', () => {
    const f = fixture({locale: 'ja'});
    showProjectLoadFailure(f.document, {cancelled: true, locale: 'ja'});
    const back = [...f.document.querySelectorAll('[data-testid="project-load-failure"] button')]
        .find(button => button.textContent === '前の画面に戻る');
    let calls = 0;
    f.dom.window.history.back = () => {calls++;};
    assert.equal(back.disabled, true);
    back.click(); assert.equal(calls, 0);
    f.dom.window.history.pushState(null, '', '/editor.html?lang=ja&project_url=failed');
    showProjectLoadFailure(f.document, {cancelled: true});
    assert.equal(back.disabled, false);
    back.click(); assert.equal(calls, 1);
    // A fresh browser tab may have an inaccessible about:blank predecessor.
    Object.defineProperty(f.dom.window, 'navigation', {value: {canGoBack: false}});
    showProjectLoadFailure(f.document, {cancelled: false});
    assert.equal(back.disabled, true);
    f.dialogs.dispose(); f.dom.window.close();
});

test('the start URL preserves display settings and drops all project-opening instructions', () => {
    const dom = new JSDOM('', {url: 'https://example.test/app/editor.html?lang=ja&theme=dark&project_url=failed&token=secret&extension=code&twPlusOpenTab=nonce#123'});
    assert.equal(projectStartURL(dom.window).href, 'https://example.test/app/editor.html?lang=ja&theme=dark');
    dom.window.close();
});
