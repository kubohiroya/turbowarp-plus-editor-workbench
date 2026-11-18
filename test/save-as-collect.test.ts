import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectBeforeSaving, projectSaveShortcut, saveProjectAs, type ProjectFileStorage} from '../dist/project-file-dialogs.js';

function storage(log: string[]): ProjectFileStorage {
    return {
        canSave: true,
        filename: 'Project.sb3',
        async download(_name, serialize) {log.push(`write:${serialize(() => 'data')}`);},
        async write() {throw new Error('unused');},
        finish() {log.push('finish');},
        copied(handle, title) {log.push(`copied:${handle}:${title}`);},
        fail(error) {log.push(`fail:${(error as Error).message}`);}
    };
}

test('save as collects edits held by other windows before serializing and can be retried', async () => {
    const log: string[] = [];
    let busy = true;
    const options = {
        current: () => true,
        unchanged: () => true,
        serialize: <T>(_title: string, run: () => T) => run(),
        committed: () => log.push('committed'),
        async collect() {
            log.push('collect');
            if (busy) throw new Error('window busy');
        }
    };
    assert.equal(await saveProjectAs(storage(log), 'Project', options), false);
    assert.deepEqual(log, ['collect', 'fail:window busy']);
    busy = false;
    log.length = 0;
    assert.equal(await saveProjectAs(storage(log), 'Project', options), true);
    assert.deepEqual(log, ['collect', 'write:data', 'committed', 'copied:null:Project']);
});

test('saving a copy to a picked file leaves the project on its own file, title and folder', async () => {
    const log: string[] = [];
    const handle = {name: 'Copy of Cat.sb3'} as FileSystemFileHandle;
    const gui: ProjectFileStorage = {...storage(log), pick: async filename => {log.push(`pick:${filename}`); return handle;},
        async write(target, serialize) {log.push(`write:${target.name}:${serialize(() => 'data')}`);}};
    const titles: string[] = [];
    const saved = await saveProjectAs(gui, 'Cat', {
        current: () => true,
        serialize: <T>(title: string, run: () => T) => {titles.push(title); return run();},
        committed: () => log.push('committed')
    });
    assert.equal(saved, true);
    assert.deepEqual(titles, ['Copy of Cat']);
    // Neither finish (which set the file handle and the title) nor anything that detaches the folder runs.
    assert.deepEqual(log, ['pick:Cat.sb3', 'write:Copy of Cat.sb3:data', 'committed', 'copied:[object Object]:Copy of Cat']);
    assert.ok(!log.includes('finish'));
    // A host without copied still saves the copy.
    const {copied: _unused, ...plain} = storage(log);
    log.length = 0;
    assert.equal(await saveProjectAs(plain, 'Cat', {current: () => true, serialize: (_t, run) => run(), committed() {}}), true);
    assert.deepEqual(log, ['write:data']);
});

test('overwriting and folder saves collect edits first and save nothing when collection fails', async () => {
    const log: string[] = [];
    let busy = true;
    const collect = async () => {
        log.push('collect');
        if (busy) throw new Error('window busy');
    };
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const gui = {...storage(log), overwrite: () => log.push('overwrite')};
    const folder = {open: () => log.push('open'), save: () => log.push('folder'), detach: () => log.push('detach')};
    const saves = collectBeforeSaving(gui, folder, collect);
    projectSaveShortcut(saves.storage, saves.folder);
    await settle();
    assert.deepEqual(log, ['collect', 'fail:window busy']);
    busy = false;
    log.length = 0;
    projectSaveShortcut(saves.storage, saves.folder);
    await settle();
    assert.deepEqual(log, ['collect', 'overwrite']);
    log.length = 0;
    const toFolder = collectBeforeSaving(storage(log), folder, collect);
    projectSaveShortcut(toFolder.storage, toFolder.folder);
    await settle();
    assert.deepEqual(log, ['collect', 'folder']);
    toFolder.folder.detach();
    assert.equal(log.at(-1), 'detach');
    const plain = storage(log);
    assert.equal(collectBeforeSaving(plain, undefined, collect).storage, plain);
});
