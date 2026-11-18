import {dialogAction, dialogActions} from '@kubohiroya/turbowarp-plus-editor-windows';

/**
 * The save name is the name a project is saved under where a project title cannot be used as is: a folder in the
 * browser or on the device, and a GitHub repository. It follows the GitHub repository name rule, so one name works
 * for all of them: letters, digits, `-`, `_` and `.`, up to 100 characters, neither `.` nor `..`, and not ending in
 * `.git` (in any case).
 */
export function isValidSaveName(name: string): boolean {
    return /^[A-Za-z0-9_.-]{1,100}$/.test(name) && name !== '.' && name !== '..' && !/\.git$/i.test(name);
}

/**
 * Suggests a save name for a project title: its ASCII letters and digits in lower case, with accents removed and
 * every other run of characters turned into one `-`. Returns `''` when nothing usable remains, as for a title
 * written only in Japanese, so the person enters the name themselves.
 */
export function suggestSaveName(title: string): string {
    let name = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    name = name.slice(0, 100).replace(/-+$/, '');
    while (/\.git$/.test(name)) name = name.slice(0, -4).replace(/[-.]+$/, '');
    return isValidSaveName(name) && /[a-z0-9]/.test(name) ? name : '';
}

/** The texts that explain the save name, shared by {@link askSaveName} and the new project form. */
export function saveNameTexts(locale: string) {
    const ja = locale.startsWith('ja');
    return {
        title: ja ? '保存用の名前' : 'Save Name',
        explanation: ja ?
            '作品名に、フォルダ名やリポジトリ名に使えない文字が含まれています。保存に使う名前を入力してください。' :
            'The project title contains characters that cannot be used in folder or repository names. ' +
            'Enter the name to save it under.',
        allowed: ja ? '使える文字：半角英数字、- _ . （100 文字まで。. や .. と、末尾の .git は使えません）' :
            'Allowed: Letters A–Z and a–z, digits, -, _ and . (up to 100 characters; not . or .., and not ending in .git)',
        invalid: ja ? 'この名前は使えません。使える文字の範囲を確かめてください。' :
            'This name cannot be used. Check the allowed characters.'
    };
}

/** Marks a save name input valid or invalid and returns whether its trimmed value is a valid save name. */
export function checkSaveNameInput(input: HTMLInputElement, error: HTMLElement, locale: string) {
    const valid = isValidSaveName(input.value.trim());
    input.setAttribute('aria-invalid', String(!valid));
    error.textContent = valid ? '' : saveNameTexts(locale).invalid;
    return valid;
}

let dialogs = 0;

/**
 * Asks for a save name in a modal dialog, for a title that cannot be used as a folder or repository name. The input
 * starts with `current`, or else with {@link suggestSaveName} of the title, and OK stays disabled until the name is
 * valid. Resolves the trimmed name on OK and `null` on Cancel or Escape, or when the document cannot show a dialog.
 */
export function askSaveName({document, locale, title, current}: {
    document: Document;
    locale: string;
    title: string;
    current?: string;
}): Promise<string | null> {
    if (!document?.body) return Promise.resolve(null);
    const text = saveNameTexts(locale);
    const ja = locale.startsWith('ja');
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'tw-project-file-dialog';
        dialog.setAttribute('aria-label', text.title);
        dialog.setAttribute('data-save-name-dialog', '');
        const form = document.createElement('form');
        const heading = document.createElement('h2');
        heading.textContent = text.title;
        const explanation = document.createElement('p');
        explanation.textContent = text.explanation;
        const projectTitle = document.createElement('p');
        projectTitle.textContent = (ja ? '作品名：' : 'Project title: ') + title;
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.name = 'save-name';
        input.maxLength = 100;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = current ?? suggestSaveName(title);
        const allowed = document.createElement('p');
        allowed.id = `tw-save-name-allowed-${++dialogs}`;
        allowed.textContent = text.allowed;
        input.setAttribute('aria-describedby', allowed.id);
        label.append(text.title, input);
        const error = document.createElement('p');
        error.setAttribute('role', 'alert');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = ja ? 'キャンセル' : 'Cancel';
        const ok = document.createElement('button');
        ok.type = 'submit';
        ok.textContent = 'OK';
        form.append(heading, explanation, projectTitle, label, allowed, error,
            dialogActions(document, dialogAction(cancel, 'cancel'), dialogAction(ok, 'confirm')));
        dialog.append(form);
        const check = () => {
            const valid = checkSaveNameInput(input, error, locale);
            ok.disabled = !valid;
            return valid;
        };
        let settled = false;
        const finish = (answer: string | null) => {
            if (settled) return;
            settled = true;
            if (dialog.open && typeof dialog.close === 'function') dialog.close();
            dialog.remove();
            resolve(answer);
        };
        input.addEventListener('input', check);
        cancel.addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', event => {event.preventDefault(); finish(null);});
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (check()) finish(input.value.trim());
        });
        // The first check shows nothing for an empty suggestion; the disabled OK is enough until the person types.
        ok.disabled = !isValidSaveName(input.value.trim());
        if (input.value) check();
        document.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        input.focus();
        input.select?.();
    });
}
