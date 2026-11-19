// SPDX-License-Identifier: MPL-2.0
/** A catalog entry identifies a saved resource; its title never serves as its identity. */
export interface CatalogProject {
    id: string;
    title: string;
    storageName: string;
    location: 'file' | 'folder' | 'browser' | 'remote';
    handle?: FileSystemFileHandle | FileSystemDirectoryHandle;
    repositoryRoot?: FileSystemDirectoryHandle;
    browserId?: string;
    remote?: string;
    legacyLayoutId?: number;
    lastOpenedAt: number | null;
    hidden?: boolean;
}
export type CatalogSource = Omit<CatalogProject, 'id' | 'lastOpenedAt' | 'hidden'> & {lastOpenedAt?: number | null};
export type CatalogSort = {by: 'title' | 'lastOpenedAt' | 'location'; direction: 'asc' | 'desc'};
export interface ProjectCatalogStore {
    list(includeHidden?: boolean): Promise<CatalogProject[]>;
    register(source: CatalogSource, opened?: boolean, entryId?: string): Promise<CatalogProject>;
    update(id: string, changes: Partial<Pick<CatalogProject, 'title' | 'storageName' | 'handle' | 'remote'>>): Promise<void>;
    forget(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    sort(value?: CatalogSort): Promise<CatalogSort>;
}

export const projectCatalogDatabase = 'twPlusProjectCatalog';
const defaultSort: CatalogSort = {by: 'lastOpenedAt', direction: 'desc'};
const queues = new WeakMap<IDBFactory, Promise<unknown>>();
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
const finished = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Catalog write failed'));
});
const isSort = (value: any): value is CatalogSort => value &&
    ['title', 'lastOpenedAt', 'location'].includes(value.by) && ['asc', 'desc'].includes(value.direction);

/** Sorting never changes a caller's array; missing usage times stay last in either direction. */
export function sortCatalog(projects: readonly CatalogProject[], order: CatalogSort, locale = 'en') {
    const compare = new Intl.Collator(locale, {numeric: true, sensitivity: 'base'}).compare;
    return [...projects].sort((a, b) => {
        if (order.by === 'lastOpenedAt' && (a.lastOpenedAt === null || b.lastOpenedAt === null)) {
            if (a.lastOpenedAt !== b.lastOpenedAt) return a.lastOpenedAt === null ? 1 : -1;
        }
        const primary = order.by === 'lastOpenedAt' ? (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0) :
            compare(a[order.by], b[order.by]);
        return primary * (order.direction === 'asc' ? 1 : -1) || compare(a.title, b.title) || a.id.localeCompare(b.id);
    });
}

/** Persist handles by structured clone. The lock covers async handle comparisons outside IDB transactions. */
export function createProjectCatalogStore({indexedDB = globalThis.indexedDB, locks = globalThis.navigator?.locks,
    now = Date.now, id = () => globalThis.crypto.randomUUID()}: {
    indexedDB?: IDBFactory; locks?: LockManager; now?(): number; id?(): string;
} = {}): ProjectCatalogStore {
    let opened: Promise<IDBDatabase> | undefined;
    const database = () => opened ??= new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error('IndexedDB is unavailable'));
        const request = indexedDB.open(projectCatalogDatabase, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('projects', {keyPath: 'id'});
            request.result.createObjectStore('preferences');
        };
        request.onerror = () => {opened = undefined; reject(request.error);};
        request.onsuccess = () => {
            request.result.onversionchange = () => {request.result.close(); opened = undefined;};
            resolve(request.result);
        };
    });
    const all = async () => {
        const tx = (await database()).transaction('projects');
        const done = finished(tx);
        const records = await result(tx.objectStore('projects').getAll()) as CatalogProject[];
        await done;
        return records;
    };
    const write = async (record: CatalogProject | string) => {
        const tx = (await database()).transaction('projects', 'readwrite');
        const done = finished(tx);
        const table = tx.objectStore('projects');
        if (typeof record === 'string') table.delete(record); else table.put(record);
        await done;
    };
    const serial = <T>(run: () => Promise<T>): Promise<T> => {
        if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'));
        const pending = (queues.get(indexedDB) ?? Promise.resolve()).catch(() => {}).then(() =>
            locks ? locks.request('tw-plus-project-catalog', run) : run()) as Promise<T>;
        queues.set(indexedDB, pending.catch(() => {}));
        return pending;
    };
    const change = (key: string, update: (record: CatalogProject) => CatalogProject) => serial(async () => {
        const record = (await all()).find(record => record.id === key);
        if (!record) throw new Error('The project is no longer in the catalog');
        await write(update(record));
    });
    return {
        async list(includeHidden = false) {return (await all()).filter(record => includeHidden || !record.hidden);},
        register(source, opened = true, entryId) {return serial(async () => {
            const records = await all();
            let existing = entryId ? records.find(record => record.id === entryId) : undefined;
            for (const record of existing ? [] : records) {
                if (source.legacyLayoutId !== undefined && record.legacyLayoutId === source.legacyLayoutId) {existing = record; break;}
                if (source.browserId && record.browserId === source.browserId) {existing = record; break;}
                if (source.handle && record.handle) {
                    try {if (await source.handle.isSameEntry(record.handle)) {existing = record; break;}} catch { /* Stale handle. */ }
                }
                // A remote-only entry has no worktree yet. Distinct worktrees of one remote stay distinct.
                if (source.location === 'remote' && record.location === 'remote' && record.remote === source.remote) {
                    existing = record; break;
                }
            }
            const record: CatalogProject = {...existing, ...source, id: existing?.id ?? id(),
                hidden: opened ? false : existing?.hidden ?? false,
                lastOpenedAt: opened ? now() : existing?.lastOpenedAt ?? source.lastOpenedAt ?? null};
            await write(record);
            return record;
        });},
        update(key, changes) {return change(key, record => ({...record, ...changes}));},
        forget(key) {return change(key, record => ({...record, hidden: true}));},
        remove(key) {return serial(() => write(key));},
        async sort(value) {
            if (value && !isSort(value)) throw new Error('Invalid catalog order');
            const tx = (await database()).transaction('preferences', value ? 'readwrite' : 'readonly');
            const done = finished(tx);
            const table = tx.objectStore('preferences');
            const saved = value ? (table.put(value, 'sort'), value) : await result(table.get('sort'));
            await done;
            return isSort(saved) ? saved : {...defaultSort};
        }
    };
}

export interface CatalogOperations {
    open(): Promise<CatalogSource | null>;
    renameProject?(title: string): Promise<void>;
    renameStorage?(name: string): Promise<Partial<Pick<CatalogProject, 'storageName' | 'handle' | 'remote'>>>;
    deleteData?(): Promise<void>;
    unavailable?: Partial<Record<'renameProject' | 'renameStorage' | 'deleteData', string>>;
}
export interface CatalogHost {
    store: ProjectCatalogStore;
    refresh(): Promise<void>;
    operations(project: CatalogProject): CatalogOperations;
}

/** Persist each successful step immediately, so a later failure cannot invent an atomic rename. */
export async function renameCatalogProject(host: CatalogHost, project: CatalogProject,
    names: {title?: string; storageName?: string}) {
    if (names.title !== undefined && (!names.title.trim() || names.title.length > 100)) throw new Error('Invalid project name');
    if (names.storageName !== undefined && (!names.storageName.trim() || names.storageName.length > 200)) throw new Error('Invalid storage name');
    const actions = host.operations(project);
    if (names.title !== undefined && !actions.renameProject || names.storageName !== undefined && !actions.renameStorage) {
        throw new Error('This rename is unavailable');
    }
    if (names.title !== undefined) {
        await actions.renameProject!(names.title);
        await host.store.update(project.id, {title: names.title});
    }
    if (names.storageName !== undefined) {
        const current = (await host.store.list(true)).find(entry => entry.id === project.id);
        if (!current) throw new Error('The project is no longer in the catalog');
        const rename = host.operations(current).renameStorage;
        if (!rename) throw new Error('This storage rename is unavailable');
        const changes = await rename(names.storageName);
        await host.store.update(project.id, changes);
    }
}
