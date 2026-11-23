import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

// The run view menu in the editor, with items another package adds through `menuItems`.
async function openMenu(t, menuItems?: (locale: string) => unknown[], locale = 'en') {
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
    const {createStageDisplayMenu} = await import('../dist/stage-display-menu.js');
    const h = React.createElement;
    const WindowLayoutContext = React.createContext({plusLayout: false, stageDrawer: false});
    const StageDisplayMenuContext = React.createContext(null);
    const {StageDisplayMenu} = createStageDisplayMenu({
        WindowLayoutContext, StageDisplayMenuContext, layoutFlags: {stageDisplayMenu: true}, styles: {},
        workbenchStyles: {}, fullscreenIcon: 'full.svg', exitFullscreenIcon: 'exit.svg',
        connectFullscreen: component => component, fullscreenMount: () => null, menuItems
    });
    const root = createRoot(dom.window.document.querySelector('main')!);
    t.after(() => {
        act(() => root.unmount());
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
        if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    });
    const presets = ['small', 'large', 'full'].map(title => ({title, isSelected: title === 'large', handleClick() {}, icon: `${title}.svg`}));
    act(() => root.render(h(StageDisplayMenu, {locale, presets, fullscreen: {title: 'Full screen', handleClick() {}}})));
    act(() => (dom.window.document.querySelector('.tw-icon-menu__trigger') as HTMLElement).click());
    const buttons = [...dom.window.document.querySelectorAll('[role^="menuitem"]')] as HTMLElement[];
    return {
        act,
        items: buttons.map(button => [button.textContent, button.hasAttribute('data-separator-before')]),
        click: (label: string) => act(() => buttons.find(button => button.textContent === label)!.click())
    };
}

test('without added items the menu has only its own items', async t => {
    const {items} = await openMenu(t);
    assert.deepEqual(items.map(([label]) => label), ['large', 'Full screen', 'Undock run view']);
});

test('added items follow the menu\'s own after a separator, in the menu\'s language', async t => {
    const selected: string[] = [];
    const seen: string[] = [];
    const {items, click} = await openMenu(t, locale => {
        seen.push(locale);
        return [
            {id: 'tests', label: 'テスト実行画面を開く', onSelect: () => selected.push('tests')},
            {id: 'other', label: 'もう1つ', separatorBefore: true, onSelect: () => selected.push('other')}
        ];
    }, 'ja');
    assert.ok(seen.every(locale => locale === 'ja'));
    assert.deepEqual(items.slice(-2), [['テスト実行画面を開く', true], ['もう1つ', true]]);
    click('テスト実行画面を開く');
    assert.deepEqual(selected, ['tests']);
});

test('an empty list adds nothing', async t => {
    const {items} = await openMenu(t, () => []);
    assert.equal(items.length, 3);
});
