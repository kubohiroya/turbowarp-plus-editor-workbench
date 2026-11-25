// SPDX-License-Identifier: GPL-3.0-or-later
// Assertions from turbowarp-plus-editor/test/editor-layout.browser.ts at 8f53044.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {expect, type Locator} from '@playwright/test';
import {openExample, origin, example} from './layout-browser-host.ts';

test('standalone divider grips follow their axes and host accent changes', {timeout: 30_000}, async t => {
    const page = await openExample(t);
    await page.goto(origin + example);
    const columns = page.getByRole('separator', {name: 'Editor width'});
    const rows = page.getByRole('separator', {name: 'Stage height'});
    const grip = (divider: Locator) => divider.evaluate(element => {
        const style = getComputedStyle(element, '::after');
        return {width: style.width, height: style.height, image: style.backgroundImage};
    });
    const columnGrip = await grip(columns);
    const rowGrip = await grip(rows);
    assert.deepEqual([columnGrip.width, columnGrip.height, rowGrip.width, rowGrip.height],
        ['4px', '18px', '18px', '4px']);
    assert.match(columnGrip.image, /radial-gradient/);
    assert.match(rowGrip.image, /radial-gradient/);
    const themeColor = (property: string) => page.evaluate(token => {
        const sample = document.createElement('span');
        sample.style.color = `var(${token})`;
        document.body.append(sample);
        const color = getComputedStyle(sample).color;
        sample.remove();
        return color;
    }, property);
    const checkDividerColor = async () => {
        await columns.hover();
        await expect(columns).toHaveCSS('background-color', await themeColor('--looks-secondary'));
    };
    const setAccent = (value: string) => page.evaluate(color =>
        document.documentElement.style.setProperty('--looks-secondary', color), value);
    await setAccent('#9966ff');
    const originalAccent = await themeColor('--looks-secondary');
    await checkDividerColor();
    await setAccent('#2563eb');
    assert.notEqual(await themeColor('--looks-secondary'), originalAccent);
    await checkDividerColor();
});

test('standalone divider keyboard steps respect bounds and reset both axes', {timeout: 30_000}, async t => {
    const page = await openExample(t);
    await page.goto(origin + example + '?stageHeight=240');
    const columns = page.getByRole('separator', {name: 'Editor width'});
    const rows = page.getByRole('separator', {name: 'Stage height'});
    const position = (divider: Locator) => divider.getAttribute('aria-valuenow').then(Number);
    const moved = await position(columns);
    const initialRows = await position(rows);
    await columns.press('ArrowLeft');
    assert.equal(await position(columns), moved - 16);
    await rows.press('Home');
    assert.equal(await position(rows), Number(await rows.getAttribute('aria-valuemin')));
    await rows.press('Enter');
    assert.ok(await position(rows) > Number(await rows.getAttribute('aria-valuemin')));
    for (const [divider, initial] of [[columns, moved], [rows, initialRows]] as const) {
        await divider.press('Home');
        assert.equal(await position(divider), Number(await divider.getAttribute('aria-valuemin')));
        await divider.press('End');
        assert.equal(await position(divider), Number(await divider.getAttribute('aria-valuemax')));
        await divider.press('Enter');
        assert.equal(await position(divider), initial);
    }
});
