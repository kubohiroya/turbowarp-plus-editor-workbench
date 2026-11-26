// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted progress/history checks from Editor test/e2e/extension-loader/project-load-progress.spec.cts
// at 4c2f2915124959fad3ed2b3b4ab008ee737c54e2. See test/LICENSE.GPL-3.0.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({stdin: {contents: `
    import {showProjectLoadProgress} from './src/project-load-progress-view.tsx';
    import {beginProjectLoad, captureProjectLoad, duringProjectLoadApproval} from './src/project-load-progress.ts';
    const vm = {};
    window.start = locale => {
        const close = showProjectLoadProgress(document, vm, locale);
        const load = beginProjectLoad(vm, new Uint8Array([0x50, 0x4b]));
        let report;
        load.invoke(() => {report = captureProjectLoad(vm);});
        report('archive'); report('project');
        window.approval = () => duringProjectLoadApproval(vm, () => new Promise(resolve => {window.release = resolve;}));
        window.stop = () => {load.finish(); close(); close();};
    };
`, resolveDir: root, loader: 'tsx'}, bundle: true, write: false, platform: 'browser',
    define: {'process.env.NODE_ENV': '"production"'}});

for (const locale of ['en', 'ja']) test(`the receiving-tab progress follows approval and releases its view (${locale})`, async t => {
    const css = await readFile(new URL('../src/project-load-progress.css', import.meta.url));
    const server = createServer((request, response) => {
        if (request.url === '/entry.js') response.setHeader('Content-Type', 'text/javascript').end(bundle.outputFiles[0].contents);
        else if (request.url === '/progress.css') response.setHeader('Content-Type', 'text/css').end(css);
        else response.setHeader('Content-Type', 'text/html').end('<!doctype html><link rel="stylesheet" href="/progress.css">' +
            '<button id="original">Original project</button><script src="/entry.js"></script>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();}));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(locale => (window as any).start(locale), locale);
    const progress = page.locator('[data-project-load-progress]');
    await expect(progress.getByRole('status')).toHaveText(locale === 'ja' ? 'プロジェクトを解析中…' : 'Parsing the project…');
    const history = progress.locator('[data-project-load-history]');
    await expect(history).toBeHidden();
    await progress.hover();
    await expect(history).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(history).toBeHidden();
    await progress.focus();
    await expect(history).toBeVisible();
    assert.deepEqual(await history.locator('li').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.phase)),
        ['opening', 'archive']);
    const times = await history.locator('time').evaluateAll(rows => rows.map(row => Date.parse(row.getAttribute('datetime')!)));
    assert.ok(times.every(Number.isFinite));
    assert.ok(times[1] >= times[0]);
    for (const label of await history.locator('time').allTextContents()) assert.match(label, /^\d{2}:\d{2}:\d{2}\.\d{3}$/u);
    await expect(history.locator('li').first()).toContainText(locale === 'ja' ? '+0.00 秒' : '+0.00 s');
    await progress.blur();
    await expect(history).toBeHidden();
    await page.evaluate(() => {void (window as any).approval();});
    await expect(progress.locator('[data-phase="approval"]')).toHaveText(locale === 'ja' ? 'ユーザーの確認待ち…' : 'Waiting for your confirmation…');
    await page.evaluate(() => (window as any).release());
    await expect(progress.getByRole('status')).toHaveAttribute('data-phase', 'project');
    await page.evaluate(() => (window as any).stop());
    await expect(page.locator('.tw-project-load-progress__overlay')).toHaveCount(0);
    await page.getByRole('button', {name: 'Original project'}).click();
    assert.deepEqual(errors, []);
});
