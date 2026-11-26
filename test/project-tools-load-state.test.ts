// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createProjectTools} from '../dist/project-tools/integration.js';
import {createProjectProperties, PROJECT_INFO_KEY} from '../dist/project-tools/properties.js';
import {createProjectDialogService} from '../dist/project-tools/dialog.js';

for (const metadataEnabled of [false, true]) {
    test(`project load diagnostics survive a later success with metadata ${metadataEnabled ? 'on' : 'off'}`, async t => {
        const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://workbench.test'});
        const {document} = dom.window;
        dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        t.after(() => dom.window.close());
        const failed = {target: 'bad'};
        const recovered = {target: 'good', [PROJECT_INFO_KEY]: {schemaVersion: 1, title: 'Recovered'}};
        const issue = Object.assign(new Error('Invalid project bytes'), {code: 'INVALID_ARCHIVE'});
        let current: unknown = failed;
        let report: (event: {type: string; code: string; message: string}) => void;
        const nativeLoad = async (input: unknown) => {
            if (input === failed) {
                report({type: 'project-error', code: issue.code, message: issue.message});
                throw issue;
            }
            current = input;
        };
        const vm = {loadProject: nativeLoad, toJSON: () => JSON.stringify(current), runtime: {}};
        let title = 'Native title';
        let extensionHostDisposals = 0;
        const hostEvents: string[] = [];
        const {createProjectDialogs} = createProjectDialogService({
            styles: {dialog: 'test-dialog', preview: 'test-preview'}, snackbarStyles: {snackbar: 'test-snackbar'},
            isCancelled: () => false
        });
        const tools = createProjectTools({
            installEditorExtensionHost: (_vm, options) => {
                report = options.diagnostics;
                return {enabled: true, dispose() { extensionHostDisposals++; }};
            },
            installProjectProperties: createProjectProperties({
                beginProjectArchiveRead: () => undefined, projectSerializationOptions: () => undefined
            }),
            createProjectDialogs, editorProjectArchives: {}, projectToolsEnabled: metadataEnabled,
            manualProjectURIEnabled: false, readStartupFlags: () => ({saveWorkspace: false}),
            projectLoadState: () => undefined
        });
        const host = tools.installProjectToolsHost(vm, {document, locale: 'en',
            projectState: {getTitle: () => title, setTitle: next => { title = next; }},
            diagnostics: event => { hostEvents.push(event.code); }});
        t.after(() => host.dispose());

        await assert.rejects(vm.loadProject(failed), error => error === issue);
        assert.equal(tools.isProjectLoading(vm), false);
        const terminal = document.querySelector<HTMLElement>('[data-testid="project-load-failure"]');
        assert.equal(terminal?.dataset.outcome, 'failed');
        assert.equal(document.querySelector('[data-testid="project-diagnostics-snackbar"]'), null);
        assert.deepEqual(hostEvents, [issue.code]);
        assert.equal(title, 'Native title');

        await vm.loadProject(recovered);
        assert.equal(tools.isProjectLoading(vm), false);
        assert.equal(terminal?.isConnected, false);
        assert.equal(title, metadataEnabled ? 'Recovered' : 'Native title');
        const MenuItem = () => null;
        const MenuSection = () => null;
        let menuClosed = 0;
        const menu = () => tools.renderFileMenu({
            vm, MenuItem, MenuSection, onRequestClose() { menuClosed++; }
        });
        const items = ([] as any[]).concat(menu()?.props.children ?? []);
        assert.deepEqual(items.map(item => item.key), metadataEnabled ? ['properties', 'diagnostics'] : ['diagnostics']);
        items.find(item => item.key === 'diagnostics').props.onClick();
        assert.equal(menuClosed, 1);
        const log = document.querySelector<HTMLElement>('[data-testid="project-diagnostics"]');
        const selector = log?.querySelector<HTMLSelectElement>('select');
        assert.ok(selector);
        assert.match(selector.selectedOptions[0]?.textContent ?? '', /· Loaded$/);
        const earlierFailure = Array.from(selector.options).find(option => /· Failed or cancelled$/.test(option.text));
        assert.ok(earlierFailure);
        selector.value = earlierFailure.value;
        selector.dispatchEvent(new dom.window.Event('change'));
        assert.match(log?.textContent ?? '', /INVALID_ARCHIVE/);
        await host.dispose();
        assert.equal(extensionHostDisposals, 1);
        assert.equal(vm.loadProject, nativeLoad);
        assert.equal(menu(), null);
        assert.equal(document.querySelector('[data-testid="project-diagnostics"]'), null);
    });
}
