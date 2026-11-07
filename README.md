# CGP Launcher Rebuilt

旧CGPランチャーの画面操作をもとに作成したWindows向けランチャーです。
ゲームカタログ・ロゴを既存アプリから引き継ぎ、アプリのコードは新規に実装しています。

## ダウンロード・起動

[最新版のリリース](https://github.com/Ren112-lotus/CGPLauncher/releases/latest) から
`CGP-Launcher-Rebuilt-Setup-1.5.0-x64.exe` をダウンロードしてインストールしてください。
ランチャー本体にPythonは不要です。

v1.0.3以前のZIP版には更新機能がないため、最初の一度だけセットアップ版を
インストールしてください。設定・お気に入り・ダウンロード済みゲームの登録は
同じデータフォルダを使って引き継ぎます。

## 自動アップデート

- 起動から10秒後、その後は6時間ごとにGitHub Releasesの正式版を確認します。
- 新しい版をバックグラウンドでダウンロードし、SHA-512でファイルを検証します。
- 自動更新がオンの場合、ダウンロード済みの更新をランチャーの通常終了時に自動適用します。次回起動から新版になります。
- 「再起動して更新」を押して、今すぐ適用・再起動することもできます。
- Windowsゲームの実行中・ゲームのダウンロード／起動準備中は適用を待ちます。モーダルのWebゲームはランチャーの通常終了時に閉じます。
- Windowsのシャットダウン・ログオフ時にはインストーラーを起動しません。
- 設定の「アップデート」で手動確認や自動確認のオン・オフができます。
- 通信に失敗した場合は設定から再試行できます。開発版では更新を実行しません。

## ソースから起動

WindowsとNode.js 22.12以降が必要です。

ソースから起動する場合はNode.jsをインストールした環境で次を実行します。

```sh
npm ci
npm start
```

npmでインストールスクリプトを無効にしている場合は、初回に
`node node_modules/electron/install.js` を実行してElectronを取得してください。

## UIの編集（Tailwind CSS 4）

画面レイアウトは `src/index.html`、ゲームカードや詳細画面は `src/app.js` の
Tailwindユーティリティクラスで編集します。

`src/tailwind.css` はTailwindの入力ファイルです。
`@theme inline` に配色・フォント・影を定義し、ダーク／ライトの変数を切り替えます。
共通のボタン、ナビゲーション、Markdown本文は `@layer components` で管理します。
カード・ボタン・入力欄・モーダル・ウィンドウは角丸を使わず、直線的な形に統一しています。
Windowsのタイトルバーをドラッグするための `app-drag` / `app-no-drag` は独自ユーティリティです。

UIアイコンは [Lucide](https://lucide.dev/guide/static) のSVGを使用しています。
`tools/icons.cjs` の対応表を編集し、`npm run icons:build` で `src/icons.js` と
`assets/icons/` を再生成します。使用する32種類のみを同梱し、実行時のCDN接続は不要です。
元のSVGとISC／Feather MITライセンスは `assets/icons/` にあります。

```sh
npm run css:watch  # 編集中のCSS自動生成
npm run css:build  # CSSを一度生成
npm run icons:build # Lucideから使用アイコンを生成
npm test          # コア機能のテスト
npm run test:electron # Electronで別ドメインのフレームとWebAudio・音量制御を検証
npm run build     # アイコン・CSS生成 → Windows x64版を作成
npm run verify:release # インストーラー・更新ファイル・チェックサムを検証
```

`src/style.css` は生成物です。直接編集せず、HTML・JavaScript・`tailwind.css` を修正してください。
走査対象は `@source` でこのHTMLとJavaScriptに限定しています。
クラス名を追加するときは `bg-${color}` のような組み立てを避け、完全なクラス名を記述してください。
CSSはアプリに同梱され、実行時のCDNやTailwindランタイムは不要です。

## 機能

- ゲーム検索、作者／タグ検索、グリッド／リスト表示、並び替え
- 起動直後はUnity Roomのゲームだけを表示。絞り込みの「配布形式」で全作品／Windowsにも切り替え可能
- お気に入り、インストール済み、最近遊んだゲームの絞り込み
- 左側の検索・ゲーム一覧と、右側の画像背景・詳細を組み合わせた元ランチャーに沿う画面
- ロゴ右のボタンでサイドバーをアニメーション付きで表示／非表示（約0.3秒）
- 非表示時も左上のボタンから再表示でき、Ctrl+Kで開いて検索欄へフォーカス
- 絞り込み・並び替えは検索欄右端のアイコンから開く
- Unity Roomのゲーム本体だけを中央のモーダルに表示。投稿ページの広告・コメント・ナビゲーションは読み込みません
- 起動・再読み込みのたびに公開ページの署名付きプレイURLを取得し、期限切れURLを保存しません。ブラウザで開く操作は元の作品ページを開きます
- モーダル上部の音量スライダー（0〜100%）とミュート。設定を次回も保持し、ゲーム内のWebAudioと音声・動画に反映
- モーダル右上の最大化ボタンで、タイトルバーを残してゲーム画面をランチャー内いっぱいに表示。同じボタンで通常サイズに戻し、ゲームのプレイ状態を維持
- WebViewは右上の×、またはWebView内で Ctrl+W を押して閉じる
- GitHub ReleasesのZIP取得、展開、実行ファイル選択、起動状態表示
- GitHub README表示、外部ブラウザで開く
- SitesのカタログAPIから同期、オフライン時の保存済みカタログ表示
- カタログは起動時・1分ごと・ランチャーに戻ったときに自動同期（設定でオフにできます）
- ダウンロード先、起動時同期、ダーク／ライト／システムテーマの保存
- 旧ランチャー標準保存先のメタデータからインストール済みゲームを自動検出

## データと制約

ゲーム情報の管理は [CGP ゲーム管理](https://cgp-catalog.renren112.chatgpt.site/) で行います。
管理者のChatGPTアカウントでログインし、編集して「保存する」を押してください。
「公開中」のゲームだけ [カタログAPI](https://cgp-catalog.renren112.chatgpt.site/api/games) に配信されます。
既定のGitHub games.json URLを使っていた設定は、v1.2.0でSitesへ自動移行します。
独自に指定したカタログURL、お気に入り、インストール情報、履歴は保持します。
ゲームごとの固定IDがあるため、Sitesで作品名や配布URLを編集しても登録を引き継げます。
ビルド時はSitesからオフライン用カタログを取得します。ルートのgames.jsonと旧Pythonエディターは旧版用の保存資料です。
アプリ本体の自動更新・Windowsゲームの配布にはGitHub Releasesを使用します。

設定やゲームの標準保存先は `%APPDATA%/CGP Launcher Rebuilt` です。
旧ランチャーから検出したゲームは元の場所を参照します。旧アプリのGamesフォルダを
移動・削除すると、引き継いだゲームは起動できなくなります。
GitHub配布ゲームの更新は新しいフォルダへ展開し、旧バージョンのゲームファイルは自動削除しません。

GitHubの公開APIはアクセス回数制限があります。READMEとリリース情報をキャッシュします。
Webゲームの動作・広告・通信先は配布元に依存します。WebViewで動かない場合は
「ブラウザで開く」を利用してください。
配布版はコード署名していません。

## 参照

- [Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli)
- [Tailwindテーマとディレクティブ](https://tailwindcss.com/docs/functions-and-directives)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [元の公開ゲームカタログ](https://raw.githubusercontent.com/Ren112-lotus/CGPLauncher/refs/heads/main/games.json)

## ゲーム一覧の編集

リポジトリ直下の `games.json` が公開ゲームリストです。既存の `games_editor.py` と
`start.bat` も引き続き利用できます。エディターにはPythonとtkinterが必要です。

```sh
python games_editor.py
```

[エディターのマニュアル](games_editor_manual.md) / [従来のREADME](docs/legacy-readme.md)

`npm run build` はルートの `games.json` を検証し、オフライン起動用の
`assets/games.json` にコピーしてからWindows版を生成します。
出力先はリポジトリの隣の `CGP-Launcher-Windows/<バージョン>/` です。
既存のゲームリスト・バックアップ・旧リリースは引き継いでいます。

## 更新版の配布

`package.json` のバージョンを上げ、`npm test` と `npm run build` を実行します。
ビルドはインストーラーに加え、差分配信用の `.exe.blockmap` と更新情報の
`latest.yml` を生成し、バージョン・SHA-512・配布先設定を検証します。

ソースをコミット・pushした後、同じコミットを指す `v<バージョン>` のGitHub Releaseに
次の3ファイルを添付して正式版として公開してください。

- `CGP-Launcher-Rebuilt-Setup-<バージョン>-x64.exe`
- `CGP-Launcher-Rebuilt-Setup-<バージョン>-x64.exe.blockmap`
- `latest.yml`

`latest.yml` とインストーラーは必ず同じビルドのものを公開します。
更新先は `Ren112-lotus/CGPLauncher` に固定され、ゲームリストURLの設定とは独立しています。
`win-unpacked` はビルド確認用です。利用者にはセットアップ版を配布してください。
