// SPDX-License-Identifier: MPL-2.0
interface FailureOptions {
    cancelled: boolean;
    locale?: string;
    onDetails?(): void;
    onReview?(): void;
}
const screens = new WeakMap<Document, {update(options: FailureOptions): void; close(): void}>();
let sequence = 0;

/** A fresh tab may include about:blank in history without having a usable previous page. */
export function canReturnToPreviousPage(document: Document) {
    const view = document.defaultView!;
    const navigation = (view as Window & {navigation?: {canGoBack: boolean}}).navigation;
    return view.history.length > 1 && !(navigation?.canGoBack === false && !document.referrer);
}

/** Drop all opening instructions while preserving display preferences such as the language. */
export function projectStartURL(view: Window) {
    const url = new URL('editor.html', view.location.href);
    url.search = view.location.search;
    for (const key of ['project_url', 'token', 'extension', 'twPlusOpenTab']) url.searchParams.delete(key);
    url.hash = '';
    return url;
}

/** A terminal opening result replaces the busy screen, including when navigation cannot leave it. */
export function showProjectLoadFailure(document: Document, options: FailureOptions) {
    const existing = screens.get(document);
    if (existing) {existing.update(options); return existing.close;}
    const view = document.defaultView!;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('data-project-tools', '');
    dialog.setAttribute('data-testid', 'project-load-failure');
    const id = `project-load-failure-${++sequence}`;
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-reason`);
    Object.assign(dialog.style, {position: 'fixed', inset: '0', margin: '0', width: '100vw', height: '100dvh',
        maxWidth: 'none', maxHeight: 'none', boxSizing: 'border-box', border: 'none', overflow: 'auto',
        padding: 'clamp(24px, 6vw, 80px)', background: 'var(--ui-modal-background, Canvas)',
        color: 'var(--ui-modal-foreground, CanvasText)', font: 'inherit'});
    const main = document.createElement('main');
    Object.assign(main.style, {maxWidth: '680px', minHeight: '100%', margin: '0 auto',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '20px'});
    const title = document.createElement('h1'); title.id = `${id}-title`; title.tabIndex = -1;
    Object.assign(title.style, {fontSize: 'clamp(24px, 4vw, 36px)', margin: '0', lineHeight: '1.3'});
    const reason = document.createElement('p'); reason.id = `${id}-reason`;
    Object.assign(reason.style, {margin: '0', fontSize: '18px', lineHeight: '1.7'});
    const actions = document.createElement('div');
    Object.assign(actions.style, {display: 'flex', flexWrap: 'wrap', gap: '12px'});
    const button = (action: () => void) => {
        const element = document.createElement('button'); element.type = 'button';
        Object.assign(element.style, {font: 'inherit', padding: '12px 18px', minHeight: '44px', cursor: 'pointer',
            border: '1px solid currentColor', borderRadius: '6px', background: 'transparent', color: 'inherit'});
        element.addEventListener('click', action); actions.append(element); return element;
    };
    const back = button(() => view.history.back());
    // Reopen the same requested project so the person can reconsider extension permissions.
    // Reload keeps its URL, including its project source, instead of opening a default project.
    let review = options.onReview ?? (() => view.location.reload());
    const confirm = button(() => review());
    Object.assign(confirm.style, {background: 'var(--looks-secondary, #1d4ed8)', color: '#fff', borderColor: 'transparent'});
    const closeTab = button(() => view.close());
    let details: (() => void) | undefined;
    const log = button(() => details?.());
    main.append(title, reason, actions); dialog.append(main);
    // Escape must not expose the stale loading screen underneath the terminal result.
    dialog.addEventListener('cancel', event => event.preventDefault());
    let locale = options.locale ?? new URL(view.location.href).searchParams.get('lang') ?? document.documentElement.lang ?? 'en';
    const screen = {
        update(value: FailureOptions) {
            locale = value.locale ?? locale;
            details = value.onDetails ?? details;
            review = value.onReview ?? review;
            const ja = locale.startsWith('ja');
            dialog.dataset.outcome = value.cancelled ? 'cancelled' : 'failed';
            title.textContent = ja ? '作品を開けませんでした' : 'The project could not be opened';
            reason.textContent = value.cancelled ?
                (ja ? '機能拡張を実行しないことを選んだため、作品の読み込みを中止しました。' :
                    'You chose not to run the extensions, so loading the project has stopped.') :
                (ja ? '読み込み中に問題が起きたため、作品の読み込みを中止しました。詳細ログを確認できます。' :
                    'Loading stopped because a problem occurred. You can view the detailed log.');
            back.textContent = ja ? '前の画面に戻る' : 'Go back';
            back.disabled = !canReturnToPreviousPage(document);
            Object.assign(back.style, {opacity: back.disabled ? '0.45' : '1',
                cursor: back.disabled ? 'default' : 'pointer'});
            confirm.textContent = ja ? '確認画面に戻る' : 'Return to confirmation';
            closeTab.textContent = ja ? 'このタブを閉じる' : 'Close this tab';
            closeTab.hidden = !new URL(view.location.href).searchParams.has('twPlusOpenTab');
            log.textContent = ja ? '詳細ログを表示' : 'View detailed log'; log.hidden = !details;
        },
        close() {dialog.remove(); screens.delete(document);}
    };
    screens.set(document, screen); screen.update(options);
    document.body.append(dialog); dialog.showModal(); title.focus();
    return screen.close;
}

export const closeProjectLoadFailure = (document: Document) => screens.get(document)?.close();

/** Preserve routing identity while ending the load; no default-project fetch follows a refusal. */
export function stoppedProjectLoadState(initial: any, states: {NOT_LOADED: string}, current = initial) {
    return {...current, loadingState: states.NOT_LOADED, projectData: null, error: null};
}
