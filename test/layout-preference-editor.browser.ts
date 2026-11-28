import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, expect} from '@playwright/test';

const editor = process.env.TW_PLUS_LAYOUT_EDITOR_URL;

test('Editor switches the saved layout without losing the project, active tab, workspace or stage canvas',
    {skip: !editor, timeout: 60_000}, async t => {
        const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader']});
        t.after(() => browser.close());
        const page = await browser.newPage({viewport: {width: 1360, height: 900}});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = new URL(editor!);
        url.searchParams.set('lang', 'ja');
        url.searchParams.delete('twPlusStandardLayout');
        await page.goto(url.href);
        await page.waitForFunction(() => (window as any).vm?.editingTarget &&
            (window as any).ScratchBlocks?.getMainWorkspace());
        const menu = page.locator('.tw-info-menu summary');
        const item = page.getByRole('menuitemcheckbox', {name: '新レイアウトを有効化'});
        const layout = page.locator('[class*="standard-body"], [class*="standardBody"]');
        await expect(page.locator('.dv-tab')).toHaveCount(0);
        await menu.click();
        await expect(item).toHaveAttribute('aria-checked', 'false');
        assert.equal(await item.evaluate(node => node.parentElement.children[0] === node), true);
        await menu.press('Escape');
        await page.getByRole('tab', {name: 'コスチューム', exact: true}).click();
        const saved = await page.evaluate(() => {
            const host = window as any;
            const target = host.vm.editingTarget;
            target.blocks.createBlock({id: 'layout-choice-preserved', opcode: 'event_whenflagclicked',
                inputs: {}, fields: {}, next: null, parent: null, shadow: false, topLevel: true, x: 32, y: 48});
            target.setXY(37, 29);
            host.vm.emitWorkspaceUpdate();
            host.layoutChoiceBefore = {target, vm: host.vm, runtime: host.vm.runtime,
                workspace: host.ScratchBlocks.getMainWorkspace(), canvas: host.vm.renderer.canvas};
            return {id: target.id, targets: host.vm.runtime.targets.length};
        });
        await menu.click();
        for (const enabled of [true, false, true, false]) {
            await item.click();
            await page.getByRole('dialog').getByRole('button', {name: enabled ? '有効化する' : '無効化する', exact: true}).click();
            if (enabled) {
                await expect(layout).toBeVisible();
                await expect(page.locator('.dv-tab').first()).toBeVisible();
            } else {
                await expect(layout).toHaveCount(0);
                await expect(page.locator('.dv-tab')).toHaveCount(0);
            }
            assert.deepEqual(await page.evaluate(() => {
                const host = window as any;
                const before = host.layoutChoiceBefore;
                return {vm: host.vm === before.vm, runtime: host.vm.runtime === before.runtime,
                    workspace: host.ScratchBlocks.getMainWorkspace() === before.workspace,
                    canvas: host.vm.renderer.canvas === before.canvas, connected: before.canvas.isConnected,
                    target: host.vm.editingTarget.id, targets: host.vm.runtime.targets.length,
                    tab: host.ReduxStore.getState().scratchGui.editorTab.activeTabIndex,
                    block: Boolean(host.vm.editingTarget.blocks.getBlock('layout-choice-preserved')),
                    x: host.vm.editingTarget.x, y: host.vm.editingTarget.y};
            }), {vm: true, runtime: true, workspace: true, canvas: true, connected: true,
                target: saved.id, targets: saved.targets, tab: 1, block: true, x: 37, y: 29});
            await menu.click();
            await expect(item).toHaveAttribute('aria-checked', String(enabled));
        }
        await page.reload();
        await menu.click();
        await expect(item).toHaveAttribute('aria-checked', 'false');
        await item.click();
        await page.getByRole('dialog').getByRole('button', {name: '有効化する', exact: true}).click();
        await page.reload();
        await expect(page.locator('.dv-tab').first()).toBeVisible();
        await menu.click();
        await expect(item).toHaveAttribute('aria-checked', 'true');
        assert.deepEqual(errors, []);
    });
