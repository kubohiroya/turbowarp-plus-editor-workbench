import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

// The run view menu in the editor, with items another package adds through `menuItems`.
async function openMenu(t, menuItems?: (locale: string) => unknown[], locale = 'en', options: {
    plusLayout?: boolean;
    stageHidden?: boolean;
    setStageVisible?(visible: boolean): void;
    fixedPreset?: boolean;
} = {}) {
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
    const WindowLayoutContext = React.createContext({plusLayout: options.plusLayout ?? false, stageDrawer: false,
        stageHidden: options.stageHidden ?? false, setStageVisible: options.setStageVisible});
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
    const presets = (options.fixedPreset === false ? ['small', 'full'] : ['small', 'large', 'full']).map(title => ({title, isSelected: title === 'large', handleClick() {}, icon: `${title}.svg`}));
    act(() => root.render(h(StageDisplayMenu, {locale, presets, fullscreen: {title: 'Full screen', handleClick() {}}})));
    act(() => (dom.window.document.querySelector('.tw-icon-menu__trigger') as HTMLElement).click());
    const buttons = [...dom.window.document.querySelectorAll('[role^="menuitem"]')] as HTMLElement[];
    return {
        act,
        buttons,
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


// The menu presentation and pin-state matrix belong to Workbench. The Editor
// integration covers the live canvas and restoring the saved choice on reload.
for (const [pinned, label, slash] of [
    [true, '引出しを自動的に隠す', true],
    [false, '引出しを常時表示する', false]
] as const) {
    test(`the stage drawer pin menu describes the action when pinned=${pinned}`, async t => {
        const {stageDrawerPinItem} = await import('../dist/stage-launcher.js');
        const selected: boolean[] = [];
        const {buttons, click} = await openMenu(t,
            locale => [stageDrawerPinItem(locale, pinned, value => selected.push(value))], 'ja');
        const item = buttons.find(button => button.textContent === label);
        assert.ok(item);
        assert.equal(item.getAttribute('aria-disabled'), null);
        assert.equal(item.getAttribute('aria-current'), null);
        assert.equal(Boolean(item.querySelector('svg path[d="M2 2l12 12"]')), slash);
        click(label);
        assert.deepEqual(selected, [!pinned]);
    });
}

// Without a fixed-width preset, size choices stay out of the run-view menu.
for (const [locale, stageHidden, action, fullscreen, dock] of [
    ['en', false, 'Hide run view', 'Full screen', 'Undock run view'],
    ['en', true, 'Show run view', 'Full screen', 'Undock run view'],
    ['ja-JP', false, '実行画面を隠す', '全画面表示にする', 'アンドック'],
    ['ja-JP', true, '実行画面を表示', '全画面表示にする', 'アンドック']
] as const) {
    test(`the run view menu offers exactly the available preset and visibility actions (${locale}, hidden=${stageHidden})`,
        async t => {
            const visible: boolean[] = [];
            const {buttons, click} = await openMenu(t, undefined, locale, {
                plusLayout: true, stageHidden, fixedPreset: false,
                setStageVisible(value) {visible.push(value);}
            });
            assert.deepEqual(buttons.map(button => [button.textContent, button.getAttribute('role')]), [
                [fullscreen, 'menuitem'], [action, 'menuitem'], [dock, 'menuitem']
            ]);
            click(action);
            assert.deepEqual(visible, [stageHidden]);
        });
}
