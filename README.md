<div align="center">

# SubTandem

**Real-time bilingual subtitle translation for IINA**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release&style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![Downloads](https://img.shields.io/github/downloads/janwee-sha/SubTandem/total?style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff?style=for-the-badge&logo=apple&logoColor=white)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge&logo=gnu&logoColor=white)](https://github.com/janwee-sha/SubTandem/blob/main/LICENSE)

**English** · [简体中文](docs/readme/README.zh-CN.md) · [한국어](docs/readme/README.ko.md) · [日本語](docs/readme/README.ja.md) · [Русский](docs/readme/README.ru.md) · [العربية](docs/readme/README.ar.md) · [Français](docs/readme/README.fr.md)

</div>

---

SubTandem translates the local embedded text subtitle or external SRT/ASS subtitle currently selected in [IINA](https://iina.io/) and renders the translation itself in an independent overlay. It looks only a short distance ahead of playback, translates in bounded batches, and keeps the original subtitle selection and video playing when a translation is delayed or fails.

## 🎬 In Action

SubTandem keeps the original subtitle visible while independently displaying the translation at your chosen position.

<div align="center">

![SubTandem displaying Japanese and English bilingual subtitles in IINA](docs/readme/assets/real-time-bilingual-subtitle.webp)

</div>

## ✨ Features

- **Live bilingual subtitles:** Keep the original subtitle selected in IINA while SubTandem renders translations centered horizontally at your chosen vertical position without occupying another subtitle track.
- **Persistent translation styling:** Adjust Font color, Size, family, Bold/Italic, Border color/Width, and Background color under **Subtitle**. Defaults are white Size 40 system text, black Width 3 border, and transparent background. All three colors share presets and **Show Colors…** with alpha; an unavailable saved font temporarily uses the system font and restores automatically when available.
- **Embedded and external text subtitles:** Works with local Matroska SubRip/ASS/SSA, local MOV/MP4 `mov_text`, and readable external SRT/ASS tracks selected in IINA. The release includes the required extractor; no external `ffmpeg` or `ffprobe` is needed.
- **Your choice of translation service:** Use an OpenAI Chat Completions-compatible endpoint, Claude Messages-compatible endpoint, DeepSeek, or a local/remote Ollama server.
- **Playback-first behavior:** Translation work never pauses the video or hides the original subtitle.
- **Bounded requests:** SubTandem translates only nearby cues, limits concurrent work per player window, and caches successful results only for the current video session.
- **Multiple profiles:** Expand a profile in the grouped list to edit it, or use **New profile** beside the section title. Test the current drawer draft, then use the independent switch to enable one exact saved revision globally across windows and restarts.
- **Proxy control:** New profiles connect directly by default; each profile can instead use the current macOS proxy settings.

## ✅ Requirements

- macOS 12 or later
- IINA 1.4.0 or later
- A supported local embedded text subtitle or readable external SRT/ASS/SSA track
- One of the following translation services:
  - An OpenAI endpoint, model ID, and an API key when required by the service
  - A Claude or Claude-compatible API root, API key, and exact model ID
  - A DeepSeek API key and an exact DeepSeek model ID
  - An Ollama server with a compatible model already installed and an API key when required

SubTandem does not download or start translation models.

## 🚀 Installation

Open IINA and go to **Settings → Plugins**. The plugin manager supports the installation methods below.

<div align="center">

![IINA plugin manager showing Install from GitHub and Install Package](docs/readme/assets/plugin-manager.webp)

</div>

### Install from GitHub (recommended)

1. Click **Install from GitHub…**.
2. Enter `janwee-sha/SubTandem` in the `user/repo` field, then confirm the installation.
3. Wait for SubTandem to appear in the installed plugins list.

<div align="center">

![IINA dialog for installing SubTandem from GitHub](docs/readme/assets/install_from_github.webp)

</div>

SubTandem v0.1.0 includes IINA update metadata. Install it by any method above so IINA can check for and install later releases.

### Install a downloaded package

1. Open the [Releases](https://github.com/janwee-sha/SubTandem/releases) page and download the latest `SubTandem-X.Y.Z.iinaplgz` package.
2. Return to **Settings → Plugins** and click **Install Package…**.
3. Select the downloaded `.iinaplgz` file and confirm the installation.

### Install from the plugin list (IINA development builds)

Development builds of IINA can install SubTandem directly from the available plugins list.

1. Open **Settings → Plugins**, then open the new plugin installation dialog.
2. Select **SubTandem** from the available plugins list.
3. Confirm the installation and wait for SubTandem to appear in the installed plugins list.

<div align="center">

![SubTandem selected in the available plugins list in an IINA development build](docs/readme/assets/install_from_plugins_list.webp)

</div>

After any installation method, approve the requested plugin permissions if prompted, make sure the checkbox next to SubTandem is enabled, and restart IINA. Then play a video, open IINA's sidebar, and select the **SubTandem** tab.

## 🌍 Quick Start

1. Load a local video and select a supported embedded text subtitle or external SRT/ASS subtitle as the primary subtitle in IINA.
2. Under **Subtitle**, select the exact target language. The selected translation service understands each cue's source language inside the translation request; there is no source-language confirmation step.
3. Under **Translation service**, choose **New profile** and create an OpenAI, Claude, DeepSeek, or Ollama profile. New drafts use **Connect directly** by default. If the service requires authentication, enter its API key before manually refreshing the model list. Select a returned model, or enter an exact custom Model ID.
4. Use **Test** at the lower left to test the current draft without saving it, then **Save** it at the lower right and turn on its independent switch. Test may make a billable fixed request, but it sends no playing subtitle text, does not save the entered key, and does not enable the profile.
5. Turn on **Translate**. The original subtitle remains selected in IINA; translated cues appear in SubTandem's overlay. Under **Subtitle**, use **Position** to move the overlay from top (`0`) to bottom (`100`).
6. In the **Font**, **Border**, and **Background** groups, choose the eight text style values. Select a color preset for a direct save, or choose **Show Colors…** for the macOS color panel; closing it without a change keeps the previous value.

Expand a profile summary to edit it in place. The action row keeps **Test** on the left and **Cancel**, **Delete**, **Save** on the right; a new draft omits Delete. Test the current values, save the update, and enable the new revision before translating.

## ⚙️ Translation Services

### OpenAI

- Enter the API root, for example `https://example.com/v1`, not a complete `/chat/completions` URL.
- SubTandem appends `/chat/completions` and previews the resulting request URL in the sidebar.
- Refresh the endpoint's model list and choose a returned identifier, or enter an exact custom Model ID.
- The bearer API key is optional only when the endpoint accepts unauthenticated requests. The field is write-only after saving.
- Remote endpoints must use HTTPS.

### Claude

- The default API root is `https://api.anthropic.com`. Enter that root or a Claude-compatible root, not a complete `/v1/messages` or `/v1/models` URL; remote endpoints must use HTTPS.
- SubTandem uses native, non-streaming Messages requests at `/v1/messages` and model discovery at `/v1/models`. A compatible service must implement those routes and Claude authentication/version headers. Translation requests use Claude structured JSON output when supported; if a compatible service explicitly rejects that capability, SubTandem retries once without it, and the additional request may be billed.
- A key is required. For a new profile, enter it before manually refreshing models; automatic refresh never sends an unsaved key. Choose a returned model or enter an exact custom Model ID.
- Test the current draft, save it, then enable the Profile switch. Test sends a fixed subtitle-free Messages probe that may be billed; it does not save the key or enable the Profile.
- Claude may charge for Messages requests and enforce authentication, model access, spend limits, quotas, rate limits, or refusals. The saved key is write-only and is never shown again.

### DeepSeek

- The fixed default API root is `https://api.deepseek.com`; SubTandem appends `/chat/completions` for translation and `/models` for model discovery.
- Refresh the model list or enter an exact custom Model ID. SubTandem does not preselect, recommend, or guess a DeepSeek model.
- The official service requires a usable API key. The field is write-only after saving and the key is never shown again.
- **Save** and **Test** do not enable the profile or authorize subtitle text. Turn on the Profile switch explicitly; before enabling, only a subtitle-free model-list request may reach the default root.
- Translation uses JSON-object output with thinking disabled. DeepSeek may charge for requests and enforce balance, quota, and rate limits.

### Ollama

- The default server root is `http://127.0.0.1:11434`.
- Refresh the server's model list and choose a returned tag, or enter an exact custom Model ID.
- The bearer API key is optional when the Ollama server accepts unauthenticated requests. The field is write-only after saving.
- SubTandem checks the server, installed tags, and structured-output chat support during the connection test.

New profiles default to **Connect directly**. Choose **Use macOS proxy settings** when the service should follow the current system proxy configuration.

## 🔒 Privacy, Credentials, and Cost

- SubTandem sends only nearby subtitle cue text, the exact target language, opaque cue identifiers, and limited neighboring context to the one profile you explicitly enable. The service understands the source language inside that translation request. It does not send video or audio content.
- The `video-overlay` permission displays the current translation in a local, non-interactive overlay. The overlay does not accept input or enable dragging on the video, does not use network or WebView storage, and is cleared with the playback session.
- The plugin's private `credentials.json` stores profiles, the globally enabled profile reference, and OpenAI, Claude, DeepSeek, and Ollama keys in one atomically replaced local document. Keys remain local plaintext; its directory uses mode `0700` and the file uses mode `0600`. Keys are not written to IINA preferences, logs, diagnostics, the sidebar state, or the plugin package, and are not shown again after saving.
- File permissions protect the key from other macOS accounts and ordinary accidental access. They cannot protect it from a process that can already read files as your current macOS user.
- The bundled transport helper listens only on a temporary `127.0.0.1` port. A configured or currently edited endpoint may receive subtitle-free model-list requests. Clicking **Test** sends the current draft a fixed subtitle-free probe that may be billed; a newly entered key is used only for that request unless separately saved. This includes the default Claude root at `https://api.anthropic.com` and DeepSeek root at `https://api.deepseek.com`. Only the globally enabled profile revision receives nearby subtitle text for translation. Cross-origin redirects and credentials embedded in URLs are rejected.
- For embedded text subtitles, the bundled extractor reads only the selected stream from the current local media into a session-only temporary SRT. It does not support remote media or image-based subtitles, and removes temporary extraction data after parsing, cancellation, timeout, or shutdown.
- Translations are cached only for the current video session and are cleared when the video changes, playback ends, or the window closes.
- Short tracks, unknown-source text, and text already matching the exact target language are still sent to the enabled service and may incur charges. Your provider applies its own data and content policies; batching and session caching reduce calls but do not guarantee a maximum cost.

## 📌 Current Scope

SubTandem does not perform audio transcription, OCR or extraction of image-based subtitles, embedded subtitle extraction from remote media, whole-video pretranslation, translation export, cloud sync, or persistent translation caching.

## 🛠️ Troubleshooting

- **Select a supported text subtitle:** Select a local embedded SubRip/ASS/SSA/`mov_text` track or an external SRT/ASS track as IINA's primary subtitle. Remote embedded and image-based tracks are not supported; use the displayed state to reselect a text track or retry a failed preparation.
- **Translation failed:** Follow the specific action shown in Session. Depending on the failure, test the Profile and check its endpoint, exact model ID, API key, network route, account limits, or Ollama process. Playback and the original subtitle continue normally.
- **Credential could not be saved:** Install the release package rather than using an incomplete development copy, make sure the plugin data directory is writable, and fully restart IINA.
- **No rendered translation:** Confirm that the intended Profile switch and **Translate** are both enabled. Playback must also be within the time range of an available translated cue.
- **A proxy blocks the service:** Try the default macOS proxy route first. If it rejects the service, switch that profile to **Connect directly**, save it, test it, and enable the new revision.

## ☕ Support SubTandem

If SubTandem helps you, you can voluntarily buy its creator a coffee through [Afdian](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link) or [Ko-fi](https://ko-fi.com/ianhsia).

SubTandem remains free and fully featured for everyone. Support does not unlock extra features, priority translation, or exclusive builds, and it does not include translation service API credits. Your selected provider may charge separately under its own terms and content policies.
