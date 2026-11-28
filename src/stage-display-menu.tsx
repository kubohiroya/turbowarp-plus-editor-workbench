// SPDX-License-Identifier: MPL-2.0
import React from 'react';
import {createPortal} from 'react-dom';
import {IconMenuButton, type IconMenuItem} from '@kubohiroya/turbowarp-plus-editor-windows';
import {panelLayoutIconPath} from './index.ts';
import {stageDockActionLabel, stageDrawerPinItem, stagePresentationItems,
    useStageDocumentFullscreen} from './stage-surface.ts';

export function createStageDisplayMenu({WindowLayoutContext, StageDisplayMenuContext, layoutFlags, styles,
    workbenchStyles, fullscreenIcon, exitFullscreenIcon, connectFullscreen, fullscreenMount, menuItems}: {
    WindowLayoutContext: React.Context<any>; StageDisplayMenuContext: React.Context<any>;
    layoutFlags: {stageDisplayMenu: boolean}; styles: Record<string, string>; workbenchStyles: Record<string, string>;
    fullscreenIcon: string; exitFullscreenIcon: string;
    connectFullscreen(component: React.ComponentType<any>): React.ComponentType<any>;
    fullscreenMount(header: HTMLElement): HTMLElement | null;
    /**
     * Items another package adds to the menu, such as one that opens its own view. They follow the menu's own
     * items after a separator, in the editor only: not in a separate window or in full screen.
     */
    menuItems?(locale: string): IconMenuItem[];
}) {
    const stageLayoutIcon = (
        <svg viewBox="-4 -4 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={panelLayoutIconPath} />
        </svg>
    );

    function PresetIcon({icon}) {
        return <img className={styles.directional} src={typeof icon === 'function' ? icon() : icon} alt="" draggable={false} />;
    }

    const isJapanese = locale => /^ja(?:-|$)/i.test(locale);
    const menuLabel = locale => isJapanese(locale) ? '実行画面の表示' : 'Run view display';

    function fullscreenItem(locale: string, active: boolean, onSelect: () => void, disabled = false): IconMenuItem {
        const label = active ? (isJapanese(locale) ? '全画面表示を終了' : 'Exit full screen mode') :
            (isJapanese(locale) ? '全画面表示にする' : 'Enter full screen mode');
        return {id: 'fullscreen', label, icon: <PresetIcon icon={active ? exitFullscreenIcon : fullscreenIcon} />,
            onSelect, disabled};
    }

    function dockIcon(returning: boolean) {
        return <svg className={styles.directional} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4H3v9h9v-3" />
            <path d={returning ? 'M12.5 3.5 7 9m0-4v4h4' : 'M8 3h5v5m0-5L7 9'} />
        </svg>;
    }

    const withMenuItems = (locale: string, items: IconMenuItem[]): IconMenuItem[] => {
        const added = menuItems?.(locale) ?? [];
        return added.length ? [...items, {...added[0], separatorBefore: true}, ...added.slice(1)] : items;
    };

    function StageLayoutMenu({locale, items, className = ''}: {locale: string; items: IconMenuItem[]; className?: string}) {
        return <IconMenuButton label={menuLabel(locale)} icon={stageLayoutIcon} items={items}
            className={`${styles.stageDisplayMenu} ${workbenchStyles.stagePresentationMenu} ${className}`} />;
    }

    const EditorStageFullscreenMenu = connectFullscreen(function EditorStageFullscreenMenu({header, locale, onExit}: {
        header: HTMLElement; locale: string; onExit(): void;
    }) {
        // Use the GUI's existing fullscreen controls row, including its alignment and stacking.
        const mount = fullscreenMount(header);
        React.useLayoutEffect(() => {
            if (!mount) return;
            mount.setAttribute('data-plus-fullscreen-menu', '');
            return () => mount.removeAttribute('data-plus-fullscreen-menu');
        }, [mount]);
        return mount ? createPortal(
            <StageLayoutMenu locale={locale} items={[fullscreenItem(locale, true, onExit)]} />, mount
        ) : null;
    });

    function DisplayMenu({locale, presets, fullscreen}) {
        const {dockAction, stage, launcher, openDrawer, closeDrawer} = React.useContext(StageDisplayMenuContext) ?? {};
        const {plusLayout, stageDrawer, stageDrawerPinned, setStageDrawerPinned, stageHidden, setStageVisible} =
            React.useContext(WindowLayoutContext);
        const japanese = isJapanese(locale);
        const canToggleVisibility = plusLayout && (!dockAction || dockAction.kind === 'docked');
        const visibilityLabel = stageHidden ? (japanese ? '実行画面を表示' : 'Show run view') :
            (japanese ? '実行画面を隠す' : 'Hide run view');
        const detached = dockAction?.kind === 'external';
        const popupDocument = detached ? dockAction.mount?.ownerDocument : undefined;
        const popupFullscreen = useStageDocumentFullscreen(popupDocument);
        if (popupDocument) {
            const toggleFullscreen = () => {
                const operation = popupFullscreen ? popupDocument.exitFullscreen() :
                    popupDocument.documentElement.requestFullscreen();
                void operation.catch(() => {});
            };
            return <StageLayoutMenu locale={locale} items={[
                fullscreenItem(locale, popupFullscreen, toggleFullscreen, !popupFullscreen && !popupDocument.fullscreenEnabled),
                {id: 'dock', label: japanese ? 'エディターに戻る' : 'Return to the editor',
                    icon: dockIcon(true), separatorBefore: true, onSelect: dockAction.dock}
            ]} />;
        }
        const dockLabel = stageDockActionLabel(locale, {drawer: stageDrawer, detached, external: dockAction?.external});

        const selectDisplay = action => {
            if (stageHidden) setStageVisible(true);
            if (detached) dockAction.dock();
            action();
        };
        // Scratch GUI passes small first and full last, with an optional fixed-width preset between them.
        const items: IconMenuItem[] = presets.slice(1, -1).map(({title, isSelected, handleClick, icon}) => ({
            id: title,
            label: title,
            checked: isSelected,
            icon: <PresetIcon icon={icon} />,
            onSelect: () => selectDisplay(handleClick)
        }));
        const enterFullscreen = fullscreenItem(locale, false, () => {
            // Dockview flushes the drawer state when the fullscreen view unmounts it.
            stage?.resetDrawerPresentation();
            selectDisplay(fullscreen.handleClick);
        });
        const openWindow = () => {
            if (stageHidden) setStageVisible(true);
            if (stage?.docked) stage.commands.close();
            dockAction.undock();
        };
        const drawerPin = stageDrawer && !detached && !stage?.docked ?
            stageDrawerPinItem(locale, stageDrawerPinned, setStageDrawerPinned) : undefined;
        if (launcher && stageDrawer && !detached) {
            const inTab = Boolean(stage?.docked);
            const placement = stagePresentationItems(locale, inTab ? 'tab' : null, {
                window: dockAction?.external && dockAction.kind === 'docked' ? openWindow : undefined,
                tab: !inTab && stage?.commands ? stage.commands.open : undefined,
                drawer: inTab ? () => {
                    stage.commands.close();
                    // The drawer becomes available after the stage tab has been removed.
                    requestAnimationFrame(() => openDrawer?.current?.());
                } : undefined
            }).map(item => drawerPin && item.id === 'drawer' ? drawerPin : item);
            const close: IconMenuItem = {
                id: 'close-placement',
                label: inTab ? (japanese ? 'タブを閉じる' : 'Close the tab') :
                    (japanese ? '引出しを閉じる' : 'Close the drawer'),
                icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
                    strokeLinecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>,
                onSelect: inTab ? stage.commands.close : () => closeDrawer?.current?.()
            };
            return <StageLayoutMenu locale={locale} items={withMenuItems(locale, [
                ...placement, {...enterFullscreen, separatorBefore: true}, ...items, close
            ])} />;
        }
        if (drawerPin) items.push(drawerPin);
        items.push(japanese ? enterFullscreen : {...enterFullscreen, label: fullscreen.title});
        if (canToggleVisibility) items.push({
            id: 'visibility',
            label: visibilityLabel,
            onSelect: () => {
                if (!stageHidden && !stage?.docked && closeDrawer?.current) {
                    closeDrawer.current();
                    return;
                }
                if (stage?.docked) stage.commands.close();
                setStageVisible(stageHidden);
            }
        });
        if (stage?.commands && dockAction?.kind === 'docked') items.push({
            id: 'workspace',
            label: stage.docked ? stage.closeLabel : stage.openLabel,
            onSelect: () => {
                if (stage.docked) stage.commands.close();
                else {
                    if (stageHidden) setStageVisible(true);
                    stage.commands.open();
                }
            }
        });
        items.push({
            id: 'dock',
            label: dockLabel,
            disabled: !dockAction || dockAction.kind === 'opening',
            separatorBefore: true,
            icon: dockIcon(detached),
            onSelect: detached ? () => {
                if (stageHidden) setStageVisible(true);
                dockAction.dock();
            } : openWindow
        });
        return <StageLayoutMenu locale={locale} items={withMenuItems(locale, items)}
            className={stageHidden ? styles.visibleWhenStageHidden : undefined} />;
    }

    const StageDisplayMenu = layoutFlags.stageDisplayMenu ? DisplayMenu : undefined;

    return {EditorStageFullscreenMenu, StageDisplayMenu};
}
