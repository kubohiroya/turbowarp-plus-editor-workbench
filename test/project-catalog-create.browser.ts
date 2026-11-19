import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

for (const locale of ['ja', 'en']) test(`an empty ${locale} catalog opens the existing creation dialog without changing the project`,
    {timeout: 30000}, async t => {
        const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
            export {openProjectCatalog} from './dist/project-catalog-dialog.js';
            export {openNewProjectDialog} from './dist/project-file-dialogs.js';`},
        bundle: true, write: false, format: 'iife', globalName: 'catalogCreate', target: 'es2022'});
        const css = await readFile(new URL('../src/project-catalog.css', import.meta.url), 'utf8');
        const browser = await chromium.launch({headless: true});
        t.after(() => browser.close());
        const page = await browser.newPage({viewport: {width: 420, height: 740}});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://localhost:41226/**', route => route.fulfill({contentType: 'text/html',
            body: '<!doctype html><button id="entry">Projects</button>'}));
        await page.goto('http://localhost:41226/');
        await page.addStyleTag({content: css});
        await page.addScriptTag({content: bundled.outputFiles[0].text});
        await page.evaluate(locale => {
            const w = window as any;
            w.currentProject = {title: 'Existing project', dirty: true};
            w.requests = [];
            w.creationOpens = 0;
            w.openCatalog = (hold = false) => w.catalogCreate.openProjectCatalog(document, {
                store: {async list() {return [];}, async sort() {return {by: 'lastOpenedAt', direction: 'desc'};}},
                refresh: () => hold ? new Promise<void>(resolve => {w.release = resolve;}) : Promise.resolve(),
                operations() {throw new Error('An empty catalog has no resource operations');},
                createProject() {
                    w.creationOpens++;
                    if (document.querySelector('[data-project-catalog]')) throw new Error('Catalog must close first');
                    void w.catalogCreate.openNewProjectDialog(document, locale, {
                        defaultTitle: 'New game', browserFolders: true,
                        create() {w.requests.push({destination: 'memory'});},
                        async createIn(request) {w.requests.push(request); return 'created';}
                    });
                }
            }, locale);
            document.getElementById('entry')!.onclick = () => w.openCatalog();
            w.openCatalog(true);
        }, locale);
        const create = page.getByRole('button', {name: locale === 'ja' ? '新しいプロジェクトを作成…' : 'Create New Project…', exact: true});
        await expect(create).toBeDisabled();
        await create.evaluate((element: HTMLButtonElement) => element.click());
        assert.equal(await page.evaluate(() => (window as any).creationOpens), 0);
        await page.evaluate(() => (window as any).release());
        await expect(create).toBeEnabled();
        assert.equal(await page.locator('[data-project-catalog]').evaluate(node => node.scrollWidth <= node.clientWidth), true);
        const originalButton = await create.elementHandle();
        await create.click();
        await originalButton!.evaluate((element: HTMLButtonElement) => element.click());
        await expect(page.locator('[data-project-catalog]')).toHaveCount(0);
        const dialog = page.locator('[data-new-project-dialog]');
        await expect(dialog).toBeVisible();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(dialog.locator('input[name=destination][value=memory]')).toBeFocused();
        assert.equal(await page.evaluate(() => (window as any).creationOpens), 1);
        assert.deepEqual(await page.evaluate(() => (window as any).currentProject), {title: 'Existing project', dirty: true});
        await dialog.locator('[data-new-project-cancel]').click();
        await expect(dialog).toHaveCount(0);
        assert.deepEqual(await page.evaluate(() => (window as any).requests), []);
        await page.locator('#entry').click();
        await expect(create).toBeEnabled();
        await create.click();
        await dialog.locator('input[name=destination][value=browser]').check();
        await expect(dialog.locator('input[name=title]')).toHaveValue('New game');
        const saveName = await dialog.locator('input[name=save-name]').inputValue();
        await dialog.locator('button[type=submit]').click();
        await expect(dialog).toHaveCount(0);
        assert.deepEqual(await page.evaluate(() => (window as any).requests),
            [{destination: 'browser', title: 'New game', saveName}]);
        assert.deepEqual(errors, []);
    });
