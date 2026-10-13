<div align="center">

# SubTandem

**为 IINA 提供实时双语字幕翻译**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release&style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![Downloads](https://img.shields.io/github/downloads/janwee-sha/SubTandem/total?style=for-the-badge&logo=github)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff?style=for-the-badge&logo=apple&logoColor=white)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge&logo=gnu&logoColor=white)](https://github.com/janwee-sha/SubTandem/blob/main/LICENSE)

[English](../../README.md) · **简体中文** · [繁體中文](README.zh-Hant.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [Français](README.fr.md)

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
- **自选翻译服务：** 可使用 OpenAI、Claude、DeepSeek 或 Ollama，也可连接兼容 OpenAI 或 Claude 的服务。
- **播放优先：** 翻译工作不会暂停视频，也不会隐藏原字幕。
- **请求范围受限：** 只翻译播放位置附近的字幕；每个播放器窗口限制并发工作；成功译文只在当前视频会话内缓存。
- **持久译文样式：** 可在 **字幕** 中自定义字体、字号、粗体与斜体、文字颜色、边框和背景。颜色预设与 macOS 颜色选择器支持透明度，样式设置会保存供后续使用。
- **多个配置：** 可保存不同服务和模型的配置，就地编辑、测试并切换启用的配置。启用选择在所有播放器窗口间生效，并在重启 IINA 后保留。
- **网络路由：** 可为每个配置选择直接连接或使用系统代理设置，决定模型刷新、连接测试和翻译请求如何连接服务。直接连接会绕过系统代理；新配置默认使用系统代理设置。
- **跟随 IINA 的界面语言：** 在 IINA 1.5.0 及之后版本中，SubTandem 自动跟随 IINA 的界面语言，覆盖 IINA 1.5.0 随包提供的全部 31 个语言变体。控件、状态与错误提示、无障碍文案、插件描述及字体和颜色选择器均使用该语言。系统选择器文案可能回退到 macOS 可用的语言。

## ✅ 使用要求

- macOS 12 或更高版本
- 保存或使用非空 API 密钥 需要配备 Secure Enclave 的 Mac；不需要 API 密钥 的服务仍受支持。
- IINA 1.4.0 或更高版本；自动跟随界面语言需要 IINA 1.5.0 或更高版本
- 受支持的本地内嵌文本字幕，或可读取的外部 SRT/ASS/SSA 字幕
- 可使用的 OpenAI、Claude、DeepSeek 或 Ollama 翻译服务及模型；各服务的配置方法见下文。

SubTandem 不会下载或启动翻译模型。

## 🚀 安装

以下步骤和截图以 IINA 1.5.0 及以上版本的英文界面为例。打开 **Settings → Plugins**（设置 → 插件），选择 **Get Plugins…** 或 **Install Local Package…**。

<div align="center">

![IINA 插件管理界面中的 Get Plugins 和 Install Local Package 按钮](assets/plugin-manager.webp)

</div>

### Get Plugins

点击 **Get Plugins…**，然后任选一种方式安装：

- **输入仓库名称：** 在顶部的 `owner/repo` 输入框中填写 `janwee-sha/SubTandem`，点击旁边的 **Install**。
- **从社区插件列表选择：** 在列表中选择 **SubTandem**，点击右侧详情中的 **Install**。

<div align="center">

![IINA 的 Get Plugins 对话框，包含 owner/repo 输入框和已选中 SubTandem 的社区插件列表](assets/get-plugins.webp)

</div>

安装完成后，点击 **Done** 返回插件管理界面。

### Install Local Package

1. 打开 [Releases](https://github.com/janwee-sha/SubTandem/releases) 页面，下载最新的 `SubTandem-X.Y.Z.iinaplgz` 安装包。
2. 返回 **Settings → Plugins**，点击 **Install Local Package…**。
3. 选择下载的 `.iinaplgz` 文件并确认安装。

无论使用哪种方式，如 IINA 提示授权，请批准所请求的插件权限。安装完成后，确认 SubTandem 旁的开关已开启，然后重启 IINA。之后播放视频、打开 IINA 侧边栏并选择 **SubTandem** 标签页。

## 🌍 快速开始

SubTandem 跟随 IINA 的应用语言，更改后需重启 IINA。旧宿主、不支持的语言或无法读取语言信息时使用英文；缺失文案也会回退英文。插件没有独立语言设置。下文使用简体中文控件名称，实际名称随 IINA 语言变化。

1. 打开本地视频，并在 IINA 中选择受支持的内嵌文本字幕或外部 SRT/ASS 作为主字幕。
2. 在 **字幕** 中选择准确的目标语言。当前翻译服务会在翻译请求内逐条理解源语言，无需手动确认源语言。
3. 在 **翻译服务** 中点击 **新建配置**，创建 OpenAI、Claude、DeepSeek 或 Ollama profile。新草稿默认 **使用系统代理设置**。服务需要认证时，先填写 API 密钥，再手动刷新模型列表；选择返回的模型，或填写准确的自定义 模型 ID。
4. 用左下角 **测试** 测试当前草稿，再用右下角 **保存** 保存，并打开独立开关。测试 可能产生固定探针请求费用，但不会发送正在播放的字幕、保存新输入的密钥或启用 profile。
5. 打开 **翻译**。原字幕仍由 IINA 正常显示，译文会出现在 SubTandem 覆盖层中。可在 **字幕** 中用 **位置** 将覆盖层从顶部（`0`）调整到底部（`100`）。
6. 在 **字体**、**边框** 与 **背景** 分组中设置八项文本样式。选择颜色预设会直接保存；选择 **显示颜色…** 可打开 macOS 系统颜色面板，未修改便关闭时会保留原值。

展开 profile 摘要即可就地编辑。操作行左侧是 **测试**，右侧依次是 **取消**、**删除**、**保存**；新草稿不显示 删除。测试当前值并保存后，再启用新修订版。

## ⚙️ 翻译服务

### OpenAI

- 默认 API 根地址 是 `https://api.openai.com`。使用 OpenAI 官方服务时，填写 **API 密钥**，并选择账号可用的模型。
- 刷新模型列表并选择模型，或填写准确的 **模型 ID**。
- 使用兼容 OpenAI 的服务时，将 **API 根地址** 改为该服务的 API 根地址。侧边栏会显示翻译请求地址。如果该服务无需 API 密钥，可将 **API 密钥** 留空。

### Claude

- 默认 API 根地址 是 `https://api.anthropic.com`。使用 Claude 官方服务时，填写 Anthropic **API 密钥**，并选择账号可用的模型。
- 刷新模型列表并选择模型，或填写准确的 **模型 ID**。
- 使用兼容 Claude 的服务时，将 **API 根地址** 改为该服务的 API 根地址。如果该服务无需 API 密钥，可将 **API 密钥** 留空；仍可刷新模型、测试、保存和启用 profile。

### DeepSeek

- 默认 API 根地址 是 `https://api.deepseek.com`。使用 DeepSeek 官方服务时，填写 **API 密钥**，并选择账号可用的模型。
- 刷新模型列表并选择模型，或填写准确的 **模型 ID**。SubTandem 不会替你预选 DeepSeek 模型。
- 如果服务使用其他兼容的 API 根地址，可以修改 **API 根地址**。

### Ollama

- 默认服务地址是 `http://127.0.0.1:11434`，用于连接你电脑上的 Ollama。请先启动 Ollama 并安装兼容模型。
- 刷新模型列表并选择已安装的模型，或填写准确的 **模型 ID**。
- 使用远程 Ollama 时，将 **API 根地址** 改为服务器地址。仅当服务器要求时才填写 **API 密钥**。**测试** 会检查连接、模型和结构化输出支持。

新 profile 默认使用 **使用系统代理设置**。**网络连接方式** 用于模型刷新、连接测试和翻译；选择 **直接连接** 可绕过系统代理。已有 profile 保留保存的路由，当前草稿中选择的路由在切换服务后再切回来时也会保留。

## 🔒 隐私、凭据与费用

- SubTandem 只向你明确全局启用的唯一 profile 发送播放位置附近的字幕文字、准确的目标语言、不透明的字幕 ID 和少量相邻上下文；服务会在该翻译请求内理解源语言。SubTandem 不会发送视频或音频内容。
- `video-overlay` 权限只用于在本地非交互式 Overlay 中显示当前译文。Overlay 不接受输入，不支持在播放器画面拖动，不使用网络或 WebView storage，并随播放会话清理。
- API 密钥 以认证密文保存在插件私有的 `credentials.json` 中，与 profile 设置及硬件绑定的恢复材料一同保存。Secure Enclave 保护加密密钥；所需硬件保护不可用时，非空 API 密钥 的保存和已保存 API 密钥 的使用会失败。空 API 密钥 和明确清除仍可用。API 密钥 不会写入 IINA preferences、日志、诊断或安装包。 在同一 Mac、同一用户且系统密钥有效时，新保存的 API 密钥 在重启 IINA、重启 Mac 并登录或后续插件升级后仍可用，无需额外授权、主密码或生物识别。
- 打开 profile 可编辑已保存的 API 密钥。默认遮罩，**显示 API 密钥** 仅在当前抽屉显示原值。**保存** 以当前输入替换原值，空值保存会清除；读取失败时仍显示可编辑的空字段，不改变已保存数据。**取消** 丢弃修改。
- 从原明文格式升级会保留 profile 设置和有效启用选择，但清空已保存的 API 密钥，请按需重新录入。SubTandem 清理其受管副本；APFS/Time Machine 快照、离线副本和其他备份仍可能保留旧 API 密钥。建议在服务端轮换旧 API 密钥。
- 备份时保留完整的 `credentials.json` 及其中配套恢复材料。恢复依赖原设备、原用户和有效的系统密钥环境，即使条件满足也不保证成功。其他设备或用户无法恢复已保存的 API 密钥，请为各 profile 重新录入。
- 处理内嵌文本字幕时，随附的 extractor 只读取当前本地媒体中选中的轨道，并生成会话级临时 SRT；远程媒体和图形字幕不会被提取，解析、取消、超时或退出后会清理临时数据。
- 译文只在当前视频会话内缓存；换片、播放结束或关闭窗口时会被清除。
- 短轨、源语言不明及已经符合准确目标语言的正文仍会发送到所选服务，并可能产生费用。服务适用其自身的数据与内容政策；批量处理和会话缓存可以减少调用次数，但不保证费用上限。

## 📌 当前范围

SubTandem 不提供音频转写、图形字幕 OCR/提取、远程媒体内嵌字幕提取、整片预翻译、译文导出、云同步或持久译文缓存。

## 🛠️ 故障排查

- **选择受支持的文本字幕：** 在 IINA 中选择本地内嵌 SubRip/ASS/SSA/`mov_text` 或外部 SRT/ASS 作为主字幕。远程内嵌和图形字幕不受支持；可按状态提示重新选轨，或对失败的准备操作执行 重试。
- **翻译失败：** 按照 会话 显示的具体操作处理。根据失败原因测试 profile，并检查 API 根地址、准确的 模型 ID、API 密钥、网络路由、账户限额或 Ollama 进程。视频和原字幕会继续正常播放。
- **启动后出现空 profile 列表：** 无法加载已保存设置时，仍可使用 **新建配置**。损坏的设置可能被重置，可新建并保存 profile 后继续使用。暂时访问失败不会覆盖有效的已保存 profile，访问恢复后它们可以重新出现。保存失败会保留草稿供重试。单条 API 密钥 读取失败不会重置列表。
- **无法保存凭据：** 使用正式 Release 安装包，不要使用内容不完整的开发副本；确认插件数据目录可写，并完全退出后重启 IINA。
- **没有显示译文：** 确认目标 profile 开关和 **翻译** 均已开启；播放位置还需要处于已有译文的字幕时段内。
- **网络或代理故障：** 新 profile 默认使用系统代理设置。请检查系统代理配置，或为该 profile 选择 **直接连接**，然后保存、测试并启用新修订版。

## ☕ 支持 SubTandem

如果 SubTandem 对你有帮助，可以通过[爱发电](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link)或 [Ko-fi](https://ko-fi.com/ianhsia) 自愿请创作者喝杯咖啡。

<div align="center">

![请 SubTandem 创作者喝杯咖啡的爱发电二维码](assets/aifadian-sponsor.webp)

</div>
