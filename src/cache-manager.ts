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
 *
 * Embedding is passed to the screen as a callback over the project open when it was shown. The
 * project's payload host (`turbowarp-sb3-save-format`) decides which references change and checks
 * them against their pinned digests; this module only connects it to the screen and to the save:
 * a release waits until the Editor reports the project saved, and the payload host then releases
 * only what the written archive embedded, and only this project's claims.
 */
import {cacheManagerLocales, createCacheManagerDialog, createExtensionCache,
    type CacheEmbeddingHost, type CacheEmbedOutcome, type CacheEmbedSkipReason,
    type CacheManagerDialog, type ExtensionCache} from '@kubohiroya/turbowarp-title-menu/composition';

export type CacheManagerColorScheme = 'light' | 'dark' | 'auto';

/** What the payload host of `turbowarp-sb3-save-format` offers for embedding cached data. */
export interface CacheManagerPayloads {
    cacheEmbedding?(): {
        apply(digests: readonly string[], options: {format: 'embedded-data' | 'embedded-file'}): Promise<{
            embedded: readonly unknown[];
            skipped: readonly {sha256: string; reason: CacheEmbedSkipReason}[];
            releasable: readonly string[];
        }>;
    };
    releaseAfterSave?(digests: readonly string[]): Promise<{released: number; freed: number; kept: readonly unknown[]}>;
}

/** The project open in the Editor, as the cache manager embeds into it. */
export interface CacheManagerProject {
    /** The URI its cache claims are filed under, or undefined when it has none. */
    bucket(): string | undefined;
    /** The title the Editor shows for it. */
    title?(): string | undefined;
    readonly payloads?: CacheManagerPayloads | undefined;
    /**
     * Settles true once the Editor reports this project saved after the call, false when another
     * project replaces it first. The payload host still checks what the save wrote.
     */
    whenSaved(): Promise<boolean>;
}

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
    /** The project open now. Without one, or without a payload host, the screen offers no embedding. */
    project?: CacheManagerProject;
}

export interface CacheManager {
    open(options?: CacheManagerOpenOptions): Promise<void>;
    readonly isOpen: boolean;
    dispose(): void;
}

const locale = (value: string | undefined) => /^ja(?:-|$)/i.test(value ?? '') ? 'ja' : 'en';

/**
 * The screen's embedding callback over one project. A release is offered only for digests the
 * payload host says no remote reference still uses, and runs only after a save.
 */
function embeddingFor(project: () => CacheManagerProject | undefined): CacheEmbeddingHost {
    return {
        currentBucket: () => project()?.payloads?.cacheEmbedding ? project()!.bucket() : undefined,
        async embed(keys, {format, release}): Promise<CacheEmbedOutcome> {
            const current = project();
            const payloads = current?.payloads;
            if (!current || !payloads?.cacheEmbedding) return {embedded: 0, skipped: keys.map(key => ({key, reason: 'unsupported'}))};
            const result = await payloads.cacheEmbedding().apply(keys, {format});
            const outcome = {embedded: result.embedded.length,
                skipped: result.skipped.map(({sha256, reason}) => ({key: sha256, reason}))};
            const releaseAfterSave = payloads.releaseAfterSave?.bind(payloads);
            if (!release || !result.releasable.length || !releaseAfterSave) return outcome;
            const digests = [...result.releasable];
            // Watching starts now, after the embedding made the project unsaved. A project replaced
            // before it is saved never releases, so the promise stays pending.
            const released = current.whenSaved().then(saved => saved ? releaseAfterSave(digests).then(done =>
                ({released: done.released, freed: done.freed, kept: done.kept.length})) : new Promise<never>(() => {}));
            return {...outcome, released};
        }
    };
}

export function createCacheManager(options: CacheManagerOptions = {}): CacheManager {
    let project: CacheManagerProject | undefined;
    // The open project's own title names its row; any other title comes from the host.
    const titleFor = (bucket: string) => {
        const own = project && project.bucket() === bucket ? project.title?.() : undefined;
        return own || options.titleFor?.(bucket);
    };
    const createCache = options.createCache ?? (() => createExtensionCache({titleFor}));
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
            onRelease: claims => requireCache().releaseAssets(claims),
            embedding: embeddingFor(() => project)
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
        async open({locale: requested, colorScheme = 'auto', returnFocus: focus, project: current}: CacheManagerOpenOptions = {}) {
            if (disposed) throw new TypeError('the cache manager is disposed');
            project = current;
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
