// SPDX-License-Identifier: MPL-2.0
import {renameCatalogProject, sortCatalog} from './project-catalog.js';
import type {CatalogHost, CatalogProject, CatalogSort} from './project-catalog.js';

/** One set of commands for every resource. Availability comes from the saved resource's adapter. */
export function openProjectCatalog(document: Document, host: CatalogHost, locale = 'en'): () => void {
    const ja = locale.startsWith('ja');
    const label = (jp: string, en: string) => ja ? jp : en;
    const view = document.defaultView!;
    const returnFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-project-catalog';
    dialog.dataset.projectCatalog = '';
    dialog.dataset.projectTools = '';
    dialog.setAttribute('aria-label', label('プロジェクト一覧', 'Projects'));
    const heading = document.createElement('h2');
    heading.textContent = label('プロジェクト一覧', 'Projects');
    const removalNote = document.createElement('p');
    removalNote.textContent = label('「一覧から除外」は参照だけを消し、保存データを残します。「保存データを削除」は保存先のファイルやフォルダを消します。',
        'Remove from List only forgets the reference and keeps the data. Delete Saved Data removes the saved file or folder.');
    const orderLabel = document.createElement('label');
    orderLabel.textContent = label('並び順 ', 'Sort by ');
    const order = document.createElement('select');
    order.name = 'sort';
    const options: [CatalogSort['by'], string][] = [
        ['lastOpenedAt', label('最終利用日時', 'Last opened')], ['title', label('名前', 'Name')],
        ['location', label('保存場所', 'Location')]
    ];
    for (const [key, name] of options) for (const direction of ['desc', 'asc'] as const) {
        const option = document.createElement('option');
        option.value = `${key}:${direction}`;
        option.textContent = `${name} · ${direction === 'asc' ? label('昇順', 'Ascending') : label('降順', 'Descending')}`;
        order.append(option);
    }
    orderLabel.append(order);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const list = document.createElement('ul');
    list.dataset.projectCatalogList = '';
    const editor = document.createElement('form');
    editor.hidden = true;
    editor.className = 'tw-project-catalog__rename';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = label('閉じる', 'Close');
    close.dataset.catalogAction = 'close';
    let alive = true;
    let busy = false;
    let sort: CatalogSort = {by: 'lastOpenedAt', direction: 'desc'};
    let records: CatalogProject[] = [];
    const report = (failure: unknown) => {
        if ((failure as {name?: string})?.name === 'AbortError') return;
        error.textContent = label('操作を完了できませんでした。一部の変更が完了している場合があります。一覧を確認してください。',
            'The operation could not be completed. Some changes may have completed. Check the list.') +
            (failure instanceof Error ? ` ${failure.message}` : '');
        error.hidden = false;
    };
    const dispose = () => {
        if (!alive) return;
        alive = false;
        dialog.remove();
        if (returnFocus?.isConnected) returnFocus.focus();
    };
    close.addEventListener('click', () => {if (!busy) dialog.close();});
    dialog.addEventListener('close', dispose);
    dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
    const setBusy = (value: boolean) => {
        busy = value;
        dialog.setAttribute('aria-busy', String(value));
        order.disabled = value;
        for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
            if (value) {control.dataset.wasDisabled = String(control.disabled); control.disabled = true;}
            else if (control.dataset.wasDisabled !== undefined) {
                control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled;
            }
        }
        status.textContent = value ? label('処理中…', 'Working…') : '';
    };
    const run = async (action: () => Promise<void>) => {
        if (busy || !alive) return;
        error.hidden = true;
        setBusy(true);
        try {await action();} catch (failure) {if (alive) report(failure);}
        finally {
            if (alive) {
                try {records = await host.store.list(); draw();} catch (failure) {report(failure);}
                setBusy(false);
            }
        }
    };
    const button = (text: string, command: string, action?: () => void, unavailable?: string) => {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = text; element.dataset.catalogAction = command;
        element.disabled = !action;
        if (unavailable) element.title = unavailable;
        if (action) element.addEventListener('click', action);
        return element;
    };
    const rename = (project: CatalogProject, target: 'title' | 'storageName') => {
        editor.replaceChildren(); editor.hidden = false;
        const operations = host.operations(project);
        const nameLabel = document.createElement('label');
        nameLabel.textContent = target === 'title' ? label('新しいプロジェクト名 ', 'New project name ') :
            label('保存先での新しい名前 ', 'New storage name ');
        const input = document.createElement('input');
        input.name = target; input.required = true; input.maxLength = target === 'title' ? 100 : 200;
        input.value = project[target]; nameLabel.append(input);
        const current = document.createElement('p');
        current.textContent = label('現在の名前: ', 'Current name: ') + project[target];
        const bothLabel = document.createElement('label');
        const both = document.createElement('input'); both.type = 'checkbox'; both.name = 'both';
        both.disabled = !operations.renameProject || !operations.renameStorage;
        bothLabel.append(both, label('プロジェクト名と保存先の名前を揃える', 'Use this name for both project and storage'));
        const save = document.createElement('button');
        save.type = 'submit'; save.textContent = label('変更', 'Rename');
        const cancel = button(label('キャンセル', 'Cancel'), 'cancel-rename', () => {editor.hidden = true;});
        const targetNote = document.createElement('p');
        targetNote.textContent = target === 'title' ? label('作品を開いて作品情報を変更し、保存します。',
            'Opens the project, changes its project information, and saves it.') :
            label('保存先での名前を変更します。作品名はチェックした場合に変更します。',
                'Renames the saved resource. The project title changes only when checked.');
        editor.append(current, targetNote, nameLabel, bothLabel, save, cancel);
        editor.onsubmit = event => {
            event.preventDefault();
            const value = input.value.trim();
            if (!value || !editor.reportValidity()) return;
            void run(async () => {
                const projectName = project.location === 'file' && target === 'storageName' ? value.replace(/\.sb3$/i, '') : value;
                await renameCatalogProject(host, project, both.checked ? {title: projectName, storageName: value} : {[target]: value});
                editor.hidden = true;
            });
        };
        input.focus(); input.select();
    };
    const draw = () => {
        list.replaceChildren();
        if (!records.length) {
            const empty = document.createElement('li');
            empty.textContent = label('登録されたプロジェクトはありません。', 'No projects are registered.');
            list.append(empty);
        }
        for (const project of sortCatalog(records, sort, locale)) {
            const row = document.createElement('li'); row.dataset.projectId = project.id;
            const name = document.createElement('strong'); name.textContent = project.title;
            const detail = document.createElement('p');
            const place = {file: label('SB3ファイル', 'SB3 file'), folder: label('手元のフォルダ', 'Device folder'),
                browser: label('ブラウザー内', 'In this browser'), remote: label('リモートGit', 'Remote Git')}[project.location];
            const time = project.lastOpenedAt === null ? label('未利用', 'Not opened yet') :
                new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}).format(project.lastOpenedAt);
            detail.textContent = `${place} · ${project.storageName} · ${time}`;
            const actions = host.operations(project);
            const controls = document.createElement('div'); controls.className = 'tw-project-catalog__actions';
            controls.append(
                button(label('開く', 'Open'), 'open', () => void run(async () => {
                    const source = await actions.open();
                    if (source) {await host.store.register(source, true, project.id); dialog.close();}
                })),
                button(label('プロジェクト名を変更…', 'Rename Project…'), 'rename-title',
                    actions.renameProject ? () => rename(project, 'title') : undefined, actions.unavailable?.renameProject),
                button(label('保存先の名前を変更…', 'Rename Storage…'), 'rename-storage',
                    actions.renameStorage ? () => rename(project, 'storageName') : undefined, actions.unavailable?.renameStorage),
                button(label('一覧から除外', 'Remove from List'), 'forget', () => void run(async () => {
                    await host.store.forget(project.id);
                })),
                button(label('保存データを削除…', 'Delete Saved Data…'), 'delete', actions.deleteData ? () => void run(async () => {
                    const text = label('次の保存データを削除します。元に戻せません。GitHub上のリポジトリは削除しません。',
                        'Delete the following saved data? This cannot be undone. The repository on GitHub is kept.');
                    if (!view.confirm(`${text}\n\n${project.title}\n${place}: ${project.storageName}`)) return;
                    // Keep the import tombstone so legacy workspace history cannot restore a deleted resource.
                    await actions.deleteData!(); await host.store.forget(project.id);
                }) : undefined, actions.unavailable?.deleteData)
            );
            row.append(name, detail);
            if (project.remote) {const remote = document.createElement('p'); remote.textContent = project.remote; row.append(remote);}
            row.append(controls);
            const reasons = [...new Set(Object.values(actions.unavailable ?? {}).filter(Boolean))];
            if (reasons.length) {
                const note = document.createElement('small'); note.textContent = reasons.join(' '); row.append(note);
            }
            list.append(row);
        }
    };
    order.addEventListener('change', () => void run(async () => {
        const [by, direction] = order.value.split(':') as [CatalogSort['by'], CatalogSort['direction']];
        sort = await host.store.sort({by, direction});
    }));
    dialog.append(heading, removalNote, orderLabel, status, error, list, editor, close);
    document.body.append(dialog); dialog.showModal(); close.focus();
    void run(async () => {
        await host.refresh(); sort = await host.store.sort(); order.value = `${sort.by}:${sort.direction}`;
    });
    return dispose;
}
