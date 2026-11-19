import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {createProjectCatalogStore, renameCatalogProject, sortCatalog} from '../dist/project-catalog.js';
import type {CatalogHost, CatalogSource} from '../dist/project-catalog.js';
import {createWorkspaceLayoutStore} from '../dist/workspace-layout-store.js';
import {importWorkspaceProjectHistory} from '../dist/project-catalog-migration.js';

class Handle {
    kind = 'file' as const;
    name: string;
    resource: string;
    constructor(name: string, resource: string) {this.name = name; this.resource = resource;}
    async isSameEntry(other: Handle) {return this.resource === other.resource;}
}
const file = (resource: string, name = 'Same.sb3'): CatalogSource => ({title: 'Same', storageName: name, location: 'file',
    handle: new Handle(name, resource) as unknown as FileSystemFileHandle});
const setup = () => {
    const indexedDB = new IDBFactory(); let clock = 0; let id = 0;
    const options = {indexedDB, now: () => ++clock, id: () => String(++id)};
    return {store: createProjectCatalogStore(options), again: () => createProjectCatalogStore(options)};
};

test('persists separate same-name resources and recognises a renamed handle', async () => {
    const {store, again} = setup();
    const first = await store.register(file('/a'));
    await store.register(file('/b'));
    const renamed = await store.register(file('/a', 'Renamed.sb3'));
    assert.equal(renamed.id, first.id);
    assert.equal(renamed.storageName, 'Renamed.sb3');
    assert.equal((await again().list()).length, 2);
    assert.equal(renamed.lastOpenedAt, 3);
});

test('import does not fabricate a usage time or restore a forgotten browser project', async () => {
    const {store, again} = setup();
    const source: CatalogSource = {location: 'browser', browserId: 'a', storageName: 'Folder', title: 'Project'};
    const imported = await store.register(source, false);
    assert.equal(imported.lastOpenedAt, null);
    await store.forget(imported.id);
    await again().register({...source, storageName: 'Externally renamed'}, false);
    assert.deepEqual(await store.list(), []);
    assert.equal((await store.list(true))[0].storageName, 'Externally renamed');
    const opened = await store.register(source);
    assert.equal(opened.id, imported.id);
    assert.equal(opened.hidden, false);
    assert.equal(opened.lastOpenedAt, 1);
});

test('two store instances registering at once do not duplicate a handle', async () => {
    const {store, again} = setup();
    await Promise.all([store.register(file('/a')), again().register(file('/a'))]);
    assert.equal((await store.list()).length, 1);
});

test('worktrees with the same remote are distinct; reopening replaces only the selected endpoint', async () => {
    const {store} = setup();
    const remote = 'https://github.com/owner/project.git';
    const a = await store.register({...file('/a'), remote});
    await store.register({...file('/b'), remote});
    const remoteOnly = await store.register({location: 'remote', title: 'Remote', storageName: 'project', remote});
    await store.register({...file('/new'), remote}, true, remoteOnly.id);
    assert.equal((await store.list()).length, 3);
    assert.equal((await store.list()).find(item => item.id === a.id)?.handle?.name, 'Same.sb3');
});

test('sort order survives recreation, uses stable ties and leaves missing usage times last', async () => {
    const {store, again} = setup();
    const unopened = await store.register({...file('/zero'), title: 'Zero'}, false);
    const a = await store.register({...file('/a'), title: 'A 10'});
    const b = await store.register({...file('/b'), title: 'A 2'});
    await store.sort({by: 'title', direction: 'asc'});
    const records = await store.list();
    assert.deepEqual(sortCatalog(records, await again().sort()).map(x => x.id), [b.id, a.id, unopened.id]);
    assert.deepEqual(sortCatalog(records, {by: 'lastOpenedAt', direction: 'asc'}).map(x => x.id), [a.id, b.id, unopened.id]);
    assert.deepEqual(sortCatalog(records, {by: 'lastOpenedAt', direction: 'desc'}).map(x => x.id), [b.id, a.id, unopened.id]);
    assert.deepEqual(records.map(x => x.id), [unopened.id, a.id, b.id]);
});

test('a failed second rename retains the successful project title and the old storage name', async () => {
    const {store} = setup();
    const project = await store.register(file('/a'));
    const host: CatalogHost = {store, async refresh() {}, operations: () => ({async open() {return null;},
        async renameProject() {}, async renameStorage() {throw new Error('name already exists');}})};
    await assert.rejects(renameCatalogProject(host, project, {title: 'New', storageName: 'New.sb3'}), /already exists/);
    const saved = (await store.list())[0];
    assert.equal(saved.title, 'New');
    assert.equal(saved.storageName, 'Same.sb3');
});

test('a combined rename uses the newly selected handle after reopening a missing file', async () => {
    const {store} = setup();
    const project = await store.register(file('/old'));
    let renamed: unknown;
    const host: CatalogHost = {store, async refresh() {}, operations: record => ({async open() {return null;},
        async renameProject() {await store.update(record.id, {handle: file('/replacement').handle});},
        async renameStorage(storageName) {renamed = (record.handle as unknown as Handle).resource; return {storageName};}})};
    await renameCatalogProject(host, project, {title: 'New', storageName: 'New.sb3'});
    assert.equal(renamed, '/replacement');
});

test('unavailable rename and failed writes do not change the catalog', async () => {
    const {store} = setup();
    const project = await store.register(file('/a'));
    const host: CatalogHost = {store, async refresh() {}, operations: () => ({async open() {return null;}})};
    await assert.rejects(renameCatalogProject(host, project, {title: 'New'}), /unavailable/);
    await assert.rejects(renameCatalogProject(host, project, {title: ' '}), /Invalid/);
    assert.equal((await store.list())[0].title, 'Same');
    await store.remove(project.id);
    assert.deepEqual(await store.list(), []);
});

test('imports layout handles without restoring forgotten projects or anonymous entries', async () => {
    const indexedDB = new IDBFactory();
    const layouts = createWorkspaceLayoutStore({indexedDB, now: () => 42});
    const handle = new Handle('Old.sb3', '/legacy') as unknown as FileSystemHandle;
    await (await layouts.open({kind: 'file', name: 'Old.sb3', handle}, '')).write('tabs', '');
    await (await layouts.open({kind: 'anonymous', name: 'Not saved'}, '')).write('tabs', '');
    const store = createProjectCatalogStore({indexedDB});
    await importWorkspaceProjectHistory(store, indexedDB);
    const [project] = await store.list();
    assert.equal(project.title, 'Old');
    assert.equal(project.lastOpenedAt, 42);
    assert.equal((await store.list()).length, 1);
    await store.update(project.id, {title: 'Renamed'});
    await store.forget(project.id);
    await importWorkspaceProjectHistory(store, indexedDB);
    assert.equal((await store.list(true)).length, 1);
    assert.equal((await store.list(true))[0].title, 'Renamed');
    assert.deepEqual(await store.list(), []);
});
