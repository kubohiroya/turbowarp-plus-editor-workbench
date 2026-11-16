# TurboWarp Plus Editor Workbench

[日本語](README.ja.md)

The workbench of TurboWarp Plus Editor: the resizable layout, the Plus standard layout, the Dockview sprite tabs and workspace, the stage surface, the debugger tab and the file menu. The panes inside a sprite tab come from `@kubohiroya/turbowarp-plus-editor-sprite-panes`, the in-page windows from `@kubohiroya/turbowarp-plus-editor-windows`, and project data from `@kubohiroya/turbowarp-plus-editor-project-model`.

This package was published as `@kubohiroya/turbowarp-plus-editor-layout` up to 0.3.0.

## Resizable layout

Resize the divider between the editor and the stage column, or the divider between the stage and the target pane, within a single document. The host passes its React instance to `createLayout(React)` and connects the dividers, styles, and display dimensions provided by the `render` callback to its existing components. The host supplies a storage provider and key, and this package saves and restores the layout settings.

Drag a divider or use the arrow keys, Home, or End to move it. Press Enter or double-click to reset that divider to its default position.

## Editor layout sizing

| Divider | Minimum sizes |
| --- | --- |
| Editor / stage column | Editor 500 px, stage column 350 px |
| Stage / target pane | Stage 135 px, target pane 175 px |

Dividers are 8 px wide. Each split is constrained by the minimum size of its panes. If the available space is too small to satisfy both minimums, the editor falls back to its usual sizing. The split resumes at the saved ratio when the available space grows. The sprite properties and list stay together in the sprite selector, and the backpack remains a collapsible tray. The menu bar sits outside the split area.

Dividers are enabled by default in the Scratch layout. Selecting a stage size preset resets the split to that preset. Layout settings are stored separately from projects and SB3 files. To disable the dividers, add `twPlusSplitter=0` to the Web launch URL or start Desktop with `TW_PLUS_DESKTOP_SPLITTER=0`.

## Plus standard layout

`createStandardLayout(React, {styles, targetStyles, context})` handles layout switching via the anchor control (⚓️), stage visibility and measurement, and the two-column sprite list. Pass `editor.css` and `targets.css` as class-name maps. The host provides startup settings, storage, window controls, and the callback and mount point for the palette. Pass an optional `LayoutMenu` component to the factory to customize the layout menu. The stage keeps the same mount point while hidden.

Use `/example/?standard=1` in the test host to try the Plus layout. Use `standard=0` to try the startup fallback to the Scratch layout.

The Editor pins this package from npm.

## Left drawer views

In the Plus standard layout, the left drawer shows the sprite list and backdrop. A host can add more contents by passing `drawerViews` to `StandardLayout`:

```js
<StandardLayout {...props} storage={localStorage} storageKey="twPlusEditorLayout" drawerViews={{
    views: [
        {id: 'project', render: ({locale}) => <ProjectExplorer locale={locale} />, tools: ({locale}) => <ExplorerTools />},
        {id: 'git-history', label: 'Git history', icon: <HistoryIcon />, render: () => <GitHistory />}
    ],
    agents: {renderMenu: ({locale, close}) => <div role="menu">…</div>}
}} />
```

- The top of the drawer then shows one row of icon-only buttons (it wraps only when the drawer is too narrow) (`role="toolbar"`, "ドロワーの表示" / "Drawer views"): 1 Sprites, 2 Project folder, 3 Git history and 4 AI agents. Each has `aria-label` and `title` in Japanese or English. A button is shown only for what the host supplies; the sprite list is always first.
- Buttons 1–3 switch the content and mark the selected one with `aria-pressed`. Arrow keys move between the buttons with one tab stop (left and right wrap around, Home and End go to the ends); Enter and Space activate.
- `id` is `project` or `git-history`; unknown and repeated ids are ignored. `label` and `icon` default to the package's names and 16 px `currentColor` icons. `render` is called only while the view is selected. `tools` is shown where the sprite list shows its search, pin and undock buttons. Search and undock appear only while the sprite list is selected; the pin button, which pins the drawer itself, stays in every view. The GUI's target pane stays mounted, hidden, while another view is shown.
- Button 4 is a menu button (`aria-haspopup="menu"`, `aria-expanded`). `renderMenu` renders the menu content, normally one `role="menu"` element with `menuitem` children. The first item gets focus when the menu opens. Escape, a press outside or `close()` closes it and returns focus to the button. The menu does not change the drawer's content.
- The selected view is saved in `storage` under `<storageKey>.drawer` (`{"version": 1, "view": "project"}`), next to the split layout. A saved view the host does not supply falls back to the sprite list and comes back when the host supplies it again.
- Without `drawerViews`, or with no supported views and no `agents`, the drawer is unchanged: no bar and no extra element around the sprite list. Supply the views from startup; adding the first one later remounts the GUI's target pane once.

Use `/example/?standard=1&drawer=1&lang=ja` in the test host to try the bar with sample views and the package's AI agent menu.

### AI agent menu and settings

`@kubohiroya/turbowarp-plus-editor-workbench/ai-agents` supplies the menu for button 4 and its settings dialog:

```tsx
import styles from '@kubohiroya/turbowarp-plus-editor-workbench/editor.css';
import {createAiAgents} from '@kubohiroya/turbowarp-plus-editor-workbench/ai-agents';

const aiAgents = createAiAgents(React, {styles});
<StandardLayout {...props} drawerViews={{views, agents: aiAgents.drawerMenu}} />
// Anywhere else, for example a settings menu entry with aiAgents.settingsIcon():
aiAgents.openSettings({locale, returnFocus: trigger});
```

- A Desktop host can pass a `DesktopAiAgentsPort` to `createAiAgents(React, {styles, desktop})`. The host owns native app selection, confirmations and persistence. The menu and test launch pass only the saved entry's ID. Saving web settings preserves entries with unknown target kinds.
- The menu lists the turned-on services, each with an icon and its name, then a separator and "AI エージェント設定…" / "AI agent settings…". Without turned-on services it shows only that item and a short hint. Arrow keys, Home and End move between the items. Choosing a service opens its address with `window.open(url, '_blank', 'noopener,noreferrer')`.
- The presets are ChatGPT (`https://chatgpt.com/`) and Claude (`https://claude.ai/new`). Each can be turned off, and its address replaced by a deep link such as a previous conversation; an empty address means the default. The user can add and remove services of their own (name and address). Only `https:` addresses are accepted; anything else shows an error under the field. The icons are generic: a chat bubble with an initial for a preset, a globe for the user's own service. No service logos are used.
- The dialog (`role="dialog"`, `aria-modal`) is plain DOM, so it can be opened without React (`openAgentSettingsDialog`). It focuses its first field, keeps Tab inside, closes on Escape or Cancel without saving, and returns focus to `returnFocus` or to the element focused before.
- The settings are saved in `localStorage` under `twPlusAiAgents` as `{"version": 1, "services": [...]}`. Each service has a `target` of `kind: "url"`; other kinds are left for later and ignored for now. Missing, broken or invalid data falls back entry by entry to the presets.

## Saved Dockview layout

`useSpriteTabs` and `mountSpriteTabs` keep the Dockview workspace of each project in IndexedDB when the host passes `workspaceLayout`. The splits, the sprite and section of each tab, the stage and document tabs, the edited tab and the separate windows tabs were in come back the next time that project opens.

```js
workspaceLayout: {
    // The file or folder handle, or the desktop key, of the loaded project. Without one it is known by its name.
    identify: () => ({kind: 'file', name: handle.name, handle}),
    isProjectLoading: () => loading,
    subscribeProject: listener => subscribe(listener)
}
```

- A project is found by `FileSystemHandle.isSameEntry()` for a file or folder (`kind: 'file' | 'directory'`), by `key` for the desktop app (`kind: 'desktop'`), or by its name together with its sprites (`kind: 'anonymous'`). A project found by its handle or key keeps its tabs after its sprites are renamed; tabs of sprites it no longer has are left out. A project found by its name opens with the default layout when its sprites changed.
- Each load of a project reopens the layout of that project. A project keeps one record however often it changes.
- A record is made only once the layout differs from the one the project opened with. Sizes and the selected tab alone do not count.
- The 100 most recently used projects keep their layout; opening a project counts as using it. Older records are removed when a new one is made. A layout over 256 KB is not saved.
- The tab position (top or left) is one preference for every project.
- Without IndexedDB, projects open with the default layout and nothing is saved.
- Saving and restoring finish later than the change, because IndexedDB answers asynchronously. `controller.layoutSettled()` resolves once the loaded project's layout is restored, the tab position is read and every change is written. The workspace element carries the same state as `data-workspace-layout="pending"` or `"settled"`, so a browser test waits for that attribute instead of reading the database until the record appears.
- To forget every layout, delete the `twPlusWorkspaceLayout` database from the browser's developer tools (in Chrome: Application, then IndexedDB), or run `indexedDB.deleteDatabase('twPlusWorkspaceLayout')` in the console.
- Earlier versions kept a single layout in `localStorage` (`twPlusDockviewLayout` and `twPlusDockviewLayout.tabs`). Those keys are removed without being moved.

## Screen state in the SB3

`installProjectScreenState(vm, {Zip})` from `/project-screen-state` keeps the screen of a project inside its SB3, so the project opens the way it was when it was saved, in any browser. The host passes the JSZip constructor it already bundles (`@turbowarp/jszip`), and installs it after the extension loader's bridge.

```js
const screenState = installProjectScreenState(vm, {Zip: JSZip, save: flags.saveWorkspace});
<StandardLayout {...props} screenState={screenState} />
useSpriteTabs({...props, workspaceLayout: {...workspaceLayout, screenState}});
```

- Saving adds the ZIP entry `tw-plus/workspace.json` next to `project.json`: `{"version": 1, "savedAt": <ms>, "slices": {...}}`. Scratch and TurboWarp ignore the entry, so the file stays compatible. Saving it in another editor only drops the entry. `project.json` is not changed.
- Each part of the editor registers a slice under its own key with `register(key, {capture, apply})`. `capture` is called synchronously while saving; `apply` is called once for each loaded project that carries the slice, after the VM finished loading it, or when the slice is registered later. Keys match `^[a-z][a-zA-Z0-9-]{0,63}$`.
- This package registers `drawer` (the selected left drawer view) and `workspace` (the Dockview workspace described under [Saved Dockview layout](#saved-dockview-layout)). The workspace from the file is used when it is newer than the layout this browser kept for the project, or when the browser has none. A layout changed after the file was saved, and reloaded without saving, therefore still wins.
- Each sprite tab also keeps the costume and sound it had selected, by their index in the list. When the host's tab adapter has `serialize(view, snapshot)` and `deserialize(view, value)`, the tab keeps its code area too, such as its scroll position and zoom; `serialize` is called without a snapshot for the tab on screen, and must then read the code area without changing it. The tab on screen is read only while saving the project file, so the layout this browser keeps has the code areas of the other tabs.
- A project that is not saved as an SB3 keeps the same state elsewhere: `serialize()` returns the text a save writes into the ZIP entry, and `prepareLoad(text)` makes the next `loadProject` use that text instead of reading its input. The project folder writes it as `.tw-plus/workspace.json`.
- With `save: false`, saving writes no entry and removes one carried over from the loaded file. Reading stays on, so files saved earlier still open as they were.
- Entries larger than 512 KiB, of another version or of another shape are ignored, and the project opens with its usual screen.

## Menus, project dialogs, stage controls and the backpack window

These moved here from `packages/editor-ui` and `packages/editor-backpack` in turbowarp-plus-editor.

| Import | Contents |
| --- | --- |
| `./project-info-menu` | The project and settings menu, with the project title field and the GUI's display settings the host passes in |
| `./edit-menu` | The Edit menu's workspace commands, restore and the replace shortcut |
| `./project-file-menu`, `./project-file-dialogs` | The File menu, Save As (current, embedded or folder, and a new GitHub repository), the export view and the extension storage form |
| `./project-search` | The project-wide search and replace box (the search itself is in `@kubohiroya/turbowarp-plus-editor-project-model`) |
| `./project-load-progress`, `./project-load-progress-view`, `./project-size-approval` | Loading progress, and asking before opening a project over the standard size limit |
| `./stage-controls`, `./stage-controls-view` | The stage controls that extensions register, and their view on the menu bar with the debugger and recorder buttons |
| `./busy-cursor`, `./browser-tab-title` | The wait cursor around blocking work, and the browser tab title |
| `./backpack` | The backpack in its own window, with copies between windows through `@kubohiroya/turbowarp-plus-editor-windows` |
| `./edit-menu.css`, `./info-menu.css`, `./project-file-menu.css`, `./project-load-progress.css`, `./project-search.css`, `./stage-controls.css` | Their global stylesheets |

Load those stylesheets as global stylesheets, together with the `styles.css` of `@kubohiroya/turbowarp-plus-editor-windows`, whose dialog actions the dialogs use.

The debugger button comes from a GUI add-on. When handing it to `setDebuggerButton`, the host marks the add-on's button with `data-tw-stage-button`, its icon with `data-tw-stage-button-icon` and its content with `data-tw-stage-button-content`; the stylesheet and the keyboard handling use those marks instead of the GUI's class names.

These came from the same author and changed from GPL-3.0 to MPL-2.0 in the move. The provenance audit is in the "由来の監査（7b）" section of the [migration plan in turbowarp-plus-packages](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md). The Mark GitHub and Law icons in the project menu are from GitHub Octicons (MIT); see `NOTICE`.

## Verification

Run `npm test` to verify split sizing, aspect ratios, and settings persistence. Run `npm run test:browser` to test the standalone host. To open the test host manually, run `npm install` and `python3 -m http.server` in this directory, then open `/example/`.

From the Editor root, build the GUI pinned in `site/source.json` with `npm run build:pages`, then run `E2E_GUI_ROOT=/absolute/gui-checkout E2E_PATH_PREFIX=/turbowarp-plus-editor/ node --test test/editor-layout.browser.ts`. To verify the GUI on its own, set `E2E_LAYOUT_BARE_BUILD` to the directory where the same GUI was built without the host integration.

## Separate stage window

`attachStageInput` manages input subscriptions and cleanup using the separate window's document and canvas provided by the host. Pointer handling and drag cleanup use the host's callbacks.

The panes inside a sprite editing tab (assets and variables, messages, the properties form and the section toolbar) now live in `@kubohiroya/turbowarp-plus-editor-sprite-panes`; this package arranges them into tabs and splits. The window components, which came from the source of the previous release archive at `b0390c3`, now live in `@kubohiroya/turbowarp-plus-editor-windows`. The extraction kept the upstream Scratch GUI implementation in its original repository, so this package carries no GPL code and imports no GPL module. It is licensed MPL-2.0, which the GPL-3.0 Editor can still bundle because MPL-2.0 treats the GPL as a Secondary License. The source files carry no “Incompatible With Secondary Licenses” notice, and must not: that notice would make the package unusable in the Editor.

## Debugger tab

`attachDebuggerPanel(debugger, {document, vm})` opens the debugger add-on's window as a Dockview tab. The host passes the add-on's window element, the add-on's own visibility setter, and a function returning the GUI's language. While the workspace takes panels the debugger opens as a "Debugger" tab, and closing either the tab or the debugger closes the other. Otherwise it stays the floating window it was. The tab is transient and is left out of the saved layout.

`debugger-panel.css` restyles the add-on's own class names, so the host loads it as a global stylesheet. In the tab and the floating window alike it replaces the add-on's fixed teal with the GUI's theme variables.

## Breakpoints without breakpoint blocks

`attachBreakpointMenu({vm, getBlockly, getLocale})` adds "Add breakpoint" and "Remove breakpoint" to the context menu of a command block in the code area, and marks the blocks of the sprite being edited with a red outline and a red dot on their left (the rules are in `debugger-panel.css`). `getBreakpoints(vm)` returns the marks of one VM. A mark lives in the editing session and is never written to the project; a project load clears it.

The project stops right before a marked block runs, through the debugger add-on's own pause, so the add-on's Threads tab, Step and Continue work as they do for its breakpoint block. Without the add-on the menu item is not offered.

The VM is not changed. While at least one mark exists, `runtime.getOpcodeFunction`, `runtime._pushThread` and `runtime._restartThread` are wrapped, and they are restored when the last mark goes:

- When a thread arrives at a marked block, the first function the block runs pauses instead, and the frame waits the way it waits for a reporter. Continuing runs the block from its start. A block that waits in place, or a loop that comes back to its head, stops only on arrival.
- Compiled scripts run no per-block functions, so a script that starts in a sprite with a mark (clones included) is not compiled. Sprites without a mark compile as before. A script that was already running compiled keeps running until it starts again, and the menu item says so.

## Local verification with the Editor

Run `npm test` to check tab state, file menu actions, and the existing layout. Set `TW_PLUS_LAYOUT_EDITOR_URL` to an Editor URL built with the pinned Scratch GUI and run `npm run test:browser` to verify Dockview through the existing tab strip and editor panel integration. Set `TW_PLUS_LAYOUT_FILE_MENU_URL` for the same command to check a GUI build with the optional file menu integration.

`.github/workflows/release.yml` publishes to npm. On a push to `main` it publishes only when the
version in `package.json` is not on npm yet, and only after the tests pass; an existing version
publishes nothing. It authenticates with npm's trusted publisher (OIDC) through the `id-token: write`
permission instead of a token, so npm's configuration records this workflow's filename: rename the
file and the npm setting has to follow.

Sprite editing tabs are enabled by default in the Plus standard layout. Set `twPlusDockviewSpriteTabs=0` to restore the previous editing view. When the Editor exposes the file menu integration, the menu shows item icons and the Add Extension command. Set `twPlusExtensionFileMenu=0` to use the button at the bottom left again. Reload the editor after changing startup parameters.

In the Plus web editor, add `twPlusDockview=1` to enable split sprite panes. Each pane remembers its section, costume and sound selections, and asset-list scroll position. Variable values are shared across panes and can be changed in the active pane. Remove the startup parameter and reload to return to the regular sprite tabs.

The sprite and stage editor tabs carry Free layout (the code area), then Costumes or Backdrops and Sounds, then
Variables and Messages. Messages is drawn by `SpriteMessagePane` from `@kubohiroya/turbowarp-plus-editor-sprite-panes`. The stage owns
`broadcast_msg` variables, so a rename applies project-wide. `messageReference` in `@kubohiroya/turbowarp-plus-editor-project-model` is the only place that decides what
sends or receives a message, and the editor's project search calls the same function. This package's
`./project-messages` re-exports it for existing imports.

When the host passes `getFunctions`, two sections follow Free layout: Hats and functions, and Calls (the
toolbar of `@kubohiroya/turbowarp-plus-editor-sprite-panes` sets the button order; the section numbers stored in
saved layouts do not change, and Calls takes the next one). `SpriteFunctionPane` shows the list in the first, with
the other hat scripts the host passes in `hats` above the definitions, ordered by name, in Z order or in N order, and the call
graph flowing LR or TD in the second; each view keeps the order and flow it chose. A function picked in either opens through
`openFunction`, and a hat script through `openScript`, such as in a tab beside the sprite; without `openFunction` a function opens
in a dialog. With `createFunction(targetId, kind, name)`, an “Add a new function” button below the list and in the bottom left
corner of the graph asks for a name and makes a standard custom block or a TurboWarp-Plus named function. The dialog calls the host's `mountFunctionEditor`, which owns the code workspace of that
definition, because this package carries no Scratch Blocks code.
