// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/stage-controls.test.ts at 36e9c20.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import test from 'node:test';

import {createStageControlsService} from '@kubohiroya/turbowarp-plus-editor-workbench/stage-controls';
import getStageControls from '@kubohiroya/turbowarp-plus-editor-workbench/stage-controls';

test('stage controls register hidden, update, focus, and dispose without retaining callbacks', () => {
    const service = createStageControlsService();
    let changes = 0;
    let clicks = 0;
    let focuses = 0;
    const unsubscribe = service.subscribe(() => changes++);
    const handle = service.api.addButton({id: 'reload', label: '設定', onClick: () => clicks++});
    assert.equal(service.snapshot()[0].visible, false);
    handle.update({visible: true, text: '監視中', expanded: true});
    const button = service.snapshot()[0];
    assert.equal(button.text, '監視中');
    assert.equal(button.expanded, true);
    button.onClick();
    button.ref({focus: () => focuses++} as unknown as HTMLButtonElement);
    handle.focus();
    assert.equal(clicks, 1);
    assert.equal(focuses, 1);
    handle.update({visible: false});
    handle.focus();
    assert.equal(focuses, 1);
    handle.dispose();
    assert.deepEqual(service.snapshot(), []);
    unsubscribe();
    assert.equal(changes, 4);
});

test('replaced registrations survive stale updates and disposal, and project clearing removes controls', () => {
    const service = createStageControlsService();
    const old = service.api.addButton({id: 'reload', label: '古い設定', onClick () {}});
    const next = service.api.addButton({id: 'reload', label: '設定', onClick () {}});
    old.update({label: 'stale', visible: true});
    old.dispose();
    assert.equal(service.snapshot()[0].label, '設定');
    next.update({visible: true});
    service.clear();
    next.update({visible: true});
    assert.deepEqual(service.snapshot(), []);
    assert.throws(() => service.api.addButton({id: '', label: '設定', onClick () {}}), TypeError);
});

// The controls bar and Scratch.gui must get the same service for one VM, or a control registered
// through the API would never appear in the bar.
test('one service per VM, cleared when that VM loads another project', () => {
    const handlers: Record<string, () => void> = {};
    const vm = {on: (name: string, handler: () => void) => {
        handlers[name] = handler;
    }};
    const other = {on: () => {}};
    const service = getStageControls(vm);
    assert.equal(getStageControls(vm), service, 'the same VM gets the same service');
    assert.notEqual(getStageControls(other), service, 'another VM gets its own');
    service.api.addButton({id: 'reload', label: '設定', onClick () {}});
    assert.equal(service.snapshot().length, 1);
    handlers.PROJECT_LOADED!();
    assert.deepEqual(service.snapshot(), [], 'loading a project clears what extensions registered');
});
