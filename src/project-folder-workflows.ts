// SPDX-License-Identifier: MPL-2.0
import type {NewProjectRepositoryCreation} from './new-project.ts';
import type {ProjectCommitPort} from '@kubohiroya/turbowarp-plus-editor-git/project-commit-dialog';
import type {ProjectPublicationPort} from '@kubohiroya/turbowarp-plus-editor-git/project-publication';
import type {RepositoryCreationControls} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-creation';
export type ProjectRepositoryCreation = Omit<NewProjectRepositoryCreation, 'start'> & RepositoryCreationControls & {
    start(draft: Parameters<NewProjectRepositoryCreation['start']>[0], serialize: () => Promise<Uint8Array>,
        current: () => boolean, signal: AbortSignal, target?: Parameters<NewProjectRepositoryCreation['start']>[4]):
        ReturnType<NewProjectRepositoryCreation['start']>;
};
export interface ProjectFolderWorkflows {
    /**
     * Creates a project folder from the current project and opens it. `title` names a folder made in the browser, where
     * the user names a new folder instead of picking one. `destination` is `browser` for a new folder in the browser's
     * storage, or an empty folder already picked on the device; without it the folder follows `folderLocation`.
     */
    createFolder?(serialize: () => Promise<Uint8Array>, current: () => boolean, title?: string,
        destination?: 'browser' | FileSystemDirectoryHandle): Promise<boolean>;
    /** Writes the current project into a new folder and leaves the open project as it is (Save a Copy, #679). */
    copyFolder?(serialize: () => Promise<Uint8Array>, current: () => boolean, title?: string): Promise<boolean>;
    /** Picks an empty folder on the device for a new project; `null` when the person cancelled or it was not empty. */
    pickEmptyFolder?(language: string): Promise<FileSystemDirectoryHandle | null>;
    /** Where new project folders can be made: the browser's own storage, and folders picked on the device. */
    locations?: {browser: boolean; device: boolean};
    /** Marks the open project as saved, for a new default project that is about to be replaced by its folder. */
    markSaved?(): void;
    /** `browser` when new project folders go to the browser's own storage, where there is no folder picker. */
    folderLocation?: 'device' | 'browser';
    repositoryCreation?: ProjectRepositoryCreation;
    commit?: ProjectCommitPort;
    publication?: ProjectPublicationPort;
}
