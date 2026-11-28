import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {JSDOM} from 'jsdom';
import {projectNoticeClassName, showNotice} from '../dist/project-notice.js';

function dom(t: TestContext) {
    const window = new JSDOM('<body></body>').window;
    t.after(() => window.close());
    return window;
}

const notices = (document: Document) => [...document.querySelectorAll('[data-testid="project-notice-snackbar"]')];

test('a notice shows its text as a status with an X dismiss button named for the locale', t => {
    const {document} = dom(t);
    showNotice(document, 'Saved.', {locale: 'ja'});
    const [notice] = notices(document);
    assert.equal(notice.className, projectNoticeClassName);
    assert.equal(notice.querySelector('[role="status"]').textContent, 'Saved.');
    const dismiss = notice.querySelector('button');
    assert.equal(dismiss.getAttribute('aria-label'), '閉じる');
    assert.equal(dismiss.title, '閉じる');
    assert.equal(dismiss.textContent, '');
    assert.ok(dismiss.querySelector('svg[aria-hidden="true"]'));
    dismiss.click();
    assert.deepEqual(notices(document), []);
});

test('a notice hides itself after the timeout unless focus is inside it', async t => {
    const {document} = dom(t);
    showNotice(document, 'Gone soon', {locale: 'en', timeout: 5});
    assert.equal(notices(document)[0].querySelector('button').getAttribute('aria-label'), 'Dismiss');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(notices(document), []);
    showNotice(document, 'Focused', {locale: 'en', timeout: 5});
    notices(document)[0].querySelector('button').focus();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(notices(document).length, 1);
});

test('a new notice replaces the shown one, and the returned function removes it', t => {
    const {document} = dom(t);
    showNotice(document, 'First', {locale: 'en'});
    const remove = showNotice(document, 'Second', {locale: 'en'});
    assert.deepEqual(notices(document).map(notice => notice.textContent), ['Second']);
    remove();
    assert.deepEqual(notices(document), []);
});

test('a notice with an action shows a button that runs it, and stays until used', async t => {
    const {document} = dom(t);
    let runs = 0;
    showNotice(document, 'Renamed.', {locale: 'en', timeout: 5, action: {label: 'Open the folder again', run: () => {runs++;}}});
    await new Promise(resolve => setTimeout(resolve, 20));
    const [notice] = notices(document);
    const action = notice.querySelector<HTMLButtonElement>('.tw-project-notice-action');
    assert.equal(action.textContent, 'Open the folder again');
    action.click();
    assert.equal(runs, 1);
    assert.deepEqual(notices(document), []);
});
