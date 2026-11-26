// SPDX-License-Identifier: MPL-2.0
import {discoverManifest} from '@kubohiroya/turbowarp-extension-loader';
import {PROJECT_INFO_KEY} from './project-info-key.js';

export type ProjectSb3Format = 'standard' | 'plus';

export type ProjectManifestStatus =
    | {status: 'absent'}
    | {status: 'valid'}
    | {status: 'invalid'; code?: string}
    | {status: 'unavailable'};

export type ProjectFormatStatus = {
    format: ProjectSb3Format | 'unknown';
    source: 'explicit' | 'manifest' | 'legacy' | 'unknown';
    manifest: ProjectManifestStatus;
};

const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the successful load's original project.json, not the VM-facing copy from the Loader.
 * The manifest status describes the saved data, not whether extensions are safe or authorized.
 * This display policy does not mutate the project, convert formats, or grant trust.
 */
export function readProjectSb3Format(originalProject: unknown): ProjectFormatStatus {
    if (!record(originalProject)) {
        return {format: 'unknown', source: 'unknown', manifest: {status: 'unavailable'}};
    }

    const info = Object.hasOwn(originalProject, PROJECT_INFO_KEY) ? originalProject[PROJECT_INFO_KEY] : undefined;
    const explicit = record(info) && info.schemaVersion === 1 && Object.hasOwn(info, 'sb3Format') ?
        info.sb3Format : undefined;
    let manifest: ProjectManifestStatus;
    try {
        manifest = {status: discoverManifest(originalProject) ? 'valid' : 'absent'};
    } catch (error) {
        manifest = record(error) && typeof error.code === 'string' ?
            {status: 'invalid', code: error.code} : {status: 'invalid'};
    }
    if (explicit === 'standard' || explicit === 'plus') {
        return {format: explicit, source: 'explicit', manifest};
    }
    if (manifest.status === 'valid') return {format: 'plus', source: 'manifest', manifest};
    if (manifest.status === 'absent') return {format: 'standard', source: 'legacy', manifest};
    return {format: 'unknown', source: 'unknown', manifest};
}
