// SPDX-License-Identifier: MPL-2.0
/**
 * The extensions screen: each extension the project uses, the version and form to change it to,
 * and what checking that change found (turbowarp-plus-editor#901, stage 3).
 *
 * Opening the screen, checking and changing a choice never change the project. Only Apply does,
 * and only with the plan the last check showed; editing any choice afterwards asks for a new check.
 */
import {dialogAction, dialogActions} from '@kubohiroya/turbowarp-plus-editor-windows';
import {changesCode} from './extension-updates.js';
import type {ProjectExtension, ProjectExtensionPlan, ProjectExtensionPlanStep, ProjectExtensionRequest,
    createExtensionUpdates} from './extension-updates.js';

type Updates = ReturnType<typeof createExtensionUpdates>;
type Format = ProjectExtension['format'];
const formats: readonly Format[] = ['remote-non-cacheable', 'remote-cacheable', 'embedded-file', 'embedded-data'];
const isRemote = (format: string) => format.startsWith('remote-');

/** Errors the person can accept after reading them, and the request option that accepts each. */
const acceptable = {
    API_BREAKING: 'allowBreakingApi',
    BLOCK_IN_USE_REMOVED: 'allowBreakingApi',
    EXECUTION_WIDENED: 'allowExecutionChange',
    PRERELEASE_NOT_REQUESTED: 'allowPrerelease'
} as const;
type Allowance = typeof acceptable[keyof typeof acceptable];

export function renderExtensionUpdateForm(document: Document, locale: string, close: () => void, updates: Updates,
    {add}: {add?: () => void} = {}) {
    const ja = locale.startsWith('ja');
    const label = (jp: string, en: string) => ja ? jp : en;
    const make = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, text?: string, attributes: Record<string, string> = {}) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
    };
    // Built from this document, which need not be the global one.
    const option = (text: string, value: string) => {
        const node = document.createElement('option');
        node.textContent = text;
        node.value = value;
        return node;
    };
    const formatLabels: Record<Format, string> = {
        'remote-non-cacheable': label('HTTPS から毎回取得', 'Fetch from HTTPS each time'),
        'remote-cacheable': label('HTTPS から取得・キャッシュ可', 'Fetch from HTTPS, caching allowed'),
        'embedded-file': label('SB3 内のファイル', 'File in the SB3'),
        'embedded-data': label('作品 JSON 内のデータ', 'Data in the project JSON')
    };
    const severities = {error: label('エラー', 'Error'), warning: label('警告', 'Warning'), info: label('情報', 'Info')};
    const allowanceLabels: Record<Allowance, string> = {
        allowBreakingApi: label('互換性のない変更を承知で進める', 'Proceed despite the incompatible changes'),
        allowExecutionChange: label('より広い実行モードを要求する（実行時に改めて許可を求めます）',
            'Request the wider execution mode (permission is still asked when it runs)'),
        allowPrerelease: label('プレリリース版を使う', 'Use the prerelease')
    };
    const sourceText = (source: ProjectExtension['source']) =>
        source.kind === 'npm' ? `npm ${source.package}@${source.version}` :
            source.kind === 'github' ? `GitHub ${source.repository} ${source.tag}` :
                source.kind === 'build' ? label('ビルド', 'Build') : label('取得元不明', 'Unknown source');

    const controller = new AbortController();
    const form = make('form', undefined, {'data-testid': 'project-extension-updates'});
    form.append(make('p', label(
        '使用中の機能拡張の版と保存形式を変更できます。「変更内容を確認」で取得と検査を行い、「適用」で編集中の作品を変更します。',
        'Change the version and stored form of the extensions this project uses. Check the changes to fetch and verify them, then apply them to the open project.')));
    const notes = make('ul');
    for (const text of [
        label('HTTPS からの取得は、作品を初めて開くときに配信元へ接続します。キャッシュは常に残るとは限らず、オフラインで開けることは保証されません。',
            'A reference is fetched from its address the first time the project is opened. A cached copy may not be kept, so opening offline is not guaranteed.'),
        label('埋め込むと SB3 が大きくなります。埋め込んでも、拡張機能自体が使う外部サービスや Plus 固有の機能への依存はなくなりません。',
            'Embedding makes the SB3 larger. It does not remove what the extension itself depends on, such as external services or Plus features.'),
        label('標準の TurboWarp は Plus マニフェストを読みません。取得元・版・実行モードの記録は Plus でだけ使われます。',
            'Standard TurboWarp does not read the Plus manifest; the recorded source, version and execution mode are used by Plus only.')
    ]) notes.append(make('li', text));
    form.append(notes);
    const list = make('ul', undefined, {'data-extension-list': ''});
    const status = make('p', label('確認中…', 'Inspecting…'), {role: 'status'});
    const done = make('button', label('閉じる', 'Close'), {type: 'button'});
    done.onclick = close;
    const check = make('button', label('変更内容を確認', 'Check Changes'), {type: 'button'});
    const apply = make('button', label('適用', 'Apply'), {type: 'submit'});
    check.disabled = true;
    apply.disabled = true;
    const actions = dialogActions(document, dialogAction(done, 'close'), check, dialogAction(apply, 'confirm'));
    if (add) {
        const button = make('button', label('機能拡張の追加', 'Add Extension'), {type: 'button'});
        button.onclick = () => {close(); add();};
        actions.prepend(button);
    }
    form.append(list, status, actions);

    interface Row {
        extension: ProjectExtension;
        version: HTMLSelectElement;
        exact: HTMLInputElement;
        reference: HTMLInputElement;
        format: HTMLSelectElement;
        url: HTMLInputElement;
        allowances: Map<Allowance, HTMLInputElement>;
        result: HTMLElement;
    }
    const rows: Row[] = [];
    let plan: ProjectExtensionPlan | undefined;
    let busy = false;
    const invalidate = () => {
        plan = undefined;
        apply.disabled = true;
        for (const row of rows) row.result.replaceChildren();
        status.textContent = '';
    };
    const request = (row: Row): ProjectExtensionRequest | undefined => {
        const version = row.version.value === 'exact' ? row.exact.value.trim() : row.version.value === 'latest' ? 'latest' : undefined;
        const reference = row.reference.value.trim() || undefined;
        const format = row.format.value as Format;
        const url = isRemote(format) ? row.url.value.trim() || undefined : undefined;
        const allowances = Object.fromEntries([...row.allowances].filter(([, input]) => input.checked)
            .map(([name]) => [name, true]));
        if (version === undefined && !reference && format === row.extension.format && url === undefined) return undefined;
        return {...(version ? {version} : {}), ...(reference ? {reference} : {}),
            ...(format !== row.extension.format ? {format} : {}), ...(url ? {url} : {}), ...allowances};
    };
    const requests = () => Object.fromEntries(rows.flatMap(row => {
        const value = request(row);
        return value ? [[row.extension.id, value]] : [];
    }));
    const setBusy = (value: boolean) => {
        busy = value;
        for (const row of rows) for (const input of [row.version, row.exact, row.reference, row.format, row.url,
            ...row.allowances.values()]) input.disabled = value;
        check.disabled = value || !rows.length;
        if (value) apply.disabled = true;
    };

    const renderStep = (row: Row, step: ProjectExtensionPlanStep) => {
        const {from, to} = step;
        const versions = `${from.version ?? label('版不明', 'unknown version')} → ${to.version ?? label('版不明', 'unknown version')}`;
        const summary = step.change === 'none' ? label('変更なし', 'No change') :
            `${versions} · ${formatLabels[from.format]} → ${formatLabels[to.format]}`;
        const result = row.result;
        result.replaceChildren(make('p', summary));
        result.append(make('p', `SHA-256 ${to.sha256}` + (to.url ? ` · ${to.url}` : '') + ` · ${sourceText(to.source)}`));
        if (changesCode(step)) result.append(make('p', label(
            'コードが変わります。新しいコードは、作品を読み込み直すときに改めて実行の許可を求めます。',
            'The code changes. The new code asks for permission again when the project is reloaded.')));
        const diagnostics = make('ul');
        for (const item of step.diagnostics) {
            diagnostics.append(make('li', `${severities[item.severity]}: ${item.message}`, {'data-severity': item.severity,
                'data-code': item.code}));
        }
        if (step.diagnostics.length) result.append(diagnostics);
        for (const item of step.diagnostics) {
            const name = acceptable[item.code as keyof typeof acceptable];
            if (!name || row.allowances.has(name)) continue;
            const input = make('input', undefined, {type: 'checkbox'});
            input.onchange = invalidateKeepingAllowances;
            row.allowances.set(name, input);
            const choice = make('label');
            choice.append(input, ` ${allowanceLabels[name]}`);
            row.result.parentElement!.insertBefore(choice, row.result);
        }
    };
    // Accepting a warning changes the request, so it needs a new check, but the boxes stay.
    function invalidateKeepingAllowances() { invalidate(); }

    void updates.list().then(extensions => {
        if (controller.signal.aborted) return;
        status.textContent = extensions.length ? '' : label('使用中の機能拡張はありません。', 'No extensions in use.');
        for (const extension of extensions) {
            const item = make('li', undefined, {'data-extension-id': extension.id});
            item.append(make('h3', extension.id));
            item.append(make('p', [formatLabels[extension.format],
                extension.version ? `${label('版', 'Version')} ${extension.version}` : label('版不明', 'Unknown version'),
                sourceText(extension.source), `SHA-256 ${extension.sha256.slice(0, 12)}…`].join(' · ')));
            if (extension.diagnostics.length) {
                const notes = make('ul');
                for (const note of extension.diagnostics) notes.append(make('li', `${severities[note.severity]}: ${note.message}`,
                    {'data-severity': note.severity, 'data-code': note.code}));
                item.append(notes);
            }
            const id = (name: string) => `extension-${name}-${extension.id}`;
            const field = (title: string, control: HTMLElement, name: string) => {
                control.id = id(name);
                const row = make('label', title, {for: control.id});
                row.append(control);
                item.append(row);
                return row;
            };
            const version = make('select');
            version.add(option(label('変更しない', 'Keep this version'), 'keep'));
            version.add(option(label('最新の安定版', 'Latest stable release'), 'latest'));
            version.add(option(label('版を指定', 'Exact version'), 'exact'));
            field(label('版', 'Version'), version, 'version');
            const exact = make('input', undefined, {inputmode: 'text', autocomplete: 'off', placeholder: '1.2.3'});
            const exactRow = field(label('指定する版', 'Exact version'), exact, 'exact');
            const reference = make('input', undefined, {autocomplete: 'off', spellcheck: 'false',
                placeholder: label('例: @scope/package または GitHub のリポジトリ URL', 'e.g. @scope/package or a GitHub repository URL')});
            const referenceRow = field(extension.source.kind === 'unknown' ?
                label('公開元（取得元が不明なため必要）', 'Published source (required: the source is unknown)') :
                label('公開元（変更する場合のみ）', 'Published source (only to change it)'), reference, 'reference');
            const format = make('select');
            for (const value of formats) format.add(option(formatLabels[value], value));
            format.value = extension.format;
            field(label('保存形式', 'Stored form'), format, 'format');
            const url = make('input', undefined, {inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
                placeholder: label('空欄なら公開版のアドレス', 'Empty: the published address')});
            const urlRow = field(label('HTTPS URL', 'HTTPS URL'), url, 'url');
            const result = make('div', undefined, {'aria-live': 'polite', 'data-extension-plan': ''});
            item.append(result);
            const row: Row = {extension, version, exact, reference, format, url, allowances: new Map(), result};
            const sync = () => {
                exactRow.hidden = version.value !== 'exact';
                referenceRow.hidden = version.value === 'keep' && !reference.value;
                urlRow.hidden = !isRemote(format.value);
            };
            for (const input of [version, exact, reference, format, url]) {
                input.addEventListener('input', () => { sync(); invalidate(); });
                input.addEventListener('change', () => { sync(); invalidate(); });
            }
            sync();
            rows.push(row);
            list.append(item);
        }
        check.disabled = !rows.length;
    }, error => { status.textContent = error.message; });

    check.onclick = async () => {
        if (busy) return;
        const wanted = requests();
        invalidate();
        if (!Object.keys(wanted).length) {
            status.textContent = label('変更はありません。', 'Nothing to change.');
            return;
        }
        setBusy(true);
        status.textContent = label('取得・検査中…', 'Fetching and checking…');
        try {
            const result = await updates.plan(wanted, controller.signal);
            if (controller.signal.aborted) return;
            for (const step of result.steps) {
                const row = rows.find(item => item.extension.id === step.id);
                if (row) renderStep(row, step);
            }
            plan = result;
            const reload = result.steps.some(changesCode);
            status.textContent = result.blocked ?
                label('適用できない変更があります。内容を確かめてください。', 'Some changes cannot be applied. Review them.') :
                [reload ? label('適用すると作品を読み込み直します。元に戻す操作の履歴は消えます。',
                    'Applying reloads the project; its undo history is cleared.') : '',
                label('適用後の作品は未保存です。保存は通常の保存操作で行います。',
                    'The project is unsaved after applying. Save it as usual.')].filter(Boolean).join(' ');
        } catch (error) {
            if (!controller.signal.aborted) status.textContent = error.message;
        } finally {
            if (!controller.signal.aborted) {
                setBusy(false);
                apply.disabled = !plan || plan.blocked || plan.steps.every(step => step.change === 'none');
            }
        }
    };

    form.onsubmit = async event => {
        event.preventDefault();
        if (busy || apply.disabled || !plan) return;
        const current = plan;
        setBusy(true);
        status.textContent = label('適用中…', 'Applying…');
        try {
            await updates.apply(current, controller.signal);
            if (form.isConnected) close();
        } catch (error) {
            if (controller.signal.aborted) return;
            invalidate();
            status.textContent = (error as {code?: string}).code === 'PLAN_CHANGED' ? label(
                '作品か公開版が確認後に変わりました。もう一度確認してください。',
                'The project or a published version changed after the check. Check again.') :
                (error as {code?: string}).code === 'PROJECT_RECOVERY_REQUIRED' ? label(
                    '適用に失敗し、元の作品へも戻せませんでした。保存せずに、元のファイルを開き直してください。',
                    'Applying failed and the original project could not be restored. Do not save; reopen the original file.') :
                (error as {code?: string}).code === 'PROJECT_REPLACED' ? label(
                    '別の作品が開かれました。この画面を開き直してください。',
                    'Another project was opened. Open this screen again.') :
                    `${label('適用できませんでした。作品は元のままです。', 'Could not apply the changes; the project is unchanged.')} ${error.message}`;
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };

    return {element: form, dispose() { controller.abort(); }};
}
