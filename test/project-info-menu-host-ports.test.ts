import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

for (const locale of ['en', 'ja'] as const) {
    test(`the project menu opens the host display and runtime ports in ${locale}`, async t => {
        const dom = new JSDOM('<main></main>', {pretendToBeVisual: true});
        const previous = new Map<string, PropertyDescriptor | undefined>();
        for (const [key, value] of Object.entries({
            window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
            HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
            HTMLLIElement: dom.window.HTMLLIElement, IS_REACT_ACT_ENVIRONMENT: true
        })) {
            previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
            Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
        }
        const React = await import('react');
        const {act, createElement: h} = React;
        const {createRoot} = await import('react-dom/client');
        const {ProjectInfoMenu} = await import('../dist/info-menu.js');
        const document = dom.window.document;
        const root = createRoot(document.querySelector('main')!);
        t.after(() => {
            act(() => root.unmount());
            dom.window.close();
            for (const [key, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
        });

        const calls: string[] = [];
        const record = (name: string) => () => { calls.push(name); };
        const action = (name: string) => ({icon: '/icon.svg', onClick: record(name)});
        const Host = () => {
            const [open, setOpen] = React.useState(false);
            return h(ProjectInfoMenu, {
                locale, version: '0.4.1', logo: '/logo.svg', leading: true,
                displaySettings: {
                    open,
                    onOpen() { calls.push('display-open'); setOpen(true); },
                    onClose() { calls.push('display-close'); setOpen(false); },
                    items: h('li', null, h('button', {onClick: record('display-item')}, 'Host setting'))
                },
                renderRuntimeSettings: Item => h(React.Fragment, null,
                    h(Item, {onClick: record('runtime')}, 'Host runtime'),
                    h(Item, {closeOnSelect: true, onClick: record('runtime-dialog')}, 'Host dialog')),
                addons: action('addons'), advanced: action('advanced'),
                githubConnection: action('github'), aiAgents: action('ai-agents')
            });
        };

        act(() => root.render(h(Host)));
        const details = document.querySelector('details')!;
        const summary = document.querySelector('summary')!;
        const nav = document.querySelector('nav')!;
        const entries = [...nav.querySelectorAll(':scope > a, :scope > button, :scope > div > button')];
        assert.deepEqual(entries.map(entry => entry.textContent), locale === 'en' ? [
            'About TurboWarp Plus Editor 0.4.1', 'Display settings', 'Runtime settings', 'Addons',
            'Advanced Settings', 'GitHub Connection Settings…', 'AI agent settings…',
            'TurboWarp-Plus source code', 'TurboWarp licenses and credits'
        ] : [
            'TurboWarp Plus Editor 0.4.1について', '表示設定', '動作設定', 'アドオン',
            '高度な設定', 'GitHub 接続設定…', 'AI エージェント設定…',
            'TurboWarp-Plusのソースコード', 'TurboWarpのライセンスとクレジット'
        ]);
        const click = (element: Element) => act(() => (element as HTMLElement).click());
        const key = (element: Element, value: string) => act(() => {
            element.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true}));
        });
        click(summary);
        click(entries[1]);
        const displayItem = nav.querySelector('li')!;
        assert.equal(displayItem.tabIndex, 0);
        key(displayItem, 'Enter');
        assert.deepEqual(calls, ['display-open', 'display-item']);
        click(entries[2]);
        assert.equal(nav.querySelector('ul'), null);
        assert.equal(calls.at(-1), 'display-close');
        const [runtime, dialog] = nav.querySelectorAll('[role="group"] button');
        click(runtime);
        assert.equal(calls.at(-1), 'runtime');
        assert.equal(details.open, true);
        click(dialog);
        assert.equal(calls.at(-1), 'runtime-dialog');
        assert.equal(details.open, false);
        for (const [index, name] of [[3, 'addons'], [4, 'advanced'], [5, 'github'], [6, 'ai-agents']] as const) {
            click(summary);
            click(entries[index]);
            assert.equal(calls.at(-1), name);
            assert.equal(details.open, false);
        }
    });
}
