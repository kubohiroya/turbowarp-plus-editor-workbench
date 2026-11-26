// SPDX-License-Identifier: GPL-3.0-or-later
// Progress assertions adapted from Editor project-load-progress.spec.cts; see test/LICENSE.GPL-3.0.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const bundle = await build({
    stdin: {resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ProjectLoadProgress} from './dist/project-load-progress-view.js';
        import {beginProjectLoad, captureProjectLoad, duringProjectLoadApproval} from './dist/project-load-progress.js';
        const vm = {};
        const root = createRoot(document.querySelector('main'));
        let load, report, resume;
        window.fixture = {
            render(locale) {root.render(React.createElement(ProjectLoadProgress, {vm, locale}, 'Host loading message'));},
            begin() {load = beginProjectLoad(vm, new Uint8Array([0x50, 0x4b])); report = load.invoke(() => captureProjectLoad(vm));},
            report(phase) {report(phase);},
            approval() {return duringProjectLoadApproval(vm, () => new Promise(resolve => {resume = resolve;}));},
            resume() {resume();},
            finish() {load.finish();}
        };
    `}, bundle: true, write: false, platform: 'browser', format: 'iife'
});
const css = await readFile(new URL('../src/project-load-progress.css', import.meta.url), 'utf8');

for (const locale of ['ja', 'en']) test(`load progress presents timed history and clears after approval in ${locale}`, async t => {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.setContent('<!doctype html><main></main>');
    await page.addStyleTag({content: css});
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.evaluate(locale => (window as any).fixture.render(locale), locale);
    await expect(page.getByText('Host loading message')).toBeVisible();
    await page.evaluate(() => (window as any).fixture.begin());
    const progress = page.locator('[data-project-load-progress]');
    const history = progress.locator('[data-project-load-history]');
    await expect(progress.getByRole('status')).toHaveAttribute('data-phase', 'opening');
    await expect(page.getByText('Host loading message')).toBeHidden();
    for (const phase of ['payloads', 'archive', 'project']) {
        await page.evaluate(phase => (window as any).fixture.report(phase), phase);
        await expect(progress.getByRole('status')).toHaveAttribute('data-phase', phase);
    }
    await expect(progress.getByRole('status')).toHaveText(locale === 'ja' ? 'プロジェクトを解析中…' : 'Parsing the project…');
    await expect(history).toBeHidden();
    await progress.hover();
    await expect(history).toBeVisible();
    assert.deepEqual(await history.locator('li').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.phase)),
        ['opening', 'payloads', 'archive']);
    const times = await history.locator('time').evaluateAll(elements => elements.map(element =>
        ({label: element.textContent!, time: Date.parse(element.dateTime)})));
    for (let i = 0; i < times.length; i++) {
        assert.match(times[i].label, /^\d{2}:\d{2}:\d{2}\.\d{3}$/u);
        assert.ok(Number.isFinite(times[i].time));
        if (i) assert.ok(times[i].time >= times[i - 1].time);
    }
    await expect(history.locator('li').first()).toContainText(locale === 'ja' ? '+0.00 秒' : '+0.00 s');
    await page.mouse.move(1000, 700);
    await expect(history).toBeHidden();
    await progress.focus();
    await expect(history).toBeVisible();
    await progress.blur();
    await page.evaluate(() => {void (window as any).fixture.approval();});
    await expect(progress.getByRole('status')).toHaveText(locale === 'ja' ? 'ユーザーの確認待ち…' : 'Waiting for your confirmation…');
    await page.evaluate(() => (window as any).fixture.resume());
    await expect(progress.getByRole('status')).toHaveAttribute('data-phase', 'project');
    await page.evaluate(() => (window as any).fixture.finish());
    await expect(progress).toHaveCount(0);
    await expect(page.getByText('Host loading message')).toBeVisible();
});
