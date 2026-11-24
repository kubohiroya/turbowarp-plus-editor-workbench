import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createWorkspaceWelcome} from '../dist/workspace-welcome.js';

test('the welcome groups Editor branding above the current target action and releases its subscription', t => {
    const dom = new JSDOM('<main></main>');
    t.after(() => dom.window.close());
    const vm = Object.assign(new EventEmitter(), {editingTarget: {id: 'sprite', isStage: false}});
    let selected: string;
    const welcome = createWorkspaceWelcome(dom.window.document, {
        vm, locale: 'ja-JP', brand: {logo: '/editor-logo.svg', version: '0.4.1'},
        select: id => { selected = id; }
    });
    const group = welcome.element.firstElementChild;
    const button = group.querySelector('button');
    assert.equal(group.lastElementChild, button);
    assert.equal(group.querySelector('h1').textContent, 'TurboWarp-Plus-Editor');
    assert.equal(group.querySelector('img').getAttribute('src'), '/editor-logo.svg');
    assert.match(group.textContent, /Version 0\.4\.1/);
    assert.match(group.textContent, /© 2026 Hiroya Kubo/);
    assert.match(group.textContent, /ライセンス: GPL-3\.0-or-later \/ MPL-2\.0/);
    const website = group.querySelector<HTMLAnchorElement>('a[href="https://kubohiroya.github.io/turbowarp-plus-editor/"]');
    assert.equal(website.textContent, website.href);
    assert.equal(website.rel, 'noopener noreferrer');
    assert.equal(button.textContent, 'スプライトを開く');
    button.click();
    assert.equal(selected, 'sprite');
    vm.editingTarget = {id: 'stage', isStage: true};
    vm.emit('targetsUpdate');
    assert.equal(button.textContent, 'ステージを開く');
    button.click();
    assert.equal(selected, 'stage');
    vm.editingTarget = undefined;
    vm.emit('targetsUpdate');
    assert.ok(button.disabled);
    button.click();
    assert.equal(selected, 'stage');
    welcome.dispose();
    assert.equal(vm.listenerCount('targetsUpdate'), 0);
});

test('English labels follow the selected target and hosts can omit branding', t => {
    const dom = new JSDOM('<main></main>');
    t.after(() => dom.window.close());
    const vm = Object.assign(new EventEmitter(), {editingTarget: {id: 'stage', isStage: true}});
    const welcome = createWorkspaceWelcome(dom.window.document, {vm, locale: 'en', select() {}});
    const button = welcome.element.querySelector('button');
    assert.equal(button.textContent, 'Open stage');
    vm.editingTarget = {id: 'sprite', isStage: false};
    vm.emit('targetsUpdate');
    assert.equal(button.textContent, 'Open sprite');
    welcome.dispose();
});
