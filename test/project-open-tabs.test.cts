const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {JSDOM} = require('jsdom');

function environment(url) {
    const dom = new JSDOM('', {url});
    dom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
    return dom;
}
function channelClass(clone = structuredClone) {
    const groups = new Map();
    return class Channel {
        constructor(name) {this.name=name; if(!groups.has(name))groups.set(name,new Set());groups.get(name).add(this);}
        postMessage(message) {
            for(const peer of groups.get(this.name)) if(peer!==this) {
                const copy=clone(message);
                queueMicrotask(()=>peer.onmessage?.({data:copy}));
            }
        }
        close(){groups.get(this.name).delete(this);this.onmessage=null;}
    };
}

for (const outcome of ['loaded', 'cancelled', 'failed', 'unreadable']) {
    test(`incoming file loading screen stays visible through the read and VM load, then clears when ${outcome}`, async t => {
        const {installProjectOpenTabs, bindProjectOpenTabActions, openProjectInNewTab} = await import('../dist/project-open-tabs.js');
        // Preserve the controlled File's read method; the real cloning protocol has separate browser coverage.
        const Channel = channelClass(message => message);
        const source = environment('https://editor.test/editor.html?lang=ja');
        source.window.BroadcastChannel = Channel;
        const options = document => ({document, locale: () => 'ja', ready: () => true,
            subscribe: () => () => {}, isCancelled: error => error.code === 'CANCELLED'});
        const original = {runtime: new EventEmitter(), loadProject: assert.fail};
        const events = [];
        let releaseRead, releaseLoad, target, disposeTarget;
        const reading = new Promise(resolve => {releaseRead = resolve;});
        const loading = new Promise(resolve => {releaseLoad = resolve;});
        const failure = Object.assign(new Error(outcome), {code: outcome === 'cancelled' ? 'CANCELLED' : 'FAILED'});
        const dispose = installProjectOpenTabs(original, {...options(source.window.document), setLoading: assert.fail});
        source.window.open = url => {
            target = environment(url); target.window.BroadcastChannel = Channel;
            const close = target.window.close.bind(target.window);
            target.window.close = () => {};
            t.after(close);
            const incoming = {runtime: new EventEmitter(), async loadProject(bytes) {
                assert.equal(new TextDecoder().decode(bytes), 'selected bytes');
                events.push('load');
                await loading;
                if (outcome !== 'loaded') throw failure;
            }};
            disposeTarget = installProjectOpenTabs(incoming, {...options(target.window.document),
                setLoading: visible => events.push(visible)});
            bindProjectOpenTabActions(incoming, {storage: {finish() {events.push('finish');}}, commands: {}});
            return target.window;
        };
        t.after(() => {dispose(); disposeTarget?.(); source.window.close();});
        const file = new File(['selected bytes'], 'selected.sb3');
        file.arrayBuffer = async () => {
            events.push('read'); await reading;
            if (outcome === 'unreadable') throw failure;
            return new TextEncoder().encode('selected bytes').buffer;
        };
        openProjectInNewTab(original, {kind: 'file', file});
        for (let i = 0; i < 100 && !events.includes('read'); i++) await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, [true, 'read']);
        releaseRead();
        if (outcome !== 'unreadable') {
            for (let i = 0; i < 100 && !events.includes('load'); i++) await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(events, [true, 'read', 'load']);
        }
        releaseLoad();
        for (let i = 0; i < 100 && !events.includes(false); i++) await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, outcome === 'unreadable' ? [true, 'read', false] :
            [true, 'read', 'load', false, ...(outcome === 'loaded' ? ['finish'] : [])]);
        if (outcome !== 'loaded') assert.ok(target.window.document.querySelector('[data-testid="project-load-failure"]'));
    });
}

for (const name of ['new.sb3', 'legacy.sb2']) test(`${name}: only the selected incoming file crosses tabs; the original VM is never saved, stopped or loaded`, async t => {
    const {installProjectOpenTabs,bindProjectOpenTabActions,openProjectInNewTab}=await import('../dist/project-open-tabs.js');
    const Channel=channelClass();
    const original=environment('https://editor.test/editor.html?lang=ja&project_url=old#123');
    original.window.BroadcastChannel=Channel;
    const vm={runtime:new EventEmitter(),loadProject:assert.fail,saveProjectSb3DontZip:assert.fail,quit:assert.fail};
    const options=document=>({document,locale:()=> 'ja',ready:()=>true,subscribe:()=>()=>{},isCancelled:()=>false});
    const dispose=installProjectOpenTabs(vm,options(original.window.document));
    let target,disposeTarget,received,finished;
    let done;
    const completion=new Promise(resolve=>{done=resolve;});
    original.window.open=url=>{
        target=environment(url);target.window.BroadcastChannel=Channel;
        const next={runtime:new EventEmitter(),async loadProject(input){received=new TextDecoder().decode(input);next.runtime.emit('PROJECT_LOADED');}};
        disposeTarget=installProjectOpenTabs(next,options(target.window.document));
        bindProjectOpenTabActions(next,{storage:{finish(...args){finished=args;done();}},commands:{}});
        return target.window;
    };
    t.after(()=>{dispose();disposeTarget?.();original.window.close();target?.window.close();});
    const file=new File(['new project bytes'],name);
    const handle={kind:'file',name};
    assert.equal(openProjectInNewTab(vm,{kind:'file',file,handle}),true);
    await completion;
    assert.equal(received,'new project bytes');
    assert.deepEqual(finished,[name.endsWith('.sb3') ? handle : null,name.split('.')[0],true]);
    assert.equal(original.window.location.href,'https://editor.test/editor.html?lang=ja&project_url=old#123');
    assert.equal(target.window.opener,null);
    assert.equal(new URL(target.window.location.href).searchParams.has('project_url'),false);
    assert.equal(new URL(target.window.location.href).searchParams.has('twPlusOpenTab'),false);
});

test('a blocked popup offers an explicit retry or cancel and never falls back to replacing the original', async t => {
    const {installProjectOpenTabs,openProjectInNewTab}=await import('../dist/project-open-tabs.js');
    const dom=environment('https://editor.test/editor.html');dom.window.BroadcastChannel=channelClass();
    dom.window.open=()=>null;
    const vm={runtime:new EventEmitter(),loadProject:assert.fail,saveProjectSb3DontZip:assert.fail,quit:assert.fail};
    const dispose=installProjectOpenTabs(vm,{document:dom.window.document,locale:()=> 'ja',ready:()=>true,
        subscribe:()=>()=>{},isCancelled:()=>false});
    t.after(()=>{dispose();dom.window.close();});
    assert.equal(openProjectInNewTab(vm,{kind:'file',file:new File(['new'],'new.sb3')}),true);
    const buttons=[...dom.window.document.querySelectorAll('dialog button')];
    assert.deepEqual(buttons.map(button=>button.textContent),['新しいタブで開く','キャンセル']);
    buttons[1].click();
    assert.equal(dom.window.document.querySelector('dialog'),null);
    assert.equal(dom.window.location.href,'https://editor.test/editor.html');
});

test('direct startup does not invent a preceding history entry and cancellation keeps its main result', async t => {
    const {installProjectOpenTabs, cancelProjectTabOpening} = await import('../dist/project-open-tabs.js');
    const dom = environment('https://editor.test/editor.html?lang=ja&project_url=failed');
    const vm = {runtime: new EventEmitter(), loadProject: assert.fail};
    let backs = 0; dom.window.history.back = () => {backs++;};
    const dispose = installProjectOpenTabs(vm, {document: dom.window.document, locale: () => 'ja',
        ready: () => true, subscribe: () => () => {}, isCancelled: () => true});
    t.after(() => {dispose(); dom.window.close();});
    assert.equal(dom.window.history.length, 1);
    assert.equal(cancelProjectTabOpening(dom.window.document), true);
    assert.equal(backs, 0);
    const result = dom.window.document.querySelector('[data-testid="project-load-failure"]');
    assert.ok(result);
    const buttons = [...result.querySelectorAll('button')];
    assert.equal(buttons.find(button => button.textContent === '前の画面に戻る').disabled, true);
    assert.equal(buttons.find(button => button.textContent === '確認画面に戻る').disabled, false);
});

test('returning to confirmation reuses the selected incoming File after its transfer channel has closed', async t => {
    const {installProjectOpenTabs, bindProjectOpenTabActions, openProjectInNewTab} = await import('../dist/project-open-tabs.js');
    const Channel = channelClass();
    const source = environment('https://editor.test/editor.html?lang=ja');
    source.window.BroadcastChannel = Channel;
    const options = document => ({document, locale: () => 'ja', ready: () => true,
        subscribe: () => () => {}, isCancelled: error => error.code === 'CANCELLED'});
    const vm = {runtime: new EventEmitter(), loadProject: assert.fail, saveProjectSb3DontZip: assert.fail};
    const dispose = installProjectOpenTabs(vm, options(source.window.document));
    let target, disposeTarget, closeTarget;
    const received = [];
    let finished;
    source.window.open = url => {
        target = environment(url); closeTarget = target.window.close.bind(target.window);
        target.window.close = () => {}; // Some embedded browsers refuse script-initiated tab closing.
        target.window.BroadcastChannel = Channel;
        const next = {runtime: new EventEmitter(), async loadProject(bytes) {
            received.push(new TextDecoder().decode(bytes));
            if (received.length === 1) throw Object.assign(new Error('Declined'), {code: 'CANCELLED'});
            next.runtime.emit('PROJECT_LOADED');
        }};
        disposeTarget = installProjectOpenTabs(next, options(target.window.document));
        bindProjectOpenTabActions(next, {storage: {finish() {finished = true;}}, commands: {}});
        return target.window;
    };
    t.after(() => {dispose(); disposeTarget?.(); source.window.close(); closeTarget?.();});
    openProjectInNewTab(vm, {kind: 'file', file: new File(['requested project'], 'new.sb3')});
    for (let i = 0; i < 100 && !target.window.document.querySelector('[data-testid="project-load-failure"]'); i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    const outcome = target.window.document.querySelector('[data-testid="project-load-failure"]');
    assert.ok(outcome);
    [...outcome.querySelectorAll('button')].find(button => button.textContent === '確認画面に戻る').click();
    for (let i = 0; i < 100 && !finished; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, true);
    assert.deepEqual(received, ['requested project', 'requested project']);
    assert.equal(outcome.isConnected, false);
});

test('the URL command runs its input dialog only in the incoming tab', async t => {
    const {installProjectOpenTabs, bindProjectOpenTabActions, openProjectInNewTab} = await import('../dist/project-open-tabs.js');
    const Channel = channelClass();
    const source = environment('https://editor.test/editor.html?lang=ja');
    source.window.BroadcastChannel = Channel;
    const options = document => ({document, locale: () => 'ja', ready: () => true,
        subscribe: () => () => {}, isCancelled: () => false});
    const original = {runtime: new EventEmitter(), loadProject: assert.fail, quit: assert.fail};
    const stop = installProjectOpenTabs(original, options(source.window.document));
    let child, stopChild;
    let opened;
    const ready = new Promise(resolve => {opened = resolve;});
    bindProjectOpenTabActions(original, {commands: {url: assert.fail}});
    source.window.open = url => {
        child = environment(url); child.window.BroadcastChannel = Channel;
        const target = {runtime: new EventEmitter(), loadProject: assert.fail, quit: assert.fail};
        stopChild = installProjectOpenTabs(target, options(child.window.document));
        bindProjectOpenTabActions(target, {storage: {finish() {}}, commands: {url: () => {opened();}}});
        return child.window;
    };
    t.after(() => {stop(); stopChild?.(); source.window.close(); child?.window.close();});
    assert.equal(openProjectInNewTab(original, {kind: 'command', command: 'url'}), true);
    await ready;
    assert.equal(source.window.document.querySelector('dialog'), null);
    assert.equal(child.window.document.querySelector('dialog'), null);
});
