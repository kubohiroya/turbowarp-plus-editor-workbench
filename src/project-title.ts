import {projectTitleFieldClassName} from './info-menu.tsx';
import {askSaveName, isValidSaveName, suggestSaveName} from './save-name.ts';

/**
 * Calls `onCommit` with the new title when the person commits an edit of the menu bar's title field
 * ({@link projectTitleFieldClassName}), on Enter or when the field loses focus, as the GUI's own field does. Each
 * edit is reported once. Enter while an IME is composing does not commit, and a title that did not change is not
 * reported. Titles set by loading, a new project or the properties are not edits of the field, so they are not
 * reported either. `readTitle` reads the project title the GUI holds; it is read one tick after the event, once the
 * GUI has written the field's value. Returns a function that stops watching.
 */
export function followProjectTitleCommits(document: Document, {readTitle, onCommit}: {
    readTitle(): string;
    onCommit(title: string): void;
}): () => void {
    const view = document.defaultView;
    if (!view) return () => {};
    const isTitleField = (target: EventTarget | null) =>
        target instanceof view.HTMLInputElement && target.classList.contains(projectTitleFieldClassName);
    let before: string | null = null;
    let scheduled = false;
    let stopped = false;
    const focus = (event: Event) => {
        if (isTitleField(event.target) && !scheduled) before = readTitle();
    };
    const settle = (event: Event) => {
        if (before === null || scheduled || !isTitleField(event.target)) return;
        if (event.type === 'keydown' && ((event as KeyboardEvent).key !== 'Enter' || (event as KeyboardEvent).isComposing)) return;
        const previous = before;
        scheduled = true;
        // The field writes the title after this event (Enter also blurs it); read it once the GUI has handled both.
        view.setTimeout(() => {
            scheduled = false;
            if (stopped) return;
            const title = readTitle();
            before = isTitleField(document.activeElement) ? title : null;
            if (title !== previous) onCommit(title);
        }, 0);
    };
    document.addEventListener('focusin', focus, true);
    document.addEventListener('keydown', settle, true);
    document.addEventListener('change', settle, true);
    document.addEventListener('focusout', settle, true);
    return () => {
        stopped = true;
        document.removeEventListener('focusin', focus, true);
        document.removeEventListener('keydown', settle, true);
        document.removeEventListener('change', settle, true);
        document.removeEventListener('focusout', settle, true);
    };
}

/** Where the open project is saved, for {@link reflectProjectTitle}. */
export type ProjectTitleLocation = 'browser' | 'device' | 'none';

/**
 * What renaming the GitHub repository came to: `renamed`; `unchanged` (it already has the name); `name-unavailable`
 * (the owner has a repository with the name); `permission-required` (the GitHub App installation has not approved
 * Administration: Read and write); `forbidden` (the person is not an admin of the repository); `not-connected` (no
 * write connection to the repository); `unavailable` (the connection cannot rename); `unknown` (GitHub may have renamed
 * it); `origin-failed` (renamed on GitHub, but the local `origin` could not be rewritten); `failed`.
 */
export type RepositoryRenameOutcome = 'renamed' | 'unchanged' | 'name-unavailable' | 'permission-required' | 'forbidden' |
    'not-connected' | 'unavailable' | 'unknown' | 'origin-failed' | 'failed';

/**
 * What renaming a folder on the device came to (Desktop only): `renamed`, after which the folder must be opened again;
 * `unchanged`; `canceled` (the person closed the folder dialog); `mismatch` (another folder was picked); `exists`
 * (the name is taken next to it); `unsaved` (there are unsaved changes, which could no longer be saved to the old
 * folder); `failed`.
 */
export type DeviceFolderRenameOutcome = 'renamed' | 'unchanged' | 'canceled' | 'mismatch' | 'exists' | 'unsaved' | 'failed';

/** A button on a notice, such as opening the renamed folder again. */
export interface ProjectTitleNoticeAction {
    label: string;
    run(): void;
}

export interface ReflectProjectTitleOptions {
    /** The document that shows the save name question. */
    document: Document;
    locale: string;
    /** The title the person committed. */
    title: string;
    /** The project's save name, `''` when it has none. */
    saveName: string;
    /**
     * Where the project is saved: `browser` for a project folder in the browser's own storage, which can be renamed;
     * `device` for a folder on the device, which only Desktop can rename; `none` when it is not saved in a folder.
     */
    location: ProjectTitleLocation;
    /** Whether the folder is bound to a Git repository. */
    gitBound: boolean;
    /** Renames the project folder in the browser's storage; failures are ignored. Needed for `browser`. */
    renameBrowserFolder?(title: string): Promise<void>;
    /**
     * Renames the GitHub repository to the save name and rewrites `origin` (#681). Without it, a Git repository keeps
     * its name and a notice says so.
     */
    renameRepository?(name: string): Promise<RepositoryRenameOutcome>;
    /** Renames the folder on the device to the save name (Desktop, #681). Without it, the folder keeps its name. */
    renameDeviceFolder?(name: string): Promise<DeviceFolderRenameOutcome>;
    /** Opens the renamed device folder again; offered as a button on the notice. */
    reopenDeviceFolder?(): void;
    /** Sets the project's save name, after the person entered one. */
    setSaveName(name: string): void;
    /** Shows a short notice, such as with {@link showNotice}, with an optional button. */
    notify(text: string, action?: ProjectTitleNoticeAction): void;
    /**
     * Whether the same project is still open. Checked after each wait, so a title committed just before another
     * project opened does not rename or name the new one. Defaults to always true.
     */
    current?(): boolean;
}

function repositoryNote(outcome: RepositoryRenameOutcome, name: string, ja: boolean): string | null {
    switch (outcome) {
    case 'renamed': return ja ? `GitHub のリポジトリ名を「${name}」に変えました。` : `Renamed the GitHub repository to “${name}”.`;
    case 'unchanged': return null;
    case 'name-unavailable': return ja ?
        `GitHub に「${name}」という名前のリポジトリが既にあるので、リポジトリ名は変わりません。作品のプロパティで保存用の別名を変えられます。` :
        `A GitHub repository named “${name}” already exists, so the repository keeps its name. You can change the save name in the project properties.`;
    case 'permission-required': return ja ?
        'リポジトリ名を変えるには、GitHub App の Administration（Read and write）の権限をインストール先で承認する必要があります（GitHub の Settings → Applications → Installed GitHub Apps → Configure）。承認するまで、リポジトリ名は変わりません。' :
        'To rename the repository, approve the GitHub App’s Administration (Read and write) permission on its installation (GitHub Settings → Applications → Installed GitHub Apps → Configure). Until then the repository keeps its name.';
    case 'forbidden': return ja ? 'このリポジトリの管理者ではないので、リポジトリ名は変わりません。' :
        'You are not an admin of this repository, so it keeps its name.';
    case 'not-connected': return ja ? 'Git パネルで書き込みできる接続をしていないので、リポジトリ名は変わりません。' :
        'The Git panel has no connection that can write to the repository, so it keeps its name.';
    case 'unavailable': return ja ? 'この Git の接続ではリポジトリ名を変えられないので、リポジトリ名は変わりません。' :
        'This Git connection cannot rename repositories, so the repository keeps its name.';
    case 'unknown': return ja ? 'リポジトリ名が変わったか確かめられませんでした。GitHub でリポジトリ名を確かめてください。' :
        'Could not confirm whether the repository was renamed. Check its name on GitHub.';
    case 'origin-failed': return ja ?
        `GitHub のリポジトリ名は「${name}」に変わりましたが、手元のリポジトリの origin を書き換えられませんでした。` :
        `The GitHub repository was renamed to “${name}”, but the local repository’s origin could not be rewritten.`;
    case 'failed': return ja ? 'リポジトリ名を変えられませんでした。' : 'Could not rename the repository.';
    }
}

function deviceFolderNote(outcome: DeviceFolderRenameOutcome, name: string, ja: boolean): string | null {
    switch (outcome) {
    case 'renamed': return ja ? `作品フォルダの名前を「${name}」に変えました。続けて作業するには、フォルダを開き直してください。` :
        `Renamed the project folder to “${name}”. Open the folder again to keep working.`;
    case 'unchanged': return null;
    case 'canceled': return ja ? 'フォルダ名は変えませんでした。' : 'The folder keeps its name.';
    case 'mismatch': return ja ? '選んだフォルダが開いている作品のフォルダと違うので、フォルダ名は変えませんでした。' :
        'The chosen folder is not the open project’s folder, so no folder was renamed.';
    case 'exists': return ja ? `同じ場所に「${name}」があるので、フォルダ名は変えませんでした。` :
        `“${name}” already exists next to the folder, so the folder keeps its name.`;
    case 'unsaved': return ja ? '保存していない変更があるので、フォルダ名は変えませんでした。保存してから作品名を変えると、フォルダ名も変わります。' :
        'There are unsaved changes, so the folder keeps its name. Save first; then a title change also renames the folder.';
    case 'failed': return ja ? 'フォルダ名を変えられませんでした。' : 'Could not rename the folder.';
    }
}

/**
 * Reflects a title the person committed in the menu bar on what the project is saved in. A folder in the browser's
 * storage is renamed to the title. A Git repository is renamed on GitHub with `renameRepository`, and a folder on
 * the device with `renameDeviceFolder` (Desktop); both take the save name: the title when it is a valid save name
 * ({@link isValidSaveName}), otherwise the project's save name, which the person is asked for ({@link askSaveName})
 * when there is none. Without those functions they keep their names and a notice says so. An empty title, or a
 * project that is not saved in a folder, changes nothing.
 */
export async function reflectProjectTitle({document, locale, title, saveName, location, gitBound, renameBrowserFolder,
    renameRepository, renameDeviceFolder, reopenDeviceFolder, setSaveName, notify, current = () => true}: ReflectProjectTitleOptions): Promise<void> {
    if (location === 'none' && !gitBound || !title.trim()) return;
    const ja = locale.startsWith('ja');
    if (location === 'browser' && renameBrowserFolder) await renameBrowserFolder(title).catch(() => {});
    if (!current()) return;
    let name = isValidSaveName(title) ? title : saveName;
    if (!name) {
        const entered = await askSaveName({document, locale, title, current: suggestSaveName(title) || undefined});
        if (!current()) return;
        if (entered) {
            setSaveName(entered);
            name = entered;
        }
    }
    const notes: string[] = [];
    let reopen = false;
    if (gitBound) {
        if (!renameRepository) notes.push(ja ? 'Git のリポジトリの名前は変わりません。' : 'The Git repository keeps its name.');
        else if (name) {
            const note = repositoryNote(await renameRepository(name).catch(() => 'failed' as const), name, ja);
            if (!current()) return;
            if (note) notes.push(note);
        }
    }
    if (location === 'device') {
        if (!renameDeviceFolder) notes.push(ja ?
            'この作品のフォルダは手元のフォルダなので、フォルダ名は変わりません（ブラウザー版では手元のフォルダ名を変えられません）。' :
            'This project folder is on your device, so its name stays as it is (the browser version cannot rename folders on your device).');
        else if (name) {
            const outcome = await renameDeviceFolder(name).catch(() => 'failed' as const);
            const note = deviceFolderNote(outcome, name, ja);
            if (note) notes.push(note);
            reopen = outcome === 'renamed';
        }
    }
    if (!notes.length) return;
    // A renamed folder must be opened again even when another project opened meanwhile.
    if (reopen && reopenDeviceFolder) {
        notify(notes.join(' '), {label: ja ? 'フォルダを開き直す' : 'Open the folder again', run: reopenDeviceFolder});
    } else if (current()) notify(notes.join(' '));
}
