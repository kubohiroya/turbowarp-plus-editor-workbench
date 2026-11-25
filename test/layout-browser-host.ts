// SPDX-License-Identifier: MPL-2.0
// Shared standalone host extracted from layout.browser.ts.
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TestContext} from 'node:test';
import {chromium, type Page} from '@playwright/test';

const require = createRequire(import.meta.url);
export const origin = 'http://layout.test';
export const example = '/example/index.html';
export const files = new Map([[example, fileURLToPath(new URL('../example/index.html', import.meta.url))]]);
files.set('/example/.build/layout.js', fileURLToPath(new URL('../example/.build/layout.js', import.meta.url)));
const source = fileURLToPath(new URL('../src/', import.meta.url));
for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.isFile() && /\.css$/.test(entry.name)) {
        files.set(`/src/${entry.name}`, path.join(source, entry.name));
    }
}
const built = fileURLToPath(new URL('../dist/', import.meta.url));
for (const entry of await readdir(built, {withFileTypes: true})) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
        files.set(`/dist/${entry.name}`, path.join(built, entry.name));
    }
}
const tileTitle = '@kubohiroya/turbowarp-plus-editor-sprite-panes/native-tile-title';
files.set(`/node_modules/${tileTitle.replace('native-tile-title', 'dist/native-tile-title.js')}`, require.resolve(tileTitle));
for (const name of ['react', 'react-dom']) {
    const entry = `/umd/${name}.development.js`;
    files.set('/node_modules/' + name + entry, path.join(path.dirname(require.resolve(name + '/package.json')), entry));
}

export async function openExample(t: TestContext): Promise<Page> {
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 900, height: 600}});
    await page.route(origin + '/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        const filename = files.get(pathname);
        if (!filename) return route.fulfill({status: 404});
        return route.fulfill({
            body: await readFile(filename),
            contentType: pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : 'application/javascript'
        });
    });
    return page;
}

