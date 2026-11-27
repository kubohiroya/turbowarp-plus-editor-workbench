// SPDX-License-Identifier: MPL-2.0
import type JSZip from '@turbowarp/jszip';
import {createExtensionLoader, createFetchPort, discoverManifest, LoaderError, validateManifest}
    from '@kubohiroya/turbowarp-extension-loader';
import type {FetchResult, LoaderOptions} from '@kubohiroya/turbowarp-extension-loader';
import {DATA_CARRIER_PREFIX} from '@kubohiroya/turbowarp-extension-loader/project-codec';
import type {ProjectSb3Format} from './format.js';

function carrier(code: string) {
    // The loader requires valid UTF-8 and keeps the BOM, so this preserves the verified bytes.
    const bytes = new TextEncoder().encode(code);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return DATA_CARRIER_PREFIX + btoa(chunks.join(''));
}

/** Verify and rewrite the private save archive before any file is opened for writing. */
export async function applyProjectFormatToArchive(archive: JSZip, format: ProjectSb3Format, {
    fetchImpl, loaderOptions, signal
}: {fetchImpl?: typeof fetch; loaderOptions?: LoaderOptions; signal?: AbortSignal} = {}): Promise<void> {
    const json = archive.file('project.json');
    if (!json) throw new Error('The save archive is missing project.json');
    const project = JSON.parse(await json.async('string'));
    const manifest = discoverManifest(project, loaderOptions);
    const extensions = manifest?.extensions ?? [];
    const urls = {...project.extensionURLs} as Record<string, string>;
    const managed = new Set(extensions.map(spec => spec.id));
    for (const id of project.extensions ?? []) {
        if (managed.has(id) || !Object.hasOwn(urls, id)) continue;
        if (format === 'standard' && typeof urls[id] === 'string' && urls[id].startsWith(DATA_CARRIER_PREFIX)) continue;
        throw new LoaderError('SAVE_EXTENSION_SOURCE_REQUIRED', `Extension ${id} has no verified source for this save.`, id);
    }

    const carriers = new Map<string, string>();
    const target = format === 'standard' ? manifest : validateManifest({schemaVersion: 1,
        ...(manifest?.uri === undefined ? {} : {uri: manifest.uri}),
        extensions: extensions.map(spec => {
            if (!spec.source.url) {
                throw new LoaderError('SAVE_EXTENSION_URL_REQUIRED', `Extension ${spec.id} needs a fixed HTTPS URL.`, spec.id);
            }
            return {...spec, source: {type: 'remote-cacheable', url: spec.source.url}};
        })}, loaderOptions);
    if (target?.extensions.length) {
        const fetcher = createFetchPort(fetchImpl);
        const requests = new Map<string, Promise<FetchResult>>();
        const verifier = createExtensionLoader({
            fetcher: {fetch(url, options) {
                let pending = requests.get(url);
                if (!pending) {
                    pending = fetcher.fetch(url, options);
                    requests.set(url, pending);
                }
                return pending;
            }},
            embeddedReader: {
                async read(path) {
                    const file = archive.file(path);
                    if (!file) throw new LoaderError('INVALID_ARCHIVE', `Missing embedded extension file ${path}.`);
                    return file.async('uint8array');
                },
                async readData(id, {maxBytes}) {
                    const value = urls[id];
                    if (typeof value !== 'string' || !value.startsWith(DATA_CARRIER_PREFIX)) {
                        throw new LoaderError('INVALID_ARCHIVE', 'Missing embedded extension code.', id);
                    }
                    const encoded = value.slice(DATA_CARRIER_PREFIX.length);
                    if (encoded.length > Math.ceil(maxBytes / 3) * 4) {
                        throw new LoaderError('INVALID_BYTES', 'Embedded extension code is too large.', id);
                    }
                    return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
                }
            },
            // This verifier reads code without running it or changing the Editor's approval state.
            trustProvider: {async authorize(code) {
                if (format === 'standard') carriers.set(code.id, carrier(code.code));
                return {allowed: true, scope: 'digest', sha256: code.sha256};
            }},
            registrar: {
                async begin() {
                    return {async register(code) {return {id: code.id};}, async commit() {}, async rollback() {}};
                },
                async unload() {}
            }
        }, loaderOptions);
        try { await verifier.load(target, {signal}); }
        finally { await verifier.unload(); }
    }
    signal?.throwIfAborted();
    for (const {id} of extensions) {
        if (format === 'plus') delete urls[id];
        else urls[id] = carriers.get(id)!;
    }
    if (format === 'standard') delete project.turboWarpPlus;
    else project.turboWarpPlus = target;
    if (extensions.length) {
        project.extensions = [...new Set([...(project.extensions ?? []), ...managed])];
        project.extensionURLs = urls;
    }
    archive.file('project.json', JSON.stringify(project), {date: json.date, compression: 'DEFLATE'});
    for (const {source} of extensions) if (source.type === 'embedded-file') archive.remove(source.path);
}
