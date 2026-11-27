import {dialogAction, dialogActions} from '@kubohiroya/turbowarp-plus-editor-windows';
import type {CreationInteraction, GitHubCreationAccount, GitHubRepositoryDraft, RepositoryCreationControls,
    RepositoryCreationProgress, RepositoryReceipt} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-creation';
import {checkSaveNameInput, isValidSaveName, saveNameTexts, suggestSaveName} from './save-name.js';
import type {ProjectSb3Format} from './project-tools/format.js';

export {askSaveName, isValidSaveName, suggestSaveName} from './save-name.js';

export type Action = () => void;
// `openBrowser` opens a folder kept in the browser (OPFS), where the host offers one.
export type FolderActions = {open: Action; openBrowser?: Action;
    /** Whether Open can pick a folder on the device; `false` in browsers without the folder picker (Safari, Firefox). */
    deviceFolders?: boolean; save?: Action; detach: Action};
export type SaveFormat = 'current' | 'embedded' | 'folder';
export type Serialize = <T>(run: () => T) => T;

export type SaveAsRequest =
    | {name: string; format: 'current' | 'embedded'}
    | {name: string; format: 'folder'; git?: GitHubRepositoryDraft};

export interface SaveAsFormOptions {
    openCommit?: Action;
    folder?: {
        /**
         * `browser` keeps the new folder in the browser, as the project folder package does where there is no folder
         * picker. The form then offers the folder format without the picker, keeps the name for the new folder, and
         * leaves out the overwrite warning, since such a folder is always new. Defaults to `device`.
         */
        location?: 'device' | 'browser';
        overwriteWarning?: string;
        github?: {
            // The host can reuse a current session or open sign-in. The form retains its draft either way.
            connectForCreation(interaction: CreationInteraction): Promise<GitHubCreationAccount | null>;
            licenses?: readonly {id: string; label: string}[];
            publication?: RepositoryCreationControls;
        };
    };
}

export interface ProjectFileStorage {
    canSave: boolean;
    filename: string;
    overwrite?: Action;
    pick?: (filename: string) => Promise<FileSystemFileHandle>;
    write(handle: FileSystemFileHandle, serialize: Serialize, current: () => boolean, useProjectFormat?: boolean): Promise<void>;
    download(filename: string, serialize: Serialize, current: () => boolean, useProjectFormat?: boolean): Promise<void>;
    /**
     * Called after a copy was written by {@link saveProjectAs} in the `copy` mode, with the file it was written to
     * (`null` for a download) and the title stored in the copy. The host ends its save indicator here. It must not
     * make the copy the current file, change the project title, or mark the project as saved: the project keeps its
     * own file, folder and unsaved changes.
     */
    copied?(handle: FileSystemFileHandle | null, title: string): void;
    /**
     * Called after {@link saveProjectAs} in the `save` mode (Save Project for a project with no save target yet):
     * the written file becomes the project's file (`null` for a download), `title` its title, and `unchanged` says
     * whether the project was not edited while saving, so the host can mark it saved. Never called for a copy.
     */
    finish(handle: FileSystemFileHandle | null, title: string, unchanged: boolean): void;
    fail(error: unknown): void;
}

/**
 * The titles of the dialogs this package fills, by the File menu command that opens them: `save` is "Save Project"
 * (the save form for a project with no save target yet), `save-as` is "Save a Copy of the Project" and `new` is
 * "Create New Project".
 */
export function projectFileDialogTitle(command: 'save' | 'save-as' | 'new', locale: string) {
    const ja = locale.startsWith('ja');
    return command === 'new' ? (ja ? '新しいプロジェクトを作成' : 'Create New Project') :
        command === 'save' ? (ja ? 'プロジェクトを保存' : 'Save Project') :
            (ja ? 'プロジェクトのコピーを保存' : 'Save a Copy of the Project');
}

/**
 * Saving over the last file or into the project folder first collects edits held by other windows,
 * as Save As does, so a save that does not move the focus to the editor misses nothing. A failed
 * collection reports the failure, does not save, and leaves those edits for a retry.
 */
export function collectBeforeSaving(storage: ProjectFileStorage, folder: FolderActions | undefined,
    collect: () => Promise<void>) {
    const first = (action?: Action) => action && (async () => {
        try {
            await collect();
        } catch (error) {
            storage.fail(error);
            return;
        }
        action();
    });
    return {
        storage: storage.overwrite ? {...storage, overwrite: first(storage.overwrite)} : storage,
        folder: folder?.save ? {...folder, save: first(folder.save)} : folder
    };
}

/**
 * Save Project and Ctrl/⌘+S: overwrite the project's file or save into its folder; with no save target yet, run
 * `saveNew`, which opens the save form whose result becomes the target. Pass the save-to-a-new-place action here,
 * never Save a Copy, or a project without a target would only ever be copied.
 */
export function projectSaveShortcut(storage: ProjectFileStorage, folder?: FolderActions, saveNew?: Action) {
    if (storage.canSave) (storage.overwrite || folder?.save || saveNew)?.();
}

/**
 * Saves the project as an SB3: picks the file (or downloads it), collects edits held by other windows, serializes
 * it under the file's title and writes it, then runs `committed`.
 *
 * - `mode: 'copy'` (the default, Save a Copy of the Project): the project stays as it was; its file, folder, title
 *   and unsaved state do not change. `storage.copied` runs last.
 * - `mode: 'save'` (Save Project with no save target yet): the file becomes the project's save target through
 *   `storage.finish(handle, title, unchanged())`.
 */
export async function saveProjectAs(storage: ProjectFileStorage, name: string, {
    current, unchanged, serialize, committed, collect, mode = 'copy', useProjectFormat
}: {
    current(): boolean;
    /** Whether the project was not edited while saving; used by the `save` mode only. */
    unchanged?(): boolean;
    mode?: 'copy' | 'save';
    useProjectFormat?: boolean;
    serialize<T>(title: string, run: () => T): T;
    committed(): void;
    // Collects edits still held by other windows. A failure leaves them there for a retry.
    collect?(): Promise<void>;
}) {
    if (!storage.canSave || !current()) return false;
    const filename = name + '.sb3';
    try {
        const handle = storage.pick ? await storage.pick(filename) : null;
        if (!current()) return false;
        await collect?.();
        if (!current()) return false;
        const title = handle ? handle.name.replace(/\.sb3$/i, '').slice(0, 100) : name;
        const output: Serialize = run => {
            if (!current()) throw new DOMException('The project changed', 'AbortError');
            return serialize(title, run);
        };
        if (handle) await storage.write(handle, output, current, useProjectFormat);
        else await storage.download(filename, output, current, useProjectFormat);
        if (!current()) return false;
        committed();
        if (mode === 'save') storage.finish(handle, title, unchanged ? unchanged() : true);
        else storage.copied?.(handle, title);
        return true;
    } catch (error) {
        storage.fail(error);
        return false;
    }
}

const validRepositoryName = isValidSaveName;

function parseGitHubRepositoryUrl(url: string) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,104})\/?$/i.exec(url.trim());
    const name = match?.[2].replace(/\.git$/iu, '');
    return name && validRepositoryName(name) ? {owner: match[1], name} : null;
}
const invalidDraft = (message: string) => Object.assign(new Error(message), {code: 'invalidDraft'});

const readTopics = (value: string) => value.split(',').map(topic => topic.trim()).filter(Boolean);
const validTopics = (topics: readonly string[]) => topics.length <= 20 &&
    topics.every(topic => /^[a-z0-9][a-z0-9-]{0,49}$/.test(topic));

function appendOption(select: HTMLSelectElement, title: string, value: string) {
    const option = select.ownerDocument.createElement('option');
    option.textContent = title;
    option.value = value;
    select.append(option);
}

function appendField(parent: HTMLElement, title: string, input: HTMLElement) {
    const label = parent.ownerDocument.createElement('label');
    label.append(title, input);
    parent.append(label);
    return label;
}

type GitHubCreationProvider = NonNullable<NonNullable<SaveAsFormOptions['folder']>['github']>;

function createGitHubFields(document: Document, label: (ja: string, en: string) => string,
    provider: GitHubCreationProvider, report: (message: string) => void) {
    const panel = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = label('GitHub リポジトリ', 'GitHub repository');
    const identity = document.createElement('p');
    identity.hidden = true;
    panel.append(legend, identity);

    const owner = document.createElement('select');
    owner.name = 'github-owner';
    owner.disabled = true;
    appendField(panel, label('作成先', 'Repository owner'), owner);
    const name = document.createElement('input');
    name.name = 'github-name';
    name.maxLength = 100;
    // A name the person typed is kept; until then the name follows the suggestion from the form.
    let nameEdited = false;
    name.addEventListener('input', () => {nameEdited = true;});
    appendField(panel, label('リポジトリ名', 'Repository name'), name);
    const url = document.createElement('input');
    url.name = 'github-url';
    url.inputMode = 'url';
    url.placeholder = 'https://github.com/owner/repository';
    appendField(panel, label('GitHub URL（任意）', 'GitHub URL (optional)'), url);
    const description = document.createElement('input');
    description.name = 'github-description';
    description.maxLength = 350;
    appendField(panel, label('概要', 'Description'), description);
    const topics = document.createElement('input');
    topics.name = 'github-topics';
    appendField(panel, label('トピック（カンマ区切り）', 'Topics (comma separated)'), topics);
    const topicError = label('トピックは小文字・数字・ハイフンで、1件50文字以内、20件以内です。',
        'Use at most 20 topics, each up to 50 characters, with lowercase letters, digits, and hyphens.');
    topics.oninput = () => {
        const valid = validTopics(readTopics(topics.value));
        topics.setAttribute('aria-invalid', String(!valid));
        report(valid ? '' : topicError);
    };
    const license = document.createElement('select');
    license.name = 'github-license';
    appendOption(license, label('なし', 'None'), '');
    for (const choice of provider.licenses ?? []) appendOption(license, choice.label, choice.id);
    appendField(panel, label('ライセンス', 'License'), license);
    const visibility = document.createElement('select');
    visibility.name = 'github-visibility';
    appendOption(visibility, label('非公開', 'Private'), 'private');
    appendOption(visibility, label('公開', 'Public'), 'public');
    appendField(panel, label('公開範囲', 'Visibility'), visibility);

    let account: GitHubCreationAccount | null = null;
    let requestedOwner: string | null = null;
    const fillOwners = (current: GitHubCreationAccount) => {
        const expected = requestedOwner ?? owner.value;
        owner.replaceChildren();
        for (const choice of current.owners) appendOption(owner, choice.login, choice.login);
        const selected = [...owner.options].find(choice => choice.value.toLowerCase() === expected.toLowerCase());
        if (selected) owner.value = selected.value;
        else if (expected) {
            appendOption(owner, label(`${expected}（選択不可）`, `${expected} (unavailable)`), expected);
            owner.value = expected;
        }
    };
    owner.onchange = () => { requestedOwner = null; };

    return {
        panel,
        get connected() {return account !== null;},
        suggestName(value: string) {
            if (!nameEdited) name.value = value;
        },
        async connect(open: () => boolean, interaction: CreationInteraction) {
            const result = await provider.connectForCreation(interaction);
            if (!open() || !result) return false;
            account = result;
            identity.hidden = false;
            identity.textContent = label(`GitHub アカウント ${result.account.login}`, `GitHub account ${result.account.login}`);
            fillOwners(result);
            owner.disabled = false;
            return true;
        },
        applyUrl() {
            if (!url.value.trim()) return;
            const parsed = parseGitHubRepositoryUrl(url.value);
            if (!parsed) throw invalidDraft(label('https://github.com/所有者/リポジトリ名 の形式で入力してください。',
                'Enter a URL in the form https://github.com/owner/repository.'));
            requestedOwner = parsed.owner;
            name.value = parsed.name;
            nameEdited = true;
            url.value = '';
            if (account) fillOwners(account);
        },
        draft(title: string): GitHubRepositoryDraft {
            if (!validRepositoryName(name.value.trim())) throw invalidDraft(label('有効なリポジトリ名を入力してください。',
                'Enter a valid repository name.'));
            const topicValues = readTopics(topics.value);
            if (!validTopics(topicValues)) throw invalidDraft(topicError);
            const selectedVisibility = visibility.value === 'public' ? 'public' : 'private';
            const destination = account?.owners.find(choice => choice.login === owner.value);
            if (!account || !destination) throw invalidDraft(label('リポジトリを作成できる作成先を選んでください。',
                'Choose an owner where you can create a repository.'));
            if (!destination.canCreate[selectedVisibility]) throw invalidDraft(label('この作成先では選んだ公開範囲を使えません。',
                'The selected visibility is unavailable for this owner.'));
            return {account: account.account.login, owner: destination.login, name: name.value.trim(), title,
                description: description.value.trim(), topics: [...new Set(topicValues)], license: license.value || null,
                visibility: selectedVisibility};
        },
        review(draft: GitHubRepositoryDraft, container: HTMLElement) {
            const heading = document.createElement('h3');
            heading.textContent = label('GitHub リポジトリ作成の確認', 'Review GitHub repository creation');
            heading.tabIndex = -1;
            const details = document.createElement('dl');
            const empty = label('なし', 'None');
            for (const [title, value] of [
                [label('GitHub アカウント', 'GitHub account'), draft.account],
                [label('リポジトリ', 'Repository'), `https://github.com/${draft.owner}/${draft.name}`],
                [label('タイトル', 'Title'), draft.title],
                [label('概要', 'Description'), draft.description || empty],
                [label('トピック', 'Topics'), draft.topics.join(', ') || empty],
                [label('ライセンス', 'License'), license.selectedOptions[0]?.textContent || empty],
                [label('公開範囲', 'Visibility'), draft.visibility === 'private' ? label('非公開', 'Private') : label('公開', 'Public')]
            ]) {
                const term = document.createElement('dt');
                term.textContent = title;
                const definition = document.createElement('dd');
                definition.textContent = value;
                details.append(term, definition);
            }
            container.replaceChildren(heading, details);
            return heading;
        }
    };
}

export function renderSaveAsForm(document: Document, locale: string, storage: ProjectFileStorage,
    save: (request: SaveAsRequest, open: () => boolean, signal: AbortSignal) =>
        Promise<boolean | RepositoryCreationProgress | null>, close: Action,
    {folder, openCommit}: SaveAsFormOptions = {}) {
    const label = (ja: string, en: string) => locale.startsWith('ja') ? ja : en;
    const form = document.createElement('form');
    const fields = document.createElement('div');
    const name = document.createElement('input');
    name.name = 'title';
    name.required = true;
    name.maxLength = 100;
    name.value = storage.filename.replace(/\.sb3$/i, '');
    const nameField = appendField(fields, label('名前', 'Name'), name);
    const format = document.createElement('select');
    format.name = 'format';
    appendOption(format, label('SB3（現在の格納方式）', 'SB3 (current storage settings)'), 'current');
    appendOption(format, label('SB3（設定対象の台本・素材を同梱）', 'SB3 (embed configured scripts and assets)'), 'embedded');
    const picker = (document.defaultView as (Window & {showDirectoryPicker?: unknown}) | null)?.showDirectoryPicker;
    const inBrowser = folder?.location === 'browser';
    const folderAvailable = folder && (inBrowser || typeof picker === 'function');
    if (folderAvailable) appendOption(format, label('プロジェクトフォルダ', 'Project folder'), 'folder');
    appendField(fields, label('保存形式', 'Save format'), format);

    const status = document.createElement('p');
    status.setAttribute('role', 'alert');
    const report = (message: string) => {status.textContent = message;};
    const git = document.createElement('input');
    git.type = 'checkbox';
    git.name = 'git';
    const gitChoice = document.createElement('div');
    appendField(gitChoice, label('Git でバージョン管理する', 'Use Git version control'), git);
    const github = folderAvailable && folder.github ? createGitHubFields(document, label, folder.github, report) : null;
    if (github) fields.append(gitChoice, github.panel);
    const overwriteWarning = document.createElement('p');
    if (folder?.overwriteWarning) {
        overwriteWarning.textContent = folder.overwriteWarning;
        fields.append(overwriteWarning);
    }
    const publication = github ? folder.github.publication : undefined;
    const pending = document.createElement('ul');
    pending.setAttribute('aria-label', label('未完了のリポジトリ作成', 'Pending repository setup'));
    const device = document.createElement('div');
    const controller = new AbortController();
    const interaction: CreationInteraction = {
        signal: controller.signal,
        deviceCode({userCode, verificationUri}) {
            if (!open()) return;
            const link = document.createElement('a');
            link.href = verificationUri;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label('GitHub で認証する', 'Authorize on GitHub');
            const code = document.createElement('strong');
            code.textContent = userCode;
            device.replaceChildren(link, ' ', code);
        }
    };

    const review = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = label('キャンセル', 'Cancel');
    let dismissed = false;
    const dismiss = () => {dismissed = true; controller.abort(); close();};
    cancel.onclick = dismiss;
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = label('戻る', 'Back');
    const submit = document.createElement('button');
    submit.type = 'submit';
    const recoverAccess = document.createElement('button');
    recoverAccess.type = 'button';
    recoverAccess.textContent = label('ローカルフォルダへのアクセスを許可…', 'Grant Local Folder Access…');
    const actions = dialogActions(document, back, recoverAccess, dialogAction(cancel, 'cancel'),
        dialogAction(submit, 'confirm'));
    form.append(fields, pending, review, device, status, actions);
    const commit = document.createElement('button');
    if (openCommit) {
        commit.type = 'button';
        commit.textContent = label('保存してコミット…', 'Save and Commit…');
        commit.onclick = openCommit;
        actions.prepend(commit);
    }

    type FolderReview = {name: string; format: 'folder'; git: GitHubRepositoryDraft};
    let confirmedDraft: FolderReview | null = null;
    let task: RepositoryCreationProgress | null = null;
    let candidate: RepositoryReceipt | null = null;
    let needsAccess = false;
    let busy = false;
    const open = () => !dismissed && form.isConnected;
    const savingFolder = () => folderAvailable && format.value === 'folder';
    const selectedGitHub = () => savingFolder() && git.checked ? github : null;
    const phaseText = (phase: RepositoryCreationProgress['phase']) => ({
        create: label('GitHub リポジトリ作成待ち', 'Waiting to create the repository'),
        unknown: label('GitHub での作成結果を確認してください。', 'Check whether GitHub created the repository.'),
        prepare: label('GitHub リポジトリを作成しました。ローカルの初回コミットを準備します。',
            'GitHub repository created. The local initial commit is still being prepared.'),
        topics: label('ローカルの初回コミットを保存しました。GitHub のトピック設定を再試行できます。',
            'The local initial commit was saved. You can retry setting GitHub topics.'),
        push: label('ローカルの初回コミットを保存しました。GitHub への初回 push を承認してください。',
            'The local initial commit was saved. Authorize the initial push to GitHub.'),
        open: label('初回 push が完了しました。', 'The initial push is complete.')
    })[phase];
    const actionText = (phase: RepositoryCreationProgress['phase']) => ({
        create: label('リポジトリ作成を再開', 'Resume Repository Creation'),
        unknown: candidate ? label('確認したリポジトリで再開', 'Continue with This Repository') :
            label('作成結果を確認', 'Check Creation Result'),
        prepare: label('ローカルの準備を再開', 'Resume Local Setup'),
        topics: label('トピック設定を再試行', 'Retry Setting Topics'),
        push: label('初回 push を承認…', 'Authorize and Push…'),
        open: label('ローカルの作品を開く', 'Open the Local Project')
    })[phase];
    const refreshTask = () => {
        if (!task) return;
        const heading = document.createElement('h3');
        const link = document.createElement('a');
        link.href = `https://github.com/${task.owner}/${task.name}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = task.owner + '/' + task.name;
        heading.append(link);
        const state = document.createElement('p');
        state.textContent = phaseText(task.phase);
        review.replaceChildren(heading, state);
        if (candidate) {
            const detail = document.createElement('p');
            detail.textContent = label(`空のリポジトリ ID ${candidate.id} を確認しました。表示されたリポジトリで初回設定を続けます。`,
                `An empty repository with ID ${candidate.id} was found. Continue setup with the displayed repository.`);
            review.append(detail);
        }
    };
    const refresh = () => {
        const reviewing = confirmedDraft !== null || task !== null;
        const creation = selectedGitHub();
        // A folder on the device takes its name from the picked folder; a folder in the browser keeps this name.
        const localFolder = savingFolder() && !creation && !inBrowser;
        overwriteWarning.hidden = !localFolder;
        fields.hidden = reviewing;
        review.hidden = !reviewing;
        back.hidden = !confirmedDraft || task !== null;
        back.disabled = busy;
        nameField.hidden = localFolder;
        name.disabled = busy || reviewing || localFolder;
        format.disabled = busy || reviewing;
        git.disabled = busy || reviewing;
        gitChoice.hidden = !savingFolder();
        if (github) {
            github.panel.hidden = !selectedGitHub();
            github.panel.disabled = busy || reviewing || github.panel.hidden;
        }
        submit.disabled = busy;
        recoverAccess.hidden = !task || !needsAccess;
        recoverAccess.disabled = busy;
        commit.disabled = busy || reviewing;
        pending.hidden = reviewing || !pending.childElementCount;
        submit.textContent = task ? actionText(task.phase) : reviewing ? label('リポジトリを作成', 'Create Repository') : creation ?
            (creation.connected ? label('作成内容を確認', 'Review Repository') : label('GitHub へ接続…', 'Connect to GitHub…')) :
            savingFolder() && inBrowser ? label('ブラウザー内に保存…', 'Save in This Browser…') :
            (savingFolder() || storage.pick ? label('保存先を選ぶ…', 'Choose Where to Save…') : label('保存', 'Save'));
    };
    const loadPending = async () => {
        if (!publication) return [];
        const entries = await publication.list();
        if (!open()) return entries;
        const rows = entries.map(entry => {
            const row = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label(`${entry.owner}/${entry.name} の作成を再開`, `Resume setup for ${entry.owner}/${entry.name}`);
            button.onclick = () => {
                if (busy) return;
                task = entry;
                candidate = null;
                needsAccess = false;
                confirmedDraft = null;
                report('');
                refreshTask();
                refresh();
                submit.focus();
            };
            row.append(button);
            return row;
        });
        pending.replaceChildren(...rows);
        refresh();
        return entries;
    };
    const advance = async () => {
        if (task.phase === 'open') {
            if (await publication.open(task) && open()) dismiss();
            return;
        }
        const updated = await publication.advance(task, interaction, candidate?.id);
        if (!open()) return;
        task = updated.progress;
        candidate = updated.candidate ?? null;
        refreshTask();
        if (updated.candidate === null) report(label('再開できる空のリポジトリを確認できませんでした。',
            'No empty repository was verified for resuming this setup.'));
    };
    const showError = (error: unknown) => {
        const code = (error as {code?: string})?.code;
        switch (code) {
        case 'invalidDraft': return (error as Error).message;
        case 'directoryNotEmpty': return label('空のフォルダを選んでください。', 'Choose an empty directory.');
        case 'directoryPermission': return label('同じローカルフォルダへのアクセスを許可してから再開してください。',
            'Grant access to the same local folder before resuming.');
        case 'differentDirectory': return label('最初に選んだローカルフォルダを選び直してください。',
            'Choose the same local folder you selected initially.');
        case 'popupBlocked': return label('GitHub 認証のポップアップを許可して再試行してください。',
            'Allow the GitHub authorization popup and try again.');
        case 'unknown': return label('GitHub の作成結果を確認できませんでした。作成結果を照会してください。',
            'GitHub did not confirm the creation result. Check the recorded result.');
        case 'nameConflict': return label('同名のリポジトリがすでにあります。', 'A repository with this name already exists.');
        case 'pendingRepository': return label('同じリポジトリの設定を再開してください。', 'Resume the existing setup for this repository.');
        case 'insufficientPermission': case 'forbidden': case 'denied': case 'session':
            return label('GitHub のアカウントと権限を確認して再試行してください。', 'Check the GitHub account and permissions, then retry.');
        case 'rateLimited': return label('GitHub の利用上限に達しました。しばらくしてから再試行してください。',
            'GitHub rate limited this request. Try again later.');
        case 'diverged': return label('GitHub に異なる履歴があるため、初回 push を停止しました。',
            'The initial push stopped because the GitHub repository has different history.');
        case 'pushUnknown': return label('初回 push の結果を確認できません。再試行して GitHub の状態を確認してください。',
            'The initial push result could not be confirmed. Retry to check the GitHub repository.');
        default: return label('リポジトリの設定を完了できませんでした。', 'Could not complete repository setup.');
        }
    };
    recoverAccess.onclick = () => {
        if (!task || busy) return;
        busy = true;
        refresh();
        void publication.grantAccess(task).then(granted => {
            if (!granted || !open()) return;
            needsAccess = false;
            report('');
        }, error => {if (open()) report(showError(error));}).finally(() => {
            busy = false;
            if (open()) refresh();
        });
    };
    format.onchange = git.onchange = () => {report(''); refresh();};
    back.onclick = () => {
        confirmedDraft = null;
        report('');
        refresh();
        submit.focus();
    };
    refresh();
    if (publication) queueMicrotask(() => {if (open()) void loadPending().catch(error => report(showError(error)));});
    if (github && document.defaultView?.MutationObserver) {
        const observer = new document.defaultView.MutationObserver(() => {
            if (!open()) {observer.disconnect(); controller.abort();}
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }

    form.onsubmit = async event => {
        event.preventDefault();
        const value = name.value.trim();
        const title = savingFolder() ? value : value.replace(/\.sb3$/i, '');
        if (!open() || busy || (!task && !confirmedDraft && !title && !name.disabled)) return;
        report('');
        busy = true;
        refresh();
        let focus: HTMLElement | null = null;
        try {
            if (task) {await advance(); return;}
            const creation = selectedGitHub();
            if (creation && !confirmedDraft) {
                creation.applyUrl();
                if (!creation.connected) {
                    report(label('GitHub に接続しています…', 'Connecting to GitHub…'));
                    if (await creation.connect(open, interaction)) focus = submit;
                    if (open()) report('');
                    return;
                }
                confirmedDraft = {name: title, format: 'folder', git: creation.draft(title)};
                focus = creation.review(confirmedDraft.git, review);
                return;
            }
            const request: SaveAsRequest = confirmedDraft ?? (savingFolder() ? {name: title, format: 'folder'} :
                {name: title, format: format.value === 'embedded' ? 'embedded' : 'current'});
            const result = await save(request, open, controller.signal);
            if (!open()) return;
            if (result === true) dismiss();
            else if (result && publication) {
                task = result;
                confirmedDraft = null;
                refreshTask();
                refresh();
                await advance();
            }
        } catch (error) {
            if (open() && publication && (task || confirmedDraft || selectedGitHub())) {
                const entries = await loadPending().catch(() => []);
                if (!open()) return;
                if (task) {
                    task = entries.find(entry => entry.operationId === task.operationId) ?? null;
                    candidate = null;
                    if ((error as {code?: string})?.code === 'directoryPermission') needsAccess = true;
                    refreshTask();
                }
                report(showError(error));
            } else if (open()) report(error instanceof Error ? error.message : String(error));
        } finally {
            device.replaceChildren();
            busy = false;
            if (open()) {refresh(); focus?.focus();}
        }
    };
    return form;
}

export function renderExportView(document: Document, locale: string, close: Action, run: Action) {
    const ja = locale.startsWith('ja');
    const view = document.createElement('div');
    const explanation = document.createElement('p');
    explanation.textContent = ja ?
        '実行・配布用のファイルを作成します。書き出しに必要な作品データは出力に同梱されます。' :
        'Create a file for running or sharing the project. Project data needed for export is included in the output.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = ja ? 'プロジェクトをパッケージ化する' : 'Package Project';
    button.onclick = () => {close(); run();};
    view.append(explanation, dialogActions(document, dialogAction(button, 'confirm')));
    return view;
}

export type ExtensionStorage = 'remote-non-cacheable' | 'remote-cacheable' | 'embedded-file' | 'embedded-data';

export function renderExtensionsForm(document: Document, locale: string, close: Action, add: Action | undefined, {
    list, change
}: {
    list(): Promise<{id: string; format?: ExtensionStorage; editable?: boolean}[]>;
    change(changes: Map<string, ExtensionStorage>): Promise<void>;
}) {
    const ja = locale.startsWith('ja');
    const form = document.createElement('form');
    const entries = document.createElement('ul');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = ja ? '確認中…' : 'Inspecting…';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = ja ? '閉じる' : 'Close';
    done.onclick = close;
    const apply = document.createElement('button');
    apply.textContent = ja ? '格納方式を適用' : 'Apply Storage Settings';
    apply.disabled = true;
    const actions = dialogActions(document, dialogAction(done, 'close'), dialogAction(apply, 'confirm'));
    form.append(entries, status, actions);
    if (add) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = ja ? '機能拡張の追加' : 'Add Extension';
        button.onclick = () => {close(); add();};
        actions.prepend(button);
    }
    const labels = {
        'remote-non-cacheable': ja ? 'HTTPSから毎回取得' : 'Fetch from HTTPS each time',
        'remote-cacheable': ja ? 'HTTPSから取得・キャッシュ可' : 'Fetch from HTTPS, caching allowed',
        'embedded-file': ja ? 'SB3内のファイル' : 'File in the SB3',
        'embedded-data': ja ? '作品JSON内のデータ' : 'Data in the project JSON'
    };
    const choices = new Map<string, {original: ExtensionStorage; input: HTMLSelectElement}>();
    const changed = () => new Map([...choices].filter(([, choice]) => choice.input.value !== choice.original)
        .map(([id, choice]) => [id, choice.input.value as ExtensionStorage]));
    void list().then(items => {
        status.textContent = items.length ? '' : (ja ? '使用中の機能拡張はありません。' : 'No extensions in use.');
        for (const item of items) {
            const li = document.createElement('li');
            if (!item.editable) {
                li.textContent = item.format ? `${item.id} — ${labels[item.format]}` : item.id;
            } else {
                const label = document.createElement('label');
                const input = document.createElement('select');
                for (const [value, title] of Object.entries(labels)) input.add(new Option(title, value));
                input.value = item.format;
                input.onchange = () => {apply.disabled = !changed().size;};
                choices.set(item.id, {original: item.format, input});
                label.append(item.id, input);
                li.append(label);
            }
            entries.append(li);
        }
    }, error => {status.textContent = error.message;});
    form.onsubmit = async event => {
        event.preventDefault();
        if (apply.disabled) return;
        apply.disabled = true;
        status.textContent = ja ? '適用中…' : 'Applying…';
        for (const {input} of choices.values()) input.disabled = true;
        try {
            await change(changed());
            if (form.isConnected) close();
        } catch (error) {
            status.textContent = error.message;
            for (const {input} of choices.values()) input.disabled = false;
            apply.disabled = false;
        }
    };
    return form;
}

/** Where Create New Project… puts the new project. */
export type NewProjectDestination = 'memory' | 'browser' | 'device' | 'github';

/**
 * What the new project dialog asks the host to create. `title` is the project title; `saveName` is the name of the
 * folder (and, for GitHub, of the repository: it equals `draft.name`), always a valid save name
 * ({@link isValidSaveName}). For GitHub, `workingCopy` says where the working copy is kept.
 */
export type NewProjectRequest =
    | {destination: 'memory'; format?: ProjectSb3Format}
    | {destination: 'browser' | 'device'; title: string; saveName: string}
    | {destination: 'github'; title: string; saveName: string; draft: GitHubRepositoryDraft; workingCopy: 'browser' | 'device'};

/** `created` closes the dialog; `cancelled` (the person cancelled a picker, say) keeps it open with its entries. */
export type NewProjectResult = 'created' | 'cancelled';

export interface NewProjectGitHub {
    // The host can reuse a current session or open sign-in. The form retains its entries either way.
    connectForCreation(interaction: CreationInteraction): Promise<GitHubCreationAccount | null>;
    licenses?: readonly {id: string; label: string}[];
}

/** What the host offers in the new project dialog. Only the in-memory project is always offered. */
export interface NewProjectChoices {
    /** Lets the author choose a format when creating an SB3 in memory. */
    offerSb3Formats?: boolean;
    /** The localized title of a new project, the initial value of the title field. */
    defaultTitle?: string;
    /** Offers a project folder kept in the browser (OPFS). */
    browserFolders?: boolean;
    /**
     * Offers a project folder on the device: `true` offers it, `false` shows it disabled with the reason (Safari,
     * Firefox), and leaving it out hides it.
     */
    deviceFolders?: boolean;
    /** Offers a new GitHub repository, with its working copy in the browser or on the device. */
    github?: NewProjectGitHub;
}

export interface NewProjectFormOptions extends NewProjectChoices {
    /**
     * Creates the default project in memory when format selection is unavailable. Format selections go through
     * `createIn` so the host can wait for the new project before recording the choice.
     */
    create?: Action;
    /**
     * Creates the project. Resolves `created` once the new project is open, or `cancelled` to keep the dialog open;
     * rejects with an Error whose message the dialog shows. `signal` aborts when the dialog is dismissed.
     */
    createIn(request: NewProjectRequest, signal: AbortSignal): Promise<NewProjectResult>;
}

const deviceFolderReason = (label: (ja: string, en: string) => string) =>
    label('このブラウザーでは端末のフォルダを開けません。Chrome か Edge を使うか、ブラウザーに保存したフォルダを開いてください。',
        'This browser cannot open folders on your device. Use Chrome or Edge, or open a folder saved in this browser.');

let newProjectForms = 0;

/**
 * The Create New Project… form. The in-memory project is selected first, so Create alone does what Create New
 * Project always did. A folder or a GitHub repository also takes a title, and a save name when the title cannot be
 * used as one. `close` receives `created`, or `cancelled` when the person dismissed the form.
 */
export function renderNewProjectForm(document: Document, locale: string, options: NewProjectFormOptions,
    close: (result: NewProjectResult) => void) {
    const label = (ja: string, en: string) => locale.startsWith('ja') ? ja : en;
    const id = `tw-new-project-${++newProjectForms}`;
    const {browserFolders, deviceFolders, github: githubProvider} = options;
    const workingCopies = [...(deviceFolders !== undefined ? ['device'] : []), ...(browserFolders ? ['browser'] : [])];
    const form = document.createElement('form');
    form.setAttribute('data-new-project-form', '');
    const fields = document.createElement('div');

    const destinations = document.createElement('fieldset');
    const destinationLegend = document.createElement('legend');
    destinationLegend.textContent = label('作成先', 'Create in');
    destinations.append(destinationLegend);
    const radio = (parent: HTMLElement, group: string, value: string, title: string, reason?: string) => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = group;
        input.value = value;
        const row = document.createElement('label');
        row.append(input, title);
        parent.append(row);
        if (reason) {
            input.disabled = true;
            row.title = reason;
            const note = document.createElement('p');
            note.id = `${id}-${group}-${value}-reason`;
            note.textContent = reason;
            input.setAttribute('aria-describedby', note.id);
            parent.append(note);
        }
        return input;
    };
    const unavailable = deviceFolders === false ? deviceFolderReason(label) : undefined;
    radio(destinations, 'destination', 'memory', label('メモリ上の SB3', 'In memory (SB3)')).checked = true;
    if (browserFolders) radio(destinations, 'destination', 'browser',
        label('ブラウザー内のプロジェクトフォルダ', 'Project folder in this browser'));
    if (deviceFolders !== undefined) radio(destinations, 'destination', 'device',
        label('手元のプロジェクトフォルダ', 'Project folder on this device'), unavailable);
    if (githubProvider && workingCopies.length) radio(destinations, 'destination', 'github',
        label('Git のリモートリポジトリ', 'Git remote repository (GitHub)'));
    fields.append(destinations);

    const formats = document.createElement('fieldset');
    const formatLegend = document.createElement('legend');
    formatLegend.textContent = label('作品の形式', 'Project format');
    formats.append(formatLegend);
    radio(formats, 'sb3-format', 'standard', label('Scratch / TurboWarp 標準', 'Standard Scratch / TurboWarp')).checked = true;
    const plusFormat = radio(formats, 'sb3-format', 'plus', 'TurboWarp Plus');
    if (options.offerSb3Formats) fields.append(formats);

    const title = document.createElement('input');
    title.name = 'title';
    title.maxLength = 100;
    title.value = options.defaultTitle ?? label('新しいプロジェクト', 'Untitled Project');
    const titleField = appendField(fields, label('作品名', 'Project title'), title);

    const texts = saveNameTexts(locale);
    const saveNameBlock = document.createElement('div');
    const saveNameExplanation = document.createElement('p');
    saveNameExplanation.textContent = texts.explanation;
    const saveName = document.createElement('input');
    saveName.name = 'save-name';
    saveName.maxLength = 100;
    saveName.autocomplete = 'off';
    saveName.spellcheck = false;
    const allowed = document.createElement('p');
    allowed.id = `${id}-save-name-allowed`;
    allowed.textContent = texts.allowed;
    saveName.setAttribute('aria-describedby', allowed.id);
    const saveNameError = document.createElement('p');
    saveNameError.setAttribute('role', 'alert');
    saveNameBlock.append(saveNameExplanation);
    const saveNameField = appendField(saveNameBlock, texts.title, saveName);
    saveNameBlock.append(allowed, saveNameError);
    fields.append(saveNameBlock);
    let saveNameEdited = false;

    const status = document.createElement('p');
    status.setAttribute('role', 'alert');
    const report = (message: string) => {status.textContent = message;};
    const progress = document.createElement('p');
    progress.setAttribute('role', 'status');

    const github = githubProvider && workingCopies.length ?
        createGitHubFields(document, label, githubProvider, report) : null;
    const workingCopy = document.createElement('fieldset');
    if (github) {
        const legend = document.createElement('legend');
        legend.textContent = label('作業用の写しの置き場所', 'Keep the working copy');
        workingCopy.append(legend);
        if (deviceFolders !== undefined) radio(workingCopy, 'working-copy', 'device',
            label('手元のプロジェクトフォルダ', 'Project folder on this device'), unavailable);
        if (browserFolders) radio(workingCopy, 'working-copy', 'browser',
            label('ブラウザー内のプロジェクトフォルダ', 'Project folder in this browser'));
        const preferred = [...workingCopy.querySelectorAll<HTMLInputElement>('input')].find(input => !input.disabled);
        if (preferred) preferred.checked = true;
        github.panel.append(workingCopy);
        fields.append(github.panel);
    }

    const review = document.createElement('div');
    const device = document.createElement('div');
    const controller = new AbortController();
    let dismissed = false;
    const open = () => !dismissed && form.isConnected;
    const interaction: CreationInteraction = {
        signal: controller.signal,
        deviceCode({userCode, verificationUri}) {
            if (!open()) return;
            const link = document.createElement('a');
            link.href = verificationUri;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label('GitHub で認証する', 'Authorize on GitHub');
            const code = document.createElement('strong');
            code.textContent = userCode;
            device.replaceChildren(link, ' ', code);
        }
    };
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = label('戻る', 'Back');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = label('キャンセル', 'Cancel');
    cancel.setAttribute('data-new-project-cancel', '');
    const submit = document.createElement('button');
    submit.type = 'submit';
    form.append(fields, review, device, progress, status,
        dialogActions(document, back, dialogAction(cancel, 'cancel'), dialogAction(submit, 'confirm')));

    let busy = false;
    let reviewed: GitHubRepositoryDraft | null = null;
    const finish = (result: NewProjectResult) => {
        if (dismissed) return;
        dismissed = true;
        controller.abort();
        close(result);
    };
    cancel.onclick = () => finish('cancelled');
    const destination = () => (form.querySelector<HTMLInputElement>('input[name="destination"]:checked')?.value ??
        'memory') as NewProjectDestination;
    const selectedWorkingCopy = () => workingCopy.querySelector<HTMLInputElement>('input:checked')?.value as
        'browser' | 'device' | undefined;
    const titleValue = () => title.value.trim();
    const titleUsable = () => isValidSaveName(titleValue());
    const effectiveSaveName = () => titleUsable() ? titleValue() : saveName.value.trim();
    const refresh = () => {
        const selected = destination();
        const reviewing = reviewed !== null;
        fields.hidden = reviewing;
        review.hidden = !reviewing;
        back.hidden = !reviewing;
        back.disabled = busy;
        destinations.disabled = busy || reviewing;
        formats.hidden = selected !== 'memory';
        formats.disabled = busy || formats.hidden;
        titleField.hidden = selected === 'memory';
        title.disabled = busy || reviewing || selected === 'memory';
        // Only a folder takes the save name here; for GitHub the repository name is the save name.
        saveNameBlock.hidden = selected === 'memory' || titleUsable();
        saveNameField.hidden = selected === 'github';
        saveName.disabled = busy || reviewing || saveNameBlock.hidden || selected === 'github';
        if (github) {
            github.panel.hidden = selected !== 'github';
            github.panel.disabled = busy || reviewing || github.panel.hidden;
        }
        submit.disabled = busy;
        submit.textContent = selected === 'github' ? (reviewing ? label('リポジトリを作成', 'Create Repository') :
            github.connected ? label('作成内容を確認', 'Review Repository') : label('GitHub へ接続…', 'Connect to GitHub…')) :
            selected === 'device' ? label('フォルダを選んで作成…', 'Choose a Folder and Create…') : label('作成', 'Create');
    };
    const followTitle = () => {
        if (!titleUsable() && !saveNameEdited) saveName.value = suggestSaveName(titleValue());
        if (!saveNameBlock.hidden && saveName.value) checkSaveNameInput(saveName, saveNameError, locale);
        else {saveName.removeAttribute('aria-invalid'); saveNameError.textContent = '';}
        github?.suggestName(effectiveSaveName());
    };
    title.addEventListener('input', () => {report(''); refresh(); followTitle();});
    saveName.addEventListener('input', () => {
        saveNameEdited = true;
        checkSaveNameInput(saveName, saveNameError, locale);
        github?.suggestName(effectiveSaveName());
    });
    destinations.addEventListener('change', () => {report(''); refresh(); followTitle();});
    back.onclick = () => {
        reviewed = null;
        report('');
        refresh();
        submit.focus();
    };
    refresh();
    followTitle();
    if (github && document.defaultView?.MutationObserver) {
        const observer = new document.defaultView.MutationObserver(() => {
            if (!open()) {observer.disconnect(); controller.abort();}
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }

    const run = async (request: NewProjectRequest) => {
        progress.textContent = label('作成しています…', 'Creating…');
        try {
            const result = await options.createIn(request, controller.signal);
            if (open() && result === 'created') finish('created');
        } finally {
            if (open()) progress.textContent = '';
        }
    };
    form.onsubmit = async event => {
        event.preventDefault();
        if (!open() || busy) return;
        const selected = destination();
        report('');
        if (selected === 'memory' && options.create && !options.offerSb3Formats) {
            options.create();
            finish('created');
            return;
        }
        busy = true;
        refresh();
        let focus: HTMLElement | null = null;
        try {
            if (selected === 'memory') {
                const format = plusFormat.checked ? 'plus' : 'standard';
                await run(options.offerSb3Formats ? {destination: 'memory', format} : {destination: 'memory'});
                return;
            }
            const projectTitle = titleValue();
            if (!projectTitle) {
                report(label('作品名を入力してください。', 'Enter a project title.'));
                focus = title;
                return;
            }
            if (selected !== 'github') {
                const name = effectiveSaveName();
                if (!isValidSaveName(name)) {
                    checkSaveNameInput(saveName, saveNameError, locale);
                    report(texts.invalid);
                    focus = saveName;
                    return;
                }
                await run({destination: selected, title: projectTitle, saveName: name});
                return;
            }
            if (!reviewed) {
                github.applyUrl();
                if (!github.connected) {
                    report(label('GitHub に接続しています…', 'Connecting to GitHub…'));
                    if (await github.connect(open, interaction)) focus = submit;
                    if (open()) report('');
                    return;
                }
                const place = selectedWorkingCopy();
                if (!place) throw new Error(label('作業用の写しの置き場所を選んでください。', 'Choose where to keep the working copy.'));
                reviewed = github.draft(projectTitle);
                focus = github.review(reviewed, review);
                return;
            }
            await run({destination: 'github', title: projectTitle, saveName: reviewed.name, draft: reviewed,
                workingCopy: selectedWorkingCopy()});
        } catch (error) {
            if (open()) report(error instanceof Error ? error.message : String(error));
        } finally {
            device.replaceChildren();
            busy = false;
            if (open()) {refresh(); focus?.focus();}
        }
    };
    return form;
}

/**
 * Shows {@link renderNewProjectForm} in a modal dialog and resolves `created` or `cancelled` when it closes.
 * Escape cancels it. Without a document body it resolves `cancelled`.
 */
export function openNewProjectDialog(document: Document, locale: string, options: NewProjectFormOptions):
    Promise<NewProjectResult> {
    if (!document?.body) return Promise.resolve('cancelled');
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'tw-project-file-dialog';
        dialog.setAttribute('data-new-project-dialog', '');
        const heading = document.createElement('h2');
        heading.textContent = projectFileDialogTitle('new', locale);
        dialog.setAttribute('aria-label', heading.textContent);
        const form = renderNewProjectForm(document, locale, options, result => {
            if (dialog.open && typeof dialog.close === 'function') dialog.close();
            dialog.remove();
            resolve(result);
        });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            form.querySelector<HTMLButtonElement>('[data-new-project-cancel]')?.click();
        });
        dialog.append(heading, form);
        document.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        form.querySelector<HTMLInputElement>('input[name="destination"]:checked')?.focus();
    });
}
