// SPDX-License-Identifier: MPL-2.0
// Original Plus Editor workflow coordinator, provided under MPL-2.0 by its rights holder.
import type {ProjectFolderWorkflows} from './project-folder-workflows.ts';
export type {ProjectFolderWorkflows} from './project-folder-workflows.ts';
import {withProjectFolderTitle} from './project-tools/properties.ts';
import {isObservedProjectVersion, isProjectVersionEditor, type MergePlanSharePort}
    from '@kubohiroya/turbowarp-plus-editor-git/project-version-preview';
import {chooseBrowserProject, folderNotEmptyMessage, followProjectFolder, mountProjectFolder, openRepositoryProjectQuestion,
    openSavedFolderQuestion, projectFolderActions} from '@kubohiroya/turbowarp-plus-editor-project-folder';
import {createFolderSnapshotWorkflows} from '@kubohiroya/turbowarp-plus-editor-project-folder/snapshot-workflows';
import type {FolderHost, FolderVM, ReloadTarget} from '@kubohiroya/turbowarp-plus-editor-project-folder';
import type {EditorHost, EditorTarget} from '@kubohiroya/turbowarp-plus-editor-host';
import {refreshExternalBlockViews} from '@kubohiroya/turbowarp-plus-editor-code-views';
import {createScratchBlocksDiffRenderer, mountGitPanel, openProjectComparison, openRemoteRepositoryDialog, readProjectRemote}
    from '@kubohiroya/turbowarp-plus-editor-git';
import {createGitConnectionSettings} from '@kubohiroya/turbowarp-plus-editor-auth';
import type {DesktopGitPreload} from '@kubohiroya/turbowarp-plus-editor-auth';
import type {GitAuthor, ScratchBlockDiffRendererOptions} from '@kubohiroya/turbowarp-plus-editor-git';
import {createSaveCommitWorkflows, createPullRequestPublication, hasGitDirectory, type SaveCommitWorkflowOptions} from '@kubohiroya/turbowarp-plus-editor-git/save-commit-workflows';
import type {PublicationBridge}
    from '@kubohiroya/turbowarp-plus-editor-git/project-publication';
import {createCloudflarePublicationBridge} from '@kubohiroya/turbowarp-plus-editor-git/cloudflare-publication';
import type {createProjectTools} from './project-tools/integration.ts';
import {followProjectTitleCommits, reflectProjectTitle} from './project-title.ts';
import {showNotice} from './project-notice.ts';
import {bindProjectOpenTabActions, openBrowserProjectInNewTab, openProjectInNewTab} from './project-open-tabs.ts';
import {flushPendingSurfaceEdits} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';
import {getDocumentWorkspace} from './sprite-tabs.ts';
import {activateTargetView, connectionFor} from '@kubohiroya/turbowarp-plus-editor-project-model/project-search-connections';
import {bindProjectRepositoryCreation} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-host';
import type {BrowserRepositoryFolders, DesktopRepositoryCreation, ProjectRepositoryHostServices}
    from '@kubohiroya/turbowarp-plus-editor-git/project-repository-host';

type RuntimeThread = {updateMonitor?: boolean};
export type ProjectFolderVM = FolderVM & EditorHost['vm'] & {
    runtime: {threads: RuntimeThread[]; isActiveThread(thread: RuntimeThread): boolean};
    setEditingTarget(id: string): void;
};
type LocalFolderMount = NonNullable<ReturnType<typeof mountProjectFolder>> & {
    save?(): Promise<unknown>;
};
type GitCommitMount = NonNullable<ReturnType<typeof mountGitPanel>> & {
    getCommitRepository?(): {root: FileSystemDirectoryHandle; current(): boolean} | null;
    selectRepository?(root: FileSystemDirectoryHandle, project: FileSystemDirectoryHandle): Promise<boolean>;
    clearRepository?(): void;
};
export interface ProjectFolderEnvironment {
    isCurrent(): boolean;
    isProjectDirty(): boolean;
    isRunning(): boolean;
    subscribe(listener: () => void): () => void;
    markSaved(): void;
    clearFileHandle(): void;
    setTitle(title: string): void;
    getTitle(): string;
    desktop?: {auth?: DesktopGitPreload | null; creation?: DesktopRepositoryCreation | null;
        publication?: PublicationBridge | null; author?(): Promise<GitAuthor | null>; mergePlanShare?: MergePlanSharePort};
    captureHost?(host: EditorHost): void;
}
export interface ProjectFolderIntegrationServices {
    environment(vm: ProjectFolderVM, document: Document): ProjectFolderEnvironment | null;
    cloudflare?: {bffOrigin: string; proxyOrigin: string} | null;
    repository: ProjectRepositoryHostServices;
    tools: Pick<ReturnType<typeof createProjectTools>, 'bindProjectCatalogFolder' | 'loadedProjectTitle' |
        'projectSaveName' | 'projectScreenState' | 'setProjectSaveName'>;
    unpackProject?(data: Uint8Array): {files: ReadonlyMap<string, Uint8Array>; warnings: readonly {path: string}[]};
    createCommitQueue?: SaveCommitWorkflowOptions['createCommitQueue'];
    createCommitJournal?: SaveCommitWorkflowOptions['createCommitJournal'];
    saveWithLock?: SaveCommitWorkflowOptions['saveWithLock'];
    versions: {
        available(): boolean;
        validate(files: ReadonlyMap<string, Uint8Array>): void;
        pack(files: ReadonlyMap<string, Uint8Array>): Promise<ArrayBuffer>;
        preview(document: Document, oid: string, archive: ArrayBuffer, locale: string, title?: string,
            playtest?: import('@kubohiroya/turbowarp-plus-editor-git/project-version-preview').MergePlaytestRequest,
            observe?: import('@kubohiroya/turbowarp-plus-editor-git/project-version-preview').PlaytestObserver): unknown;
        edit(document: Document, archive: ArrayBuffer, locale: string, title: string,
            save: (edit: import('@kubohiroya/turbowarp-plus-editor-git/project-version-preview').MergePlanCodeEdit) => Promise<string>): Promise<string | undefined>;
    };
    runSavedGenerationTests(document: Document, archive: ArrayBuffer, signal: AbortSignal):
        ReturnType<NonNullable<import('@kubohiroya/turbowarp-plus-editor-git').GitHost['runMergePlanTests']>>;
}
type PickerWindow = Window & {showDirectoryPicker?(options: {id: string; mode: 'readwrite'}): Promise<FileSystemDirectoryHandle>};

/** Coordinates folder, repository and workspace lifetimes through native host ports. */
export function createProjectFolderIntegration(services: ProjectFolderIntegrationServices) {
    const {bindProjectCatalogFolder, loadedProjectTitle, projectSaveName, projectScreenState, setProjectSaveName} = services.tools;
    const {available: hasProjectVersionValidator, validate: validateProjectVersion, pack: packProjectVersion,
        preview: openProjectVersionPreview, edit: openProjectVersionEditor} = services.versions;
    const {runSavedGenerationTests} = services;
    const folders = new WeakMap<FolderVM, {folder: LocalFolderMount; workflows(): ProjectFolderWorkflows;
        openRemote?(locale: string, remote?: string): Promise<boolean>}>();

    const projectFolderWorkflows = (vm: FolderVM) => folders.get(vm)?.workflows();
    /** Opens a remote Git repository: clones it, then opens the project at its root (#676). */
    const projectFolderOpenRemote = (vm: FolderVM) => folders.get(vm)?.openRemote;

    /** The folder the loaded project came from, so its Dockview layout is kept apart from other projects. */
    const projectFolderDirectory = (vm: FolderVM) => folders.get(vm)?.folder.directory ?? null;

    function attachProjectFolder(vm: ProjectFolderVM, document: Document, localGit: boolean, gitRestoreVersion: boolean, locale: string,
        getBlockly: ScratchBlockDiffRendererOptions['getBlockly'],
        blocks: Pick<EditorHost, 'deserializeBlocks' | 'createBlockContainer'>,
        attachNavigation?: ScratchBlockDiffRendererOptions['attachNavigation']) {
        const view = document?.defaultView as PickerWindow;
        const environment = services.environment(vm, document);
        if (!view || !environment || isProjectVersionEditor(view) || isObservedProjectVersion(view)) return null;
        const cloudflare = services.cloudflare;
        const connectionSettings = localGit ? createGitConnectionSettings({
            desktop: environment.desktop?.auth,
            cloudflare
        }) : undefined;
        const desktopBridge = environment.desktop?.publication;
        const cloudflareBridge = cloudflare && connectionSettings && createCloudflarePublicationBridge({
            ...cloudflare, view, getSession: connectionSettings.getSession
        });
        const desktopPublication = createPullRequestPublication(connectionSettings, desktopBridge ?? undefined);
        const cloudflarePublication = createPullRequestPublication(connectionSettings, cloudflareBridge || undefined, cloudflareBridge ? cloudflareBridge.bindPushSession : undefined);
        if (!environment.isCurrent()) return null;
        const {runtime} = vm;
        const host = {
            vm,
            locale,
            getBlockly,
            ...blocks,
            markSaved: environment.markSaved,
            isProjectDirty: environment.isProjectDirty,
            isRunning: () => environment.isRunning() ||
                runtime.threads.some(thread => !thread.updateMonitor && runtime.isActiveThread(thread)),
            subscribe: listener => environment.subscribe(listener),
            refreshBlockViews: (targets: readonly (EditorTarget | ReloadTarget)[]) => refreshExternalBlockViews(vm, targets)
        } satisfies EditorHost;
        // A local browser test observes the same host object this attachment uses.
        environment.captureHost?.(host);
        let gitPanel: GitCommitMount | null = null;
        const saveWithLock = services.saveWithLock;
        const readAuthor = async () => {
            try {
                return await environment.desktop?.author?.() ?? undefined;
            } catch {
                return undefined;
            }
        };
        const renderReviewBlock = createScratchBlocksDiffRenderer({
            getBlockly: host.getBlockly,
            deserializeBlocks: host.deserializeBlocks,
            createBlockContainer: host.createBlockContainer,
            showUnregisteredBlocks: true,
            locale: host.locale,
            attachNavigation
        });
        const folderHost: FolderHost & {saveWithLock?: typeof saveWithLock} = {
            blockReload: {
                isRunning: host.isRunning,
                subscribe: host.subscribe,
                onApplied(targets) {
                    host.refreshBlockViews(targets);
                    host.markSaved();
                },
                deserializeBlocks: host.deserializeBlocks,
                compareChanges: request => openProjectComparison(document, {...request, renderBlock: renderReviewBlock, locale: host.locale})
            },
            isProjectDirty: host.isProjectDirty,
            saveWithLock,
            // A project folder is not an SB3, so it keeps the screen state the project tools installed for this VM.
            screenState: {
                serialize: () => projectScreenState(vm)?.serialize(),
                prepareLoad: text => projectScreenState(vm)?.prepareLoad(text),
                register: (key, slice) => projectScreenState(vm)?.register(key, slice) ?? (() => {})
            },
            beforeLoad: environment.clearFileHandle,
            onOpened(title) {
                environment.setTitle(loadedProjectTitle(vm) ?? title);
                host.markSaved();
            },
            onSaved() {
                host.markSaved();
                void gitPanel?.refresh();
            }
        };
        // Folders saved in the browser are offered in every browser, beside the device's folders where the browser has them.
        const folder = mountProjectFolder({vm: host.vm, document, locale: host.locale, host: folderHost,
            browserStorage: 'always'}) as LocalFolderMount | null;
        if (!folder) return null;
        const {unpackProject, createFolder, copyFolder, folderLocation, locations, pickEmptyFolder} =
            createFolderSnapshotWorkflows({folder, view, locale, unpackProject: services.unpackProject, flushEdits: flushPendingSurfaceEdits});
        const browserStorage = folder.browserProjects;
        // Without the folder picker, repositories live in the browser's storage, with the project folder inside (#660).
        const browserProjects = folderLocation === 'browser' ? browserStorage : null;
        const createBrowserFolder = browserStorage ? async (title: string) => {
            // One repository holds one project at its root; the initial commit is written into the empty folder.
            const entry = await browserStorage.create(title, {projectPath: ''});
            return {directory: entry.root, browserProjectId: entry.id};
        } : undefined;
        const browserFolders: BrowserRepositoryFolders | undefined = browserProjects && createBrowserFolder ? {
            create: createBrowserFolder,
            async choose() {
                const choice = await chooseBrowserProject({document, projects: browserProjects, locale, purpose: 'open'});
                return choice && browserProjects.root(choice.project.id);
            }
        } : undefined;
        const repositoryCreation = localGit && createFolder ? bindProjectRepositoryCreation({
            view, locale, desktop: environment.desktop?.creation, services: services.repository,
            cloudflare,
            browserFolders,
            createBrowserFolder,
            author: readAuthor,
            async prepareSource(serialize, current, title) {
                await flushPendingSurfaceEdits();
                if (!current()) return null;
                let edited = false;
                const stage = vm.runtime.getTargetForStage();
                const changed = () => {edited = true;};
                vm.on('PROJECT_CHANGED', changed);
                try {
                    const files = await unpackProject(serialize, () => current() && !edited && stage === vm.runtime.getTargetForStage());
                    return withProjectFolderTitle(files, title);
                } finally {
                    vm.off('PROJECT_CHANGED', changed);
                }
            },
            async openProject(project, root, browserProjectId) {
                if (typeof browserProjectId === 'string') {
                    if (!await browserStorage?.lookup(browserProjectId)) throw new DOMException('Unknown browser project', 'NotFoundError');
                    return openBrowserProjectInNewTab(vm, browserProjectId);
                }
                if (openProjectInNewTab(vm, {kind: 'folder', directory: project, root})) return false;
                if (await folder.openDirectory(project, () => view.confirm(openSavedFolderQuestion(locale))) !== 'opened') return false;
                await gitPanel?.selectRepository?.(root, project);
                return true;
            },
            async openLegacyProject() {
                // Older journals lack destination provenance. Ask explicitly without inspecting or transferring their handle.
                const command = browserStorage ? 'browser-folder' : 'folder';
                if (!openProjectInNewTab(vm, {kind: 'command', command})) {
                    const actions = projectFolderActions(vm, locale);
                    if (browserStorage) actions?.openBrowser?.();
                    else actions?.open();
                }
                return false;
            }
        }) : undefined;
        const saveCommitWorkflows = createSaveCommitWorkflows({
            view, folder, getRepository: () => gitPanel?.getCommitRepository?.(), isCurrent: environment.isCurrent,
            connectionSettings, cloudflare, publicationBridge: environment.desktop?.publication,
            createCommitQueue: services.createCommitQueue, createCommitJournal: services.createCommitJournal,
            saveWithLock, flushEdits: flushPendingSurfaceEdits, readAuthor, refresh: () => {void gitPanel?.refresh();}
        });
        const workflows = (): ProjectFolderWorkflows => ({
            createFolder, copyFolder, pickEmptyFolder, locations, markSaved: host.markSaved, folderLocation, repositoryCreation,
            ...saveCommitWorkflows()
        });
        // Open Remote Git Repository…: a read session clones the repository into an empty folder on the device or in the
        // browser, then the root opens as the project folder and the Git panel binds to it.
        const openRemote = connectionSettings ? (language: string, initialRemote?: string) => {
            const projects = folder.browserProjects;
            const created = new Map<FileSystemDirectoryHandle, string>();
            return openRemoteRepositoryDialog({
                document, locale: language, connectionSettings, initialRemote,
                deviceFolders: typeof view.showDirectoryPicker === 'function',
                ...typeof view.showDirectoryPicker === 'function' && {async pickDeviceFolder() {
                    let directory: FileSystemDirectoryHandle;
                    try {
                        directory = await view.showDirectoryPicker!({id: 'turbowarp-plus-remote-repository', mode: 'readwrite'});
                    } catch (error) {
                        if ((error as DOMException).name === 'AbortError') return null;
                        throw error;
                    }
                    for await (const _entry of (directory as unknown as {values(): AsyncIterable<unknown>}).values()) {
                        view.alert(folderNotEmptyMessage(language));
                        return null;
                    }
                    return directory;
                }},
                ...projects && {
                    async createBrowserFolder(name: string) {
                        const project = await projects.create(name, {projectPath: ''});
                        created.set(project.root, project.id);
                        return project.root;
                    },
                    async removeBrowserFolder(handle: FileSystemDirectoryHandle) {
                        const id = created.get(handle);
                        if (id) await projects.remove(id);
                    }
                },
                openProject: (root: FileSystemDirectoryHandle) => folder.openDirectory(root, () => view.confirm(
                    openRepositoryProjectQuestion(language)), root, {locale: language})
            });
        } : undefined;
        folders.set(vm, {folder, workflows, openRemote});
        bindProjectCatalogFolder(vm, {folder, openRemote, readRemote: readProjectRemote});
        bindProjectOpenTabActions(vm, {
            openDirectory: (directory, root) => folder.openDirectory(directory, () => true, root),
            openBrowserProject: async id =>
                await folder.openBrowserProject(id, () => true, {notProjectDialog: false}) === 'opened'
        });
        // A title the person committed in the menu bar renames what the browser can rename, and says what it cannot (#679).
        const stopTitleWatch = followProjectTitleCommits(document, {
            readTitle: environment.getTitle,
            onCommit(title) {
                const directory = folder.directory;
                const language = document.documentElement.lang || locale;
                void reflectProjectTitle({document, locale: language, title, saveName: projectSaveName(vm),
                    location: folder.location ?? 'none',
                    gitBound: Boolean(gitPanel?.getCommitRepository?.()),
                    renameBrowserFolder: async name => {await folder.renameCurrentBrowserFolder(name);},
                    setSaveName: name => setProjectSaveName(vm, name),
                    notify: text => showNotice(document, text, {locale: language}),
                    current: () => folder.directory === directory}).catch(() => {});
            }
        });
        let author: GitAuthor | undefined;
        if (localGit) void readAuthor().then(value => {author = value;});
        if (!localGit) return {...folder, dispose() {
            stopTitleWatch();
            if (folders.get(vm)?.folder === folder) folders.delete(vm);
            folder.dispose();
        }};
        const workspace = getDocumentWorkspace(vm);
        const dirtyFiles = () => workspace.fileEdits().filter(file => file.directory === folder.directory);
        gitPanel = mountGitPanel({vm: host.vm, document, host: {
            connectionSettings,
            pullRequestPublication: () => connectionSettings?.getView().mode === 'desktop' ?
                desktopPublication : cloudflarePublication,
            // Stage and commit with the repository's own Git identity (#318).
            localWrite: {author: () => author},
            ...browserFolders && {chooseRoot: browserFolders.choose},
            // Git is set up by opening a folder, with the File menu's own commands; the panel no longer chooses a repository.
            openFolder: language => (!environment.desktop && openProjectInNewTab(vm, {kind: 'command', command: 'folder'})) ||
                projectFolderActions(vm, language)?.open(),
            ...folder.browserProjects && {openBrowserFolder: (language: string) =>
                openProjectInNewTab(vm, {kind: 'command', command: 'browser-folder'}) || projectFolderActions(vm, language)?.openBrowser?.()},
            deviceFolders: typeof view.showDirectoryPicker === 'function',
            renderReviewBlock,
            // A folder that is not a project shows project-folder's own dialog; the panel hears that nothing opened.
            openProject: async (directory, confirmReplace) =>
                !environment.desktop && openProjectInNewTab(vm, {kind: 'folder', directory}) ? 'cancelled' :
                    await folder.openDirectory(directory, confirmReplace) === 'opened' ? 'opened' : 'cancelled',
            projectDirectory: () => folder.directory,
            ...hasProjectVersionValidator() && {
                restoreProjectVersions: gitRestoreVersion,
                shareMergePlans: environment.desktop?.mergePlanShare,
                validateProjectVersion,
                async runMergePlanTests(files, signal) {
                    return runSavedGenerationTests(document, await packProjectVersion(files), signal);
                },
                async previewProjectVersion({oid, files, title, guard, playtest, observe}) {
                    const archive = playtest?.blocking.length ? new ArrayBuffer(0) : await packProjectVersion(files);
                    guard?.();
                    openProjectVersionPreview(document, oid, archive, locale, title, playtest, observe);
                },
                async editProjectVersion({title, files, guard, save}) {
                    const archive = await packProjectVersion(files);
                    guard();
                    return openProjectVersionEditor(document, archive, locale, title, edits => {
                        guard();
                        return save(edits);
                    });
                }
            },
            unsavedProjectPaths() {
                const paths = host.isProjectDirty() ? folder.unsavedPaths() : new Set<string>();
                return paths && new Set([...paths, ...dirtyFiles().map(file => file.path)]);
            },
            readUnsavedProjectFile(path) {
                const edit = dirtyFiles().find(file => file.path === path);
                return edit ? edit.readUnsaved?.() : host.isProjectDirty() ? folder.readUnsavedFile(path) : undefined;
            },
            subscribeProjectEdits(listener) {
                const stopProject = folder.subscribeEdits(listener);
                const stopFiles = workspace.subscribeSave(listener);
                return () => {stopProject(); stopFiles();};
            },
            async saveProjectFiles() {
                const directory = folder.directory;
                await flushPendingSurfaceEdits();
                if (directory !== folder.directory) throw new Error('Project folder changed');
                if (host.isProjectDirty()) await folder.save();
                for (const file of dirtyFiles()) {
                    if (directory !== folder.directory) throw new Error('Project folder changed');
                    await file.save();
                    if (file.isDirty()) throw new Error('A file still has unsaved changes');
                }
            },
            // A transient tab beside the code, as the YAML documents open; the folder handle cannot outlive a reload.
            openPanel: request => workspace.open({...request, transient: true,
                pinWithProjectFolder: request.reference.documentId === 'local-git'}),
            // The same route as project search, so the code opens where people already work.
            openTargetCode(targetId) {
                const navigation = connectionFor(vm.runtime as unknown as Parameters<typeof connectionFor>[0]).navigation;
                if (!navigation || !activateTargetView(navigation, targetId, 0)) vm.setEditingTarget(targetId);
            },
            getWorkspace: async () => (await host.getBlockly()).getMainWorkspace() as never,
            isProjectDirty: () => host.isProjectDirty() || dirtyFiles().length > 0,
            isProjectRunning: host.isRunning,
            subscribe(listener) {
                const loaded = () => listener('loaded');
                const unsubscribe = host.subscribe(() => listener('changed'));
                const stopFiles = workspace.subscribeSave(() => listener('changed'));
                let directory = folder.directory;
                const unfollow = followProjectFolder(vm, (_folder, next) => {
                    if (next === directory) return;
                    directory = next;
                    listener('folder');
                });
                vm.runtime.on('PROJECT_LOADED', loaded);
                return () => {unfollow(); unsubscribe(); stopFiles(); vm.runtime.off('PROJECT_LOADED', loaded);};
            }
        }});
        // One repository holds one project: an opened folder with `.git` binds the Git panel to that repository, any other
        // folder unbinds it. `root` is the folder the user chose, which may hold the project in `project/`.
        let boundDirectory: FileSystemDirectoryHandle | null | undefined;
        const unfollowBinding = followProjectFolder(vm, (_folder, directory, root) => {
            if (directory === boundDirectory) return;
            boundDirectory = directory;
            const candidate = root ?? directory;
            void (async () => {
                const repository = candidate && await hasGitDirectory(candidate) ? candidate : null;
                if (boundDirectory !== directory) return;
                if (repository && directory) await gitPanel?.selectRepository?.(repository, directory);
                else gitPanel?.clearRepository?.();
            })();
        });
        let disposed = false;
        let scheduled = false;
        const ensureProjectTab = () => {
            if (scheduled || workspace.saveScope !== 'tab') return;
            scheduled = true;
            queueMicrotask(() => {
                scheduled = false;
                if (!disposed && workspace.saveScope === 'tab') gitPanel?.open(document.documentElement.lang || locale, true);
            });
        };
        const stopProjectTab = workspace.subscribeSave(ensureProjectTab);
        ensureProjectTab();
        return {...folder, dispose() {
            disposed = true;
            stopTitleWatch();
            stopProjectTab();
            if (folders.get(vm)?.folder === folder) folders.delete(vm);
            unfollowBinding();
            gitPanel?.dispose();
            folder.dispose();
        }};
    }


    return {attachProjectFolder, projectFolderWorkflows, projectFolderOpenRemote, projectFolderDirectory};
}
