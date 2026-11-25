// SPDX-License-Identifier: GPL-3.0-or-later
// Geometry checks from turbowarp-plus-editor/test/editor-layout.browser.ts at d17cb8e.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect, type Locator} from '@playwright/test';

const origin = 'http://stage-drawer.test';
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createStandardLayout} from '@kubohiroya/turbowarp-plus-editor-workbench/standard-layout';
import {StageResizeHandle} from '@kubohiroya/turbowarp-plus-editor-workbench/stage-surface';
const h = React.createElement;
const context = React.createContext({});
const styles = new Proxy({}, {get: (_, key) => String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())});
const {EdgeDrawer} = createStandardLayout(React, {styles, targetStyles: styles, context, LayoutMenu: undefined});
function Host() {
    const [layout, setLayout] = React.useState({open: true, selected: true});
    const [width, setWidth] = React.useState(360);
    const close = React.useRef(null);
    const updateStageDrawer = React.useCallback(patch => setLayout(current => ({...current, ...patch})), []);
    const handles = ['left', 'right', 'top', 'bottom'].map(edge => h(StageResizeHandle, {key: edge, edge,
        aspect: 4 / 3, width, drawer: true, className: 'stage-resize-handle', label: 'Resize preview',
        limits: {minimum: 160, maximum: 560, resize: setWidth}}));
    const preview = h('div', {className: 'stage-frame'},
        h('div', {className: 'stage-header', 'data-stage-drawer-handle': '', style: {height: 32}},
            h('button', {type: 'button'}, 'Host control'),
            h('button', {type: 'button', onClick: () => close.current?.()}, 'Close drawer')),
        h('canvas', {width, height: width * 3 / 4, 'aria-label': 'Preview', style: {display: 'block'}}), ...handles);
    return h('div', {className: 'standard-body', style: {position: 'relative', width: '100vw', height: '100vh'}},
        h('div', {className: 'floating-stage stage-drawer', style: {width: width + 10}},
            h(EdgeDrawer, {edge: 'right', label: 'Reveal run view', movableStage: true, available: true,
                showTrigger: false, stageDrawerLayout: layout, updateStageDrawer, closePanelRef: close}, preview)));
}
createRoot(document.querySelector('main')).render(h(Host));
`;
const bundle = await build({stdin: {contents: source, resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'stage-drawer-host.js'}, bundle: true, format: 'esm', platform: 'browser', write: false});
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/editor.css">
<style>body {margin: 0; font: 16px sans-serif} :root {--ui-secondary: #eee; --ui-black-transparent: #bbb}</style>
<main></main><script type="module" src="/host.js"></script>`;
async function openDrawer(t: TestContext) {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1360, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'the standalone drawer has no browser errors'));
    await page.route(origin + '/**', async route => {
        const {pathname} = new URL(route.request().url());
        if (pathname === '/') return route.fulfill({contentType: 'text/html', body: html});
        if (pathname === '/host.js') return route.fulfill({contentType: 'application/javascript', body: bundle.outputFiles[0].text});
        if (pathname === '/editor.css') return route.fulfill({contentType: 'text/css',
            body: await readFile(new URL('../src/editor.css', import.meta.url))});
        return route.fulfill({status: 404});
    });
    await page.goto(origin);
    return page;
}

const bounds = async (locator: Locator) => {
    const box = await locator.boundingBox();
    assert.ok(box, 'the geometry target has a bounding box');
    return box;
};

test('the standalone stage drawer moves, resizes and folds along its host edges', {timeout: 30_000}, async t => {
    const page = await openDrawer(t);
    const drawer = page.locator('[data-movable-stage]');
    const panel = drawer.locator(':scope > [tabindex="-1"]');
    const stage = drawer.locator('..');
    const header = drawer.locator('[data-stage-drawer-handle]');
    const canvas = drawer.locator('canvas');
    const display = header.getByRole('button', {name: 'Host control', exact: true});
    const handle = page.getByRole('button', {name: 'Reveal run view', exact: true});
    const resize = (edge: string) => drawer.locator(`[data-stage-drawer-resize][data-stage-resize="${edge}"]`);
    await expect(canvas).toBeVisible();
    await expect(panel).toHaveCSS('translate', 'none');
    const initial = await bounds(stage);
    const control = await bounds(display);
    assert.ok(initial && control);
    await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2);
    await page.mouse.down();
    await page.mouse.move(control.x - 60, control.y + 90);
    await page.mouse.up();
    await expect(canvas).toBeVisible();
    assert.deepEqual(await bounds(stage), initial);

    const grip = await bounds(header);
    const area = await stage.evaluate(node => {
        const {left, top, right, bottom} = (node as HTMLElement).offsetParent!.getBoundingClientRect();
        return {left, top, right: Math.min(right, innerWidth), bottom: Math.min(bottom, innerHeight)};
    });
    assert.ok(grip);
    const x = grip.x + grip.width * 0.75;
    const y = grip.y + grip.height / 2;
    const offsetX = x - initial.x;
    const offsetY = y - initial.y;
    const left = area.left;
    const right = area.right - initial.width;
    const top = area.top;
    const bottom = area.bottom - initial.height;
    const middleX = (left + right) / 2;
    const middleY = (top + bottom) / 2;
    const at = async (x: number, y: number) => {
        await expect.poll(async () => {
            const position = await bounds(stage);
            return position && Math.hypot(position.x - x, position.y - y) < 2;
        }).toBe(true);
    };
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const [x, y] of [[right, middleY], [right, bottom], [middleX, bottom], [left, bottom], [left, middleY],
        [left, top], [middleX, top], [right, top], [right, bottom]]) {
        await page.mouse.move(x + offsetX, y + offsetY, {steps: 6});
        await at(x, y);
    }
    await page.mouse.up();
    await expect(canvas).toBeVisible();

    await expect(resize('left')).toBeVisible();
    await expect(resize('top')).toBeVisible();
    await expect(resize('right')).toBeHidden();
    await expect(resize('bottom')).toBeHidden();
    const gripLeft = await bounds(resize('left'));
    const beforeResize = await bounds(stage);
    assert.ok(gripLeft && beforeResize);
    await page.mouse.move(gripLeft.x + gripLeft.width / 2, gripLeft.y + gripLeft.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripLeft.x + gripLeft.width / 2 - 40, gripLeft.y + gripLeft.height / 2, {steps: 8});
    await page.mouse.up();
    await expect.poll(async () => (await bounds(stage)).width).toBe(beforeResize.width + 40);
    const afterResize = await bounds(stage);
    assert.ok(Math.abs(afterResize.x + afterResize.width - area.right) < 2);
    assert.ok(Math.abs(afterResize.y + afterResize.height - area.bottom) < 2);

    await page.setViewportSize({width: 640, height: 700});
    await expect.poll(async () => {
        const position = await bounds(stage);
        return position && Math.abs(position.x + position.width - 640) < 2 &&
            Math.abs(position.y + position.height - 700) < 2;
    }).toBe(true);
    const moved = await bounds(stage);
    await header.getByRole('button', {name: 'Close drawer', exact: true}).click();
    await expect(canvas).toBeHidden();
    await expect(handle).toBeVisible();
    const closedRight = await bounds(handle);
    assert.equal(closedRight.width, 8);
    assert.ok(Math.abs(closedRight.height - moved.height) < 2);
    assert.ok(Math.abs(closedRight.x + closedRight.width - 640) < 2);
    await expect.poll(() => handle.evaluate(node => getComputedStyle(node, '::before').rotate)).toBe('135deg');
    await handle.click();
    await expect(canvas).toBeVisible();
    await at(moved.x, moved.y);
    await expect(handle).toBeHidden();
    await expect(panel).toHaveCSS('translate', 'none');

    const resizedHeader = await bounds(header);
    const grab = {x: resizedHeader.x + resizedHeader.width * 0.75, y: resizedHeader.y + resizedHeader.height / 2};
    const targetX = (640 - moved.width) / 2;
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + targetX - moved.x, grab.y, {steps: 8});
    await page.mouse.up();
    await at(targetX, moved.y);
    await expect(resize('bottom')).toBeHidden();
    await expect(resize('right')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(canvas).toBeHidden();
    const closedBottom = await bounds(handle);
    assert.equal(closedBottom.height, 8);
    assert.ok(Math.abs(closedBottom.width - moved.width) < 2);
    assert.ok(Math.abs(closedBottom.y + closedBottom.height - 700) < 2);
    await expect.poll(() => handle.evaluate(node => getComputedStyle(node, '::before').rotate)).toBe('-135deg');
    await handle.press('Enter');
    await expect(canvas).toBeVisible();
    await at(targetX, moved.y);
    await expect(panel).toHaveCSS('translate', 'none');

    const bottomHeader = await bounds(header);
    const from = {x: bottomHeader.x + bottomHeader.width * 0.75, y: bottomHeader.y + bottomHeader.height / 2};
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + top - moved.y, {steps: 12});
    await page.mouse.up();
    await at(targetX, top);
    await expect(resize('top')).toBeHidden();
    await expect(resize('bottom')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(canvas).toBeHidden();
    const closedTop = await bounds(handle);
    assert.equal(closedTop.height, 8);
    assert.ok(Math.abs(closedTop.width - moved.width) < 2);
    assert.ok(Math.abs(closedTop.y - top) < 2);
    await expect.poll(() => handle.evaluate(node => getComputedStyle(node, '::before').rotate)).toBe('45deg');
});
