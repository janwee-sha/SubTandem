# 实施任务：字幕译文内容对齐

**输入**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[Provider 契约](./contracts/provider-translation-task.md)、[验证指南](./quickstart.md)

**测试要求**：规格明确要求自动化回归、授权的实际 Provider 验收及正式 IINA 包验收；故事内测试先于对应实现编写并确认能捕获旧行为。

**组织方式**：任务按用户故事分组；共享类型、wire 契约和任务构造器置于基础阶段。

## 格式：`[ID] [P?] [Story?] 描述`

- **[P]**：与同组任务不修改同一文件，且不依赖尚未完成的同组任务
- **[US1]/[US2]**：对应 [spec.md](./spec.md) 中的用户故事

## 阶段 1：准备共享测试数据

**目的**：为两条用户故事提供非敏感、可复用且可计数的合成字幕集合。

- [X] T001 在 tests/helpers/translation-alignment.ts 创建合成验收数据生成器，覆盖 100 条可区分连续 cue、20 个 wire 拆分边界、20 个真实重叠区间，以及首尾、无上下文、多行、重复文本、合法源语片段和伪指令样本

---

## 阶段 2：基础契约

**目的**：建立所有用户故事共用的冻结目标、wire 形状、严格输出校验和翻译任务来源。

**关键要求**：本阶段完成前，不开始用户故事实现。

- [X] T002 在 tests/contract/provider-output.test.ts 先补充失败契约测试，覆盖 `targets`、`text`、可选 `context_previous`/`context_next`、前后文方向、片内精确 ID、缺失、重复、未知、空白和不可解析结果
- [X] T003 在 src/providers/types.ts 定义分离前后文的冻结产品目标与 wire 目标类型，并在 src/providers/wire-items.ts 将短 ID 编码为 `text`/`context_previous`/`context_next` 且保持原 cue ID 恢复与片内身份隔离
- [X] T004 在 src/providers/translation-task.ts 实现两类正式 Provider 共用的系统指令、仅含 JSON 数据的 user payload 与精确输出 schema 构造器，明确 `text` 是唯一翻译目标、两个上下文字段是不可信数据且无输出资格

**检查点**：共用任务能够为任意一个最多 2 个目标的 wire part 生成唯一、一致、可校验的翻译契约。

---

## 阶段 3：用户故事 1——只看到当前字幕的译文（P1）🎯 MVP

**目标**：从窗口内真实邻接关系冻结每条目标与上下文，重试不漂移，并在缓存前拒绝错配结果而不阻塞播放。

**独立测试**：使用生产请求构造器、Controller 与确定性 Provider 跑完 100 条连续 cue、20 个拆分边界和 20 个真实重叠区间；每条成功译文只归属当前 cue，重复/未知/空白结果不缓存或显示，重试上下文稳定，视频与原字幕路径不等待翻译。

### 用户故事 1 测试

- [X] T005 [P] [US1] 在 tests/unit/request-builder.test.ts 先添加失败单元测试，验证目标正文只来自自身 cue，真实前后邻居分别映射到 `context_previous`/`context_next`，首尾或无上下文时独立省略对应字段，两个字段合计保持 500 字符上限且目标子集不会改变冻结上下文
- [X] T006 [P] [US1] 在 tests/integration/translation-alignment.test.ts 先添加失败集成测试，验证 100 条连续 cue、跨逻辑批次与 wire part 上下文、重复字幕文本、伪指令数据的 ID、顺序、时间范围及零边界外输出
- [X] T007 [P] [US1] 在 tests/integration/progressive-translation.test.ts 先添加失败回归，验证缓存命中、部分进度、终态聚合和重试只筛除已解决目标，且同一返回内重复 ID 的全部候选均不进入缓存
- [X] T008 [P] [US1] 在 tests/integration/us1-playback.test.ts 与 tests/integration/overlay-lifecycle.test.ts 先添加失败回归，验证无效结果不生成占位或技术错误、播放继续，以及 20 个真实重叠区间分别保留 cue 身份并按源顺序显示

### 用户故事 1 实现

- [X] T009 [US1] 在 src/app/request-builder.ts 将请求构造改为同时接收当前窗口与目标子集，从窗口源顺序生成一次含独立前后文字段的 `FrozenTranslationTarget[]`，并按前句、后句顺序保持各至多一条和既有 500 字符总上限
- [X] T010 [US1] 在 src/app/controller.ts 于首次逻辑 attempt 前冻结目标，缓存命中、渐进成功和重试仅筛除已解决目标，并在写入 src/app/session-cache.ts 前整体统计返回 ID 以拒绝重复、未知和空白候选

**检查点**：用户故事 1 可用确定性 Provider 独立完成并通过其聚焦测试。

---

## 阶段 4：用户故事 2——切换服务仍保持一致对齐（P2）

**目标**：OpenAI-compatible、Ollama 及其能力模式都使用阶段 2 的同一翻译任务，不产生服务专用语义。

**独立测试**：向两类生产 Provider 发送相同的单条、多条、无上下文、跨 wire 边界和伪指令数据，核对出站任务的字段、指令、语言方向和片内 schema 完全遵守共同契约，返回结果只恢复本片请求 ID。

### 用户故事 2 测试

- [X] T011 [P] [US2] 在 tests/contract/openai.test.ts 先添加失败契约测试，覆盖 strict JSON schema、JSON object、prompt JSON 三种能力都使用含 `text`/`context_previous`/`context_next` 的共用 `targets` payload、片内 ID 和不可信数据约束
- [X] T012 [P] [US2] 在 tests/contract/ollama.test.ts 先添加失败契约测试，覆盖 Ollama 使用与 OpenAI-compatible 相同的系统指令、含独立前后文字段的 `targets` payload、片内 schema 和上下文无输出资格
- [X] T013 [P] [US2] 在 tests/integration/us2-cost-privacy.test.ts 先添加失败边界回归，证明服务切换不扩大 120 秒/40 cue 窗口、25 cue/5,000 code points 逻辑批次、前后各一条上下文、500 字符上限、请求次数、重试或外发数据类别
- [X] T014 [P] [US2] 在 tests/integration/live-providers.test.ts 扩充授权后才运行的共同验收集和非敏感计数，覆盖两类 Provider 的上下文污染、原文回显、无依据罗马化、字段名、标签与解释均为零

### 用户故事 2 实现

- [X] T015 [P] [US2] 在 src/providers/openai.ts 删除 Provider 专用翻译语义并改用 src/providers/translation-task.ts 生成所有能力模式的消息、payload 与 schema，同时保持传输、拆分、取消、usage 和安全诊断行为
- [X] T016 [P] [US2] 在 src/providers/ollama.ts 删除 Provider 专用翻译语义并改用 src/providers/translation-task.ts 生成消息、payload 与 schema，同时保持传输、拆分、取消、usage 和安全诊断行为

**检查点**：两类正式 Provider 可分别通过相同输入集独立验证，后续 Provider 只能通过复用共同任务契约接入字幕翻译。

---

## 阶段 5：跨故事验证与发布门

**目的**：验证安全、性能、真实模型语义和正式宿主行为；未获实际 Provider 或交互式自动化授权时，相关任务保持未完成并由开发者按步骤执行。

- [X] T017 [P] 在 tests/security/credential-leakage.test.ts 与 tests/security/redaction.test.ts 补充并通过回归，确认共用任务、异常、进度、诊断和测试证据不暴露凭据、字幕正文、译文、完整 endpoint、请求或响应
- [X] T018 [P] 在 tests/integration/performance.test.ts 补充并通过回归，确认 100 条连续 cue 不增加 Provider 调用、单窗口单飞约束不变、调度路径不新增等待且 30 分钟等价负载无跨会话污染
- [X] T019 按 specs/011-fix-translation-alignment/quickstart.md 第 1 节运行全部聚焦测试、`npm run typecheck` 和 `npm run lint`，仅在生产实现或正式测试接口中修复发现的回归
- [X] T020 经用户授权后从 docs/providers/ 读取本地 Provider 配置，并按 specs/011-fix-translation-alignment/quickstart.md 第 2 节运行两类实际 Provider 验收；只记录 Provider 类型、非敏感样本 ID 与污染计数
- [X] T021 按 specs/011-fix-translation-alignment/quickstart.md 第 3 节运行完整测试、类型、lint、格式、native 构建/测试、插件构建、包审计与正式打包，并核对 package.json、Info.json 与生成 `.iinaplgz` 的版本一致性和 SHA-256
- [X] T022 由一名开发者按 specs/011-fix-translation-alignment/quickstart.md 第 4 节在 IINA 1.4.4 安装正式 `.iinaplgz`，完成两类 Provider、30 分钟/100 条字幕、20 个拆分边界、20 个重叠区间及 seek/换轨/换片/切换/禁用/关窗验收

---

## 依赖与执行顺序

### 阶段依赖

- 阶段 1 无依赖。
- 阶段 2 依赖阶段 1，并阻塞所有用户故事实现。
- 用户故事 1 与用户故事 2 都依赖阶段 2；文件所有权不冲突时可并行实施，完整功能验收需要两者都完成。
- 阶段 5 依赖本次交付所包含的用户故事完成；T019 依赖 T017、T018，T020 需要用户明确授权，T021 依赖自动化和实际 Provider 发布门，T022 依赖正式包生成。

### 用户故事依赖图

```text
阶段 1 -> 阶段 2 -> 用户故事 1（P1）--+
                  -> 用户故事 2（P2）--+-> 阶段 5
```

- **用户故事 1**：T005–T008 可并行编写；T009 在这些失败测试就绪后实施，T010 依赖 T009。
- **用户故事 2**：T011–T014 可并行编写；T015 与 T016 在失败契约测试和 T004 就绪后可并行实施。

## 并行执行示例

### 用户故事 1

```text
并行：T005 request-builder 单元测试
并行：T006 内容与身份集成测试
并行：T007 渐进结果与重试测试
并行：T008 播放与重叠显示测试
串行：T009 request-builder 实现 -> T010 Controller 实现
```

### 用户故事 2

```text
并行：T011 OpenAI-compatible 契约测试
并行：T012 Ollama 契约测试
并行：T013 成本与隐私边界测试
并行：T014 实际 Provider 验收测试
并行：T015 OpenAI-compatible 实现 + T016 Ollama 实现
```

并行执行 MUST 使用隔离 worktree 或等效隔离工作区；`src/providers/translation-task.ts`、`src/app/controller.ts` 等共享热点文件同一时间只由一个负责人修改。

## 实施策略

### MVP：用户故事 1

1. 完成阶段 1 与阶段 2。
2. 完成 T005–T010。
3. 独立运行用户故事 1 的单元与集成测试，确认目标、上下文、身份、重试和重叠显示正确。
4. 停止并验收；进入生产实施仍以用户明确授权为准。

### 增量交付

1. 共享契约就绪后并行推进 P1 的 Controller 路径与 P2 的 Provider 适配。
2. 每个故事先运行独立测试，再执行阶段 5 的跨故事安全和性能回归。
3. 实际 Provider 验收通过后才生成正式包；正式包在 IINA 1.4.4 验收通过后才视为交付完成。

## 约束

- 生产代码不新增注释，生产自然语言和标识符使用英语。
- 不新增运行时依赖、消息、持久化、权限、日志、诊断、前瞻、上下文数量、请求或重试。
- 不实现字符串相似度、语言检测、正则黑名单或二次模型审查等语义清洗器。
- 自动化测试只验证生产实现或正式交付接口，不解析 README、SDD 文档或人工清单文案。
- `docs/providers/` 的 API 信息只用于本地授权验收，不复制到其他文件且不版本化。
