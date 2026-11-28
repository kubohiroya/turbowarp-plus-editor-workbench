// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createProjectTools} from '../dist/project-tools/integration.js';
import {createProjectProperties} from '../dist/project-tools/properties.js';
import {createProjectDialogService} from '../dist/project-tools/dialog.js';

test('the cache manager project follows the open project URI and the Editor save flag', async t => {
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://workbench.test'});
    const {document} = dom.window;
    t.after(() => dom.window.close());
    let current: unknown = {targets: []};
    const vm = {loadProject: async (input: unknown) => { current = input; }, toJSON: () => JSON.stringify(current), runtime: {}};
    const payloads = {cacheEmbedding() {}, releaseAfterSave() {}};
    let reportURI: (uri: string | undefined) => void = () => {};
    const forwarded: (string | undefined)[] = [];
    let dirty = false;
    const listeners = new Set<() => void>();
    const setDirty = (value: boolean) => { dirty = value; for (const listener of [...listeners]) listener(); };
    const {createProjectDialogs} = createProjectDialogService({
        styles: {dialog: 'test-dialog', preview: 'test-preview'}, snackbarStyles: {snackbar: 'test-snackbar'},
        isCancelled: () => false
    });
    const tools = createProjectTools({
        installEditorExtensionHost: (_vm, options) => {
            reportURI = options.onProjectURI;
            return {enabled: true, payloads, dispose() {}};
        },
        installProjectProperties: createProjectProperties({
            beginProjectArchiveRead: () => undefined, projectSerializationOptions: () => undefined
        }),
        createProjectDialogs, editorProjectArchives: {}, projectToolsEnabled: false,
        manualProjectURIEnabled: false, readStartupFlags: () => ({saveWorkspace: false}),
        projectLoadState: () => undefined,
        catalogEnvironment: () => ({readFile: () => null, isDirty: () => dirty,
            subscribeLocation(listener) { listeners.add(listener); return () => listeners.delete(listener); }})
    });
    assert.equal(tools.cacheManagerProject(vm, document), undefined);
    const host = tools.installProjectToolsHost(vm, {document, locale: 'en',
        projectState: {getTitle: () => 'Story', setTitle() {}}, onProjectURI: (uri: string | undefined) => forwarded.push(uri)});
    t.after(() => host.dispose());

    const project = tools.cacheManagerProject(vm, document)!;
    assert.equal(project.bucket(), undefined);
    reportURI('https://workbench.test/projects/a');
    assert.equal(project.bucket(), 'https://workbench.test/projects/a');
    assert.deepEqual(forwarded, ['https://workbench.test/projects/a']);
    assert.equal(project.title(), 'Story');
    assert.equal(project.payloads, payloads);

    // A clean project is not "saved" until it has had unsaved changes and they clear.
    let saved: boolean | undefined;
    const others = listeners.size;
    void project.whenSaved().then(value => { saved = value; });
    await Promise.resolve();
    assert.equal(saved, undefined);
    setDirty(true);
    await Promise.resolve();
    assert.equal(saved, undefined);
    setDirty(false);
    await Promise.resolve();
    assert.equal(saved, true);
    assert.equal(listeners.size, others);

    // Opening another project first settles false, even when its flag is clear.
    let replaced: boolean | undefined;
    setDirty(true);
    void project.whenSaved().then(value => { replaced = value; });
    await vm.loadProject({targets: [], other: true});
    setDirty(false);
    await Promise.resolve();
    assert.equal(replaced, false);
});
