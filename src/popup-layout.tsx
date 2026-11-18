// SPDX-License-Identifier: MPL-2.0
import React from 'react';
import {IconMenuButton} from '@kubohiroya/turbowarp-plus-editor-windows';

export type PopupWindowMode = 'normal' | 'minimized' | 'maximized';
export type PopupWindowAction = 'maximize' | 'minimize' | 'restore';
export interface PopupWindowControls {
    onMode(listener: (mode: PopupWindowMode) => void): () => void;
    mode(): Promise<PopupWindowMode>;
    change(action: PopupWindowAction): Promise<PopupWindowMode>;
}
export interface PopupLayoutProps {
        window: Window;
        locale: string;
        onDock(): void;
        onDuplicate?(): void;
    }

export function createPopupLayout({styles, getWindowControls}: {
    styles: Record<string, string>; getWindowControls(window: Window): PopupWindowControls | undefined;
}) {


    const labels = {
        ja: {
            title: 'レイアウト変更',
            undock: '別窓で開く（アンドック）',
            dock: '元の画面に戻す（ドックする）',
            duplicate: 'この編集画面をもう一枚開く（別のビューを開く）',
            maximize: 'この画面を最大化する',
            minimize: 'この画面を最小化する',
            restore: '通常のウィンドウに戻す'
        },
        en: {
            title: 'Window layout',
            undock: 'Open in a separate window (undock)',
            dock: 'Return to the editor (dock)',
            duplicate: 'Open another view of this editor',
            maximize: 'Maximize this window',
            minimize: 'Minimize this window',
            restore: 'Restore normal window'
        }
    };

    const layoutIcon = (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M2 6h12M7 6v7" />
        </svg>
    );

    function PopupLayout({window, locale, onDock, onDuplicate}: PopupLayoutProps) {
        const [mode, setMode] = React.useState<PopupWindowMode>('normal');
        const controls = getWindowControls(window);
        React.useEffect(() => {
            if (!controls) return;
            let mounted = true;
            const unsubscribe = controls.onMode(next => {if (mounted) setMode(next);});
            void controls.mode().then(next => {if (mounted) setMode(next);}, () => {});
            return () => {
                mounted = false;
                unsubscribe();
            };
        }, [controls]);
        const change = (action: PopupWindowAction) => controls ? () => {
            void controls.change(action).then(setMode, () => {});
        } : undefined;
        const text = /^ja(?:-|$)/i.test(locale) ? labels.ja : labels.en;
        const items = [
            {id: 'undock', current: true},
            {id: 'dock', onSelect: onDock},
            {id: 'duplicate', onSelect: onDuplicate},
            {id: 'maximize', current: mode === 'maximized', onSelect: change('maximize')},
            {id: 'minimize', current: mode === 'minimized', onSelect: change('minimize')},
            {id: 'restore', current: mode === 'normal', onSelect: change('restore')}
        ].map(item => ({...item, label: text[item.id], disabled: item.current || !item.onSelect}));
        return <IconMenuButton label={text.title} icon={layoutIcon} items={items} className={styles.root} />;
    }

    return {PopupLayout};
}
