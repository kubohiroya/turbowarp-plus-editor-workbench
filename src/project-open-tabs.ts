// SPDX-License-Identifier: MPL-2.0
import {showNotice} from './project-notice.js';
import type {ProjectFileStorage} from './project-file-dialogs.js';
import {canReturnToPreviousPage, closeProjectLoadFailure, projectStartURL as startURL,
    showProjectLoadFailure} from './project-load-failure.js';

export type ProjectTabCommand = 'folder' | 'browser-folder' | 'remote' | 'catalog' | 'url';
export type ProjectTabRequest = {kind: 'file'; file: File; handle?: FileSystemFileHandle} |
    {kind: 'command'; command: ProjectTabCommand} |
    {kind: 'browser-project'; id: string} |
    {kind: 'folder'; directory: FileSystemDirectoryHandle; root?: FileSystemDirectoryHandle};
interface TabActions {
    storage: ProjectFileStorage;
    commands: Partial<Record<ProjectTabCommand, () => unknown>>;
    openDirectory?: (directory: FileSystemDirectoryHandle, root?: FileSystemDirectoryHandle) => Promise<unknown>;
    /** Reopen this existing browser project in the receiving tab's own storage. Throw or return false/null on failure. */
    openBrowserProject?: (id: string) => Promise<unknown>;
    fileOpened?(file: File): void;
}
interface TabPorts {
    document: Document;
    locale(): string;
    ready(): boolean;
    subscribe(listener: () => void): () => void;
    isCancelled(error: unknown): boolean;
    /** Present progress while the receiving tab reads and loads its selected file. */
    showLoading?(): () => void;
}
interface TabVM {
    loadProject(input: unknown): Promise<unknown>;
    runtime: {on(name: string, listener: () => void): void; off(name: string, listener: () => void): void};
}
const parameter = 'twPlusOpenTab';
const browserOpenTimeout = 60000;
interface BrowserOpenReceipt {
    settle(opened: boolean): void;
    cleanups: Set<() => void>;
}
const services = new WeakMap<object, ReturnType<typeof createService>>();
const documents = new WeakMap<Document, ReturnType<typeof createService>>();
const bindings = new WeakMap<object, Partial<TabActions>>();

function browserProjectRequest({id}: Extract<ProjectTabRequest, {kind: 'browser-project'}>) {
    // Match the browser project store's established IDs. Never include an OPFS handle in this message.
    if (typeof id !== 'string' || id.trim() !== id || !/^[a-z0-9-]{1,64}$/u.test(id)) {
        throw new Error('Invalid browser project ID');
    }
    return {kind: 'browser-project', id} as const;
}

function createService(host: object, ports: TabPorts) {
    const vm = host as TabVM;
    const view = ports.document.defaultView!;
    const token = new URL(view.location.href).searchParams.get(parameter);
    let incoming = Boolean(token);
    let actions: TabActions | undefined;
    let received = false;
    let alive = true;
    let channel: BroadcastChannel | undefined;
    let readyTimer: number | undefined;
    let prompt: HTMLDialogElement | undefined;
    let reviewRequest: ProjectTabRequest | undefined;
    const returnToReview = () => {
        if (!reviewRequest) return;
        closeProjectLoadFailure(ports.document);
        void run(reviewRequest);
    };
    const pending = new Set<() => void>();
    const browserOpens = new Set<BrowserOpenReceipt>();
    const startup = new URL(view.location.href).searchParams.has('project_url');
    const report = (error: unknown) => showNotice(ports.document,
        ports.locale().startsWith('ja') ? `別のタブで作品を開けませんでした。${String(error)}` :
            `Could not open the project in another tab. ${String(error)}`, {locale: ports.locale()});
    const cancel = () => {
        showProjectLoadFailure(ports.document, {locale: ports.locale(), cancelled: true,
            onReview: reviewRequest ? returnToReview : undefined});
        if (incoming) {
            view.close();
            return true;
        }
        if (!startup) return false;
        // A directly opened URL has no previous screen. Keep the stopped result visible and
        // let the person explicitly reopen confirmation rather than inventing history.
        if (canReturnToPreviousPage(ports.document)) view.history.back();
        return true;
    };
    const completed = () => {
        if (!incoming || !received) return;
        incoming = false;
        view.history.replaceState(view.history.state, '', startURL(view).href);
    };
    vm.runtime.on('PROJECT_LOADED', completed);

    const run = async (request: ProjectTabRequest | null | undefined) => {
        if (!actions) return;
        // Keep only the explicitly selected incoming request for reconsideration, never the
        // original tab's project. A transferred File cannot be recovered by reloading its URL.
        reviewRequest = undefined;
        try {
            if (!request) throw new Error('Missing project opening request');
            if (request.kind === 'browser-project') request = browserProjectRequest(request);
            reviewRequest = request.kind === 'command' ? undefined : request;
            if (request.kind === 'file') {
                // Only the explicitly selected incoming file crosses tabs; the original VM is untouched.
                const close = ports.showLoading?.();
                let closed = false;
                const finish = () => {
                    if (closed) return;
                    closed = true;
                    close?.();
                    pending.delete(finish);
                };
                pending.add(finish);
                try {
                    await vm.loadProject(await request.file.arrayBuffer());
                } finally {
                    finish();
                }
                const handle = /\.sb3$/i.test(request.file.name) ? request.handle ?? null : null;
                actions.storage.finish(handle, request.file.name.replace(/\.sb[23]?$/i, '').substring(0, 100), true);
                actions.fileOpened?.(request.file);
                reviewRequest = undefined;
            } else if (request.kind === 'folder') {
                if (!actions.openDirectory) throw new Error('Folder opening is unavailable');
                await actions.openDirectory(request.directory, request.root);
            } else if (request.kind === 'browser-project') {
                if (!actions.openBrowserProject) throw new Error('Browser project opening is unavailable');
                const result = await actions.openBrowserProject(request.id);
                if (result === false || result === null) throw new Error('Browser project could not be opened');
                reviewRequest = undefined;
                return true;
            } else {
                const command = actions.commands[request.command];
                if (!command) throw new Error('The requested opening command is unavailable');
                if (request.command === 'catalog' || request.command === 'remote' || request.command === 'url') {
                    await command();
                    return;
                }
                const ja = ports.locale().startsWith('ja');
                const names: Record<ProjectTabCommand, [string, string]> = {
                    url: ['SB3ファイルのURLを開く', 'Open SB3 File URL'],
                    folder: ['フォルダを選ぶ', 'Choose a folder'],
                    'browser-folder': ['ブラウザーに保存したフォルダを選ぶ', 'Choose a browser folder'],
                    remote: ['Git のリモートリポジトリを選ぶ', 'Choose a Git remote repository'],
                    catalog: ['プロジェクト一覧を開く', 'Show projects']
                };
                prompt = ports.document.createElement('dialog');
                prompt.setAttribute('data-project-tools', '');
                const text = ports.document.createElement('p');
                text.textContent = ja ? '元のタブを残して、このタブで別の作品を開きます。' :
                    'Your original tab stays open. Open another project in this tab.';
                const button = ports.document.createElement('button'); button.type = 'button';
                button.textContent = names[request.command][ja ? 0 : 1];
                button.addEventListener('click', () => {
                    prompt?.remove(); prompt = undefined;
                    try {Promise.resolve(command()).catch(report);} catch (error) {report(error);}
                });
                prompt.append(text, button); ports.document.body.append(prompt); prompt.showModal();
            }
        } catch (error) {
            if (ports.isCancelled(error)) cancel();
            else showProjectLoadFailure(ports.document, {locale: ports.locale(), cancelled: false,
                onReview: reviewRequest ? returnToReview : undefined});
            return false;
        }
    };
    const ready = () => {
        if (alive && incoming && !received && actions?.storage && ports.ready()) channel?.postMessage({type: 'ready'});
    };
    if (token) {
        channel = new view.BroadcastChannel(`tw-plus-project-open-${token}`);
        channel.onmessage = event => {
            if (!alive || received || !actions || !ports.ready() || event.data?.type !== 'open') return;
            received = true;
            const transfer = channel!;
            transfer.postMessage({type: 'received'});
            view.clearInterval(readyTimer);
            const request = event.data.request;
            if (request?.kind === 'browser-project' && event.data.awaitResult === true) {
                const finish = (opened: boolean) => {
                    if (alive && channel === transfer) {
                        transfer.postMessage({type: 'result', opened});
                        transfer.close(); channel = undefined;
                    }
                };
                void run(request).then(result => finish(result === true), () => finish(false));
            } else {
                transfer.close(); channel = undefined;
                void run(request);
            }
        };
        readyTimer = view.setInterval(ready, 500);
    }
    const unsubscribe = ports.subscribe(ready);

    const launch = (request: ProjectTabRequest, receipt?: BrowserOpenReceipt) => {
        const id = view.crypto.randomUUID();
        const url = startURL(view); url.searchParams.set(parameter, id);
        const outgoing = new view.BroadcastChannel(`tw-plus-project-open-${id}`);
        let child: Window | null;
        let timer: number | undefined;
        let sent = false;
        const cleanup = () => {
            view.clearInterval(timer);
            outgoing.close(); pending.delete(cleanup); receipt?.cleanups.delete(cleanup);
        };
        const failed = (error: unknown) => {
            cleanup(); receipt?.settle(false); report(error);
        };
        outgoing.onmessage = event => {
            if (event.data?.type === 'ready' && !sent) {
                try {
                    outgoing.postMessage(receipt ? {type: 'open', request, awaitResult: true} : {type: 'open', request});
                    sent = true;
                } catch (error) {failed(error);}
            } else if (receipt) {
                if (sent && event.data?.type === 'result' && typeof event.data.opened === 'boolean') {
                    receipt.settle(event.data.opened);
                }
            } else if (event.data?.type === 'received') cleanup();
        };
        pending.add(cleanup); receipt?.cleanups.add(cleanup);
        try {
            child = view.open(url.href, '_blank');
            if (child) child.opener = null;
        } catch (error) {failed(error); return;}
        timer = view.setInterval(() => {
            if (child?.closed) {cleanup(); receipt?.settle(false);}
        }, 1000);
        if (!child) {
            cleanup();
            const ja = ports.locale().startsWith('ja');
            const retry = ports.document.createElement('dialog');
            retry.setAttribute('data-project-tools', '');
            const text = ports.document.createElement('p');
            text.textContent = ja ? '新しいタブを開くには、下のボタンを押してください。元の作品はそのまま残ります。' :
                'Use the button below to open a new tab. Your original project stays open.';
            const dismiss = () => {retry.remove(); receipt?.cleanups.delete(dismiss);};
            const abandon = () => {dismiss(); receipt?.settle(false);};
            const button = ports.document.createElement('button'); button.type = 'button';
            button.textContent = ja ? '新しいタブで開く' : 'Open in a new tab';
            button.addEventListener('click', () => {
                dismiss();
                try {launch(request, receipt);} catch (error) {receipt?.settle(false); report(error);}
            });
            const close = ports.document.createElement('button'); close.type = 'button';
            close.textContent = ja ? 'キャンセル' : 'Cancel'; close.addEventListener('click', abandon);
            if (receipt) retry.addEventListener('cancel', event => {event.preventDefault(); abandon();});
            retry.append(text, button, close); ports.document.body.append(retry); receipt?.cleanups.add(dismiss);
            retry.showModal();
        }
    };

    const openBrowserProject = async (id: string): Promise<boolean> => {
        if (incoming || !alive) return false;
        try {
            const request = browserProjectRequest({kind: 'browser-project', id});
            return await new Promise<boolean>(resolve => {
                const receipt: BrowserOpenReceipt = {
                    cleanups: new Set(),
                    settle(opened) {
                        if (!browserOpens.delete(receipt)) return;
                        view.clearTimeout(timeout);
                        for (const clean of receipt.cleanups) clean();
                        resolve(opened);
                    }
                };
                browserOpens.add(receipt);
                const timeout = view.setTimeout(() => receipt.settle(false), browserOpenTimeout);
                try {launch(request, receipt);} catch (error) {receipt.settle(false); report(error);}
            });
        } catch (error) {report(error); return false;}
    };
    return {
        open(request: ProjectTabRequest) {
            try {
                const selected = request.kind === 'browser-project' ? browserProjectRequest(request) : request;
                if (incoming) return false;
                launch(selected);
            } catch (error) {report(error);}
            return true;
        },
        openBrowserProject,
        bind(value: Partial<TabActions>) {actions = {...actions, ...value} as TabActions; ready();},
        cancel,
        dispose() {
            alive = false; unsubscribe(); view.clearInterval(readyTimer); channel?.close(); prompt?.remove();
            reviewRequest = undefined;
            for (const receipt of browserOpens) receipt.settle(false);
            for (const close of pending) close();
            vm.runtime.off('PROJECT_LOADED', completed);
        }
    };
}

export function installProjectOpenTabs(vm: object, ports: TabPorts) {
    const service = createService(vm, ports);
    services.set(vm, service); documents.set(ports.document, service);
    if (bindings.has(vm)) service.bind(bindings.get(vm)!);
    return () => {service.dispose(); services.delete(vm); documents.delete(ports.document);};
}
export const bindProjectOpenTabActions = (vm: object, actions: Partial<TabActions>) => {
    const value = {...bindings.get(vm), ...actions}; bindings.set(vm, value); services.get(vm)?.bind(value);
};
export const openProjectInNewTab = (vm: object, request: ProjectTabRequest) => services.get(vm)?.open(request) ?? false;
/** True only after the browser project opened in the child. A failed attempt never opens a fallback. */
export const openBrowserProjectInNewTab = (vm: object, id: string): Promise<boolean> =>
    services.get(vm)?.openBrowserProject(id) ?? Promise.resolve(false);
export const cancelProjectTabOpening = (document: Document) => documents.get(document)?.cancel() ?? false;
