# 任务：添加 DeepSeek 翻译服务

**输入**：`specs/019-add-deepseek-provider/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格 FR-016 明确要求自动化覆盖，因此各用户故事先补充会失败的生产行为测试，再实施对应代码。不得用只解析 README、`docs/`、`specs/` 或 `.specify/` 文案的测试替代生产验证。

**组织方式**：任务按用户故事划分；`[P]` 仅表示在依赖完成后可修改不同文件并行执行。并行 Agent 必须使用隔离 worktree，共享集成文件按本文依赖顺序合并。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：不依赖未完成的同级工作，且不修改相同文件
- **[Story]**：对应 `spec.md` 中的用户故事
- 每项任务均给出具体文件路径

## 阶段 1：准备

**目的**：确认 OpenAI、Ollama、Profile、模型目录、Sidebar 与安全边界的现有基线。

- [ ] T001 按 `specs/019-add-deepseek-provider/quickstart.md` 的聚焦范围运行当前已存在的 OpenAI、Ollama、Profile、模型目录、Sidebar、集成与安全测试并记录基线失败，不运行尚未创建的 DeepSeek 测试或真实联网测试

---

## 阶段 2：基础能力

**目的**：建立三个用户故事共用的 DeepSeek 测试夹具、严格 kind 联合类型、消息契约和 Profile 身份。

**关键要求**：本阶段完成前不得进入用户故事实现。

- [ ] T002 [P] 扩展可控 Provider 测试服务以支持 DeepSeek `/models`、`/chat/completions`、Bearer 校验、请求体捕获、延迟及空或畸形响应，修改 `tests/helpers/provider-server.ts` 并新增 `tests/fixtures/providers/deepseek-success.json`
- [ ] T003 [P] 为 `deepseek` kind 的消息解析、安全 Profile view、未知字段拒绝与敏感字段拒绝编写失败优先的契约测试，修改 `tests/contract/ui-messages.test.ts`、`tests/contract/global-rpc.test.ts` 与 `tests/contract/provider-profiles.test.ts`
- [ ] T004 扩展 Provider/Profile/模型消息与安全连接视图的严格联合类型为 `openai | deepseek | ollama`，并保持 `fake` 只用于测试，修改 `src/providers/types.ts`、`src/domain/types.ts` 与 `src/domain/messages.ts` 使 T003 的消息断言通过
- [ ] T005 让 Profile 保存、Endpoint 规范化、fingerprint 与安全 snapshot 接受独立 `deepseek` 身份且不迁移或改写既有 OpenAI/Ollama 数据，修改 `src/providers/profiles.ts` 使 T003 的 Profile 断言通过

**检查点**：跨运行时 payload 只接受三种产品 kind；API Key、Authorization、字幕、译文和原始响应仍无法进入安全 Profile view。

---

## 阶段 3：用户故事 1——配置并使用 DeepSeek Profile（优先级：P1）🎯 MVP

**目标**：用户可创建独立 DeepSeek Profile，刷新或自定义模型，完成 Save、Test、Select、字幕翻译、Update 与 Delete，且不改变其他 Profile。

**独立测试**：从新建 Profile 选择 DeepSeek，确认顺序和默认值，使用 fake transport 完成 Refresh、Save、fresh Test、Select 与有效字幕翻译，再编辑和删除；所有操作只作用于当前 DeepSeek revision，OpenAI/Ollama 回归保持通过。

### 测试

- [ ] T006 [P] [US1] 为 DeepSeek fresh Test、有效单项和双项 wire、分批 progress、取消及无 capability probe 的成功路径编写失败优先的 Provider 契约测试，新增 `tests/contract/deepseek.test.ts`
- [ ] T007 [P] [US1] 为 Service type 顺序、DeepSeek 默认名称与 Root、空 Custom Model ID、metadata 恢复、独立草稿、Save/Test/Select/Update/Delete 和 revision 失效编写失败优先的 UI/Profile 契约测试，修改 `tests/contract/sidebar-form.test.ts`、`tests/contract/sidebar-lifecycle.test.ts`、`tests/contract/provider-profiles.test.ts` 与 `tests/contract/global-rpc.test.ts`
- [ ] T008 [P] [US1] 为 DeepSeek Profile 从模型刷新到字幕提交的完整 happy path、Test 不自动 Select、编辑后重选及删除不影响其他 Profile 编写失败优先的集成回归，修改 `tests/integration/provider-connection-lifecycle.test.ts` 与 `tests/integration/us3-providers.test.ts`

### 实现

- [ ] T009 [P] [US1] 从 `src/providers/openai.ts` 提取可复用的 Chat Completions 分批、取消、usage 与 progress 内核，并新增公开 `DeepSeekProvider` 的 fresh Test 和有效响应成功路径到 `src/providers/deepseek.ts`，保持 OpenAI capability probe 与 fallback 行为不变
- [ ] T010 [P] [US1] 让 DeepSeek 模型成功路径请求规范化 `{API Root}/models`、读取 `data[].id`、trim、精确去重并保留顺序，修改 `src/providers/model-discovery.ts`
- [ ] T011 [P] [US1] 在固定 OpenAI、DeepSeek、Ollama 顺序下实现 DeepSeek 默认值、独立非敏感草稿、穷举文案、模型控件及 Profile 操作，修改 `ui/sidebar.html`、`ui/sidebar-state.ts`、`ui/provider-status.ts` 与 `ui/sidebar.ts`
- [ ] T012 [P] [US1] 让 Main 从当前安全 Profile view 解析并保存所选 kind，将其传入 Controller 的选择上下文供服务专属本地行为使用，修改 `src/main.ts` 与 `src/app/controller.ts`
- [ ] T013 [US1] 在 Global 恢复和持久化 DeepSeek metadata、构造 `DeepSeekProvider`、复用只写 API Key、provider cache、Test、Broker、选择、revision 与删除流程，修改 `src/global.ts` 并保持 OpenAI/Ollama 分支不变
- [ ] T014 [US1] 运行 US1 聚焦测试并核对 Refresh、Save 与 Test 均不自动 Select、只有当前明确选择的 DeepSeek revision 能提交字幕，验证 `tests/contract/deepseek.test.ts`、`tests/contract/sidebar-form.test.ts`、`tests/contract/sidebar-lifecycle.test.ts`、`tests/integration/provider-connection-lifecycle.test.ts` 与 `tests/integration/us3-providers.test.ts`

**检查点**：US1 可独立演示完整 DeepSeek Profile 主流程；这是可演示 MVP，但尚未完成 US2 的全部协议拒绝与 US3 的竞态安全验收，不可作为生产交付终点。

---

## 阶段 4：用户故事 2——获得符合 DeepSeek 契约的结构化译文（优先级：P1）

**目标**：DeepSeek 首个 Test 与翻译请求即固定使用 JSON object、关闭 thinking、保持 temperature 0，并只在完整对象与精确 ID 集合全部有效时提交当前 wire。

**独立测试**：捕获 DeepSeek Test 与多 ID 翻译请求，确认不存在 JSON Schema、probe、fallback 或本地会话 header；分别返回有效、空、截断、畸形、额外、缺失、重复 ID 与空译文，只有有效 wire 产生完整提交。

### 测试

- [ ] T015 [P] [US2] 为 `response_format: {type: "json_object"}`、`thinking: {type: "disabled"}`、`temperature: 0`、JSON 指令、无 Schema/probe/fallback/`X-Session-Id` 及每次 fresh Test 编写失败优先的请求契约，修改 `tests/contract/deepseek.test.ts`
- [ ] T016 [P] [US2] 为完整对象、顶层和条目精确字段、数量、目标集合、唯一 ID 与非空译文的全量接受和零部分接受编写失败优先的验证测试，修改 `tests/contract/provider-output.test.ts`
- [ ] T017 [P] [US2] 为 401/403、402、429、400/422、500/503、refusal、length、空内容、timeout、network 与 cancel 的 allowlist 分类及上游正文/code/header 清洗编写失败优先的安全测试，修改 `tests/security/redaction.test.ts` 与 `tests/security/credential-leakage.test.ts`
- [ ] T018 [P] [US2] 为前序成功 wire 保持渐进提交、失败 wire 零提交、播放和原字幕不阻塞及 DeepSeek 内容不进入 Log Viewer 编写失败优先的集成回归，修改 `tests/integration/progressive-translation.test.ts` 与 `tests/integration/us1-playback.test.ts`

### 实现

- [ ] T019 [US2] 新增不改变 OpenAI/Ollama 宽松语义的 DeepSeek 严格验证入口，对顶层、条目、数量、精确 ID 集合、唯一性和非空文本执行 all-or-nothing 校验，修改 `src/providers/validation.ts`
- [ ] T020 [US2] 固定 DeepSeek 请求体、JSON 目标提示、fresh Test、完整外层/content/finish reason 解析、受限 usage/request ID 与安全本地错误 code，修改 `src/providers/deepseek.ts`、`src/providers/translation-task.ts` 与 `src/providers/errors.ts` 使 T015-T017 通过
- [ ] T021 [US2] 将严格 wire 结果接入现有分批 progress、取消和会话所有权，确保失败 wire 不调用 progress 或 cache 且 DeepSeek 选择禁用字幕对照日志，修改 `src/providers/deepseek.ts` 与 `src/app/controller.ts` 使 T018 通过
- [ ] T022 [US2] 运行 US2 聚焦测试及现有 OpenAI/Ollama Provider 回归，确认 OpenAI capability probe 与 Ollama schema/prompt fallback 未改变，验证 `tests/contract/deepseek.test.ts`、`tests/contract/provider-output.test.ts`、`tests/contract/openai.test.ts`、`tests/contract/ollama.test.ts`、`tests/integration/progressive-translation.test.ts` 与 `tests/security/redaction.test.ts`

**检查点**：每个 DeepSeek wire 只有“全部有效并提交”或“全部拒绝”两种结果，固定请求方言从首个请求起生效，失败不暴露服务原文且不阻塞播放。

---

## 阶段 5：用户故事 3——安全刷新 DeepSeek 模型并保持服务隔离（优先级：P2）

**目标**：模型刷新、草稿 Key、已保存凭据、kind 转换和乱序结果始终归属于精确服务/Profile/revision/窗口上下文，失败保留目录和自定义 Model ID。

**独立测试**：用正确、缺失和错误 Key 刷新 DeepSeek 模型，再交错 kind、Endpoint、route、Profile/revision、credential epoch、draft credential epoch 与窗口；确认 latest-only 结果、失败保留、旧 Key 不跨 kind 继承、迟到反馈不覆盖当前状态且无敏感数据泄漏。

### 测试

- [ ] T023 [P] [US3] 为 DeepSeek `/models` 可选 Bearer、全部有效 ID、成功空目录、畸形响应、安全错误及自定义 Model ID 保留编写失败优先的契约测试，修改 `tests/contract/provider-model-discovery.test.ts`
- [ ] T024 [P] [US3] 为 kind 转换原子清理旧 Key、清理失败保留旧 revision、替换/删除递增 credential epoch、取消 owner 并清理全部 revision cache/目录编写失败优先的契约测试，修改 `tests/contract/provider-profiles.test.ts`、`tests/contract/global-rpc.test.ts` 与 `tests/unit/provider-cache.test.ts`
- [ ] T025 [P] [US3] 为三种独立草稿、切换清空未保存 Key、模型/凭据反馈 owner、失败保留与乱序 busy 状态编写失败优先的 Sidebar 回归，修改 `tests/unit/sidebar-state.test.ts`、`tests/contract/sidebar-form.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [ ] T026 [P] [US3] 为 kind/Endpoint/route/Profile/revision/Key/窗口交错、迟到模型/Test/译文拒绝及三种服务互不覆盖编写失败优先的集成回归，修改 `tests/integration/provider-connection-lifecycle.test.ts` 与 `tests/integration/us3-providers.test.ts`
- [ ] T027 [P] [US3] 为草稿和已保存 DeepSeek Key、Authorization、字幕、译文、完整响应不进入 preferences、消息、目录、日志、诊断、进程参数或包编写失败优先的安全回归，修改 `tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts`

### 实现

- [ ] T028 [P] [US3] 完成 DeepSeek 模型目录的成功空数组、失败保留、安全错误与 `/models` 路径分支，同时保持 OpenAI/Ollama 解析不变，修改 `src/providers/model-discovery.ts`
- [ ] T029 [US3] 在 kind 变化时先清理旧凭据和 owner 再发布新 revision，并在凭据替换或删除后递增代次、取消模型/Test/翻译、清理 Provider cache 与目录且核对最新 owner，修改 `src/providers/profiles.ts`、`src/providers/provider-cache.ts` 与 `src/global.ts`
- [ ] T030 [P] [US3] 将 Sidebar 的 DeepSeek 草稿、draft credential epoch、模型 context、凭据保存结果和操作反馈绑定完整当前编辑上下文，拒绝迟到结果且失败保留 Model ID、目录和 Custom 能力，修改 `ui/sidebar-state.ts`、`ui/sidebar.ts`、`ui/provider-status.ts` 与 `src/adapters/iina/model-catalog-sync.ts`
- [ ] T031 [US3] 运行 US3 聚焦契约、状态、集成与安全测试，使用 sentinel 确认禁止位置命中数为零并确认 OpenAI/Ollama 全流程无回归，验证 `tests/contract/provider-model-discovery.test.ts`、`tests/unit/provider-cache.test.ts`、`tests/unit/sidebar-state.test.ts`、`tests/integration/provider-connection-lifecycle.test.ts`、`tests/integration/us3-providers.test.ts` 与 `tests/security/credential-leakage.test.ts`

**检查点**：DeepSeek 目录和凭据只属于完整当前 owner；任何服务切换、revision、Key、窗口或请求时序变化都能使旧结果失效，失败不会改变翻译授权。

---

## 阶段 6：收尾与跨故事质量门

**目的**：完成网络披露、当前用户文档、可选真实服务验证、完整测试、正式构建、最小安装包与 IINA 宿主验收。

- [ ] T032 [P] 为 DeepSeek 默认网络目的地披露、权限与 `allowedDomains: ["127.0.0.1"]` 不变及包内无凭据或 DeepSeek 运行数据补充生产接口回归，修改 `tests/contract/package-manifest.test.ts`
- [ ] T033 [P] 新增显式 opt-in 的 DeepSeek live test，覆盖 fresh Test、至少 40 个目标和 20 个双项 wire，并确保输出只含计数与安全分类，修改 `tests/integration/live-providers.test.ts`
- [ ] T034 更新支持服务、DeepSeek 默认 Root、模型刷新/Custom ID、只写 Key、Select 授权、费用与排错说明，并披露 Select 前无字幕模型请求且不扩大权限，修改 `Info.json` 与 `README.md` 使 T032 通过
- [ ] T035 [P] 同步 DeepSeek 配置、安全、费用和排错说明到当前本地化与开发文档，修改 `docs/readme/README.zh-CN.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.ru.md`、`docs/readme/README.ar.md` 与 `docs/engineering/development.md`
- [ ] T036 按 `specs/019-add-deepseek-provider/quickstart.md` 运行全部聚焦 Vitest、`npm run test:native`、`npm run typecheck`、`npm run lint` 与 `npm run format:check`，修复所有失败后再继续
- [ ] T037 严格依次运行 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package` 与 `npm run pack`，并按 `specs/019-add-deepseek-provider/quickstart.md` 审计同一候选包的架构、签名、权限、白名单和敏感材料
- [ ] T038 仅在用户明确批准真实联网与可能费用后，按 `specs/019-add-deepseek-provider/quickstart.md` 运行 `tests/integration/live-providers.test.ts` 的 DeepSeek opt-in 场景；未获授权、Key/余额不可用或公网不稳定时保持未验收而不得标记通过
- [ ] T039 由开发者一人使用 T037 的同一正式 `.iinaplgz` 完成 `specs/019-add-deepseek-provider/quickstart.md` 的 IINA 1.4.4 九项人工验收，仅在实际通过后将包 SHA-256、环境、非敏感场景 ID、耗时和结果记录到 `docs/validation/iina-matrix.md`

---

## 依赖与执行顺序

### 阶段依赖

- **阶段 1（准备）**：无依赖。
- **阶段 2（基础能力）**：依赖阶段 1；阻塞全部用户故事。
- **US1（阶段 3）**：依赖阶段 2；提供首个可演示 DeepSeek Profile 主流程。
- **US2（阶段 4）**：依赖 US1 的 DeepSeek Provider 与选择流程；完成固定方言和严格 wire 校验。
- **US3（阶段 5）**：依赖 US1 的 Profile、模型控件和发现成功路径；行为上不依赖 US2，但共享 `src/global.ts`、`ui/sidebar.ts` 与测试热点默认按 US2 后合并。
- **阶段 6（收尾）**：依赖 US2 与 US3；T036、T037 串行，T038 需要额外的真实联网与费用授权，T039 依赖 T037 的同一正式包。

### 用户故事完成顺序

```text
准备 → 基础能力 → US1 ─┬→ US2 ─┬→ 收尾
                       └→ US3 ─┘
```

- **US1**：无其他故事依赖，交付 DeepSeek Profile 的可演示 happy path。
- **US2**：依赖 US1，独立证明固定请求方言、严格响应与播放非阻塞。
- **US3**：依赖 US1，独立证明模型目录、凭据和竞态隔离；可与 US2 在隔离 worktree 并行，但共享热点按明确顺序合并。

### 故事内顺序

- 每个故事先完成其“测试”小节并确认新增测试因缺失行为而失败，再修改生产实现。
- Provider/验证与状态模型先于 Global/Main 协调，协调先于 Sidebar 反馈和聚焦验收。
- 共享热点文件 `src/global.ts`、`src/app/controller.ts`、`src/main.ts`、`ui/sidebar.ts`、`ui/sidebar-state.ts` 与相关集成测试同一时间只设一个负责人。
- 每次完成代码变更后都重新执行与该变更相关的测试、TypeScript 编译、正式构建和打包；不得沿用变更前结果。

## 并行执行示例

### US1

阶段 2 完成后，T006、T007、T008 可在隔离 worktree 分别准备 Provider、Sidebar/Profile 与端到端生命周期测试；测试失败得到确认后，T009、T010、T011、T012 修改不同生产切片，可并行完成，再由 T013 串行接入 Global。

### US2

T015、T016、T017、T018 分别修改 Provider 契约、验证、安全和播放集成测试，可在隔离 worktree 并行；实现按 T019 → T020 → T021 串行收敛严格输出和 progress 语义。

### US3

T023、T024、T025、T026、T027 可分别准备模型、凭据、Sidebar、集成和安全测试；T028 与 T030 不修改相同生产文件，可在相关测试失败后并行，T029 由共享 Global/Profile 负责人串行合并。

## 实施策略

### MVP 优先

1. 完成阶段 1 与阶段 2。
2. 完成 US1，并运行 T014 的独立验收。
3. 在该检查点演示 Refresh、Save、fresh Test、Select、字幕翻译、Update 与 Delete。

US1 是最小可演示范围；生产交付必须继续完成同为 P1 的 US2，并完成 US3、跨故事门禁和正式包验收。

### 增量交付

1. **基础能力 + US1**：交付独立 DeepSeek Profile 主流程。
2. **加入 US2**：交付首请求即正确的 DeepSeek 方言和严格结构化输出。
3. **加入 US3**：交付模型、凭据、kind 转换和乱序结果隔离。
4. **收尾**：完成当前文档、全量门禁、候选包审计及单人 IINA 验收。

## 备注

- 生产 TypeScript、HTML 与 CSS 变更不得新增代码注释，自然语言默认使用英语。
- 产品不得预置、推荐或猜测 DeepSeek Model ID，不新增 thinking UI、Provider capability 持久化、native RPC、依赖或权限。
- 真实 DeepSeek 测试必须显式授权且不得在命令、日志或证据中输出 Endpoint、Key、Authorization、字幕、译文或原始响应。
- 本流程不 commit、tag、上传或发布；进入实施前仍需用户明确授权。
