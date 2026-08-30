# SubTandem 开发指南

SubTandem 是面向 IINA 1.4+ 的实时双语字幕插件。本文档供开发者构建、测试、打包和验收插件。

## 开发环境

- macOS 12 或更高版本
- IINA 1.4.0 或更高版本
- Node.js 24、npm 11
- Swift 6 工具链
- `curl`、`shasum`、`lipo`、`codesign` 与 Xcode Command Line Tools

安装锁定依赖：

```sh
npm ci
```

## 构建与自动化检查

```sh
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

主要命令的职责如下：

- `npm run test`：运行 TypeScript 自动化测试。
- `npm run typecheck`：检查插件运行时和 Sidebar 的 TypeScript 类型。
- `npm run lint`：运行 ESLint。
- `npm run build:native`：校验 `native/ffmpeg.lock.json`，由锁定源码构建 macOS 12 arm64/x86_64 静态 FFmpeg，并生成两个 universal Swift 可执行文件。
- `npm run test:native`：运行 transport 与 subtitle extractor 的 Swift 合同、安全和真实小样本测试。
- `npm run build`：构建插件运行时代码和 Sidebar。
- `npm run verify:package`：检查待打包内容。
- `npm run pack`：生成 `build/package/SubTandem-X.Y.Z.iinaplgz`。

### DeepSeek 可选联网验证

真实 DeepSeek 验证会连接可能收费的服务，仅在用户明确批准联网和费用后，按当前功能的 [quickstart](../../specs/019-add-deepseek-provider/quickstart.md) 显式启用。不得把 Endpoint、Key、Authorization、字幕、译文或原始响应写入命令、日志和证据；结果只记录计数与安全错误分类。验证应覆盖 fresh Test、至少 40 个目标和 20 个双项 wire。失败时检查认证、余额或配额、rate limit、固定 API route、准确 Model ID 与 network route；任何失败均不得暂停播放或原字幕。

### Claude-compatible 可选联网验证

真实 Claude 验证会连接可能收费的服务，仅在用户当次明确批准联网和费用后，按 [Claude quickstart](../../specs/020-add-claude-provider/quickstart.md) 显式启用。命令和证据不得包含 API root、Key、认证 header、字幕、译文或原始 Messages 响应，只记录安全计数和错误分类。使用 fresh Test 与至少 20 个双项目 wire 验证 `/v1/messages`；失败时检查 API root、Messages/Models 兼容性、认证与版本 header、准确 Model ID、spend limit、配额、rate limit、拒绝和 network route。未获授权时保持 live task 未验收。

## 发布准备

开始稳定版本发布前，用户必须明确目标版本 `X.Y.Z` 及该版本对应的一项或多项已验收规格。维护者据此准备唯一的英文用户正文 `docs/releases/vX.Y.Z.md`；缺少版本、规格或验收依据时停止发布准备。正文结构、内容边界和失败规则见[版本化用户发布说明规格](../../specs/009-versioned-release-notes/spec.md)。

## IINA 开发链接

使用 IINA 自带的插件 CLI 创建开发链接：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

`link` 创建 `.iinaplugin-dev` 开发链接。IINA 对开发链接禁用“卸载”按钮是预期行为；移除链接时运行：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
```

## 正式包验收

验收正式安装包前，先移除当前 workspace 的开发链接，再打开打包产物：

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
open build/package/SubTandem-X.Y.Z.iinaplgz
```

重启 IINA，在“设置 → 插件”中启用 SubTandem，并从播放器侧边栏打开插件。正式 `.iinaplgz` 安装项必须可以从插件管理面板卸载；不要同时保留同一版本的正式安装项和开发链接。

需要实机验证的安装、卸载、权限、多窗口和播放行为，应按以下记录执行：

- [自动化验证](../validation/automated.md)
- [打包验证](../validation/package.md)
- [IINA 版本矩阵](../validation/iina-matrix.md)

## 架构与安全边界

- 插件读取当前选中的外部 SRT/ASS，或当前本地媒体中的内嵌 SubRip/ASS/SSA/`mov_text` 轨；正式包无需系统 `ffmpeg`/`ffprobe`。
- `subtandem-subtitle-extractor` 逐窗口运行，只绑定 `127.0.0.1`，临时目录使用 `0700`、结果文件使用 `0600`，解析、取消、超时或退出后清理。远程媒体和图形字幕不会提取。
- OpenAI、Claude、DeepSeek 和 Ollama 请求由受限 Swift helper 发出；插件运行时只连接 helper 的 `127.0.0.1` 临时端口。
- `video-overlay` 权限只承载包内本地资源生成的非交互式译文 Overlay；运行时必须调用 `setClickable(false)`，Overlay 不接受输入、不支持画面拖动、不联网且不使用 WebView storage，正文随播放会话清理。
- OpenAI、Claude、DeepSeek 和 Ollama 的凭据由 helper 写入插件私有数据目录的 `credentials.json`；目录权限为 `0700`，文件权限为 `0600`。凭据不得进入 preferences、日志、诊断、进程参数或安装包。
- 翻译结果仅缓存在当前视频会话中。换片、播放结束或关窗时清理，不写入持久缓存。
- OpenAI 与 Ollama 可使用完整 HTTP(S) endpoint；OpenAI 继续支持兼容其契约的自定义服务。Claude 默认 root 为 `https://api.anthropic.com`，也接受实现 `/v1/messages`、`/v1/models` 及 Claude 认证/版本 header 的 compatible HTTPS root。DeepSeek 固定默认 root 为 `https://api.deepseek.com`。四种服务沿用同一 transport、凭据与代理边界，不新增 native RPC、依赖或权限。
- Claude 翻译使用顶层 system、单条 user message、`max_tokens: 8192`、`stream: false` 和精确 ID JSON；只接受 `end_turn` 与按序 text block，拒绝、截断、畸形或不完整 wire 均零提交。模型目录按 `last_id/after_id` 分页，每页发送前后复核完整 owner；preview Key 只用于当前手动刷新，不进入状态、日志或诊断。
- DeepSeek 翻译固定使用 `/chat/completions`、JSON object 输出、关闭 thinking 并严格校验 ID wire；模型目录使用 `/models`。产品不得预选、推荐或猜测 DeepSeek Model ID，也不持久化 Provider capability。
- 已配置或正在编辑的 endpoint 可在 Select 前接收不含字幕的模型目录请求，其中包括默认 Claude 与 DeepSeek root；需要认证的新 Profile 仅在用户填写 API key 并手动刷新时临时使用该 Key，自动刷新不发送未保存 Key。只有用户明确 Select 的 Profile 修订版才会接收用于翻译的字幕正文。
- 原字幕和视频播放不得因翻译延迟或失败而暂停。

### 跨运行时播放器身份

Main 与 Global 使用的播放器 ID 来自不同命名空间，即使字段都命名为 `playerId`，也不得假定值相同：

| 身份                  | 来源                        | 用途                                                               | 不得用于                                            |
| --------------------- | --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| Main 生命周期 ID      | Main 为本地播放生命周期创建 | 组成会话和 attempt fingerprint，判断进度、终态及迟到结果能否提交   | Global 授权、跨窗口路由或与 IINA 发送方 ID 比较相等 |
| IINA Global 发送方 ID | IINA 传给 Global 消息回调   | 查询所选 Profile、建立 Broker 所有权、取消请求并把结果路由回原窗口 | 替代 Main 的本地会话身份                            |

Global MUST 以 IINA 回调提供的发送方 ID 作为跨运行时授权依据，MUST NOT 信任 payload 中的 `playerId` 完成授权，也 MUST NOT 拒绝与发送方 ID 不相等的 Main 生命周期 ID。Broker 调用 Provider 前应使用发送方 ID 覆盖 Provider 请求的播放器身份；Main 仍使用自身完整生命周期身份执行最终提交校验。具体消息契约见 [Main↔Global 翻译单元消息契约](../../specs/015-translation-unit-resegmentation/contracts/translation-unit-messages.md)。

新增或修改跨运行时消息时必须检查：

- 为每个身份字段注明生成方、命名空间、授权方和生命周期，不得仅凭相同字段名建立等值关系。
- 测试必须让 Main 生命周期 ID 与 IINA 发送方 ID 使用不同值，并验证请求仍能到达 Provider、Provider 只收到权威发送方 ID、回复只返回原窗口。
- 实机出现 Provider 协议错误前，先确认服务端确实收到翻译 POST；未发出 POST 的失败应按 Main↔Global 解析、选择或授权链路排查，不得归因于 Provider 响应格式。

详细设计和契约见当前 SDD 产物：

- [实时字幕翻译](../../specs/001-realtime-subtitle-translation/spec.md)
- [渐进翻译输出](../../specs/002-progressive-translation-output/spec.md)
- [Provider 连接生命周期](../../specs/003-provider-connection-lifecycle/spec.md)
- [自动 GitHub Release](../../specs/004-automatic-github-release/spec.md)
- [版本化用户发布说明](../../specs/009-versioned-release-notes/spec.md)
- [内嵌字幕翻译](../../specs/008-embedded-subtitle-translation/spec.md)
- [Claude 翻译服务](../../specs/020-add-claude-provider/spec.md)

所有变更必须遵守[项目宪法](constitution.md)和仓库根目录的 `AGENTS.md`。
