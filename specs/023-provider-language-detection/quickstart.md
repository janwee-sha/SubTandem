# 验证指南：翻译服务自动识别源语言

## 前置条件

- macOS 12+、Node.js 24、npm 11、Swift 6、IINA 1.4.0+
- 已执行 `npm ci`
- 实机验收使用最终 `.iinaplgz`，开发链接不能替代正式包证据
- 联网 Provider 验收默认不运行；只有用户明确批准网络和可能费用后才启用

契约见[翻译任务](contracts/translation-task.md)与[本地会话状态](contracts/session-state.md)，实体见[数据模型](data-model.md)。

## 聚焦自动化

实现完成后运行：

```sh
npm test -- tests/integration/provider-language-detection.test.ts tests/contract/provider-output.test.ts tests/contract/openai.test.ts tests/contract/ollama.test.ts tests/contract/deepseek.test.ts tests/contract/claude.test.ts tests/contract/ui-messages.test.ts tests/contract/sidebar-form.test.ts tests/unit/session-cache.test.ts tests/unit/translation-overlay.test.ts tests/security/credential-leakage.test.ts
```

预期证明：

- 短/中/长轨、罗马字、混合语言、错误/缺失标签和同语言正文均直接进入当前 Provider，且请求无 source 字段或独立检测请求。
- 四类 Provider 的 task 都包含精确目标变体、逐条自动理解、同语言原样和上下文只读规则。
- system task 与 user payload 携带同一可信精确目标；Claude-compatible 默认发送当前 wire 的 JSON Schema 并关闭 thinking，只有 400/422 明确拒绝对应能力时才分别省略并有界重试。
- Claude-compatible 的完整单 JSON 围栏和精确 ID 字符串映射可被严格规范化；外围说明、多围栏、错误 ID、额外字段、重复 ID、空白或非字符串结果仍拒绝。
- 首个 attempt 在正文和配置就绪后 500ms 内发生；测试使用可控时钟或数值时间戳，不以目测判断。
- 首尾空格、大小写、标点、换行和内部空行从 Provider parser 到 cache/Overlay 严格保持；纯空白和错误 ID 仍拒绝。
- 未启用或未选 Profile 不外发；换轨/片/目标/Profile/禁用/关窗和多窗口迟到结果仍被隔离。
- Sidebar 不包含检测字段、占位或四个已删除状态，仍显示字幕准备、配置、运行和服务错误。

检查生产残留：

```sh
rg -n 'sourceLanguage|trackLanguage|detectedLanguage|languageDetection|detectingLanguage|languageUnrecognized|languageUnsupported|noTranslationNeeded|sourceLanguageMode|source-languages|language-detection|from "franc"' src ui Info.json package.json
```

预期无输出。`package-lock.json` 和 `THIRD_PARTY_NOTICES.txt` 也不得再包含 `franc`、`trigram-utils`、`collapse-white-space` 或 `n-gram`。

## 完整质量门

最后一次代码变更后按顺序重新运行，任何旧结果都不能替代：

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

`build:native` 可能需要获取锁定 FFmpeg 源码；`test:native` 需要本机 loopback；`pack` 需要 `/Applications/IINA.app/Contents/MacOS/iina-plugin`。受限环境失败不能记为产品通过或失败，应获批后原样重跑。

包审计预期：三个 universal helper、最低 macOS、签名、权限和归档白名单保持通过；包内无 detector、`franc`、源码、测试、规格、运行时数据或凭据。

## 经授权的真实 Provider 验收

在凭据已通过安全环境变量配置、且用户明确批准后，分别启用现有 live 测试开关：

```sh
SUBTANDEM_LIVE_PROVIDER_TEST=1 npm test -- tests/integration/live-providers.test.ts
SUBTANDEM_LIVE_DEEPSEEK_TEST=1 npm test -- tests/integration/live-providers.test.ts
SUBTANDEM_LIVE_CLAUDE_TEST=1 npm test -- tests/integration/live-providers.test.ts
```

四类服务均运行冻结的同语言、混合语言和目标变体场景。同语言条目以 `===` 比较，需翻译条目不得套用“禁止 source echo”到原样场景。证据只记录 Provider 类型、case ID、计数、布尔结果和安全错误类别，不记录 endpoint、key、字幕、译文或原始响应。未获授权时保持未验收。

## IINA 正式包单人验收

记录 IINA/macOS 版本、包版本或 SHA-256、非敏感 sample ID、最终状态与通过/失败。每项由单名开发者完成；短轨、未知源语言和同语言三条主流程应各自可在 3 分钟内完成，500ms 启动指标以前述自动化计时为准。按顺序执行：

1. 安装最终包，选择并测试一个 Profile，启用翻译并选择目标语言。
2. 分别加载受版本管理的 5–6 cue 短轨、11 cue 轨、罗马字轨、混合语言轨和错误/缺失标签轨；确认无检测阶段或字段，附近正文直接进入服务。
3. 加载已经符合目标语言的多行字幕；确认仍调用服务，译文与实际任务正文逐字符一致并按原时间显示。
4. 验证 `zh-Hans`/`zh-Hant` 及 `pt-PT` 场景：相同基础语言但不同变体时发生转换，已符合精确变体时原样返回。
5. 加载空、损坏、远程内嵌或图形字幕；确认不生成空任务，并保留可操作的准备错误。
6. 制造服务失败，再执行 seek、换轨、换片、换目标、换 Profile、禁用、双窗口和关窗；确认播放/原字幕不受阻塞，旧结果不写入新会话且缓存被清理。
7. 从 IINA 插件管理器卸载正式包；记录结果。无需浏览器控制或 Computer Use。
