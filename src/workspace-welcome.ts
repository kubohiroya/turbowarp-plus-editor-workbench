// SPDX-License-Identifier: MPL-2.0

/** Branding supplied by the Editor build, independently of the Workbench package version. */
export interface WorkspaceWelcomeBrand {
    logo: string;
    version: string;
}

interface WelcomeProject {
    editingTarget?: {id: string; isStage: boolean};
    on(event: 'targetsUpdate', listener: () => void): void;
    removeListener(event: 'targetsUpdate', listener: () => void): void;
}

export function createWorkspaceWelcome(document: Document, options: {
    vm: WelcomeProject;
    locale: string;
    brand?: WorkspaceWelcomeBrand;
    reopenLabel?: string;
    select(id: string): void;
}) {
    const japanese = /^ja(?:-|$)/i.test(options.locale);
    const element = document.createElement('section');
    element.className = 'tw-plus-workspace-welcome';
    const group = document.createElement('div');
    group.className = 'tw-plus-workspace-welcome__group';
    element.append(group);

    if (options.brand) {
        const title = 'TurboWarp-Plus-Editor';
        element.setAttribute('aria-label', title);
        const logo = document.createElement('img');
        logo.className = 'tw-plus-workspace-welcome__logo';
        logo.src = options.brand.logo;
        logo.alt = '';
        logo.draggable = false;
        const heading = document.createElement('h1');
        heading.textContent = title;
        const version = document.createElement('p');
        version.textContent = `Version ${options.brand.version}`;
        const copyright = document.createElement('p');
        copyright.textContent = '© 2026 Hiroya Kubo';
        const license = document.createElement('p');
        license.append(japanese ? 'ライセンス: ' : 'License: ');
        const link = (text: string, href: string) => {
            const anchor = document.createElement('a');
            anchor.textContent = text;
            anchor.href = href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            return anchor;
        };
        const source = 'https://github.com/kubohiroya/turbowarp-plus-editor/blob/main/';
        license.append(link('GPL-3.0-or-later', source + 'LICENSE'), ' / ',
            link('MPL-2.0', source + 'LICENSE.MPL-2.0'));
        const website = 'https://kubohiroya.github.io/turbowarp-plus-editor/';
        group.append(logo, heading, version, copyright, license, link(website, website));
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tw-plus-workspace-welcome__open';
    const update = () => {
        button.textContent = options.vm.editingTarget?.isStage ?
            japanese ? 'ステージを開く' : 'Open stage' :
            options.reopenLabel ?? (japanese ? 'スプライトを開く' : 'Open sprite');
        button.disabled = !options.vm.editingTarget;
    };
    const open = () => {
        if (options.vm.editingTarget) options.select(options.vm.editingTarget.id);
    };
    update();
    options.vm.on('targetsUpdate', update);
    button.addEventListener('click', open);
    group.append(button);
    return {
        element,
        init() {},
        dispose() {
            options.vm.removeListener('targetsUpdate', update);
            button.removeEventListener('click', open);
        }
    };
}
