import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {attachReviewNavigation, attachWorkspaceNavigation} from '../dist/workspace-navigation.js';

const workspace = (document: Document) => {
    const frame = document.createElement('div');
    const outer = document.createElement('div');
    const container = document.createElement('div');
    frame.append(outer);
    outer.append(container);
    document.body.append(frame);
    return {frame, workspace: {getInjectionDiv: () => container}};
};

test('a review preview marks its frame and thumbnail for hovering and clears them when disposed', () => {
    const {window} = new JSDOM('<!doctype html><body></body>');
    const {frame, workspace: ws} = workspace(window.document);
    const watermark = window.document.createElement('img');
    const navigation = attachReviewNavigation(ws, {}, watermark, {horizontalZoom: false, minimap: false});
    assert.equal(frame.hasAttribute('data-code-hover-surface'), true);
    assert.equal(watermark.hasAttribute('data-code-hover-thumbnail'), true);
    navigation.dispose();
    assert.equal(frame.hasAttribute('data-code-hover-surface'), false);
    assert.equal(watermark.hasAttribute('data-code-hover-thumbnail'), false);
    // Without a thumbnail only the frame is marked.
    attachReviewNavigation(ws, {}, undefined, {horizontalZoom: false, minimap: false}).dispose();
});

test('navigation adds nothing when neither zoom nor the minimap is wanted', () => {
    const {window} = new JSDOM('<!doctype html><body></body>');
    const {frame, workspace: ws} = workspace(window.document);
    const before = frame.outerHTML;
    const navigation = attachWorkspaceNavigation(ws, {}, {horizontalZoom: false, minimap: false});
    assert.equal(frame.outerHTML, before);
    navigation.dispose();
});
