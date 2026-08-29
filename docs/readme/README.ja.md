<div align="center">

# SubTandem

**IINA向けリアルタイム二言語字幕翻訳**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000)](https://www.apple.com/macos/)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · **日本語** · [Русский](README.ru.md) · [العربية](README.ar.md) · [Français](README.fr.md)

</div>

---

SubTandemは、[IINA](https://iina.io/)で現在選択されているローカル動画の埋め込みテキスト字幕、または外部SRT/ASS字幕を翻訳し、独立したオーバーレイに自前で表示します。再生位置の少し先だけを範囲限定バッチで翻訳し、遅延や失敗時も元字幕の選択と動画の再生を維持します。

## 🎬 使用イメージ

SubTandemは元の字幕を表示したまま、選択した位置に翻訳字幕を独立して表示します。

<div align="center">

![IINAで日本語と英語の二言語字幕を表示するSubTandem](assets/real-time-bilingual-subtitle.webp)

</div>

## ✨ 機能

- **リアルタイム二言語字幕：** 元の字幕はIINAで選択したまま、SubTandemが別の字幕トラックを使わず、選択した垂直位置に翻訳を横方向中央揃えで表示します。
- **埋め込み・外部テキスト字幕：** ローカルMatroska SubRip/ASS/SSA、MOV/MP4 `mov_text`、外部SRT/ASSに対応します。extractorは同梱され、外部の`ffmpeg`や`ffprobe`は不要です。
- **翻訳サービスを選択可能：** OpenAI Chat CompletionsまたはClaude Messagesと互換性のあるendpoint、DeepSeek、ローカル/リモートのOllamaサーバーを利用できます。
- **再生を優先：** 翻訳処理によって動画が停止したり、元の字幕が非表示になったりすることはありません。
- **リクエスト範囲を制限：** 再生位置付近のcueだけを翻訳し、プレイヤーウインドウごとに同時処理を制限します。成功した翻訳は現在の動画セッション内でのみキャッシュします。
- **複数のProfile：** 翻訳サービスのProfileを保存・テストし、字幕テキストの送信先となる正確なendpointを明示的に選択できます。
- **プロキシ制御：** ProfileごとにmacOSのプロキシ設定または直接接続を選択できます。

## ✅ 動作要件

- macOS 12以降
- IINA 1.4.0以降
- 対応するローカル埋め込みテキスト字幕、または読み取り可能な外部SRT/ASS/SSA字幕
- 次のいずれかの翻訳サービス：
  - OpenAI endpoint、Model ID、およびサービスが必要とする場合はAPI key
  - ClaudeまたはClaude互換API root、API key、正確なModel ID
  - DeepSeek API keyと正確なDeepSeek Model ID
  - 対応モデルがインストール済みのOllamaサーバー

SubTandemは翻訳モデルをダウンロードしたり起動したりしません。

## 🚀 インストール

IINAを開き、**環境設定 → プラグイン**へ移動します。プラグイン管理画面では、次の方法でインストールできます。

<div align="center">

![「GitHubからインストール」と「パッケージをインストール」が表示されたIINAのプラグイン管理画面](assets/plugin-manager.webp)

</div>

### GitHubからインストール（推奨）

1. **GitHubからインストール…**をクリックします。
2. `user/repo`欄に`janwee-sha/SubTandem`と入力し、インストールを確定します。
3. インストール済みプラグインの一覧にSubTandemが表示されるまで待ちます。

<div align="center">

![GitHubからSubTandemをインストールするIINAのダイアログ](assets/install_from_github.webp)

</div>

SubTandem v0.1.0にはIINAのアップデート情報が含まれています。上記のいずれかの方法でインストールすると、IINAで後続バージョンを確認してインストールできます。

### ダウンロードしたパッケージをインストール

1. [Releases](https://github.com/janwee-sha/SubTandem/releases)ページから最新の`SubTandem-X.Y.Z.iinaplgz`をダウンロードします。
2. **環境設定 → プラグイン**に戻り、**パッケージをインストール…**をクリックします。
3. ダウンロードした`.iinaplgz`ファイルを選択し、インストールを確定します。

### プラグイン一覧からインストール（IINA開発版）

IINAの開発版では、利用可能なプラグイン一覧からSubTandemを直接インストールできます。

1. **環境設定 → プラグイン**を開き、新規プラグインのインストール画面に進みます。
2. 利用可能なプラグイン一覧から**SubTandem**を選択します。
3. インストールを確定し、インストール済みプラグインの一覧にSubTandemが表示されるまで待ちます。

<div align="center">

![IINA開発版の利用可能なプラグイン一覧で選択されたSubTandem](assets/install_from_plugins_list.webp)

</div>

いずれの方法でも、権限を求められた場合は承認し、SubTandemの横にあるチェックボックスが有効になっていることを確認してからIINAを再起動します。その後、動画を再生してIINAのサイドバーを開き、**SubTandem**タブを選択します。

## 🌍 クイックスタート

1. ローカル動画を開き、対応する埋め込みテキスト字幕または外部SRT/ASSをIINAの主字幕として選択します。
2. **Languages**で母語を選択します。IINAが字幕言語を識別できない場合は手動で確認し、言語設定を保存します。
3. **Translation service**でOpenAI、Claude、DeepSeek、またはOllamaのProfileを作成します。認証が必要な場合は、API keyを入力してからモデル一覧を手動で更新します。返されたモデルを選ぶか、正確なカスタムModel IDを入力します。
4. Profileを保存してテストし、**Select**をクリックします。Profileを選択すると、表示されたendpointへ再生位置付近の字幕テキストを送信することをSubTandemに明示的に許可します。
5. **Translate**をオンにします。元の字幕はIINAでそのまま表示され、翻訳されたcueはSubTandemのオーバーレイに表示されます。**Languages**の**Translation position**で、オーバーレイを上（`0`）から下（`100`）まで移動できます。

Endpoint、モデル、API key、またはネットワーク経路を変更した場合は、更新したProfileを保存し、翻訳前に再選択してください。

## ⚙️ 翻訳サービス

### OpenAI

- 完全な`/chat/completions` URLではなく、`https://example.com/v1`のようなAPI rootを入力します。
- SubTandemが`/chat/completions`を追加し、最終的なリクエストURLをサイドバーに表示します。
- サービスが公開している正確なモデル識別子を入力します。
- Endpointが認証なしのリクエストを許可する場合に限り、Bearer API keyを省略できます。保存後、key入力欄は書き込み専用となり、再表示されません。
- リモートendpointはHTTPSを使用する必要があります。

### Claude

- デフォルトAPI rootは`https://api.anthropic.com`です。このrootまたはClaude互換rootを入力し、完全な`/v1/messages`や`/v1/models` URLは入力しないでください。リモートendpointにはHTTPSが必要です。
- SubTandemは`/v1/messages`で非ストリーミングのネイティブMessagesを使い、`/v1/models`からモデル一覧を取得します。互換サービスには、このrouteとClaudeの認証・version headerが必要です。
- API keyは必須です。新規Profileでは手動更新の前に入力してください。自動更新が未保存のkeyを送ることはありません。返されたモデルまたは正確なカスタムModel IDを選びます。
- **Save → Test → Select**の順に操作します。SaveとTestは字幕テキストを許可せず、Select前にendpointへ届く可能性があるのは字幕を含まないモデル一覧だけです。
- ClaudeはMessagesリクエストを課金し、認証、モデルアクセス、spend limit、クォータ、rate limit、拒否を適用する場合があります。保存後のkeyは書き込み専用です。

### DeepSeek

- 固定のデフォルトAPI rootは`https://api.deepseek.com`です。翻訳には`/chat/completions`、モデル一覧には`/models`を追加します。
- モデル一覧を更新するか、正確なカスタムModel IDを入力します。SubTandemはDeepSeekモデルを事前選択、推奨、推測しません。
- 公式サービスには利用可能なAPI keyが必要です。保存後の入力欄は書き込み専用で、keyは再表示されません。
- **Save**と**Test**はProfileを選択せず、字幕テキストの送信も許可しません。明示的に**Select**してください。それまでは、字幕を含まないモデル一覧リクエストだけがデフォルトrootへ送信される場合があります。
- DeepSeekはリクエスト料金を請求し、残高、クォータ、rate limitを適用する場合があります。

### Ollama

- デフォルトのサーバーrootは`http://127.0.0.1:11434`です。
- `translategemma:12b`や`qwen3:14b`など、インストール済みモデルの正確なtagを入力します。
- Ollamaサーバーが未認証リクエストを許可する場合、Bearer API keyは省略でき、保存後は書き込み専用です。
- 接続テストでは、サーバー、インストール済みtag、structured-output chatの対応状況を確認します。

どのサービスでも、まず**Use macOS proxy settings**を使用してください。設定済みのシステムプロキシがサービスへのアクセスを妨げる場合のみ、**Connect directly**を選択します。

## 🔒 プライバシー、認証情報、料金

- SubTandemが明示的に選択したProfileへ送信するのは、再生位置付近の字幕テキスト、言語方向、不透明なcue ID、少量の隣接コンテキストだけです。動画や音声の内容は送信しません。
- `video-overlay`権限は、現在の翻訳をローカルの非対話型Overlayに表示するためだけに使います。Overlayは入力や動画上でのドラッグを受け付けず、ネットワークやWebViewストレージを使用せず、再生セッションとともに消去されます。
- OpenAI、Claude、DeepSeek、OllamaのAPI keyは、プラグイン専用の`credentials.json`にローカル平文で保存されます。ディレクトリの権限は`0700`、ファイルの権限は`0600`です。KeyはIINA preferences、ログ、診断、Sidebar状態、プラグインパッケージには書き込まれず、保存後に再表示されません。
- ファイル権限は、ほかのmacOSアカウントや通常の偶発的アクセスからkeyを保護しますが、現在のmacOSユーザーとしてすでにファイルを読み取れるプロセスからは保護できません。
- 同梱のtransport helperは一時的な`127.0.0.1`ポートだけで待ち受けます。設定中または保存済みのendpoint（デフォルトのClaude root `https://api.anthropic.com`とDeepSeek root `https://api.deepseek.com`を含む）は、Select前に字幕を含まないモデル一覧リクエストを受け取る場合があります。字幕テキストを受け取るのは選択済みProfileのリビジョンだけです。
- 翻訳は現在の動画セッション内でのみキャッシュされ、動画の変更、再生終了、ウインドウを閉じたときに消去されます。
- 翻訳Providerはリクエスト料金を請求し、独自のデータ・コンテンツポリシーを適用する場合があります。バッチ処理とキャッシュは呼び出し回数を減らしますが、料金の上限を保証するものではありません。

## 📌 現在の対象範囲

SubTandemは、音声文字起こし、画像ベース字幕のOCR/抽出、リモートメディアの埋め込み字幕抽出、動画全体の事前翻訳、書き出し、クラウド同期、永続キャッシュには対応していません。抽出した一時データは解析、取消、タイムアウト、終了時に削除します。

## 🛠️ トラブルシューティング

- **Select a supported text subtitle:** ローカル埋め込みSubRip/ASS/SSA/`mov_text`または外部SRT/ASSを主字幕として選択してください。画像ベースとリモート埋め込み字幕は非対応です。状態表示に従って再選択するか、準備失敗後にRetryしてください。
- **Confirm the subtitle language:** `en-US`などのBCP 47言語tagを入力し、言語設定を保存してください。
- **Translation service unavailable:** Profileをテストし、endpoint、正確なModel ID、API key、ネットワーク経路、Ollamaプロセスを確認してください。ClaudeではAPI root、Messages互換性、認証/version、モデルアクセス、spend limit、クォータ、rate limit、拒否を、DeepSeekでは残高、クォータ、rate limit、固定API routeを確認してください。再生と元字幕は継続します。
- **Credential could not be saved:** 不完全な開発用コピーではなくReleaseパッケージをインストールし、プラグインデータディレクトリが書き込み可能であることを確認してから、IINAを完全に終了して再起動してください。
- **翻訳が表示されない：** Profileがテスト済みで選択されていること、字幕言語と母語が異なること、**Translate**が有効であること、再生位置が翻訳済みcueの時間範囲内にあることを確認してください。
- **プロキシがサービスをブロックする：** まずデフォルトのmacOSプロキシ経路を試します。プロキシがサービスを拒否する場合、そのProfileを**Connect directly**に変更して保存し、再度Select/Testしてください。

## ☕ SubTandemを支援

SubTandemがお役に立った場合は、[Afdian](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link)または[Ko-fi](https://ko-fi.com/ianhsia)で、作者にコーヒーを一杯おごる形で任意に支援できます。

SubTandemはすべての人に無料で全機能を提供します。支援によって追加機能、優先翻訳、専用ビルドが解放されることはなく、翻訳サービスのAPIクレジットも含まれません。選択したProviderは、その利用規約とコンテンツポリシーに基づいて別途料金を請求する場合があります。
