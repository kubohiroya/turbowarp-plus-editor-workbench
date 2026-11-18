/** The class of the notice; its styles are in `project-file-menu.css`. */
export const projectNoticeClassName = 'tw-project-notice';

const shown = new WeakMap<Document, () => void>();

/**
 * Shows a short notice at the bottom of the window that does not block the editor, such as what a title change
 * could not rename. It has a dismiss button (an X with a localized `title` and `aria-label`) and hides itself after
 * `timeout` milliseconds (12 s by default) unless focus is inside it. A new notice replaces the one shown in the same
 * document. Returns a function that removes the notice.
 */
export function showNotice(document: Document, text: string, {locale, timeout = 12000}: {
    locale: string;
    timeout?: number;
}): () => void {
    shown.get(document)?.();
    const view = document.defaultView;
    const ja = locale.startsWith('ja');
    const notice = document.createElement('aside');
    notice.className = projectNoticeClassName;
    notice.setAttribute('data-project-tools', '');
    notice.setAttribute('data-testid', 'project-notice-snackbar');
    const message = document.createElement('span');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-atomic', 'true');
    message.textContent = text;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    const name = ja ? '閉じる' : 'Dismiss';
    dismiss.title = name;
    dismiss.setAttribute('aria-label', name);
    const svg = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svg, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg, 'path');
    path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    icon.append(path);
    dismiss.append(icon);
    notice.append(message, dismiss);
    let timer = 0;
    const remove = () => {
        view?.clearTimeout(timer);
        notice.remove();
        if (shown.get(document) === remove) shown.delete(document);
    };
    dismiss.addEventListener('click', remove);
    document.body.append(notice);
    shown.set(document, remove);
    timer = view?.setTimeout(() => {
        if (!notice.contains(document.activeElement)) remove();
    }, timeout) ?? 0;
    return remove;
}
