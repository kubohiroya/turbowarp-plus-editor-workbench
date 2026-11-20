// SPDX-License-Identifier: MPL-2.0
import {dialogAction, dialogActions} from '@kubohiroya/turbowarp-plus-editor-windows';
import type {ProjectFileStorage} from './project-file-dialogs.js';
import {closeProjectLoadFailure} from './project-load-failure.js';

export interface ProjectURLPorts {
    vm: {quit(): void; loadProject(input: ArrayBuffer): Promise<unknown>; renderer?: {draw(): void}};
    storage: Pick<ProjectFileStorage, 'finish'>;
    isDirty(): boolean;
    loadedTitle?(): string | undefined;
    detachFolder?(): void;
    isCancelled?(error: unknown): boolean;
    fetch?: typeof fetch;
}

/** Accept a complete HTTP(S) file URL; local paths and embedded credentials are not file URLs. */
export function projectFileURL(value: string): URL {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid URL');
    return url;
}

export function projectURLFilename(url: URL): string {
    let name = url.pathname.split('/').pop() || 'project.sb3';
    try {name = decodeURIComponent(name);} catch { /* Keep malformed escapes as literal filename text. */ }
    name = name.replace(/[\\/\u0000-\u001f]/g, '_');
    return /\.sb3$/i.test(name) ? name : `${name}.sb3`;
}

/** Fetch before replacing anything, then use the host's installed SB3 loader and save service. */
export function openProjectURL(document: Document, locale: string, ports: ProjectURLPorts): Promise<'opened' | 'cancelled'> {
    if (!document?.body) return Promise.resolve('cancelled');
    const ja = locale.startsWith('ja');
    const label = (jp: string, en: string) => ja ? jp : en;
    const view = document.defaultView!;
    const returnFocus = document.activeElement as HTMLElement | null;
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'tw-project-file-dialog';
        dialog.setAttribute('data-project-tools', '');
        dialog.setAttribute('data-project-url-dialog', '');
        const heading = document.createElement('h2');
        heading.textContent = label('SB3ファイルのURLを開く', 'Open SB3 File URL');
        dialog.setAttribute('aria-label', heading.textContent);
        const form = document.createElement('form');
        form.noValidate = true;
        const field = document.createElement('label');
        field.textContent = label('SB3ファイルのURL', 'SB3 file URL');
        const input = document.createElement('input');
        input.type = 'url'; input.name = 'url'; input.required = true;
        input.placeholder = 'https://example.com/project.sb3';
        input.autocomplete = 'off'; input.spellcheck = false;
        field.append(input);
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const error = document.createElement('p');
        error.setAttribute('role', 'alert');
        const open = document.createElement('button');
        open.type = 'submit'; open.textContent = label('開く', 'Open');
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = label('キャンセル', 'Cancel');
        let phase: 'idle' | 'fetching' | 'loading' | 'closed' = 'idle';
        let controller: AbortController | undefined;
        const finish = (result: 'opened' | 'cancelled') => {
            if (phase === 'closed') return;
            phase = 'closed'; controller?.abort();
            if (dialog.open && typeof dialog.close === 'function') dialog.close();
            dialog.remove();
            if (returnFocus?.isConnected) returnFocus.focus();
            resolve(result);
        };
        const dismiss = () => {if (phase !== 'loading') finish('cancelled');};
        cancel.addEventListener('click', dismiss);
        dialog.addEventListener('cancel', event => {event.preventDefault(); dismiss();});
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (phase !== 'idle') return;
            error.textContent = '';
            let url: URL;
            try {url = projectFileURL(input.value);}
            catch {
                error.textContent = label('HTTPまたはHTTPSのSB3ファイルのURLを入力してください。',
                    'Enter an HTTP or HTTPS URL for an SB3 file.');
                input.setAttribute('aria-invalid', 'true'); input.focus(); return;
            }
            input.removeAttribute('aria-invalid');
            phase = 'fetching'; controller = new AbortController();
            open.disabled = input.disabled = true;
            form.setAttribute('aria-busy', 'true');
            status.textContent = label('SB3ファイルを取得しています…', 'Downloading the SB3 file…');
            try {
                const response = await (ports.fetch ?? view.fetch.bind(view))(url.href,
                    {signal: controller.signal, credentials: 'omit'});
                if (!response.ok) throw new Error(label(`ファイルを取得できませんでした（HTTP ${response.status}）。`,
                    `Could not download the file (HTTP ${response.status}).`));
                const bytes = await response.arrayBuffer();
                if (controller.signal.aborted) return;
                // The project may have been edited while its replacement was downloading.
                if (ports.isDirty() && !view.confirm(label('現在の作品に未保存の変更があります。選んだ作品を開きますか？',
                    'The current project has unsaved changes. Open the selected project?'))) return;
                phase = 'loading'; cancel.disabled = true;
                status.textContent = label('作品を読み込んでいます…', 'Loading the project…');
                // The loader's extension review is not a native modal. Release the top layer
                // so that review and the existing load-progress UI remain interactive.
                if (dialog.open && typeof dialog.close === 'function') dialog.close();
                ports.vm.quit();
                await ports.vm.loadProject(bytes);
                ports.detachFolder?.();
                ports.storage.finish(null, ports.loadedTitle?.() || projectURLFilename(url).replace(/\.sb3$/i, '').substring(0, 100), true);
                ports.vm.renderer?.draw();
                finish('opened');
            } catch (cause) {
                if (controller.signal.aborted) return;
                if (phase === 'loading') {
                    // This dialog owns retries for this URL; the loader still retains its diagnostics.
                    closeProjectLoadFailure(document);
                    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
                }
                error.textContent = ports.isCancelled?.(cause) ? label('作品を開く操作をキャンセルしました。', 'Opening the project was cancelled.') :
                    phase === 'loading' ? label('SB3ファイルを読み込めませんでした。ファイルを確認して再試行してください。',
                        'Could not load the SB3 file. Check the file and try again.') :
                        cause instanceof TypeError ? label('ファイルを取得できませんでした。URL・通信状態・配信元のアクセス許可（CORS）を確認してください。',
                            'Could not download the file. Check the URL, connection and the server’s access permissions (CORS).') :
                            cause instanceof Error ? cause.message : String(cause);
            } finally {
                if (!controller.signal.aborted) {
                    phase = 'idle'; open.disabled = input.disabled = cancel.disabled = false;
                    form.removeAttribute('aria-busy'); status.textContent = ''; input.focus();
                }
            }
        });
        form.append(field, status, error, dialogActions(document, dialogAction(cancel, 'cancel'), dialogAction(open, 'confirm')));
        dialog.append(heading, form); document.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        input.focus();
    });
}
