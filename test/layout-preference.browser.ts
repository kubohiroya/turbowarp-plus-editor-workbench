import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({stdin: {resolveDir: root, contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ProjectInfoMenu} from './dist/info-menu.js';
    import {createLayoutPreference, useLayoutPreference, createStandardLayout} from './dist/standard-layout.js';
    const h = React.createElement;
    const choice = createLayoutPreference({search: location.search});
    const styles = new Proxy({}, {get: (_, key) => String(key).replace(/[A-Z]/g, x => '-' + x.toLowerCase())});
    const context = React.createContext({});
    const {StandardLayout} = createStandardLayout(React, {styles, targetStyles: styles, context});
    function App() {
        const enabled = useLayoutPreference(choice);
        return h(React.Fragment, null,
            h(ProjectInfoMenu, {locale: new URLSearchParams(location.search).get('lang') || 'ja',
                version: '0.4.6', logo: 'data:image/svg+xml,%3Csvg/%3E', leading: true,
                layoutPreference: choice, openPrivacy() {},
                beforeLayoutChange: new URLSearchParams(location.search).has('defer') ?
                    () => new Promise(resolve => { window.finishLayoutChange = resolve; }) : undefined}),
            h(StandardLayout, {enabled, splitter: false, windowLayout: false,
                stageActionEnabled: false, fullscreen: false, locale: 'ja', stageAspect: 4 / 3,
                defaultStageWidth: 360, onPaletteModeChange: horizontal => {
                    document.documentElement.dataset.palette = horizontal ? 'top' : 'side';
                },
                render: layout => h('div', {id: 'layout', ref: layout.observe,
                    className: layout.bodyClassName, style: layout.bodyStyle},
                    h('textarea', {'aria-label': 'Project code', style: layout.editorStyle}),
                    h('div', {id: 'stage-column', style: layout.stageColumnStyle},
                        h('canvas', {id: 'stage', className: layout.stageClassName}), h('div', null, 'Sprite1')))
            }));
    }
    createRoot(document.querySelector('main')).render(h(App));
`}, bundle: true, write: false, platform: 'browser', format: 'iife'});
const css = await readFile(new URL('../src/info-menu.css', import.meta.url), 'utf8');

async function open(t: TestContext, query = '', denied = false) {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    if (denied) await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('Denied', 'SecurityError'); }
    }));
    await page.route('http://layout.test/**', route => route.fulfill({contentType: 'text/html', body:
        '<!doctype html><meta charset="utf-8"><style>' + css + '</style><main></main><script>' + bundle.outputFiles[0].text + '</script>'}));
    await page.goto('http://layout.test/' + query);
    const trigger = page.locator('summary');
    const item = page.getByRole('menuitemcheckbox');
    return {page, trigger, item};
}

test('second menu item switches both layouts live and restores both saved choices', async t => {
    const {page, trigger, item} = await open(t);
    await trigger.click();
    await expect(item).toHaveText('新レイアウトを有効化');
    await expect(item).toHaveAttribute('aria-checked', 'false');
    assert.equal(await item.evaluate(node => node.parentElement.children[1] === node), true);
    await page.getByLabel('Project code').fill('unsaved code');
    await page.evaluate(() => { (window as any).originalCanvas = document.querySelector('canvas'); });
    for (const enabled of [true, false, true]) {
        await item.click();
        await expect(page.locator('#layout')).toHaveClass(enabled ? 'standard-body' : '');
        await expect(page.getByLabel('Project code')).toHaveValue('unsaved code');
        assert.equal(await page.evaluate(() => (window as any).originalCanvas === document.querySelector('canvas')), true);
        assert.equal(await page.evaluate(() => localStorage.getItem('twPlusNewLayoutEnabled')), enabled ? '1' : '0');
        await trigger.click();
        await expect(item).toHaveAttribute('aria-checked', String(enabled));
    }
    await page.reload();
    await expect(page.locator('#layout')).toHaveClass('standard-body');
    await trigger.click();
    await item.press('Space');
    await expect(page.locator('#layout')).toHaveClass('');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'side');
    await page.reload();
    await expect(page.locator('#layout')).toHaveClass('');
    await trigger.click();
    await expect(item).toHaveAttribute('aria-checked', 'false');
});

test('English item toggles despite denied storage and defaults off again on reload', async t => {
    const {page, trigger, item} = await open(t, '?lang=en', true);
    await trigger.click();
    await expect(item).toHaveText('Enable new layout');
    await item.press('Enter');
    await expect(page.locator('#layout')).toHaveClass('standard-body');
    await page.reload();
    await trigger.click();
    await expect(item).toHaveAttribute('aria-checked', 'false');
});

test('a menu choice updates an explicit URL override so reload uses the chosen layout', async t => {
    const {page, trigger, item} = await open(t, '?twPlusStandardLayout=1');
    await expect(page.locator('#layout')).toHaveClass('standard-body');
    await trigger.click();
    await item.click();
    assert.equal(new URL(page.url()).searchParams.get('twPlusStandardLayout'), '0');
    await page.reload();
    await expect(page.locator('#layout')).toHaveClass('');
});


test('a pending layout transition disables repeated activation and a refusal keeps the saved choice', async t => {
    const {page, trigger, item} = await open(t, '?defer=1');
    await trigger.click();
    await item.click();
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await page.evaluate(() => (window as any).finishLayoutChange(false));
    await trigger.click();
    await expect(item).toBeEnabled();
    assert.equal(await page.evaluate(() => localStorage.getItem('twPlusNewLayoutEnabled')), null);
    await item.click();
    await page.evaluate(() => (window as any).finishLayoutChange(true));
    await expect(page.locator('#layout')).toHaveClass('standard-body');
});
