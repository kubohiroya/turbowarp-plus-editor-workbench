// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import JSZip from '@turbowarp/jszip';
import {JSDOM} from 'jsdom';
import {listProjectExtensions} from '@kubohiroya/sb3-toolchain/project-extensions';
import {createExtensionUpdates} from '../dist/project-tools/extension-updates.js';
import {renderExtensionUpdateForm} from '../dist/project-tools/extension-update-form.js';
import {createProjectDialogService} from '../dist/project-tools/dialog.js';

const id = 'sample';
const packageName = '@outside-editor/sample';
const hex = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const encode = (value: string) => new TextEncoder().encode(value);
const bundleOf = (version: string) => `// Name: Sample\n// ID: sample\n// License: MIT\n\n// extension ${version}\n`;
const fileDataUrl = (source: string) => `data:application/javascript;base64,${Buffer.from(source).toString('base64')}`;

/** A verified npm publication, as the toolchain's resolver returns it. */
function published(version: string) {
    const bytes = encode(bundleOf(version));
    const apiBytes = encode(JSON.stringify({id, formatVersion: 1,
        blocks: [{opcode: 'go', blockType: 'COMMAND', arguments: []}], menus: []}));
    return {
        distribution: {formatVersion: 1, id, package: packageName, version, name: 'Sample', description: 'Sample',
            license: 'MIT', execution: 'sandboxed', resources: {schemaVersion: 1, resources: []},
            bundle: {file: 'sample.js', size: bytes.length, sha256: hex(bytes)},
            api: {file: 'extension-manifest.json', size: apiBytes.length, sha256: hex(apiBytes)}},
        source: {provider: 'npm', package: packageName, version, integrity: `sha512-${'A'.repeat(86)}==`},
        bytes, apiBytes,
        measurements: {downloadBytes: 0, expandedBytes: 0, cacheBytes: 0, temporaryDiskBytes: 0}
    } as any;
}

/** An ordinary SB3 whose extension TurboWarp saved as a file-loaded `data:` URL, with a costume. */
async function legacySb3(code = bundleOf('1.0.0')) {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({targets: [{isStage: true, name: 'Stage',
        blocks: {a: {opcode: 'sample_go', topLevel: true}}, variables: {v: ['score', 3]}, costumes: []}],
    meta: {semver: '3.0.0'}, extensions: [id], extensionURLs: {[id]: fileDataUrl(code)}}));
    zip.file('costume.svg', '<svg/>');
    return zip.generateAsync({type: 'uint8array'});
}

/** The Loader's authoring controller as far as this feature uses it: snapshot, prepare, load. */
function fakeAuthoring(load: (bytes: Uint8Array, manifest: unknown) => void) {
    return {
        calls: 0,
        async apply(_request, _options, prepare, snapshot) {
            this.calls++;
            const prepared = await prepare(await snapshot());
            load(prepared.projectBytes, prepared.manifest);
        }
    };
}

async function readBack(bytes: Uint8Array) {
    const zip = await JSZip.loadAsync(bytes);
    const archive: Record<string, Uint8Array> = {};
    for (const [name, entry] of Object.entries(zip.files)) archive[name] = await entry.async('uint8array');
    const project = JSON.parse(new TextDecoder().decode(archive['project.json']));
    delete archive['project.json'];
    return {archive, project};
}

function host(initial: Uint8Array) {
    let current = initial;
    let key = 1;
    const resolved: string[] = [];
    const loaded: {bytes: Uint8Array; manifest: unknown}[] = [];
    const authoring = fakeAuthoring((bytes, manifest) => { loaded.push({bytes, manifest}); current = bytes; });
    const updates = () => createExtensionUpdates({
        authoring, zip: JSZip as any, snapshot: async () => current, projectKey: () => key,
        resolve: async reference => {
            resolved.push(reference);
            const version = reference.slice(reference.lastIndexOf('@') + 1);
            return published(version === 'latest' ? '1.1.0' : version);
        }
    });
    return {updates, authoring, resolved, loaded,
        set project(value: Uint8Array) { current = value; }, replace() { key++; }};
}

test('a legacy data: extension of unknown source is listed and updated through the Loader', async () => {
    const context = host(await legacySb3());
    const updates = context.updates();
    const [listed] = await updates.list();
    assert.equal(listed.id, id);
    assert.equal(listed.format, 'embedded-data');
    assert.equal(listed.source.kind, 'unknown');
    assert.deepEqual(listed.diagnostics.map(item => item.code), ['LEGACY_DATA_URL', 'SOURCE_UNKNOWN']);

    const requests = {[id]: {reference: packageName, version: 'latest'}};
    const plan = await updates.plan(requests);
    assert.equal(plan.blocked, false);
    assert.equal(plan.steps[0].change, 'version');
    assert.equal(plan.steps[0].to.version, '1.1.0');
    assert.equal(context.loaded.length, 0, 'checking never changes the project');

    await updates.apply(plan);
    assert.equal(context.loaded.length, 1);
    // The version is resolved once: the candidate applied is the one that was shown.
    assert.deepEqual(context.resolved, [`${packageName}@latest`]);
    const {archive, project} = await readBack(context.loaded[0].bytes);
    const [after] = await listProjectExtensions(archive, project);
    assert.equal(after.version, '1.1.0');
    assert.equal(after.sha256, hex(encode(bundleOf('1.1.0'))));
    assert.deepEqual(after.source, {kind: 'npm', package: packageName, version: '1.1.0'});
    assert.equal((context.loaded[0].manifest as any).extensions[0].id, id);
    assert.deepEqual(project.targets[0].variables, {v: ['score', 3]});
    assert.equal(new TextDecoder().decode(archive['costume.svg']), '<svg/>');
});

test('a form-only change keeps the bytes and their digest', async () => {
    const context = host(await legacySb3());
    const updates = context.updates();
    const plan = await updates.plan({[id]: {format: 'embedded-file'}});
    assert.equal(plan.steps[0].change, 'format');
    await updates.apply(plan);
    const {archive, project} = await readBack(context.loaded[0].bytes);
    const [after] = await listProjectExtensions(archive, project);
    assert.equal(after.format, 'embedded-file');
    assert.equal(after.sha256, hex(encode(bundleOf('1.0.0'))));
    assert.equal(context.resolved.length, 0);
});

test('a plan is not applied to a project that changed, was replaced, or to another plan', async () => {
    const context = host(await legacySb3());
    const updates = context.updates();
    const requests = {[id]: {reference: packageName, version: 'latest'}};

    const plan = await updates.plan(requests);
    context.project = await legacySb3(bundleOf('0.9.0'));
    await assert.rejects(updates.apply(plan), {code: 'PLAN_CHANGED'});
    assert.equal(context.loaded.length, 0);

    // The new plan replaces the old one, which can no longer be applied.
    const fresh = await updates.plan(requests);
    await assert.rejects(updates.apply(plan), {code: 'PLAN_STALE'});

    context.replace();
    await assert.rejects(updates.apply(fresh), {code: 'PROJECT_REPLACED'});
    assert.equal(context.loaded.length, 0);
    assert.equal(context.authoring.calls, 1, 'a replaced project never reaches the Loader');
});

test('a blocked plan cannot be applied', async () => {
    const context = host(await legacySb3());
    const updates = context.updates();
    // Without a published source, nothing can be resolved for this code.
    const plan = await updates.plan({[id]: {version: 'latest'}});
    assert.equal(plan.blocked, true);
    assert.deepEqual(plan.steps[0].diagnostics.map(item => item.code), ['SOURCE_UNKNOWN']);
    await assert.rejects(updates.apply(plan), {code: 'PLAN_BLOCKED'});
});

test('the screen applies only the plan its last check showed', async t => {
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://workbench.test'});
    t.after(() => dom.window.close());
    const {document} = dom.window;
    const context = host(await legacySb3());
    let closed = 0;
    const view = renderExtensionUpdateForm(document as any, 'en', () => { closed++; }, context.updates());
    document.body.append(view.element);
    const until = async (condition: () => boolean) => {
        for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.ok(condition());
    };
    const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text)!;
    await until(() => document.querySelector(`[data-extension-id="${id}"]`) !== null);
    const check = button('Check Changes');
    const apply = button('Apply');
    assert.equal(apply.disabled, true);

    const version = document.getElementById(`extension-version-${id}`) as HTMLSelectElement;
    const reference = document.getElementById(`extension-reference-${id}`) as HTMLInputElement;
    version.value = 'latest';
    version.dispatchEvent(new dom.window.Event('change'));
    reference.value = packageName;
    reference.dispatchEvent(new dom.window.Event('input'));
    check.click();
    await until(() => !apply.disabled);
    assert.match(document.querySelector('[data-extension-plan]')!.textContent!, /1\.1\.0/);
    assert.equal(context.loaded.length, 0);

    // Editing a choice after the check asks for a new one.
    reference.dispatchEvent(new dom.window.Event('input'));
    assert.equal(apply.disabled, true);
    check.click();
    await until(() => !apply.disabled);
    (view.element as HTMLFormElement).requestSubmit();
    await until(() => closed === 1);
    assert.equal(context.loaded.length, 1);
    view.dispose();
});

test('Project Properties opens the extensions screen when the host offers it', async t => {
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://workbench.test'});
    t.after(() => dom.window.close());
    const {document} = dom.window;
    (dom.window.HTMLDialogElement.prototype as any).showModal = function () { this.open = true; };
    const {createProjectDialogs} = createProjectDialogService({styles: {dialog: 'd', preview: 'p'},
        snackbarStyles: {snackbar: 's'}});
    const properties = {snapshot: () => ({readOnly: false, loading: false}), subscribe: () => () => {},
        loadState: () => ({phase: 'loaded', sequence: 1}), projectFormatStatus: () => undefined};
    const dialogs = createProjectDialogs(document, properties, null, null, {locale: 'en'});
    let opened = 0;
    dialogs.showProperties('en', {uri: 'https://example.test/a.sb3', apply: async () => {}}, {openExtensions: () => { opened++; }});
    const extensions = document.querySelector<HTMLButtonElement>('[data-testid="project-properties-extensions"]')!;
    assert.equal(extensions.textContent, 'Extensions…');
    extensions.click();
    assert.equal(opened, 1);
    dialogs.dispose();
    dialogs.showProperties('en', {uri: 'https://example.test/a.sb3', apply: async () => {}});
    assert.equal(document.querySelector('[data-testid="project-properties-extensions"]'), null);
});
