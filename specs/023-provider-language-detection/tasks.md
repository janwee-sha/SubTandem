---

description: "翻译服务自动识别源语言的可执行任务列表"
---

# 任务：翻译服务自动识别源语言

**输入**：`specs/023-provider-language-detection/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格和项目宪法要求自动化回归；各用户故事先补失败测试，再修改生产实现。联网 Provider 测试必须取得用户对网络与潜在费用的明确批准。

**组织方式**：任务按用户故事分组；`[P]` 只表示在前置任务完成后可于不同隔离 worktree 中并行修改互不重叠的文件。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：文件所有权独立，且不依赖同阶段尚未完成的任务
- **[Story]**：任务所属用户故事（`[US1]`、`[US2]`、`[US3]`）
- 每项任务均给出明确文件路径

## Phase 1：Setup（测试资料）

**目的**：以小型、受版本管理且不含敏感数据的 fixture 替代检测语料。

- [X] T001 新建 `tests/fixtures/providers/provider-language-detection.json`，覆盖 5–11 cue 短轨、中长轨、罗马字、混合语言、错误或缺失轨道标签、重复正文、同语言多行与首尾空格、`zh-Hans`/`zh-Hant`/`pt-PT` 目标变体

---

## Phase 2：Foundational（共享测试基础）

**目的**：为三个用户故事提供统一且确定性的测试输入构造能力。

**关键约束**：本阶段完成前不得开始用户故事任务。

- [X] T002 基于 T001 实现 fixture 读取、`SubtitleCue` 构造、冻结目标和逐字符比较辅助函数于 `tests/helpers/provider-language-detection.ts`，不得读取旧 `tests/fixtures/languages/` 语料

**Checkpoint**：共享测试基础可供所有用户故事独立复用。

---

## Phase 3：User Story 1 - 无需本地语言判断即可翻译（Priority: P1）🎯 MVP 基础

**目标**：可读字幕在翻译、目标语言和 Profile 条件有效时直接进入当前 Provider，不产生本地或独立远程语言检测，不受轨道标签、长度或语种影响。

**独立测试**：只运行 US1 聚焦测试，使用短/中/长轨、罗马字、混合语言及错误/缺失标签 fixture；断言首个 attempt 在受控时钟 500ms 内发生、payload 只有精确目标语言、无检测请求，且所有生命周期和授权边界保持有效。

### Tests for User Story 1

- [X] T003 [P] [US1] 先新增失败的端到端 Controller 回归，覆盖直接准入、500ms 启动、有限窗口/批次、重试、换轨/片/目标/Profile/禁用/关窗、seek 和多窗口迟到结果隔离于 `tests/integration/provider-language-detection.test.ts`
- [X] T004 [P] [US1] 先新增失败的 Main↔Global 请求契约测试，断言精确字段、目标目录、身份与大小边界，并拒绝 `sourceLanguage`、轨道语言、检测字段、未知字段和非法目标于 `tests/contract/ui-messages.test.ts`
- [X] T005 [P] [US1] 先更新字幕源单元测试，断言外挂与内嵌准备结果不再保存或受 `lang` 影响，格式、hash、cue 与警告保持于 `tests/unit/subtitle-source.test.ts`
- [X] T006 [P] [US1] 先更新 OpenAI-compatible 契约测试，断言所有能力模式仅接收精确目标变体并要求逐条自行理解源语言于 `tests/contract/openai.test.ts`
- [X] T007 [P] [US1] 先更新 Ollama 契约测试，断言 JSON Schema 与一次有界 prompt fallback 的任务均不含确定源语言于 `tests/contract/ollama.test.ts`
- [X] T008 [P] [US1] 先更新 DeepSeek 契约测试，断言 JSON object 与 thinking-disabled 封装保留且共同任务只确定目标语言于 `tests/contract/deepseek.test.ts`
- [X] T009 [P] [US1] 先更新 Claude-compatible 契约测试，断言顶层 system、单 user、`end_turn` 和目标唯一方向语义于 `tests/contract/claude.test.ts`
- [X] T010 [P] [US1] 先更新安全回归，断言未启用或未选择有效 Profile 时不外发、合法请求不含源语言、错误与诊断不泄漏正文或凭据，并移除 detector 诊断断言于 `tests/security/credential-leakage.test.ts` 和 `tests/security/redaction.test.ts`

### Implementation for User Story 1

- [X] T011 [P] [US1] 从字幕轨身份及外挂/内嵌准备结果删除语言字段和读取逻辑，同时保留格式识别所需标题于 `src/subtitles/types.ts`、`src/adapters/iina/subtitle-source.ts` 和 `src/subtitles/source.ts`
- [X] T012 [P] [US1] 从翻译请求、请求构造器、会话缓存身份和共享测试请求删除 `sourceLanguage`，缓存键只保留 session/hash/target/provider/cue 维度于 `src/providers/types.ts`、`src/app/request-builder.ts`、`src/app/session-cache.ts` 和 `tests/contract/provider-test-helpers.ts`
- [X] T013 [US1] 实现 `provider:attempt` 的 exact-shape 运行时解析，校验身份、精确目标目录、非空 items、25 项/5,000 code point Controller 边界和冻结目标上下文边界于 `src/domain/messages.ts`
- [X] T014 [US1] 删除检测状态、检测回调、同语言短路和 source cache 维度，使 Controller 在有效配置与位置下直接构造目标唯一请求并保持既有窗口、批次、重试、取消与播放安全语义于 `src/app/controller.ts`
- [X] T015 [P] [US1] 删除 Main 的检测协调器、检测启动/失效调用和轨道语言传递，字幕就绪后直接驱动 T014 且保留字幕准备与会话生命周期于 `src/main.ts`
- [X] T016 [P] [US1] 在 Global 调用 Provider 前使用 T013 解析完整 payload，以权威发送方 ID 覆盖 `playerId`，并删除启动时旧源语言 preference 写入及 manifest 默认项于 `src/global.ts`、`src/adapters/iina/target-language-preferences.ts` 和 `Info.json`
- [X] T017 [US1] 将共同 Provider task builder 改为仅接收精确目标语言和冻结条目，要求逐条从正文/只读上下文理解源语言并保持 JSON ID 约束于 `src/providers/translation-task.ts`
- [X] T018 [P] [US1] 基于 T017 从 OpenAI-compatible 请求链删除 source 参数并保持 strict schema、JSON object、prompt JSON 及合法子集提交于 `src/providers/openai.ts`
- [X] T019 [P] [US1] 基于 T017 从 Ollama 请求与 fallback 链删除 source 参数并保持每次 wire 两项和一次有界能力降级于 `src/providers/ollama.ts`
- [X] T020 [P] [US1] 基于 T017 从 DeepSeek 请求链删除 source 参数并保持 JSON object、thinking disabled 和全有或全无提交于 `src/providers/deepseek.ts`
- [X] T021 [P] [US1] 基于 T017 从 Claude-compatible 请求链删除 source 参数并保持 Messages 封装、`end_turn` 和全有或全无提交于 `src/providers/claude.ts`
- [X] T022 [US1] 删除废弃检测实现 `src/app/language-detection.ts`、`src/subtitles/language-detection.ts`、`src/domain/source-languages.ts`、`src/domain/language.ts`，删除 detector-only 测试 `tests/contract/language-corpus.test.ts`、`tests/integration/acceptance-metrics.test.ts`、`tests/integration/auto-language-support.test.ts`、`tests/integration/local-language-regressions.test.ts`、`tests/integration/performance.test.ts`、`tests/unit/language-detection-coordinator.test.ts`、`tests/unit/language-detection.test.ts`、`tests/unit/language-diagnosis.test.ts`、`tests/unit/language.test.ts`、`tests/unit/source-languages.test.ts`、`tests/helpers/language-calibration.ts`、`tests/helpers/language-corpus.ts`、`tests/helpers/language-diagnosis.ts`、`tests/helpers/language-metrics.ts`、`tests/helpers/language-performance-cases.ts`、`tests/helpers/language-performance-worker.mjs` 及 `tests/fixtures/languages/`

**Checkpoint**：US1 聚焦测试通过；任意可提交字幕无需本地源语言即可进入 Provider，且检测实现与语料已删除。

---

## Phase 4：User Story 2 - 同语言正文原样返回（Priority: P1）🎯 MVP 完整

**目标**：四类 Provider 对每个条目独立决定翻译或逐字符原样返回；合法结果从 Provider parser 经跨运行时消息、Controller、缓存到 Overlay 不被裁剪或丢弃空行。

**独立测试**：对四类 mock Provider 使用同语言、混合批次、多行、标点、重复正文及目标变体 fixture；以 `===` 比较原样项，验证非同语言项仍翻译、上下文不输出、同 ID 不合并、纯空白与非法身份仍拒绝。

### Tests for User Story 2

- [X] T023 [P] [US2] 先扩展四类 Provider 与共享输出契约测试，逐类覆盖同语言/混合批次任务语义、重复正文不同 ID、首尾空格/换行保真，以及空白、缺失、重复和未知 ID 拒绝于 `tests/contract/provider-output.test.ts`、`tests/contract/openai.test.ts`、`tests/contract/ollama.test.ts`、`tests/contract/deepseek.test.ts` 和 `tests/contract/claude.test.ts`
- [X] T024 [P] [US2] 先扩展会话缓存测试，断言原样与译文走同一路径、保存原字符串、纯空白拒绝且目标/Profile/会话变化隔离于 `tests/unit/session-cache.test.ts`
- [X] T025 [P] [US2] 先扩展 Overlay 单元与契约测试，断言首尾和内部空行位置保留、整条全空白清除、消息不改写缓存字符串于 `tests/unit/translation-overlay.test.ts` 和 `tests/contract/overlay-webview.test.ts`
- [X] T026 [P] [US2] 先重写同语言费用与隐私回归，断言仍调用已选服务、未授权不外发、相同结果不重试且不记录正文于 `tests/integration/us2-cost-privacy.test.ts` 和 `tests/security/credential-leakage.test.ts`
- [X] T027 [P] [US2] 扩展默认关闭的真实服务验收矩阵，固定四类 Provider 的同语言、混合语言和目标变体 case ID 且只记录非敏感布尔证据于 `tests/integration/live-providers.test.ts`

### Implementation for User Story 2

- [X] T028 [US2] 扩展共同任务语义，明确精确目标变体、同语言逐字符原样、上下文只读、每个 wire ID 恰好一次以及禁止说明/标签/额外原文于 `src/providers/translation-task.ts`
- [X] T029 [US2] 将合法非空结果的判空与保存分离，OpenAI/Ollama 合法子集及 DeepSeek/Claude 严格全集均保留 JSON 解码后的原始 `text` 于 `src/providers/validation.ts`
- [X] T030 [US2] 在 progress/result、Controller、会话缓存和 Overlay 链路只用 `trim()` 判全空白并始终传递原字符串，允许非全空白文本中的空行于 `src/domain/messages.ts`、`src/app/controller.ts`、`src/app/session-cache.ts`、`src/subtitles/active-translations.ts`、`src/adapters/iina/webview-translation-overlay.ts` 和 `ui/overlay-state.ts`

**Checkpoint**：US1 与 US2 均通过独立测试；同语言正文仍产生一次正常服务调用并逐字符显示、缓存。

---

## Phase 5：User Story 3 - 界面只展示可操作状态（Priority: P2）

**目标**：Sidebar 删除检测语言摘要和四类失效状态，只保留字幕准备、配置、运行、部分失败与服务不可用等可操作信息。

**独立测试**：向 Sidebar 发送可读、不可读、短轨、混合语言和同语言会话状态；断言无 `Detected language`、`Unknown` 或检测状态，同时格式、cue 数、准备错误、配置及 Provider 失败仍正确显示。

### Tests for User Story 3

- [X] T031 [US3] 先更新状态与静态 UI 契约测试，断言状态白名单和字幕摘要无检测字段/占位/文案，同时保留准备、配置、运行与服务错误呈现于 `tests/contract/ui-messages.test.ts` 和 `tests/contract/sidebar-form.test.ts`

### Implementation for User Story 3

- [X] T032 [P] [US3] 从会话状态目录删除 `detectingLanguage`、`languageUnrecognized`、`languageUnsupported` 和 `noTranslationNeeded` 于 `src/domain/status.ts`
- [X] T033 [P] [US3] 从 Main 发出的本地字幕摘要及共享视图类型删除 detected/source language 字段，同时保留格式、cue 数、警告和准备错误于 `src/main.ts` 和 `src/domain/types.ts`
- [X] T034 [P] [US3] 删除 Sidebar 的 `Detected language` 行、`Unknown` 占位、四类失效标签和接收字段，并保持其余状态与 IINA/macOS 现有布局不变于 `ui/sidebar.html` 和 `ui/sidebar.ts`

**Checkpoint**：三个用户故事均可独立验收，UI 只反映当前仍有效的字幕与翻译状态。

---

## Phase 6：Polish & Cross-Cutting Concerns

**目的**：完成依赖、披露、残留审计及正式交付验证。

- [X] T035 [P] 更新服务自动理解源语言、短轨/未知/同语言仍外发及潜在费用披露，删除手动确认源语言说明于 `README.md`、`docs/readme/README.ar.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.ru.md`、`docs/readme/README.zh-CN.md`、`Info.json` 和 `docs/engineering/development.md`
- [X] T036 [P] 删除 `franc` 及只由其引入的传递依赖并同步第三方声明于 `package.json`、`package-lock.json` 和 `THIRD_PARTY_NOTICES.txt`
- [X] T037 执行 `specs/023-provider-language-detection/quickstart.md` 的生产残留扫描和聚焦 Vitest 命令，修复后原样重跑直至通过
- [X] T038 在最后一次代码变更后依次执行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`，按 `specs/023-provider-language-detection/quickstart.md` 验收测试、编译和正式包
- [X] T039 仅在用户明确批准网络及潜在费用后执行 `specs/023-provider-language-detection/quickstart.md` 的三组 live Provider 命令；未获批准时在交付报告明确记录为未执行且不得推断通过
- [ ] T040 使用最终 `.iinaplgz` 按 `specs/023-provider-language-detection/quickstart.md` 完成单人 IINA 短轨、未知源语言、同语言、目标变体、失败、生命周期、多窗口及卸载验收并记录包版本或 SHA-256 与环境

### 翻译方向与时延可靠性

- [X] T041 [US1] 先补失败契约测试，断言四类 Provider 的 user payload 重复可信精确目标、Ollama 任务禁止在源语言不确定时回显非目标正文，并断言 Claude-compatible 显式关闭 thinking、只对明确字段不兼容执行一次省略降级于 `tests/contract/provider-output.test.ts`、`tests/contract/ollama.test.ts` 和 `tests/contract/claude.test.ts`
- [X] T042 [US1] 强化共同任务的目标显著性与输出前复核，并为 Claude-compatible 实现显式关闭 thinking 及一次有界不兼容降级于 `src/providers/translation-task.ts` 和 `src/providers/claude.ts`
- [X] T043 重跑 023 聚焦测试及 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`；T040 必须使用该次最终包重新验收

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：无前置依赖。
- **Foundational（Phase 2）**：依赖 T001，阻塞全部用户故事。
- **US1（Phase 3）**：依赖 T002；T003–T010 先建立失败测试，T011–T012 可并行，T013–T017 按契约到协调层顺序收敛，T018–T021 在 T017 后并行，最后执行 T022。
- **US2（Phase 4）**：依赖 US1；同语言服务调用必须先移除本地同语言短路。T023–T027 可先并行补测试，随后按 T028 → T029 → T030 实现字符保真链路。
- **US3（Phase 5）**：依赖 US1 已停止产生检测状态；T031 先失败，T032–T034 可在独立 worktree 并行。
- **Polish（Phase 6）**：依赖计划交付的全部用户故事；T035 与 T036 可并行，T037 后执行 T038。按 T041 → T042 → T043 收敛翻译方向与 Claude-compatible 时延可靠性；T039 受用户授权约束，T040 依赖 T043 生成的最终包。

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬→ US2 ─┐
                            └→ US3 ─┴→ Polish
```

- **US1（P1）**：建立自动源语言请求和删除本地检测，是后续故事的运行基础。
- **US2（P1）**：依赖 US1 的“同语言仍调用 Provider”准入；完成后构成完整 P1 MVP。
- **US3（P2）**：行为上只依赖 US1 不再产生旧状态，可与 US2 在隔离 worktree 中并行并按 US1 → US2 → US3 顺序合并共享契约审计结果。

### Within Each User Story

- 先提交会失败且直接调用生产实现的测试，再完成生产变更。
- 数据与运行时契约先于 Controller/Main/Global 调度，任务语义先于各 Provider adapter。
- Provider parser 先于下游字符串保真，状态生产者先于 UI 删除。
- 每个故事到达 Checkpoint 后运行其独立测试，不以其他故事结果替代。

### Parallel Opportunities

- T003–T010 的测试文件所有权互不重叠，可在 T002 后并行。
- T011 与 T012 修改不同的数据边界；T015 与 T016 修改不同运行时，可在其各自前置完成后并行。
- T018–T021 是四个独立 Provider adapter，可在 T017 后并行。
- T023–T027 修改不同测试文件组，可在 US1 后并行。
- T032–T034 分别负责 domain、Main view 和 Sidebar，可在 T031 后并行。
- T035 与 T036 分别负责用户/工程文档和依赖/声明，可在所有故事完成后并行。

---

## Parallel Example: User Story 1

在 T002 完成后，分别使用隔离 worktree 启动：

```text
Task T003: tests/integration/provider-language-detection.test.ts
Task T004: tests/contract/ui-messages.test.ts
Task T005: tests/unit/subtitle-source.test.ts
Task T006: tests/contract/openai.test.ts
Task T007: tests/contract/ollama.test.ts
Task T008: tests/contract/deepseek.test.ts
Task T009: tests/contract/claude.test.ts
Task T010: tests/security/credential-leakage.test.ts + tests/security/redaction.test.ts
```

T017 合并后，Provider 实现可并行：

```text
Task T018: src/providers/openai.ts
Task T019: src/providers/ollama.ts
Task T020: src/providers/deepseek.ts
Task T021: src/providers/claude.ts
```

合并顺序：测试 worktree → T011/T012 → T013/T014 → T015/T016 → T017 → Provider worktree → T022。

## Parallel Example: User Story 2

US1 合并后，分别使用隔离 worktree 启动：

```text
Task T023: tests/contract/provider-output.test.ts + tests/contract/openai.test.ts + tests/contract/ollama.test.ts + tests/contract/deepseek.test.ts + tests/contract/claude.test.ts
Task T024: tests/unit/session-cache.test.ts
Task T025: tests/unit/translation-overlay.test.ts + tests/contract/overlay-webview.test.ts
Task T026: tests/integration/us2-cost-privacy.test.ts + tests/security/credential-leakage.test.ts
Task T027: tests/integration/live-providers.test.ts
```

合并测试后按 T028 → T029 → T030 完成共享实现。

## Parallel Example: User Story 3

T031 合并后，分别使用隔离 worktree 启动：

```text
Task T032: src/domain/status.ts
Task T033: src/main.ts + src/domain/types.ts
Task T034: ui/sidebar.html + ui/sidebar.ts
```

三项合并后共同运行 T031 的契约测试。

---

## Implementation Strategy

### MVP First

本功能有两个同为 P1 且有真实依赖的故事，建议 MVP 为 **US1 + US2**：

1. 完成 Phase 1 与 Phase 2。
2. 完成 US1，验证所有可提交字幕直接进入当前 Provider。
3. 完成 US2，验证同语言逐字符原样及完整字符链路。
4. 停止并运行 P1 聚焦测试；此时才具备可发布的最小行为闭环。

### Incremental Delivery

1. Setup + Foundational：固定小型行为 fixture 与共享构造器。
2. US1：删除本地检测并建立目标唯一翻译请求。
3. US2：补齐同语言和字符保真，形成完整 P1 MVP。
4. US3：清理用户可见状态与摘要。
5. Polish：同步披露与依赖，执行残留审计、完整质量门和正式包验收。

### Parallel Team Strategy

1. 一名负责人完成 T001–T002 和共享热点契约。
2. 各 `[P]` 任务使用隔离 worktree；同一时刻不得多人修改 `src/app/controller.ts`、`src/domain/messages.ts`、`src/main.ts`、`src/global.ts` 或 `ui/sidebar.ts`。
3. Provider 测试和 adapter 按 OpenAI → Ollama → DeepSeek → Claude 的固定顺序合并，再由共享负责人执行 T022/T030 和完整回归。

## Notes

- `[P]` 仅表示满足文件隔离与依赖条件，不授权在共享工作区直接并发编辑。
- 生产代码不得新增注释，生产自然语言使用英语；SDD 与项目文档中文优先。
- 不新增 endpoint、检测请求、持久缓存、源语言兼容字段、语义复核或无限重试。
- 所有自动化测试必须直接导入、调用或检查生产实现。
- 每次最终代码调整后必须重新执行测试、编译和打包三类验证；旧结果不得沿用。

## Phase 7: Convergence

- [X] T044 CRITICAL：重构本规格范围内 `src/main.ts`、`src/global.ts`、`src/subtitles/encoding.ts`、`src/adapters/iina/subtitle-source.ts`、`src/adapters/iina/provider-transport.ts`、`src/adapters/iina/transport-process.ts`、`src/providers/provider.ts` 与 `src/providers/openai.ts` 的现存生产注释，以命名、函数和类型边界表达同等意图；完成条件为这些文件不再含行、块或文档注释且聚焦测试行为不变 per Constitution II (contradicts)
- [X] T045 CRITICAL：为 T046–T049 的 Claude structured-output 能力降级建立安全与交付门禁：在 `tests/security/credential-leakage.test.ts` 和 `tests/security/redaction.test.ts` 断言额外请求仍受当前 Profile、取消、正文最小化与诊断脱敏约束，在 `README.md`、`docs/readme/README.zh-CN.md`、`Info.json` 和 `docs/engineering/development.md` 披露兼容服务可能因明确能力拒绝多发一次计费请求；待 T046–T049 完成后重新执行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`，并要求 T040 使用本次最终包 per Constitution I/III/IV (missing)
- [X] T046 [US2] 先在 `tests/contract/claude.test.ts`、`tests/contract/provider-output.test.ts` 和 `tests/contract/ui-messages.test.ts` 增加失败回归：断言 Claude 请求携带与当前 wire ID 完全一致的 `output_config.format` JSON Schema、仅在 400/422 明确拒绝 structured output 时有界降级且不掩盖鉴权/模型/配额/其他错误；以不含真实正文和请求 ID 的 fixture 覆盖单个纯 JSON 代码围栏、精确 requested-ID 字符串映射及 AIHubMix Haiku 组合形状，同时继续拒绝外围说明、多围栏、缺失/未知/额外 ID、额外字段、重复 ID、空白和非字符串结果，并断言连接测试准确显示协议输出错误 per SC-003 (missing)
- [X] T047 [US2] 让 `src/providers/translation-task.ts` 向 Claude 暴露现有 `providerOutputSchema`，并在 `src/providers/claude.ts` 默认发送 Anthropic `output_config.format` `json_schema`；只对响应正文明确指出 `output_config`、JSON Schema 或 structured output 不受支持的 400/422 响应省略该字段后重试一次，按 Provider 实例缓存能力，和 thinking 降级分别有界且不得对 2xx 格式错误、鉴权、模型、配额或无关失败重放请求 per FR-008 / SC-003 (partial)
- [X] T048 [US2] 在 `src/providers/claude.ts` 与 `src/providers/validation.ts` 增加 Claude 专用受控规范化：只剥离完整包裹单个 JSON 对象的一个 `json`/无语言标记代码围栏，并只把键集合与 requested IDs 完全相等、值全为非空字符串的 ID 映射转换为标准 `translations` 数组；禁止从外围说明或多个候选中提取 JSON，规范化后仍调用 `validateStrictIdOutput` 保持全有或全无、字段白名单和逐字符文本保真 per FR-010 / US2/AC2 (partial)
- [X] T049 [US3] 在 `ui/provider-status.ts` 及其 `tests/contract/ui-messages.test.ts` 契约中优先按 `category: protocol` 将连接测试失败说明为服务返回格式不兼容并建议检查模型输出能力，保留真实 HTTP/configuration 的 Endpoint 指引，确保翻译期 `Provider response was incompatible` 与连接测试语义一致 per FR-013 / SC-004 (contradicts)

## Phase 8: Convergence

- [X] T050 [US2] 先补充 Ollama 连接测试、每次 wire、格式降级均关闭 thinking 及无关能力错误不重放的失败契约，再在 `src/providers/ollama.ts` 显式发送 `think: false` 并收紧格式能力拒绝判定，保留共同任务语义；使用可遵循结构化翻译契约的本地模型，确认需翻译条目不回显、同语言条目逐字符原样且 50 cue 与三组语言矩阵在 600 秒内通过；不得增加源语言字段、本地语义检测、网络目的地或额外重试，完成后重跑聚焦测试、全量测试/编译/打包及经授权的本地 Ollama live 验收 per FR-008 / FR-009 / SC-003 (partial)

## Phase 9: Convergence

- [ ] T051 CRITICAL：[US2] 以不包含真实字幕、译文、endpoint 或原始响应的合成 fixture，将本轮本地 Ollama 验收观察到的需翻译条目原文回显、`text` 混入 `context_previous`/`context_next` 或 JSON 字段、`text` 混入 thinking 标记或外围说明三类失败形状固化为 `tests/contract/ollama.test.ts` 的先失败回归，并使默认关闭的 `tests/integration/live-providers.test.ts` 对每个获授权模型分别报告非敏感计数；T040 必须保持未验收，直至 T052 后以最终包复测通过 per Constitution I / T050 (contradicts)
- [ ] T052 [US2] 在不新增源语言字段、本地语言检测、语义审核、网络目的地或重试的前提下，收敛 `src/providers/translation-task.ts` 与 `src/providers/ollama.ts` 的 Ollama 指令、目标封装及合法输出门禁，使 `gemma3:latest`、`qwen3:14b` 与 `translategemma:12b` 的简体中文目标验收不会把非目标原文、相邻上下文、JSON 字段或 thinking 片段作为译文提交；保留同语言逐字符原样、每次 wire 最多两项、`think: false` 和一次格式降级，随后重跑 023 聚焦测试及 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`，并用最终 `.iinaplgz` 完成 T040 与三个模型矩阵 per FR-008 / FR-009 / FR-011 / SC-003 (partial)
