import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

test('folder integration uses native ports, exposes workflows, and releases its VM binding on disposal', {timeout: 30000}, async t => {
    const bundled = await build({stdin: {resolveDir: process.cwd(), contents:
        `export {createProjectFolderIntegration} from './dist/project-folder-integration.js';`},
        bundle: true, write: false, format: 'iife', globalName: 'folderTest', target: 'es2022'});
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:41225/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
    await page.goto('http://localhost:41225/');
    await page.addScriptTag({content: bundled.outputFiles[0].text});
    const result = await page.evaluate(async () => {
        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        const vm = {runtime: {on(event, callback) {vm.on(event, callback);}, off(event, callback) {vm.off(event, callback);}, storage: {}, threads: [], isActiveThread: () => false, targets: [], getTargetForStage: () => null},
            on(event, callback) {if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback);},
            off(event, callback) {listeners.get(event)?.delete(callback);}};
        let current = true;
        let host;
        const noop = () => undefined;
        const integration = (window as any).folderTest.createProjectFolderIntegration({
            environment: () => ({isCurrent: () => current, isProjectDirty: () => false, isRunning: () => false,
                subscribe: () => noop, markSaved: noop, clearFileHandle: noop, setTitle: noop, getTitle: () => 'Project',
                captureHost: value => {host = value;}}),
            repository: {}, tools: {bindProjectCatalogFolder: noop, loadedProjectTitle: noop, projectSaveName: noop,
                projectScreenState: noop, setProjectSaveName: noop}, versions: {available: () => false}, runSavedGenerationTests: noop
        });
        const attach = () => integration.attachProjectFolder(vm, document, false, false, 'en', async () => ({}),
            {deserializeBlocks: noop, createBlockContainer: noop});
        current = false;
        const stale = attach();
        current = true;
        const mounted = attach();
        const workflows = integration.projectFolderWorkflows(vm);
        const before = {stale: stale === null, mounted: Boolean(mounted), isRunning: host.isRunning(),
            browser: workflows?.locations?.browser, directory: integration.projectFolderDirectory(vm),
            status: document.querySelectorAll('[data-project-folder-status]').length};
        mounted?.dispose();
        return {before, released: integration.projectFolderWorkflows(vm) === undefined,
            statusAfter: document.querySelectorAll('[data-project-folder-status]').length};
    });
    assert.deepEqual(result, {before: {stale: true, mounted: true, isRunning: false, browser: true,
        directory: null, status: 1}, released: true, statusAfter: 0});
    assert.deepEqual(errors, []);
});
