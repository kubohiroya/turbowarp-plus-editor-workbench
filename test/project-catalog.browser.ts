import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';

async function setup(t, locale = 'ja') {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport: {width: 420, height: 740}});
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.route('http://localhost:41223/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (!name) return route.fulfill({contentType: 'text/html', body: '<!doctype html><button id="entry">Projects</button>'});
        if (!['project-catalog.js', 'project-catalog-dialog.js', 'project-catalog.css'].includes(name)) return route.abort();
        await route.fulfill({contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript',
            body: await readFile(new URL(`../${name.endsWith('.css') ? 'src' : 'dist'}/${name}`, import.meta.url), 'utf8')});
    });
    await page.goto('http://localhost:41223/');
    await page.evaluate(async locale => {
        const w = window as any;
        const {createProjectCatalogStore} = await import('http://localhost:41223/project-catalog.js');
        const {openProjectCatalog} = await import('http://localhost:41223/project-catalog-dialog.js');
        document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: '/project-catalog.css'}));
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle('work.sb3', {create: true});
        const store = createProjectCatalogStore();
        const sources = [
            {title: 'File', storageName: 'work.sb3', location: 'file', handle: file},
            {title: 'Folder', storageName: 'folder', location: 'folder'},
            {title: 'Browser', storageName: 'browser', location: 'browser', browserId: 'browser'},
            {title: 'Remote', storageName: 'remote', location: 'remote', remote: 'https://github.com/owner/repo.git'}
        ];
        for (const source of sources) await store.register(source);
        w.calls = [];
        w.failStorage = false;
        w.cancelOpen = false;
        const host = {store, async refresh() {}, operations(project) {
            return {
                async open() {w.calls.push(['open', project.id]); return w.cancelOpen ? null : project;},
                async renameProject(title) {w.calls.push(['renameProject', title]);},
                ...(project.location !== 'remote' && {async renameStorage(storageName) {
                    if (w.failStorage) throw new Error('Storage rename failed');
                    if (project.handle?.move) await project.handle.move(storageName);
                    return {storageName};
                }}),
                ...(project.location === 'browser' && {async deleteData() {w.calls.push(['delete', project.id]);}}),
                unavailable: project.location === 'remote' ? {renameStorage: 'Remote rename unavailable', deleteData: 'Remote delete unavailable'} : {}
            };
        }};
        w.store = store;
        w.reopen = () => openProjectCatalog(document, host, locale);
        document.getElementById('entry')!.addEventListener('click', w.reopen);
    }, locale);
    await page.locator('#entry').click();
    await expect(page.locator('[data-project-id]')).toHaveCount(4);
    await expect(page.locator('dialog')).toHaveAttribute('aria-busy', 'false');
    const row = (name: string) => page.locator('[data-project-id]').filter({has: page.locator('strong', {hasText: name})});
    return {page, row};
}

test('one catalog presents all four sources, keeps sorting, and forgets without deleting', async t => {
    const {page, row} = await setup(t);
    await page.locator('select[name=sort]').selectOption('title:asc');
    await expect(page.locator('[data-project-id] strong')).toHaveText(['Browser', 'File', 'Folder', 'Remote']);
    await page.emulateMedia({colorScheme: 'dark'});
    assert.equal(await page.locator('dialog').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await expect(row('Remote').locator('[data-catalog-action=rename-storage]')).toBeDisabled();
    await expect(row('Remote').locator('small')).toContainText('Remote rename unavailable');
    await row('Browser').locator('[data-catalog-action=forget]').click();
    await expect(page.locator('[data-project-id]')).toHaveCount(3);
    assert.equal(await page.evaluate(() => (window as any).calls.length), 0);
    await page.locator('[data-catalog-action=close]').click();
    await expect(page.locator('#entry')).toBeFocused();
    await page.locator('#entry').click();
    await expect(page.locator('select[name=sort]')).toHaveValue('title:asc');
    await expect(page.locator('[data-project-id]')).toHaveCount(3);
});

test('partial rename shows the successful title and actual storage name; cancellation does not touch usage', async t => {
    const {page, row} = await setup(t, 'en');
    await page.evaluate(() => {(window as any).failStorage = true;});
    await row('File').locator('[data-catalog-action=rename-title]').click();
    await page.locator('input[name=title]').fill('Renamed');
    await page.locator('input[name=both]').check();
    await page.locator('form button[type=submit]').click();
    await expect(page.getByRole('alert')).toContainText('Storage rename failed');
    await expect(row('Renamed')).toContainText('work.sb3');
    await page.locator('[data-catalog-action=cancel-rename]').click();
    const before = await page.evaluate(async () => (await (window as any).store.list()).find(x => x.title === 'Renamed').lastOpenedAt);
    await page.evaluate(() => {(window as any).cancelOpen = true;});
    await row('Renamed').locator('[data-catalog-action=open]').click();
    await expect(page.locator('dialog')).toHaveAttribute('aria-busy', 'false');
    const after = await page.evaluate(async () => (await (window as any).store.list()).find(x => x.title === 'Renamed').lastOpenedAt);
    assert.equal(after, before);
    await page.locator('[data-catalog-action=close]').click();
});

test('deleting saved data requires confirmation and only removes the selected resource', async t => {
    const {page, row} = await setup(t);
    page.once('dialog', dialog => dialog.dismiss());
    await row('Browser').locator('[data-catalog-action=delete]').click();
    await expect(page.locator('dialog')).toHaveAttribute('aria-busy', 'false');
    assert.deepEqual(await page.evaluate(() => (window as any).calls), []);
    page.once('dialog', dialog => dialog.accept());
    await row('Browser').locator('[data-catalog-action=delete]').click();
    await expect(page.locator('[data-project-id]')).toHaveCount(3);
    const calls = await page.evaluate(() => (window as any).calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'delete');
    await expect(row('Remote')).toHaveCount(1);
});
