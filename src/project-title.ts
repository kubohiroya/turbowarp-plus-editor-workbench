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
     * `device` for a folder on the device, which the browser cannot rename; `none` when it is not saved in a folder.
     */
    location: ProjectTitleLocation;
    /** Whether the folder is bound to a Git repository, whose name does not change. */
    gitBound: boolean;
    /** Renames the project folder in the browser's storage; failures are ignored. Needed for `browser`. */
    renameBrowserFolder?(title: string): Promise<void>;
    /** Sets the project's save name, after the person entered one. */
    setSaveName(name: string): void;
    /** Shows a short notice, such as with {@link showNotice}. */
    notify(text: string): void;
    /**
     * Whether the same project is still open. Checked after each wait, so a title committed just before another
     * project opened does not rename or name the new one. Defaults to always true.
     */
    current?(): boolean;
}

/**
 * Reflects a title the person committed in the menu bar on what the project is saved in. A folder in the browser's
 * storage is renamed to the title; a folder on the device and a Git repository keep their names, and a notice says
 * so. When the project is saved in a folder or repository, has no save name and the title cannot be used as one
 * ({@link isValidSaveName}), the person is asked for a save name ({@link askSaveName}). An empty title, or a project
 * that is not saved in a folder, changes nothing.
 */
export async function reflectProjectTitle({document, locale, title, saveName, location, gitBound, renameBrowserFolder,
    setSaveName, notify, current = () => true}: ReflectProjectTitleOptions): Promise<void> {
    if (location === 'none' && !gitBound || !title.trim()) return;
    const ja = locale.startsWith('ja');
    if (location === 'browser' && renameBrowserFolder) await renameBrowserFolder(title).catch(() => {});
    if (!current()) return;
    if (!isValidSaveName(title) && !saveName) {
        const name = await askSaveName({document, locale, title, current: suggestSaveName(title) || undefined});
        if (name && current()) setSaveName(name);
    }
    const notes: string[] = [];
    if (location === 'device') notes.push(ja ?
        'この作品のフォルダは手元のフォルダなので、フォルダ名は変わりません（ブラウザー版では手元のフォルダ名を変えられません）。' :
        'This project folder is on your device, so its name stays as it is (the browser version cannot rename folders on your device).');
    // Renaming the GitHub repository needs the keybroker's rename route first (#681).
    if (gitBound) notes.push(ja ? 'Git のリポジトリの名前は、まだ変わりません。' : 'The Git repository keeps its name for now.');
    if (notes.length && current()) notify(notes.join(' '));
}
