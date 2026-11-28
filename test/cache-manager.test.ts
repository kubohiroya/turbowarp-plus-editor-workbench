import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createIndexedDBContentCache} from '@kubohiroya/turbowarp-extension-loader/indexeddb-cache';
import {createExtensionCache} from '@kubohiroya/turbowarp-title-menu/composition';
import {createCacheManager} from '../dist/cache-manager.js';

const digest = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !until(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(until());
};

test('the cache manager lists and releases the Loader cache, then closes it and returns focus', async t => {
    const dom = new JSDOM('<body><button id="plus">Plus</button></body>', {pretendToBeVisual: true});
    const document = dom.window.document;
    const indexedDB = new IDBFactory();
    const bytes = new TextEncoder().encode('<svg/>');
    const key = await digest(bytes);
    for (const uri of ['https://example.test/projects/a', 'https://example.test/projects/b']) {
        const writer = createIndexedDBContentCache({indexedDB, appURI: () => uri});
        await writer.put(key, bytes, {label: {ref: 'costume:cat', kind: 'costume', name: uri.endsWith('a') ? 'cat.svg' : 'kitten.svg'}});
        await writer.close();
    }
    let opened = 0;
    let closed = 0;
    const manager = createCacheManager({document, createCache() {
        opened++;
        const cache = createExtensionCache({indexedDB});
        return {...cache, async close() { closed++; await cache.close(); }};
    }});
    t.after(() => { manager.dispose(); dom.window.close(); });

    const plus = document.getElementById('plus')!;
    await manager.open({locale: 'ja-JP', colorScheme: 'dark', returnFocus: plus});
    const root = document.querySelector<HTMLElement>('[data-turbowarp-title-menu-cache-manager]')!;
    assert.equal(manager.isOpen, true);
    assert.equal(root.getAttribute('data-color-scheme'), 'dark');
    assert.equal(document.activeElement, root.querySelector('[data-cache-search]'));
    const rows = () => [...root.querySelectorAll('[data-cache-row]')];
    assert.equal(rows().length, 2);
    assert.match(root.textContent!, /cat\.svg/);
    assert.match(root.textContent!, /kitten\.svg/);

    // Releasing one project's use keeps the copy the other project still claims.
    (rows()[0].querySelector('[data-cache-select]') as HTMLInputElement).click();
    (root.querySelector('[data-cache-release]') as HTMLElement).click();
    (root.querySelector('[data-cache-confirm]') as HTMLElement).click();
    await settle(() => rows().length === 1);

    root.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await settle(() => !manager.isOpen);
    assert.equal(root.style.display, 'none');
    assert.equal(document.activeElement, plus);
    assert.equal(closed, opened);

    // Opening again reads the store anew in English and the light scheme.
    await manager.open({locale: 'en', colorScheme: 'light'});
    assert.equal(root.getAttribute('data-color-scheme'), 'light');
    assert.equal(rows().length, 1);
    assert.equal(opened, 2);
    manager.dispose();
    assert.equal(document.querySelector('[data-turbowarp-title-menu-cache-manager]'), null);
    assert.equal(closed, opened);
});

test('embedding passes the open project rows to its payload host and releases only after a save', async t => {
    const dom = new JSDOM('<body></body>', {pretendToBeVisual: true});
    const document = dom.window.document;
    const indexedDB = new IDBFactory();
    const bytes = new TextEncoder().encode('<svg id="sky"/>');
    const key = await digest(bytes);
    const mine = 'https://example.test/projects/mine';
    for (const uri of [mine, 'https://example.test/projects/other']) {
        const writer = createIndexedDBContentCache({indexedDB, appURI: () => uri});
        await writer.put(key, bytes, {label: {ref: 'assets:sky.svg', kind: 'backdrop', name: 'Sky'}});
        await writer.close();
    }
    const applied: unknown[] = [];
    const released: unknown[] = [];
    let markSaved: (saved: boolean) => void = () => {};
    const project = {
        bucket: () => mine,
        title: () => 'My story',
        whenSaved: () => new Promise<boolean>(resolve => { markSaved = resolve; }),
        payloads: {
            cacheEmbedding: () => ({async apply(digests: readonly string[], options: unknown) {
                applied.push([digests, options]);
                return {embedded: [{}], skipped: [], releasable: [...digests]};
            }}),
            async releaseAfterSave(digests: readonly string[]) {
                released.push(digests);
                return {released: 1, freed: 20, kept: []};
            }
        }
    };
    const manager = createCacheManager({document, createCache: () => createExtensionCache({indexedDB, titleFor: bucket =>
        bucket === mine ? project.title() : undefined})});
    t.after(() => { manager.dispose(); dom.window.close(); });
    await manager.open({locale: 'en', project});
    const root = document.querySelector<HTMLElement>('[data-turbowarp-title-menu-cache-manager]')!;
    assert.match(root.textContent!, /My story/);
    (root.querySelector('[data-cache-select-all]') as HTMLElement).click();
    assert.match(root.querySelector('[data-cache-embed-others]')!.textContent!, /1 selected belong to other projects/);
    (root.querySelector('[data-cache-embed-release]') as HTMLElement).click();
    await settle(() => /Embedded 1 of 1/.test(root.textContent!));
    assert.deepEqual(applied, [[[key], {format: 'embedded-file'}]]);
    assert.deepEqual(released, []);

    markSaved(true);
    await settle(() => released.length === 1);
    assert.deepEqual(released, [[key]]);
    await settle(() => /The project was saved: released 1/.test(root.textContent!));
});
