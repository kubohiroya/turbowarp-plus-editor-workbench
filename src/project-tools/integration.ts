// SPDX-License-Identifier: MPL-2.0
import React from 'react';
import {withWaitCursor, withoutWaitCursor} from '../busy-cursor.js';
import {captureProjectLoad, duringProjectLoadApproval, reportProjectAssets, reportProjectFinishing}
    from '../project-load-progress.js';
import type {createProjectProperties} from './properties.js';
import {createAuthorHistory} from './history.js';
import type {createProjectDialogService} from './dialog.js';
import {editProjectURI, getExtensionAuthoringHost, withProjectSerialization} from '@kubohiroya/turbowarp-extension-loader/scratch-vm';
import {createProjectDiagnostics} from './diagnostics.js';
import {flushPendingSurfaceEdits} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';
import {isValidSaveName, projectFileDialogTitle, renderExportView, renderExtensionsForm, renderSaveAsForm, saveProjectAs,
    suggestSaveName} from '../project-file-dialogs.js';
import type {NewProjectChoices, NewProjectRequest, NewProjectResult, ProjectFileStorage, ExtensionStorage}
    from '../project-file-dialogs.js';
import {createNewProjectHandler} from '../new-project.js';
import {showNotice} from '../project-notice.js';
import {renderProjectCommitDialog} from '@kubohiroya/turbowarp-plus-editor-git/project-commit-dialog';
import {renderProjectPublicationDialog} from '@kubohiroya/turbowarp-plus-editor-git/project-publication-dialog';
import type {PublicationCommit} from '@kubohiroya/turbowarp-plus-editor-git/project-publication';
import type {ProjectFolderWorkflows} from '../project-folder-workflows.js';
import {projectFolderOverwriteWarning} from '@kubohiroya/turbowarp-plus-editor-project-folder';
import type {ExtensionSpec} from '@kubohiroya/turbowarp-extension-loader';
import JSZip from '@turbowarp/jszip';
import {installProjectScreenState} from '../project-screen-state.js';
import type {ProjectScreenState} from '../project-screen-state.js';

export interface ProjectToolsPorts {
    installEditorExtensionHost(vm: any, settings: any): any;
    installProjectProperties: ReturnType<typeof createProjectProperties>;
    createProjectDialogs: ReturnType<typeof createProjectDialogService>['createProjectDialogs'];
    editorProjectArchives: unknown;
    projectToolsEnabled: boolean;
    manualProjectURIEnabled: boolean;
    readStartupFlags(search?: string): {saveWorkspace: boolean};
    projectLoadState(document: Document | undefined): {
        current(): string; isShown(): boolean; subscribe(listener: () => void): () => void;
    } | undefined;
}
/** Feature state and workflows are local to one host integration. */
export function createProjectTools({installEditorExtensionHost, installProjectProperties, createProjectDialogs,
    editorProjectArchives, projectToolsEnabled: PROJECT_TOOLS_ENABLED, manualProjectURIEnabled: MANUAL_PROJECT_URI_ENABLED,
    readStartupFlags: readWebStartupFeatureFlags, projectLoadState}: ProjectToolsPorts) {
    const projects = new WeakMap();
    const screenStates = new WeakMap<object, ProjectScreenState>();
    const storageFor = document => {
        try { return document.defaultView?.localStorage; } catch (error) { return undefined; }
    };

    /** Compose this host's project tools with its existing extension host. */
    const installProjectToolsHost = (vm, settings: Parameters<typeof installEditorExtensionHost>[1] & Parameters<typeof installProjectProperties>[1] = {}, enabled = PROJECT_TOOLS_ENABLED) => {
        const diagnostics = createProjectDiagnostics();
        const document = settings.document || globalThis.document;
        const runProjectLoad = document ? <T>(run: () => Promise<T>) =>
            withWaitCursor([document], run, {releaseAfterPaint: true}) : undefined;
        const host = installEditorExtensionHost(vm, {...settings, showDiagnostics: false, runProjectLoad,
            projectArchives: editorProjectArchives,
            captureProjectProgress: () => captureProjectLoad(vm),
            waitForUser: document ? ask => duringProjectLoadApproval(vm, () => withoutWaitCursor(document, ask)) : undefined,
            diagnostics: event => { diagnostics.record(event); settings.diagnostics?.(event); },
            onProjectManifest: manifest => { diagnostics.describe(manifest); settings.onProjectManifest?.(manifest); }});
        // After the extension loader's bridge, so a save replaces the screen state the loaded file carried.
        const screenState = installProjectScreenState(vm, {Zip: JSZip,
            save: readWebStartupFeatureFlags(settings.search ?? globalThis.location?.search).saveWorkspace});
        screenStates.set(vm, screenState);
        const shareArchives = 'projectIO' in host && 'supportsSharedArchive' in host.projectIO && host.projectIO.supportsSharedArchive === true;
        const properties = installProjectProperties(vm, {...settings, metadataEnabled: enabled, runProjectLoad, shareArchives});
        const reportAssets = (finished: number, total: number) => reportProjectAssets(vm, finished, total);
        const finishProject = () => reportProjectFinishing(vm);
        vm.on?.('ASSET_PROGRESS', reportAssets);
        vm.runtime?.on?.('PROJECT_LOADED', finishProject);
        const history = enabled ? createAuthorHistory(document ? storageFor(document) : undefined) : null;
        const dialogs = document?.body ? createProjectDialogs(document, properties, history, diagnostics,
            {locale: settings.locale, getLocale: settings.getLocale}) : null;
        const tools = {dialogs, payloads: 'payloads' in host ? host.payloads : undefined, propertiesEnabled: enabled,
            projectURIEnabled: MANUAL_PROJECT_URI_ENABLED && host.enabled, properties, projectState: settings.projectState};
        let lastPhase;
        const unsubscribe = properties.subscribe(() => {
            const state = properties.loadState();
            const key = `${state.sequence}:${state.phase}`;
            if (lastPhase === key) return;
            lastPhase = key;
            if (state.phase === 'loading') diagnostics.begin();
            else if (state.phase === 'loaded' || state.phase === 'failed') {
                diagnostics.finish(state, state.phase === 'failed' ? state.title || '' : properties.loadedTitle() || '');
            }
        });
        projects.set(vm, tools);
        let disposal;
        return {...host, dispose () {
            disposal ??= (async () => {
                vm.off?.('ASSET_PROGRESS', reportAssets);
                vm.runtime?.off?.('PROJECT_LOADED', finishProject);
                unsubscribe(); dialogs?.dispose(); properties.dispose(); diagnostics.dispose(); projects.delete(vm);
                screenStates.delete(vm);
                screenState.dispose();
                await host.dispose();
            })();
            return disposal;
        }};
    };

    /** The screen state the project files keep for `vm`, once the project tools are installed. */
    const projectScreenState = (vm): ProjectScreenState | undefined => screenStates.get(vm);

    const loadedProjectTitle = vm => projects.get(vm)?.properties.loadedTitle();
    const restoreProjectTitle = vm => projects.get(vm)?.properties.restoreTitle();
    const isProjectLoading = vm => Boolean(projects.get(vm)?.properties.snapshot().loading);
    const subscribeProjectLoad = (vm, listener: () => void) => projects.get(vm)?.properties.subscribe(listener);
    /** The name the project is saved under as a folder or repository, from Project Properties; `''` when it has none. */
    const projectSaveName = (vm): string => projects.get(vm)?.properties.snapshot().saveName ?? '';
    const setProjectSaveName = (vm, saveName: string) => {
        try {
            projects.get(vm)?.properties.apply({saveName});
        } catch {
            // Properties that cannot be edited (an unsupported version, loading) keep their save name.
        }
    };
    /** The default name of a folder or repository made from the project: its save name, or a usable title, or a slug of it. */
    const defaultSaveName = (properties): string => {
        const {saveName, title} = properties.snapshot();
        if (saveName) return saveName;
        const trimmed = (title ?? '').trim();
        return isValidSaveName(trimmed) ? trimmed : suggestSaveName(trimmed);
    };

    const serializeProjectFolder = (vm, payloads, title?: string) =>
        withProjectSerialization(vm, {title, preview: true}, () => {
            const save = () => vm.saveProjectSb3('uint8array');
            return payloads?.withEmbedded(save) ?? save();
        });

    async function createFolderFromCurrentProject(vm, createFolder: ProjectFolderWorkflows['createFolder']) {
        const tools = projects.get(vm);
        if (!tools || !createFolder || tools.saving || !vm.runtime.getTargetForStage() || isProjectLoading(vm)) return false;
        const sequence = tools.properties.loadState().sequence;
        const current = () => projects.get(vm) === tools && tools.properties.loadState().sequence === sequence;
        tools.saving = true;
        try {
            return await createFolder(() => serializeProjectFolder(vm, tools.payloads), current);
        } finally {
            tools.saving = false;
        }
    }

    function projectFileActions(vm, locale: string, storage: ProjectFileStorage, detachFolder: () => void, add?: () => void,
        folderWorkflows?: ProjectFolderWorkflows) {
        const tools = projects.get(vm);
        if (!tools?.dialogs) return {};
        const {dialogs, properties, payloads} = tools;
        const ja = locale.startsWith('ja');
        const label = (jp: string, en: string) => ja ? jp : en;
        const publication = folderWorkflows?.publication;
        const showPublication = publication ? (commit: PublicationCommit) =>
            dialogs.showView(label('PR の作成・進捗', 'Pull Request'), locale,
                (document, close) => renderProjectPublicationDialog(document, locale, publication, commit, close, () => showCommit?.())) :
            undefined;
        const showCommit: (() => void) | undefined = storage.canSave && folderWorkflows?.commit ? () =>
            dialogs.showView(label('保存してコミット', 'Save and Commit'), locale,
                (document, close) => renderProjectCommitDialog(document, locale, folderWorkflows.commit, close, showPublication)) : undefined;
        // Save a Copy (`copy`) writes a copy and leaves the project, its file, folder and unsaved changes as they are; Save
        // Project without a save target (`save`) makes the new file, folder or repository the project's target (#679).
        const showSaveForm = (mode: 'copy' | 'save') => dialogs.showView(projectFileDialogTitle(mode === 'copy' ? 'save-as' : 'save', locale),
            locale, (document, close) => {
                const form = renderSaveAsForm(document, locale, storage, async (request, open, signal) => {
                    const {name, format} = request;
                    if (tools.saving) return false;
                    tools.saving = true;
                    const sequence = properties.loadState().sequence;
                    const current = () => open() && projects.get(vm) === tools && properties.loadState().sequence === sequence;
                    let edited = false;
                    const changed = () => {edited = true;};
                    vm.on?.('PROJECT_CHANGED', changed);
                    try {
                        if (format === 'folder') {
                            const serialize = () => serializeProjectFolder(vm, payloads, name);
                            // A new repository is opened only when the person chooses to open it at the end of the setup.
                            if (request.git) return await folderWorkflows?.repositoryCreation?.start(request.git, serialize, current, signal);
                            return mode === 'copy' ? await folderWorkflows?.copyFolder?.(serialize, current, name) :
                                await folderWorkflows?.createFolder?.(serialize, current, name);
                        }
                        let embed: (() => void) | undefined;
                        let commitMetadata: (() => void) | undefined;
                        return await saveProjectAs(storage, name, {
                            mode,
                            current,
                            collect: () => flushPendingSurfaceEdits(),
                            unchanged: () => !edited,
                            serialize(title, run) {
                                embed = format === 'embedded' ? payloads?.embedOnSave() : undefined;
                                return withProjectSerialization(vm, {title, deferCommit: commit => {commitMetadata = commit;}},
                                    () => embed ? payloads.withEmbedded(run) : run());
                            },
                            committed() {
                                // A copy is not a save of the project: its properties and data formats stay unsaved.
                                if (mode === 'copy') return;
                                embed?.();
                                commitMetadata?.();
                                detachFolder();
                            }
                        });
                    } finally {
                        vm.off?.('PROJECT_CHANGED', changed);
                        tools.saving = false;
                    }
                }, close, {
                    folder: folderWorkflows?.createFolder ? {
                        location: folderWorkflows.folderLocation,
                        overwriteWarning: projectFolderOverwriteWarning(locale),
                        github: folderWorkflows.repositoryCreation && {
                            connectForCreation: folderWorkflows.repositoryCreation.connect,
                            licenses: folderWorkflows.repositoryCreation.licenses,
                            publication: folderWorkflows.repositoryCreation
                        }
                    } : undefined,
                    openCommit: showCommit
                });
                // The repository name starts from the save name, as a new project's does.
                const repository = form.querySelector<HTMLInputElement>('input[name="github-name"]');
                if (repository && !repository.value) repository.value = defaultSaveName(properties);
                return form;
            });
        const openPayloads = () => dialogs.showPayloadFormats(payloads.edit(), locale, payloads.canConvert ? () => {
            const conversion = payloads.convert();
            if (conversion) dialogs.showBundleAssetConversion(conversion, locale);
        } : undefined);
        const authoring = getExtensionAuthoringHost(vm);
        const openExtensions = () => dialogs.showView(label('機能拡張', 'Extensions'), locale, (document, close) => {
            let saved = new Map<string, ExtensionSpec>();
            return renderExtensionsForm(document, locale, close, add, {
                async list() {
                    const manifest = await authoring?.inspect();
                    saved = new Map((manifest?.extensions || []).map(spec => [spec.id, spec]));
                    const ids = new Set<string>([...saved.keys(), ...(vm.extensionManager?._loadedExtensions?.keys() || [])]);
                    return [...ids].sort().map(id => {
                        const spec = saved.get(id);
                        return {id, format: spec?.source.type, editable: Boolean(spec?.source.url)};
                    });
                },
                async change(changes: Map<string, ExtensionStorage>) {
                    await authoring.configure([...changes].map(([id, distribution]) => {
                        const spec = saved.get(id);
                        return {id, distribution, url: spec.source.url, execution: spec.execution,
                            version: spec.version, dependencies: [...spec.dependencies]};
                    }), {});
                }
            });
        });
        const hasProperties = tools.propertiesEnabled || tools.projectURIEnabled;
        return {
            saveAs: () => showSaveForm('copy'),
            saveNew: () => showSaveForm('save'),
            saveCommit: showCommit,
            properties: hasProperties ?
                () => dialogs.showProperties(locale, tools.projectURIEnabled ? editProjectURI(vm) : undefined) : undefined,
            diagnostics: hasProperties ? undefined : () => dialogs.showDiagnostics(locale),
            payloads: payloads?.canEdit ? openPayloads : undefined,
            extensions: add || authoring ? openExtensions : undefined,
            exportProject: (run: () => void) => dialogs.showView(label('書き出し', 'Export'), locale,
                (document, close) => renderExportView(document, locale, close, run))
        };
    }

    /**
     * Create New Project… (#679): the new project dialog's choices and its `createIn`, from the workbench's handler. This
     * host supplies only what depends on the GUI and its storage.
     */
    function projectCreation(vm, locale: string, create: () => void, folderWorkflows?: ProjectFolderWorkflows,
        defaultTitle?: string): {createIn?: (request: NewProjectRequest, signal: AbortSignal) => Promise<NewProjectResult>;
            newProject?: NewProjectChoices} {
        const tools = projects.get(vm);
        const document = globalThis.document;
        const store = tools?.dialogs && projectLoadState(document);
        const createFolder = folderWorkflows?.createFolder;
        if (!tools || !store || !createFolder) return {};
        const {properties, payloads} = tools;
        const locations = folderWorkflows.locations ?? {browser: folderWorkflows.folderLocation === 'browser', device: false};
        // Replaces the project with the GUI's default project, as Create New Project does, and waits until it is shown.
        // `false` when the person kept the current project at the unsaved-changes question.
        const openDefaultProject = async (signal: AbortSignal) => {
            const loadingState = () => store.current();
            const before = loadingState();
            const sequence = properties.loadState().sequence;
            create();
            if (loadingState() === before) return false;
            await new Promise<void>((resolve, reject) => {
                let done = false;
                const check = () => {
                    if (done) return;
                    const load = properties.loadState();
                    const failed = load.sequence > sequence && load.phase === 'failed';
                    const shown = load.sequence > sequence && load.phase === 'loaded' && store.isShown();
                    if (!signal.aborted && !failed && !shown) return;
                    done = true;
                    stopStore(); stopLoad?.(); signal.removeEventListener('abort', check);
                    if (signal.aborted) reject(signal.reason);
                    else if (failed) reject(new Error(locale.startsWith('ja') ? '新しい作品を開けませんでした。' : 'Could not open the new project.'));
                    else resolve();
                };
                const stopStore = store.subscribe(check);
                const stopLoad = properties.subscribe(check);
                signal.addEventListener('abort', check);
                check();
            });
            // The GUI resets a new project's title right after showing it; name the project after that.
            await new Promise(resolve => globalThis.setTimeout(resolve, 0));
            return true;
        };
        return createNewProjectHandler({
            locale, defaultTitle, create, openDefaultProject,
            browserFolders: locations.browser,
            deviceFolders: locations.device,
            nameProject(title, saveName) {
                try {
                    properties.apply({title, saveName});
                } catch {
                    tools.projectState?.setTitle?.(title);
                }
            },
            pickDeviceFolder: folderWorkflows.pickEmptyFolder && (() => folderWorkflows.pickEmptyFolder(locale)),
            createFolder: (destination, title) => createFolderFromCurrentProject(vm, (serialize, current) =>
                createFolder(serialize, current, title, destination)),
            repositoryCreation: folderWorkflows.repositoryCreation,
            serialize: title => serializeProjectFolder(vm, payloads, title),
            trackProject() {
                const sequence = properties.loadState().sequence;
                return () => projects.get(vm) === tools && properties.loadState().sequence === sequence;
            },
            markSaved: folderWorkflows.markSaved,
            notify: text => showNotice(document, text, {locale})
        });
    }

    /** The GUI supplies its native menu components; this host owns the added entries and dialogs. */
    const renderFileMenu = ({vm, locale = 'en', MenuSection, MenuItem, onRequestClose}) => {
        const tools = projects.get(vm);
        if (!tools?.dialogs) return null;
        const open = type => {
            onRequestClose();
            if (type === 'properties') {
                tools.dialogs.showProperties(locale, tools.projectURIEnabled ? editProjectURI(vm) : undefined);
            } else if (type === 'payloads') {
                tools.dialogs.showPayloadFormats(tools.payloads.edit(), locale);
            } else if (type === 'bundle-assets') {
                const conversion = tools.payloads.convert();
                if (conversion) tools.dialogs.showBundleAssetConversion(conversion, locale);
            } else tools.dialogs.showDiagnostics(locale);
        };
        const entries = [
            ['properties', '作品のプロパティ…', 'Project Properties…', tools.propertiesEnabled || tools.projectURIEnabled],
            ['payloads', '作品データの形式…', 'Project Data Formats…', tools.payloads?.canEdit],
            ['bundle-assets', 'バンドル素材を作品に追加…', 'Add Bundle Material to Project…', tools.payloads?.canConvert],
            ['diagnostics', '作品の診断…', 'Project Diagnostics…', true]
        ].filter(([, , , enabled]) => enabled);
        return React.createElement(MenuSection, null, ...entries.map(([type, ja, en]) =>
            React.createElement(MenuItem, {key: type, command: type, onClick: () => open(type)},
            React.createElement('span', {role: 'button', tabIndex: 0, onKeyDown: event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); event.stopPropagation(); open(type);
                }
            }}, locale.startsWith('ja') ? ja : en))));
    };

    const projectToolsOwnKeyEvent = event => Boolean(event.target?.closest?.('[data-project-tools]'));

    return {installProjectToolsHost, projectScreenState, loadedProjectTitle, restoreProjectTitle, isProjectLoading, subscribeProjectLoad, projectSaveName, setProjectSaveName, createFolderFromCurrentProject, projectFileActions, projectCreation, renderFileMenu, projectToolsOwnKeyEvent};
}
