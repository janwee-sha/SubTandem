<div align="center">

# SubTandem

**为 IINA 提供实时双语字幕翻译**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000)](https://www.apple.com/macos/)

[English](../../README.md) · **简体中文** · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [Français](README.fr.md)

</div>

---

SubTandem 翻译 [IINA](https://iina.io/) 当前选中的本地内嵌文本字幕或外部 SRT/ASS 字幕，并自行渲染译文。它只在播放位置附近有限前瞻、分批翻译；即使翻译延迟或失败，原字幕选择与视频播放也不受影响。

## 🎬 使用效果

SubTandem 保留原字幕，同时在你选择的位置独立显示译文。

<div align="center">

![SubTandem 在 IINA 中显示日英双语字幕](assets/real-time-bilingual-subtitle.webp)

</div>

## ✨ 功能

- **实时双语字幕：** 原字幕继续由 IINA 显示，SubTandem 在你选择的垂直位置横向居中渲染译文，不占用其他字幕轨。
- **支持内嵌与外部文本字幕：** 支持本地 Matroska SubRip/ASS/SSA、本地 MOV/MP4 `mov_text`，以及外部 SRT/ASS；正式包自带提取能力，无需安装 `ffmpeg` 或 `ffprobe`。
- **自选翻译服务：** 支持兼容 OpenAI Chat Completions 契约的 endpoint、DeepSeek，以及本地或远程 Ollama 服务。
- **播放优先：** 翻译工作不会暂停视频，也不会隐藏原字幕。
- **请求范围受限：** 只翻译播放位置附近的字幕；每个播放器窗口限制并发工作；成功译文只在当前视频会话内缓存。
- **多个 Profile：** 可保存并测试多个翻译服务 Profile，并明确选择允许接收字幕文字的确切 endpoint。
- **代理控制：** 每个 Profile 都可使用 macOS 系统代理或选择直连。

## ✅ 使用要求

- macOS 12 或更高版本
- IINA 1.4.0 或更高版本
- 受支持的本地内嵌文本字幕，或可读取的外部 SRT/ASS/SSA 字幕
- 以下任一翻译服务：
  - OpenAI endpoint、Model ID，以及服务要求时使用的 API key
  - DeepSeek API key 和准确的 DeepSeek Model ID
  - 已安装兼容模型的 Ollama 服务，以及服务要求时使用的 API key

SubTandem 不会下载或启动翻译模型。

## 🚀 安装

打开 IINA，进入“**设置 → 插件**”。插件管理界面支持以下安装方式。

<div align="center">

![IINA 插件管理界面中的“从 GitHub 安装”和“安装插件”按钮](assets/plugin-manager.webp)

</div>

### 从 GitHub 安装（推荐）

1. 点击“**从 GitHub 安装…**”。
2. 在 `user/repo` 输入框中填写 `janwee-sha/SubTandem`，然后确认安装。
3. 等待 SubTandem 出现在“已安装插件”列表中。

<div align="center">

![从 GitHub 安装 SubTandem 的 IINA 对话框](assets/install_from_github.webp)

</div>

SubTandem v0.1.0 已包含 IINA 更新元数据。使用上述任一方式完成安装后，IINA 可以检查并安装后续版本。

### 安装下载的插件包

1. 打开 [Releases](https://github.com/janwee-sha/SubTandem/releases) 页面，下载最新的 `SubTandem-X.Y.Z.iinaplgz`。
2. 返回“**设置 → 插件**”，点击“**安装插件…**”。
3. 选择刚下载的 `.iinaplgz` 文件并确认安装。

### 从插件列表安装（开发版 IINA）

开发版 IINA 可以直接从可用插件列表安装 SubTandem。

1. 打开“**设置 → 插件**”，进入新插件安装界面。
2. 在可用插件列表中选择 **SubTandem**。
3. 确认安装，并等待 SubTandem 出现在“已安装插件”列表中。

<div align="center">

![开发版 IINA 的可用插件列表中已选择 SubTandem](assets/install_from_plugins_list.webp)

</div>

无论使用哪种方式，如 IINA 提示授权，请批准所请求的插件权限；确认 SubTandem 左侧的复选框已勾选，然后重启 IINA。之后播放视频、打开 IINA 侧边栏并选择 **SubTandem** 标签页。

## 🌍 快速开始

1. 打开本地视频，并在 IINA 中选择受支持的内嵌文本字幕或外部 SRT/ASS 作为主字幕。
2. 在 **Languages** 中选择母语。如果 IINA 无法识别字幕语言，请手动确认，然后保存语言设置。
3. 在 **Translation service** 中创建 OpenAI、DeepSeek 或 Ollama Profile。服务需要认证时，先填写 API key，再手动刷新模型列表；选择返回的模型，或填写准确的自定义 Model ID。
4. 保存并测试 Profile，然后点击 **Select**。选择 Profile 即明确授权 SubTandem 向界面显示的 endpoint 发送播放位置附近的字幕文字。
5. 打开 **Translate**。原字幕仍由 IINA 正常显示，译文会出现在 SubTandem 覆盖层中。可在 **Languages** 中用 **Translation position** 将覆盖层从顶部（`0`）调整到底部（`100`）。

如果 endpoint、模型、API key 或网络路由发生变化，请保存更新后的 Profile，并在翻译前重新选择。

## ⚙️ 翻译服务

### OpenAI

- 填写 API root，例如 `https://example.com/v1`，不要填写完整的 `/chat/completions` URL。
- SubTandem 会追加 `/chat/completions`，并在侧边栏预览最终请求地址。
- 刷新 endpoint 的模型列表并选择返回的标识符，或填写准确的自定义 Model ID。
- 只有 endpoint 允许匿名请求时才可省略 Bearer API key。保存后密钥输入框为只写状态，不会回显。
- 远程 endpoint 必须使用 HTTPS。

### DeepSeek

- 固定默认 API root 为 `https://api.deepseek.com`；翻译请求会追加 `/chat/completions`，模型目录请求会追加 `/models`。
- 可刷新模型列表或填写准确的自定义 Model ID。SubTandem 不会预选、推荐或猜测 DeepSeek 模型。
- 官方服务需要可用的 API key；保存后输入框为只写状态，密钥不会再次显示。
- **Save** 和 **Test** 不会选择 Profile，也不授权发送字幕文字；必须明确点击 **Select**。Select 前只有不含字幕的模型目录请求可以到达默认 root。
- 翻译使用 JSON object 输出并关闭 thinking。DeepSeek 可能按请求收费，并限制余额、配额和请求速率。

### Ollama

- 默认服务根地址为 `http://127.0.0.1:11434`。
- 刷新服务的模型列表并选择返回的标签，或填写准确的自定义 Model ID。
- Ollama 允许匿名请求时可省略 Bearer API key；保存后密钥输入框为只写状态，不会回显。
- 连接测试会检查服务器、已安装模型标签和 structured-output chat 支持。

无论使用哪种服务，都建议先选择 **Use macOS proxy settings**。只有系统代理导致服务无法访问时，才选择 **Connect directly**。

## 🔒 隐私、凭据与费用

- SubTandem 只向你明确选择的 Profile 发送播放位置附近的字幕文字、语言方向、不透明的字幕 ID 和少量相邻上下文，不会发送视频或音频内容。
- `video-overlay` 权限只用于在本地非交互式 Overlay 中显示当前译文。Overlay 不接受输入，不支持在播放器画面拖动，不使用网络或 WebView storage，并随播放会话清理。
- OpenAI、DeepSeek 与 Ollama API key 以本地明文保存在插件私有的 `credentials.json` 中。其目录权限为 `0700`，文件权限为 `0600`。密钥不会写入 IINA preferences、日志、诊断、Sidebar 状态或插件安装包，保存后也不会再次显示。
- 文件权限可以防止其他 macOS 账号和普通意外访问，但无法抵御已经能以当前 macOS 用户身份读取文件的进程。
- 随附的 transport helper 只监听临时的 `127.0.0.1` 端口。已配置或正在编辑的 endpoint 可在 Select 前接收不含字幕的模型目录请求，其中包括默认 DeepSeek root `https://api.deepseek.com`；只有明确 Select 的 Profile 修订版才会接收用于翻译的字幕文字。跨源重定向和 URL 中嵌入的凭据会被拒绝。
- 处理内嵌文本字幕时，随附的 extractor 只读取当前本地媒体中选中的轨道，并生成会话级临时 SRT；远程媒体和图形字幕不会被提取，解析、取消、超时或退出后会清理临时数据。
- 译文只在当前视频会话内缓存；换片、播放结束或关闭窗口时会被清除。
- 翻译服务可能收费，并适用其自身的数据与内容政策。批量处理和缓存可以减少调用次数，但不保证费用上限。

## 📌 当前范围

SubTandem 不提供音频转写、图形字幕 OCR/提取、远程媒体内嵌字幕提取、整片预翻译、译文导出、云同步或持久译文缓存。

## 🛠️ 故障排查

- **Select a supported text subtitle：** 在 IINA 中选择本地内嵌 SubRip/ASS/SSA/`mov_text` 或外部 SRT/ASS 作为主字幕。远程内嵌和图形字幕不受支持；可按状态提示重新选轨，或对失败的准备操作执行 Retry。
- **Confirm the subtitle language：** 输入 BCP 47 语言标签，例如 `en-US`，然后保存语言设置。
- **Translation service unavailable：** 测试 Profile，并检查 endpoint、准确的 Model ID、API key、网络路由或 Ollama 进程。DeepSeek 还需要检查账户余额、配额、rate limit 和固定 API 路由是否可达。视频和原字幕会继续正常播放。
- **Credential could not be saved：** 使用正式 Release 安装包，不要使用内容不完整的开发副本；确认插件数据目录可写，并完全退出后重启 IINA。
- **没有显示译文：** 确认 Profile 已测试并选中、源语言与母语不同，并且已开启 **Translate**；播放位置还需要处于已有译文的字幕时段内。
- **代理阻止服务连接：** 先尝试默认的 macOS 代理路由。如果代理拒绝该服务，将 Profile 改为 **Connect directly**，保存后重新 Select/Test。

## ☕ 支持 SubTandem

如果 SubTandem 对你有帮助，可以通过[爱发电](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link)或 [Ko-fi](https://ko-fi.com/ianhsia) 自愿请创作者喝杯咖啡。

<div align="center">

![请 SubTandem 创作者喝杯咖啡的爱发电二维码](assets/aifadian-sponsor.webp)

</div>

SubTandem 对所有人保持免费且功能完整。打赏不会解锁额外功能、优先翻译或专属版本，也不包含翻译服务 API 额度。你选择的 Provider 可能根据其条款与内容政策独立收费。
