# 快速验证：添加 Claude 翻译服务

## 前置条件

- macOS 12+、Node.js 24.18.0、npm 11、Swift 6.0，依赖已按 lock 安装。
- IINA 1.4.4 与 `/Applications/IINA.app/Contents/MacOS/iina-plugin`；也可通过 `IINA_PLUGIN_BIN` 指定同版本 CLI。
- native 构建所需的锁定 FFmpeg 归档可用；缺失时构建脚本可能需要下载摘要匹配的归档。
- fake transport 自动化不得使用真实 Key。任何 Anthropic 或远程 compatible Endpoint live test 仅在用户明确批准联网和可能费用后执行。
- 验收前阅读[数据模型](./data-model.md)、[Messages 契约](./contracts/claude-messages.md)及 [Profile/Models 契约](./contracts/claude-profile-and-models.md)。命令、日志和证据不得记录 Key、认证 header、字幕、译文或原始响应。

## 聚焦自动化

实现完成后运行：

```sh
npx vitest run \
  tests/contract/claude.test.ts \
  tests/contract/provider-model-discovery.test.ts \
  tests/contract/provider-output.test.ts \
  tests/contract/provider-profiles.test.ts \
  tests/contract/credential-store.test.ts \
  tests/contract/provider-connection-tests.test.ts \
  tests/contract/global-rpc.test.ts \
  tests/contract/ui-messages.test.ts \
  tests/contract/sidebar-form.test.ts \
  tests/contract/sidebar-lifecycle.test.ts \
  tests/contract/openai.test.ts \
  tests/contract/deepseek.test.ts \
  tests/contract/ollama.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/unit/model-catalog-sync.test.ts \
  tests/unit/profile-list-sync.test.ts \
  tests/unit/sidebar-state.test.ts \
  tests/unit/provider-cache.test.ts \
  tests/unit/retry.test.ts \
  tests/integration/us3-providers.test.ts \
  tests/integration/provider-connection-lifecycle.test.ts \
  tests/integration/us1-playback.test.ts \
  tests/integration/progressive-translation.test.ts \
  tests/integration/us2-cost-privacy.test.ts \
  tests/security/credential-leakage.test.ts \
  tests/security/redaction.test.ts
npm run test:native
npm run typecheck
npm run lint
npm run format:check
```

预期：

- Service type 严格按 OpenAI、Claude、DeepSeek、Ollama 排序；Claude 默认名称/Root 正确，Model ID 为空且 Custom 可用，四种草稿与反馈不串用。
- 新建、kind 转换或未配置 Claude 缺 Key 时 Save 被阻止；已配置 Profile 可留空保留 Key。缺 Key 的 Global Test、Select、刷新和翻译本地失败且不联网。
- Claude Profile 完成 Save、fresh Test、Select、Update、Delete、revision、选择失效和凭据清理；安全视图只含 `credentialConfigured`。
- `/v1/models` 每页携带 `x-api-key` 与版本头；Anthropic 分页按 `last_id/after_id` 原子完成，Ollama-compatible `object: "list"` 目录以单页完成，两者均精确去重；空/重复 cursor、后页失败和旧 owner 均零提交并保留 Model ID、目录与 Custom。
- `/v1/messages` 使用顶层 system、user message、`max_tokens: 8192` 与 `stream: false`，不含 `temperature`、`top_p`、`top_k`、Schema、format、tools、thinking、prefill 或本地 session header。
- 多个 text blocks 按顺序直接拼接；只有无拒绝信号的 `end_turn` 和精确完整 ID JSON 可提交。空、截断、畸形、额外/缺失/重复 ID 与空译文使当前 wire 提交数为 0。
- 401/403、402、404、429、500/504/529、版本错误、拒绝、timeout、network、cancel 与空输出只形成固定安全分类，不暴露上游 message/body/header。
- Service type、Endpoint、route、Profile、revision、Key、窗口或请求时序变化后，旧分页、Test、凭据反馈和译文均不覆盖当前 owner。
- Claude 字幕、上下文和译文不进入 Log Viewer；所有 Key 和原始 Provider 数据不进入 preferences、日志、诊断、进程参数、包或无关 UI。
- 现有 OpenAI capability probe、DeepSeek JSON-object/disabled-thinking、Ollama schema/prompt fallback 及其 Profile、模型、Test、Select 与翻译全部回归通过。

## Claude-compatible live test

此步骤会向用户指定 Endpoint 发送请求，必须在执行当时取得明确联网与费用授权。可使用 Ollama 0.14.0+ Anthropic-compatible Endpoint 和其接受的非空占位 Key；使用 Anthropic 官方服务时由用户自行提供有效 Key 和精确 Model ID。

```sh
read -r SUBTANDEM_CLAUDE_ENDPOINT
read -r SUBTANDEM_CLAUDE_MODEL
read -rs SUBTANDEM_CLAUDE_KEY
printf '\n'
export SUBTANDEM_CLAUDE_ENDPOINT SUBTANDEM_CLAUDE_MODEL SUBTANDEM_CLAUDE_KEY
SUBTANDEM_LIVE_CLAUDE_TEST=1 npx vitest run tests/integration/live-providers.test.ts
unset SUBTANDEM_CLAUDE_KEY SUBTANDEM_CLAUDE_MODEL SUBTANDEM_CLAUDE_ENDPOINT
```

测试必须：

- 每次执行 fresh Test；
- 翻译至少 40 个目标，覆盖至少 20 个两项目 wire；
- 验证全部 ID 精确、唯一、完整且译文非空，不含解释、字段名、上下文复制或包装文本；
- 断言请求不依赖采样参数、服务端 JSON Schema、tools、prefill 或 fallback；
- 失败只输出 category、retryable、安全 status/code 与 userAction。

Endpoint 未授权、Key/费用不可用或网络不稳定时跳过，不得把未执行标记为通过；fake transport 自动化仍必须全部通过。

## 完整门禁与候选包

任何代码变更完成后，严格依次重新运行，不沿用变更前结果：

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

预期：全部命令成功，生成与当前 `Info.json` 版本一致的 `build/package/SubTandem-X.Y.Z.iinaplgz`。正式包继续只含 manifest、README、许可证/声明、运行 bundle、UI 和两个 universal helper；不含凭据、环境文件、运行目录、源码、测试、SDD、构建缓存或 secret-like 内容。本流程不 commit、tag、上传或发布。

若 `npm run pack` 找不到 IINA CLI，必须先安装或指定 CLI 再完成门禁；只能完成 build/verify 时不得声称打包通过。

## 当前文档与披露复核

人工核对 `Info.json`、根 README、全部 `docs/readme/README.*.md`、`docs/engineering/development.md` 和 `docs/validation/iina-matrix.md`：

- 当前服务列表为 OpenAI、Claude、DeepSeek、Ollama，各语言结构和含义一致。
- Claude 小节说明默认 Root、Messages/Models 路径、模型刷新/Custom ID、Key 必填且只写、本地明文 `0600` 风险、Save→Test→Select、费用和排错。
- 网络披露区分 Select 前的无字幕模型请求与 Select 后的最小字幕翻译请求，并包含默认 Claude Root。
- Claude 认证、账单/配额、限流、版本、Endpoint、Model ID、network route、拒绝和目录不支持均有安全排错说明；播放与原字幕继续。
- `permissions` 与 `allowedDomains: ["127.0.0.1"]` 不扩大。
- 验证矩阵新增 Claude 待验收场景，但未执行前不得写为通过。

文档复核不能替代生产代码自动化；不得新增只用于断言 README 或开发文档普通文案的测试。

## IINA 1.4.4 正式包单人验收

使用同一个最终 `.iinaplgz`，先移除开发链接，记录包 SHA-256、macOS、架构、IINA 版本、非敏感场景 ID、耗时和实际结果。

1. 安装并启用正式包。从 New Profile 选择 Claude，确认顺序、默认名称/Root、空 Model ID、system route 与必填 Key；不填写 Key 时 Save 被阻止且没有外部请求。
2. 输入 Key，手动 Refresh；Anthropic 分页目录或 Ollama-compatible `object: "list"` 单页目录成功时可选择任一返回 ID，目录不支持时仍可输入 Custom。Save、fresh Test、Select，播放受支持字幕并在 180 秒内看到首条译文；Test 不得自动 Select。
3. 连续完成至少 20 个 wire；确认译文完整，无理由、说明或包装内容，且等待、重试和失败从不暂停视频或原字幕。
4. 分别验证缺失、错误和正确 Key，以及账单/配额、429、不可达、版本不兼容、无效 Root/Model；反馈可操作且不含服务原文，刷新失败保留 Model ID、目录和 Custom。
5. 用分页 Endpoint 验证跨页完整目录、去重和终态原子提交；制造空/重复 cursor、后页失败与页间 owner 变化，确认部分目录和旧 Key 后续请求不提交或继续。
6. 快速切换 Endpoint A→B、route、Claude/OpenAI/DeepSeek/Ollama、Profile 和 Key，制造乱序响应；旧目录、凭据反馈、Test 或译文不得覆盖当前上下文。
7. 编辑 Claude Profile，确认 revision 增长、旧选择失效且必须重新 Select；kind 改变时旧 Claude Key 不继承。删除后 Key、选择、任务、目录和 cache 清理，无关 Profile 保持。
8. 关闭/重开 Sidebar、换片、播放结束和关窗，确认临时显示与内存状态清理；多窗口只由各自明确选择的 revision 接收字幕。
9. 分别用既有 OpenAI、DeepSeek 与 Ollama Profile 完成 Refresh、Test、Select 和翻译，确认行为无回归。
10. 用不含真实内容的 sentinel 检查 Sidebar、IINA Log Viewer、`iina.log`、`mpv.log`、preferences、诊断与最终包；Claude 内容和所有凭据命中数为 0。最后从插件管理面板卸载正式包。

人工证据不得记录完整 Endpoint、Key、认证 header、字幕、译文或原始响应。浏览器控制与 Computer Use 不用于默认验收；只有用户另行明确批准时才可自动化交互步骤。只有实际完成的步骤才能标记通过。
