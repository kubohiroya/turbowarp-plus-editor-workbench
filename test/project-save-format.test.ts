// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import JSZip from '@turbowarp/jszip';
import {applyProjectFormatToArchive} from '../dist/project-tools/save-format.js';

const bytes = Buffer.from('\ufeff// 日本語\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const url = 'https://example.test/v1/test.js';
const path = 'extensions/test.js';
const spec = {id: 'testext', execution: 'unsandboxed', sha256, source: {type: 'embedded-file', path, url}};
const project = {
    extensions: ['pen', spec.id], targets: [{name: 'Stage'}],
    turboWarpPlusProject: {schemaVersion: 1, sb3Format: 'standard'},
    turboWarpPlus: {schemaVersion: 1, extensions: [spec]}
};
const makeZip = (data = project) => new JSZip()
    .file('project.json', JSON.stringify(data)).file(path, bytes).file('notes/settings.yml', 'example: true');
const readProject = async (zip: JSZip) => JSON.parse(await zip.file('project.json')!.async('string'));
const reply = (body: BodyInit, status = 200): typeof fetch => async address =>
    Object.defineProperty(new Response(body, {status}), 'url', {value: address});

test('Standard removes the manifest only after embedding the verified extension bytes', async () => {
    const archive = makeZip();
    await applyProjectFormatToArchive(archive, 'standard', {fetchImpl: () => assert.fail('embedded source contacted the network')});
    const saved = await readProject(archive);
    assert.equal(saved.turboWarpPlus, undefined);
    assert.equal(saved.extensionURLs[spec.id], 'data:text/javascript;base64,' + bytes.toString('base64'));
    assert.deepEqual(saved.extensions, project.extensions);
    assert.deepEqual(saved.targets, project.targets);
    assert.deepEqual(saved.turboWarpPlusProject, project.turboWarpPlusProject);
    assert.equal(archive.file(path), null);
    assert.equal(await archive.file('notes/settings.yml')!.async('string'), 'example: true');
});

test('Plus verifies the actual remote source and stores its URL and digest without the embedded code', async () => {
    const archive = makeZip();
    const requests: string[] = [];
    await applyProjectFormatToArchive(archive, 'plus', {fetchImpl: (address, options) => {
        requests.push(String(address));
        return reply(bytes)(address, options);
    }});
    const saved = await readProject(archive);
    assert.deepEqual(requests, [url]);
    assert.deepEqual(saved.turboWarpPlus.extensions, [{...spec, source: {type: 'remote-cacheable', url},
        capabilities: [], dependencies: []}]);
    assert.equal(saved.extensionURLs[spec.id], undefined);
    assert.equal(archive.file(path), null);
});

test('verification failures preserve the original archive and its embedded extension', async () => {
    for (const [format, fetchImpl, code] of [
        ['plus', reply('different code'), 'DIGEST_MISMATCH'],
        ['plus', reply('missing', 404), 'FETCH_FAILED'],
        ['standard', reply('different code'), 'DIGEST_MISMATCH']
    ] as const) {
        const archive = makeZip();
        if (format === 'standard') archive.file(path, 'damaged retained copy');
        const before = await archive.file(path)!.async('string');
        await assert.rejects(applyProjectFormatToArchive(archive, format, {fetchImpl}), {code});
        assert.deepEqual(await readProject(archive), project);
        assert.equal(await archive.file(path)!.async('string'), before);
    }
    const withoutURL = {...project, turboWarpPlus: {schemaVersion: 1,
        extensions: [{...spec, source: {type: 'embedded-file', path}}]}};
    const archive = makeZip(withoutURL);
    await assert.rejects(applyProjectFormatToArchive(archive, 'plus'), {code: 'SAVE_EXTENSION_URL_REQUIRED'});
    assert.deepEqual(await readProject(archive), withoutURL);
});
