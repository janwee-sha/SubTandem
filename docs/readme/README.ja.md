<div align="center">

# SubTandem

**IINA向けリアルタイム二言語字幕翻訳**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release&style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![Downloads](https://img.shields.io/github/downloads/janwee-sha/SubTandem/total?style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff?style=for-the-badge&logo=apple&logoColor=white)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge&logo=gnu&logoColor=white)](https://github.com/janwee-sha/SubTandem/blob/main/LICENSE)

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
- **翻訳スタイルを保持：** **Subtitle**でFontの色、Size、フォント、Bold/Italic、Borderの色とWidth、Backgroundの色を調整できます。初期値は白色、Size 40、システムフォント、黒色Width 3の縁取り、透明背景です。3つの色はプリセットとアルファ対応の**Show Colors…**を共有します。保存したフォントが利用できない場合は一時的にシステムフォントを使い、再び利用可能になると自動復元します。
- **埋め込み・外部テキスト字幕：** ローカルMatroska SubRip/ASS/SSA、MOV/MP4 `mov_text`、外部SRT/ASSに対応します。extractorは同梱され、外部の`ffmpeg`や`ffprobe`は不要です。
- **翻訳サービスを選択可能：** OpenAI、Claude、DeepSeek、Ollamaを利用できます。OpenAIやClaudeと互換性のあるサービスにも接続できます。
- **再生を優先：** 翻訳処理によって動画が停止したり、元の字幕が非表示になったりすることはありません。
- **リクエスト範囲を制限：** 再生位置付近のcueだけを翻訳し、プレイヤーウインドウごとに同時処理を制限します。成功した翻訳は現在の動画セッション内でのみキャッシュします。
- **複数のProfile：** グループ化された一覧でProfileを展開してその場で編集するか、見出し横の**New profile**を使えます。Testは現在のドロワー草稿を検証し、独立したスイッチだけが保存済みの正確なリビジョンを全ウィンドウで有効化します。
- **プロキシ制御：** 新しいProfileは直接接続が初期値で、必要に応じて現在のmacOSプロキシ設定へ変更できます。

## ✅ 動作要件

- macOS 12以降
- IINA 1.4.0以降
- 対応するローカル埋め込みテキスト字幕、または読み取り可能な外部SRT/ASS/SSA字幕
- 利用可能なモデルを持つOpenAI、Claude、DeepSeek、Ollamaのいずれかのサービス。設定方法は以下を参照してください。

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
2. **Subtitle**で正確なターゲット言語を選択します。選択した翻訳Providerが翻訳リクエスト内でcueごとのソース言語を理解するため、ソース言語の手動確認は不要です。
3. **Translation service**で**New profile**を選び、OpenAI、Claude、DeepSeek、またはOllamaのProfileを作成します。新しい草稿は**Connect directly**が初期値です。認証が必要な場合はAPI keyを入力してからモデル一覧を手動更新します。
4. 左下の**Test**で現在の草稿を保存せずに検証し、右下の**Save**で保存してから独立したスイッチをオンにします。Testの固定プローブは課金される場合がありますが、再生中の字幕送信、入力したkeyの保存、Profileの有効化は行いません。
5. **Translate**をオンにします。元の字幕はIINAでそのまま表示され、翻訳されたcueはSubTandemのオーバーレイに表示されます。**Subtitle**の**Position**で、オーバーレイを上（`0`）から下（`100`）まで移動できます。
6. **Font**、**Border**、**Background**の各グループで8項目のテキストスタイルを選びます。色のプリセットは直接保存され、**Show Colors…**はmacOSのカラーパネルを開きます。変更せずに閉じた場合は以前の値を保持します。

Profileの概要を展開するとその場で編集できます。操作行は左に**Test**、右に**Cancel**、**Delete**、**Save**の順で並び、新しい草稿にはDeleteがありません。現在値をテストして保存した後、新しいリビジョンを有効化してください。

## ⚙️ 翻訳サービス

### OpenAI

- デフォルトのAPI rootは`https://api.openai.com/v1`です。OpenAI公式サービスでは、**API key**を入力し、アカウントで利用できるモデルを選びます。
- モデル一覧を更新してモデルを選ぶか、正確な**Model ID**を入力します。
- OpenAI互換サービスでは、**Endpoint**をそのサービスのAPI rootに変更します。SubTandemは`/chat/completions`を追加し、リクエストURLをサイドバーに表示します。API keyが不要なサービスでは**API key**を空欄にできます。

### Claude

- デフォルトのAPI rootは`https://api.anthropic.com`です。Claude公式サービスでは、Anthropicの**API key**を入力し、アカウントで利用できるモデルを選びます。
- モデル一覧を更新してモデルを選ぶか、正確な**Model ID**を入力します。
- Claude互換サービスでは、**Endpoint**をそのサービスのAPI rootに変更します。SubTandemは翻訳に`/v1/messages`、モデル一覧に`/v1/models`を使います。現行バージョンのClaude Profileでは、モデル一覧の更新、テスト、保存、有効化に**API key**が必要です。

### DeepSeek

- デフォルトのAPI rootは`https://api.deepseek.com`です。DeepSeek公式サービスでは、**API key**を入力し、アカウントで利用できるモデルを選びます。
- モデル一覧を更新してモデルを選ぶか、正確な**Model ID**を入力します。SubTandemはDeepSeekモデルを自動選択しません。
- 別の互換API rootを使うサービスでは、**Endpoint**を変更します。SubTandemは翻訳時に`/chat/completions`を追加します。

### Ollama

- デフォルトのサーバーアドレスは`http://127.0.0.1:11434`で、お使いのコンピューター上のOllamaに接続します。先にOllamaを起動し、対応モデルをインストールしてください。
- モデル一覧を更新してインストール済みモデルを選ぶか、正確な**Model ID**を入力します。
- リモートのOllamaサーバーでは、**Endpoint**をそのサーバーのアドレスに変更します。サーバーが要求する場合のみ**API key**を入力します。**Test**で接続、モデル、構造化出力への対応を確認できます。

新しいProfileは**Connect directly**が初期値です。ネットワークでプロキシが必要な場合は**Use macOS proxy settings**を選びます。保存したAPI keyは再表示されません。

## 🔒 プライバシー、認証情報、料金

- SubTandemが明示的に選択したProfileへ送信するのは、再生位置付近の字幕テキスト、正確なターゲット言語、不透明なcue ID、少量の隣接コンテキストだけです。Providerは同じ翻訳リクエスト内でソース言語を理解します。動画や音声の内容は送信しません。
- `video-overlay`権限は、現在の翻訳をローカルの非対話型Overlayに表示するためだけに使います。Overlayは入力や動画上でのドラッグを受け付けず、ネットワークやWebViewストレージを使用せず、再生セッションとともに消去されます。
- プラグイン専用の`credentials.json`は、Profile、グローバルに有効なProfile参照、OpenAI、Claude、DeepSeek、OllamaのAPI keyを、原子的に置換する1つのローカル文書に保存します。Keyは平文のままで、ディレクトリの権限は`0700`、ファイルは`0600`です。KeyはIINA preferences、ログ、診断、Sidebar状態、パッケージには書き込まれず、保存後に再表示されません。
- ファイル権限は、ほかのmacOSアカウントや通常の偶発的アクセスからkeyを保護しますが、現在のmacOSユーザーとしてすでにファイルを読み取れるプロセスからは保護できません。
- 同梱のtransport helperは一時的な`127.0.0.1`ポートだけで待ち受けます。設定中または保存済みのendpointは字幕を含まないモデル一覧リクエストを受信する場合があります。**Test**は現在の草稿へ課金される可能性がある固定の字幕なしプローブを送り、新しく入力したkeyは別途保存しない限りそのテストだけに使用されます。字幕テキストを受け取るのはグローバルに有効なProfileリビジョンだけです。
- 翻訳は現在の動画セッション内でのみキャッシュされ、動画の変更、再生終了、ウインドウを閉じたときに消去されます。
- 短いトラック、ソース言語が不明なテキスト、正確なターゲット言語と同じテキストも選択済みProviderへ送信され、料金が発生する場合があります。Provider独自のポリシーが適用され、バッチ処理とセッションキャッシュは呼び出し回数を減らしますが料金上限は保証しません。

## 📌 現在の対象範囲

SubTandemは、音声文字起こし、画像ベース字幕のOCR/抽出、リモートメディアの埋め込み字幕抽出、動画全体の事前翻訳、書き出し、クラウド同期、永続キャッシュには対応していません。抽出した一時データは解析、取消、タイムアウト、終了時に削除します。

## 🛠️ トラブルシューティング

- **Select a supported text subtitle:** ローカル埋め込みSubRip/ASS/SSA/`mov_text`または外部SRT/ASSを主字幕として選択してください。画像ベースとリモート埋め込み字幕は非対応です。状態表示に従って再選択するか、準備失敗後にRetryしてください。
- **翻訳に失敗する：** Sessionに表示される具体的な対処方法に従ってください。原因に応じてProfileをテストし、endpoint、正確なModel ID、API key、ネットワーク経路、アカウント上限、Ollamaプロセスを確認します。再生と元字幕は通常どおり継続します。
- **Credential could not be saved:** 不完全な開発用コピーではなくReleaseパッケージをインストールし、プラグインデータディレクトリが書き込み可能であることを確認してから、IINAを完全に終了して再起動してください。
- **翻訳が表示されない：** 対象Profileのスイッチと**Translate**が両方オンであり、再生位置が翻訳済みcueの時間範囲内にあることを確認してください。
- **ネットワークやプロキシの問題：** 新しいProfileは直接接続します。ネットワークでプロキシが必要な場合は、そのProfileで**Use macOS proxy settings**を選び、保存、テスト、新しいリビジョンの有効化を行ってください。

## ☕ SubTandemを支援

SubTandemがお役に立った場合は、[Afdian](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link)または[Ko-fi](https://ko-fi.com/ianhsia)で、作者にコーヒーを一杯おごる形で任意に支援できます。

SubTandemはすべての人に無料で全機能を提供します。支援によって追加機能、優先翻訳、専用ビルドが解放されることはなく、翻訳サービスのAPIクレジットも含まれません。選択したProviderは、その利用規約とコンテンツポリシーに基づいて別途料金を請求する場合があります。
