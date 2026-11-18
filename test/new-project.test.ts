import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {GitHubRepositoryDraft, RepositoryCreationProgress} from '@kubohiroya/turbowarp-plus-editor-git/project-repository-creation';
import {createNewProjectHandler, type NewProjectHost, type NewProjectRepositoryCreation} from '../dist/new-project.js';

const deviceFolder = {kind: 'directory', name: 'picked'} as unknown as FileSystemDirectoryHandle;
const draft: GitHubRepositoryDraft = {owner: 'octocat', name: 'cat-story', description: '', visibility: 'private', topics: []} as
    unknown as GitHubRepositoryDraft;
const progress = (phase: RepositoryCreationProgress['phase'], name = 'cat-story'): RepositoryCreationProgress => ({
    operationId: 'op', mode: 'cloudflare', account: 'octocat', owner: 'octocat', name, visibility: 'private', phase
});

function host(log: string[], overrides: Partial<NewProjectHost> = {}): NewProjectHost {
    return {
        locale: 'en',
        create: () => log.push('create'),
        async openDefaultProject() {log.push('default'); return true;},
        nameProject: (title, saveName) => log.push(`name:${title}:${saveName}`),
        async pickDeviceFolder() {log.push('pick'); return deviceFolder;},
        async createFolder(destination, title) {
            log.push(`folder:${destination === 'browser' ? 'browser' : (destination as {name: string}).name}:${title}`);
            return true;
        },
        notify: text => log.push(`notify:${text}`),
        ...overrides
    };
}

function repository(log: string[], phases: RepositoryCreationProgress['phase'][], overrides: Partial<NewProjectRepositoryCreation> = {}):
    NewProjectRepositoryCreation {
    return {
        async connect() {return null;},
        licenses: [{id: 'MIT', label: 'MIT'}],
        async list() {return [];},
        async start(_draft, serialize, current, _signal, target) {
            log.push(`start:${target === 'browser' ? 'browser' : 'device'}:${current()}`);
            log.push(`serialized:${(await serialize()).length}`);
            return progress('create');
        },
        async advance(current, interaction) {
            log.push(`advance:${current.phase}`);
            if (current.phase === 'create') interaction.deviceCode({userCode: 'ABCD', verificationUri: 'https://github.com/login/device', expiresAt: 0});
            return {progress: progress(phases.shift() ?? 'open')};
        },
        async open(current) {log.push(`open:${current.phase}`); return true;},
        ...overrides
    };
}

const signal = () => new AbortController().signal;

test('the in-memory project is the GUI\'s own create', async () => {
    const log: string[] = [];
    assert.equal(await createNewProjectHandler(host(log)).createIn({destination: 'memory'}, signal()), 'created');
    assert.deepEqual(log, ['create']);
});

test('a browser folder starts from the named default project', async () => {
    const log: string[] = [];
    const {createIn} = createNewProjectHandler(host(log));
    assert.equal(await createIn({destination: 'browser', title: '猫の冒険', saveName: 'neko'}, signal()), 'created');
    assert.deepEqual(log, ['default', 'name:猫の冒険:neko', 'folder:browser:猫の冒険']);
});

test('a device folder is picked before the default project replaces the open one', async () => {
    const log: string[] = [];
    const {createIn} = createNewProjectHandler(host(log));
    assert.equal(await createIn({destination: 'device', title: 'Cat', saveName: 'cat'}, signal()), 'created');
    assert.deepEqual(log, ['pick', 'default', 'name:Cat:cat', 'folder:picked:Cat']);
});

test('a cancelled picker, a kept project or a folder that was not made cancels', async () => {
    let log: string[] = [];
    const request = {destination: 'device', title: 'Cat', saveName: 'cat'} as const;
    assert.equal(await createNewProjectHandler(host(log, {async pickDeviceFolder() {log.push('pick'); return null;}}))
        .createIn(request, signal()), 'cancelled');
    assert.deepEqual(log, ['pick']);
    log = [];
    assert.equal(await createNewProjectHandler(host(log, {pickDeviceFolder: undefined})).createIn(request, signal()), 'cancelled');
    assert.deepEqual(log, []);
    log = [];
    assert.equal(await createNewProjectHandler(host(log, {async openDefaultProject() {log.push('default'); return false;}}))
        .createIn({...request, destination: 'browser'}, signal()), 'cancelled');
    assert.deepEqual(log, ['default']);
    log = [];
    assert.equal(await createNewProjectHandler(host(log, {async createFolder() {return false;}}))
        .createIn({...request, destination: 'browser'}, signal()), 'cancelled');
});

test('a GitHub repository is created, pushed and opened, with the device folder picked first', async () => {
    const log: string[] = [];
    const repositoryCreation = repository(log, ['prepare', 'push', 'open']);
    const {createIn, newProject} = createNewProjectHandler(host(log, {
        repositoryCreation, markSaved: () => log.push('saved'),
        serialize: async title => new TextEncoder().encode(title),
        trackProject: () => () => true
    }));
    assert.equal(newProject.github.licenses, repositoryCreation.licenses);
    assert.equal(await createIn({destination: 'github', title: 'Cat', saveName: 'cat-story', draft, workingCopy: 'device'}, signal()),
        'created');
    assert.deepEqual(log, ['pick', 'default', 'name:Cat:cat-story', 'start:device:true', 'serialized:3',
        'advance:create', 'notify:Authorize on GitHub: https://github.com/login/device (code ABCD)',
        'advance:prepare', 'advance:push', 'saved', 'open:open']);
});

test('pressing Create again resumes a stopped setup without a new default project', async () => {
    const log: string[] = [];
    const repositoryCreation = repository(log, ['open'], {async list() {return [progress('push', 'Cat-Story')];}});
    const {createIn} = createNewProjectHandler(host(log, {repositoryCreation, markSaved: () => log.push('saved'),
        serialize: async () => new Uint8Array()}));
    assert.equal(await createIn({destination: 'github', title: 'Cat', saveName: 'cat-story', draft, workingCopy: 'browser'}, signal()),
        'created');
    assert.deepEqual(log, ['advance:push', 'open:open']);
});

test('GitHub failures become messages, a falsy start cancels and any other start result goes on to advance', async () => {
    const log: string[] = [];
    const request = {destination: 'github', title: 'Cat', saveName: 'cat-story', draft, workingCopy: 'browser'} as const;
    const failing = (code: string, locale = 'en') => createNewProjectHandler(host(log, {locale, serialize: async () => new Uint8Array(),
        repositoryCreation: repository(log, [], {async start() {throw Object.assign(new Error(code), {code});}})})).createIn(request, signal());
    await assert.rejects(failing('popupBlocked'), {message: 'Could not open the GitHub authorization window. ' +
        'Allow pop-ups and press "Create Repository" again.'});
    await assert.rejects(failing('nameConflict', 'ja'), {message: '同じ名前のリポジトリがすでにあります。'});
    await assert.rejects(failing('network'), {message: 'Could not finish creating the repository. ' +
        'Press "Create Repository" again to continue where it stopped.'});
    const stuck = createNewProjectHandler(host(log, {serialize: async () => new Uint8Array(), repositoryCreation: repository(log, [], {
        async advance() {return {progress: progress('unknown')};}
    })}));
    await assert.rejects(stuck.createIn(request, signal()), {message: /Could not finish creating the repository/});
    const cancelled = createNewProjectHandler(host(log, {serialize: async () => new Uint8Array(),
        repositoryCreation: repository(log, [], {async start() {return null;}})}));
    assert.equal(await cancelled.createIn(request, signal()), 'cancelled');
    const truthy: string[] = [];
    const passedOn = createNewProjectHandler(host(truthy, {serialize: async () => new Uint8Array(),
        markSaved: () => truthy.push('saved'),
        repositoryCreation: repository(truthy, ['open'], {async start() {return true;}})}));
    assert.equal(await passedOn.createIn(request, signal()), 'created');
    assert.deepEqual(truthy, ['default', 'name:Cat:cat-story', 'advance:undefined', 'saved', 'open:open']);
    const controller = new AbortController();
    let current: () => boolean;
    const aborted = createNewProjectHandler(host(log, {serialize: async () => new Uint8Array(),
        repositoryCreation: repository(log, [], {async start(_draft, _serialize, check) {
            current = check;
            controller.abort();
            return false;
        }})}));
    assert.equal(await aborted.createIn(request, controller.signal), 'cancelled');
    assert.equal(current(), false);
    assert.equal(await createNewProjectHandler(host(log)).createIn(request, signal()), 'cancelled');
});

test('the dialog choices come from the host', () => {
    const {newProject} = createNewProjectHandler(host([], {defaultTitle: 'Project', browserFolders: true, deviceFolders: false}));
    assert.deepEqual(newProject, {defaultTitle: 'Project', browserFolders: true, deviceFolders: false, github: undefined});
});
