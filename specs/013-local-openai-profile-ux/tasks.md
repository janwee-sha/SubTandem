# 任务：Provider HTTP 与 Profile 交互优化

**输入**：`specs/013-local-openai-profile-ux/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格 FR-016 与项目宪法要求行为变更先有自动化回归，并对跨运行时、正式包与 IINA 宿主行为保留单人实机验收。各故事的测试任务必须先编写并确认在对应实现前失败；不得以解析 SDD 文档替代生产接口验证。

**组织方式**：任务按用户故事分组。`ui/sidebar.ts`、`ui/sidebar-state.ts`、`tests/contract/sidebar-lifecycle.test.ts` 与版本/发布文件是共享热点，必须按本文依赖顺序由单一负责人修改；并行 Agent 必须使用隔离 worktree 或等效隔离工作区。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：在满足前置依赖后，可与同阶段其他 `[P]` 任务并行，且不修改相同文件
- **[Story]**：映射到 `spec.md` 中的用户故事
- 每项任务均给出实现、测试、文档或产物的精确路径

## 阶段 1：准备与基线

**目的**：确认当前实现与测试基线，避免把既有失败误归因于本功能。

- [X] T001 按 `specs/013-local-openai-profile-ux/quickstart.md` 的“聚焦自动化”命令运行现有基线，记录 `tests/contract/provider-profiles.test.ts`、`tests/contract/openai.test.ts`、`tests/contract/ollama.test.ts`、`tests/contract/sidebar-form.test.ts`、`tests/contract/sidebar-lifecycle.test.ts`、`tests/contract/ui-messages.test.ts`、`tests/integration/us3-providers.test.ts`、`tests/security/credential-leakage.test.ts`、`tests/security/redaction.test.ts` 与 `native/transport/Tests/SubTandemTransportTests/HTTPClientTests.swift` 的既有结果

---

## 阶段 2：基础能力

**目的**：识别阻塞所有故事的共享基础。

本功能不新增数据库、依赖或跨全部用户故事的基础设施。完成 T001 后即可进入用户故事；共享 Sidebar 状态工厂在 US2 首次建立，US3、US4 与 US5 按依赖复用。

---

## 阶段 3：用户故事 1——为任意 Service type 配置 HTTP 服务（优先级：P1）🎯 MVP

**目标**：OpenAI-compatible 与 Ollama 对本机、局域网/私网及公网的完整有效 HTTP(S) endpoint 使用相同许可规则，同时保留 URL、凭据、重定向、日志与选择边界。

**独立测试**：对两个 Service type 分别覆盖 HTTPS、回环 HTTP、私网 HTTP 与公网 HTTP 的 Save、恢复、Provider 构造、Test、Select 和翻译路径；确认 system/direct 一致允许初始目标，并继续拒绝非 HTTP(S)、userinfo、query、fragment、非法 authority/端口和跨来源重定向。

### 测试

- [X] T002 [P] [US1] 先在 `tests/contract/provider-profiles.test.ts` 增加两个 Service type 的 HTTPS、回环/私网/公网 HTTP 接受矩阵和共享恶意 URL corpus，覆盖 Save、metadata 恢复、revision/fingerprint 稳定性、拒绝时不创建 revision/不清理选择，并移除 Ollama 无 scheme 简写的旧预期，确认测试在实现前失败
- [X] T003 [P] [US1] 先在 `tests/contract/openai.test.ts` 增加远程 HTTP 在 system/direct 下的构造、Test 与翻译请求测试，确认字面 API root 仍追加 `/chat/completions`、Authorization 只发往选定 origin，测试在实现前失败
- [X] T004 [P] [US1] 先在 `tests/contract/ollama.test.ts` 增加远程 HTTP 在 system/direct 下的 probe、Test 与翻译路径测试，确认完整 URL 和既有尾斜杠规范化，测试在实现前失败
- [X] T005 [P] [US1] 先在 `tests/integration/us3-providers.test.ts` 增加 OpenAI-compatible 与 Ollama 的远程 HTTP Save→Test→Select→翻译集成场景及 HTTPS 回归，确认 Test 不自动 Select，测试在实现前失败
- [X] T006 [P] [US1] 先在 `native/transport/Tests/SubTandemTransportTests/HTTPClientTests.swift` 增加远程 HTTP 初始目标许可、system 最多三次同源重定向、redirect target 重新校验、跨 scheme/host/有效端口与 userinfo/fragment 阻断、direct 不跟随的契约测试，确认测试在实现前失败
- [X] T007 [P] [US1] 先在 `tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts` 增加远程 HTTP 下 Profile View、错误、反馈与日志不泄露凭据、Authorization、完整 endpoint、字幕或 Provider 原始响应的回归，确认新增断言在实现前失败或覆盖到生产路径

### 实现

- [X] T008 [US1] 在 `src/providers/profiles.ts` 将 endpoint 解析与规范化改为 JavaScriptCore 可执行的完整 HTTP(S) URL 规则，删除协议/主机网络位置限制及 Ollama 无 scheme 兼容，同时继续拒绝 userinfo、query、fragment、空 host、残缺 IPv6 与非法端口并保留各 Provider 路径语义
- [X] T009 [P] [US1] 在 `native/transport/Sources/SubTandemTransport/HTTPClient.swift` 允许任意非空 host 的 HTTP(S) 初始目标，并让每个 system redirect target 先重新通过结构校验再比较同源；保持三跳上限与 direct 不跟随
- [X] T010 [P] [US1] 在 `ui/sidebar.ts` 更新 Service type endpoint 提示，使 OpenAI-compatible 与 Ollama 均表达完整 HTTP(S) URL 规则且不新增风险提示、HTTPS 要求、主机白名单或额外确认
- [X] T011 [US1] 运行 `npx vitest run tests/contract/provider-profiles.test.ts tests/contract/openai.test.ts tests/contract/ollama.test.ts tests/integration/us3-providers.test.ts tests/security/credential-leakage.test.ts tests/security/redaction.test.ts` 与 `npm run test:native`，确认 `src/providers/profiles.ts`、两个 Provider 构造器及 native 最终出站层共同满足 `specs/013-local-openai-profile-ux/contracts/endpoint-http.md`

**检查点**：两个现有 Service type 的任意有效 HTTP(S) Profile 均可独立完成 Save、Test、Select 与翻译，且非明文传输边界保持不变。

---

## 阶段 4：用户故事 2——删除后立即看到最新 Profile 列表（优先级：P1）

**目标**：只在权威删除成功后立即移除条目并清理所属瞬时状态，防止迟到列表、重复结果或窗口间消息恢复已删除 Profile。

**独立测试**：分别删除未选择、已选择、正在编辑和已有 Test 状态的 Profile；成功后立即消失并保持墓碑收敛，失败或取消保留原状态，旧/重复/反序结果不恢复条目且其他窗口不产生无来源成功槽。

### 测试

- [X] T012 [P] [US2] 先创建 `tests/unit/profile-list-sync.test.ts`，覆盖 Main 列表 request sequence、仅提交最新 request ID、删除时先过滤当前快照再刷新以及 A/B 反序结果，确认测试在实现前失败
- [X] T013 [P] [US2] 先创建 `tests/unit/sidebar-state.test.ts` 的删除状态组，覆盖 WebView 墓碑、即时过滤、编辑/选择/凭据展示/Test/pending 清理、重复成功幂等、迟到快照过滤和无本地请求时不创建结果槽，确认测试在实现前失败
- [X] T014 [P] [US2] 先在 `tests/contract/sidebar-lifecycle.test.ts` 增加 `profile:deleted` 成功、取消与失败的跨运行时消息测试，覆盖权威成功时序、同一 request ID、状态保留及其他窗口隔离，确认测试在实现前失败
- [X] T015 [P] [US2] 先在 `tests/integration/us3-providers.test.ts` 增加删除前列表请求在删除后迟到、重复删除结果与重新打开 Sidebar 的集成回归，确认持久删除状态不会被恢复，测试在实现前失败

### 实现

- [X] T016 [US2] 创建 `src/adapters/iina/profile-list-sync.ts`，实现逐窗口单调 request sequence、latest request identity、只接受最新结果及权威删除即时过滤的无副作用状态转换
- [X] T017 [US2] 在 `src/main.ts` 接入 `src/adapters/iina/profile-list-sync.ts`，为所有 `profiles:list` 请求分配不碰撞身份，只提交最新结果，并在 `profile:deleted` 时先清理当前 Profile/选择快照再请求新列表
- [X] T018 [US2] 创建 `ui/sidebar-state.ts` 的 classic-script 全局状态工厂，先实现 Sidebar Profile 集合、WebView 生命周期删除墓碑、编辑/选择/凭据展示/Test/pending 清理和本地删除成功结果槽转换，且不访问 DOM
- [X] T019 [US2] 在 `ui/sidebar.ts` 接入删除状态转换：权威成功到达即移除 Profile、清理关联状态并重绘；取消或失败保留业务状态；对所有列表快照应用墓碑过滤；重复或未知结果保持幂等
- [X] T020 [P] [US2] 在 `ui/sidebar.css` 添加删除成功只读结果槽的布局与 success 状态样式，使其占据原 Profile 列表位置但不呈现为可操作 `.profile`
- [X] T021 [US2] 运行 `npx vitest run tests/unit/profile-list-sync.test.ts tests/unit/sidebar-state.test.ts tests/contract/sidebar-lifecycle.test.ts tests/integration/us3-providers.test.ts`，确认 `src/main.ts` 与 `ui/sidebar.ts` 的反序、重复、取消、失败和多窗口删除场景满足 `specs/013-local-openai-profile-ux/contracts/sidebar-interactions.md`

**检查点**：删除成功事件送达后当前界面立即收敛，后续同步不恢复条目；取消与失败不清理任何业务状态。

---

## 阶段 5：用户故事 3——在发起操作的位置读取结果（优先级：P2）

**目标**：Translate、Save Languages、Profile Save/Update、Select/Test/Delete 与 Subtitle Retry 的 busy 和终态只显示在所属控件正下方，全局同时最多一条，任一区域新消息立即清除其余区域消息，当前消息保持可见直至下一条被接受的消息替换，且迟到结果不得清除新消息。

**独立测试**：依次和交错触发所有操作区域，验证 request→region/action 归属、同一区域 latest-wins、全局消息 latest-write-wins、消息持续显示、替换不改变 pending/busy/业务状态、Profile 行重绘和无重复屏幕阅读器播报。

### 测试

- [X] T022 [P] [US3] 先扩展 `tests/unit/sidebar-state.test.ts` 的反馈状态组，覆盖五类 region、action identity、同区域新请求替换、不同区域并行、旧/重复/未知结果、控件 busy 清理与 Profile 行重绘恢复，确认测试在实现前失败
- [X] T023 [P] [US3] 先在 `tests/contract/sidebar-form.test.ts` 增加每个操作控件正下方独立 `role="status" aria-live="polite"`、`ui/sidebar-state.ts` 早于 `ui/sidebar.ts` 以 classic script 加载及 Profile 列表容器不重复播报的生产 DOM 契约，确认测试在实现前失败
- [X] T024 [P] [US3] 先在 `tests/contract/sidebar-lifecycle.test.ts` 增加 Translate、Languages、Profile editor、Profile row 与 Retry 的 request 归属和反序消息场景，确认权威业务快照仍可收敛但无归属旧结果不产生反馈，测试在实现前失败

### 实现

- [X] T025 [US3] 在 `ui/sidebar-state.ts` 实现 `translation-toggle`、`language-settings`、`profile-editor`、`profile-row:<profileId>` 与 `subtitle-retry` 的 latest request、phase、message 和 action busy 状态转换，不保存 DOM、endpoint 或敏感内容
- [X] T026 [P] [US3] 在 `ui/sidebar.html` 删除共享 `#operation-status`，为 Translate、Save Languages、Profile editor 与 Subtitle Retry 控件各添加紧邻其下的独立可访问状态容器，并确保 `ui/sidebar-state.ts` 在 `ui/sidebar.ts` 前以 classic script 加载
- [X] T027 [P] [US3] 在 `ui/sidebar.css` 为区域级状态、Profile 行内状态与删除结果槽统一 busy/success/error/cancelled 样式，并避免状态容器破坏窄宽度布局
- [X] T028 [US3] 在 `ui/sidebar.ts` 用 region/action identity 重构 `beginOperation`、终态处理和 Profile 行渲染，覆盖全部操作入口、迟到结果、行重绘及控件 busy 恢复，移除对共享状态节点和失效 DOM 引用的依赖
- [X] T029 [US3] 运行 `npx vitest run tests/unit/sidebar-state.test.ts tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts`，确认所有操作的反馈位置、归属、可访问公布与竞态符合 `specs/013-local-openai-profile-ux/contracts/sidebar-interactions.md`

**检查点**：所有现有操作区均保留就近反馈和独立请求归属，可见消息全局互斥并保持到下一条被接受的消息写入。

---

## 阶段 6：用户故事 4——使用 Service type 作为默认 Profile 名称（优先级：P2）

**目标**：新建表单名称默认取当前 Service type 可见文本并在 system 模式下跟随切换；任意用户输入和既有 Profile 名称均受保护。

**独立测试**：新建时分别得到 `OpenAI-compatible` 与 `Ollama`；用户改名、清空、输入空白或重新输入默认文本后切换类型均不覆盖；编辑既有 Profile 时保持保存名称；再次 New 恢复 system 模式。

### 测试

- [X] T030 [P] [US4] 先扩展 `tests/unit/sidebar-state.test.ts` 的 Profile name 状态组，覆盖 `system | user | saved` 转换、任意 input 锁定、自定义/空白/同值保护及 New/reset 恢复，确认测试在实现前失败
- [X] T031 [P] [US4] 先在 `tests/contract/sidebar-form.test.ts` 增加 Service type 可见文本作为初始可保存名称、切换跟随与空白保存不使用通用回退名的生产表单契约，确认测试在实现前失败

### 实现

- [X] T032 [US4] 在 `ui/sidebar-state.ts` 实现 `ProfileNameState` 的 value、mode 与 serviceTypeLabel 转换，确保用户 input 即使为空、空白或等于默认文本也进入 `user`，载入既有 Profile 进入 `saved`
- [X] T033 [P] [US4] 在 `ui/sidebar.html` 将 `#profile-name` 初始值与默认 Service type 的可见文本统一，且不使用 placeholder 充当输入值
- [X] T034 [US4] 在 `ui/sidebar.ts` 接入名称来源状态与 Service type 可见 `<option>` 文本，覆盖初始化、类型切换、loadEditor、New/reset 和保存 trim 值，并移除 `"Provider"` 通用回退名
- [X] T035 [US4] 运行 `npx vitest run tests/unit/sidebar-state.test.ts tests/contract/sidebar-form.test.ts`，确认新建、切换、自定义、空白和编辑既有 Profile 的名称行为满足 `specs/013-local-openai-profile-ux/contracts/sidebar-interactions.md`

**检查点**：系统默认名称准确跟随 Service type，任何用户或保存名称均不会被自动覆盖。

---

## 阶段 7：用户故事 5——获得简洁一致的翻译选择提示（优先级：P3）

**目标**：Update 选择失效与 Test 成功使用精确指定文案，全部生产用户文案移除 `to authorize translation`，但不改变 Test、Credential 与 Select 的独立语义。

**独立测试**：更新已选择 Profile（含无凭据与两段式凭据保存）后显示指定 Update 文案；Test 成功显示指定 Test 文案且不自动 Select；生产用户文案中旧短语为零。

### 测试

- [X] T036 [P] [US5] 先在 `tests/contract/ui-messages.test.ts` 增加 `Profile updated. Select it again for translation.` 与 `Connection test passed. Select this profile for translation.` 的精确生产文案断言，并覆盖生产用户文案不再包含 `to authorize translation`，确认测试在实现前失败
- [X] T037 [P] [US5] 先在 `tests/contract/sidebar-lifecycle.test.ts` 增加 Update 无凭据及两段式凭据保存对 `selectionInvalidated` 的保留、Test 不创建选择、Credential ready 不覆盖 Update 消息的消息流测试，确认测试在实现前失败

### 实现

- [X] T038 [US5] 在 `ui/provider-status.ts` 将成功 Test 文案精确更新为 `Connection test passed. Select this profile for translation.`，保持失败分类和安全详情不变
- [X] T039 [US5] 在 `ui/sidebar-state.ts` 保留同一 request ID 的 `PendingProfileSave.selectionInvalidated` 直到可选 Credential 终态，并使无凭据与两段式保存都产生同一精确 Update 成功消息
- [X] T040 [US5] 在 `ui/sidebar.ts` 接入两段式 Update 状态并将选择失效文案精确更新为 `Profile updated. Select it again for translation.`，确保 Test、Credential 与 Select 仍互不授权或自动触发
- [X] T041 [US5] 运行 `npx vitest run tests/contract/ui-messages.test.ts tests/contract/sidebar-lifecycle.test.ts tests/unit/sidebar-state.test.ts` 并用 `rg -n "to authorize translation" src ui Info.json` 检查生产文件，确认指定文案精确匹配且旧短语零残留

**检查点**：更新与 Test 文案准确一致，选择、测试与凭据保存语义没有改变。

---

## 阶段 8：版本、发布候选与交叉验证

**目的**：统一 0.1.0 交付身份，运行完整质量门、审计最终归档并完成开发者单人 IINA 正式包验收；不发布远端 Release。

- [X] T042 更新当前版本生产接口用例，要求 0.1.0、`janwee-sha/SubTandem`、1000、`SubTandem-0.1.0.iinaplgz` 及漂移失败，并保留通用非当前版本 fixture 验证版本算法
- [X] T043 在 `Info.json`、`package.json`、`package-lock.json` 顶层与 `packages[""]`、`scripts/pack.sh` 的 artifact 路径和安全 case 中串行统一 0.1.0、`janwee-sha/SubTandem` 与 1000，不修改 IINA `allowedDomains` 或 helper loopback 边界
- [X] T044 [P] 将面向未来的固定归档名改为 `SubTandem-X.Y.Z.iinaplgz` 占位写法；v0.1.0 英文正文由 018 汇总当前全部用户能力
- [X] T045 运行 `node scripts/plugin-update-metadata.mjs --manifest Info.json`、`node scripts/release-metadata.mjs`、`npx vitest run tests/contract/plugin-update-metadata.test.ts tests/contract/package-manifest.test.ts tests/contract/release-metadata.test.ts tests/contract/release-audit.test.ts` 与 `npm run test:release`，确认 `specs/013-local-openai-profile-ux/contracts/version-identity.md` 的当前身份接口全部通过
- [X] T046 严格按 `specs/013-local-openai-profile-ux/quickstart.md` 依次运行 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package` 与 `npm run pack`，仅在八项全部成功后生成 `build/release-gates.json`
- [X] T047 按 `specs/013-local-openai-profile-ux/quickstart.md` 对最终 `build/package/SubTandem-0.1.0.iinaplgz` 执行 `scripts/audit-release.mjs`，验证版本/更新身份、根白名单、双 helper 架构/权限/签名/最低 macOS/系统依赖、合规材料、FFmpeg 锁、敏感材料与正文摘要，并生成 `build/release-summary.md` 和 `build/release/` 审计产物

### 全局操作消息竞态（US3）

- [X] T049 [P] [US3] 扩展 `tests/unit/sidebar-state.test.ts`，覆盖五类区域任一新消息清除其余区域、全局最多一条、busy 与终态替换、消息持续显示、替换不删除 pending 或改变业务状态，以及删除结果槽参与同一竞态
- [X] T050 [P] [US3] 扩展 `tests/contract/sidebar-lifecycle.test.ts` 与 `tests/contract/sidebar-form.test.ts`，覆盖 Translate、Languages、Profile editor、不同 Profile 行和 Retry 的交错消息、同区域非 latest/未知/重复结果不清除当前消息、行重绘与可访问状态容器替换
- [X] T051 [US3] 在 `ui/sidebar-state.ts` 分离区域 latest request 与全局 `activeFeedback`，使当前消息保持可见直至下一条被接受的消息替换，且替换只清理文案或删除结果槽，不清理 pending、busy、选择、Test、Credential 或删除状态
- [X] T052 [US3] 在 `ui/sidebar.ts` 接入全局消息写入、跨区域即时清空、持续显示、Profile 行重绘和删除结果槽替换，确保被接受的消息才参与竞态且生产代码不保存失效 DOM 引用或创建自动清除计时器
- [X] T053 [US3] 运行 `npx vitest run tests/unit/sidebar-state.test.ts tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts` 与 `npm run typecheck`，确认全局消息竞态、持续显示、请求归属、busy 恢复和可访问反馈符合 `specs/013-local-openai-profile-ux/contracts/sidebar-interactions.md`
- [X] T054 [US3] 在 `docs/releases/v0.1.0.md` 将操作反馈改进描述同步为最新操作消息全局互斥并保持到下一条反馈，只描述用户可见行为，不记录实现或验收过程
- [X] T055 [US3] 在 T049–T054 验收后严格执行 `specs/013-local-openai-profile-ux/quickstart.md` 的八项门禁、生成 `build/release-gates.json`、打包并审计最终 `build/package/SubTandem-0.1.0.iinaplgz`，确保发布证据与当前源码及全局消息竞态一致
- [X] T048 使用 T055 重新生成并审计的同一 `build/package/SubTandem-0.1.0.iinaplgz`，由开发者一人在 IINA 1.4.4 完成 `specs/013-local-openai-profile-ux/quickstart.md` 的安装、两种 Service type 的本地/私网/公网 HTTP 与 HTTPS、system/direct、删除竞态、全局消息竞态与持续显示、默认名称、精确文案、多窗口、播放和卸载验收，只将允许的版本或 SHA-256、环境、Service type、主机位置类别、scheme、proxy mode 与结论追加到 `docs/validation/iina-matrix.md`

---

## 依赖与执行顺序

### 阶段依赖

- **阶段 1**：无依赖，先确认基线。
- **阶段 2**：不含实现任务；T001 完成后开放故事工作。
- **US1（阶段 3）**：只依赖 T001；测试 T002–T007 先完成并观察预期失败，再实施 T008–T010，最后执行 T011。
- **US2（阶段 4）**：只依赖 T001；测试 T012–T015 先行，T017 依赖 T016，T019 依赖 T018，T021 依赖本阶段全部实现。
- **US3（阶段 5 与全局消息竞态）**：依赖 US2 的 `ui/sidebar-state.ts` 与删除反馈槽；T022–T024 先行，T028 依赖 T025–T027。T049–T050 先行，T051 后由 T052 集成，T053 验收生产行为，T054 同步发布说明，T055 生成并审计与当前源码一致的候选包。
- **US4（阶段 6）**：依赖 US2 的 `ui/sidebar-state.ts` 工厂；T030–T031 先行，T034 依赖 T032–T033。
- **US5（阶段 7）**：依赖 US3 的区域反馈及 US4 后的 Sidebar 热点文件状态；T036–T037 先行，T040 依赖 T038–T039。
- **阶段 8**：依赖计划交付的全部用户故事；T042 先于 T043，T044 可与 T043 在不同文件中并行，T045 后依次执行 T046、T047。T049–T055 完成全局消息竞态并生成与当前源码一致的归档后，最后才执行 T048。

### 用户故事依赖图

```text
T001
├── US1 ────────────────┐
└── US2 ──┬── US3 ──┐  │
          └── US4 ──┴── US5
                          │
US1 + US2 + US3 + US4 + US5
                          ↓
            版本门禁与初始归档审计
                          ↓
              US3 全局消息竞态
                          ↓
              重跑门禁、归档与实机验收
```

- US1 与 US2 在产品行为上可独立完成；若并发实施，必须隔离 worktree，并按 `ui/sidebar.ts` 的既定合并顺序集成。
- US3、US4 与 US5 复用 US2 建立的 Sidebar 状态工厂，但各自仍有独立目标和验收命令；US3 的 T049–T055 完成全局消息竞态要求。
- `ui/sidebar.ts`、`ui/sidebar-state.ts`、`tests/contract/sidebar-lifecycle.test.ts` 依次按 US2 → US3 → US4 → US5 修改，不在共享工作区并发编辑。
- `Info.json`、npm 元数据、`scripts/pack.sh` 与发布正文只在故事收敛后统一修改和验收。

## 并行执行示例

### 用户故事 1

在隔离工作区中可并行完成：

- T002：`tests/contract/provider-profiles.test.ts`
- T003：`tests/contract/openai.test.ts`
- T004：`tests/contract/ollama.test.ts`
- T005：`tests/integration/us3-providers.test.ts`
- T006：`native/transport/Tests/SubTandemTransportTests/HTTPClientTests.swift`
- T007：`tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts`

测试落地后，T008、T009 与 T010 修改不同生产文件，可按 T008 → T009 → T010 的合并顺序集成。

### 用户故事 2

T012–T015 修改不同测试文件，可在隔离工作区并行；实现中 T016 → T017 与 T018 → T019 是两条独立依赖链，T020 可与两条链并行，最后统一执行 T021。

### 用户故事 3

T022–T024 可并行编写测试；T025、T026 与 T027 修改不同文件，可在隔离工作区并行，随后由 T028 单一负责人集成 `ui/sidebar.ts`。

T049 与 T050 修改不同测试文件，可在隔离工作区并行；T051 完成无 DOM 状态转换后由 T052 串行集成 `ui/sidebar.ts`，再依次执行 T053–T055。

### 用户故事 4

T030 与 T031 可并行；测试落地后 T032 与 T033 修改不同文件，可并行，T034 负责 Sidebar 集成。

### 用户故事 5

T036 与 T037 可并行；实现中 T038 与 T039 修改不同文件，可并行，T040 负责 Sidebar 集成。

## 实施策略

### MVP 优先

1. 完成 T001。
2. 完成 US1 的 T002–T011。
3. 停止并按 US1 独立测试验证全部 Service type 的任意有效 HTTP(S) 能力与保留安全边界。
4. 将 US1 作为最小能力 MVP；随后补齐同为 P1 的 US2，形成完整 P1 交付批次。

### 增量交付

1. US1：开放任意有效 HTTP(S) endpoint，保持安全边界。
2. US2：删除成功后即时、稳定收敛。
3. US3：反馈显示在所属操作区域，按区域抵御迟到结果，同时以全局 latest-write-wins 实现跨区域即时清空及持续显示。
4. US4：Service type 驱动默认名称且保护用户输入。
5. US5：统一选择提示而不改变授权语义。
6. 阶段 8：统一 0.1.0 身份；在反馈修正验收后重新完成门禁、最终归档审计与单人正式包验收。

## 备注

- `[P]` 只表示文件所有权与直接依赖允许并行；并行 Agent 仍必须使用隔离 worktree 或等效隔离工作区。
- 生产 TypeScript、Swift、HTML、CSS 与 shell 变更不得新增注释，生产自然语言使用英语。
- 凭据、Authorization、完整 endpoint、字幕、译文与 Provider 原始响应不得进入日志、反馈、测试证据或版本化文档。
- 本任务清单不授权 commit、push、tag、上传、调用 `scripts/publish-release.mjs` 或修改 GitHub Release。
- 每项任务仅在对应测试、契约或人工验收实际通过后标记 `[X]`。
