import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

// The run view launcher on the menu bar, with items another package adds through `menuItems`.
async function mountLauncher(t, props: Record<string, unknown>, menuItems?: (locale: string) => unknown[]) {
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
    const {StageLauncher} = await import('../dist/stage-launcher.js');
    const {IconMenuButton} = await import('@kubohiroya/turbowarp-plus-editor-windows');
    const root = createRoot(dom.window.document.querySelector('main')!);
    t.after(() => {
        act(() => root.unmount());
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
        if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    });
    const options = {mount: dom.window.document.body, styles: {}, MenuButton: IconMenuButton, menuItems};
    act(() => root.render(React.createElement(StageLauncher, {locale: 'ja', options, drawerOpen: false,
        focusDrawer() {}, revealStage() {}, ...props})));
    const trigger = dom.window.document.querySelector('.tw-icon-menu__trigger') as HTMLButtonElement;
    const open = () => {
        act(() => trigger.click());
        return ([...dom.window.document.querySelectorAll('[role^="menuitem"]')] as HTMLElement[]).map(button => [
            button.textContent, button.getAttribute('aria-disabled') === 'true', button.hasAttribute('data-separator-before')]);
    };
    return {trigger, open, act, document: dom.window.document};
}

test('added items follow the placements after a separator', async t => {
    const opened: string[] = [];
    const launcher = await mountLauncher(t, {}, locale => [{id: 'tests', label: `tests:${locale}`, onSelect: () => opened.push('tests')}]);
    const items = launcher.open();
    assert.deepEqual(items.map(([label]) => label), ['別ウィンドウで表示', 'タブで表示', '引出しで表示', 'tests:ja']);
    assert.deepEqual(items.at(-1), ['tests:ja', false, true]);
    launcher.act(() => (launcher.document.querySelector('[role^="menuitem"]:last-child') as HTMLElement).click());
    assert.deepEqual(opened, ['tests']);
});

test('while the run view is shown, the menu stays open to added items only', async t => {
    const launcher = await mountLauncher(t, {drawerOpen: true}, () => [{id: 'tests', label: 'tests'}]);
    assert.equal(launcher.trigger.disabled, false);
    assert.deepEqual(launcher.open().map(([label, disabled]) => [label, disabled]),
        [['別ウィンドウで表示', true], ['タブで表示', true], ['引出しで表示', true], ['tests', false]]);
});

test('without added items the shown run view disables the menu as before', async t => {
    const launcher = await mountLauncher(t, {drawerOpen: true});
    assert.equal(launcher.trigger.disabled, true);
});

test('full screen disables the menu even with added items', async t => {
    const launcher = await mountLauncher(t, {editorFullscreen: true}, () => [{id: 'tests', label: 'tests'}]);
    assert.equal(launcher.trigger.disabled, true);
});
