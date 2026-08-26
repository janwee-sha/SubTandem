# 任务：服务模型发现与凭据扩展

**输入**：`specs/014-provider-model-discovery/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格 FR-020 明确要求自动化覆盖，因此各用户故事先补充会失败的生产行为测试，再实施对应代码。不得用只解析 README、`docs/`、`specs/` 或 `.specify/` 文案的测试替代生产验证。

**组织方式**：任务按用户故事划分；`[P]` 仅表示在依赖完成后可修改不同文件并行执行。并行 Agent 必须使用隔离 worktree，共享集成文件按本文依赖顺序合并。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：不依赖未完成的同级任务，且不修改相同文件
- **[Story]**：对应 `spec.md` 中的用户故事
- 每项任务均给出具体文件路径

## 阶段 1：准备

**目的**：确认现有基线并为行为变更保留可比较的验证结果。

- [X] T001 按 `specs/014-provider-model-discovery/quickstart.md` 的聚焦自动化范围运行现有可执行测试并记录任何基线失败，不读取或输出 `docs/providers` 中的凭据与服务响应

---

## 阶段 2：基础能力

**目的**：建立四个用户故事共用的测试夹具、模型目录类型和严格跨运行时消息契约。

**关键要求**：本阶段完成前不得进入用户故事实现。

- [X] T002 [P] 扩展可控 Provider 测试服务以支持 OpenAI `/models`、Ollama `/api/tags`、Bearer 校验、延迟、空与畸形响应，修改 `tests/helpers/provider-server.ts` 并补充 `tests/fixtures/providers/openai-success.json`、`tests/fixtures/providers/ollama-success.json`
- [X] T003 [P] 为 `provider:models` 请求、成功/失败响应、Profile 目录快照、未知字段拒绝和敏感字段拒绝编写失败优先的契约测试，修改 `tests/contract/ui-messages.test.ts` 与 `tests/contract/global-rpc.test.ts`
- [X] T004 定义发现上下文、模型目录、刷新结果与安全错误类型，并实现严格 envelope 解析和安全 Profile view，修改 `src/providers/types.ts` 与 `src/domain/messages.ts` 使 T003 通过
- [X] T005 将模型刷新消息加入 Sidebar、Main 与 Global 的允许消息集合且保持逐窗口 request ID 归属，修改 `src/domain/messages.ts`、`src/adapters/iina/global-rpc.ts` 与 `src/adapters/iina/sidebar-rpc.ts`

**检查点**：共享消息只允许契约字段，API Key、Authorization、字幕、译文、播放位置和原始响应无法进入刷新消息。

---

## 阶段 3：用户故事 1——从服务实际返回的模型中选择（优先级：P1）🎯 MVP

**目标**：从 OpenAI/Ollama 有效响应构造已知模型列表，并让用户在已知项与精确自定义 Model ID 之间选择，刷新目录不改写当前值。

**独立测试**：让两个 Endpoint 返回多个、重复、空白、缺失与零有效模型，确认只显示首次出现的有效精确 ID；输入列表外 Model ID 后保存、重新编辑、Test 和翻译，值保持不变。

### 测试

- [X] T006 [P] [US1] 为 OpenAI `data[].id`、忽略 `owned_by`、Ollama `model`/`name` 回退、精确去重、成功空目录和协议失败编写失败优先的生产模块契约测试，新增 `tests/contract/provider-model-discovery.test.ts`
- [X] T007 [P] [US1] 为 known/custom 模式切换、目录更新不改值、模型消失保留值、成功空目录和跨上下文隔离编写失败优先的状态测试，修改 `tests/unit/sidebar-state.test.ts`
- [X] T008 [P] [US1] 为已知、自定义和已消失 Model ID 的 Save、重新载入、Test 与翻译精确值传递编写失败优先的集成回归，修改 `tests/integration/provider-connection-lifecycle.test.ts`

### 实现

- [X] T009 [US1] 实现两种 GET 协议、10 秒超时、1 MiB 上限、空 body、可选 Bearer、安全错误分类及线性清洗，新增 `src/providers/model-discovery.ts`
- [X] T010 [US1] 实现运行期目录与 Model ID 的 known/custom 状态归类且保持 Profile `model` 为唯一权威值，修改 `ui/sidebar-state.ts`
- [X] T011 [US1] 将 Model ID 文本框替换为原生已知模型 select、固定 Custom 项、条件必填输入、刷新按钮和模型区域 live status，修改 `ui/sidebar.html` 与 `ui/sidebar.css`
- [X] T012 [US1] 连接 known/custom 控件渲染、输入和保存路径，确保目录更新不自动选择首项且保存只提交一个精确非空 Model ID，修改 `ui/sidebar.ts`
- [X] T013 [US1] 运行 US1 聚焦测试并核对模型目录请求不含 Model ID 或翻译正文，验证 `tests/contract/provider-model-discovery.test.ts`、`tests/unit/sidebar-state.test.ts` 与 `tests/integration/provider-connection-lifecycle.test.ts`

**检查点**：US1 可独立展示服务响应模型并完整保存和使用自定义 Model ID，产品预置模型数量为零。

---

## 阶段 4：用户故事 2——及时刷新当前 Endpoint 的模型（优先级：P1）

**目标**：在启动、Sidebar 真正打开、稳定有效 Endpoint 变化和手动操作时非阻塞刷新，并以完整上下文与 latest-only 规则隔离失败、迟到和多窗口结果。

**独立测试**：四类触发分别返回不同目录，交错 Endpoint、Profile、route、凭据代次和两个窗口的延迟响应，确认只有当前最新结果生效；失败保留旧目录、Model ID 与 Custom，刷新不 Select、不授权翻译、不发送字幕。

### 测试

- [X] T014 [P] [US2] 为逐窗口目录缓存、自动请求合并、手动请求取代、上下文失效、成功空目录、失败保留和迟到丢弃编写失败优先的单元测试，新增 `tests/unit/model-catalog-sync.test.ts`
- [X] T015 [P] [US2] 为启动预取、Profile 快照目录、Sidebar 可见边沿、重复 `ui:ready`、400 毫秒 Endpoint 防抖和手动刷新编写失败优先的生命周期测试，修改 `tests/contract/global-rpc.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T016 [P] [US2] 为多窗口、Profile/revision/route/Endpoint 竞态及刷新不改变选择或翻译状态编写失败优先的集成回归，修改 `tests/integration/provider-connection-lifecycle.test.ts`

### 实现

- [X] T017 [US2] 实现逐窗口模型目录快照、请求 owner、等价自动请求合并、手动优先和 latest-only 结果提交，新增 `src/adapters/iina/model-catalog-sync.ts`
- [X] T018 [US2] 实现 Global 启动非阻塞预取、完整权威上下文校验、运行期成功目录、job 取消与安全结果返回，修改 `src/global.ts`
- [X] T019 [US2] 实现 Main 的逐窗口请求转发、Profile 目录同步、Sidebar 真正打开边沿识别和仅向活动 WebView 的 `ui:poll` 投递，修改 `src/main.ts`
- [X] T020 [US2] 实现 Sidebar 的初载/切换/Profile/route 自动刷新、400 毫秒有效 Endpoint 防抖、立即手动刷新、忙碌与 latest-only 反馈，修改 `ui/sidebar.ts`、`ui/sidebar-state.ts` 与 `ui/provider-status.ts`
- [X] T021 [US2] 运行 US2 聚焦测试并确认刷新失败不覆盖目录、迟到结果不结束较新 busy、启动与打开不阻塞，验证 `tests/unit/model-catalog-sync.test.ts`、`tests/contract/sidebar-lifecycle.test.ts` 与 `tests/integration/provider-connection-lifecycle.test.ts`

**检查点**：四类刷新触发均可验证，目录不会跨 Endpoint、Profile、route、凭据上下文或窗口串用。

---

## 阶段 5：用户故事 3——使用 API Key 访问远程 Ollama（优先级：P1）

**目标**：让 Ollama Profile 复用现有可选只写 API Key 生命周期，并让模型刷新、Test 和翻译统一携带权威 Bearer，同时保持凭据隔离和纵向字段无障碍布局。

**独立测试**：对要求认证的 Ollama 分别以正确、缺失和错误 Key 执行 Refresh、Test 与翻译，再对无认证 Ollama 使用空 Key；确认安全分类、只写状态、替换/删除失效和零敏感数据泄漏，并检查两种 Profile 的 API Key 纵向布局。

### 测试

- [X] T022 [P] [US3] 为 Ollama `/api/version`、`/api/tags`、`/api/chat` 的可选统一 Bearer及 OpenAI 既有 Bearer 回归编写失败优先的契约测试，修改 `tests/contract/ollama.test.ts` 与 `tests/contract/openai.test.ts`
- [X] T023 [P] [US3] 为 Ollama 凭据保存、只返回 configured、替换/删除、全 revision Provider cache 清理和保存失败保持旧权威编写失败优先的契约测试，修改 `tests/contract/credential-store.test.ts`、`tests/contract/provider-profiles.test.ts` 与 `tests/contract/global-rpc.test.ts`
- [X] T024 [P] [US3] 为刷新消息、Profile view、preferences、日志、诊断和包的 Key/Authorization/完整 Endpoint/原始响应隔离及认证错误清洗编写失败优先的安全回归，修改 `tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts`
- [X] T025 [P] [US3] 为远程认证 Ollama 的 Refresh、Test、翻译及正确/缺失/错误/空 Key 流程编写失败优先的集成回归，修改 `tests/integration/us3-providers.test.ts` 与 `tests/integration/provider-connection-lifecycle.test.ts`

### 实现

- [X] T026 [US3] 让 Ollama Provider 接受可选 `apiKey` 并在 version、tags、chat 请求统一按非空值添加 Bearer，修改 `src/providers/ollama.ts`
- [X] T027 [US3] 让 Global 为权威 Ollama Profile 读取只写凭据，并在凭据替换/删除后递增运行期 epoch、取消发现/Test/翻译、清理全部 revision Provider cache 与旧目录，修改 `src/global.ts`、`src/providers/broker.ts` 与 `src/providers/connection-tests.ts`
- [X] T028 [US3] 让 OpenAI 与 Ollama 共用可选只写 API Key 表单，并将主标签、输入框、`aria-describedby` 提示各自纵向分行，修改 `ui/sidebar.html`、`ui/sidebar.css`、`ui/sidebar.ts` 与 `ui/sidebar-state.ts`
- [X] T029 [US3] 运行 US3 契约、集成和安全测试并确认 sentinel 在 preferences、日志、诊断、进程参数与候选包中的命中数为零，验证 `tests/contract/ollama.test.ts`、`tests/integration/us3-providers.test.ts` 与 `tests/security/credential-leakage.test.ts`

**检查点**：认证 Ollama 的三条访问路径使用同一权威 Key，无认证 Ollama 保持可用，任何可读 Profile 或反馈均不含密钥。

---

## 阶段 6：用户故事 4——以 OpenAI 名称配置兼容服务（优先级：P2）

**目标**：当前 UI 与用户文档统一显示 OpenAI，同时保留内部 `kind: "openai"`、既有 Profile 数据和任意兼容自定义 HTTP(S) API Root。

**独立测试**：检查新建、编辑、列表和反馈显示 OpenAI；载入升级前 Profile 后确认保存名称和配置不迁移，并用自定义 Endpoint 完成 Refresh、Test、Select 和翻译。

### 测试

- [X] T030 [P] [US4] 为默认可见名称、既有 displayName 不迁移、内部 kind 稳定和自定义 Endpoint 全流程编写失败优先的生产行为回归，修改 `tests/contract/provider-profiles.test.ts`、`tests/contract/sidebar-form.test.ts` 与 `tests/integration/provider-connection-lifecycle.test.ts`

### 实现

- [X] T031 [US4] 将当前 Service type、系统默认 Profile 名和操作反馈统一为 OpenAI且不改变内部 kind 或已保存 displayName，修改 `ui/sidebar.html`、`ui/sidebar-state.ts`、`ui/sidebar.ts` 与 `ui/provider-status.ts`
- [X] T032 [US4] 更新当前用户与开发文档中的 OpenAI 名称、自定义兼容 Endpoint、两种 Profile 的模型目录/自定义 Model ID 与可选只写 Key 说明，修改 `README.md`、`docs/readme/README.zh-CN.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.ru.md`、`docs/readme/README.ar.md` 与 `docs/engineering/development.md`
- [X] T033 [US4] 运行 US4 聚焦回归并人工复核当前文档不再出现用户可见 `OpenAI-compatible`，但不回写历史 release notes 或既有验收记录，验证 `tests/contract/provider-profiles.test.ts` 与 `specs/014-provider-model-discovery/quickstart.md`

**检查点**：用户只看到 OpenAI，升级前 Profile 与自定义兼容 Endpoint 的数据和行为保持不变。

---

## 阶段 7：收尾与跨故事质量门

**目的**：校验网络披露、安全边界、完整测试、正式构建、最小安装包与 IINA 宿主行为。

- [X] T034 [P] 为 manifest 网络披露、权限与 `allowedDomains` 不变、包不含运行目录和敏感材料补充生产接口回归，修改 `tests/contract/package-manifest.test.ts`
- [X] T035 更新 Select 前无字幕模型目录请求与 Select 后字幕请求的网络披露且保持权限集合不变，修改 `Info.json` 并复核 `README.md` 与 `docs/engineering/development.md`
- [X] T036 按 `specs/014-provider-model-discovery/quickstart.md` 运行全部聚焦 Vitest 与 `npm run test:native`，修复所有失败后再继续
- [X] T037 严格依次运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package` 与 `npm run pack`，并按 `specs/014-provider-model-discovery/quickstart.md` 审计候选包架构、权限、签名、白名单和敏感材料
- [X] T038 由开发者一人使用同一候选 `.iinaplgz` 完成 `specs/014-provider-model-discovery/quickstart.md` 的 IINA 1.4.4 九项人工验收，仅在实际通过后将包 SHA-256、环境和结果记录到 `docs/validation/iina-matrix.md`

---

## 阶段 8：人工反馈收敛

**目的**：修复首轮人工验收发现的 Model ID 交互、反馈所有权、凭据竞态和按钮呈现问题，再重新生成候选包供 T038 验收。

- [X] T039 [P] [US1] 为选择已知模型后仍可显式切换 Custom 且保留精确值补充失败优先的状态回归，修改 `tests/unit/sidebar-state.test.ts`
- [X] T040 [P] [US2] 为模型刷新反馈不替换 Profile 操作反馈、刷新按钮只显示可访问图标补充失败优先回归，修改 `tests/unit/sidebar-state.test.ts` 与 `tests/contract/sidebar-form.test.ts`
- [X] T041 [P] [US3] 为凭据代次变化时拒绝旧 Provider 构造结果、Ollama Test 使用新 Key 及服务专属失败提示补充失败优先回归，修改 `tests/unit/provider-cache.test.ts`、`tests/integration/us3-providers.test.ts` 与 `tests/contract/ui-messages.test.ts`
- [X] T042 [US1] [US2] 实现显式 Custom 模式、独立模型反馈和刷新图标，修改 `ui/sidebar-state.ts`、`ui/sidebar.ts`、`ui/sidebar.html` 与 `ui/sidebar.css`
- [X] T043 [US3] 将 Provider cache 绑定凭据代次并为 Ollama Test 提供服务专属安全反馈，修改 `src/providers/provider-cache.ts`、`src/global.ts`、`ui/provider-status.ts` 与 `ui/sidebar.ts`
- [X] T044 运行新增与 014 聚焦回归，再严格执行完整门禁、重新打包并将候选包交付 T038 验收

---

## 阶段 9：远程 Ollama 与保存生命周期收敛

**目的**：兼容不支持 structured outputs 的远程原生 Ollama，并修复新建带凭据 Profile 后的模型请求与列表竞态，再生成候选包供 T038 继续验收。

- [X] T045 [P] [US3] 为 Ollama Cloud 不发送 `format`/`think`、其他 Endpoint 的 JSON Schema 探测回退、单一 JSON 代码块解析及严格输出拒绝补充失败优先契约与集成回归，修改 `tests/contract/ollama.test.ts` 与 `tests/integration/us3-providers.test.ts`
- [X] T046 [P] [US2] [US3] 为 credential 刷新取代旧自动请求、revision 创建立即 upsert Profile 且拒绝创建前迟到列表补充失败优先状态与生命周期回归，修改 `tests/unit/model-catalog-sync.test.ts`、`tests/unit/profile-list-sync.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T047 [US3] 实现 Ollama JSON Schema 能力选择、prompt-only 回退、可选参数最小化与受限 JSON 代码块解析，修改 `src/providers/ollama.ts`
- [X] T048 [US2] [US3] 让 Sidebar/Main 的 credential 刷新取得新 owner，并让 Main 以 revision 创建结果立即收敛 Profile 列表，修改 `ui/sidebar.ts`、`src/adapters/iina/model-catalog-sync.ts`、`src/adapters/iina/profile-list-sync.ts` 与 `src/main.ts`
- [X] T049 运行新增与 014 聚焦回归，再严格执行完整门禁、重新打包并将候选包交付 T038 验收

---

## 阶段 10：Ollama Cloud 输出与凭据状态收敛

**目的**：让不支持 structured outputs 的 Ollama Cloud 在 Test 与翻译中获得精确输出 Schema，并让凭据写入成功立即反映到当前窗口的 Profile 安全状态，再生成候选包供 T038 继续验收。

- [X] T050 [P] [US3] 为 prompt-only 请求携带当前批次精确 JSON Schema、Ollama Cloud 实际键值对象偏差的严格拒绝，以及凭据成功立即收敛 `credentialConfigured` 补充失败优先回归，修改 `tests/contract/ollama.test.ts`、`tests/integration/us3-providers.test.ts` 与 `tests/unit/profile-list-sync.test.ts`
- [X] T051 [US3] 在 Ollama prompt-only 消息中注入当前批次精确 JSON Schema，并在 Main 收到权威凭据成功后立即更新对应 Profile 安全状态，修改 `src/providers/ollama.ts`、`src/adapters/iina/profile-list-sync.ts` 与 `src/main.ts`
- [X] T052 运行新增与 014 聚焦回归，使用仓库专用 Ollama 测试配置完成不泄露原始响应的黑盒验证，再严格执行完整门禁、重新打包并将候选包交付 T038 验收

---

## 阶段 11：认证 Profile 首次模型发现收敛

**目的**：解除新建认证 Profile 在保存 Key 与选择 Model ID 之间的逻辑闭环，同时保持完整 Profile、只写凭据与目录隔离边界。

- [X] T053 [P] [US1] [US3] 为独立草稿凭据刷新消息、仅手动触发、字段严格性、Key 长度与安全结果补充失败优先契约及安全测试，修改 `tests/contract/ui-messages.test.ts`、`tests/contract/global-rpc.test.ts` 与 `tests/security/credential-leakage.test.ts`
- [X] T054 [P] [US1] [US3] 为草稿 Key 代次失效、当前窗口目录隔离、空 Model ID Save 本地阻止及可操作反馈补充失败优先状态与 Sidebar 契约测试，修改 `tests/unit/model-catalog-sync.test.ts`、`tests/contract/sidebar-form.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T055 [US1] [US3] 实现严格 `provider:models-preview` 消息、逐窗口 owner 转发与 Global 一次性 Bearer 模型发现，修改 `src/domain/messages.ts`、`src/adapters/iina/model-catalog-sync.ts`、`src/main.ts` 与 `src/global.ts`
- [X] T056 [US1] [US3] 实现 API Key 输入代次、手动草稿刷新、自动刷新凭据隔离、空 Model ID 保存引导、凭据来源反馈与当前用户说明，修改 `ui/sidebar.ts`、`ui/sidebar.html`、`ui/provider-status.ts`、`README.md`、`docs/readme/README.*.md` 与 `docs/engineering/development.md`
- [X] T057 运行新增与 014 聚焦回归，再严格执行完整门禁、重新打包并将候选包交付 T038 验收

---

## 依赖与执行顺序

### 阶段依赖

- **阶段 1（准备）**：无依赖。
- **阶段 2（基础能力）**：依赖阶段 1；阻塞全部用户故事。
- **US1（阶段 3）**：依赖阶段 2，是首个可演示 MVP。
- **US2（阶段 4）**：依赖 US1 的目录协议和控件；其刷新协调可在 US1 核心生产模块稳定后开始。
- **US3（阶段 5）**：Provider 凭据测试与 Ollama Bearer 实现可在阶段 2 后开始；完整 Refresh 验收依赖 US1 与 US2。
- **US4（阶段 6）**：非 UI 文档与数据兼容测试可在阶段 2 后独立开始；共享 Sidebar 文件必须在 US1、US3 之后按顺序合并。
- **阶段 7（收尾）**：依赖计划纳入交付的全部用户故事；T036、T037 必须串行。
- **阶段 8（人工反馈收敛）**：依赖首轮 T038 人工反馈；T039、T040、T041 的测试准备完成后按 T042 → T043 → T044 串行，最后重新执行 T038。
- **阶段 9（远程 Ollama 与保存生命周期收敛）**：依赖阶段 8 的候选包反馈；T045、T046 完成失败优先测试后按 T047 → T048 → T049 串行，最后继续执行 T038。
- **阶段 10（Ollama Cloud 输出与凭据状态收敛）**：依赖阶段 9 的候选包反馈；T050 完成失败优先测试后按 T051 → T052 串行，最后继续执行 T038。

### 用户故事完成顺序

```text
准备 → 基础能力 → US1 → US2 ─┬→ US3 → 收尾
                    └─────────┴→ US4 ─┘
```

- **US1**：无其他故事依赖；提供响应驱动列表和自定义 Model ID。
- **US2**：依赖 US1；为目录增加自动/手动刷新和竞态隔离。
- **US3**：完整故事依赖 US1、US2；为 Ollama 的发现、Test、翻译补齐同一凭据契约。
- **US4**：行为上只依赖基础能力，但共享 UI 文件按 US1 → US3 → US4 合并。

### 故事内顺序

- 各故事先完成其“测试”小节并确认预期测试因缺失行为而失败，再修改生产实现。
- Provider 协议与状态模型先于 Global/Main 协调，协调先于 Sidebar 触发和反馈。
- 共享热点文件 `src/global.ts`、`src/main.ts`、`ui/sidebar.ts`、`ui/sidebar-state.ts`、`ui/sidebar.html` 与 `ui/sidebar.css` 同一时间只设一个负责人。
- 只有聚焦验收通过后才进入下一故事或完整门禁；只有正式包人工验收实际通过后才更新验证证据。

## 并行执行示例

### US1

在阶段 2 完成后，T006、T007、T008 可由隔离 worktree 分别负责 Provider 契约、Sidebar 状态和连接生命周期测试；按 T006 → T009、T007 → T010、T010/T011 → T012 的依赖合并。

### US2

T014、T015、T016 可分别准备同步器单元测试、宿主生命周期契约和跨窗口集成测试；生产实现按 T017 → T018 → T019 → T020 串行集成。

### US3

T022、T023、T024、T025 修改不同测试切片时可并行；T026 与不触及 `src/global.ts` 的测试工作可并行，T027 完成后再合并 T028 的共享 Sidebar 修改。

### US4

T030 可与 T032 的文档修订在隔离 worktree 并行；T031 必须等 US1 与 US3 的 Sidebar 热点文件合并完成。

## 实施策略

### MVP 优先

1. 完成阶段 1 与阶段 2。
2. 完成 US1，并运行 T013 独立验收。
3. 在此检查点演示响应驱动列表、自定义 Model ID 和刷新不改值。

US1 是最小可演示范围；面向生产交付的 P1 切片应继续完成 US2 与 US3，才能覆盖可靠刷新及认证 Ollama。

### 增量交付

1. **基础能力 + US1**：交付响应驱动选择与自定义值。
2. **加入 US2**：交付非阻塞自动/手动刷新及竞态隔离。
3. **加入 US3**：交付认证 Ollama 与统一只写凭据安全边界。
4. **加入 US4**：交付 OpenAI 可见名称与兼容数据语义。
5. **收尾**：完成全量门禁、正式包审计和单人 IINA 验收。

## 备注

- 生产 TypeScript、HTML 与 CSS 变更不得新增代码注释，自然语言默认使用英语。
- 模型目录只保留运行期最近成功快照，不持久化、不静态补齐、不跨上下文兜底。
- 真实 Provider 配置只可在显式验收时从 `docs/providers` 本地读取，不得复制到任务、日志、命令输出或证据。
- 本功能由 0.1.0 发布；版本与 release notes 在验收后的发布准备中统一更新，不在功能实施任务中 commit、tag、上传或发布。
