// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';

test('the logo follows loaded project format, not save state', {timeout: 30000}, async t => {
    const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
        export {default as React} from 'react';
        export {createRoot} from 'react-dom/client';
        export {ProjectInfoMenu} from './dist/info-menu.js';
        export {createProjectTools} from './dist/project-tools/integration.js';
        export {createProjectDialogService} from './dist/project-tools/dialog.js';
        export {createProjectProperties} from './dist/project-tools/properties.js';`},
    bundle: true, write: false, format: 'iife', globalName: 'projectFormatTest', target: 'es2022'});
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(4000);
    await page.route('http://localhost:41225/**', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><header></header>'}));
    await page.goto('http://localhost:41225/');
    await page.addScriptTag({content: bundled.outputFiles[0].text});
    await page.addStyleTag({content: await readFile('src/info-menu.css', 'utf8')});
    await page.evaluate(async () => {
        const w = window as any;
        const {createProjectTools, createProjectDialogService, createProjectProperties, ProjectInfoMenu, React, createRoot} = w.projectFormatTest;
        const {createProjectDialogs} = createProjectDialogService({
            styles: {dialog: 'dialog'}, snackbarStyles: {snackbar: 'notice'}
        });
        w.originalProject = {targets: [], turboWarpPlus: {schemaVersion: 1, extensions: []},
            extensionURLs: {example: 'data:text/javascript;base64,YQ=='}};
        const vm = {
            async loadProject(input) { if (input === null) throw new Error('Read failed'); },
            async saveProjectSb3() {return 'saved';},
            toJSON: () => JSON.stringify({targets: []}),
            runtime: {}
        };
        const tools = createProjectTools({
            installEditorExtensionHost: () => ({dispose() {}}),
            installProjectProperties: createProjectProperties({
                beginProjectArchiveRead: () => undefined, projectSerializationOptions: () => undefined
            }),
            createProjectDialogs, editorProjectArchives: {}, projectToolsEnabled: true,
            manualProjectURIEnabled: false, readStartupFlags: () => ({saveWorkspace: false}),
            projectLoadState: () => undefined
        });
        const root = createRoot(document.querySelector('header'));
        const source = tools.projectFormatSource(vm);
        w.renderLocale = locale => root.render(React.createElement(ProjectInfoMenu, {
            leading: true, projectFormat: source, locale, version: 'test',
            logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"%3E%3Ccircle cx="15" cy="15" r="15" fill="%230067cc"/%3E%3C/svg%3E'
        }));
        w.renderLocale('en');
        w.install = () => w.host = tools.installProjectToolsHost(vm, {document, locale: 'en'});
        w.open = project => vm.loadProject(project);
        w.save = () => vm.saveProjectSb3();
    });
    const trigger = page.locator('header summary');
    const logo = trigger.locator('img');
    const originalIcon = await logo.getAttribute('src');
    const check = async (description: string, filter: string) => {
        await expect(trigger).toHaveAttribute('title', description);
        await expect(trigger).toHaveAccessibleDescription(description);
        await expect(logo).toHaveCSS('filter', filter);
        await expect(logo).toHaveCSS('opacity', '1');
        await expect(logo).toHaveAttribute('src', originalIcon!);
    };
    await check('Project format: Unknown', 'none');
    await page.evaluate(async () => {
        const w = window as any;
        w.install();
        await w.open(w.originalProject);
    });
    await check('Project format: TurboWarp+', 'none');
    await page.evaluate(() => (window as any).open({targets: []}));
    await check('Project format: Standard', 'grayscale(1)');
    await page.evaluate(() => (window as any).save());
    await check('Project format: Standard', 'grayscale(1)');

    await trigger.click();
    await expect(page.getByRole('navigation', {name: 'TurboWarp Plus project information'})).toBeVisible();
    await trigger.press('Escape');
    await expect(page.getByRole('navigation', {name: 'TurboWarp Plus project information'})).toBeHidden();
    await page.evaluate(async () => {
        const w = window as any;
        await w.open(null).catch(() => {});
        w.renderLocale('ja');
    });
    await check('プロジェクト形式：標準', 'grayscale(1)');
    await page.evaluate(() => (window as any).open((window as any).originalProject));
    await check('プロジェクト形式：TurboWarp+', 'none');
    await page.evaluate(() => (window as any).open({targets: []}));
    await check('プロジェクト形式：標準', 'grayscale(1)');
    await page.evaluate(() => (window as any).host.dispose());
    await check('プロジェクト形式：未確認', 'none');
});
