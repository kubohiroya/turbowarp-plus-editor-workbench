import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from '@playwright/test';

test('the initial code render retains a painted wait cursor after project loading resolves', async t => {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const source = await readFile(new URL('../dist/busy-cursor.js', import.meta.url), 'utf8');
    await page.route('http://initial-code.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'application/javascript' : 'text/html',
        body: route.request().url().endsWith('.js') ? source : '<!doctype html><body><main id="code"></main></body>'
    }));
    await page.goto('http://initial-code.test/');
    const states = await page.evaluate(async () => {
        const {withWaitCursor} = await import('http://initial-code.test/busy-cursor.js');
        const cursor = () => getComputedStyle(document.getElementById('code')).cursor;
        const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const seen: string[] = [];
        const loading = withWaitCursor([document], () => {
            seen.push(cursor());
            return 'project';
        }, {releaseAfterPaint: true});
        const result = await loading;
        seen.push(cursor());
        // The host renders the first code view only after the load promise settles.
        document.getElementById('code').textContent = result;
        await new Promise<void>(resolve => requestAnimationFrame(() => {seen.push(cursor()); resolve();}));
        await paint();
        const after = cursor();
        try {
            await withWaitCursor([document], () => {throw new Error('load failed');}, {releaseAfterPaint: true});
        } catch { /* Check cleanup after the failure continuation too. */ }
        await paint();
        return {seen, after, failure: cursor(), styles: document.querySelectorAll('[data-tw-plus-wait-cursor]').length};
    });
    assert.deepEqual(states.seen, ['wait', 'wait', 'wait']);
    assert.equal(states.after, 'auto');
    assert.equal(states.failure, 'auto');
    assert.equal(states.styles, 0);
});
