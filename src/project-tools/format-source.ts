// SPDX-License-Identifier: MPL-2.0
import type {ProjectFormatStatus} from './format.js';

type Format = ProjectFormatStatus['format'];

/** The current editing format, independent of whether the project has been saved. */
export interface ProjectFormatSource {
    getSnapshot(): Format;
    subscribe(listener: () => void): () => void;
}

export function createProjectFormatSource() {
    let format: Format = 'unknown';
    const listeners = new Set<() => void>();
    const source: ProjectFormatSource = {
        getSnapshot: () => format,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    return {
        source,
        update(next: Format) {
            if (next === format) return;
            format = next;
            for (const listener of listeners) listener();
        }
    };
}
