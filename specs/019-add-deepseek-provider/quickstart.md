# 快速验证：添加 DeepSeek 翻译服务

## 前置条件

- macOS 12+、Node.js 24.18.0、npm 11、Swift 6.0，依赖已按 lock 安装。
- IINA 1.4.4 与 `/Applications/IINA.app/Contents/MacOS/iina-plugin`；也可通过 `IINA_PLUGIN_BIN` 指定同版本 CLI。
- native 构建所需的锁定 FFmpeg 归档可用；缺失时构建脚本可能需要下载摘要匹配的归档。
- fake transport 自动化不得使用真实 Key。真实 DeepSeek live test 仅在用户明确批准并确认费用后运行。
- 验收前先阅读 [数据模型](./data-model.md) 和 [DeepSeek Chat Completions 契约](./contracts/deepseek-chat-completions.md)，不要在命令、日志或证据中写入 Endpoint、Key、Authorization、字幕、译文或原始响应。

## 聚焦自动化

实现完成后运行：

```sh
npx vitest run \
  tests/contract/deepseek.test.ts \
  tests/contract/provider-model-discovery.test.ts \
  tests/contract/provider-output.test.ts \
  tests/contract/provider-profiles.test.ts \
  tests/contract/credential-store.test.ts \
  tests/contract/global-rpc.test.ts \
  tests/contract/ui-messages.test.ts \
  tests/contract/sidebar-form.test.ts \
  tests/contract/sidebar-lifecycle.test.ts \
  tests/contract/openai.test.ts \
  tests/contract/ollama.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/unit/model-catalog-sync.test.ts \
  tests/unit/profile-list-sync.test.ts \
  tests/unit/sidebar-state.test.ts \
  tests/unit/provider-cache.test.ts \
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

- Service type 严格按 OpenAI、DeepSeek、Ollama 排序；DeepSeek 默认名称和 Root 正确，Model ID 为空且 Custom 可用，三种草稿与反馈不串用。
- DeepSeek Profile 完成 Save、真实 Test、Select、Update、Delete、revision、选择失效和凭据清理；保存后安全 view 只有 `credentialConfigured`。
- kind 变化不会继承旧 Key；清理失败不会发布半完成的新 revision；迟到凭据反馈不覆盖当前编辑器。
- 模型刷新只请求 `{API Root}/models`，按 `data[].id` 清洗，携带正确上下文的可选 Bearer；无预置模型，失败保留目录和 Custom，迟到结果不提交。
- Test 与翻译的首个请求即使用 `json_object`、`thinking.disabled` 和 `temperature: 0`，无 JSON Schema、probe、fallback 或本地会话 header。
- 有效 wire 精确提交；空、截断、畸形、额外/缺失/重复 ID 和空译文使当前 wire 提交数为 0，前序独立成功 wire 保持现有渐进语义。
- 401、402、429、400/422、500/503、拒绝、timeout、network、cancel 与空输出只形成固定安全分类，不暴露上游正文或任意 code。
- DeepSeek 字幕、上下文和译文不进入 console/Log Viewer；Key 和原始 Provider 数据不进入任何 kind 的 preferences、日志、诊断、进程参数、包或无关 UI。
- 现有 OpenAI capability probe、Ollama schema/prompt fallback、Profile、模型、Test、Select 与翻译回归保持通过。

## DeepSeek live test

以下步骤会连接收费服务，必须由用户明确授权后执行。测试使用独立 opt-in，不要求同时配置 OpenAI 或 Ollama：

```sh
read -r SUBTANDEM_DEEPSEEK_MODEL
read -rs SUBTANDEM_DEEPSEEK_KEY
printf '\n'
export SUBTANDEM_DEEPSEEK_MODEL SUBTANDEM_DEEPSEEK_KEY
SUBTANDEM_LIVE_DEEPSEEK_TEST=1 npx vitest run tests/integration/live-providers.test.ts
unset SUBTANDEM_DEEPSEEK_KEY SUBTANDEM_DEEPSEEK_MODEL
```

测试使用默认 `https://api.deepseek.com`，并应：

- 每次执行 fresh Test；
- 翻译至少 40 个目标，覆盖至少 20 个两项目 wire；
- 验证全部 ID 顺序、非空译文和无提示污染；
- 断言因输出模式或 thinking 导致的失败数为 0；
- 失败只输出 category、retryable、允许的 status、本地 code 与 userAction，不输出敏感内容。

无授权、Key/余额不可用或公网不稳定时跳过 live test，不得把未执行标记为通过；fake transport 自动化仍必须全部通过。

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

预期：全部命令通过，生成 `build/package/SubTandem-0.1.0.iinaplgz`。正式包继续只含 manifest、README、许可证/声明、运行 bundle、UI 和两个受支持架构的 helper；不含凭据、环境文件、运行目录、源码、测试、SDD、构建缓存或 secret-like 内容。本流程不 commit、tag、上传或发布。

若 `npm run pack` 找不到 IINA CLI，必须先安装/指定 CLI 再完成该门禁；只能完成 build/verify 时不得声称打包通过。

## 当前文档与披露复核

人工核对 `Info.json`、根 README、全部 `docs/readme/README.*.md` 和 `docs/engineering/development.md`：

- 当前服务列表为 OpenAI、DeepSeek、Ollama；各语言结构和含义一致。
- DeepSeek 小节说明默认 Root、模型刷新/Custom ID、API Key 只写风险、Save→Test→Select、费用和排错。
- 网络披露区分 Select 前的无字幕模型目录请求与 Select 后的最小字幕翻译请求。
- DeepSeek 认证、余额/配额、限流、Endpoint、Model ID、network route 和服务不可用均有安全排错说明；播放与原字幕继续。
- `permissions` 与 `allowedDomains: ["127.0.0.1"]` 不扩大。

该复核不能替代生产代码自动化，项目文档本身不新增只为断言文案的测试。

## IINA 1.4.4 正式包单人验收

使用同一个最终 `.iinaplgz`，先移除开发链接，记录包 SHA-256、macOS、架构、IINA 版本、非敏感场景 ID、耗时和结果。

1. 安装并启用正式包。从 New Profile 选择 DeepSeek，确认顺序、默认名称/Root、空 Model ID 和 system route；填写 Key，刷新并选取目录 Model ID或输入 Custom，Save、Test、Select，播放受支持字幕并在 180 秒内看到首条译文。Test 不得自动 Select。
2. 连续完成至少 20 个 wire；确认输出完整，翻译等待、重试、空内容或失败从不暂停视频或原字幕，也不显示空/部分失败 wire。
3. 分别验证缺失、错误和正确 Key，以及余额不足、限流、不可达、无效 Root/Model；反馈可操作且不含服务原文，刷新失败保留 Model ID、目录和 Custom。
4. 快速切换 Endpoint A→B、network route、DeepSeek/OpenAI/Ollama、Profile 和 Key，制造乱序响应；旧模型、凭据反馈、Test 或译文不得覆盖当前上下文。
5. 编辑 DeepSeek Profile，确认 revision 增长、旧选择失效且必须重新 Select；把 kind 改为其他服务时旧 DeepSeek Key 不得继承。删除后 Key、选择、任务、目录和 cache 清理，无关 Profile 保持。
6. 关闭/重开 Sidebar、换片、播放结束和关窗，确认临时显示与内存状态清理；多窗口只由各自明确选择的 revision 接收字幕。
7. 分别用既有 OpenAI 与 Ollama Profile 完成 Refresh、Test、Select 和字幕翻译，确认行为无回归。
8. 用不含真实内容的 sentinel 检查 Sidebar、IINA Log Viewer、`iina.log`、`mpv.log`、preferences、诊断与最终包；DeepSeek 内容和所有凭据命中数为 0。
9. 从 IINA 插件管理面板卸载正式包，确认开发链接未被当作正式包证据。

人工证据不得记录完整 Endpoint、Key、Authorization、字幕、译文或原始响应。只有实际完成的步骤才能标记通过。
