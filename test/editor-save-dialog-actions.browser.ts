// SPDX-License-Identifier: GPL-3.0-or-later
// Assertions from turbowarp-plus-editor/test/editor-layout.browser.ts at 8fc1e70.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import type {SaveAsRequest} from '@kubohiroya/turbowarp-plus-editor-workbench/project-file-dialogs';

// Exercise the owning package's public dialog entries and the windows package's shared CSS.
// The host supplies only lifecycle and save callbacks; no GUI checkout or VM is needed.
test('Save a Copy of the Project keeps the labelled dialog actions at the right edge', {timeout: 30_000}, async t => {
    const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
        export {createProjectDialogService} from '@kubohiroya/turbowarp-plus-editor-workbench/project-dialogs';
        export {renderSaveAsForm, projectFileDialogTitle} from '@kubohiroya/turbowarp-plus-editor-workbench/project-file-dialogs';`},
    bundle: true, write: false, format: 'iife', globalName: 'saveDialog', target: 'es2022'});
    const args = process.platform === 'darwin' ? ['--single-process', '--no-zygote', '--disable-crash-reporter'] : [];
    const browser = await chromium.launch({headless: true, args});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1360, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://save-dialog.test/**', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body></body></html>'}));
    await page.goto('http://save-dialog.test/');
    for (const url of [new URL('../src/project-dialog.css', import.meta.url),
        import.meta.resolve('@kubohiroya/turbowarp-plus-editor-windows/styles.css')]) {
        await page.addStyleTag({content: await readFile(new URL(url), 'utf8')});
    }
    await page.addScriptTag({content: bundled.outputFiles[0].text});
    await page.evaluate(() => {
        const w = window as any;
        const {createProjectDialogService, renderSaveAsForm, projectFileDialogTitle} = w.saveDialog;
        const {createProjectDialogs} = createProjectDialogService({styles: {dialog: 'dialog'}, snackbarStyles: {}});
        const dialogs = createProjectDialogs(document, {subscribe() {return () => {};}});
        w.saveRequests = [];
        w.openSaveDialog = () => dialogs.showView(projectFileDialogTitle('save-as', 'en'), 'en', (document: Document, close: () => void) =>
            renderSaveAsForm(document, 'en', {filename: 'Project.sb3'}, async (request: SaveAsRequest) => {
                w.saveRequests.push(request);
                return true;
            }, close));
        w.openSaveDialog();
    });
    const dialog = page.getByRole('dialog', {name: 'Save a Copy of the Project', exact: true});
    const cancel = dialog.getByRole('button', {name: 'Cancel', exact: true});
    const save = dialog.getByRole('button', {name: 'Save', exact: true});
    const actions = dialog.locator('.tw-plus-dialog-actions');
    await expect(actions).toHaveCSS('justify-content', /^(?:flex-end|flow-end)$/);
    const icons = await actions.locator('[data-dialog-action]:visible').evaluateAll(buttons =>
        buttons.map(button => getComputedStyle(button, '::before').maskImage));
    assert.equal(icons.length, 2);
    assert.ok(icons.every(icon => icon.startsWith('url("data:image/svg+xml')));
    assert.notEqual(icons[0], icons[1]);
    const [cancelBox, saveBox, actionsBox] = await Promise.all([
        cancel.boundingBox(), save.boundingBox(), actions.boundingBox()
    ]);
    assert.ok(cancelBox && saveBox && actionsBox);
    assert.ok(cancelBox.x < saveBox.x);
    assert.ok(Math.abs(saveBox.x + saveBox.width - actionsBox.x - actionsBox.width) <= 1);
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => (window as any).saveRequests), []);
    await page.evaluate(() => (window as any).openSaveDialog());
    await save.click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => (window as any).saveRequests), [{name: 'Project', format: 'current'}]);
    assert.deepEqual(errors, []);
});
