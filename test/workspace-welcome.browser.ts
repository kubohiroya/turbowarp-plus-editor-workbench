import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

test('the empty workspace centers branding, follows theme changes and keeps its action reachable', {timeout: 30000}, async t => {
    const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
        import {mountSpriteTabs} from './dist/sprite-tabs.js';
        import styles from './src/editor.css';
        import 'dockview/dist/styles/dockview.css';
        const listeners = new Set();
        const target = {id: 'sprite', isStage: false, isOriginal: true, getName: () => 'Sprite'};
        const vm = {editingTarget: target, runtime: {targets: [target]},
            on: (_, listener) => listeners.add(listener),
            removeListener: (_, listener) => listeners.delete(listener),
            setEditingTarget() { for (const listener of listeners) listener(); }};
        const root = document.querySelector('main');
        root.className = styles['sprite-tabs'];
        window.controller = mountSpriteTabs(root, document.createElement('div'), {
            vm, locale: 'ja', getSection: () => 0, activateSection() {}, selectTarget() {}, resize() {},
            welcomeBrand: {logo: '/logo.svg', version: '0.4.1'}
        });
        document.querySelector('.dv-default-tab-action').click();
    `}, bundle: true, write: false, outdir: '/virtual', format: 'iife', target: 'es2022',
    plugins: [{name: 'editor-css-modules', setup(build) {
        build.onLoad({filter: /\/src\/editor\.css$/}, async args => ({
            contents: await readFile(args.path, 'utf8'), loader: 'local-css'
        }));
    }}]});
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/logo.svg', route => route.fulfill({contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 328 256"><rect width="328" height="256" fill="#855cd6"/></svg>'}));
    await page.setContent(`<!doctype html><html><head><style>
        :root {color-scheme: light; --color-scheme: light; --ui-primary: #ffffff; --ui-white: #ffffff;
            --text-primary: #333333; --looks-secondary: #855cd6; --looks-light-transparent: #855cd622;}
        :root[data-theme="dark"] {color-scheme: dark; --color-scheme: dark; --ui-primary: #202020;
            --ui-white: #282828; --text-primary: #eeeeee; --looks-secondary: #bca3ff;}
        html, body {height: 100%; margin: 0;} main {height: 100%;}
    </style></head><body><main></main></body></html>`);
    await page.addStyleTag({content: bundled.outputFiles.find(file => file.path.endsWith('.css')).text});
    await page.addScriptTag({content: bundled.outputFiles.find(file => file.path.endsWith('.js')).text});
    const group = page.locator('.tw-plus-workspace-welcome__group');
    const open = page.getByRole('button', {name: 'スプライトを開く', exact: true});
    await expect(open).toBeVisible();
    const bounds = await group.boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 500) < 2);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 350) < 2);
    const website = page.getByRole('link', {name: 'https://kubohiroya.github.io/turbowarp-plus-editor/', exact: true});
    const websiteBounds = await website.boundingBox();
    const buttonBounds = await open.boundingBox();
    assert.ok(buttonBounds.y - (websiteBounds.y + websiteBounds.height) >= 24);
    await expect(group).toHaveCSS('color', 'rgb(51, 51, 51)');
    await page.evaluate(() => {document.documentElement.dataset.theme = 'dark';});
    await expect(group).toHaveCSS('color', 'rgb(238, 238, 238)');
    await expect(page.locator('.dv-watermark-container')).toHaveCSS('background-color', 'rgb(32, 32, 32)');
    await expect(website).toHaveCSS('color', 'rgb(188, 163, 255)');
    await page.setViewportSize({width: 320, height: 240});
    await open.scrollIntoViewIfNeeded();
    const narrow = await open.boundingBox();
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 320);
    assert.ok(narrow.y >= 0 && narrow.y + narrow.height <= 240);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await open.focus();
    await expect(open).toBeFocused();
    await open.press('Enter');
    await expect(group).toHaveCount(0);
    await expect(page.locator('.dv-tab')).toHaveCount(1);
    assert.deepEqual(errors, []);
});
