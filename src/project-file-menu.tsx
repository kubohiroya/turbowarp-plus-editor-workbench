import React from 'react';
import {isMacPlatform} from '@kubohiroya/turbowarp-plus-editor-project-model/project-search-connections';
import {openNewProjectDialog} from './project-file-dialogs.js';
import type {Action, FolderActions, NewProjectChoices, NewProjectRequest, NewProjectResult,
    ProjectFileStorage} from './project-file-dialogs.js';

type Entry = [command: string, label: string, action: Action | undefined, showShortcut?: boolean, unavailable?: string];
interface SaveWorkspace {
    saveScope: 'project' | 'tab';
    canSaveActive: boolean;
    saveActive(): void | Promise<void>;
    subscribeSave(listener: () => void): () => void;
}

type SaveEntries = {storage: ProjectFileStorage; folder?: FolderActions; saveNew?: Action; saveAs?: Action;
    saveCommit?: Action};

function saveEntries(locale: string, {storage, folder, saveNew, saveAs, saveCommit}: SaveEntries): Entry[] {
    const ja = locale.startsWith('ja');
    return [
        // Overwrites the file or saves into the folder; with no target yet, saveNew picks one that becomes the target.
        ['save', ja ? 'プロジェクトを保存' : 'Save Project',
            storage.canSave ? storage.overwrite || folder?.save || saveNew : undefined],
        // Saves a copy and leaves the project where it is; the command id stays `save-as` for icons and hosts.
        ['save-as', ja ? 'プロジェクトのコピーを保存…' : 'Save a Copy of the Project…', storage.canSave ? saveAs : undefined],
        ...(saveCommit ? [['save-commit', ja ? '保存してコミット…' : 'Save and Commit…', saveCommit] as Entry] : [])
    ];
}

export function ProjectSaveMenu({locale, entries}: {locale: string; entries: SaveEntries}) {
    const label = locale.startsWith('ja') ? '未保存の変更があります。保存メニューを開く' :
        'Unsaved changes. Open the save menu';
    const [open, setOpen] = React.useState(false);
    const trigger = React.useRef<HTMLButtonElement>(null);
    const root = React.useRef<HTMLDivElement>(null);
    const close = () => {
        setOpen(false);
        trigger.current?.focus();
    };
    React.useEffect(() => {
        if (!open || !root.current) return;
        const node = root.current;
        const dismiss = (event: PointerEvent) => {
            if (!node.contains(event.target as Node)) setOpen(false);
        };
        node.ownerDocument.addEventListener('pointerdown', dismiss, true);
        return () => node.ownerDocument.removeEventListener('pointerdown', dismiss, true);
    }, [open]);
    const actions = saveEntries(locale, entries).filter(([, , action]) => action);
    return <div className="tw-project-file-menu__save-menu" ref={root}
        onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
        }} onKeyDown={event => {
            if (open && event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        }}>
        <button type="button" ref={trigger} className="tw-project-file-menu__save-marker" data-tw-plus-unsaved-marker aria-label={label}
            aria-expanded={actions.length ? open : undefined} disabled={!actions.length}
            onClick={() => setOpen(previous => !previous)}>*</button>
        {!open && <span className="tw-project-file-menu__save-hint" aria-hidden="true">{label}</span>}
        {open && actions.length > 0 && <div className="tw-project-file-menu__save-actions">
            {actions.map(([command, name, action]) => <button type="button" key={command} onClick={() => {
                close();
                action();
            }}>{name}</button>)}
        </div>}
    </div>;
}

export default function ProjectFileMenu({locale, MenuItem, MenuSection, close, entries, workspace}: {
    locale: string;
    MenuItem: React.ElementType;
    MenuSection: React.ElementType;
    close: Action;
    workspace?: SaveWorkspace;
    entries: {
        /** Creates the default project in memory. Without `createIn`, Create New Project calls it directly. */
        create: Action;
        /**
         * With it, Create New Project… opens the dialog that chooses where to create the project, and calls this
         * for a folder or a GitHub repository (see `renderNewProjectForm`). The in-memory choice still calls `create`.
         */
        createIn?: (request: NewProjectRequest, signal: AbortSignal) => Promise<NewProjectResult>;
        /** What the Create New Project… dialog offers besides the in-memory project. */
        newProject?: NewProjectChoices;
        newWindow?: Action;
        open: Action;
        openURL?: Action;
        /** Receives the same creation command as Create New Project, including its destination choices. */
        catalog?: (createProject: Action) => void;
        externalYaml?: React.ReactNode;
        folder?: FolderActions;
        openRemote?: Action;
        storage: ProjectFileStorage;
        /**
         * Save Project for a project with no save target (no file handle, no folder): opens the save form titled
         * `projectFileDialogTitle('save', locale)`, whose file or folder becomes the project's target.
         */
        saveNew?: Action;
        /** Save a Copy of the Project…: writes a copy and never changes the project's target. */
        saveAs?: Action;
        saveCommit?: Action;
        exportProject?: Action;
        properties?: Action;
        diagnostics?: Action;
        payloads?: Action;
        extensions?: Action;
        restore: Action;
        git?: React.ReactNode;
    };
}) {
    const ja = locale.startsWith('ja');
    const [, redraw] = React.useReducer((version: number) => version + 1, 0);
    React.useLayoutEffect(() => workspace?.subscribeSave(redraw), [workspace]);
    const tabShortcut = workspace?.saveScope === 'tab';
    const mac = isMacPlatform();
    const item = ([command, label, action, showShortcut, unavailable]: Entry) => {
        const run = action && (() => {close(); action();});
        return <MenuItem key={command} command={command} onClick={run}>
            <span className="tw-project-file-menu__item" role="button" aria-disabled={!run || undefined} tabIndex={run ? 0 : -1}
                title={!run ? unavailable : undefined}
                aria-keyshortcuts={showShortcut ? (mac ? 'Meta+S' : 'Control+S') : undefined}
                style={!run ? {opacity: 0.5, cursor: 'default'} : undefined} onKeyDown={event => {
                    if (!run || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    run();
                }}>{label}{showShortcut && <kbd className="tw-project-file-menu__shortcut" aria-hidden="true">{mac ? '⌘S' : 'Ctrl+S'}</kbd>}</span>
        </MenuItem>;
    };
    const e = entries;
    const createIn = e.createIn;
    const createNew: Action = createIn ? () => {
        if (typeof document === 'undefined') return;
        void openNewProjectDialog(document, locale, {...e.newProject, create: e.create, createIn});
    } : e.create;
    return <>
        {item(['new', ja ? `新しいプロジェクトを作成${createIn ? '…' : ''}` : `Create New Project${createIn ? '…' : ''}`, createNew])}
        {e.newWindow && item(['window', ja ? '新しいウィンドウ' : 'New Window', e.newWindow])}
        <MenuSection>
            {e.catalog && item(['projects', ja ? 'プロジェクト一覧…' : 'Projects…', () => e.catalog!(createNew)])}
            {item(['open', ja ? 'SB3ファイルを開く…' : 'Open SB3 File…', e.open])}
            {e.openURL && item(['open-url', ja ? 'SB3ファイルのURLを開く…' : 'Open SB3 File URL…', e.openURL])}
            {/* Safari and Firefox cannot pick folders on the device; the browser's folders have their own item. */}
            {e.folder && item(['project-folder-open', ja ? 'フォルダを開く…' : 'Open Folder…',
                e.folder.deviceFolders === false ? undefined : e.folder.open, false,
                ja ? 'このブラウザーでは端末のフォルダを開けません。Chrome か Edge を使うか、ブラウザーに保存したフォルダを開いてください。' :
                    'This browser cannot open folders on your device. Use Chrome or Edge, or open a folder saved in this browser.'])}
            {e.folder?.openBrowser && item(['project-folder-open-browser',
                ja ? 'ブラウザーに保存したフォルダを開く…' : 'Open Folder Saved in This Browser…', e.folder.openBrowser])}
            {e.openRemote && item(['git-open-remote',
                ja ? 'Git のリモートリポジトリを開く…' : 'Open Remote Git Repository…', e.openRemote])}
            {e.git}
            {e.externalYaml}
        </MenuSection>
        <MenuSection>
            {saveEntries(locale, e).map(([command, label, action]) => item([command, label, action,
                command === 'save' && !tabShortcut]))}
            {tabShortcut && item(['save-tab', ja ? 'アクティブなタブを保存' : 'Save Active Tab',
                workspace.canSaveActive ? () => {void workspace.saveActive();} : undefined, true])}
            {e.exportProject && item(['package', ja ? '書き出し…' : 'Export…', e.exportProject])}
        </MenuSection>
        {(e.properties || e.payloads || e.extensions || e.diagnostics) && <MenuSection>
            {([
                ['properties', ja ? '作品のプロパティ' : 'Project Properties', e.properties],
                ['payloads', ja ? '組み込みデータ…' : 'Project Data…', e.payloads],
                ['extension', ja ? '機能拡張…' : 'Extensions…', e.extensions],
                ['diagnostics', ja ? '作品の診断…' : 'Project Diagnostics…', e.diagnostics]
            ] as Entry[]).filter(([, , callback]) => callback).map(item)}
        </MenuSection>}
        <MenuSection>
            {item(['restore', ja ? '復元ポイント' : 'Restore Points', e.restore])}
        </MenuSection>
    </>;
}
