/**
 * Breakpoints marked on blocks instead of placed as blocks.
 *
 * The editor add-on's debugger stops a project when a "breakpoint" block runs. That block is part
 * of the project, so it is saved and shipped unless someone remembers to take it out. Here a block
 * is only marked in the editor: the mark lives in this session, never in the project, and the
 * project stops right before a marked block runs.
 *
 * Stopping is the add-on's own pause (its hidden `sa-pause` block), so its Threads tab, Step and
 * Continue work unchanged. Without the add-on nothing can pause, and no menu item is offered.
 *
 * The VM is not changed. Two of its methods are wrapped, and only while at least one mark exists:
 *
 * - `getOpcodeFunction`: the block functions the interpreter caches. When a thread arrives at a
 *   marked block, the first function the block runs pauses instead, and the frame waits the way it
 *   waits for a reporter. Continuing runs the block from its start. The mark is kept in the
 *   frame's execution context, which the VM clears when the thread moves to another block, so a
 *   block that waits in place or a loop that comes back to its head stops only on arrival.
 * - `_pushThread` and `_restartThread`: compiled scripts run no per-block functions, so a script
 *   that starts in a sprite with a mark is not compiled. Sprites without a mark compile as before.
 *   A script that was already running compiled keeps running until it starts again.
 */

const PROMISE_WAIT = 1;
const pauseProcedure = 'sa-pause';
const hitKey = Symbol('tw-plus-breakpoint-hit');

export const breakpointClass = 'tw-plus-breakpoint';
export const breakpointDotClass = 'tw-plus-breakpoint-dot';
const svgNamespace = 'http://www.w3.org/2000/svg';

type BlockFunction = (args: unknown, util: BlockUtilityLike) => unknown;

interface StackFrameLike {
    waitingReporter: boolean | null;
}

interface ThreadLike {
    status: number;
    isCompiled?: boolean;
    topBlock?: string;
    target?: TargetLike | null;
    blockContainer?: object;
    peekStack(): string | undefined;
    peekStackFrame(): StackFrameLike | null;
}

interface BlockUtilityLike {
    thread?: ThreadLike;
    readonly stackFrame?: Record<PropertyKey, unknown>;
}

interface BlocksLike {
    getBlock(id: string): {topLevel?: boolean; opcode?: string} | undefined;
}

interface TargetLike {
    blocks: BlocksLike;
}

interface CompilerOptions {
    enabled?: boolean;
}

interface RuntimeLike {
    threads: ThreadLike[];
    compilerOptions?: CompilerOptions;
    getOpcodeFunction(opcode: string): BlockFunction | undefined;
    getAddonBlock?(procedureCode: string): {callback(args: object, util: {thread: ThreadLike}): unknown} | undefined;
    resetAllCaches?(): void;
    _pushThread(id: string, target: TargetLike, options?: object): ThreadLike;
    _restartThread(thread: ThreadLike): ThreadLike;
    on?(event: string, listener: () => void): void;
    off?(event: string, listener: () => void): void;
}

interface VirtualMachineLike {
    runtime: RuntimeLike;
    editingTarget?: TargetLike | null;
    on?(event: string, listener: () => void): void;
    off?(event: string, listener: () => void): void;
}

export interface Breakpoints {
    /** Whether a pause is possible: the debugger add-on is on and has registered its pause. */
    canPause(): boolean;
    has(blocks: object, blockId: string): boolean;
    set(blocks: object, blockId: string, marked: boolean): void;
    toggle(blocks: object, blockId: string): boolean;
    /** The marked blocks of one block container that still exist. */
    ids(blocks: object): string[];
    /** Whether a script in this container is running compiled, so a new mark misses it until it starts again. */
    runsCompiled(blocks: object): boolean;
    clear(): void;
    subscribe(listener: () => void): () => void;
}

const breakpointsByVm = new WeakMap<object, Breakpoints>();

const ownMethod = (object: object, key: string) =>
    Object.prototype.hasOwnProperty.call(object, key) ? {value: object[key]} : null;

const restoreMethod = (object: object, key: string, saved: {value: unknown} | null) => {
    if (saved) object[key] = saved.value;
    else delete object[key];
};

/**
 * The breakpoints of one VM. Every caller gets the same instance, so the menu and the runtime
 * agree on what is marked.
 * @param {object} vm The VM.
 * @returns {object} The breakpoints.
 */
export function getBreakpoints (vm: object): Breakpoints {
    let breakpoints = breakpointsByVm.get(vm);
    if (!breakpoints) {
        breakpoints = createBreakpoints(vm as VirtualMachineLike);
        breakpointsByVm.set(vm, breakpoints);
    }
    return breakpoints;
}

function createBreakpoints (vm: VirtualMachineLike): Breakpoints {
    const runtime = vm.runtime;
    const marks = new Map<object, Set<string>>();
    const listeners = new Set<() => void>();
    const gated = new WeakMap<BlockFunction, BlockFunction>();
    let installed: null | (() => void) = null;

    const notify = () => {
        for (const listener of [...listeners]) listener();
    };

    const marked = (blocks: object | undefined, blockId: string | undefined) =>
        Boolean(blocks && blockId && marks.get(blocks)?.has(blockId));

    const pause = (thread: ThreadLike) => {
        const block = runtime.getAddonBlock?.(pauseProcedure);
        if (!block) return false;
        block.callback({}, {thread});
        return thread.status === PROMISE_WAIT;
    };

    const gate = (blockFunction: BlockFunction): BlockFunction => {
        let wrapped = gated.get(blockFunction);
        if (wrapped) return wrapped;
        wrapped = function (this: unknown, args: unknown, util: BlockUtilityLike) {
            const thread = util?.thread;
            if (thread && !thread.isCompiled && marked(thread.blockContainer, thread.peekStack())) {
                const context = util.stackFrame;
                if (context && !context[hitKey]) {
                    context[hitKey] = true;
                    if (pause(thread)) {
                        // The interpreter keeps the frame and runs the block again from its start
                        // when the thread runs again, as it does after a reporter it waited for.
                        thread.peekStackFrame().waitingReporter = true;
                        return undefined;
                    }
                }
            }
            return blockFunction.call(this, args, util);
        };
        gated.set(blockFunction, wrapped);
        return wrapped;
    };

    const withoutCompiler = <T>(blocks: object | undefined, start: () => T): T => {
        const options = runtime.compilerOptions;
        if (!options?.enabled || !blocks || !marks.get(blocks)?.size) return start();
        runtime.compilerOptions = {...options, enabled: false};
        try {
            return start();
        } finally {
            runtime.compilerOptions = options;
        }
    };

    const install = () => {
        if (installed) return;
        const saved = {
            getOpcodeFunction: ownMethod(runtime, 'getOpcodeFunction'),
            _pushThread: ownMethod(runtime, '_pushThread'),
            _restartThread: ownMethod(runtime, '_restartThread')
        };
        const getOpcodeFunction = runtime.getOpcodeFunction;
        const pushThread = runtime._pushThread;
        const restartThread = runtime._restartThread;
        runtime.getOpcodeFunction = function (opcode) {
            const blockFunction = getOpcodeFunction.call(this, opcode);
            return typeof blockFunction === 'function' ? gate(blockFunction) : blockFunction;
        };
        runtime._pushThread = function (id, target, options) {
            return withoutCompiler(target?.blocks, () => pushThread.call(this, id, target, options));
        };
        runtime._restartThread = function (thread) {
            return withoutCompiler(thread?.blockContainer, () => restartThread.call(this, thread));
        };
        // The interpreter caches each block's function. Dropping the caches makes it look them up again.
        runtime.resetAllCaches?.();
        installed = () => {
            restoreMethod(runtime, 'getOpcodeFunction', saved.getOpcodeFunction);
            restoreMethod(runtime, '_pushThread', saved._pushThread);
            restoreMethod(runtime, '_restartThread', saved._restartThread);
            runtime.resetAllCaches?.();
        };
    };

    const uninstall = () => {
        const restore = installed;
        installed = null;
        restore?.();
    };

    const update = () => {
        for (const [blocks, ids] of marks) {
            if (!ids.size) marks.delete(blocks);
        }
        if (marks.size) install();
        else uninstall();
        notify();
    };

    const clear = () => {
        if (!marks.size) return;
        marks.clear();
        update();
    };

    // A project load replaces every block container, so the marks have nothing left to point at.
    runtime.on?.('RUNTIME_DISPOSED', clear);

    const breakpoints: Breakpoints = {
        canPause: () => Boolean(runtime.getAddonBlock?.(pauseProcedure)),
        has: (blocks, blockId) => marked(blocks, blockId),
        set (blocks, blockId, on) {
            if (marked(blocks, blockId) === on) return;
            if (on) {
                let ids = marks.get(blocks);
                if (!ids) marks.set(blocks, ids = new Set());
                ids.add(blockId);
            } else {
                marks.get(blocks)?.delete(blockId);
            }
            update();
        },
        toggle (blocks, blockId) {
            const on = !marked(blocks, blockId);
            breakpoints.set(blocks, blockId, on);
            return on;
        },
        ids (blocks) {
            const ids = marks.get(blocks);
            if (!ids) return [];
            return [...ids].filter(id => (blocks as BlocksLike).getBlock?.(id));
        },
        runsCompiled: blocks => runtime.threads.some(thread => thread.isCompiled && thread.blockContainer === blocks),
        clear,
        subscribe (listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    return breakpoints;
}

interface ScratchBlocksLike {
    ContextMenu: {show(event: unknown, items: MenuItem[], rtl: boolean): void};
    getMainWorkspace?(): WorkspaceLike | null;
    mainWorkspace?: WorkspaceLike | null;
}

interface MenuItem {
    text: string;
    enabled: boolean;
    callback(): void;
    separator?: boolean;
}

interface BlockSvgLike {
    id: string;
    isShadow?(): boolean;
    previousConnection?: unknown;
    workspace?: WorkspaceLike;
    getSvgRoot?(): Element | null;
}

interface WorkspaceLike {
    isFlyout?: boolean;
    currentGesture_?: {targetBlock_?: BlockSvgLike | null; flyout_?: unknown} | null;
    getBlockById(id: string): BlockSvgLike | null;
    getParentSvg?(): Element | null;
    addChangeListener?(listener: (event: unknown) => void): unknown;
    removeChangeListener?(listener: unknown): void;
}

interface BreakpointMenuOptions {
    vm: object;
    getBlockly(): Promise<ScratchBlocksLike> | ScratchBlocksLike;
    getLocale?(): string | undefined;
}

const japanese = (locale: string | undefined) => /^ja(?:-|$)/i.test(locale || '');

export const breakpointMenuText = (locale: string | undefined, marked: boolean, runsCompiled: boolean) => {
    if (japanese(locale)) {
        if (marked) return 'ブレークポイントを外す';
        return runsCompiled ? 'ブレークポイントを設定（次に始めたときから止まる）' : 'ブレークポイントを設定';
    }
    if (marked) return 'Remove breakpoint';
    return runsCompiled ? 'Add breakpoint (stops from the next start)' : 'Add breakpoint';
};

/**
 * Offer "Add breakpoint" on the context menu of a command block in the code area, and outline the
 * marked blocks of the sprite being edited.
 * @param {object} options The VM, a way to get ScratchBlocks, and the GUI's language.
 * @returns {object} Something to dispose.
 */
export function attachBreakpointMenu (options: BreakpointMenuOptions) {
    const vm = options.vm as VirtualMachineLike;
    // Without a runtime there is nothing to pause.
    if (!vm?.runtime) return {dispose () {}};
    const breakpoints = getBreakpoints(vm);
    let disposed = false;
    let detach = () => {};

    const editingBlocks = () => vm.editingTarget?.blocks as object | undefined;

    const connect = (ScratchBlocks: ScratchBlocksLike) => {
        const workspace = () => ScratchBlocks.getMainWorkspace?.() || ScratchBlocks.mainWorkspace || null;
        const menu = ScratchBlocks.ContextMenu;
        const show = menu.show;
        let active = true;
        const patched = function (event, items, rtl) {
            const main = workspace();
            const gesture = main?.currentGesture_;
            const block = gesture && !gesture.flyout_ ? gesture.targetBlock_ : null;
            const blocks = editingBlocks();
            if (active && block && blocks && block.previousConnection && !block.isShadow?.() &&
                block.workspace === main && breakpoints.canPause()) {
                const on = breakpoints.has(blocks, block.id);
                items = [...items, {
                    text: breakpointMenuText(options.getLocale?.(), on, !on && breakpoints.runsCompiled(blocks)),
                    enabled: true,
                    separator: true,
                    callback: () => breakpoints.toggle(blocks, block.id)
                }];
            }
            return show.call(this, event, items, rtl);
        };
        menu.show = patched;

        let frame = 0;
        const refresh = () => {
            frame = 0;
            const main = workspace();
            const root = main?.getParentSvg?.();
            if (!main || !root) return;
            for (const element of root.querySelectorAll(`.${breakpointClass}`)) element.classList.remove(breakpointClass);
            for (const dot of root.querySelectorAll(`.${breakpointDotClass}`)) dot.remove();
            const blocks = editingBlocks();
            if (!blocks) return;
            for (const id of breakpoints.ids(blocks)) {
                const element = main.getBlockById(id)?.getSvgRoot?.();
                if (!element) continue;
                element.classList.add(breakpointClass);
                // A dot left of the block, like the gutter mark of a code editor. The outline alone is
                // hard to see on the orange and yellow categories.
                const dot = element.ownerDocument.createElementNS(svgNamespace, 'circle');
                dot.setAttribute('class', breakpointDotClass);
                dot.setAttribute('cx', '-9');
                dot.setAttribute('cy', '12');
                dot.setAttribute('r', '6');
                element.append(dot);
            }
        };
        const schedule = () => {
            if (frame) return;
            const view = globalThis.requestAnimationFrame ? globalThis : null;
            frame = view ? view.requestAnimationFrame(refresh) : (setTimeout(refresh, 0) as unknown as number);
        };

        const unsubscribe = breakpoints.subscribe(schedule);
        const main = workspace();
        const changeListener = main?.addChangeListener?.(schedule);
        // Switching sprites reloads the workspace, and the new block elements have no outline yet.
        vm.on?.('workspaceUpdate', schedule);
        schedule();

        detach = () => {
            // Another patch may have wrapped ours since. Then ours stays in the chain and passes everything through.
            active = false;
            if (menu.show === patched) menu.show = show;
            unsubscribe();
            if (changeListener) main?.removeChangeListener?.(changeListener);
            vm.off?.('workspaceUpdate', schedule);
            if (frame && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(frame);
        };
    };

    Promise.resolve().then(() => options.getBlockly?.()).then(ScratchBlocks => {
        if (!disposed && ScratchBlocks?.ContextMenu) connect(ScratchBlocks);
    }, () => {
        // Without ScratchBlocks there is no code area to mark blocks in.
    });

    return {
        dispose () {
            disposed = true;
            detach();
        }
    };
}
