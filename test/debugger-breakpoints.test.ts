import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {attachBreakpointMenu, breakpointClass, breakpointDotClass, getBreakpoints} from '../dist/debugger-breakpoints.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const PROMISE_WAIT = 1;

// The slice of the VM the breakpoints rely on, with the interpreter's behavior they depend on:
// a block's function is looked up through getOpcodeFunction, the frame's execution context is
// created on first use and cleared when the thread moves to another block, and a frame left
// waiting for a reporter runs its block again from the start.
const createVm = () => {
    const ran: string[] = [];
    const blocks = {
        order: ['a', 'b', 'c'],
        getBlock: (id: string) => (['a', 'b', 'c'].includes(id) ? {opcode: 'run'} : undefined)
    };
    const target = {blocks};
    const primitives = {run: (args: {id: string}) => {
        ran.push(args.id);
    }};
    const listeners = new Map<string, Set<() => void>>();
    let paused = false;
    const runtime = {
        threads: [] as Thread[],
        compilerOptions: {enabled: true},
        cacheResets: 0,
        getOpcodeFunction (opcode: string) {
            return primitives[opcode];
        },
        resetAllCaches () {
            this.cacheResets++;
        },
        addonBlocks: {} as Record<string, {callback(args: object, util: {thread: Thread}): void}>,
        getAddonBlock (code: string) {
            return this.addonBlocks[code];
        },
        _pushThread (id: string, owner: typeof target) {
            const thread = new Thread(owner, id, this.compilerOptions.enabled);
            this.threads.push(thread);
            return thread;
        },
        _restartThread (thread: Thread) {
            return new Thread(thread.target, thread.topBlock, thread.isCompiled && this.compilerOptions.enabled);
        },
        on (event: string, listener: () => void) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(listener);
        },
        emit (event: string) {
            for (const listener of listeners.get(event) || []) listener();
        }
    };

    class Thread {
        status = 0;
        index = 0;
        frame = {executionContext: null as object | null, waitingReporter: false};
        blockContainer: object;
        target: {blocks: typeof blocks};
        topBlock: string;
        isCompiled: boolean;
        constructor (owner: {blocks: typeof blocks}, topBlock: string, isCompiled: boolean) {
            this.target = owner;
            this.topBlock = topBlock;
            this.isCompiled = isCompiled;
            this.blockContainer = owner.blocks;
        }
        peekStack () {
            return blocks.order[this.index];
        }
        peekStackFrame () {
            return this.frame;
        }
    }

    // One interpreter frame: run blocks until the thread waits or ends.
    const step = (thread: Thread) => {
        while (thread.index < blocks.order.length && thread.status === 0) {
            const id = thread.peekStack();
            const util = {
                thread,
                get stackFrame () {
                    if (thread.frame.executionContext === null) thread.frame.executionContext = {};
                    return thread.frame.executionContext;
                }
            };
            runtime.getOpcodeFunction('run')({id}, util);
            if (thread.frame.waitingReporter) {
                thread.frame.waitingReporter = false;
                return;
            }
            if (thread.status !== 0) return;
            thread.index++;
            thread.frame = {executionContext: null, waitingReporter: false};
        }
    };

    const vm = {runtime, editingTarget: target};
    const installPause = () => {
        runtime.addonBlocks['sa-pause'] = {callback: (_args, {thread}) => {
            paused = true;
            thread.status = PROMISE_WAIT;
        }};
    };
    const resume = (thread: Thread) => {
        paused = false;
        thread.status = 0;
    };
    return {vm, runtime, target, blocks, ran, step, installPause, resume, isPaused: () => paused};
};

test('stops before a marked block once, and runs it once on continue', () => {
    const {vm, runtime, target, ran, step, installPause, resume, isPaused} = createVm();
    installPause();
    const breakpoints = getBreakpoints(vm);
    breakpoints.set(target.blocks, 'b', true);
    const thread = runtime._pushThread('a', target);
    assert.equal(thread.isCompiled, false, 'a script in a marked sprite starts uncompiled');

    step(thread);
    assert.deepEqual(ran, ['a']);
    assert.equal(isPaused(), true);
    assert.equal(thread.peekStack(), 'b');

    resume(thread);
    step(thread);
    assert.deepEqual(ran, ['a', 'b', 'c']);
});

test('a block run again in the same frame does not stop again', () => {
    const {vm, runtime, target, step, installPause, resume} = createVm();
    installPause();
    getBreakpoints(vm).set(target.blocks, 'a', true);
    let stops = 0;
    const pause = runtime.addonBlocks['sa-pause'].callback;
    runtime.addonBlocks['sa-pause'].callback = (args, util) => {
        stops++;
        pause(args, util);
    };
    const thread = runtime._pushThread('a', target);
    step(thread);
    resume(thread);
    // The same frame comes back to the block, the way a waiting block or a loop's head does.
    thread.frame.waitingReporter = false;
    runtime.getOpcodeFunction('run')({id: 'a'}, {thread, stackFrame: thread.frame.executionContext});
    assert.equal(stops, 1);
});

test('without the debugger add-on nothing pauses and the block runs', () => {
    const {vm, runtime, target, ran, step} = createVm();
    const breakpoints = getBreakpoints(vm);
    assert.equal(breakpoints.canPause(), false);
    breakpoints.set(target.blocks, 'b', true);
    step(runtime._pushThread('a', target));
    assert.deepEqual(ran, ['a', 'b', 'c']);
});

test('sprites without marks keep compiling, and clearing the marks restores the VM', () => {
    const {vm, runtime, target} = createVm();
    const other = {blocks: {getBlock: () => undefined}};
    const original = {getOpcodeFunction: runtime.getOpcodeFunction, _pushThread: runtime._pushThread};
    const breakpoints = getBreakpoints(vm);
    breakpoints.set(target.blocks, 'b', true);
    assert.equal(runtime.cacheResets, 1);
    assert.equal(runtime._pushThread('x', other as never).isCompiled, true);
    assert.equal(runtime.compilerOptions.enabled, true);

    breakpoints.set(target.blocks, 'b', false);
    assert.equal(runtime.getOpcodeFunction, original.getOpcodeFunction);
    assert.equal(runtime._pushThread, original._pushThread);
    assert.equal(runtime.cacheResets, 2);
    assert.equal(runtime._pushThread('a', target).isCompiled, true);
});

test('a project load clears the marks', () => {
    const {vm, runtime, target} = createVm();
    const getOpcodeFunction = runtime.getOpcodeFunction;
    const breakpoints = getBreakpoints(vm);
    breakpoints.set(target.blocks, 'b', true);
    runtime.emit('RUNTIME_DISPOSED');
    assert.deepEqual(breakpoints.ids(target.blocks), []);
    assert.equal(runtime.getOpcodeFunction, getOpcodeFunction);
});

test('a command block gets a menu item, and a marked block is outlined', async () => {
    const {vm, target, installPause} = createVm();
    installPause();
    const {window} = new JSDOM('<svg><g id="b"></g><g id="c"></g></svg>');
    const svg = window.document.querySelector('svg');
    const element = (id: string) => window.document.getElementById(id);
    const makeBlock = (id: string, command = true) => ({
        id, workspace: null, previousConnection: command ? {} : null, isShadow: () => false, getSvgRoot: () => element(id)
    });
    const block = makeBlock('b');
    const hat = makeBlock('c', false);
    const shown: {text: string; callback(): void}[][] = [];
    const workspace = {
        currentGesture_: {targetBlock_: block as unknown, flyout_: null},
        getBlockById: (id: string) => ({b: block, c: hat})[id],
        getParentSvg: () => svg
    };
    block.workspace = workspace;
    hat.workspace = workspace;
    const ScratchBlocks = {
        getMainWorkspace: () => workspace,
        ContextMenu: {show: (_event: unknown, items: {text: string; callback(): void}[]) => {
            shown.push(items);
        }}
    };
    const original = ScratchBlocks.ContextMenu.show;
    const attached = attachBreakpointMenu({vm, getBlockly: async () => ScratchBlocks, getLocale: () => 'ja'});
    await settle();

    ScratchBlocks.ContextMenu.show({}, [], false);
    assert.equal(shown[0].at(-1).text, 'ブレークポイントを設定');
    shown[0].at(-1).callback();
    assert.equal(getBreakpoints(vm).has(target.blocks, 'b'), true);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(element('b').classList.contains(breakpointClass), true);
    assert.equal(element('b').querySelectorAll('.' + breakpointDotClass).length, 1);

    ScratchBlocks.ContextMenu.show({}, [], false);
    assert.equal(shown[1].at(-1).text, 'ブレークポイントを外す');

    workspace.currentGesture_.targetBlock_ = hat;
    ScratchBlocks.ContextMenu.show({}, [], false);
    assert.equal(shown[2].length, 0, 'a hat block gets no item');

    attached.dispose();
    assert.equal(ScratchBlocks.ContextMenu.show, original);
    getBreakpoints(vm).clear();
});
