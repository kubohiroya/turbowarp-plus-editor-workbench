import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {imeScratchKey, installImeKeyInput, keyFromCode} from '../src/ime-key.ts';
import {attachStageInput} from '../src/stage-input.ts';

test('keyFromCode names the keys Scratch has a name for', () => {
    assert.deepEqual(keyFromCode('KeyA'), {key: 'a', keyCode: 65});
    assert.deepEqual(keyFromCode('KeyA', true), {key: 'A', keyCode: 65});
    assert.deepEqual(keyFromCode('Digit7'), {key: '7', keyCode: 55});
    assert.deepEqual(keyFromCode('Numpad7'), {key: '7', keyCode: 103});
    assert.deepEqual(keyFromCode('Space'), {key: ' ', keyCode: 32});
    assert.deepEqual(keyFromCode('ArrowUp'), {key: 'ArrowUp', keyCode: 38});
    assert.deepEqual(keyFromCode('NumpadEnter'), {key: 'Enter', keyCode: 13});
    assert.equal(keyFromCode('IntlYen'), null);
});

test('imeScratchKey recovers keys the IME took and leaves other keys alone', () => {
    const event = (key: string, code: string, keyCode: number) => ({key, code, keyCode, shiftKey: false});
    assert.deepEqual(imeScratchKey(event('Process', 'KeyA', 229)), {key: 'a', keyCode: 65});
    assert.deepEqual(imeScratchKey(event('Process', 'Space', 229)), {key: ' ', keyCode: 32});
    assert.deepEqual(imeScratchKey(event('ち', 'KeyA', 65)), {key: 'a', keyCode: 65});
    assert.deepEqual(imeScratchKey(event('ぬ', 'Digit1', 49)), {key: '1', keyCode: 49});
    assert.deepEqual(imeScratchKey(event('　', 'Space', 32)), {key: ' ', keyCode: 32});
    assert.deepEqual(imeScratchKey(event('ａ', 'KeyA', 65)), {key: 'a', keyCode: 65});
    assert.equal(imeScratchKey(event('a', 'KeyA', 65)), null);
    // An AZERTY layout reports its own letters; the key printed on the cap wins.
    assert.equal(imeScratchKey(event('q', 'KeyA', 81)), null);
    assert.equal(imeScratchKey(event('é', 'Digit2', 50)), null);
    assert.equal(imeScratchKey(event('Process', '', 229)), null);
    assert.equal(imeScratchKey(event('Process', 'IntlYen', 229)), null);
});

test('installImeKeyInput corrects key events on the document before its listeners read them', () => {
    const {window} = new JSDOM('<input>');
    const {document} = window;
    const seen: [string, string, number][] = [];
    document.addEventListener('keydown', event => seen.push(['down', event.key, event.keyCode]));
    document.addEventListener('keyup', event => seen.push(['up', event.key, event.keyCode]));
    const remove = installImeKeyInput(document);
    const send = (target: EventTarget, type: string, key: string, code: string, keyCode: number) =>
        target.dispatchEvent(new window.KeyboardEvent(type, {key, code, keyCode, bubbles: true}));

    send(document.body, 'keydown', 'Process', 'KeyA', 229);
    send(document.body, 'keyup', 'a', 'KeyA', 65);
    send(document.body, 'keydown', 'Process', 'Space', 229);
    // Typing into a field keeps what the IME reported.
    send(document.querySelector('input')!, 'keydown', 'Process', 'KeyA', 229);
    remove();
    send(document.body, 'keydown', 'Process', 'KeyB', 229);
    assert.deepEqual(seen, [
        ['down', 'a', 65],
        ['up', 'a', 65],
        ['down', ' ', 32],
        ['down', 'Process', 229],
        ['down', 'Process', 229]
    ]);
    window.close();
});

test('external stage input recovers keys the IME took', () => {
    const {window} = new JSDOM('<canvas></canvas>');
    const {document} = window;
    const canvas = document.querySelector('canvas')!;
    const messages: unknown[] = [];
    const detach = attachStageInput({
        document, canvas,
        onMove: () => {},
        onUp: () => {},
        releasePointer: () => false,
        postIO: (device, data) => messages.push([device, data])
    });
    const send = (type: string, key: string, code: string, keyCode: number) =>
        canvas.dispatchEvent(new window.KeyboardEvent(type, {key, code, keyCode, bubbles: true, cancelable: true}));
    assert.equal(send('keydown', 'Process', 'Space', 229), false);
    send('keyup', ' ', 'Space', 32);
    detach();
    assert.deepEqual(messages, [
        ['keyboard', {key: ' ', keyCode: 32, isDown: true}],
        ['keyboard', {key: ' ', keyCode: 32, isDown: false}]
    ]);
    window.close();
});
