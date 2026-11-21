import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {JSDOM} from 'jsdom';
import {approveProjectPayloads} from '../dist/project-payload-approval.js';
import {backpackRevealLabel} from '../dist/backpack.js';
import {extensionLibraryTranslations} from '../dist/extension-file-menu.js';

function dom(t: TestContext) {
    const window = new JSDOM('<body></body>').window;
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    t.after(() => window.close());
    return window.document;
}

const labels = (document: Document) => [...document.querySelectorAll('dialog button')].map(node => node.textContent);

test('cacheable data offers caching as a separate choice and lists every URL as text', async t => {
    const document = dom(t);
    const answer = approveProjectPayloads(document, 'ja', ['https://example.test/<b>a</b>', 'https://example.test/b'], true,
        {className: 'frame'});
    const dialog = document.querySelector('dialog')!;
    assert.equal(dialog.className, 'frame');
    assert.equal(dialog.getAttribute('aria-label'), '作品のデータを取得する');
    assert.deepEqual([...dialog.querySelectorAll('li')].map(row => row.textContent),
        ['https://example.test/<b>a</b>', 'https://example.test/b']);
    assert.equal(dialog.querySelector('b'), null);
    assert.deepEqual(labels(document), ['キャンセル', 'キャッシュせずに開く', 'キャッシュを許可して開く']);
    (dialog.querySelectorAll('button')[2] as HTMLButtonElement).click();
    assert.equal(await answer, true);
    assert.equal(document.querySelector('dialog'), null);
});

test('non-cacheable data is opened without a caching choice', async t => {
    const document = dom(t);
    const answer = approveProjectPayloads(document, 'en', ['https://example.test/a'], false);
    assert.deepEqual(labels(document), ['Cancel', 'Open']);
    (document.querySelectorAll('dialog button')[1] as HTMLButtonElement).click();
    assert.equal(await answer, false);
});

test('Escape and an aborted load answer cancel; nothing is asked without a document', async t => {
    const document = dom(t);
    const escape = approveProjectPayloads(document, 'en', ['https://example.test/a'], true);
    document.querySelector('dialog')!.dispatchEvent(new document.defaultView!.Event('cancel', {cancelable: true}));
    assert.equal(await escape, undefined);

    const controller = new AbortController();
    const aborted = approveProjectPayloads(document, 'en', ['https://example.test/a'], true, {signal: controller.signal});
    controller.abort();
    assert.equal(await aborted, undefined);
    assert.equal(document.querySelector('dialog'), null);

    assert.equal(await approveProjectPayloads(undefined, 'en', ['https://example.test/a'], true), undefined);
});

test('the Backpack drawer label and the extension library title follow the locale', () => {
    assert.equal(backpackRevealLabel('ja-JP'), 'バックパックを展開');
    assert.equal(backpackRevealLabel('en'), 'Reveal Backpack');
    assert.equal(backpackRevealLabel(undefined), 'Reveal Backpack');
    assert.equal(extensionLibraryTranslations.ja['gui.extensionLibrary.chooseAnExtension'], '機能拡張を作品に追加する');
    assert.equal(extensionLibraryTranslations.en['gui.extensionLibrary.chooseAnExtension'], 'Add Extensions to the Project');
});
