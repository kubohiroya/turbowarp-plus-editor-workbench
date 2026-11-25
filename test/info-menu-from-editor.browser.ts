// SPDX-License-Identifier: GPL-3.0-or-later
// Menu checks from Editor editor-layout.browser.ts; see test/LICENSE.GPL-3.0.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
    stdin: {resolveDir: root, contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ProjectInfoMenu} from '@kubohiroya/turbowarp-plus-editor-workbench/project-info-menu';
        createRoot(document.querySelector('main')).render(React.createElement(ProjectInfoMenu, {
            locale: 'ja', version: '0.4.1', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',
            leading: true
        }));
    `},
    bundle: true, write: false, platform: 'browser', format: 'iife'
});
const css = await readFile(new URL('../src/info-menu.css', import.meta.url), 'utf8');
const label = 'TurboWarp Plus プロジェクト情報';
async function open(t: TestContext) {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 640, height: 480}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        :root {--ui-white: #fff; --text-primary: #222; --ui-black-transparent: #ddd}
        main {display: flex; min-height: 42px}
        #host-overlay {position: absolute; top: 42px; left: 0; width: 350px; height: 310px; z-index: 100}
    </style><main></main><div id="host-overlay"></div>`);
    await page.addStyleTag({content: css});
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    return {page, trigger: page.getByLabel(label, {exact: true}).first(),
        menu: page.getByRole('navigation', {name: label})};
}

test('the standalone project logo opens links and no pin action', async t => {
    const {trigger, menu} = await open(t);
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(menu.getByRole('separator')).toBeVisible();
    await expect(menu.getByRole('link').first()).toHaveText('TurboWarp Plus Editor 0.4.1について');
    const links = [
        ['TurboWarp-Plusのソースコード', 'https://github.com/kubohiroya/turbowarp-plus-editor'],
        ['TurboWarpのライセンスとクレジット', 'credits.html']
    ];
    for (const [name, href] of links) {
        const link = menu.getByRole('link', {name, exact: true});
        await expect(link).toHaveAttribute('href', href);
        await expect(link.locator('svg[aria-hidden="true"][fill="currentColor"]')).toBeVisible();
    }
    await expect(menu.locator('hr + a')).toHaveText(links[0][0]);
    await expect(menu.getByRole('button', {name: /ピン留め/})).toHaveCount(0);
    await trigger.press('Escape');
    await expect(menu).toBeHidden();
});

test('the standalone project menu remains clickable over a host overlay', async t => {
    const {page, trigger, menu} = await open(t);
    await trigger.click();
    const link = menu.getByRole('link').first();
    const bounds = await link.boundingBox();
    assert.ok(bounds);
    const point = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    const host = await page.locator('#host-overlay').boundingBox();
    assert.ok(host && point.x > host.x && point.x < host.x + host.width &&
        point.y > host.y && point.y < host.y + host.height, 'test must overlap both surfaces');
    assert.ok(await link.evaluate((node, {x, y}) => node.contains(document.elementFromPoint(x, y)), point));
});
