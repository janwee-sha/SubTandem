# 任务：原生侧栏视觉与语言自动保存

**输入**：`specs/017-native-sidebar-ui/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/sidebar-interaction.md` 与 `quickstart.md`

**测试要求**：规格和项目宪法明确要求自动化回归；每个用户故事先建立会失败的契约测试，再实现生产行为。WKWebView 与 IINA 宿主材质的最终观感由开发者按 `quickstart.md` 单人实机验收。

**组织方式**：任务按用户故事分组。`[P]` 只用于不依赖未完成同级任务且修改不同文件的工作；并行执行时必须使用隔离 worktree，并遵守下文的文件所有权与合并顺序。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可与同组标记任务并行，且文件所有权不重叠
- **[Story]**：任务所属用户故事（`[US1]` 或 `[US2]`）
- 每个任务均给出准确文件路径

---

## Phase 1：设置与当前意图收敛

**目的**：在实现前移除受本功能替代的旧交互描述，同时保留既有已验收任务的编号和完成状态。

- [X] T001 [P] 将显式 `Save Languages`、dirty 草稿和点击提交改写为选中即提交、单 pending 与失败回滚的当前意图，同步更新 `specs/007-auto-language-support/spec.md`、`specs/007-auto-language-support/plan.md`、`specs/007-auto-language-support/research.md`、`specs/007-auto-language-support/data-model.md`、`specs/007-auto-language-support/quickstart.md`、`specs/007-auto-language-support/contracts/target-language-preference.md`，不得修改 `specs/007-auto-language-support/tasks.md`
- [X] T002 [P] 将操作反馈中的 `Save Languages` 控件语义收敛为 Target Language 选择器自动保存，同步更新 `specs/013-local-openai-profile-ux/spec.md`、`specs/013-local-openai-profile-ux/data-model.md`、`specs/013-local-openai-profile-ux/quickstart.md`、`specs/013-local-openai-profile-ux/contracts/sidebar-interactions.md`，不得修改 `specs/013-local-openai-profile-ux/tasks.md`

**检查点**：旧功能的非任务 SDD 只描述当前目标状态，已完成任务清单保持原样。

---

## Phase 2：基础能力

**目的**：确认用户故事共同依赖的既有契约可直接复用。

本功能复用现有 `defaults:save` 消息、Main revision/request ID 校验、Global 原子 preference 写入和 Sidebar operation coordinator，不新增依赖、消息字段、持久化键或共享基础代码，因此本阶段没有实现任务。

**检查点**：用户故事只修改 Sidebar 生产文件与两个聚焦契约测试，不修改 Main、Global、Provider、native helper、权限或打包契约。

---

## Phase 3：用户故事 1——选择目标语言即保存（优先级：P1）🎯 MVP

**目标**：用户选择不同目标语言后立即且只发起一次保存；等待期间不可重复选择；成功采用权威语言与 revision，失败、取消或异常恢复上一个 committed 值。

**独立测试**：加载已有目标语言，选择另一个目录成员，确认 DOM 中不存在保存按钮、选择器立即 busy 且只发送一个 revisioned `defaults:save`；分别注入匹配成功、失败、取消、异常、旧结果和 pending 期间旧快照，确认采用或恢复正确值且过期输入不改变状态。

### 先写失败测试

- [X] T003 [P] [US1] 在 `tests/contract/sidebar-form.test.ts` 先改写失败契约，覆盖无 `#save-languages`、`#language-status` 紧邻 Target Language 选择器、选择器水合前禁用、相同值不发送、不同值只发送一个 revisioned `defaults:save`，以及 pending 时 `disabled` 与 `aria-busy=true`
- [X] T004 [P] [US1] 在 `tests/contract/sidebar-lifecycle.test.ts` 先添加失败契约，覆盖匹配成功采用返回语言与 revision、失败/取消/`operation:error` 恢复 committed、旧或重复 request ID 被忽略，以及 pending 期间 `state:update` 不覆盖候选值

### 实现

- [X] T005 [US1] 在 `ui/sidebar.html` 删除 `#save-languages`，让 `#target-language` 初始禁用并通过可访问关系绑定紧邻的 `#language-status`，保留唯一 Target Language 控件且不改变 Position、Profile 与 Session DOM 行为
- [X] T006 [US1] 在 `ui/sidebar.ts` 删除 `saveLanguagesButton`、`targetLanguageDirty` 和按钮点击路径，将 `languages` action 的 busy 控件改为 `targetLanguage`，并在已水合、无 pending 且选择值不同于 committed 时由 `change` 事件建立一次 operation 后发送现有 revisioned `defaults:save`
- [X] T007 [US1] 在 `ui/sidebar.ts` 完成自动提交状态收敛：水合后按 pending 状态启用选择器，匹配成功采用返回语言与 revision，匹配失败/取消/`operation:error` 恢复 committed 并清 pending，等待期间忽略旧快照，且未知、迟到或重复结果不得改变值或反馈
- [X] T008 [US1] 运行 `npx vitest run tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts tests/contract/ui-messages.test.ts tests/contract/target-language-preferences.test.ts`，确认自动保存、既有跨运行时偏好契约及 Profile/Translate/Position 回归全部通过

**检查点**：用户故事 1 可独立交付；不需要视觉重构也能完成选中即保存、请求关联、失败回滚和持久化恢复。

---

## Phase 4：用户故事 2——侧栏融入 IINA/macOS 宿主（优先级：P2）

**目标**：侧栏以透明宿主表面、无重复插件标题的全宽平铺分区和紧凑原生尺度呈现；Translate 与 Subtitle 共用标题行，只有 Profile 集合与 Session 摘要使用无嵌套 blur 和常驻外框的低对比分组，并保留亮暗色、辅助功能和窄宽度适配。

**独立测试**：不操作目标语言保存，分别以亮色、暗色、提高对比度、减少透明度、减少动态效果、强制颜色和窄宽度条件检查结构与 CSS 契约；确认宿主标签下无重复插件标题，顶层 section 无圆角、阴影或 blur，控件采用正常字重和低对比透明填充，Profile 与 Session 分组可辨识且所有控件无横向溢出。

### 先写失败测试

- [X] T009 [US2] 在 `tests/contract/sidebar-form.test.ts` 先改写失败视觉契约，覆盖透明根表面、宿主标签下无重复插件标题、Translate 与 Subtitle 共用标题行、Section 全宽与约 20px 横向间距、顶层无 card 圆角/阴影/blur、仅 Profile 与 Session 使用无 blur 和常驻外框的 10px 低对比分组、26px 无常驻描边控件、Model ID 控件间距、44×20px 轨道与 26×16px 胶囊滑块、亮暗系统语义色、窄宽度回退，以及 `prefers-contrast`、`prefers-reduced-transparency`、`prefers-reduced-motion` 和 `forced-colors`

### 实现

- [X] T010 [US2] 在 `ui/sidebar.html` 移除宿主插件标签下重复的 SubTandem 标题，将 Translate 与 Subtitle 组织到同一标题行，并把 Subtitle、Translation service 与 Session 组织为全宽平铺分区；仅为现有 `#profiles` 集合和 Session 摘要保留明确的 group surface 结构，保持全部 label、status、Profile 操作与脚本加载顺序不变
- [X] T011 [US2] 在 `ui/sidebar.css` 建立透明根表面、约 20px 分区内边距与 1px 分隔线；将 Target Language 和服务字段统一为标签在上的单列布局并为 Model ID 选择与编辑控件保留 5px 间距，把控件收敛为约 26px/6px、正常字重、低对比透明填充和无常驻描边，把 switch 收敛为 44×20px 轨道与 26×16px 胶囊形滑块；主状态使用 macOS 系统蓝，Position、次要与危险操作保持低强调，并只为 Profile/Session group 定义亮暗自适应、无嵌套 blur 和常驻外框的 10px 半透明填充及减少透明度降级，同时保留提高对比度、减少动态、强制颜色与窄宽度无横向滚动规则
- [X] T012 [US2] 运行 `npx vitest run tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts`，确认视觉结构契约和全部 Sidebar 既有交互契约通过

**检查点**：用户故事 2 可在不触发保存的情况下独立验收，且未改变 Profile、Translate、Position、服务配置或 Session 消息语义。

---

## Phase 5：收尾与跨故事验证

**目的**：验证代码质量、完整构建与真实 IINA/WKWebView 行为。

- [X] T013 对 `ui/sidebar.html`、`ui/sidebar.css`、`ui/sidebar.ts`、`tests/contract/sidebar-form.test.ts`、`tests/contract/sidebar-lifecycle.test.ts`、`specs/007-auto-language-support/`、`specs/013-local-openai-profile-ux/` 与 `specs/017-native-sidebar-ui/` 执行 Prettier 检查，并运行 `git diff --check`
- [X] T014 依次执行 `package.json` 定义的 `npm test`、`npm run typecheck`、`npm run lint` 与 `npm run build`，确认完整自动化和正式 Parcel 构建通过且没有新增依赖或交付资源
- [X] T016 [US2] 将普通操作的控件内 busy、静默可见成功、可见异常、辅助技术播报以及 Profile Test/模型目录领域状态写入当前意图，同步更新 `specs/007-auto-language-support/`、`specs/013-local-openai-profile-ux/`、`specs/014-provider-model-discovery/`、`specs/016-customize-overlay-position/` 与 `specs/017-native-sidebar-ui/` 的非任务 SDD，保留各目录既有 `tasks.md` 编号和完成状态
- [X] T017 [P] [US2] 在 `tests/contract/sidebar-form.test.ts`、`tests/contract/sidebar-lifecycle.test.ts` 与 `tests/contract/ui-messages.test.ts` 先建立失败契约，覆盖单一视觉隐藏播报槽、控件内 busy、普通成功无可见消息、异常就近显示、Test 卡片状态、模型数量/空目录状态、删除无可见结果槽和部分成功说明
- [X] T018 [P] [US2] 在 `tests/unit/sidebar-state.test.ts` 先建立失败状态测试，覆盖反馈 `assistive | visible` 分层、删除成功只播报不创建结果槽、区域 latest 拒绝、Profile Update 选择失效和模型状态独立性
- [X] T019 [US2] 在 `ui/sidebar-state.ts` 保持区域请求归属和 Profile 墓碑，增加反馈可见性，移除删除成功结果槽，并让普通 busy/success、主动取消与 error/部分成功分别进入辅助播报或可见异常
- [X] T020 [US2] 在 `ui/sidebar.html`、`ui/sidebar.css`、`ui/sidebar.ts` 与 `ui/provider-status.ts` 实现单一视觉隐藏 live region、控件内 busy、普通成功静默、Position 失败可见、Profile Test revision 状态、模型数量/空目录低强调状态、删除无结果槽和 Profile/凭据部分成功说明
- [X] T021 [US2] 运行 `npx vitest run tests/unit/sidebar-state.test.ts tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts tests/contract/ui-messages.test.ts tests/integration/us3-providers.test.ts`，确认反馈分层、请求竞态和现有 Profile 生命周期通过
- [X] T022 对本轮修改执行 Prettier、`git diff --check`、`npm test`、`npm run typecheck`、`npm run lint` 与 `npm run build`，确认生产反馈契约、完整回归和正式构建通过
- [X] T023 [US2] 在 `tests/contract/sidebar-form.test.ts` 先建立失败契约，覆盖 Position 的亮暗色中性轨道、20px 命中区、3px track、显式 thumb 几何和强制颜色系统回退
- [X] T024 [US2] 在 `ui/sidebar.css` 移除 Position 对 WKWebView 默认 range 外观的依赖，显式实现宿主式细轨道与紧凑旋钮，并保留禁用、busy、焦点和强制颜色行为
- [X] T025 对 Position 视觉修复执行 Prettier、聚焦 Sidebar 契约、`git diff --check`、`npm test`、`npm run typecheck`、`npm run lint` 与 `npm run build`
- [X] T026 [US2] 在 `tests/contract/sidebar-form.test.ts` 先建立失败契约，覆盖 Position 的 18×14px、7px 圆角矩形 thumb 及无额外描边和投影
- [X] T027 [US2] 在 `ui/sidebar.css` 与 `specs/017-native-sidebar-ui/` 当前意图中将 Position thumb 收敛为 IINA 的高圆角矩形几何，并保留中性轨道和强制颜色回退
- [X] T028 对 Position thumb 形状修复执行 Prettier、聚焦 Sidebar 契约、`git diff --check`、`npm test`、`npm run typecheck`、`npm run lint` 与 `npm run build`
- [X] T015 由开发者使用同一构建产物逐项完成 `specs/017-native-sidebar-ui/quickstart.md` 的 IINA 单人实机验收，覆盖亮色、暗色、自动保存成功与故障回滚、控件内 busy、普通成功静默、异常就近显示、Profile Test/模型领域状态、辅助技术播报、重开与完整重启恢复、窄宽度和三项辅助功能偏好

**检查点**：自动化、构建和宿主验收全部完成后，本功能才可视为完成。

---

## 依赖与执行顺序

### 阶段依赖

- **Phase 1**：无依赖；T001 与 T002 可在不同 worktree 中并行，分别负责 007 和 013 的非任务 SDD。
- **Phase 2**：依赖 Phase 1；无新增基础实现任务。
- **Phase 3 / US1**：依赖 Phase 2；T003 与 T004 先并行建立失败测试，随后按 T005 → T006 → T007 → T008 执行。
- **Phase 4 / US2**：行为上只依赖 Phase 2，但与 US1 共用 `tests/contract/sidebar-form.test.ts` 和 `ui/sidebar.html`；为避免热点文件并发修改，按优先级在 T008 后执行 T009 → T010 → T011 → T012。
- **Phase 5**：T013–T014 是反馈分层前已验收门禁；T016 更新当前意图，T017 与 T018 可在隔离 worktree 中并行建立失败测试，随后按 T019 → T020 → T021 → T022 执行，最后重跑保留原编号的 T015 实机验收。

### 用户故事依赖图

```text
Phase 1 当前意图收敛
        |
Phase 2 复用既有基础契约
        |
US1 (P1, MVP) ──热点文件合并完成──> US2 (P2)
        |                              |
        +--------------+---------------+
                       |
                 Phase 5 完整验证
```

- **US1**：无行为上的用户故事依赖，是建议 MVP。
- **US2**：无产品行为依赖；共享工作区中因测试与 HTML 文件所有权在 US1 后合并，独立测试不需要执行 US1 的保存流程。

### 故事内顺序

- 先写契约测试并确认在旧实现上失败。
- DOM 契约先于 TypeScript 控件绑定，触发与 busy 状态先于结果和快照收敛。
- 视觉测试先于 HTML/CSS 实现，HTML 层级先于依赖该层级的 CSS。
- 每个故事完成后执行其聚焦测试，再进入下一故事。

---

## 并行执行示例

### 用户故事 1

在两个隔离 worktree 中分别执行，完成后按 T003 → T004 的顺序合并测试：

```text
Task T003: tests/contract/sidebar-form.test.ts
Task T004: tests/contract/sidebar-lifecycle.test.ts
```

### 用户故事 2

初始视觉切片 T009 → T010 → T011 必须顺序执行；反馈分层收敛中 T017 与 T018 修改不同测试文件，可在隔离 worktree 中并行，随后按 T019 → T020 合并生产实现。

### 跨故事收敛

Phase 1 可在两个隔离 worktree 中并行，且文件所有权不重叠：

```text
Task T001: specs/007-auto-language-support/ 非任务 SDD
Task T002: specs/013-local-openai-profile-ux/ 非任务 SDD
```

---

## 实施策略

### MVP 优先（只交付用户故事 1）

1. 完成 Phase 1 与 Phase 2。
2. 完成 T003–T008。
3. 停止并按 US1 独立测试标准验证自动保存、失败回滚和过期拒绝。
4. 只有用户明确授权继续实施时，才进入生产代码任务；本任务清单本身不构成实施授权。

### 增量交付

1. US1 提供可独立验收的目标语言选中即保存。
2. US2 在保持 US1 与既有跨运行时语义不变的前提下提供原生侧栏视觉和反馈分层。
3. Phase 5 收敛反馈呈现，再统一完成格式、全量自动化、构建与 IINA 宿主验收。

## 备注

- 不新增运行时或开发依赖，不修改 Main、Global、Provider 实现、native helper、权限、消息字段或持久化键。
- 生产 HTML、CSS 与 TypeScript 不得新增注释，生产自然语言继续使用英语。
- `specs/007-auto-language-support/tasks.md`、`specs/013-local-openai-profile-ux/tasks.md`、`specs/014-provider-model-discovery/tasks.md` 与 `specs/016-customize-overlay-position/tasks.md` 的既有任务、编号和完成状态必须保留。
- `docs/releases/v0.1.0.md` 由 018 首版发布规格汇总当前全部用户能力并作为权威正文。
- 未完成的自动化、构建或 IINA 实机验收必须保持未勾选，不能由推断或无关测试替代。
