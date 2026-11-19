// SPDX-License-Identifier: MPL-2.0
import type {ProjectCatalogStore} from './project-catalog.js';
import {workspaceLayoutDatabase} from './workspace-layout-store.js';

/** Import existing handle history once per legacy record, without changing or creating a layout database. */
export async function importWorkspaceProjectHistory(store: ProjectCatalogStore, factory?: IDBFactory) {
    if (!factory) return;
    const records = await new Promise<any[]>((resolve, reject) => {
        const request = factory.open(workspaceLayoutDatabase);
        let missing = false;
        request.onupgradeneeded = () => {missing = true; request.transaction!.abort();};
        request.onerror = () => missing ? resolve([]) : reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('layouts')) {db.close(); resolve([]); return;}
            const transaction = db.transaction('layouts');
            const read = transaction.objectStore('layouts').getAll();
            transaction.oncomplete = () => {db.close(); resolve(read.result);};
            transaction.onerror = transaction.onabort = () => {db.close(); reject(transaction.error);};
        };
    });
    const known = await store.list(true);
    for (const record of records) {
        if (!Number.isSafeInteger(record.id) || !['file', 'directory'].includes(record.kind) || !record.handle ||
            typeof record.name !== 'string' || known.some(project => project.legacyLayoutId === record.id)) continue;
        let matched = false;
        for (const project of known) {
            try {if (project.handle && await record.handle.isSameEntry(project.handle)) {matched = true; break;}}
            catch { /* A missing resource can still have a legacy record, identified by its database id. */ }
        }
        if (matched) continue;
        const imported = await store.register({location: record.kind === 'file' ? 'file' : 'folder',
            title: record.kind === 'file' ? record.name.replace(/\.sb3$/i, '') : record.name,
            storageName: record.name, handle: record.handle, legacyLayoutId: record.id,
            lastOpenedAt: Number.isFinite(record.lastUsedAt) ? record.lastUsedAt : null}, false);
        known.push(imported);
    }
}
