/**
 * Keeps the screen of a project inside its SB3, so the project opens the way it was when it was saved: the drawer
 * view, the tabs with the files and panes they showed, and whatever else a part of the editor registers.
 *
 * The state is a ZIP entry next to `project.json`. Scratch and TurboWarp ignore entries they do not know, so the
 * file stays compatible, and saving it in another editor only drops the entry. Each part of the editor registers a
 * slice under its own key; this module only carries the slices and hands each one back after a project loads.
 */

/** The ZIP entry that holds the screen state. */
export const screenStateEntry = 'tw-plus/workspace.json';
/** The largest screen state that is read or written, in bytes. */
export const screenStateMaxBytes = 512 * 1024;

export interface SavedScreenState {
    version: 1;
    /** When the project was saved, in milliseconds since the epoch. */
    savedAt: number;
    slices: Record<string, unknown>;
}

export interface ScreenStateSlice {
    /** The value written for this slice, or nothing to leave it out. Called synchronously while saving. */
    capture(): unknown;
    /**
     * Called once for each loaded project that carries this slice, after the VM finished loading it, or when the
     * slice is registered after that. The value comes from a file, so check its shape before using it.
     */
    apply?(value: unknown, savedAt: number): void;
}

interface ZipEntry {
    async(type: 'string'): Promise<string>;
    _data?: {uncompressedSize?: number};
}
interface ReadableZip {
    file(name: string): ZipEntry | null;
}
interface WritableZip {
    file(name: string, data: string, options?: {createFolders?: boolean}): unknown;
    remove(name: string): unknown;
}
/** The JSZip constructor the host already bundles, such as `@turbowarp/jszip`. */
export interface ScreenStateZip {
    loadAsync(bytes: ArrayBuffer | Uint8Array): Promise<ReadableZip>;
}

export interface ScreenStateVM {
    loadProject(input: unknown, ...args: unknown[]): Promise<unknown>;
    _saveProjectZip(...args: unknown[]): WritableZip;
    saveProjectSb3DontZip?(...args: unknown[]): Record<string, Uint8Array>;
}

export interface ProjectScreenStateOptions {
    Zip: ScreenStateZip;
    /** Whether saving writes the screen state. Reading stays on, so files saved earlier still open as they were. */
    save?: boolean;
    now?(): number;
}

export interface ProjectScreenState {
    /** Add a slice. Returns a function that removes it. */
    register(key: string, slice: ScreenStateSlice): () => void;
    /** The state read from the project loaded last, once that load finished. */
    whenLoaded(): Promise<SavedScreenState | undefined>;
    /** The state a save would write now. */
    capture(): SavedScreenState | undefined;
    /**
     * The text a save writes, as in the ZIP entry, for a project saved somewhere else such as a project folder.
     * Nothing while saving is turned off, nothing is registered or the state is too large.
     */
    serialize(): string | undefined;
    /**
     * Use the state in `text` for the next project load instead of reading the input, for a project that is not
     * loaded from an SB3, such as a project folder. Text that is not a screen state opens the default screen.
     */
    prepareLoad(text: string | undefined): void;
    /** Put the VM methods back. Hooks installed later on the same methods must be removed first. */
    dispose(): void;
}

const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[a-z][a-zA-Z0-9-]{0,63}$/.test(key);

/** Read the screen state from the text of the ZIP entry, or nothing if it is not one. */
export function parseScreenState(text: string): SavedScreenState | undefined {
    if (text.length > screenStateMaxBytes) return;
    let input: unknown;
    try { input = JSON.parse(text); } catch { return; }
    if (!record(input) || input.version !== 1 || !record(input.slices)) return;
    const savedAt = input.savedAt;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt < 0) return;
    // A plain object is safe: a valid key never starts with an underscore, so `__proto__` is never assigned.
    const slices: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.slices)) if (validKey(key) && value !== undefined) slices[key] = value;
    return {version: 1, savedAt, slices};
}

const bytesOf = (input: unknown): ArrayBuffer | Uint8Array | undefined => {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
};

/** Read the screen state from a project as the VM receives it. A project without one, or not a ZIP, has none. */
export async function readScreenState(input: unknown, Zip: ScreenStateZip): Promise<SavedScreenState | undefined> {
    const bytes = bytesOf(input);
    if (!bytes || bytes.byteLength < 4) return;
    const head = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes instanceof ArrayBuffer ? 0 :
        bytes.byteOffset, 2);
    if (head[0] !== 0x50 || head[1] !== 0x4b) return;
    try {
        const entry = (await Zip.loadAsync(bytes)).file(screenStateEntry);
        if (!entry) return;
        // The size from the central directory, so a crafted entry is never inflated to find out.
        const size = entry._data?.uncompressedSize;
        if (typeof size === 'number' && size > screenStateMaxBytes) return;
        return parseScreenState(await entry.async('string'));
    } catch {
        // The VM reports a broken file itself; the project only opens with its default screen.
    }
}

/**
 * Wrap the VM's load and save methods. Install it after the extension loader's bridge, so this entry is written
 * last and an entry carried over from the loaded file never stays.
 */
export function installProjectScreenState(vm: ScreenStateVM, {Zip, save = true, now = Date.now}: ProjectScreenStateOptions):
    ProjectScreenState {
    const slices = new Map<string, ScreenStateSlice>();
    const original = {
        loadProject: vm.loadProject,
        _saveProjectZip: vm._saveProjectZip,
        saveProjectSb3DontZip: vm.saveProjectSb3DontZip
    };
    let generation = 0;
    let loaded: Promise<SavedScreenState | undefined> = Promise.resolve(undefined);
    let current: SavedScreenState | undefined;
    /** Slices already given the current project's state, so registering again does not apply it twice. */
    let applied = new Set<ScreenStateSlice>();
    /** The state the next load uses instead of its input, set by `prepareLoad`. */
    let prepared: {state: SavedScreenState | undefined} | undefined;

    const apply = (slice: ScreenStateSlice, key: string) => {
        if (!current || applied.has(slice) || !Object.hasOwn(current.slices, key)) return;
        applied.add(slice);
        try {
            slice.apply?.(current.slices[key], current.savedAt);
        } catch { /* One slice that cannot use its value leaves the others. */ }
    };

    function capture(): SavedScreenState | undefined {
        const captured: Record<string, unknown> = {};
        for (const [key, slice] of slices) {
            try {
                const value = slice.capture();
                if (value !== undefined) captured[key] = value;
            } catch { /* A slice that cannot be described is left out. */ }
        }
        if (!Object.keys(captured).length) return;
        return {version: 1, savedAt: now(), slices: captured};
    }

    const serialized = () => {
        const state = save ? capture() : undefined;
        if (!state) return;
        const text = JSON.stringify(state);
        return encoder.encode(text).length > screenStateMaxBytes ? undefined : text;
    };

    vm.loadProject = function(input, ...args) {
        const mine = ++generation;
        current = undefined;
        applied = new Set();
        // Read in parallel with the VM, which keeps its own copy of the bytes.
        const reading = prepared ? Promise.resolve(prepared.state) : readScreenState(input, Zip);
        prepared = undefined;
        const result = original.loadProject.call(this, input, ...args);
        const done = result.then(() => reading, () => undefined).then(state => {
            if (mine !== generation) return;
            current = state;
            for (const [key, slice] of slices) apply(slice, key);
            return state;
        });
        loaded = done;
        return result;
    };
    vm._saveProjectZip = function(...args) {
        const zip = original._saveProjectZip.apply(this, args);
        const text = serialized();
        if (text === undefined) zip.remove(screenStateEntry);
        else zip.file(screenStateEntry, text, {createFolders: false});
        return zip;
    };
    if (original.saveProjectSb3DontZip) {
        vm.saveProjectSb3DontZip = function(...args) {
            const files = {...original.saveProjectSb3DontZip!.apply(this, args)};
            delete files[screenStateEntry];
            const text = serialized();
            if (text !== undefined) files[screenStateEntry] = encoder.encode(text);
            return files;
        };
    }

    return {
        register(key, slice) {
            if (!validKey(key)) throw new TypeError(`Invalid screen state key: ${key}`);
            if (slices.has(key)) throw new Error(`The screen state key is already registered: ${key}`);
            slices.set(key, slice);
            apply(slice, key);
            return () => {
                if (slices.get(key) === slice) slices.delete(key);
            };
        },
        whenLoaded: () => loaded,
        capture,
        serialize: serialized,
        prepareLoad(text) {
            prepared = {state: text === undefined ? undefined : parseScreenState(text)};
        },
        dispose() {
            vm.loadProject = original.loadProject;
            vm._saveProjectZip = original._saveProjectZip;
            if (original.saveProjectSb3DontZip) vm.saveProjectSb3DontZip = original.saveProjectSb3DontZip;
        }
    };
}
