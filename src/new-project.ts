import type {CreationInteraction, GitHubCreationAccount, GitHubRepositoryDraft, RepositoryCreationControls,
    RepositoryCreationProgress} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-creation';
import type {NewProjectChoices, NewProjectRequest, NewProjectResult} from './project-file-dialogs.ts';
import type {ProjectSb3Format} from './project-tools/format.js';

/** Where a new project folder goes: a new folder in the browser's storage, or an empty folder picked on the device. */
export type NewProjectFolderDestination = 'browser' | FileSystemDirectoryHandle;

/** The host's GitHub repository creation workflow, as used by Create New Project…. */
export interface NewProjectRepositoryCreation extends Pick<RepositoryCreationControls, 'list' | 'advance' | 'open'> {
    /** Reuses a current session or opens sign-in, as for the new project dialog's GitHub choice. */
    connect(interaction: CreationInteraction): Promise<GitHubCreationAccount | null>;
    licenses?: readonly {id: string; label: string}[];
    /**
     * Starts creating the repository from the serialized project, with its working copy in `target`. Resolves the
     * progress to {@link NewProjectRepositoryCreation.advance}, or a falsy value when the creation was cancelled.
     * Any other result is passed on to `advance` as it is.
     */
    start(draft: GitHubRepositoryDraft, serialize: () => Promise<Uint8Array>, current: () => boolean, signal: AbortSignal,
        target: NewProjectFolderDestination): Promise<RepositoryCreationProgress | boolean | null | undefined>;
}

/** What the host supplies for {@link createNewProjectHandler}: only what depends on the GUI and its storage. */
export interface NewProjectHost {
    locale: string;
    /** The GUI's own Create New Project: the default project in memory. */
    create(): void;
    /**
     * Replaces the open project with the GUI's default project, as {@link NewProjectHost.create} does, and resolves
     * once it is shown and the GUI has reset its title. Resolves `false` when the person kept the current project at
     * the unsaved-changes question, and rejects when it fails to load or `signal` aborts.
     */
    openDefaultProject(signal: AbortSignal, format?: ProjectSb3Format): Promise<boolean>;
    /** Offers a format choice when opening a new in-memory SB3. */
    offerSb3Formats?: boolean;
    /** Names the new default project: its title and save name, applied together. */
    nameProject(title: string, saveName: string): void;
    /**
     * Picks an empty folder on the device; `null` when the person cancelled. It is called first, during the click
     * that asked for it, so the browser still allows the picker. Without it a device folder is cancelled.
     */
    pickDeviceFolder?(): Promise<FileSystemDirectoryHandle | null>;
    /** Creates a project folder at `destination` from the open (new default) project and opens it. */
    createFolder(destination: NewProjectFolderDestination, title: string, signal: AbortSignal): Promise<boolean>;
    /** Offers a new GitHub repository. Needs {@link NewProjectHost.serialize}. */
    repositoryCreation?: NewProjectRepositoryCreation;
    /** Serializes the open project as a project folder titled `title`, for the repository's first commit. */
    serialize?(title: string): Promise<Uint8Array>;
    /**
     * Called once the new default project is named; returns a check that stays true while that project stays open.
     * Without it the project counts as current until the dialog is dismissed.
     */
    trackProject?(): () => boolean;
    /** Marks the open project as saved, so opening the new repository asks nothing about the default project. */
    markSaved?(): void;
    /** Shows a short notice, such as the GitHub device code (see `showNotice`). */
    notify(text: string): void;
    /** The localized title of a new project. */
    defaultTitle?: string;
    /** Offers a project folder kept in the browser. */
    browserFolders?: boolean;
    /** Offers a project folder on the device (see {@link NewProjectChoices.deviceFolders}). */
    deviceFolders?: boolean;
}

/**
 * Create New Project…: the new project dialog's choices and its `createIn`. The in-memory project is the GUI's own
 * `create`. A folder or a GitHub repository starts from the same default project, named by the dialog. The device
 * folder is picked before anything else, while the click still allows the picker. A GitHub repository is created,
 * its first commit pushed and its root opened as the project folder; pressing Create again after a stopped setup
 * resumes it instead of making another repository. Pass both to `openNewProjectDialog` or the host's new project
 * entry.
 */
export function createNewProjectHandler(host: NewProjectHost): {
    createIn(request: NewProjectRequest, signal: AbortSignal): Promise<NewProjectResult>;
    newProject: NewProjectChoices;
} {
    const ja = host.locale.startsWith('ja');
    const label = (jp: string, en: string) => ja ? jp : en;
    const repositoryCreation = host.repositoryCreation;
    const repositoryError = (error: unknown) => {
        const code = (error as {code?: string})?.code;
        if (!code) return error;
        return new Error(code === 'popupBlocked' ?
            label('GitHub の認証画面を開けませんでした。ポップアップを許可して、もう一度「リポジトリを作成」を押してください。',
                'Could not open the GitHub authorization window. Allow pop-ups and press "Create Repository" again.') :
            code === 'nameConflict' ? label('同じ名前のリポジトリがすでにあります。', 'A repository with this name already exists.') :
                label('リポジトリの作成を完了できませんでした。もう一度「リポジトリを作成」を押すと続きから再開します。',
                    'Could not finish creating the repository. Press "Create Repository" again to continue where it stopped.'));
    };
    // Creates the repository, pushes the first commit and opens its root as the project folder.
    const finishRepository = async (creation: NewProjectRepositoryCreation, started: RepositoryCreationProgress,
        signal: AbortSignal, fresh: boolean) => {
        const interaction: CreationInteraction = {signal, deviceCode({userCode, verificationUri}) {
            host.notify(label(`GitHub で認証してください：${verificationUri}（コード ${userCode}）`,
                `Authorize on GitHub: ${verificationUri} (code ${userCode})`));
        }};
        let progress = started;
        try {
            for (let step = 0; progress.phase !== 'open'; step++) {
                const {progress: next} = await creation.advance(progress, interaction);
                if (step > 8 || next.phase === 'unknown' && progress.phase === 'unknown') {
                    throw Object.assign(new Error('unknown'), {code: 'unknown'});
                }
                progress = next;
            }
        } catch (error) {
            throw repositoryError(error);
        }
        // The default project only stood in for the repository's project, so opening it asks nothing.
        if (fresh) host.markSaved?.();
        return creation.open(progress);
    };
    const createIn = async (request: NewProjectRequest, signal: AbortSignal): Promise<NewProjectResult> => {
        if (request.destination === 'memory') {
            if (request.format) {
                return host.offerSb3Formats && await host.openDefaultProject(signal, request.format) ?
                    'created' : 'cancelled';
            }
            host.create();
            return 'created';
        }
        const {title, saveName} = request;
        if (request.destination === 'github') {
            if (!repositoryCreation || !host.serialize) return 'cancelled';
            // Pressing Create again after a stopped setup resumes it instead of making another repository.
            const pending = (await repositoryCreation.list()).find(entry =>
                entry.owner.toLowerCase() === request.draft.owner.toLowerCase() &&
                entry.name.toLowerCase() === request.draft.name.toLowerCase());
            if (pending) return await finishRepository(repositoryCreation, pending, signal, false) ? 'created' : 'cancelled';
            // The folder is picked first, while the click that asked for it still allows the picker.
            const target = request.workingCopy === 'device' ? await host.pickDeviceFolder?.() : 'browser';
            if (!target || !await host.openDefaultProject(signal)) return 'cancelled';
            host.nameProject(title, saveName);
            const open = host.trackProject?.() ?? (() => true);
            const current = () => !signal.aborted && open();
            const progress = await repositoryCreation.start(request.draft, () => host.serialize(title), current, signal, target)
                .catch(error => {throw repositoryError(error);});
            if (!progress) return 'cancelled';
            // Any other result goes on to advance, as the Editor's own flow did.
            return await finishRepository(repositoryCreation, progress as RepositoryCreationProgress, signal, true) ?
                'created' : 'cancelled';
        }
        const target = request.destination === 'device' ? await host.pickDeviceFolder?.() : 'browser';
        if (!target || !await host.openDefaultProject(signal)) return 'cancelled';
        host.nameProject(title, saveName);
        return await host.createFolder(target, title, signal) ? 'created' : 'cancelled';
    };
    return {createIn, newProject: {
        ...(host.offerSb3Formats ? {offerSb3Formats: true} : {}),
        defaultTitle: host.defaultTitle,
        browserFolders: host.browserFolders,
        deviceFolders: host.deviceFolders,
        github: repositoryCreation && {
            connectForCreation: interaction => repositoryCreation.connect(interaction),
            licenses: repositoryCreation.licenses
        }
    }};
}
