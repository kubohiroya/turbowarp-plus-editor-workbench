// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {test, type TestContext} from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {chromium, expect, webkit} from '@playwright/test';

const projectId = 'existing-project-1';
const entry = `
import {installProjectOpenTabs, bindProjectOpenTabActions, openProjectInNewTab} from '/project-open-tabs.js';
const events = new EventTarget();
const vm = {runtime: {
    on(name, listener) {events.addEventListener(name, listener);},
    off(name, listener) {events.removeEventListener(name, listener);}
}, loadProject() {throw new Error('The transfer must not load an SB3 file');}};
const finish = text => {
    document.querySelector('#project').textContent = text;
    events.dispatchEvent(new Event('PROJECT_LOADED'));
};
const original = BroadcastChannel.prototype.postMessage;
window.requests = [];
BroadcastChannel.prototype.postMessage = function (message) {
    if (message?.type === 'open') window.requests.push(Object.keys(message.request).sort());
    return original.call(this, message);
};
window.browserCalls = []; window.folderCalls = [];
installProjectOpenTabs(vm, {document, locale: () => 'en', ready: () => true,
    subscribe: () => () => {}, isCancelled: () => false});
bindProjectOpenTabActions(vm, {
    storage: {}, commands: {},
    async openBrowserProject(id) {
        window.browserCalls.push(id);
        const root = await navigator.storage.getDirectory();
        let project;
        try {project = await root.getDirectoryHandle(id);}
        catch (error) {
            if (error.name === 'NotFoundError') return id === 'missing-false' ? false : null;
            throw error;
        }
        const file = await (await project.getFileHandle('content.txt')).getFile();
        finish(await file.text());
    },
    async openDirectory(directory, root) {
        window.folderCalls.push([directory.name, root.name]);
        finish('native folder selected');
    }
});
document.querySelector('#open').onclick = () => {
    window.accepted = openProjectInNewTab(vm, window.selection);
};
document.documentElement.dataset.ready = 'true';
`;

async function browserFixture(t: TestContext) {
    const modules = new Set(['/project-open-tabs.js', '/project-notice.js', '/project-load-failure.js']);
    const server = createServer(async (req, res) => {
        try {
            const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
            if (pathname === '/editor.html') {
                res.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>Handoff fixture</title>' +
                    '<button id="open">Open selected project</button><p id="project">original project</p>' +
                    '<script type="module" src="/fixture.js"></script>');
            } else if (pathname === '/fixture.js') {
                res.writeHead(200, {'Content-Type': 'text/javascript'}).end(entry);
            } else if (modules.has(pathname)) {
                const body = await readFile(new URL('../dist' + pathname, import.meta.url));
                res.writeHead(200, {'Content-Type': 'text/javascript'}).end(body);
            } else res.writeHead(404).end();
        } catch {res.writeHead(404).end();}
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();}));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = 'http://127.0.0.1:' + address.port + '/editor.html';
    const profile = await mkdtemp(path.join(os.tmpdir(), 'twpe-tab-handoff-'));
    const engine = process.env.WORKBENCH_TEST_BROWSER === 'webkit' ? webkit : chromium;
    const context = await engine.launchPersistentContext(profile, {
        headless: true, executablePath: process.env.WORKBENCH_TEST_BROWSER_EXECUTABLE
    }).catch(async error => {
        await rm(profile, {recursive: true, force: true});
        throw error;
    });
    t.after(async () => {
        await context.close();
        await rm(profile, {recursive: true, force: true});
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    return {context, page, url};
}

test('a browser project crosses a real tab boundary only by ID and reopens local storage in the child', async t => {
    const {context, page} = await browserFixture(t);
    await page.evaluate(async id => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(id, {create: true});
        const writable = await (await directory.getFileHandle('content.txt', {create: true})).createWritable();
        await writable.write('existing OPFS project');
        await writable.close();
        // Even an untyped caller supplying old properties cannot add handles to the wire message.
        (window as any).selection = {kind: 'browser-project', id, directory, root};
    }, projectId);
    const opened = context.waitForEvent('page');
    await page.getByRole('button', {name: 'Open selected project'}).click();
    const child = await opened;
    await expect(child.locator('#project')).toHaveText('existing OPFS project');
    assert.deepEqual(await page.evaluate(() => (window as any).requests), [['id', 'kind']]);
    assert.deepEqual(await child.evaluate(() => (window as any).browserCalls), [projectId]);
    assert.deepEqual(await child.evaluate(() => (window as any).folderCalls), []);
    assert.equal(await child.evaluate(() => window.opener), null);
    assert.equal(new URL(child.url()).searchParams.has('twPlusOpenTab'), false);
    await expect(page.locator('#project')).toHaveText('original project');
});

test('invalid browser IDs are handled without a popup, and malformed received requests never fall back', async t => {
    const {context, page, url} = await browserFixture(t);
    await page.evaluate(() => {(window as any).selection = {kind: 'browser-project', id: '../other'};});
    await page.getByRole('button', {name: 'Open selected project'}).click();
    await expect(page.getByTestId('project-notice-snackbar')).toContainText('Invalid browser project ID');
    assert.equal(await page.evaluate(() => (window as any).accepted), true, 'consume invalid requests rather than falling back');
    assert.equal(context.pages().length, 1);
    for (const invalid of [{kind: 'browser-project'}, {kind: 'browser-project', id: 'alpha\n'}, {kind: 'browser-project', id: 5}]) {
        const token = await page.evaluate(request => {
            const nonce = crypto.randomUUID();
            const channel = new BroadcastChannel('tw-plus-project-open-' + nonce);
            channel.onmessage = event => {
                if (event.data.type === 'ready') channel.postMessage({type: 'open', request});
                if (event.data.type === 'received') channel.close();
            };
            return nonce;
        }, invalid);
        const child = await context.newPage();
        await child.goto(url + '?twPlusOpenTab=' + token);
        await expect(child.getByTestId('project-load-failure')).toHaveAttribute('data-outcome', 'failed');
        assert.deepEqual(await child.evaluate(() => [(window as any).browserCalls, (window as any).folderCalls]), [[], []]);
        await child.close();
    }
    await expect(page.locator('#project')).toHaveText('original project');
});

for (const id of ['missing-null', 'missing-false']) {
    test(`a callback returning ${id.slice(8)} reports failure without opening or creating a folder`, async t => {
        const {context, page} = await browserFixture(t);
        await page.evaluate(id => {(window as any).selection = {kind: 'browser-project', id};}, id);
        const opened = context.waitForEvent('page');
        await page.getByRole('button', {name: 'Open selected project'}).click();
        const child = await opened;
        await expect(child.getByTestId('project-load-failure')).toHaveAttribute('data-outcome', 'failed');
        assert.deepEqual(await child.evaluate(() => (window as any).browserCalls), [id]);
        assert.deepEqual(await child.evaluate(() => (window as any).folderCalls), []);
        assert.equal(await child.evaluate(async id => {
            const root = await navigator.storage.getDirectory();
            for await (const name of (root as any).keys()) if (name === id) return true;
            return false;
        }, id), false);
        await expect(page.locator('#project')).toHaveText('original project');
    });
}

test('a native-folder request still uses the existing handle transport', async t => {
    const {context, page} = await browserFixture(t);
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle('legacy-folder', {create: true});
        (window as any).selection = {kind: 'folder', directory, root};
    });
    const opened = context.waitForEvent('page');
    await page.getByRole('button', {name: 'Open selected project'}).click();
    const child = await opened;
    await expect(child.locator('#project')).toHaveText('native folder selected');
    assert.deepEqual(await child.evaluate(() => (window as any).folderCalls), [['legacy-folder', '']]);
    assert.deepEqual(await child.evaluate(() => (window as any).browserCalls), []);
    await expect(page.locator('#project')).toHaveText('original project');
});
