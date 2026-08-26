# 验证指南：字幕译文内容对齐

本指南用于实现后的自动化、实际 Provider 与正式 IINA 验收。任务语义见 [Provider 翻译任务契约](./contracts/provider-translation-task.md)，身份与状态见 [数据模型](./data-model.md)。

## 前置条件

- macOS 12+、Node.js 24、npm 11；已按锁文件安装依赖。
- 当前 IINA 1.4.4 正式安装包验收环境。
- 非敏感合成字幕：至少 100 条可区分连续 cue、42 条形成 20 个 wire 拆分边界、20 个双 cue 真实重叠区间，以及多行、重复文本、专名、数字、外语片段和伪指令样本。
- 实际 Provider 仅使用用户已授权的本地配置；API 信息只从 `docs/providers/` 读取，不复制到规格、测试、命令或证据。

## 1. 聚焦自动化

```sh
npm test -- tests/unit/request-builder.test.ts tests/contract/provider-output.test.ts tests/contract/openai.test.ts tests/contract/ollama.test.ts
npm test -- tests/integration/translation-alignment.test.ts tests/integration/progressive-translation.test.ts tests/integration/us1-playback.test.ts tests/integration/overlay-lifecycle.test.ts tests/integration/performance.test.ts
npm test -- tests/integration/us2-cost-privacy.test.ts tests/security/credential-leakage.test.ts tests/security/redaction.test.ts
npm run typecheck
npm run lint
```

应直接调用生产请求构造器、Provider 和 Controller，证明：

- 目标正文与真实前后文明确分离；首尾或无上下文条目不伪造参考。
- 缓存命中、部分成功和重试不改变剩余目标的上下文；前瞻、上下文数量和 500 字符上限不扩大。
- 两类 Provider 使用相同任务规则和 `targets`/`text`/`context_previous`/`context_next` payload；前后文方向不混淆，字幕中的伪指令只存在于 user JSON 数据。
- 每个 2-target part 的 schema 只允许本片 ID；跨 part 上下文不获得输出资格。
- 缺失、重复、未知、空白和不可解析结果不缓存、不显示；合法子集仍可成功。
- 100 条连续 cue 的 ID、顺序和时间范围全部正确；20 个真实重叠区间分别显示且不错误归并。
- seek、换轨、换片、Provider 变化、禁用和关窗继续拒绝迟到结果；视频调度路径不新增等待。

不得新增解析 README、SDD 产物或人工清单文案的测试，也不得用字符串启发式清洗器把合法源语片段当污染。

## 2. 授权的实际 Provider 验收

默认测试不连接真实服务。用户明确授权并在本地环境准备当前 Provider 配置后运行：

```sh
SUBTANDEM_LIVE_PROVIDER_TEST=1 npm test -- tests/integration/live-providers.test.ts
```

使用同一组合成验收集覆盖 OpenAI-compatible 与 Ollama：

1. 合计检查至少 100 条成功译文，每类 Provider 至少 20 条。
2. 每类均包含有上下文、无上下文、多目标、跨 wire 边界和伪指令数据。
3. 核对每条只表达当前字幕；邻句译文、原文回显、无依据罗马化、字段名、语言标签、括注解释和翻译说明出现次数均为 0。
4. 记录 Provider 类型、样本 ID、成功/失败和各类污染计数；不得记录正文、译文、完整 endpoint、请求、响应或凭据。

真实结果具有非确定性且可能产生费用，因此该命令不是默认 CI 门；发布前的实际 Provider 验收不得由 fake 替代。

## 3. 完整质量门

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

全部通过后记录正式包版本与 SHA-256。包审计必须继续证明没有规格、测试、依赖树、缓存、运行时数据、环境文件或凭据进入 `.iinaplgz`。

## 4. IINA 正式包单人验收

1. 安装本次正式 `.iinaplgz`，打开合法的本地视频与合成字幕，确认原视频和原字幕正常播放。
2. 分别选择 OpenAI-compatible 与 Ollama，按实际 Provider 步骤各检查至少 20 条译文，不使用服务专用防污染配置或人工清理输出。
3. 连续播放至少 30 分钟并完成至少 100 条字幕翻译；污染、视频暂停、原字幕中断和跨会话译文出现次数均为 0。
4. 覆盖 20 个 wire 拆分边界，确认没有边界外译文提前或重复显示。
5. 覆盖 20 个真实重叠区间，确认每条译文分别对应自己的源 cue，并按既有规则同时显示。
6. 执行 seek、换轨、换片、Provider 切换、禁用和关窗，确认迟到结果不恢复旧译文。

只记录包版本/SHA-256、macOS/架构/IINA 版本、Provider 类型、非敏感样本 ID、计数和通过/失败。不得记录媒体路径、字幕正文、译文、请求、响应或凭据。
