// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import StageControlsView from '../dist/stage-controls-view.js';
import {createStageControlsService} from '../dist/stage-controls.js';

const mountView = (t: import('node:test').TestContext) => {
    const dom = new JSDOM('<section id="host"></section>');
    const document = dom.window.document;
    const host = document.querySelector<HTMLElement>('#host')!;
    const globals = {window: dom.window, document, IS_REACT_ACT_ENVIRONMENT: true};
    Object.assign(globalThis, globals);
    const root = createRoot(host);
    t.after(() => {
        React.act(() => root.unmount());
        dom.window.close();
        for (const key of Object.keys(globals)) Reflect.deleteProperty(globalThis, key);
    });
    const service = createStageControlsService();
    const render = (options: {isSmall?: boolean; menuLocale?: string; children?: React.ReactNode} = {}) => React.act(() => {
        root.render(React.createElement(StageControlsView, {service, ...options}));
    });
    return {document, host, service, render};
};

test('standalone extension control renders its visibility, focus, label and compact icon', t => {
    const {document, host, service, render} = mountView(t);
    const calls: string[] = [];
    const control = service.api.addButton({
        id: 'details', label: 'Show details', text: 'Details', icon: '+', onClick: () => calls.push('details')
    });
    const button = () => host.querySelector<HTMLButtonElement>('[data-extension-stage-control="details"]');
    render();
    assert.equal(button(), null);
    React.act(() => control.update({visible: true}));
    assert.equal(button()?.getAttribute('aria-expanded'), 'false');
    assert.equal(button()?.textContent?.trim(), '+Details');
    React.act(() => {
        button()!.click();
        control.focus();
        control.update({label: 'Hide details', expanded: true});
    });
    assert.deepEqual(calls, ['details']);
    assert.equal(document.activeElement, button());
    assert.equal(button()?.getAttribute('aria-label'), 'Hide details');
    assert.equal(button()?.getAttribute('aria-expanded'), 'true');
    render({isSmall: true});
    assert.equal(button()?.textContent, '+');
    assert.equal(button()?.title, 'Hide details');
    React.act(() => control.update({visible: false}));
    assert.equal(button(), null);
});

test('menu places host controls after debugger and recorder, before the extension tray', t => {
    const {document, host, service, render} = mountView(t);
    const debuggerElement = document.createElement('div');
    debuggerElement.innerHTML = '<button data-tw-stage-button>Debug</button>';
    service.setDebuggerButton(debuggerElement);
    const recorderElement = document.createElement('span'); recorderElement.textContent = 'Record';
    service.setRecordButton(recorderElement, 'Record');
    service.api.addButton({id: 'details', label: 'Details', text: 'Details', icon: '+', onClick() {}}).update({visible: true});
    const pair = React.createElement('button', {'data-pair-control': true}, 'Pair');
    render({menuLocale: 'ja', children: pair});
    assert.deepEqual([...host.querySelectorAll('button')].map(element => element.textContent), ['Debug', '🎥', 'Pair', '+']);
    render({children: pair});
    assert.equal(host.querySelector('[data-pair-control]'), null);
    React.act(() => {service.setDebuggerButton(null); service.setRecordButton(null);});
    render({menuLocale: 'ja', children: pair});
    assert.ok(host.querySelector('[data-pair-control]'));
});

test('standalone recorder mirrors a detached add-on element and forwards activation', async t => {
    const {document, host, service, render} = mountView(t);
    const element = document.createElement('span');
    element.textContent = '開始';
    let activations = 0;
    element.addEventListener('click', () => activations++);
    service.setRecordButton(element, '開始');
    render({menuLocale: 'ja'});
    const button = () => host.querySelector<HTMLButtonElement>('[data-addon-stage-control="mediarecorder"]');
    assert.equal(button()?.textContent, '🎥');
    assert.equal(button()?.getAttribute('aria-label'), '開始');
    assert.equal(button()?.getAttribute('aria-pressed'), 'false');
    assert.equal(host.querySelector('[role="group"]'), null);
    assert.equal(element.isConnected, false);
    React.act(() => button()!.click());
    assert.equal(activations, 1);
    await React.act(async () => { element.textContent = '停止'; });
    assert.equal(button()?.textContent, '🎥停止');
    assert.equal(button()?.getAttribute('aria-label'), '停止');
    assert.equal(button()?.getAttribute('aria-pressed'), 'true');
    React.act(() => service.setRecordButton(null));
    assert.equal(button(), null);
});
