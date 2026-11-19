import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createFileMenuItem} from '../src/extension-file-menu.ts';

async function mountMenu(t, locale: string, folder?: Record<string, unknown>, openRemote?: () => void,
    extra: Record<string, unknown> = {}) {
    const dom = new JSDOM('<main></main>', {pretendToBeVisual: true});
    const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
        IS_REACT_ACT_ENVIRONMENT: true};
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
    }
    const React = await import('react');
    const {act} = React;
    const {createRoot} = await import('react-dom/client');
    const {default: ProjectFileMenu} = await import('../dist/project-file-menu.js');
    const h = React.createElement;
    const MenuItem = ({command, onClick, children}) => h('li', {'data-command': command, onClick}, children);
    const MenuSection = ({children}) => h('ul', null, children);
    const calls: string[] = [];
    const root = createRoot(dom.window.document.querySelector('main')!);
    t.after(() => {
        act(() => root.unmount());
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
        if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    });
    const storage = {canSave: true, filename: 'a.sb3', write: async () => {}, download: async () => {},
        finish() {}, fail() {}};
    act(() => root.render(h(ProjectFileMenu, {locale, MenuItem, MenuSection, close: () => calls.push('close'),
        entries: {create: () => calls.push('create'), open: () => calls.push('open'), restore() {}, storage, folder, openRemote,
            saveAs: () => calls.push('save-as'),
            git: h('li', {'data-command': 'git'}), externalYaml: h('li', {'data-command': 'yaml'}), ...extra}})));
    const items = [...dom.window.document.querySelectorAll('main > ul:first-of-type > li')];
    const all = [...dom.window.document.querySelectorAll('main > ul > li, main > li')];
    return {calls, act, items: items.map(item => [item.getAttribute('data-command'), item.textContent]),
        all: all.map(item => [item.getAttribute('data-command'), item.textContent]), document: dom.window.document,
        click: (command: string) => act(() => {
            (dom.window.document.querySelector(`[data-command="${command}"]`) as HTMLElement).click();
        })};
}

test('the open section lists the SB3 file, the folder and the browser folder in order', async t => {
    const folder = {open() {}, detach() {}, openBrowser() {}};
    const {items} = await mountMenu(t, 'en', folder);
    assert.deepEqual(items, [
        ['open', 'Open SB3 File…'],
        ['project-folder-open', 'Open Folder…'],
        ['project-folder-open-browser', 'Open Folder Saved in This Browser…'],
        ['git', ''],
        ['yaml', '']
    ]);
});

test('the common project catalog closes the file menu before it opens', async t => {
    const calls: string[] = [];
    const menu = await mountMenu(t, 'ja', undefined, undefined, {catalog: () => calls.push('catalog')});
    assert.deepEqual(menu.items[0], ['projects', 'プロジェクト一覧…']);
    menu.click('projects');
    assert.deepEqual(menu.calls, ['close']);
    assert.deepEqual(calls, ['catalog']);
});

test('without a browser folder the menu offers only the folder picker', async t => {
    const {items} = await mountMenu(t, 'ja', {open() {}, detach() {}});
    assert.deepEqual(items.map(([command]) => command), ['open', 'project-folder-open', 'git', 'yaml']);
    assert.equal(items[1][1], 'フォルダを開く…');
});

test('the browser folder item closes the menu and opens the folder kept in the browser', async t => {
    const calls: string[] = [];
    const menu = await mountMenu(t, 'ja', {open: () => calls.push('folder'), detach() {},
        openBrowser: () => calls.push('browser')});
    assert.deepEqual(menu.items[2], ['project-folder-open-browser', 'ブラウザーに保存したフォルダを開く…']);
    menu.click('project-folder-open-browser');
    assert.deepEqual(menu.calls, ['close']);
    assert.deepEqual(calls, ['browser']);
});

test('both folder commands get a decorative icon', () => {
    const MenuItem = createFileMenuItem('li', '/extension.svg');
    const paths = new Set<string>();
    for (const command of ['project-folder-open', 'project-folder-open-browser'] as const) {
        const [icon, label] = MenuItem({command, children: command}).props.children.props.children;
        assert.equal(icon.type, 'svg');
        assert.equal(icon.props['data-file-menu-icon'], command);
        assert.equal(icon.props['aria-hidden'], true);
        assert.equal(icon.props.stroke, 'currentColor');
        paths.add(icon.props.children.props.d);
        assert.equal(label.props.children, command);
    }
    assert.equal(paths.size, 2);
});

test('without device folders (Safari, Firefox), Open Folder is unavailable with the reason, and the browser folder opens', async t => {
    const opened: string[] = [];
    const folder = {open: () => opened.push('device'), openBrowser: () => opened.push('browser'), detach() {}, deviceFolders: false};
    const {items, click} = await mountMenu(t, 'ja', folder);
    assert.deepEqual(items.map(([command]) => command), ['open', 'project-folder-open', 'project-folder-open-browser', 'git', 'yaml']);
    const open = globalThis.document.querySelector('[data-command="project-folder-open"] [role="button"]')!;
    assert.equal(open.getAttribute('aria-disabled'), 'true');
    assert.equal(open.getAttribute('tabindex'), '-1');
    assert.match(open.getAttribute('title')!, /Chrome か Edge/);
    click('project-folder-open');
    assert.deepEqual(opened, []);
    click('project-folder-open-browser');
    assert.deepEqual(opened, ['browser']);
});

test('with device folders, Open Folder stays available and has no unavailable note', async t => {
    const {items} = await mountMenu(t, 'en', {open() {}, detach() {}, deviceFolders: true});
    assert.equal(items[1][0], 'project-folder-open');
    const open = globalThis.document.querySelector('[data-command="project-folder-open"] [role="button"]')!;
    assert.equal(open.getAttribute('aria-disabled'), null);
    assert.equal(open.getAttribute('title'), null);
});

test('the remote Git repository item follows the browser folder only when the host offers it', async t => {
    const opened: string[] = [];
    const menu = await mountMenu(t, 'en', {open() {}, detach() {}, openBrowser() {}}, () => opened.push('remote'));
    assert.deepEqual(menu.items.map(([command]) => command),
        ['open', 'project-folder-open', 'project-folder-open-browser', 'git-open-remote', 'git', 'yaml']);
    assert.equal(menu.items[3][1], 'Open Remote Git Repository…');
    menu.click('git-open-remote');
    assert.deepEqual(menu.calls, ['close']);
    assert.deepEqual(opened, ['remote']);
});

test('the remote Git repository item has a Japanese label', async t => {
    const withRemote = await mountMenu(t, 'ja', undefined, () => {});
    assert.deepEqual(withRemote.items.map(([command]) => command), ['open', 'git-open-remote', 'git', 'yaml']);
    assert.equal(withRemote.items[1][1], 'Git のリモートリポジトリを開く…');
});

test('without openRemote the menu has no remote Git repository item', async t => {
    const {items} = await mountMenu(t, 'en', {open() {}, detach() {}, openBrowser() {}});
    assert.ok(!items.some(([command]) => command === 'git-open-remote'));
});

test('the remote Git repository item gets its own decorative icon', () => {
    const MenuItem = createFileMenuItem('li', '/extension.svg');
    const path = (command: string) => MenuItem({command, children: command}).props.children.props.children[0];
    const icon = path('git-open-remote');
    assert.equal(icon.type, 'svg');
    assert.equal(icon.props['data-file-menu-icon'], 'git-open-remote');
    assert.equal(icon.props['aria-hidden'], true);
    assert.equal(icon.props.viewBox, '0 0 24 24');
    const others = ['open', 'project-folder-open', 'project-folder-open-browser', 'download', 'new']
        .map(command => path(command).props.children.props.d);
    assert.ok(!others.includes(icon.props.children.props.d));
});

test('the File menu lists Create New Project, Save a Copy of the Project and the rest in order', async t => {
    const en = await mountMenu(t, 'en');
    assert.deepEqual(en.all.filter(([command]) => ['new', 'open', 'save', 'save-as', 'restore'].includes(command)), [
        ['new', 'Create New Project'],
        ['open', 'Open SB3 File…'],
        ['save', 'Save ProjectCtrl+S'],
        ['save-as', 'Save a Copy of the Project…'],
        ['restore', 'Restore Points']
    ]);
    en.click('new');
    assert.deepEqual(en.calls, ['close', 'create']);
    en.click('save-as');
    assert.deepEqual(en.calls.slice(2), ['close', 'save-as']);
});

test('with createIn, Create New Project… opens the dialog, and the default creates the project in memory', async t => {
    const requests: unknown[] = [];
    const menu = await mountMenu(t, 'ja', undefined, undefined, {
        createIn: async (request: unknown) => {requests.push(request); return 'created';},
        newProject: {defaultTitle: 'Scratch の作品', browserFolders: true}
    });
    assert.deepEqual(menu.all.filter(([command]) => command === 'new' || command === 'save-as'), [
        ['new', '新しいプロジェクトを作成…'],
        ['save-as', 'プロジェクトのコピーを保存…']
    ]);
    menu.click('new');
    assert.deepEqual(menu.calls, ['close']);
    const dialog = menu.document.querySelector('[data-new-project-dialog]');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('h2').textContent, '新しいプロジェクトを作成');
    assert.deepEqual([...dialog.querySelectorAll<HTMLInputElement>('input[name="destination"]')].map(input => input.value),
        ['memory', 'browser']);
    (dialog.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    assert.deepEqual(menu.calls, ['close', 'create']);
    assert.deepEqual(requests, []);
    assert.equal(menu.document.querySelector('[data-new-project-dialog]'), null);
});

test('Save Project with no target opens the save form, and the copy stays separate', async t => {
    const none = await mountMenu(t, 'ja', undefined, undefined, {saveNew: () => none.calls.push('save-new')});
    const save = () => none.document.querySelector('[data-command="save"] [role="button"]');
    assert.equal(save().getAttribute('aria-disabled'), null);
    assert.equal(save().textContent, 'プロジェクトを保存Ctrl+S');
    none.click('save');
    none.click('save-as');
    assert.deepEqual(none.calls, ['close', 'save-new', 'close', 'save-as']);
});

test('Save Project with a target overwrites it', async t => {
    const base = {canSave: true, filename: 'a.sb3', write: async () => {}, download: async () => {}, finish() {}, fail() {}};
    const target = await mountMenu(t, 'en', undefined, undefined, {
        saveNew: () => target.calls.push('save-new'),
        storage: {...base, overwrite: () => target.calls.push('overwrite')}
    });
    target.click('save');
    assert.deepEqual(target.calls, ['close', 'overwrite']);
});

test('Save Project with no target and no save form stays disabled', async t => {
    const without = await mountMenu(t, 'en');
    assert.equal(without.document.querySelector('[data-command="save"] [role="button"]').getAttribute('aria-disabled'), 'true');
});
