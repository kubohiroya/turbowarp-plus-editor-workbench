// SPDX-License-Identifier: MPL-2.0
import React from 'react';
import {flushPendingSurfaceEdits} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';
import {getDocumentWorkspace} from './document-workspace.ts';
import {showNotice} from './project-notice.ts';

export const newLayoutStorageKey = 'twPlusNewLayoutEnabled';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = () => typeof window === 'undefined' ? undefined : window.localStorage;
const syncURL = (enabled: boolean) => {
    if (!globalThis.location || !globalThis.history) return;
    const url = new URL(globalThis.location.href);
    if (!url.searchParams.has('twPlusStandardLayout')) return;
    url.searchParams.set('twPlusStandardLayout', enabled ? '1' : '0');
    globalThis.history.replaceState(globalThis.history.state, '', url.href);
};

/** URL overrides are session-only; only an explicit menu selection writes the preference. */
export function readNewLayoutPreference(search = '', storage: () => PreferenceStorage = browserStorage): boolean {
    const params = new URLSearchParams(search);
    if (params.has('twPlusStandardLayout')) return params.get('twPlusStandardLayout') === '1';
    try {
        return storage()?.getItem(newLayoutStorageKey) === '1';
    } catch {
        return false;
    }
}

export interface LayoutPreference {
    read(): boolean;
    setEnabled(enabled: boolean): void;
    subscribe(listener: () => void): () => void;
}

/** Keep working in memory when browser storage is denied or full. */
export function createLayoutPreference({search = '', storage = browserStorage, updateURL = syncURL}: {
    search?: string; storage?: () => PreferenceStorage; updateURL?: (enabled: boolean) => void;
} = {}): LayoutPreference {
    let enabled = readNewLayoutPreference(search, storage);
    const listeners = new Set<() => void>();
    return {
        read: () => enabled,
        setEnabled(value) {
            try {
                storage()?.setItem(newLayoutStorageKey, value ? '1' : '0');
            } catch {
                // The layout choice still applies for the current session.
            }
            try { updateURL(value); } catch {
                // A sandboxed host may deny history updates as well as storage.
            }
            if (enabled === value) return;
            enabled = value;
            for (const listener of listeners) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        }
    };
}

/** Use subscription APIs supported by React 16 hosts. */
export function useLayoutPreference(preference?: LayoutPreference): boolean {
    const [enabled, setEnabled] = React.useState(() => preference?.read() ?? false);
    React.useLayoutEffect(() => {
        const update = () => setEnabled(preference?.read() ?? false);
        const unsubscribe = preference?.subscribe(update);
        update();
        return unsubscribe;
    }, [preference]);
    return enabled;
}

/** Collect detached edits before changing surfaces, and retain dirty file tabs until they are saved. */
export async function prepareLayoutChange(vm: object, enabled: boolean, locale: string,
    document: Document = globalThis.document): Promise<boolean> {
    const ja = /^ja(?:-|$)/i.test(locale);
    try {
        await flushPendingSurfaceEdits();
        if (!enabled && getDocumentWorkspace(vm).fileEdits().length) {
            showNotice(document, ja ? 'レイアウトを切り替える前に、編集中のファイルを保存するか閉じてください。' :
                'Save or close edited files before switching layouts.', {locale});
            return false;
        }
        return true;
    } catch {
        showNotice(document, ja ? '別の画面の編集内容を回収できませんでした。レイアウトを変更せずに保持しました。' :
            'Edits from another window could not be collected. The layout has been kept.', {locale});
        return false;
    }
}
