import assert from 'node:assert/strict';
import test from 'node:test';
import {installProjectScreenState, parseScreenState, readScreenState, screenStateEntry, screenStateMaxBytes}
    from '../dist/project-screen-state.js';

/** Stands in for JSZip: an archive is a map of entry names to text, and its bytes start with the ZIP magic. */
const archives = new WeakMap<object, Map<string, string>>();
function sb3(entries: Record<string, string>) {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0]);
    archives.set(bytes.buffer, new Map(Object.entries(entries)));
    return bytes.buffer;
}
const Zip = {
    async loadAsync(bytes: ArrayBuffer | Uint8Array) {
        const entries = archives.get(bytes instanceof ArrayBuffer ? bytes : bytes.buffer);
        if (!entries) throw new Error('Corrupted zip');
        return {file: (name: string) => entries.has(name) ? {async: async () => entries.get(name)!} : null};
    }
};
class FakeZip {
    files = new Map<string, {text: string; options?: object}>();
    file(name: string, text: string, options?: object) { this.files.set(name, {text, options}); }
    remove(name: string) { this.files.delete(name); }
}

function fakeVM() {
    /** Finishes each load in progress, oldest first. */
    const pending: (() => void)[] = [];
    const vm = {
        finishLoad: () => pending.shift()!(),
        loadProject(_input: unknown) {
            return new Promise<void>(resolve => { pending.push(resolve); });
        },
        _saveProjectZip() {
            const zip = new FakeZip();
            zip.file('project.json', '{}');
            // An extension loader carries over entries of the loaded file it does not know.
            zip.file(screenStateEntry, 'stale');
            return zip;
        },
        saveProjectSb3DontZip(): Record<string, Uint8Array> {
            return {'project.json': new Uint8Array(), [screenStateEntry]: new Uint8Array([1])};
        }
    };
    return vm;
}

const state = (savedAt: number, slices: Record<string, unknown>) => JSON.stringify({version: 1, savedAt, slices});

test('only a screen state of the known version and shape is read', () => {
    assert.deepEqual(parseScreenState(state(5, {drawer: {view: 'project'}})),
        {version: 1, savedAt: 5, slices: {drawer: {view: 'project'}}});
    assert.equal(parseScreenState('not json'), undefined);
    assert.equal(parseScreenState(JSON.stringify({version: 2, savedAt: 5, slices: {}})), undefined);
    assert.equal(parseScreenState(JSON.stringify({version: 1, savedAt: -1, slices: {}})), undefined);
    assert.equal(parseScreenState(JSON.stringify({version: 1, savedAt: 5, slices: []})), undefined);
    assert.deepEqual(Object.keys(parseScreenState(state(5, {'__proto__x': 1, 'Bad Key': 2, good: 3}))!.slices), ['good']);
    assert.equal(parseScreenState(' '.repeat(screenStateMaxBytes + 1)), undefined, 'an oversized entry is not parsed');
});

test('a project.json, a broken file or an SB3 without the entry has no screen state', async () => {
    assert.equal(await readScreenState('{"targets": []}', Zip), undefined);
    assert.equal(await readScreenState(new Uint8Array([0x50, 0x4b, 3, 4]).buffer, Zip), undefined);
    assert.equal(await readScreenState(sb3({'project.json': '{}'}), Zip), undefined);
    const bytes = sb3({[screenStateEntry]: state(1, {})});
    assert.deepEqual(await readScreenState(new Uint8Array(bytes), Zip), {version: 1, savedAt: 1, slices: {}});
});

test('an entry larger than the limit is not inflated', async () => {
    const huge = {loadAsync: async () => ({file: () => ({_data: {uncompressedSize: screenStateMaxBytes + 1},
        async: async () => assert.fail('the entry was inflated')})})};
    assert.equal(await readScreenState(sb3({}), huge), undefined);
});

test('each slice gets its value once the VM finished loading the project', async () => {
    const vm = fakeVM();
    const screen = installProjectScreenState(vm, {Zip});
    const applied: unknown[] = [];
    screen.register('drawer', {capture: () => undefined, apply: (value, savedAt) => applied.push([value, savedAt])});
    screen.register('other', {capture: () => undefined, apply: value => applied.push(['other', value])});
    const loading = vm.loadProject(sb3({[screenStateEntry]: state(7, {drawer: {view: 'project'}})}));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(applied, [], 'nothing is applied while the VM is loading');
    vm.finishLoad();
    await loading;
    assert.deepEqual(await screen.whenLoaded(), {version: 1, savedAt: 7, slices: {drawer: {view: 'project'}}});
    assert.deepEqual(applied, [[{view: 'project'}, 7]], 'a slice the file does not carry is not called');
});

test('a slice registered after the load still gets the value, once', async () => {
    const vm = fakeVM();
    const screen = installProjectScreenState(vm, {Zip});
    const loading = vm.loadProject(sb3({[screenStateEntry]: state(3, {drawer: 'git-history'})}));
    vm.finishLoad();
    await loading;
    await screen.whenLoaded();
    const applied: unknown[] = [];
    const slice = {capture: () => undefined, apply: (value: unknown) => applied.push(value)};
    const remove = screen.register('drawer', slice);
    remove();
    screen.register('drawer', slice);
    assert.deepEqual(applied, ['git-history']);
});

test('a load that is replaced by another one never applies its state', async () => {
    const vm = fakeVM();
    const screen = installProjectScreenState(vm, {Zip});
    const applied: unknown[] = [];
    screen.register('drawer', {capture: () => undefined, apply: value => applied.push(value)});
    const first = vm.loadProject(sb3({[screenStateEntry]: state(1, {drawer: 'first'})}));
    const second = vm.loadProject(sb3({[screenStateEntry]: state(2, {drawer: 'second'})}));
    vm.finishLoad();
    vm.finishLoad();
    await Promise.all([first, second]);
    await screen.whenLoaded();
    assert.deepEqual(applied, ['second']);
});

test('saving writes every slice into the SB3 and replaces the entry carried over from the loaded file', () => {
    const vm = fakeVM();
    const screen = installProjectScreenState(vm, {Zip, now: () => 42});
    screen.register('drawer', {capture: () => ({version: 1, view: 'project'})});
    screen.register('empty', {capture: () => undefined});
    screen.register('broken', {capture: () => { throw new Error('not ready'); }});
    const zip = vm._saveProjectZip() as unknown as FakeZip;
    const written = zip.files.get(screenStateEntry)!;
    assert.deepEqual(JSON.parse(written.text), {version: 1, savedAt: 42, slices: {drawer: {version: 1, view: 'project'}}});
    assert.deepEqual(written.options, {createFolders: false}, 'no folder entry is added beside project.json');
    const files = vm.saveProjectSb3DontZip();
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files[screenStateEntry])).slices.drawer, {version: 1, view: 'project'});
});

test('with saving turned off, or nothing to save, the SB3 carries no screen state', () => {
    for (const [save, slice] of [[false, () => ({view: 'project'})], [true, () => undefined]] as const) {
        const vm = fakeVM();
        const screen = installProjectScreenState(vm, {Zip, save});
        screen.register('drawer', {capture: slice});
        assert.equal((vm._saveProjectZip() as unknown as FakeZip).files.has(screenStateEntry), false);
        assert.equal(Object.hasOwn(vm.saveProjectSb3DontZip(), screenStateEntry), false);
    }
});

test('a key is registered once, and only in the allowed spelling', () => {
    const screen = installProjectScreenState(fakeVM(), {Zip});
    screen.register('spritePanes', {capture: () => undefined});
    assert.throws(() => screen.register('spritePanes', {capture: () => undefined}), /already registered/);
    assert.throws(() => screen.register('Bad Key', {capture: () => undefined}), /Invalid/);
});

test('disposing puts the VM methods back', () => {
    const vm = fakeVM();
    const methods = [vm.loadProject, vm._saveProjectZip, vm.saveProjectSb3DontZip];
    installProjectScreenState(vm, {Zip}).dispose();
    assert.deepEqual([vm.loadProject, vm._saveProjectZip, vm.saveProjectSb3DontZip], methods);
});
