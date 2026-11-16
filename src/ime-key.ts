/**
 * Keys pressed while a Japanese, Chinese or Korean IME is on.
 *
 * The stage hands `event.key` to the VM. With an IME on, the browser reports a key that the IME
 * takes as `Process` (keyCode 229), and in kana input mode some browsers report the kana it would
 * type (`ち` for A). The VM drops `Process` and matches `ち` against no key, so "when [a] key
 * pressed" and "key [space] pressed?" stay silent until the user turns the IME off. `event.code`
 * still names the physical key, so the key the VM expects can be recovered from it.
 */

export type ScratchKey = {key: string; keyCode: number};

/** A key the IME took, or a kana, ideographic or full-width character the IME would type. */
const imeKey = /^[　-ヿ！-ﾟ]$/;

const namedKeys: Readonly<Record<string, ScratchKey>> = {
    Space: {key: ' ', keyCode: 32},
    Enter: {key: 'Enter', keyCode: 13},
    NumpadEnter: {key: 'Enter', keyCode: 13},
    Backspace: {key: 'Backspace', keyCode: 8},
    Escape: {key: 'Escape', keyCode: 27},
    ArrowLeft: {key: 'ArrowLeft', keyCode: 37},
    ArrowUp: {key: 'ArrowUp', keyCode: 38},
    ArrowRight: {key: 'ArrowRight', keyCode: 39},
    ArrowDown: {key: 'ArrowDown', keyCode: 40}
};

/**
 * The key and keyCode of a physical key, for the keys Scratch has a name for.
 * @param {string} code The event's `code`.
 * @param {boolean} shiftKey Whether Shift was held, which makes a letter upper case.
 * @returns {ScratchKey | null} The key, or null for a key Scratch has no name for.
 */
export const keyFromCode = (code: string, shiftKey = false): ScratchKey | null => {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return {key: shiftKey ? letter[1] : letter[1].toLowerCase(), keyCode: letter[1].charCodeAt(0)};
    const digit = /^(Digit|Numpad)([0-9])$/.exec(code);
    if (digit) return {key: digit[2], keyCode: (digit[1] === 'Digit' ? 48 : 96) + Number(digit[2])};
    return namedKeys[code] ?? null;
};

/**
 * The key an event would have reported with the IME off, when the IME changed it.
 * @param {KeyboardEvent} event The key event.
 * @returns {ScratchKey | null} The recovered key, or null when the event needs no change.
 */
export const imeScratchKey = (event: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'shiftKey'>): ScratchKey | null => {
    const {key, code, keyCode, shiftKey} = event;
    if (key !== 'Process' && keyCode !== 229 && !imeKey.test(key ?? '')) return null;
    return code ? keyFromCode(code, shiftKey) : null;
};

/**
 * Correct key events that reach the document itself, before the stage's own listeners read them.
 * Events aimed at a text field or a block's field editor are left alone, so typing with the IME
 * still works there.
 * @param {Document} document The document whose stage takes key input.
 * @returns {() => void} A function that removes the correction.
 */
export function installImeKeyInput (document: Document) {
    const window = document.defaultView;
    if (!window) return () => {};
    const correct = (event: Event) => {
        if (event.target !== document && event.target !== document.body) return;
        const recovered = imeScratchKey(event as KeyboardEvent);
        if (!recovered) return;
        Object.defineProperty(event, 'key', {value: recovered.key, configurable: true});
        Object.defineProperty(event, 'keyCode', {value: recovered.keyCode, configurable: true});
        Object.defineProperty(event, 'which', {value: recovered.keyCode, configurable: true});
    };
    window.addEventListener('keydown', correct, true);
    window.addEventListener('keyup', correct, true);
    return () => {
        window.removeEventListener('keydown', correct, true);
        window.removeEventListener('keyup', correct, true);
    };
}
