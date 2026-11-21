import {dialogAction, dialogActions} from '@kubohiroya/turbowarp-plus-editor-windows';
/**
 * Ask before sending an SB3-provided URL any request, including for non-cacheable data.
 *
 * The person sees every URL the project wants to load. When the data may be cached, they choose
 * whether to allow it. Without a document to show the question in, or once the load is cancelled,
 * the answer is `undefined`: nothing is requested.
 */

export interface ProjectPayloadApprovalOptions {
    /** The class of the Editor's themed dialog frame. */
    className?: string;
    signal?: AbortSignal;
}

/**
 * @returns `true` to load and allow caching, `false` to load without caching, `undefined` to cancel.
 */
export function approveProjectPayloads(document: Document | undefined, locale: string | undefined,
    urls: readonly string[], cacheable: boolean, {className, signal}: ProjectPayloadApprovalOptions = {}):
    Promise<boolean | undefined> {
    if (!document?.body || signal?.aborted) return Promise.resolve(undefined);
    const ja = (locale || document.documentElement.lang || '').startsWith('ja');
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        const title = document.createElement('h2');
        title.textContent = ja ? '作品のデータを取得する' : 'Load Project Data';
        dialog.setAttribute('aria-label', title.textContent);
        dialog.setAttribute('data-project-tools', '');
        if (className) dialog.className = className;
        dialog.style.overflowWrap = 'anywhere';
        const list = document.createElement('ul');
        for (const url of urls) {
            const row = document.createElement('li');
            row.textContent = url;
            list.append(row);
        }
        const finish = (answer: boolean | undefined) => {
            signal?.removeEventListener('abort', cancel);
            dialog.remove();
            resolve(answer);
        };
        const cancel = () => finish(undefined);
        const button = (label: string, answer: boolean | undefined) => {
            const node = document.createElement('button');
            node.type = 'button';
            node.textContent = label;
            node.addEventListener('click', () => finish(answer));
            return node;
        };
        dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
        signal?.addEventListener('abort', cancel, {once: true});
        const openLabel = cacheable ? (ja ? 'キャッシュせずに開く' : 'Open without caching') : (ja ? '開く' : 'Open');
        const actions = dialogActions(document, dialogAction(button(ja ? 'キャンセル' : 'Cancel', undefined), 'cancel'),
            dialogAction(button(openLabel, false), 'confirm'));
        if (cacheable) actions.append(dialogAction(button(ja ? 'キャッシュを許可して開く' : 'Allow caching and open', true), 'confirm'));
        dialog.append(title, list, actions);
        document.body.append(dialog);
        dialog.showModal();
    });
}
