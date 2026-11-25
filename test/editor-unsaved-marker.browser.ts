// SPDX-License-Identifier: GPL-3.0-or-later
// Assertions from turbowarp-plus-editor/test/editor-layout.browser.ts at 6fbfb7c.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

test('the unsaved marker exposes its hint on hover and keyboard focus within a narrow viewport', {timeout: 30_000}, async t => {
    const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ProjectSaveMenu} from '@kubohiroya/turbowarp-plus-editor-workbench/project-file-menu';
        window.saveActions = 0;
        createRoot(document.getElementById('menu')).render(React.createElement(ProjectSaveMenu, {locale: 'ja',
            entries: {storage: {canSave: true, filename: 'Project.sb3'}, saveAs() {window.saveActions++;}}}));`},
    bundle: true, write: false, format: 'iife', target: 'es2022'});
    const args = process.platform === 'darwin' ? ['--single-process', '--no-zygote', '--disable-crash-reporter'] : [];
    const browser = await chromium.launch({headless: true, args});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1360, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://unsaved-marker.test/**', route => route.fulfill({contentType: 'text/html', body:
        '<!doctype html><html lang="ja"><body><main><input maxlength="100"><div id="menu"></div></main></body></html>'}));
    await page.goto('http://unsaved-marker.test/');
    // Only host positioning and a native title input; the hint and every menu node come from the package.
    await page.addStyleTag({content: 'body {margin:0;font:14px sans-serif} main {position:relative;display:flex;align-items:center;margin-left:48px;height:48px}'});
    await page.addStyleTag({content: await readFile(new URL(import.meta.resolve(
        '@kubohiroya/turbowarp-plus-editor-workbench/project-file-menu.css')), 'utf8')});
    await page.addScriptTag({content: bundled.outputFiles[0].text});
    const title = page.locator('input[maxlength="100"]');
    const label = '未保存の変更があります。保存メニューを開く';
    const marker = page.getByRole('button', {name: label});
    const hint = page.getByText(label, {exact: true});
    await title.fill('プロジェクト');
    await title.press('Enter');
    await expect(marker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await marker.hover();
    await expect(hint).toBeVisible();
    await page.setViewportSize({width: 300, height: 900});
    await page.mouse.move(0, 0);
    await title.press('Tab');
    await expect(marker).toBeFocused();
    await expect(hint).toBeVisible();
    const message = await hint.boundingBox();
    assert(message && message.x >= 0 && message.x + message.width <= page.viewportSize()!.width);

    await marker.press('Enter');
    const save = page.getByRole('button', {name: 'プロジェクトのコピーを保存…', exact: true});
    await expect(save).toBeVisible();
    await save.click();
    assert.equal(await page.evaluate(() => (window as any).saveActions), 1);
    assert.deepEqual(errors, []);
});
