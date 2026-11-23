# TurboWarp Plus Editor Workbench

TurboWarp Plus Editor の作業画面。分割レイアウト、Plus 標準配置、Dockview のスプライトタブとワークスペース、ステージ、デバッガーのタブ、ファイルメニューを担う。スプライトタブの中のペインは `@kubohiroya/turbowarp-plus-editor-sprite-panes`、ページ内の窓は `@kubohiroya/turbowarp-plus-editor-windows`、作品データの読み取りは `@kubohiroya/turbowarp-plus-editor-project-model` から使う。

このパッケージは 0.3.0 まで `@kubohiroya/turbowarp-plus-editor-layout` として公開していた。

## プロジェクト一覧

一覧上部の「新しいプロジェクトを作成…」は、登録がないときもファイルメニューと共通の新規作成へ進む。ホストはメニューから渡される作成コールバックを `projectCatalog` の第4引数へ渡す。一覧を閉じてから作成ダイアログを開き、作成先の選択・未保存変更の確認は既存の処理を利用する。

`project-catalog` は SB3、手元のフォルダ、ブラウザー保存、リモート Git と作業コピーを共通の登録として扱う。`project-catalog-dialog` と `project-catalog.css` が一覧・並び替え・開く・除外・保存データ削除・2種類の改名を提供する。`project-catalog-host` が既存のファイル保存、作品情報、project-folder と Git の接続口へつなぐ。Editor は `createProjectTools` の `catalogEnvironment` にファイルハンドルの読み取りと変更購読を渡し、`bindProjectCatalogFolder` でフォルダとリモート操作を渡す。`projectFileOpened` は読み込み成功後だけ呼ぶ。

カタログは IndexedDB の `twPlusProjectCatalog` に保存する。作品名を識別子に使わず、ファイルハンドル・OPFS の ID で照合する。同じリモートの別作業コピーは別登録のまま保持する。以前の画面配置に残ったハンドルと既存 OPFS 作品を取り込み、「一覧から除外」した作品は再取り込みで戻さない。最終利用日時は正常に開いた場合だけ更新する。

作品名変更は作品を開き、作品情報を変更して既存の保存経路で書き戻す。保存先名は別操作で、両方を同名に揃える選択もできる。非対応の操作は理由を表示する。ファイル名の変更では `.sb3` を保持し、改名後もハンドルで画面配置を照合する。途中まで成功した場合は、成功した変更を個別に記録する。

一覧からの除外は保存データを消さない。保存データ削除には確認を求め、開いている作品の保存先は先に別作品を開くまで削除しない。GitHub 上のリポジトリ削除は提供しない。GitHub の改名は #681 の対応を必要とする。切り戻す場合は一覧の接続と依存更新を戻し、カタログ・保存データを残す。

対象検証: `npm run build`、`node --test test/project-catalog.test.ts test/workspace-layout-store.test.ts test/project-file-menu.test.ts`、`node --test test/project-catalog.browser.ts`（ヘッドレス）。

## 分割レイアウト

同じ document 内で「編集領域／ステージ列」と「ステージ／対象領域」の境界を調整する。ホストは `createLayout(React)` に既存の React を渡し、`render` に渡される境界・スタイル・表示サイズを既存コンポーネントに接続する。ホストがストレージとキーを指定し、このパッケージが設定を保存・復元する。

境界はドラッグ、矢印キー、Home／End で移動できる。Enter またはダブルクリックで、その境界を既定の位置に戻す。

## Editor での配分

| 境界 | 最小サイズ |
| --- | --- |
| 編集領域／ステージ列 | 編集領域 500 px、ステージ列 350 px |
| ステージ／対象領域 | ステージ 135 px、対象領域 175 px |

境界の幅は 8 px。分割比率は各領域の最小サイズまでに制限する。最小サイズを両立できない表示領域では通常配分に戻し、表示領域を広げると保存した比率で分割を再開する。プロパティと一覧はスプライト選択ペイン内にまとまっており、バックパックは開閉式のトレイなので、この段階では既存の操作で扱う。メニューバーは分割領域の外にある。

Scratch 配置では分割を既定で有効にする。既存のステージサイズボタンを押すと、指定したプリセットで配分を初期化する。設定は作品や SB3 と別に保存する。分割だけを無効にする場合は Web の起動 URL に `twPlusSplitter=0` を指定するか、Desktop を `TW_PLUS_DESKTOP_SPLITTER=0` で起動する。

## Plus 標準配置

`createStandardLayout(React, {styles, targetStyles, context})` は、⚓️ での配置切り替え、ステージの表示と計測、スプライト一覧の2列配置を担当する。`editor.css` と `targets.css` をクラス名マップとして渡す。ホストは起動設定、ストレージ、ウィンドウ操作部品、パレット表示のコールバックと描画先を渡す。配置メニューの描画を差し替える場合は、任意の `LayoutMenu` コンポーネントをファクトリーに渡す。ステージを隠しても同じ描画先を使う。

試験用ホストの `/example/?standard=1` で Plus と Scratch の往復を確認できる。`standard=0` は起動時の切り戻しを再現する。

Editor はこのパッケージを npm から固定して使う。

## 左側ドロワーの表示

Plus 標準配置の左側ドロワーは、スプライト一覧と背景を表示する。ホストは `StandardLayout` に `drawerViews` を渡して、表示する内容を足せる。

```js
<StandardLayout {...props} storage={localStorage} storageKey="twPlusEditorLayout" drawerViews={{
    views: [
        {id: 'project', render: ({locale}) => <ProjectExplorer locale={locale} />, tools: ({locale}) => <ExplorerTools />},
        {id: 'git-history', label: 'Git 履歴', icon: <HistoryIcon />, render: () => <GitHistory />}
    ],
    agents: {renderMenu: ({locale, close}) => <div role="menu">…</div>}
}} />
```

- ドロワーの最上部に、アイコンだけのボタンを 1 行に並べたもの（ドロワーが狭すぎるときだけ折り返す）（`role="toolbar"`、「ドロワーの表示」）が出る。1 スプライト一覧、2 プロジェクトフォルダ、3 Git 履歴、4 AI エージェント。それぞれ日本語か英語の `aria-label` と `title` を持つ。ボタンは、ホストが渡したものだけを出す。スプライト一覧は常に先頭にある。
- 1〜3 は内容を切り替え、選択中のボタンを `aria-pressed` で示す。矢印キーでボタンの間を移る（Tab で止まるのは 1 つ。左右は端で反対側に回り、Home と End は両端へ移る）。Enter と Space で選ぶ。
- `id` は `project` か `git-history`。知らない `id` と、重なった `id` は無視する。`label` と `icon` を省くと、パッケージの名前と、`currentColor` で描く 16 px のアイコンを使う。`render` は選択中だけ呼ぶ。`tools` は、スプライト一覧の検索・ピン・アンドックと同じ位置に出す。検索とアンドックは、スプライト一覧を選んでいるときだけ出る。ピン留めはドロワーそのものの操作なので、どの内容でも出す。ほかの内容を出している間も、GUI の対象ペインは隠したまま残す。
- 4 はメニューを開くボタン（`aria-haspopup="menu"`、`aria-expanded`）。`renderMenu` がメニューの中身を描く。ふつうは `role="menu"` の要素 1 つと、その中の `menuitem` にする。開くと最初の項目に移る。Escape、外側の押下、`close()` で閉じ、ボタンに戻る。ドロワーの内容は切り替えない。
- 選んだ内容は、分割レイアウトと同じ `storage` の `<storageKey>.drawer`（`{"version": 1, "view": "project"}`）に保存する。保存した内容をホストが渡していないときはスプライト一覧に戻り、ホストがまた渡すと復元する。
- `drawerViews` がないとき、または使える内容も `agents` もないときは、ドロワーは変わらない。ボタンを出さず、スプライト一覧を囲む要素も足さない。内容は起動時から渡す。後から最初の内容を足すと、GUI の対象ペインを 1 度作り直す。

試験用ホストの `/example/?standard=1&drawer=1&lang=ja` で、見本の内容を入れたボタンと、パッケージの AI エージェントのメニューを試せる。

### AI エージェントのメニューと設定

`@kubohiroya/turbowarp-plus-editor-workbench/ai-agents` は、4 のボタンのメニューと、その設定のダイアログを渡す。

```tsx
import styles from '@kubohiroya/turbowarp-plus-editor-workbench/editor.css';
import {createAiAgents} from '@kubohiroya/turbowarp-plus-editor-workbench/ai-agents';

const aiAgents = createAiAgents(React, {styles});
<StandardLayout {...props} drawerViews={{views, agents: aiAgents.drawerMenu}} />
// ほかの場所、たとえば設定のメニューの項目（アイコンは aiAgents.settingsIcon()）から:
aiAgents.openSettings({locale, returnFocus: trigger});
```

- Desktop のホストは `createAiAgents(React, {styles, desktop})` に `DesktopAiAgentsPort` を渡す。OS のアプリ選択、確認、設定の保存はホストが担当する。メニューと「試しに起動」は保存済み項目の ID を渡す。Web の設定を保存する際は、読み取った未知の起動種別の項目も保持する。
- メニューは、メニューに出すことにしたサービスを、アイコンと名前で並べ、区切りのあとに「AI エージェント設定…」を置く。出すサービスがないときは、その項目と短い案内だけを出す。矢印キー、Home、End で項目を移る。サービスを選ぶと、`window.open(url, '_blank', 'noopener,noreferrer')` で開く。
- 用意されたサービスは ChatGPT（`https://chatgpt.com/`）と Claude（`https://claude.ai/new`）。それぞれメニューから外せ、以前の会話などの URL に置き換えられる。URL を空にすると既定に戻る。利用者は、名前と URL で自分のサービスを足し、消せる。URL は `https:` で始まるものだけを受け付け、ほかは欄の下に誤りを出す。アイコンは汎用のもので、用意されたサービスは頭文字入りの吹き出し、自分のサービスは地球儀にする。各サービスのロゴは使わない。
- ダイアログ（`role="dialog"`、`aria-modal`）は React を使わない DOM で、`openAgentSettingsDialog` で開ける。開くと最初の欄に移り、Tab はダイアログの中を回る。Escape かキャンセルで保存せずに閉じ、`returnFocus`、なければ開く前の要素に戻る。
- 設定は `localStorage` の `twPlusAiAgents` に `{"version": 1, "services": [...]}` で保存する。各サービスの `target` は `kind: "url"`。ほかの `kind` は後の段階のためにあけてあり、いまは読み飛ばす。ない・壊れた・誤ったデータは、項目ごとに既定に戻す。

## Dockview のレイアウトの保存

ホストが `workspaceLayout` を渡すと、`useSpriteTabs` と `mountSpriteTabs` は作品ごとの Dockview のレイアウトを IndexedDB に保存する。分割、各タブのスプライトと区分、ステージとドキュメントのタブ、編集中のタブ、別ウィンドウにあったタブを、次にその作品を開いたときに再現する。

```js
workspaceLayout: {
    // 読み込んだ作品のファイルやフォルダーのハンドル、またはデスクトップ版のキー。無ければ名前で見分ける。
    identify: () => ({kind: 'file', name: handle.name, handle}),
    isProjectLoading: () => loading,
    subscribeProject: listener => subscribe(listener)
}
```

- 作品は、ファイルやフォルダー（`kind: 'file' | 'directory'`）なら `FileSystemHandle.isSameEntry()` で、デスクトップ版（`kind: 'desktop'`）なら `key` で、どちらも無ければ名前とスプライトの組み合わせ（`kind: 'anonymous'`）で見分ける。ハンドルかキーで見つかった作品は、スプライト名を変えてもタブを再現し、無くなったスプライトのタブだけを外す。名前で見分けた作品は、スプライトが変わっていれば既定のレイアウトで開く。
- 作品を読み込むたびに、その作品のレイアウトを再現する。作品ごとの記録は、何度変更しても 1 件にとどめる。
- 開いたときのレイアウトから変わるまでは記録を作らない。大きさと選択中のタブの違いだけでは変わったとみなさない。
- 最後に使ったのが新しい順に 100 件を残す。開いただけでも使ったとみなす。古い記録は新しい記録を作るときに消す。256 KB を超えるレイアウトは保存しない。
- タブの位置（上／左）は全作品で共通の設定にする。
- IndexedDB が使えないときは既定のレイアウトで開き、何も保存しない。
- IndexedDB の応答は非同期なので、保存と再現は変更より後に終わる。`controller.layoutSettled()` は、読み込んだ作品のレイアウトの再現、タブの位置の読み込み、すべての変更の書き込みが終わると解決する。同じ状態を作業領域の要素の `data-workspace-layout`（`"pending"` または `"settled"`）にも示すので、ブラウザーテストは記録が現れるまでデータベースを読み直すのではなく、この属性を待つ。
- すべてのレイアウトを消すには、ブラウザーの開発者ツールで `twPlusWorkspaceLayout` データベースを削除する（Chrome では Application の IndexedDB）。コンソールで `indexedDB.deleteDatabase('twPlusWorkspaceLayout')` を実行してもよい。
- 以前の版は `localStorage`（`twPlusDockviewLayout` と `twPlusDockviewLayout.tabs`）に 1 件だけ保存していた。これらのキーは移さずに消す。

## SB3 に保存する画面状態

`/project-screen-state` の `installProjectScreenState(vm, {Zip})` は、作品の画面を SB3 の中に保存する。どのブラウザーで開いても、保存したときの画面で作品が開く。ホストは同梱している JSZip のコンストラクター（`@turbowarp/jszip`）を渡し、拡張ローダーの橋より後に組み込む。

```js
const screenState = installProjectScreenState(vm, {Zip: JSZip, save: flags.saveWorkspace});
<StandardLayout {...props} screenState={screenState} />
useSpriteTabs({...props, workspaceLayout: {...workspaceLayout, screenState}});
```

- 保存すると、`project.json` の隣に ZIP エントリ `tw-plus/workspace.json`（`{"version": 1, "savedAt": <ms>, "slices": {...}}`）を加える。Scratch と TurboWarp はこのエントリを無視するので、ファイルの互換性は変わらない。別のエディターで保存し直すと、エントリが消えるだけである。`project.json` は変えない。
- エディターの各部分は、自分のキーで `register(key, {capture, apply})` によりスライスを登録する。`capture` は保存中に同期で呼ばれる。`apply` は、そのスライスを含む作品を VM が読み込み終えたあとに作品ごとに1回呼ばれる。読み込み後に登録したスライスには、登録したときに呼ばれる。キーは `^[a-z][a-zA-Z0-9-]{0,63}$` に合うものとする。
- このパッケージは `drawer`（左側ドロワーで選んだ表示）と `workspace`（[Dockview のレイアウトの保存](#dockview-のレイアウトの保存) の作業領域）を登録する。ファイルの作業領域は、このブラウザーがその作品について保存したレイアウトより新しいとき、またはブラウザーに記録がないときに使う。ファイルの保存後にレイアウトを変え、保存せずに開き直した場合は、ブラウザーの記録が使われる。
- 各スプライトのタブは、選んでいたコスチュームと音も、一覧での位置で保存する。ホストのタブアダプターが `serialize(view, snapshot)` と `deserialize(view, value)` を持つときは、スクロール位置やズームなどのコードエリアも保存する。画面に出ているタブについては、`serialize` をスナップショットなしで呼ぶので、コードエリアを変えずに読む。画面に出ているタブを読むのは作品ファイルの保存時だけなので、ブラウザーが保存するレイアウトには、ほかのタブのコードエリアだけが入る。
- SB3 として保存しない作品は、同じ状態を別の場所に保存する。`serialize()` は保存時に ZIP エントリへ書くテキストを返す。`prepareLoad(text)` を呼ぶと、次の `loadProject` は入力を読まずにこのテキストを使う。作品フォルダーは、これを `.tw-plus/workspace.json` として書く。
- `save: false` では、保存時にエントリを書かず、読み込んだファイルから引き継いだエントリも取り除く。読み込みは有効のままなので、以前に保存したファイルは保存時の画面で開く。
- 512 KiB を超えるエントリ、別の版のもの、形の合わないものは無視し、作品は通常の画面で開く。

## メニュー・作品のダイアログ・ステージの操作・バックパックの窓

turbowarp-plus-editor の `packages/editor-ui` と `packages/editor-backpack` から移したもの。

| import | 内容 |
| --- | --- |
| `./project-info-menu` | 作品と設定のメニュー。作品名の欄と、ホストが渡す GUI の表示設定を含む |
| `./edit-menu` | 編集メニューのワークスペースの操作、復元、置換のショートカット |
| `./project-file-menu`・`./project-file-dialogs` | ファイルメニュー、新しいプロジェクトを作成…（メモリ上・フォルダ・GitHub の新しいリポジトリ）、プロジェクトのコピーを保存（現在の形式・埋め込み・フォルダ、GitHub の新しいリポジトリ）、保存用の名前、書き出しの表示、拡張の置き場所のフォーム |
| `./project-search` | 作品全体の検索と置換のボックス（検索そのものは `@kubohiroya/turbowarp-plus-editor-project-model` にある） |
| `./project-load-progress`・`./project-load-progress-view`・`./project-size-approval` | 読み込みの進み具合と、標準の上限を超える作品を開く前の確認 |
| `./stage-controls`・`./stage-controls-view` | 拡張が登録するステージの操作と、デバッガーと録画のボタンを含むメニューバーの表示 |
| `./busy-cursor`・`./browser-tab-title` | 時間のかかる処理の待ちカーソルと、ブラウザーのタブの題名 |
| `./backpack` | 別窓のバックパック。窓をまたぐコピーは `@kubohiroya/turbowarp-plus-editor-windows` を使う |
| `./edit-menu.css`・`./info-menu.css`・`./project-file-menu.css`・`./project-load-progress.css`・`./project-search.css`・`./stage-controls.css` | 上のグローバルなスタイルシート |

これらのスタイルシートはグローバルなスタイルシートとして読み込む。ダイアログの操作ボタンに使う `@kubohiroya/turbowarp-plus-editor-windows` の `styles.css` もあわせて読み込む。

デバッガーのボタンは GUI のアドオンが作る。ホストは `setDebuggerButton` に渡すとき、アドオンのボタンに `data-tw-stage-button`、アイコンに `data-tw-stage-button-icon`、中身に `data-tw-stage-button-content` の印を付ける。スタイルシートとキーボードの扱いは、GUI のクラス名ではなくこの印を使う。

これらは同じ作者が書いたもので、移すときに GPL-3.0 から MPL-2.0 にした。由来の監査は [turbowarp-plus-packages の移行計画](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md)の「由来の監査（7b）」にある。作品のメニューの Mark GitHub と Law のアイコンは GitHub Octicons（MIT）のもの。`NOTICE` を参照。

### ファイルメニュー：新しいプロジェクトを作成…・プロジェクトのコピーを保存…

ファイルメニューの先頭は「新しいプロジェクトを作成…」、保存の区切りには「プロジェクトのコピーを保存…」が並ぶ（コマンドの id は `save-as` のままなので、アイコンとホストはそのまま動く。未保存の印から開く保存の一覧も同じ表記）。ホストが `entries.createIn` を渡さないときは、先頭の項目は「新しいプロジェクトを作成」のままで、`entries.create` を直接呼ぶ。

**新しいプロジェクトを作成…** ホストが `entries.createIn` を渡すと、項目は `openNewProjectDialog(document, locale, options)` を開く。中身は `renderNewProjectForm(document, locale, options, close)` で、ホストが自分のダイアログに載せるときは `projectFileDialogTitle('new', locale)` を題名にする。作成先を選ぶ。

| 作成先 | 出す条件 | 要求 |
| --- | --- | --- |
| メモリ上の SB3（既定） | いつも | 今までどおり `entries.create` を呼ぶ（`create` が無いときは `createIn` に `{destination: 'memory'}`） |
| ブラウザー内のプロジェクトフォルダ | `newProject.browserFolders` | `{destination: 'browser', title, saveName}` |
| 手元のプロジェクトフォルダ | `newProject.deviceFolders` が `true`。`false` なら「フォルダを開く…」と同じ理由を添えて無効で出す | `{destination: 'device', title, saveName}` |
| Git のリモートリポジトリ | `newProject.github`（`connectForCreation`・`licenses`）と、作業用の写しの置き場所がある | `{destination: 'github', title, saveName, draft, workingCopy: 'browser' \| 'device'}` |

```ts
entries.createIn = (request: NewProjectRequest, signal: AbortSignal) => Promise<'created' | 'cancelled'>;
entries.newProject = {defaultTitle: 'Scratch の作品', browserFolders: true, deviceFolders: canPickFolders,
    github: {connectForCreation, licenses}};
```

- フォルダとリポジトリでは、作品名（初期値は `newProject.defaultTitle`）と保存用の名前を決める。作品名が保存用の名前の規則に収まればそのまま使い、収まらなければダイアログの中で規則を案内し、`suggestSaveName(title)` を初期値にして保存用の名前を入力してもらう。
- GitHub では、コピーの保存と同じリポジトリの入力（作成先、リポジトリ名、概要、トピック、ライセンス、公開範囲）を使い、接続して確認の段を経たうえで、作業用の写しの置き場所（手元のフォルダは上と同じ条件）を選ぶ。リポジトリ名の初期値は保存用の名前で、要求の `saveName` はリポジトリ名（`draft.name`）になる。
- `createIn` は作品を開き終えたら `created` を返し、ダイアログが閉じる。`cancelled`（フォルダの選択を取り消したときなど）ならダイアログは開いたまま。Error で失敗すると、その message をダイアログに出す。`signal` はダイアログを閉じると中断される。

**保存用の名前。** 作品名をフォルダ名やリポジトリ名に使えないときの保存用の名前は、GitHub のリポジトリ名の規則に従う。半角英数字、`-`・`_`・`.`、100 文字まで。`.` と `..`、末尾の `.git` は使えない。

- `isValidSaveName(name)` は規則に合うかを返す（`.git` は大文字・小文字を区別しない）。
- `suggestSaveName(title)` は作品名から ASCII の候補を作る（アクセントを外し、小文字にし、ほかの文字は `-`）。使える文字が残らないとき（日本語だけの作品名など）は `''` を返す。
- `askSaveName({document, locale, title, current})` は規則を示すモーダルのダイアログで保存用の名前を尋ね、入力のたびに確かめる。OK で名前を、キャンセルで `null` を返す。

**保存先の無い作品の「プロジェクトを保存」。** 「プロジェクトを保存」（`save`、Ctrl/⌘+S）は、保存できる作品ならいつも使える。作品のファイルへの上書き（`storage.overwrite`）か、フォルダへの保存（`folder.save`）をし、どちらも無い作品（メモリ上の新しい作品など）では新しい `entries.saveNew` を呼ぶ。ホストはそこで同じ `renderSaveAsForm`（名前、SB3 かプロジェクトフォルダ、Git と GitHub）を `projectFileDialogTitle('save', locale)`（「プロジェクトを保存」）の題名で開き、その結果を**作品の保存先にする**。SB3 なら `saveProjectAs(..., {mode: 'save', unchanged})` が `storage.finish(handle, title, unchanged)` を呼び、ホストは今までどおりファイルのハンドルと作品名を設定して保存済みにする。フォルダや GitHub の新しいリポジトリなら、以前の「名前を変えて保存」と同じくホストが開いて結び付ける。`projectSaveShortcut(storage, folder, saveNew)` の第 3 引数にも同じものを渡す。ここに「コピーを保存」を渡すと、保存先の無い作品はいつまでも写しを作るだけになる。

**プロジェクトのコピーを保存…（ホストに影響する変更）。** 写しを書くだけで、今の作品はそのまま残る。作品名、ファイルのハンドル、フォルダ、未保存の変更は変わらない。既定の `mode: 'copy'` の `saveProjectAs` は `storage.finish` を呼ばず、書き終えたら `committed()` に続けて新しい任意の `storage.copied(handle, title)` を呼ぶ。ホストはここで保存中の表示を終えるだけにする。ダイアログの題名は `projectFileDialogTitle('save-as', locale)`（「プロジェクトのコピーを保存」）。

保存先になるかどうか：

| 経路 | 保存先 | 呼ばれるもの |
| --- | --- | --- |
| 「プロジェクトを保存」（保存先あり） | 今の保存先のまま | `storage.overwrite`・`folder.save` |
| 「プロジェクトを保存」（保存先なし、`entries.saveNew`） | 新しいファイル・フォルダ・リポジトリが保存先になる | `saveProjectAs({mode: 'save'})` → `storage.finish`。フォルダとリポジトリはホストが結び付ける |
| 「プロジェクトのコピーを保存…」（`entries.saveAs`） | 変わらない | `saveProjectAs()`（写し）→ `storage.copied`。ホストはフォルダもリポジトリも結び付けない |

今の「名前を変えて保存」を結線しているホストは、写しの経路で次をやめる。

1. `committed()` の中の `detachFolder()`（作品はプロジェクトフォルダに結び付いたまま）。
2. 写しの後にファイルのハンドルと作品名を設定すること（`storage.finish` の中の `onSetFileHandle(handle)` と `onSetProjectTitle(title)`。写しでは `finish` は呼ばれない）。代わりに `storage.copied` を用意し、保存の完了の通知はそこで出してよい。
3. 作品を保存済みにすること（`finishedSaving()`・`onProjectUnchanged()`）と、作品のプロパティの保存の受領（`commitMetadata()`）や組み込みデータの確定（`embed()`）を、作品そのものを保存したかのように確定すること。
4. フォルダへの写し（`createFolder`）や、コピーのダイアログから作った GitHub のリポジトリを、利用者が開くと選ばないのに開いたり結び付けたりすること。

そのうえで、以前の「名前を変えて保存」の動き（上の 1〜4 を含む）は `mode: 'save'` にして `entries.saveNew`（と `projectSaveShortcut` の第 3 引数）に結線する。

**「新しいプロジェクトを作成…」の結線（`@kubohiroya/turbowarp-plus-editor-workbench/new-project`）。** `createNewProjectHandler(host)` は `entries.createIn` と `entries.newProject` に渡す `{createIn, newProject}` を返す。段取りの順序、GitHub の作成とその文言はパッケージが持ち、ホストは GUI と保存場所に依存するものだけを渡す。

```ts
const {createIn, newProject} = createNewProjectHandler({
    locale, defaultTitle, browserFolders, deviceFolders,
    create,                                   // GUI の「新しいプロジェクトを作成」（メモリ上）
    openDefaultProject: signal => ...,        // create() して、初期の作品が表示され題名が戻るまで待つ。
                                              // 今の作品を残すと選んだら false
    nameProject: (title, saveName) => ...,   // properties.apply({title, saveName}) を一度で
    pickDeviceFolder: () => ...,              // 手元の空のフォルダ、取り消したら null
    createFolder: (destination, title, signal) => ...,  // 'browser' か選んだフォルダに作って開く
    repositoryCreation,                       // {connect, licenses, list, advance, open, start(draft, serialize, current, signal, target)}
    serialize: title => ...,                  // 最初のコミットに使うプロジェクトフォルダの内容
    trackProject: () => () => stillTheSameProject(),
    markSaved, notify: text => showNotice(document, text, {locale})
});
```

- 手元のフォルダは、ブラウザーが選択画面を許すクリックの直後に、最初に選ぶ。選択の取り消し、今の作品を残す選択（`openDefaultProject` が `false`）、フォルダを作れなかったときは `cancelled` を返す。
- フォルダとリポジトリの作品は初期の作品から始め、`nameProject(title, saveName)` で名前を付ける。
- GitHub では、同じ作成先と名前（大文字・小文字を区別しない、`list()` から）の止まった作成があれば、新しく作らずに続きから再開する。なければ `start` が作業用の写し（`'browser'` か選んだフォルダ）を作る。結果が偽なら取り消しとし、それ以外はそのまま `advance` に渡して、`advance` を `open` の段まで繰り返す（9 段を超えるか、`unknown` が続いたら止める）。デバイスコードは `notify` で知らせ、新しい作品では `open` の前に `markSaved` を呼んで、開くときに何も尋ねないようにする。`popupBlocked`・`nameConflict` などの失敗は、ダイアログに出す文言に置き換える。

**作品名の確定（`@kubohiroya/turbowarp-plus-editor-workbench/project-title`）。** `followProjectTitleCommits(document, {readTitle, onCommit})` はメニューバーの作品名の入力欄（`projectTitleFieldClassName`）を見張り、利用者が Enter（IME の変換中は除く）か入力欄から離れることで確定した編集ごとに 1 回、`onCommit(title)` を呼ぶ。読み込みやプロパティで変わった作品名と、変わらなかった作品名は知らせない。戻り値は見張りをやめる関数。続く `reflectProjectTitle({document, locale, title, saveName, location, gitBound, renameBrowserFolder, setSaveName, notify, current})` が作品名を反映する。

| 作品 | 結果 |
| --- | --- |
| `location: 'browser'`（ブラウザー内のフォルダ） | `renameBrowserFolder(title)`（失敗は無視） |
| `location: 'device'` | 手元のフォルダの名前は変わらないと知らせる |
| `gitBound: true` | Git のリポジトリの名前はまだ変わらないと知らせる（フォルダの知らせの後に続ける） |
| 作品名が保存用の名前に使えず、`saveName` が無く、フォルダかリポジトリに保存している | `askSaveName` で尋ね、OK なら `setSaveName(name)` |
| `location: 'none'` で Git にも結び付いていない、または作品名が空 | 何もしない |

`current()` は待つたびに確かめるので、別の作品を開く直前に確定した作品名は何も変えない。ホストは次のように結線する。

```ts
const stop = followProjectTitleCommits(document, {readTitle: () => store.getState().scratchGui.projectTitle,
    onCommit: title => void reflectProjectTitle({document, locale, title, saveName: projectSaveName(), location, gitBound,
        renameBrowserFolder: title => browserStorage.rename(entry.id, title), setSaveName, notify, current}).catch(() => {})});
```

**通知（`@kubohiroya/turbowarp-plus-editor-workbench/project-notice`）。** `showNotice(document, text, {locale, timeout = 12000})` は、エディターを止めない通知を窓の下に出す（`role="status"`、`data-testid="project-notice-snackbar"`）。閉じるボタンは X のアイコンで、名前は `閉じる`／`Dismiss`。`timeout` が過ぎると、通知の中にフォーカスが無ければ消える。同じ文書に出ている通知は置き換え、戻り値は通知を消す関数。見た目は `project-file-menu.css`（`.tw-project-notice`）にある。

## 検証

`npm test` で配分・縦横比・設定の読み書きを、`npm run test:browser` で独立した試験用ホストを検証する。試験用ホストを手動で開くには、このディレクトリで `npm install` と `python3 -m http.server` を実行し、`/example/` を表示する。

Editor のルートから、`site/source.json` の GUI を `npm run build:pages` でビルドし、`E2E_GUI_ROOT=/absolute/gui-checkout E2E_PATH_PREFIX=/turbowarp-plus-editor/ node --test test/editor-layout.browser.ts` を実行する。同じ GUI をホスト接続なしでビルドしたディレクトリを `E2E_LAYOUT_BARE_BUILD` に渡すと、GUI 単体の動作も検証する。
## 別窓ステージ

`attachStageInput` は、ホストから渡された別ウィンドウの document とキャンバスを使って、入力の購読と解放を管理する。ポインター処理とドラッグ状態の解除はホストのコールバックを使用する。

日本語・中国語・韓国語の IME がオンのとき、ブラウザーは IME が受け取ったキーを `Process`（または IME が打つかな）と報告し、VM はこれを無視する。`attachStageInput` は `event.code` から元のキーを復元する。本体の document では、`@kubohiroya/turbowarp-plus-editor-workbench/ime-key` の `installImeKeyInput(document)` が capture 段階で `key` と `keyCode` を直し、ステージが読む前に同じ復元を行う。テキスト欄に向かうイベントは IME の報告のまま残す。

スプライト編集タブの中のペイン（素材と変数、メッセージ、設定フォーム、セクション切り替えのツールバー）は `@kubohiroya/turbowarp-plus-editor-sprite-panes` に移った。このパッケージはそれらをタブや分割に並べる。以前の配布アーカイブのソース `b0390c3` から移設したウィンドウ部品は、`@kubohiroya/turbowarp-plus-editor-windows` に移った。Scratch GUI の本家実装はこのパッケージに取り込んでいないため、GPL のコードを含まず、GPL のモジュールも import しない。ライセンスは MPL-2.0 とする。MPL-2.0 は GPL を二次ライセンスとして認めるので、GPL-3.0 の Editor に組み込んで配信できる。ソースに「Incompatible With Secondary Licenses」の表示は付けない。付けると Editor に組み込めなくなる。

スプライトの「呼び出し関係」では、図の方向を切り替える LR／TD と、関数・メッセージの表示を切り替えるボタンを縦ツールバーの下端に置く。方向と表示の選択はビューごとに管理し、分割した別ビューの選択を変えない。ホストが `renderToolbar` でツールバーを描く場合は、受け取る `actions.sectionControls` を `SpriteEditorToolbar` の `sectionControls` に渡す。図で選んだスクリプトは `openRelationScript` で開き、ホストが対象のスプライトとブロックへ移動する。

`createEditorTabLayout` は自由配置のブロックメニューから、対象を含むスクリプトを右の個別編集ビューで開く。一覧を開く項目は左をハット・関数一覧へ、呼び出し関係を開く項目は左を図へ切り替えて対象を中央に置く。

外部のメニューから対象スクリプトへ中央フォーカスする場合は、`selectedScript` の `{targetId, id}` に更新するたびに異なる `focusRequest` の数値を添える。対象のペインの `SpriteFunctionPane` へ同じ要求を渡し、関係図の移動や強調は図を所有するパッケージが行う。切り戻す場合は `focusRequest` を渡さない。

コードペインのアダプターに `relations` がある場合、「自由配置」にも同じ関数・メッセージの2ボタンを縦ツールバー下端に置く。表示状態の所有者はコードペインで、`getVisibility(paneId)`・`setVisibility(paneId, value)`・`subscribe(listener)` を使って描画へ反映する。関数だけ、メッセージだけ、両方、両方非表示を選べ、分割した別のペインや呼び出し関係パネルの設定は変えない。両方とも既定で表示する。アダプターにこの接続がなければボタンを追加しない。切り戻しは workbench と code-views の固定依存を導入前の版へ戻して再ビルドする。

## 実行画面のメニュー

`./stage-display-menu` の `createStageDisplayMenu` は、メニューバーの実行画面ボタンの▼メニュー（置き場所・大きさ・全画面・別ウィンドウ）を作る。ほかのパッケージは `menuItems(locale)` を渡して、自分の画面を開く項目などを足せる。足した項目は、区切り線の後に、メニューと同じ言語で並ぶ。足すのはエディターの中のメニューだけで、別ウィンドウと全画面のメニューは元の項目のままにする。項目が何をするかを、ワークベンチは知らない。

## デバッガーのタブ

`attachDebuggerPanel(debugger, {document, vm})` は、デバッガーアドオンのウィンドウを Dockview のタブとして開く。ホストはアドオンのウィンドウ要素、アドオン自身の表示切り替え関数、GUI の言語を返す関数を渡す。ワークスペースがパネルを受け付けるときは「デバッガー」タブで開き、タブとデバッガーの開閉を連動させる。受け付けないときは従来どおり浮動ウィンドウのままにする。タブは一時パネルとして扱い、保存するレイアウトには含めない。

`debugger-panel.css` はアドオンのクラス名を上書きするため、ホストはグローバルなスタイルシートとして読み込む。タブと浮動ウィンドウの両方で、アドオン固有の青緑の代わりに GUI のテーマ変数を使う。

## ブロックを置かないブレークポイント

`attachBreakpointMenu({vm, getBlockly, getLocale})` は、コード領域のコマンドブロックの右クリックメニューに「ブレークポイントを設定」「ブレークポイントを外す」を加え、編集中のスプライトで印を付けたブロックを赤い縁と左側の赤い点で示す（規則は `debugger-panel.css`）。`getBreakpoints(vm)` は VM ごとの印を返す。印は編集中のセッションだけに持ち、作品には書かない。作品を読み込むと消える。

印を付けたブロックが動く直前に、デバッガーアドオン自身の一時停止で止める。そのため、アドオンの Threads タブ・Step・再開は、ブレークポイントブロックのときと同じように使える。アドオンが無効なときは、メニューに項目を出さない。

VM は変更しない。印がひとつでもある間だけ `runtime.getOpcodeFunction`・`runtime._pushThread`・`runtime._restartThread` を包み、最後の印を外すと元に戻す。

- スレッドが印の付いたブロックに着くと、そのブロックが最初に動かす関数の代わりに一時停止し、レポーターの応答を待つときと同じようにフレームを待たせる。再開すると、ブロックを最初から実行する。同じブロックに留まって待つ間や、ループの頭へ戻ったときは、着いたときの一度だけ止まる。
- コンパイル済みのスクリプトはブロックごとの関数を呼ばないため、印のあるスプライト（クローンを含む）で始まるスクリプトはコンパイルしない。印のないスプライトはこれまでどおりコンパイルする。すでにコンパイル済みで動いているスクリプトは、もう一度始めるまで止まらない。メニューの項目でそのことを示す。

## Editor と組み合わせたローカル検証

`npm test` でタブの状態管理、ファイルメニューの操作、既存レイアウトを検証する。
`TW_PLUS_LAYOUT_EDITOR_URL` に、固定済み Scratch GUI と組み合わせた Editor の URL を指定して
`npm run test:browser` を実行すると、既存のタブ列・編集パネル接続で Dockview を検証する。
ファイルメニューの任意接続を備えた GUI を確認する場合は、同じコマンドに
`TW_PLUS_LAYOUT_FILE_MENU_URL` を指定する。

npm への公開は `.github/workflows/release.yml` が行う。`main` への push で `package.json` の版が
npm にまだ無いときだけ、テストを通したうえで公開する。すでにある版では何もしない。認証はトークン
ではなく npm の Trusted Publisher（OIDC）で、`id-token: write` の権限を使う。npm 側の設定には
このワークフローのファイル名をそのまま登録するため、改名するときは npm の設定も合わせる。

Plus 標準配置ではスプライト編集タブを既定で表示する。`twPlusDockviewSpriteTabs=0` で従来の編集表示に戻る。
Editor がファイルメニューの接続口を提供している場合は、各項目のアイコンと「機能拡張の追加」を表示する。
`twPlusExtensionFileMenu=0` で左下のボタンに戻る。起動時のパラメーターを変更したら再読み込みする。

Web 版の Plus 標準配置で `twPlusDockview=1` を付けて起動すると、スプライト編集ペインを左右・上下に分割できます。同じスプライトを複数のペインで開いた場合、表示セクション、コスチュームと音の選択、素材一覧のスクロール位置をペインごとに保持します。変数の値はプロジェクト内で共有され、編集中のペインで変更できます。URL から `twPlusDockview=1` を外して再読み込みすると、通常のスプライトタブに戻ります。

スプライトと背景の編集タブには「自由配置」（コード領域）、「コスチューム / 背景」「音」、「変数」「メッセージ」がある。
「メッセージ」の表示は `@kubohiroya/turbowarp-plus-editor-sprite-panes` の `SpriteMessagePane` が担う。
`broadcast_msg` はステージ所有なので、メッセージ名の変更は作品全体に及ぶ。
送受信の判定は `@kubohiroya/turbowarp-plus-editor-project-model` の `messageReference` だけが持ち、Editor の作品内検索も同じ関数を使う。
このパッケージの `./project-messages` は、既存の import のためにそれを再 export している。

ホストが `getFunctions` を渡すと、「自由配置」の次に「ハット・関数一覧」と「呼び出し関係」がある（ボタンの並びは
`@kubohiroya/turbowarp-plus-editor-sprite-panes` のツールバーが決め、保存済みのレイアウトが持つセクションの番号は変わらない。「呼び出し関係」は次の番号を使う）。`SpriteFunctionPane` が、前者ではホストが `hats` で渡すハットのスクリプトとブロック定義を
一覧し（並べ方は名前順・Z順・N順）、後者では LR・TD の呼び出し図を表示する。並べ方・流れはビューごとに保つ。どちらで選んだ関数もホストの `openFunction` で、ハットのスクリプトは `openScript` で開く（スプライトの横のタブなど）。`openFunction` が無ければ関数はダイアログで開く。`createFunction(targetId, kind, name)` を渡すと、一覧の下と図の左下の「＋ 新しい関数を追加」で、名前を入れて標準のブロック定義か TurboWarp-Plus の名前付き関数を作れる。ダイアログはホストの
`mountFunctionEditor` を呼び、その定義のコード編集画面はホストが持つ。このパッケージは Scratch Blocks のコードを持たないためである。

## Editor の実装との責務分担

`./project-open-tabs` は、別の作品を新しいタブへ開く接続を提供します。元のタブの作品を
保存・再読み込み・停止せず、未保存の編集、Undo履歴、実行状態をそのまま残します。
ファイルを開く場合、ユーザーが選んだ新しいファイルと、その選択で許可されたファイルハンドルだけを
同一オリジンの一時的なBroadcastChannelで渡します。元の作品のスナップショットは作りません。
新しいタブから元のタブを操作できないように、`opener` を切り離します。
ポップアップが止められた場合は、明示的な再試行またはキャンセルを提示します。
新しいタブで機能拡張の実行を拒否すると、そのタブを閉じます。

URLを直接開いた場合は、開始画面を履歴へ追加しません。読み込みの拒否・失敗は
メイン画面に表示し、戻り先がなければ「前の画面に戻る」を無効化します。
「確認画面に戻る」は同じ作品の機能拡張を再確認します。URLを直接開いた場合は
作品指定を保持して開き直します。別タブへ渡したファイルは、その選択済みファイルを
再使用し、転送元のタブや転送終了済みのチャンネルには依存しません。
再確認だけでは実行を許可しません。`onReview`でホスト固有の再確認操作も渡せます。

表示・受け渡しの状態はこのパッケージが持ち、GUIは選択済みファイルと保存先の接続コールバックを渡します。
切り戻しはEditorの接続とパッケージの固定を直前の組み合わせへ戻します。作品データの移行はありません。

Editor 独自実装の移管元とライセンス確認は [EDITOR-MIGRATION.md](EDITOR-MIGRATION.md) に記録しています。
追加した公開 API は GUI モジュールを import せず、ホストから必要な値・データ・コールバックを受け取ります。

## URLからSB3ファイルを開く

Fileメニューの「SB3ファイルを開く…」の直下に「SB3ファイルのURLを開く…」を表示するには、`ProjectFileMenu` の `entries.openURL` を渡す。
`./project-url` の `openProjectURL(document, locale, ports)` はHTTP(S) URLの入力、取得、キャンセル、エラーと再試行を担当する。ホストはVM、保存サービス、未保存変更の判定、保存済みの作品名、フォルダ接続の解除、許可確認のキャンセル判定を渡す。

`./project-url` の `fetchProjectUrl(url, fetch?)` は、入力された URL を取得する。Scratch の作品ページ（`scratch.mit.edu/projects/<id>`）は Scratch の作品 API から、GitHub の紙芝居のリリースは CORS で配れる Pages の写しから先に取り、だめなら入力どおりに取得する。`./workspace-navigation` は、コード領域の操作部品（横方向のズーム、Code Views のミニマップ、コスチュームのサムネイル）を、浮いたステージを避けて配置する（`attachWorkspaceNavigation`）。Git のレビューのプレビューでも同じ配置にする（`attachReviewNavigation`・`attachCodePreviewMinimap`）。

取得中はキャンセルできる。取得後に未保存変更を確認し、VMの既存の読み込み処理を呼ぶため、作品サイズ・拡張機能の許可確認と進捗表示を再利用できる。読み込み中の中断は既存の確認フローに任せる。成功時だけ以前のフォルダとの接続を解除し、ローカル保存先のない作品として扱う。元のURLへ上書き保存は行わない。配信元はEditorからのCORSアクセスを許可する必要がある。

Web Editorは `project-open-tabs` の `url` コマンドで別タブのURL入力を開き、元の作品を保持する。URLコマンドが渡されないホストのメニューは従来どおり。検証は `npm run build` と `node --test test/project-url.test.ts test/project-file-menu.test.ts test/project-open-tabs.test.cts`。切戻しはEditorのURLコマンド接続を外し、Workbenchの固定版を直前版へ戻す。
