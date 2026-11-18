import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import React from 'react';
import ReactDOM from 'react-dom';
import {act} from 'react-dom/test-utils';
import {JSDOM} from 'jsdom';
import {useSpriteTabs} from '../dist/sprite-tabs.js';
import {spriteEditorSections} from '@kubohiroya/turbowarp-plus-editor-sprite-panes/sprite-editor-toolbar';

test('code uses the same two filters, with independent split-pane state and isolated keyboard input', async t => {
    const dom = new JSDOM('<main></main>', {pretendToBeVisual: true});
    const resize = class {observe() {} unobserve() {} disconnect() {}};
    const globals = {window: dom.window, document: dom.window.document, Node: dom.window.Node,
        HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
        requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
        cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), ResizeObserver: resize};
    Object.assign(globalThis, globals);
    Object.assign(dom.window, {ResizeObserver: resize});
    const mount = dom.window.document.querySelector('main');
    const listeners = new Set<() => void>();
    const values = new Map();
    const adapter = {
        capture() {}, restore() {}, renderInactive() {},
        relations: {
            getVisibility: id => values.get(id) ?? {function: true, message: true},
            setVisibility(id, value) {values.set(id, value); for (const listener of listeners) listener();},
            subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}
        }
    };
    t.after(() => {
        act(() => {ReactDOM.unmountComponentAtNode(mount);});
        assert.equal(listeners.size, 0, 'unmount removes the settings subscription');
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
    });
    const target = {id: 'hero', isOriginal: true, isStage: false, getName: () => 'Hero'};
    const vm = Object.assign(new EventEmitter(), {editingTarget: target, runtime: {targets: [target]}, setEditingTarget() {}});
    let tabs: ReturnType<typeof useSpriteTabs>;
    function Host() {
        tabs = useSpriteTabs({available: true, enabled: true, multiView: true, vm, locale: 'ja', activeSection: 0,
            className: 'fixture-tabs', resize() {}, viewAdapter: adapter,
            renderToolbar: (view, actions) => React.createElement('div', {'data-fixture-toolbar': view.id}, actions.sectionControls)});
        return tabs.renderEditorTabRow(React.createElement('div', null, 'Native editor'));
    }
    await act(async () => {ReactDOM.render(React.createElement(Host), mount);});
    const controller = tabs.controller.current;
    await act(async () => {controller.split('right');});
    const [first, second] = controller.targetTabs(target.id).map(view => view.id);
    const toolbar = id => mount.querySelector(`[data-fixture-toolbar="${id}"]`);
    const filter = (id, kind) => toolbar(id).querySelector<HTMLButtonElement>(`button[data-relation-kind="${kind}"]`);
    assert.equal(filter(first, 'function').getAttribute('aria-pressed'), 'true');
    assert.equal(filter(first, 'message').getAttribute('aria-pressed'), 'true');
    assert.equal(filter(first, 'function').title, '関数の呼び出し関係を隠す');
    for (const [kind, functions, messages] of [['function', false, true], ['message', false, false],
        ['function', true, false], ['message', true, true]] as const) {
        await act(async () => {filter(first, kind).click();});
        assert.deepEqual(adapter.relations.getVisibility(first), {function: functions, message: messages});
        assert.equal(filter(first, 'function').getAttribute('aria-pressed'), String(functions));
        assert.equal(filter(first, 'message').getAttribute('aria-pressed'), String(messages));
        assert.equal(filter(second, 'function').getAttribute('aria-pressed'), 'true');
        assert.equal(filter(second, 'message').getAttribute('aria-pressed'), 'true');
    }
    let keys = 0;
    dom.window.document.addEventListener('keydown', () => keys++);
    filter(first, 'function').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    assert.equal(keys, 0, 'Blockly does not receive toolbar keys');
    await act(async () => {filter(first, 'message').click(); controller.setViewSection(first, 1);});
    assert.equal(toolbar(first).querySelector('button'), null);
    await act(async () => {controller.setViewSection(first, 0);});
    assert.equal(filter(first, 'message').getAttribute('aria-pressed'), 'false');
    assert.equal(filter(first, 'message').title, 'メッセージの送受信関係を表示');
});

test('relationship controls update their own split view and survive a section change', async t => {
    const dom = new JSDOM('<main></main>', {pretendToBeVisual: true});
    const resize = class {observe() {} unobserve() {} disconnect() {}};
    const globals = {window: dom.window, document: dom.window.document, Node: dom.window.Node,
        HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
        requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
        cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), ResizeObserver: resize};
    Object.assign(globalThis, globals);
    Object.assign(dom.window, {ResizeObserver: resize});
    const mount = dom.window.document.querySelector('main');
    t.after(() => {
        act(() => {ReactDOM.unmountComponentAtNode(mount);});
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
    });
    const target = {id: 'hero', isOriginal: true, isStage: false, getName: () => 'Hero'};
    const vm = Object.assign(new EventEmitter(), {
        editingTarget: target, runtime: {targets: [target]}, setEditingTarget() {}
    });
    let tabs: ReturnType<typeof useSpriteTabs>;
    const getFunctions = () => ({targetId: target.id, isStage: false, functions: [{
        id: 'f', kind: 'procedure' as const, proccode: 'f', argumentNames: [], warp: false,
        x: 0, y: 0, calls: 0, scriptCalls: 0, callees: []
    }]});
    const renderToolbar = (view, actions) => React.createElement('div', {'data-fixture-toolbar': view.id}, actions.sectionControls);
    function Host() {
        tabs = useSpriteTabs({available: true, enabled: true, multiView: true, vm, locale: 'en', activeSection: 0,
            className: 'fixture-tabs', resize() {}, getFunctions, renderToolbar});
        return tabs.renderEditorTabRow(React.createElement('div', null, 'Native editor'));
    }
    await act(async () => {ReactDOM.render(React.createElement(Host), mount);});
    const controller = tabs.controller.current;
    assert.ok(controller);
    await act(async () => {controller.split('right');});
    const [first, second] = controller.targetTabs(target.id).map(view => view.id);
    assert.ok(first && second);
    const calls = spriteEditorSections.indexOf('calls');
    await act(async () => {
        controller.setViewSection(first, calls);
        controller.setViewSection(second, calls);
    });
    const toolbar = id => [...mount.querySelectorAll<HTMLElement>('[data-fixture-toolbar]')]
        .find(node => node.dataset.fixtureToolbar === id);
    const flow = id => toolbar(id).querySelector<HTMLButtonElement>('.tw-sprite-functions__flow-toggle button[aria-pressed="true"]');
    const graph = id => toolbar(id).closest('.tw-plus-sprite-tab-slot').querySelector('.tw-sprite-functions__graph');
    assert.equal(flow(first).dataset.direction, 'LR');
    assert.equal(flow(second).dataset.direction, 'LR');
    await act(async () => {toolbar(first).querySelector<HTMLButtonElement>('.tw-sprite-functions__flow-toggle button[data-direction="TD"]').click();});
    assert.equal(flow(first).dataset.direction, 'TD');
    assert.equal(graph(first).getAttribute('data-direction'), 'TD');
    assert.equal(flow(second).dataset.direction, 'LR');
    assert.equal(graph(second).getAttribute('data-direction'), 'LR');

    const filter = (id, label) => toolbar(id).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    await act(async () => {filter(first, 'Messages').click();});
    assert.equal(filter(first, 'Messages').getAttribute('aria-pressed'), 'false');
    assert.equal(filter(second, 'Messages').getAttribute('aria-pressed'), 'true');

    const node = id => graph(id).querySelector<HTMLButtonElement>('.tw-sprite-functions__node[data-function-key="f"]');
    const position = id => {
        const style = node(id).parentElement.style;
        return {x: Number.parseFloat(style.left), y: Number.parseFloat(style.top)};
    };
    const before = position(first);
    const other = position(second);
    const pointer = (type, x, y) => new dom.window.MouseEvent(type, {
        button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true
    });
    await act(async () => {node(first).dispatchEvent(pointer('pointerdown', 10, 10));});
    await act(async () => {dom.window.dispatchEvent(pointer('pointermove', 60, 45));});
    await act(async () => {dom.window.dispatchEvent(pointer('pointerup', 60, 45));});
    const moved = position(first);
    assert.notDeepEqual(moved, before);
    assert.deepEqual(position(second), other, 'moving a node leaves the other split unchanged');

    await act(async () => {controller.setViewSection(first, 0);});
    assert.equal(toolbar(first).querySelector('button'), null, 'code has no relationship section controls');
    await act(async () => {controller.setViewSection(first, calls);});
    assert.deepEqual(position(first), moved, 'manual positions survive the graph being remounted');
    assert.deepEqual(position(second), other);
    assert.equal(flow(first).dataset.direction, 'TD');
    assert.equal(filter(first, 'Messages').getAttribute('aria-pressed'), 'false');
    assert.equal(flow(second).dataset.direction, 'LR');
    assert.equal(filter(second, 'Messages').getAttribute('aria-pressed'), 'true');
});
