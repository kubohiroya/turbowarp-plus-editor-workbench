import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {test, type TestContext} from 'node:test';
import {JSDOM} from 'jsdom';
import type {GitHubCreationAccount} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-creation';
import {askSaveName, isValidSaveName, projectFileDialogTitle, renderNewProjectForm, suggestSaveName,
    type NewProjectFormOptions, type NewProjectRequest, type NewProjectResult} from '../dist/project-file-dialogs.js';

const account: GitHubCreationAccount = {
    account: {login: 'octocat'},
    owners: [{login: 'octocat', type: 'User', canCreate: {private: true, public: true}}]
};

test('a save name follows the GitHub repository name rule', () => {
    for (const name of ['cat', 'Cat-Adventure_2.0', 'a', 'x'.repeat(100), '.hidden', 'git', 'my.github']) {
        assert.equal(isValidSaveName(name), true, name);
    }
    for (const name of ['', '.', '..', 'cat.git', 'cat.GIT', 'x'.repeat(101), 'two words', '猫', 'a/b', 'é']) {
        assert.equal(isValidSaveName(name), false, name);
    }
});

test('the suggested save name is an ASCII slug, and empty when nothing usable remains', () => {
    assert.equal(suggestSaveName('Cat Adventure'), 'cat-adventure');
    assert.equal(suggestSaveName('  Café  Crème!! '), 'cafe-creme');
    assert.equal(suggestSaveName('ＡＢＣ　１２３'), 'abc-123');
    assert.equal(suggestSaveName('猫の冒険'), '');
    assert.equal(suggestSaveName('ねこ Cat 2'), 'cat-2');
    assert.equal(suggestSaveName('..'), '');
    assert.equal(suggestSaveName('project.git'), 'project');
    assert.equal(suggestSaveName('a'.repeat(120)), 'a'.repeat(100));
    for (const title of ['Cat Adventure', 'project.git', 'ＡＢＣ', 'Ünïcödé — test']) {
        assert.ok(isValidSaveName(suggestSaveName(title)), title);
    }
});

function dom(t: TestContext) {
    const window = new JSDOM('<body></body>').window;
    t.after(() => window.close());
    return window;
}

test('askSaveName explains the rule, validates as the person types, and resolves the name on OK', async t => {
    const window = dom(t);
    const answer = askSaveName({document: window.document, locale: 'ja', title: '猫の冒険'});
    const dialog = window.document.querySelector('[data-save-name-dialog]');
    assert.match(dialog.textContent, /フォルダ名やリポジトリ名に使えない文字/);
    assert.match(dialog.textContent, /半角英数字、- _ . （100 文字まで。. や .. と、末尾の .git は使えません）/);
    const input = dialog.querySelector<HTMLInputElement>('input[name="save-name"]');
    const ok = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
    assert.equal(input.value, '');
    assert.equal(ok.disabled, true);
    input.value = 'neko.git';
    input.dispatchEvent(new window.Event('input'));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(ok.disabled, true);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /この名前は使えません/);
    input.value = ' neko-no-bouken ';
    input.dispatchEvent(new window.Event('input'));
    assert.equal(input.getAttribute('aria-invalid'), 'false');
    assert.equal(ok.disabled, false);
    ok.click();
    assert.equal(await answer, 'neko-no-bouken');
    assert.equal(window.document.querySelector('[data-save-name-dialog]'), null);
});

test('askSaveName starts from the current name or the suggestion, and resolves null on Cancel', async t => {
    const window = dom(t);
    const first = askSaveName({document: window.document, locale: 'en', title: 'Cat Adventure!'});
    let dialog = window.document.querySelector('[data-save-name-dialog]');
    assert.match(dialog.textContent, /Letters A–Z and a–z, digits, -, _ and \. \(up to 100 characters; not \. or \.\., and not ending in \.git\)/);
    assert.equal(dialog.querySelector<HTMLInputElement>('input').value, 'cat-adventure');
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click();
    assert.equal(await first, null);
    const second = askSaveName({document: window.document, locale: 'en', title: 'Cat Adventure!', current: 'kept'});
    dialog = window.document.querySelector('[data-save-name-dialog]');
    assert.equal(dialog.querySelector<HTMLInputElement>('input').value, 'kept');
    dialog.dispatchEvent(new window.Event('cancel', {cancelable: true}));
    assert.equal(await second, null);
});

function fixture(t: TestContext, options: Partial<NewProjectFormOptions> = {}, locale = 'en',
    answer: () => Promise<NewProjectResult> = async () => 'created') {
    const window = dom(t);
    const {document} = window;
    const calls: string[] = [];
    const requests: NewProjectRequest[] = [];
    const closed: NewProjectResult[] = [];
    const form = renderNewProjectForm(document, locale, {
        create: () => calls.push('create'),
        createIn: async request => {requests.push(request); return answer();},
        ...options
    }, result => {closed.push(result); form.remove();});
    document.body.append(form);
    const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => form.querySelector<T>(`[name="${name}"]`);
    const radio = (group: string, value: string) => form.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`);
    const choose = (value: string) => {
        radio('destination', value).checked = true;
        radio('destination', value).dispatchEvent(new window.Event('change', {bubbles: true}));
    };
    const type = (name: string, value: string) => {
        field(name).value = value;
        field(name).dispatchEvent(new window.Event('input'));
    };
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const next = async () => {submit.click(); await setImmediate();};
    return {window, form, calls, requests, closed, field, radio, choose, type, submit, next};
}

test('the default in-memory project calls create, as Create New Project always did', async t => {
    const dialog = fixture(t, {browserFolders: true, deviceFolders: true});
    assert.equal(dialog.radio('destination', 'memory').checked, true);
    assert.equal(dialog.radio('sb3-format', 'standard'), null);
    assert.equal(dialog.field('title').closest('label').hidden, true);
    assert.equal(dialog.submit.textContent, 'Create');
    await dialog.next();
    assert.deepEqual(dialog.calls, ['create']);
    assert.deepEqual(dialog.requests, []);
    assert.deepEqual(dialog.closed, ['created']);
    assert.equal(projectFileDialogTitle('new', 'en'), 'Create New Project');
    assert.equal(projectFileDialogTitle('save-as', 'ja'), 'プロジェクトのコピーを保存');
});

test('without create, the in-memory project goes to createIn', async t => {
    const dialog = fixture(t, {create: undefined});
    await dialog.next();
    assert.deepEqual(dialog.requests, [{destination: 'memory'}]);
    assert.deepEqual(dialog.closed, ['created']);
});

test('the optional format control applies only to in-memory SB3 creation', async t => {
    const dialog = fixture(t, {offerSb3Formats: true, browserFolders: true}, 'ja');
    const standard = dialog.radio('sb3-format', 'standard');
    const plus = dialog.radio('sb3-format', 'plus');
    assert.equal(standard.checked, true);
    assert.equal(standard.closest('fieldset').hidden, false);
    dialog.choose('browser');
    assert.equal(standard.closest('fieldset').hidden, true);
    dialog.choose('memory');
    plus.checked = true;
    await dialog.next();
    assert.deepEqual(dialog.calls, []);
    assert.deepEqual(dialog.requests, [{destination: 'memory', format: 'plus'}]);
    assert.deepEqual(dialog.closed, ['created']);
});

test('only the destinations the host offers are listed, with Japanese labels', t => {
    const plain = fixture(t, {}, 'ja');
    assert.deepEqual([...plain.form.querySelectorAll<HTMLInputElement>('input[name="destination"]')].map(input =>
        [input.value, input.closest('label').textContent]), [['memory', 'メモリ上の SB3']]);
    const all = fixture(t, {browserFolders: true, deviceFolders: true,
        github: {async connectForCreation() {return account;}}}, 'ja');
    assert.deepEqual([...all.form.querySelectorAll<HTMLInputElement>('input[name="destination"]')].map(input =>
        [input.value, input.closest('label').textContent]), [
        ['memory', 'メモリ上の SB3'],
        ['browser', 'ブラウザー内のプロジェクトフォルダ'],
        ['device', '手元のプロジェクトフォルダ'],
        ['github', 'Git のリモートリポジトリ']
    ]);
});

test('a folder in the browser takes the title, prefilled with the default title, as its save name', async t => {
    const dialog = fixture(t, {browserFolders: true, defaultTitle: 'Scratch Project'});
    dialog.choose('browser');
    assert.equal(dialog.field('title').closest('label').hidden, false);
    assert.equal(dialog.field('title').value, 'Scratch Project');
    // "Scratch Project" has a space, so a save name is asked for, starting from the suggestion.
    assert.equal(dialog.field('save-name').value, 'scratch-project');
    assert.equal(dialog.field('save-name').closest('div').hidden, false);
    dialog.type('title', 'Cat');
    assert.equal(dialog.field('save-name').closest('div').hidden, true);
    await dialog.next();
    assert.deepEqual(dialog.requests, [{destination: 'browser', title: 'Cat', saveName: 'Cat'}]);
    assert.deepEqual(dialog.closed, ['created']);
});

test('a title that cannot be a folder name asks for a save name inline and rejects an invalid one', async t => {
    const dialog = fixture(t, {deviceFolders: true}, 'ja');
    dialog.choose('device');
    dialog.type('title', '猫の冒険');
    const block = dialog.field('save-name').closest('label').parentElement;
    assert.equal(block.hidden, false);
    assert.match(block.textContent, /半角英数字、- _ \. （100 文字まで。\. や \.\. と、末尾の \.git は使えません）/);
    assert.equal(dialog.field('save-name').value, '');
    await dialog.next();
    assert.deepEqual(dialog.requests, []);
    assert.equal(dialog.field('save-name').getAttribute('aria-invalid'), 'true');
    dialog.type('save-name', 'neko..git');
    assert.equal(dialog.field('save-name').getAttribute('aria-invalid'), 'true');
    dialog.type('save-name', 'neko');
    assert.equal(dialog.field('save-name').getAttribute('aria-invalid'), 'false');
    assert.equal(dialog.submit.textContent, 'フォルダを選んで作成…');
    await dialog.next();
    assert.deepEqual(dialog.requests, [{destination: 'device', title: '猫の冒険', saveName: 'neko'}]);
});

test('without device folders the device destination is disabled with the reason', t => {
    const dialog = fixture(t, {deviceFolders: false, browserFolders: true}, 'ja');
    const device = dialog.radio('destination', 'device');
    assert.equal(device.disabled, true);
    const reason = dialog.form.querySelector(`#${device.getAttribute('aria-describedby')}`);
    assert.equal(reason.textContent,
        'このブラウザーでは端末のフォルダを開けません。Chrome か Edge を使うか、ブラウザーに保存したフォルダを開いてください。');
    assert.equal(device.closest('label').title, reason.textContent);
    const english = fixture(t, {deviceFolders: false});
    assert.match(english.form.textContent,
        /This browser cannot open folders on your device\. Use Chrome or Edge, or open a folder saved in this browser\./);
});

test('a cancelled or failed creation keeps the dialog open with the message', async t => {
    let answer: () => Promise<NewProjectResult> = async () => 'cancelled';
    const dialog = fixture(t, {browserFolders: true}, 'en', () => answer());
    dialog.choose('browser');
    dialog.type('title', 'cat');
    await dialog.next();
    assert.equal(dialog.requests.length, 1);
    assert.deepEqual(dialog.closed, []);
    answer = async () => {throw new Error('The browser storage is full.');};
    await dialog.next();
    assert.deepEqual(dialog.closed, []);
    assert.equal(dialog.form.querySelector('form > [role="alert"]').textContent, 'The browser storage is full.');
    assert.equal(dialog.submit.disabled, false);
});

test('a GitHub repository is connected, reviewed and requested with its working copy', async t => {
    let connections = 0;
    const dialog = fixture(t, {browserFolders: true, deviceFolders: false, defaultTitle: 'Cat Adventure',
        github: {async connectForCreation() {connections++; return account;}, licenses: [{id: 'MIT', label: 'MIT'}]}});
    dialog.choose('github');
    // The repository name is the save name; the device working copy is unavailable, so the browser is chosen.
    assert.equal(dialog.field('github-name').value, 'cat-adventure');
    assert.equal(dialog.radio('working-copy', 'device').disabled, true);
    assert.equal(dialog.radio('working-copy', 'browser').checked, true);
    assert.equal(dialog.submit.textContent, 'Connect to GitHub…');
    await dialog.next();
    assert.equal(connections, 1);
    assert.equal(dialog.submit.textContent, 'Review Repository');
    dialog.field('github-description').value = 'A cat';
    dialog.field('github-topics').value = 'scratch';
    dialog.field('github-license').value = 'MIT';
    await dialog.next();
    assert.equal(dialog.submit.textContent, 'Create Repository');
    assert.match(dialog.form.querySelector('dl').textContent, /https:\/\/github\.com\/octocat\/cat-adventure/);
    assert.deepEqual(dialog.requests, []);
    await dialog.next();
    assert.deepEqual(dialog.requests, [{destination: 'github', title: 'Cat Adventure', saveName: 'cat-adventure',
        workingCopy: 'browser', draft: {account: 'octocat', owner: 'octocat', name: 'cat-adventure', title: 'Cat Adventure',
            description: 'A cat', topics: ['scratch'], license: 'MIT', visibility: 'private'}}]);
    assert.deepEqual(dialog.closed, ['created']);
});

test('a repository name the person typed is kept when the title changes', async t => {
    const dialog = fixture(t, {deviceFolders: true, github: {async connectForCreation() {return account;}}});
    dialog.choose('github');
    assert.equal(dialog.radio('working-copy', 'device').checked, true);
    dialog.type('title', 'Dog');
    assert.equal(dialog.field('github-name').value, 'Dog');
    dialog.type('github-name', 'my-dog');
    dialog.type('title', 'Bird');
    assert.equal(dialog.field('github-name').value, 'my-dog');
    await dialog.next();
    await dialog.next();
    await dialog.next();
    assert.deepEqual(dialog.requests.map(request => request.destination === 'github' &&
        [request.saveName, request.workingCopy, request.title]), [['my-dog', 'device', 'Bird']]);
});
