---

description: "添加 Claude 翻译服务的可执行任务清单"
---

# 任务：添加 Claude 翻译服务

**输入**：`specs/020-add-claude-provider/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：`FR-018` 明确要求自动化覆盖，因此各用户故事先补测试，再实现生产行为。

**组织方式**：任务按用户故事分组。US2 提供 Messages 安全契约，US1 在其上交付完整 Profile 流程，US3 再验证并收紧模型刷新隔离。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：与同阶段未完成任务不修改相同文件，且不依赖其结果；并行执行时仍须使用隔离 worktree 或等效工作区。
- **[Story]**：`[US1]`、`[US2]`、`[US3]` 对应 `spec.md` 中的用户故事。
- 每项任务均给出需要修改、创建或据以执行验证的精确路径。

## Phase 1：准备

**目的**：建立后续契约、集成和 live test 共用的 Claude 响应样本。

- [X] T001 创建仅含安全虚构数据的成功 Messages 响应 fixture，覆盖多个按序 text block、`end_turn` 与合法 usage，保存到 `tests/fixtures/providers/claude-success.json`

**检查点**：Claude 测试可复用固定响应，且 fixture 不含真实 Endpoint、Key、字幕或译文。

---

## Phase 2：基础前置工作

**目的**：先完成三个用户故事共用的 kind、消息、批次与错误边界。

**关键要求**：本阶段完成前不得开始用户故事的生产实现。

- [X] T002 将协议无关的二项目标编排从 `src/providers/chat-completions.ts` 改名为 `src/providers/translation-batches.ts`，同步更新 `src/providers/openai.ts` 与 `src/providers/deepseek.ts` 的导入和符号名，并移除旧入口
- [X] T003 [P] 在 `src/providers/types.ts`、`src/providers/profiles.ts` 与 `src/domain/types.ts` 的严格联合类型和 Profile metadata 中加入 `claude`，保持既有 kind 与 OpenAI capability 语义不变
- [X] T004 在 `src/domain/messages.ts` 的模型请求、Profile 安全视图和跨运行时严格解析器中接受 `kind: "claude"`，继续拒绝未知 kind、额外敏感字段与非法 owner 组合
- [X] T005 [P] 在 `src/app/retry-policy.ts` 与 `src/providers/errors.ts` 增加 Claude 所需的 504/529、配额与安全 allowlist 分类，禁止传播上游 message、body、header 或未知 code

**检查点**：共享类型、批次与错误基线可供三个故事使用，OpenAI、DeepSeek、Ollama 的现有契约未改变。

---

## Phase 3：用户故事 2——符合 Claude Messages 契约的结构化译文（优先级：P1）🎯 MVP 前置

**目标**：实现非流式 Claude Messages 请求、严格提示、结束状态与拒绝判断，并只提交完整精确的 ID 译文集合。

**独立测试**：直接用 fake transport 驱动 `ClaudeProvider` 的 Test 和多目标翻译，断言请求 URL、header、顶层 system、user message、`max_tokens: 8192` 与禁止字段；再逐一返回拒绝、非 `end_turn`、空/非文本、包装 JSON、畸形 JSON、额外/缺失/重复 ID 和空译文，确认当前 wire 零提交且错误安全。

### 用户故事 2 测试

- [X] T006 [P] [US2] 创建 Claude Provider 契约测试，覆盖 URL、请求头、请求体、Test、text block 拼接、结束状态、拒绝、严格 ID、usage、取消与安全错误映射，保存到 `tests/contract/claude.test.ts`
- [X] T007 [P] [US2] 扩展严格输出回归，证明包装文本、额外字段、额外/缺失/重复 ID 与空译文均不得部分提交，修改 `tests/contract/provider-output.test.ts`
- [X] T008 [P] [US2] 增加 504、529、普通 429 与 spend-limit 分类和重试边界测试，修改 `tests/unit/retry.test.ts`
- [X] T009 [P] [US2] 增加 Claude error/refusal/raw response 与字幕正文清洗测试，修改 `tests/security/redaction.test.ts`
- [X] T010 [P] [US2] 增加显式 opt-in 的 Claude-compatible fresh Test、40 targets/20 wires 与禁止字段断言，修改 `tests/integration/live-providers.test.ts`

### 用户故事 2 实现

- [X] T011 [P] [US2] 实现 Claude API Root 的 `/v1/messages`、`/v1/models` 规范化构造，以及认证/版本 header 和安全 HTTP 错误映射，创建 `src/providers/claude-api.ts`
- [X] T012 [P] [US2] 在 `src/providers/translation-task.ts` 增加 Claude 专用严格 system 指令，要求单一 `translations` JSON、精确 wire ID、不可信 user 数据与仅翻译 `text`，且不依赖 Schema
- [X] T013 [US2] 实现 `ClaudeProvider` 的真实 Test、非流式 Messages 请求、按序 text block 候选、拒绝优先、精确 `end_turn`、严格 ID 校验、usage、进度与取消，创建 `src/providers/claude.ts`
- [X] T014 [US2] 在 `src/app/controller.ts` 接受 Claude 选择身份并禁止 Claude 字幕、上下文与译文进入 Log Viewer，同时保留会话 owner、非阻塞播放与既有 Provider 日志行为

**检查点**：US2 可通过直接 Provider 契约独立验收；任一无效 wire 零提交，合法前序 progress 不回滚。

---

## Phase 4：用户故事 1——配置并使用 Claude Profile（优先级：P1）🎯 MVP

**目标**：交付 Claude Profile 的创建、模型刷新或 Custom ID、保存、真实 Test、Select、翻译、编辑和删除全流程。

**独立测试**：从 New Profile 选择 Claude，确认固定顺序、默认名称/Root、空 Model ID、system route 与必填 Key；刷新模型或填写 Custom ID 后完成 Save、fresh Test、Select、翻译、Update 和 Delete，并确认 revision、选择失效、凭据清理与其他 Provider 隔离。

### 用户故事 1 测试

- [X] T015 [P] [US1] 增加 Claude Profile 保存、Root 规范化、revision、kind 转换、选择失效、删除和既有 metadata 恢复测试，修改 `tests/contract/provider-profiles.test.ts`
- [X] T016 [P] [US1] 增加 Claude Key 单向写入、替换、保留、删除与 `0600` 存储回归，修改 `tests/contract/credential-store.test.ts`
- [X] T017 [P] [US1] 增加 Claude fresh Messages Test、取消和 Test 不自动 Select 的生命周期测试，修改 `tests/contract/provider-connection-tests.test.ts`
- [X] T018 [P] [US1] 增加 Global 对 Claude Profile、凭据、Test、Select、翻译、编辑与删除的严格 RPC 测试，修改 `tests/contract/global-rpc.test.ts`
- [X] T019 [P] [US1] 增加 Main↔Global↔Sidebar 对 `kind: "claude"` 的允许字段、未知字段拒绝和发送方身份隔离测试，修改 `tests/contract/ui-messages.test.ts`
- [X] T020 [P] [US1] 增加 Service type 顺序、Claude 默认值、Messages URL hint、空 Model ID、Custom 模式与必填 Key 表单测试，修改 `tests/contract/sidebar-form.test.ts`
- [X] T021 [P] [US1] 增加 Claude 两阶段保存、权威列表先到时的 revision owner、部分失败、fresh Test、Select、Update、Delete、类型草稿隔离与迟到操作反馈测试，修改 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T022 [P] [US1] 增加系统名称 ownership、Claude 草稿、模型控件、保存期间编辑 revision 协调、保存 owner 与可访问状态的单元测试，修改 `tests/unit/sidebar-state.test.ts`
- [X] T023 [P] [US1] 增加 Claude credential epoch 导致 Provider cache 失效且不影响其他 Profile 的测试，修改 `tests/unit/provider-cache.test.ts`
- [X] T024 [P] [US1] 增加 Claude Save→fresh Test→Select→翻译→Update/Delete 的跨运行时集成测试，修改 `tests/integration/provider-connection-lifecycle.test.ts`
- [X] T025 [P] [US1] 增加四种 Provider 共存、精确 revision 选择和当前窗口 Claude 翻译的集成回归，修改 `tests/integration/us3-providers.test.ts`
- [X] T026 [P] [US1] 增加 Claude Key、认证 header、原始 Messages 数据不进入安全视图、preferences、日志、诊断和进程参数的测试，修改 `tests/security/credential-leakage.test.ts`
- [X] T027 [P] [US1] 增加 Claude Models URL、必填 headers、Anthropic 分页与 Ollama-compatible 单页目录、精确去重、Custom ID 与目录失败保留行为的基础契约测试，修改 `tests/contract/provider-model-discovery.test.ts`

### 用户故事 1 实现

- [X] T028 [US1] 在 `src/providers/model-discovery.ts` 接入 Claude `/v1/models` 的 Anthropic 游标分页与 Ollama-compatible `object: "list"` 单页终态、逐页 headers、ID 清洗去重、原子终态和可注入 `assertActive` guard，不请求其他目录或执行能力探测
- [X] T029 [US1] 在 `src/global.ts` 恢复和持久化 Claude metadata、构造 `ClaudeProvider`、强制保存 Key、维护 credential epoch/cache/选择/lease，并完成模型刷新、Test、Select、翻译、编辑和删除的安全生命周期
- [X] T030 [P] [US1] 在 `src/main.ts` 接受并转发 Claude Profile、模型、Test、选择与翻译消息，继续以 IINA Global 发送方 ID 授权并以 Main 生命周期 ID 校验最终提交
- [X] T031 [P] [US1] 在 `ui/sidebar-state.ts` 建立 Claude 系统名称、Profile 保存 owner、credential pending 与模型控件状态，保留既有可访问反馈和 latest-only 规则
- [X] T032 [US1] 在 `ui/sidebar.html` 与 `ui/sidebar.ts` 加入位于 OpenAI 之后的 Claude 选项、默认 Root、独立草稿、Messages URL/hints、必填 Key、两阶段保存和完整 Profile 操作
- [X] T033 [P] [US1] 在 `ui/provider-status.ts` 增加 Claude API Root、`/v1/messages`、版本、Model ID、认证、配额和拒绝的固定安全反馈，不显示上游正文

**检查点**：US2 + US1 构成可交付 MVP；单名开发者可通过 Custom ID 或有效目录完成 Claude 首次翻译，不改变其他 Provider。

---

## Phase 5：用户故事 3——安全刷新 Claude 模型并保持服务隔离（优先级：P2）

**目标**：证明并收紧分页 owner、preview Key、目录原子提交、Custom ID 保留和 Service/Profile/窗口竞态隔离。

**独立测试**：分别用正确、缺失和错误 Key 刷新；覆盖多页、空/重复 cursor、后页失败、不支持目录，以及 Endpoint、route、Service type、Profile、revision、Key、窗口和请求时序变化，确认旧请求不继续下一页、不覆盖当前目录或反馈，任何 Key 均不泄漏。

### 用户故事 3 测试

- [X] T034 [P] [US3] 增加 Claude 多页 `last_id/after_id`、空页/空 cursor/重复 cursor、后页失败、逐页 guard 与零部分提交测试，修改 `tests/contract/provider-model-discovery.test.ts`
- [X] T035 [P] [US3] 增加 kind、Endpoint、route、Profile/revision、credential epoch 与 requestId 变化后的 latest-only 目录提交测试，修改 `tests/unit/model-catalog-sync.test.ts`
- [X] T036 [P] [US3] 增加保存态、preview 和 startup 刷新的 Key 要求、逐页 owner、取消与安全结果测试，修改 `tests/contract/global-rpc.test.ts`
- [X] T037 [P] [US3] 增加 Claude 不自动发送未保存 Key、手动 preview、busy 状态、Custom ID/成功目录保留及迟到反馈拒绝测试，修改 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T038 [P] [US3] 增加目录成功/失败时 Custom ID、上次成功目录与分 Service type context 的状态测试，修改 `tests/unit/sidebar-state.test.ts`
- [X] T039 [P] [US3] 增加 preview Key、cursor、Endpoint 和 Provider 原始模型响应不进入结果、日志、preferences 或诊断的测试，修改 `tests/security/credential-leakage.test.ts`

### 用户故事 3 实现

- [X] T040 [P] [US3] 在 `src/global.ts` 将保存态、preview 与 startup 的完整非敏感 owner 传入逐页 guard，在每页发送前和响应后复核并取消 superseded helper job，失败时保留既有目录
- [X] T041 [P] [US3] 在 `src/adapters/iina/model-catalog-sync.ts` 与 `src/main.ts` 以完整 context token 隔离目录 cache、owner 和迟到结果，确保 manual/credential 请求可替代旧请求
- [X] T042 [P] [US3] 在 `ui/sidebar-state.ts` 实现按 context 保存目录、失败保留 Custom ID/上次成功目录及 latest-only refresh 状态，不让旧目录改变当前控件模式
- [X] T043 [US3] 在 `ui/sidebar.ts` 实现 Claude 自动刷新 Key 门禁、一次性 preview Key、draft credential epoch、类型/Endpoint/route/Profile 切换失效与安全模型反馈

**检查点**：US3 可独立制造所有目录失败和竞态；旧 Key 不再发下一页，旧结果不覆盖当前上下文，目录失败不影响选择和翻译授权。

---

## Phase 6：收尾与跨故事验收

**目的**：完成既有 Provider 回归、用户披露、正式构建、包审计及需授权的真实环境验收。

- [X] T044 [P] 扩展 manifest 与正式包契约测试，确认默认 Claude 网络目的地披露更新且 `permissions`、`allowedDomains` 和 native 文件集合不扩大，修改 `tests/contract/package-manifest.test.ts`
- [X] T045 [P] 更新共享批次改名后的 OpenAI、DeepSeek、Ollama 契约回归并证明其请求、模型和能力行为不变，修改 `tests/contract/openai.test.ts`、`tests/contract/deepseek.test.ts` 与 `tests/contract/ollama.test.ts`
- [X] T046 [P] 增加 Claude 失败不阻塞播放、progress owner、会话清理与成本/隐私边界回归，修改 `tests/integration/us1-playback.test.ts`、`tests/integration/progressive-translation.test.ts` 与 `tests/integration/us2-cost-privacy.test.ts`
- [X] T047 更新默认 Claude Root、Select 前模型请求与 Select 后最小字幕外发披露，保持权限白名单不变，修改 `Info.json`
- [X] T048 [P] 更新 Claude 配置、Key/费用风险、compatible Endpoint、Custom Model ID、Save→Test→Select 与排错说明，修改 `README.md` 与 `docs/readme/README.zh-CN.md`
- [X] T049 [P] 同步 Claude 用户说明且保持各语言现有结构，修改 `docs/readme/README.fr.md` 与 `docs/readme/README.ja.md`
- [X] T050 [P] 同步 Claude 用户说明且保持各语言现有结构，修改 `docs/readme/README.ko.md`、`docs/readme/README.ru.md` 与 `docs/readme/README.ar.md`
- [X] T051 [P] 增加 Claude 架构、安全边界、可选 live test 与排错开发说明，修改 `docs/engineering/development.md`
- [X] T052 [P] 添加未验收的 Claude-compatible 与 IINA 1.4.4 场景，不把未执行步骤标为通过，修改 `docs/validation/iina-matrix.md`
- [X] T053 按 `specs/020-add-claude-provider/quickstart.md` 运行列出的聚焦 Vitest、`npm run test:native`、`npm run typecheck`、`npm run lint` 与 `npm run format:check`，修复后从头重跑直至全部成功
- [X] T054 按 `specs/020-add-claude-provider/quickstart.md` 在最终代码上依次重新运行 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package` 与 `npm run pack`，确认全部成功且不沿用任何代码变更前结果
- [X] T055 仅在用户当次明确批准联网和可能费用后，按 `specs/020-add-claude-provider/quickstart.md` 执行 Claude-compatible live test 的 fresh Test 与至少 20 个双项目 wire；未授权或未执行时保持本任务未完成
- [X] T056 由单名开发者按 `specs/020-add-claude-provider/quickstart.md` 使用最终 `build/package/SubTandem-0.1.1.iinaplgz` 完成 IINA 1.4.4 安装、权限、Profile 全流程、竞态、多窗口、播放非阻塞、敏感数据和卸载验收，并记录非敏感包 SHA-256 与环境证据
- [X] T057 将 Claude Test 与字幕 wire 超时统一调整为适合本地 compatible Endpoint 冷启动和排队的 60 秒，增加请求超时契约并保留 live transport 安全诊断，修改 `src/providers/claude.ts`、`tests/contract/claude.test.ts` 与 `tests/integration/live-providers.test.ts`
- [X] T059 为 Overlay WebView 增加可重入的初始化握手及 ready 消息竞态回归，使已写入 Session cache 的当前译文在宿主错过页面首次 ready 时仍能显示，修改 `src/adapters/iina/webview-translation-overlay.ts`、`ui/overlay.ts`、`tests/integration/overlay-webview-lifecycle.test.ts` 与 `tests/contract/overlay-webview.test.ts`
- [X] T058 在 T057 与 T059 的最终代码上重新执行聚焦回归与 T053/T054 的完整测试、编译和打包门禁，不沿用修复前结果

**检查点**：自动化、类型检查、lint、native、正式插件构建、包审计和打包均通过；live/IINA 任务只按实际执行状态验收。

---

## 依赖与执行顺序

### 阶段依赖

- **Phase 1 → Phase 2**：fixture 准备完成后建立共享代码边界。
- **US2（Phase 3）**：依赖 Phase 2；先提供 Profile 流程必须使用的 Messages 安全契约。
- **US1（Phase 4）**：生产实现依赖 US2；测试任务 T015–T027 可在 Phase 2 后先行编写。
- **US3（Phase 5）**：生产实现依赖 US1 的模型与 UI 基线；测试任务 T034–T039 可在 Phase 2 后先行编写。
- **收尾（Phase 6）**：依赖要交付的全部用户故事完成；T055 还依赖用户明确联网/费用授权，T056 依赖 T054 生成的最终包。

### 用户故事依赖图

```text
Setup → Foundation → US2 (Messages 契约) → US1 (Profile 全流程) → US3 (模型隔离)
                                                       └──────────────→ Polish/正式验收
```

- **US2** 可通过直接 Provider 契约独立测试，无需 Sidebar。
- **US1** 复用 US2；完成后可用有效目录或 Custom ID 独立走通 Profile 全生命周期。
- **US3** 复用 US1 的目录入口，但以故障和竞态场景独立验收安全隔离。

### 故事内执行顺序

- 先完成该故事的测试任务并确认新增断言能暴露尚未实现的行为，再开始生产实现。
- US2：API URL/错误与 prompt 可并行，随后实现 Provider，最后接入 Controller 会话边界。
- US1：模型发现先于 Global；Main、Sidebar state 与状态文案可并行；`ui/sidebar.ts` 在 Sidebar state 后集成。
- US3：Global、Main/ModelCatalogSync 与 Sidebar state 的 owner 收紧可并行；最后在 `ui/sidebar.ts` 汇合。
- 同一热点文件的后续任务必须串行：T029→T040（`src/global.ts`）、T030→T041（`src/main.ts`）、T031→T042（`ui/sidebar-state.ts`）、T032→T043（`ui/sidebar.ts`）。

## 并行执行示例

### 用户故事 2

```text
并行：T006、T007、T008、T009、T010
并行：T011、T012
串行：T013 → T014
```

### 用户故事 1

```text
并行：T015–T027（各任务修改不同测试文件）
并行：T029、T030、T031、T033（前置依赖完成后）
串行：T028 → T029；T031 → T032
```

### 用户故事 3

```text
并行：T034、T035、T036、T037、T038、T039
并行：T040、T041、T042
串行：T042 → T043
```

并行任务必须遵守仓库工作协议：不同 Agent 使用隔离 worktree 或等效工作区，共享集成文件按上述顺序保持单一负责人。

## 实施策略

### MVP 优先

1. 完成 Phase 1 与 Phase 2。
2. 完成 US2，独立验收 Messages 请求和严格响应校验。
3. 完成 US1，独立验收完整 Claude Profile 流程。
4. 停止并验证 US2 + US1；这是最小安全 MVP，不能只交付缺少 Messages 契约的 US1。

### 增量交付

1. US2 + US1：交付可安全配置、Test、Select 和翻译的 Claude MVP。
2. US3：加入并验收分页、preview Key 与竞态隔离。
3. Phase 6：完成既有 Provider 回归、披露、正式构建、打包和实机验收。

## 说明

- 生产代码不得新增注释，生产自然语言使用英语；SDD 与项目文档按仓库规则使用中文或各自目标语言。
- 不新增依赖、native RPC、权限、持久化模型目录、Schema、tools、thinking 或 Provider capability 探测。
- 任一代码变更后，T053 与 T054 必须基于最终代码重新执行；只有测试、编译和打包全部成功才可视为实现完成。
- 不 commit、tag、上传或发布；正式实现仍需用户另行明确授权。
