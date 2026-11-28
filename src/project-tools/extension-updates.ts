// SPDX-License-Identifier: MPL-2.0
/**
 * Changing the version and the stored form of the extensions an open project uses
 * (turbowarp-plus-editor#901, stage 3).
 *
 * The rules belong to `@kubohiroya/sb3-toolchain`'s `./project-extensions`: which version a
 * request resolves to, what is checked, and how the new SB3 is written. The CLI calls the same
 * functions. The Loader's authoring controller owns the open project: it serializes the change
 * against the VM, loads the result through the Editor's usual project load (so new code is
 * approved there, never inherited from the old digest), marks the project unsaved, and restores
 * the original if anything fails. This module only connects the two and keeps the plan the person
 * saw the one that is applied.
 */
import {applyProjectExtensionUpdate, listProjectExtensions, planProjectExtensionUpdate}
    from '@kubohiroya/sb3-toolchain/project-extensions';
import type {ProjectArchive, ProjectExtension, ProjectExtensionPlan, ProjectExtensionPlanOptions,
    ProjectExtensionPlanStep, ProjectExtensionRequest} from '@kubohiroya/sb3-toolchain/project-extensions';
import {resolvePublishedExtension} from '@kubohiroya/sb3-toolchain/web-distribution';
import {discoverManifest} from '@kubohiroya/turbowarp-extension-loader';

export type {ProjectExtension, ProjectExtensionPlan, ProjectExtensionPlanStep, ProjectExtensionRequest};

type Resolve = NonNullable<ProjectExtensionPlanOptions['resolve']>;

interface ZipEntry {
    dir: boolean;
    async(type: 'uint8array'): Promise<Uint8Array>;
}
interface ZipArchive {
    files: Record<string, ZipEntry>;
    file(name: string, content: Uint8Array, options?: object): unknown;
    generateAsync(options: {type: 'uint8array'; compression?: 'STORE' | 'DEFLATE'}): Promise<Uint8Array>;
}
/** The JSZip the host bundles. */
export interface ZipConstructor {
    new (): ZipArchive;
    loadAsync(input: ArrayBuffer | Uint8Array): Promise<ZipArchive>;
}

/** The part of the Loader's authoring controller this module uses. */
export interface ExtensionUpdateAuthoring {
    apply(request: unknown, options: {signal?: AbortSignal},
        prepare: (original: ArrayBuffer | Uint8Array) => Promise<{projectBytes: Uint8Array; manifest: unknown}>,
        snapshot: () => Promise<ArrayBuffer | Uint8Array>): Promise<unknown>;
}

export interface ExtensionUpdateHost {
    authoring: ExtensionUpdateAuthoring;
    /** The open project as an SB3, serialized without counting as a save. */
    snapshot(): Promise<ArrayBuffer | Uint8Array>;
    zip: ZipConstructor;
    /** Identifies the open project; a different value means another project replaced it. */
    projectKey(): unknown;
    resolve?: Resolve;
    fetch?: typeof fetch;
}

export class ExtensionUpdateError extends Error {
    readonly code: string;
    constructor(message: string, code: string) {
        super(message);
        this.name = 'ExtensionUpdateError';
        this.code = code;
    }
}

async function readSb3(Zip: ZipConstructor, bytes: ArrayBuffer | Uint8Array) {
    const zip = await Zip.loadAsync(bytes);
    const archive: Record<string, Uint8Array> = {};
    for (const [name, entry] of Object.entries(zip.files)) {
        if (!entry.dir) archive[name] = await entry.async('uint8array');
    }
    const json = archive['project.json'];
    if (!json) throw new ExtensionUpdateError('The project has no project.json.', 'INVALID_PROJECT');
    delete archive['project.json'];
    const project = JSON.parse(new TextDecoder().decode(json)) as Record<string, unknown>;
    return {archive: archive as ProjectArchive, project};
}

async function writeSb3(Zip: ZipConstructor, archive: ProjectArchive, project: Record<string, unknown>) {
    const zip = new Zip();
    zip.file('project.json', new TextEncoder().encode(JSON.stringify(project)));
    for (const [name, content] of Object.entries(archive)) zip.file(name, content, {createFolders: false});
    return zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
}

const sourceKey = (source: ProjectExtensionPlanStep['to']['source']) => JSON.stringify(source);
/** What a step promises: the code, its record and its form before and after. */
const stepKey = (step: ProjectExtensionPlanStep) => JSON.stringify([step.id, step.change,
    step.from.sha256, step.from.format, step.to.sha256, step.to.format, step.to.version ?? null,
    step.to.url ?? null, sourceKey(step.to.source), step.to.execution]);

/** Whether applying a step loads code the project did not run before, so the Loader asks again. */
export const changesCode = (step: ProjectExtensionPlanStep) => step.to.sha256 !== step.from.sha256;

/**
 * One session of the extensions screen: the open project when it was shown, and the published
 * versions it resolved. A resolved reference is kept for the session, so the candidate that is
 * applied is the one that was shown.
 */
export function createExtensionUpdates(host: ExtensionUpdateHost) {
    const key = host.projectKey();
    const resolved = new Map<string, ReturnType<Resolve>>();
    const resolve: Resolve = host.resolve ?? ((reference, options) =>
        resolvePublishedExtension(reference, {...options, ...(host.fetch ? {fetchImpl: host.fetch} : {})}));
    const cachedResolve: Resolve = (reference, options) => {
        let pending = resolved.get(reference);
        if (!pending) {
            pending = resolve(reference, options);
            resolved.set(reference, pending);
            // A failed or cancelled resolution may be tried again.
            pending.catch(() => { if (resolved.get(reference) === pending) resolved.delete(reference); });
        }
        return pending;
    };
    const planOptions = (signal?: AbortSignal): ProjectExtensionPlanOptions => ({
        resolve: cachedResolve, ...(host.fetch ? {fetch: host.fetch} : {}), ...(signal ? {signal} : {})});
    const assertSameProject = () => {
        if (host.projectKey() !== key) {
            throw new ExtensionUpdateError('Another project was opened; open this screen again.', 'PROJECT_REPLACED');
        }
    };
    let planned: {plan: ProjectExtensionPlan; requests: Record<string, ProjectExtensionRequest>} | undefined;

    return {
        /** Every extension the project uses, as its own records describe it. */
        async list(): Promise<readonly ProjectExtension[]> {
            assertSameProject();
            const {archive, project} = await readSb3(host.zip, await host.snapshot());
            return listProjectExtensions(archive, project);
        },
        /** Resolve and check a change without touching the project. */
        async plan(requests: Record<string, ProjectExtensionRequest>, signal?: AbortSignal) {
            assertSameProject();
            planned = undefined;
            const {archive, project} = await readSb3(host.zip, await host.snapshot());
            const plan = await planProjectExtensionUpdate(archive, project, requests, planOptions(signal));
            assertSameProject();
            planned = {plan, requests: structuredClone(requests)};
            return plan;
        },
        /**
         * Apply the plan last made. The project is planned again as it is now, with the versions
         * already resolved, and must promise exactly the same steps; otherwise nothing changes.
         */
        async apply(plan: ProjectExtensionPlan, signal?: AbortSignal) {
            if (!planned || planned.plan !== plan) {
                throw new ExtensionUpdateError('Check the changes again before applying them.', 'PLAN_STALE');
            }
            if (plan.blocked) throw new ExtensionUpdateError('The plan has blocked steps.', 'PLAN_BLOCKED');
            assertSameProject();
            const {requests} = planned;
            const expected = plan.steps.map(stepKey).join('\n');
            await host.authoring.apply(requests, signal ? {signal} : {}, async original => {
                assertSameProject();
                const {archive, project} = await readSb3(host.zip, original);
                const now = await planProjectExtensionUpdate(archive, project, requests, planOptions(signal));
                if (now.blocked || now.steps.map(stepKey).join('\n') !== expected) {
                    throw new ExtensionUpdateError('The project or a published version changed; check the changes again.',
                        'PLAN_CHANGED');
                }
                const result = await applyProjectExtensionUpdate(archive, project, now,
                    {...(host.fetch ? {fetch: host.fetch} : {}), ...(signal ? {signal} : {})});
                return {projectBytes: await writeSb3(host.zip, result.archive, result.project),
                    manifest: discoverManifest(result.project)};
            }, host.snapshot);
            planned = undefined;
        }
    };
}
