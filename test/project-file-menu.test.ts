import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createFileMenuItem} from '../src/extension-file-menu.ts';

async function mountMenu(t, locale: string, folder?: Record<string, () => void>) {
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
        entries: {create() {}, open: () => calls.push('open'), restore() {}, storage, folder,
            git: h('li', {'data-command': 'git'}), externalYaml: h('li', {'data-command': 'yaml'})}})));
    const items = [...dom.window.document.querySelectorAll('main > ul:first-of-type > li')];
    return {calls, act, items: items.map(item => [item.getAttribute('data-command'), item.textContent]),
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
