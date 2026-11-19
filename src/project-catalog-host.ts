// SPDX-License-Identifier: MPL-2.0
import type {BrowserProjects} from '@kubohiroya/turbowarp-plus-editor-project-folder';
import {flushPendingSurfaceEdits} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';
import {createProjectCatalogStore} from './project-catalog.js';
import type {CatalogHost, CatalogOperations, CatalogProject, CatalogSource, ProjectCatalogStore} from './project-catalog.js';
import {openProjectCatalog} from './project-catalog-dialog.js';
import {importWorkspaceProjectHistory} from './project-catalog-migration.js';
import type {ProjectFileStorage} from './project-file-dialogs.js';
import {withProjectSerialization} from '@kubohiroya/turbowarp-extension-loader/scratch-vm';
import {PROJECT_INFO_KEY} from './project-tools/properties.js';

export interface CatalogFolder {
    readonly directory: FileSystemDirectoryHandle | null;
    readonly root: FileSystemDirectoryHandle | null;
    browserProjects: BrowserProjects | null;
    openDirectory(directory: FileSystemDirectoryHandle, confirm: () => boolean,
        root?: FileSystemDirectoryHandle): Promise<string>;
    save(): Promise<unknown>;
    detach(): void;
}
export interface CatalogFolderPorts {
    folder: CatalogFolder;
    readRemote?(root: FileSystemDirectoryHandle): Promise<string | undefined>;
    openRemote?(locale: string, remote?: string): Promise<boolean>;
}
export interface CatalogRuntimePorts {
    document: Document;
    vm: any;
    readFile(): FileSystemFileHandle | null;
    isDirty(): boolean;
    properties: {snapshot(): {title: string; loading?: boolean; readOnly?: boolean};
        loadedTitle?(): string | undefined;
        apply(draft: {title: string}): unknown; subscribe(listener: () => void): () => void;
        loadState(): {phase: string; sequence: number}};
    subscribeLocation?(listener: () => void): () => void;
    report?(error: unknown): void;
    store?: ProjectCatalogStore;
}
type PermissionHandle = FileSystemHandle & {queryPermission?(options: {mode: string}): Promise<string>;
    requestPermission?(options: {mode: string}): Promise<string>};
type MutableHandle = (FileSystemFileHandle | FileSystemDirectoryHandle) & {
    move?(name: string): Promise<void>;
    remove?(options?: {recursive?: boolean}): Promise<void>;
};
async function permission(handle: FileSystemHandle, mode: 'read' | 'readwrite') {
    const access = handle as PermissionHandle;
    if (!access.queryPermission || await access.queryPermission({mode}) === 'granted') return;
    if (!access.requestPermission || await access.requestPermission({mode}) !== 'granted') {
        throw new DOMException('Permission was not granted', 'NotAllowedError');
    }
}
const same = async (a?: FileSystemHandle | null, b?: FileSystemHandle | null) => {
    try {return Boolean(a && b && await a.isSameEntry(b));} catch {return false;}
};

/** Connects native resources to the catalog without importing GUI code or changing the saved project format. */
export function createProjectCatalogRuntime(ports: CatalogRuntimePorts) {
    const {document, vm, properties} = ports;
    const view = document.defaultView!;
    const store = ports.store ?? createProjectCatalogStore({indexedDB: view.indexedDB, locks: view.navigator.locks});
    let folders: CatalogFolderPorts | undefined;
    let storage: ProjectFileStorage | undefined;
    let activeId: string | undefined;
    let alive = true;
    let performing = false;
    let selectedFile: {file: File; sequence: number} | undefined;
    let observedSequence = -1;
    let observedFile: FileSystemFileHandle | null = null;
    let timer: number | undefined;
    let dialog: (() => void) | undefined;
    let tracking = Promise.resolve();
    const report = (error: unknown) => ports.report?.(error);
    const title = () => properties.snapshot().title;
    const askReplace = (locale: string) => !ports.isDirty() || view.confirm(locale.startsWith('ja') ?
        '現在の作品に未保存の変更があります。選んだ作品を開きますか？' :
        'The current project has unsaved changes. Open the selected project?');
    const source = async (fallback?: CatalogProject): Promise<CatalogSource | null> => {
        const folder = folders?.folder;
        const handle = folder?.directory ?? ports.readFile();
        if (!handle) return fallback?.location === 'file' ? {...fallback, title: title() || fallback.title} : null;
        const browser = handle.kind === 'directory' && folder?.browserProjects ? await folder.browserProjects.find(handle) : null;
        const remote = handle.kind === 'directory' ? await folders?.readRemote?.(folder?.root ?? handle).catch(() => undefined) : undefined;
        return {location: browser ? 'browser' : handle.kind === 'file' ? 'file' : 'folder',
            title: title() || browser?.title || handle.name, storageName: browser?.title ?? handle.name,
            handle, repositoryRoot: handle.kind === 'directory' ? folder?.root ?? undefined : undefined,
            browserId: browser?.id, remote};
    };
    const capture = () => {
        const load = properties.loadState();
        const file = ports.readFile();
        if (!alive || performing || properties.snapshot().loading || load.phase === 'failed') return;
        if (load.sequence === observedSequence && file === observedFile) return;
        observedSequence = load.sequence; observedFile = file;
        if (load.phase !== 'loaded') return;
        const selection = selectedFile?.sequence === load.sequence ? selectedFile.file : undefined;
        tracking = tracking.catch(() => {}).then(async () => {
            if (!alive || performing) return;
            const input = await source() ?? (selection ? {location: 'file' as const, title: title() || selection.name,
                storageName: selection.name} : null);
            if (input) activeId = (await store.register(input)).id;
            else activeId = undefined;
        }).catch(report);
    };
    const schedule = () => {
        if (!alive) return;
        view.clearTimeout(timer);
        // Folder onOpened and the GUI's upload completion publish their location after loadProject resolves.
        timer = view.setTimeout(capture, 0);
    };
    const stopLoad = properties.subscribe(schedule);
    const stopLocation = ports.subscribeLocation?.(schedule);
    const withAction = async <T>(run: () => Promise<T>): Promise<T> => {
        if (performing) throw new Error('Another project operation is in progress');
        performing = true;
        try {await tracking; return await run();}
        finally {
            performing = false; observedSequence = properties.loadState().sequence; observedFile = ports.readFile();
        }
    };
    const chooseFile = (project: CatalogProject): Promise<{file: File; handle?: FileSystemFileHandle} | null> => {
        const picker = (view as Window & {showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>}).showOpenFilePicker;
        if (picker) return picker({multiple: false, types: [{description: project.storageName, accept: {'*/*': ['.sb3']}}]})
            .then(async ([handle]) => ({handle, file: await handle.getFile()}));
        return new Promise(resolve => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.sb3'; input.hidden = true;
            const finish = (value: {file: File} | null) => {input.remove(); resolve(value);};
            input.addEventListener('change', () => finish(input.files?.[0] ? {file: input.files[0]} : null), {once: true});
            input.addEventListener('cancel', () => finish(null), {once: true});
            document.body.append(input); input.click();
        });
    };
    const open = async (project: CatalogProject, locale: string): Promise<CatalogSource | null> => {
        await flushPendingSurfaceEdits();
        const folder = folders?.folder;
        if (project.location === 'remote' || (!project.handle && project.remote && project.location !== 'browser')) {
            if (!folders?.openRemote || !await folders.openRemote(locale, project.remote)) return null;
        } else if (project.location === 'browser' || project.handle?.kind === 'directory') {
            if (!folder) throw new Error('Project folders are unavailable');
            const directory = project.browserId ? await folder.browserProjects?.root(project.browserId) : project.handle;
            if (!directory) {
                if (project.remote && folders?.openRemote && await folders.openRemote(locale, project.remote)) return source(project);
                throw new DOMException('The saved folder no longer exists', 'NotFoundError');
            }
            await permission(directory, 'read');
            if (project.browserId) await folder.browserProjects!.moveProjectToRoot(project.browserId);
            if (await folder.openDirectory(directory as FileSystemDirectoryHandle, () => askReplace(locale),
                project.repositoryRoot) !== 'opened') return null;
        } else {
            if (!askReplace(locale)) return null;
            let handle = project.handle as FileSystemFileHandle | undefined;
            let file: File;
            if (handle) {
                await permission(handle, 'read');
                try {file = await handle.getFile();}
                catch (error) {
                    if ((error as {name?: string}).name !== 'NotFoundError') throw error;
                    const chosen = await chooseFile(project);
                    if (!chosen) return null;
                    file = chosen.file; handle = chosen.handle;
                }
            }
            else {
                const chosen = await chooseFile(project);
                if (!chosen) return null;
                file = chosen.file; handle = chosen.handle;
            }
            if (!storage) throw new Error('File loading is unavailable');
            vm.quit();
            await vm.loadProject(await file.arrayBuffer(), {replaceLegacyExtensions: true});
            folder?.detach();
            storage.finish(handle ?? null, properties.loadedTitle?.() || file.name.replace(/\.sb3$/i, ''), true);
            vm.renderer?.draw();
            activeId = project.id;
            return {location: 'file', title: title() || project.title, storageName: file.name, handle};
        }
        activeId = project.id;
        return source(project);
    };
    const ensureOpen = async (project: CatalogProject, locale: string) => {
        if (activeId === project.id && (await same(project.handle, folders?.folder.directory ?? ports.readFile()) ||
            project.location === 'file' && !project.handle)) return true;
        const opened = await open(project, locale);
        if (!opened) return false;
        await store.register(opened, true, project.id);
        return true;
    };
    const operations = (project: CatalogProject, locale: string): CatalogOperations => {
        const ja = locale.startsWith('ja');
        const handle = project.handle as MutableHandle | undefined;
        const browser = project.browserId && folders?.folder.browserProjects;
        const noStorage = ja ? 'この保存先では名前変更・削除を実行できません。' :
            'This storage does not support renaming or deleting the saved resource.';
        const remoteNote = ja ? 'GitHubのリポジトリ名変更は別途対応が必要です（#681）。' :
            'Renaming the repository on GitHub requires the rename support tracked in #681.';
        const unsupported: CatalogOperations['unavailable'] = {renameStorage: project.location === 'remote' ? remoteNote : noStorage,
            deleteData: project.location === 'remote' ? (ja ? 'リモートの登録は「一覧から除外」で解除できます。' :
                'Use Remove from List to forget a remote repository.') : noStorage};
        if (browser || handle?.move) delete unsupported.renameStorage;
        const canDelete = Boolean((browser || handle?.remove) && activeId !== project.id);
        if (canDelete) delete unsupported.deleteData;
        else if (activeId === project.id) unsupported.deleteData = ja ?
            '別の作品を開いてから、この保存データを削除してください。' : 'Open another project before deleting this saved project.';
        let canRenameProject = project.location !== 'file' || Boolean(handle ||
            (view as Window & {showOpenFilePicker?: unknown}).showOpenFilePicker);
        if (!canRenameProject) unsupported.renameProject = ja ?
            'このブラウザーでは元のSB3ファイルへ書き戻せません。開いてからコピーを保存できます。' :
            'This browser cannot overwrite the original SB3 file. Open it and save a copy instead.';
        if (activeId === project.id && properties.snapshot().readOnly) {
            canRenameProject = false;
            unsupported.renameProject = ja ? 'この作品の情報は読み取り専用です。' : 'This project information is read-only.';
        }
        return {
            unavailable: {...unsupported},
            open: () => withAction(() => open(project, locale)),
            ...canRenameProject && {renameProject: (nextTitle: string) => withAction(async () => {
                if (!await ensureOpen(project, locale)) throw new DOMException('Cancelled', 'AbortError');
                await flushPendingSurfaceEdits();
                const stage = vm.runtime.getTargetForStage();
                const current = () => stage === vm.runtime.getTargetForStage();
                properties.apply({title: nextTitle});
                if (folders?.folder.directory) await folders.folder.save();
                else {
                    const file = ports.readFile();
                    if (!storage || !file) throw new Error(ja ? '名前を保存するにはSB3ファイルの保存先を選択してください。' :
                        'Select a writable SB3 file to save the project title.');
                    await permission(file, 'readwrite');
                    let commit: (() => void) | undefined;
                    let edited = false;
                    const changed = () => {edited = true;};
                    vm.on?.('PROJECT_CHANGED', changed);
                    try {
                        await storage.write(file, run => withProjectSerialization(vm, {deferCommit: action => {commit = action;}}, run), current);
                        if (!current()) throw new DOMException('The project changed', 'AbortError');
                        commit?.();
                        storage.finish(file, nextTitle, !edited);
                    } finally {vm.off?.('PROJECT_CHANGED', changed);}
                }
            })},
            ...(browser || handle?.move ? {renameStorage: (name: string) => withAction(async () => {
                if (!name.trim() || /[\\/\u0000-\u001f]/u.test(name) || name === '.' || name === '..') {
                    throw new Error(ja ? '保存先の名前に使えない文字が含まれています。' : 'The storage name is invalid.');
                }
                if (handle?.kind === 'file' && !/\.sb3$/i.test(name)) name += '.sb3';
                if (browser) await browser.exclusive(project.browserId!, () => browser.rename(project.browserId!, name));
                else {await permission(handle!, 'readwrite'); await handle!.move!(name);}
                return {storageName: name, handle};
            })} : {}),
            ...(canDelete ? {deleteData: () => withAction(async () => {
                const currentHandle = folders?.folder.directory ?? ports.readFile();
                if (activeId === project.id || await same(handle, currentHandle)) {
                    throw new Error(ja ? '別の作品を開いてから、この保存データを削除してください。' :
                        'Open another project before deleting this saved project.');
                }
                if (browser) await browser.remove(project.browserId!);
                else {await permission(handle!, 'readwrite'); await handle!.remove!({recursive: handle!.kind === 'directory'});}
            })} : {})
        };
    };
    const host = (locale: string): CatalogHost => ({store, operations: project => operations(project, locale), async refresh() {
        await tracking;
        await importWorkspaceProjectHistory(store, view.indexedDB);
        for (const entry of await folders?.folder.browserProjects?.list() ?? []) {
            const handle = await folders!.folder.browserProjects!.root(entry.id);
            if (!handle) continue;
            const existing = (await store.list(true)).find(project => project.browserId === entry.id);
            let savedTitle: string | undefined;
            if (!existing) {
                try {
                    const file = await (await handle.getFileHandle('project.source.json')).getFile();
                    const info = file.size <= 32 * 1024 * 1024 ? JSON.parse(await file.text())[PROJECT_INFO_KEY] : null;
                    if (info?.schemaVersion === 1 && typeof info.title === 'string') savedTitle = info.title;
                } catch { /* A newly created or incomplete folder has no project metadata yet. */ }
            }
            await store.register({location: 'browser', browserId: entry.id, handle, storageName: entry.title,
                title: existing?.title ?? savedTitle ?? entry.title,
                remote: existing?.remote ?? await folders?.readRemote?.(handle).catch(() => undefined)}, false);
        }
    }});
    schedule();
    return {
        store,
        bindFolder(value: CatalogFolderPorts) {folders = value; schedule();},
        fileOpened(file: File | null) {
            if (!file || !/\.sb3$/i.test(file.name)) return;
            selectedFile = {file, sequence: properties.loadState().sequence};
            schedule();
        },
        capture: schedule,
        show(locale: string, fileStorage: ProjectFileStorage, createProject?: () => void) {
            storage = fileStorage;
            dialog?.(); dialog = openProjectCatalog(document, {...host(locale), createProject}, locale);
        },
        dispose() {
            alive = false; view.clearTimeout(timer); stopLoad(); stopLocation?.();
            dialog?.();
        }
    };
}
