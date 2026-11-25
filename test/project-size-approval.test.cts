// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/extension-host/project-size-gate.test.ts at 5bc644f.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {confirmLargeProject} = require('../dist/project-size-approval.js');
const MiB = 1024 * 1024;

test('the size question names the size, defaults to not opening, and answers no without a dialog', async () => {
    const dom = new JSDOM('<!doctype html><body></body>');
    const {document} = dom.window;
    const proto = dom.window.HTMLDialogElement.prototype;
    proto.showModal = function () { this.open = true; };
    proto.close = function () { this.open = false; };
    try {
        const question = {bytes: 100 * MiB, limit: 64 * MiB};
        const declined = confirmLargeProject(document, 'ja', question);
        const dialog = document.querySelector('dialog[data-project-size-approval]');
        assert.match(dialog.textContent, /約 100 MiB/);
        assert.match(dialog.textContent, /64 MiB/);
        const [no] = dialog.querySelectorAll('button');
        assert.equal(document.activeElement, no);
        no.click();
        assert.equal(await declined, false);
        assert.equal(document.querySelector('dialog'), null);

        const agreed = confirmLargeProject(document, 'en', question);
        assert.match(document.querySelector('dialog').textContent, /about 100 MiB/);
        document.querySelectorAll('button')[1].click();
        assert.equal(await agreed, true);

        const controller = new AbortController();
        const aborted = confirmLargeProject(document, 'en', question, {signal: controller.signal});
        controller.abort();
        assert.equal(await aborted, false);
        assert.equal(document.querySelector('dialog'), null);

        assert.equal(await confirmLargeProject(undefined, 'ja', question), false);
    } finally {
        dom.window.close();
    }
});
