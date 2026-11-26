// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readProjectSb3Format} from '../dist/project-tools/format.js';

const valid = () => ({schemaVersion: 1, extensions: []});
const manifestWithExtension = () => ({
    schemaVersion: 1,
    extensions: [{
        id: 'example', source: {type: 'remote-cacheable', url: 'https://example.org/extension.js'},
        execution: 'sandboxed', sha256: '0'.repeat(64)
    }]
});

test('valid Plus manifest wins over data URLs in the original project', () => {
    const project = {extensions: ['example'], extensionURLs: {example: 'data:text/javascript,fixture'},
        turboWarpPlus: manifestWithExtension()};
    const bytesBefore = JSON.stringify(project);
    assert.deepEqual(readProjectSb3Format(project),
        {format: 'plus', source: 'manifest', manifest: {status: 'valid'}});
    assert.deepEqual(readProjectSb3Format({turboWarpPlus: valid()}),
        {format: 'plus', source: 'manifest', manifest: {status: 'valid'}});
    assert.equal(JSON.stringify(project), bytesBefore);
});

test('explicit project selection takes precedence but still reports a manifest diagnostic', () => {
    assert.deepEqual(readProjectSb3Format({turboWarpPlusProject: {schemaVersion: 1, sb3Format: 'standard'},
        turboWarpPlus: valid()}),
    {format: 'standard', source: 'explicit', manifest: {status: 'valid'}});
    assert.deepEqual(readProjectSb3Format({turboWarpPlusProject: {schemaVersion: 1, sb3Format: 'plus'}}),
        {format: 'plus', source: 'explicit', manifest: {status: 'absent'}});
    assert.deepEqual(readProjectSb3Format({turboWarpPlusProject: {schemaVersion: 1, sb3Format: 'standard'},
        turboWarpPlus: {schemaVersion: 99, extensions: []}}),
    {format: 'standard', source: 'explicit', manifest: {status: 'invalid', code: 'UNSUPPORTED_SCHEMA'}});
});

test('legacy Standard is a display result, not an inferred persisted choice', () => {
    const project = {extensionURLs: {example: 'data:text/javascript,fixture'}, turboWarpPlusProject: {schemaVersion: 1}};
    assert.deepEqual(readProjectSb3Format(project),
        {format: 'standard', source: 'legacy', manifest: {status: 'absent'}});
    assert.deepEqual(project.turboWarpPlusProject, {schemaVersion: 1});
    assert.deepEqual(readProjectSb3Format({turboWarpPlusProject: {schemaVersion: 2, sb3Format: 'standard'},
        turboWarpPlus: valid()}),
    {format: 'plus', source: 'manifest', manifest: {status: 'valid'}});
});

test('present but malformed or unsupported manifests are unknown, not Standard', () => {
    for (const [value, code] of [[null, 'INVALID_MANIFEST'], [{schemaVersion: 1}, 'INVALID_MANIFEST'],
        [{schemaVersion: 2, extensions: []}, 'UNSUPPORTED_SCHEMA']]) {
        const project = {turboWarpPlus: value};
        assert.deepEqual(readProjectSb3Format(project),
            {format: 'unknown', source: 'unknown', manifest: {status: 'invalid', code}});
        assert.equal(project.turboWarpPlus, value);
    }
    assert.deepEqual(readProjectSb3Format(undefined),
        {format: 'unknown', source: 'unknown', manifest: {status: 'unavailable'}});
});
