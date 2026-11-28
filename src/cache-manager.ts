/**
 * The Editor's "Cache management…" entry (turbowarp-plus-editor#902, stage 4).
 *
 * The screen and its model belong to `@kubohiroya/turbowarp-title-menu`, and the store to the
 * Loader. This module only decides when the screen is built, which language and colors it uses,
 * and where focus goes, so the Editor gets the same table, search, sort and release that the
 * Title Menu extension shows, without adding that extension to the project.
 *
 * The cache is opened through the Title Menu adapter, which reaches the Loader's IndexedDB cache by
 * its public API with the Loader's default database: the same one the Editor's extension host and
 * project data paths write to. The connection is closed whenever the screen closes, so an idle
 * Editor never holds the database open against another tab's upgrade.
 */
import {cacheManagerLocales, createCacheManagerDialog, createExtensionCache,
    type CacheManagerDialog, type ExtensionCache} from '@kubohiroya/turbowarp-title-menu/composition';

export type CacheManagerColorScheme = 'light' | 'dark' | 'auto';

export interface CacheManagerOptions {
    document?: Document;
    /** Opens the cache. Defaults to the Title Menu adapter over the Loader's default database. */
    createCache?: () => ExtensionCache;
    /** A title the host knows for a project URI; consulted on every listing. */
    titleFor?(bucket: string): string | undefined;
}

export interface CacheManagerOpenOptions {
    locale?: string;
    colorScheme?: CacheManagerColorScheme;
    /** Receives focus when the screen closes, since the menu entry that opened it is gone. */
    returnFocus?: HTMLElement | null;
}

export interface CacheManager {
    open(options?: CacheManagerOpenOptions): Promise<void>;
    readonly isOpen: boolean;
    dispose(): void;
}

const locale = (value: string | undefined) => /^ja(?:-|$)/i.test(value ?? '') ? 'ja' : 'en';

export function createCacheManager(options: CacheManagerOptions = {}): CacheManager {
    const createCache = options.createCache ?? (() => createExtensionCache({titleFor: options.titleFor}));
    let dialog: CacheManagerDialog | undefined;
    let cache: ExtensionCache | undefined;
    let observer: MutationObserver | undefined;
    let returnFocus: HTMLElement | null | undefined;
    let open = false;
    let disposed = false;

    const requireCache = () => (cache ??= createCache());
    const closeCache = () => {
        const current = cache;
        cache = undefined;
        return current?.close().catch(() => undefined);
    };
    const closed = () => {
        if (!open) return;
        open = false;
        void closeCache();
        const target = returnFocus;
        returnFocus = undefined;
        if (target?.isConnected) target.focus({preventScroll: true});
    };

    const build = () => {
        const document = options.document ?? globalThis.document;
        const created = createCacheManagerDialog({
            document,
            mount: document.body,
            locales: cacheManagerLocales,
            listAssets: () => requireCache().listAssets(),
            onRelease: claims => requireCache().releaseAssets(claims)
        });
        // The dialog hides itself on Escape and on its close button; seeing it hidden is how the
        // host learns that it closed.
        const View = document.defaultView as (Window & typeof globalThis) | null;
        const Observer = View?.MutationObserver ?? globalThis.MutationObserver;
        observer = new Observer(() => {
            if (created.element.style.display === 'none') closed();
        });
        observer.observe(created.element, {attributes: true, attributeFilter: ['style']});
        return created;
    };

    return Object.freeze({
        get isOpen() { return open; },
        async open({locale: requested, colorScheme = 'auto', returnFocus: focus}: CacheManagerOpenOptions = {}) {
            if (disposed) throw new TypeError('the cache manager is disposed');
            dialog ??= build();
            dialog.setColorScheme(colorScheme);
            returnFocus = focus;
            open = true;
            const shown = dialog.show(locale(requested));
            dialog.element.querySelector<HTMLElement>('[data-cache-search]')?.focus({preventScroll: true});
            await shown;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            observer?.disconnect();
            dialog?.dispose();
            dialog = undefined;
            open = false;
            void closeCache();
        }
    });
}
