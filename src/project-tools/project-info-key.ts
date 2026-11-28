// SPDX-License-Identifier: MPL-2.0
export const PROJECT_INFO_KEY = 'turboWarpPlusProject';

/**
 * The title a project's own JSON records in its project information, or undefined. Read from the
 * project being decoded, so a caller never gets the title of the project open before it.
 */
export const projectInfoTitle = (project: unknown): string | undefined => {
    const info = project && typeof project === 'object' ? (project as Record<string, unknown>)[PROJECT_INFO_KEY] : undefined;
    if (!info || typeof info !== 'object' || Array.isArray(info)) return undefined;
    const {schemaVersion, title} = info as Record<string, unknown>;
    return schemaVersion === 1 && typeof title === 'string' && title ? title : undefined;
};
