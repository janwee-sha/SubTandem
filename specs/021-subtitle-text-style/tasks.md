# 任务：字幕文本样式设置

**输入**：`specs/021-subtitle-text-style/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格、计划与项目宪法明确要求自动化回归、native 测试、正式构建打包和单人 IINA 实机验收；各用户故事先编写会失败的测试，再实现生产代码。

**组织方式**：任务按用户故事分组。共享权威状态与严格消息先作为基础完成；共享热点文件按 US1 → US2 → US3 串行演进，避免并发修改同一文件。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：完成前置阶段后可与同组其他 `[P]` 任务并行，且修改不同文件
- **[Story]**：对应 `spec.md` 的用户故事（US1、US2、US3）
- 所有任务描述均包含准确文件路径

## 阶段 1：准备（共享基础设施）

**目的**：建立第三个 native helper 的最小可构建边界，并补齐插件运行时类型。

- [X] T001 定义 macOS 12、Swift 6 的 `SubTandemStylePicker` executable 与 test targets，文件：`native/style-picker/Package.swift`
- [X] T002 [P] 补齐 style-picker 启动、认证 loopback 与退出管理所需的 IINA runtime 类型，文件：`src/types/iina-runtime.d.ts`

---

## 阶段 2：基础（阻塞所有用户故事）

**目的**：建立八字段样式模型、单一 preference、严格消息和 Global 单字段权威合并，使后续 UI、Overlay 与 native picker 共用同一契约。

**关键要求**：T003–T006 必须先写测试并确认失败；T007–T012 完成前不得进入任何用户故事实现。

- [X] T003 [P] 为八字段默认值、RGBA、Size/Width 枚举、字体 family 与逐字段回退编写失败单元测试，文件：`tests/unit/subtitle-style.test.ts`
- [X] T004 [P] 为单一 JSON preference、损坏根对象、raw 值恢复、set/sync 失败和安全错误编写失败契约测试，文件：`tests/contract/subtitle-style-preferences.test.ts`
- [X] T005 [P] 为 get/edit/state/save-result/picker 消息的精确 shape、单字段白名单、序号与正文拒绝编写失败契约测试，文件：`tests/contract/subtitle-style-messages.test.ts`
- [X] T006 [P] 为不同字段合并、同字段最后 intent、superseded、未提交 preview 隔离、三类 revision 与失败整组回退编写失败单元测试，文件：`tests/unit/subtitle-style-sync.test.ts`
- [X] T007 实现 `RgbaColor`、`SubtitleTextStyle`、默认值、严格校验、渲染比例与字体解析类型，文件：`src/domain/subtitle-style.ts`
- [X] T008 实现 `translationSubtitleTextStyle` 的逐字段读取、单 key set+sync、raw 回滚与固定错误分类，文件：`src/adapters/iina/subtitle-style-preferences.ts`
- [X] T009 实现全部字幕样式请求、权威状态和结果消息的严格 parser/serializer，文件：`src/domain/messages.ts`
- [X] T010 实现单字段 intent、live/committed 状态、保存临界段、revision、superseded 与整组回退，文件：`src/adapters/iina/subtitle-style-sync.ts`
- [X] T011 将 preference 恢复、唯一写入者、样式 get/edit 广播和安全 save-result 接入 Global，文件：`src/global.ts`
- [X] T012 将权威快照 follower、单字段请求转发和 Sidebar 状态队列接入 Main，文件：`src/main.ts`

**检查点**：样式权威可在无 Sidebar、Overlay 或 native picker 的测试环境中独立恢复、合并、保存和回退完整八字段状态。

---

## 阶段 3：用户故事 1——自定义译文字体（优先级：P1）🎯 MVP

**目标**：在 `Subtitle`/Position 后提供 Font Color、Size、Font、Bold、Italic，当前真实译文立即按有效样式重排；字体选择支持确认、取消、不可用回退与自动恢复。

**独立测试**：显示真实译文后依次修改 Font 五项，确认控件和 Overlay 同步、Size 40 保持 29px@720p 基线、Position 不变；取消字体选择不改值，停用并恢复所选字体时偏好不变且 Overlay 自动回退/恢复。

### 测试（先写并确认失败）

- [X] T013 [P] [US1] 为 Font 五字段、per-field pending、fallback 状态和失败整组恢复编写 Sidebar 状态测试，文件：`tests/unit/sidebar-state.test.ts`
- [X] T014 [P] [US1] 为 Font 分组位置、Font Color trigger/基础预设、有限 Size、checkbox、Font button、label 与高对比度语义编写 DOM 契约测试，文件：`tests/contract/sidebar-form.test.ts`
- [X] T015 [P] [US1] 为 Font 编辑、确认/取消、busy、latest-only state 与安全错误编写 Sidebar 生命周期测试，文件：`tests/contract/sidebar-lifecycle.test.ts`
- [X] T016 [P] [US1] 为完整 style payload、九个 Size、360/720/1080 映射、字体 fallback 与重测编写 Overlay 状态测试，文件：`tests/unit/overlay-state.test.ts`
- [X] T017 [P] [US1] 为双层 DOM、字体 CSS、renderRevision、clear、无正文占位与 Position 回归编写 WebView 契约测试，文件：`tests/contract/overlay-webview.test.ts`
- [X] T018 [P] [US1] 为 helper ready frame、bearer 认证、font open/status、事件 revision、cancel/shutdown 与错误净化编写客户端契约测试，文件：`tests/contract/style-picker-client.test.ts`
- [X] T019 [P] [US1] 为严格协议、认证、字体筛选、family-only 确认/取消、目录 revision 和父进程退出编写 Swift 测试，文件：`native/style-picker/Tests/SubTandemStylePickerTests/ProtocolTests.swift` 与 `native/style-picker/Tests/SubTandemStylePickerTests/FontPickerTests.swift`
- [X] T020 [P] [US1] 为 Font 五字段即时预览、保存恢复、无当前译文与字体失效/恢复编写集成测试，文件：`tests/integration/subtitle-style-lifecycle.test.ts`

### 实现

- [X] T021 [US1] 实现单实例 authenticated HTTP server、严格 JSON、事件队列、parent PID、cancel 与 shutdown，文件：`native/style-picker/Sources/SubTandemStylePicker/Protocol.swift`, `native/style-picker/Sources/SubTandemStylePicker/Server.swift`, 与 `native/style-picker/Sources/SubTandemStylePicker/main.swift`
- [X] T022 [US1] 实现 family-only AppKit picker、固定本地 preview、键盘/无障碍语义、字体目录监听与 availability 查询，文件：`native/style-picker/Sources/SubTandemStylePicker/FontPicker.swift` 与 `native/style-picker/Sources/SubTandemStylePicker/FontCatalog.swift`
- [X] T023 [US1] 实现 helper 发现与启动、认证请求、long-poll、event gap 恢复、font open/status 和安全关闭，文件：`src/adapters/iina/style-picker-client.ts`
- [X] T024 [US1] 将 helper 单实例生命周期、Font picker session、确认/取消、availability 广播与安全失败接入 Global，文件：`src/global.ts`
- [X] T025 [US1] 在 Main 派生 effective family、即时更新当前真实译文并将 fallback/结果状态转发 Sidebar，文件：`src/main.ts`
- [X] T026 [US1] 实现 Font 五字段 display/committed/pending/feedback、stateRevision 和 groupError 状态机，文件：`ui/sidebar-state.ts`
- [X] T027 [US1] 在 Subtitle/Position 后添加 Font 分组、Font Color trigger 与可复用紧凑预设骨架、有限 Size、Font button 及 Bold/Italic 控件，文件：`ui/sidebar.html`
- [X] T028 [US1] 实现 Font Color 预设直接提交及其他 Font 控件的单字段 preview/commit、字体 picker 确认/取消、busy 与权威收敛，文件：`ui/sidebar.ts`
- [X] T029 [US1] 实现 Font 控件与紧凑预设的窄栏布局、focus-visible、亮暗色、forced-colors 与 prefers-contrast 外观，文件：`ui/sidebar.css`
- [X] T030 [US1] 将 Overlay 改为透明定位外层与收缩文字内层，并移除固定 shadow，文件：`ui/overlay.html` 与 `ui/overlay.css`
- [X] T031 [US1] 实现完整 style 严格解析、字号/字体/字重/斜体应用、latest-only rAF 与 ResizeObserver 重测，文件：`ui/overlay-state.ts` 与 `ui/overlay.ts`
- [X] T032 [US1] 让 Overlay adapter 缓存完整 style、共享 renderRevision、无正文只更新缓存并在 ready 后发送自包含 render，文件：`src/adapters/iina/webview-translation-overlay.ts`

**检查点**：US1 的 Font 五项可独立完成、保存、恢复和渲染；不需要 Border、Background 或系统颜色面板即可交付 MVP。

---

## 阶段 4：用户故事 2——增强译文与画面的分离度（优先级：P2）

**目标**：增加 Border Color、Border Width 和 Background Color，使描边可完全关闭，背景只覆盖译文文本块，并保持既有定位行为。

**独立测试**：在明暗混合画面显示单行、多行和自动换行译文，调整 Border Color/Width 与 Background Color；确认 Width 0 无描边/阴影、Width 3 保持 2px@720p 基线，背景不铺满 Overlay，Position 0/100 与 resize/fullscreen 仍正确。

### 测试（先写并确认失败）

- [X] T033 [P] [US2] 为 Border/Background 三字段、有限 Width、并行 pending 与失败恢复扩展 Sidebar 状态测试，文件：`tests/unit/sidebar-state.test.ts`
- [X] T034 [P] [US2] 为 Border/Background 分组、两个 Color trigger、Width 枚举、palette 目标隔离和生命周期扩展契约测试，文件：`tests/contract/sidebar-form.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T035 [P] [US2] 为全部十个 Width、三种 RGBA、Width 0、文字块背景和 Position 回归扩展 Overlay 测试，文件：`tests/unit/overlay-state.test.ts` 与 `tests/contract/overlay-webview.test.ts`
- [X] T036 [P] [US2] 为描边/背景即时预览、默认升级视觉、透明组合与无当前译文扩展集成测试，文件：`tests/integration/subtitle-style-lifecycle.test.ts`

### 实现

- [X] T037 [US2] 将 Border/Background display、committed、pending、colorTarget 与错误恢复加入 Sidebar 状态机，文件：`ui/sidebar-state.ts`
- [X] T038 [US2] 在 Font 后添加 Border Color/Width 与 Background Color trigger 及有限 Width 选项，文件：`ui/sidebar.html`
- [X] T039 [US2] 将紧凑预设复用于三个 Color target，并实现 Border/Background 的单字段 preview/commit、状态呈现和键盘可达样式，文件：`ui/sidebar.ts` 与 `ui/sidebar.css`
- [X] T040 [US2] 实现描边颜色/宽度、Width 0 关闭、文本块背景、alpha 与样式后重测，文件：`ui/overlay-state.ts`, `ui/overlay.ts`, 与 `ui/overlay.css`

**检查点**：US2 可在 US1 默认字体设置上独立验收，复杂画面中的描边与背景不改变内容、时序、Position 或 Overlay 非交互边界。

---

## 阶段 5：用户故事 3——通过色盘选择并长期复用样式（优先级：P3）

**目标**：三个 Color 共用紧凑色盘并可打开完整系统颜色面板；八字段跨 Sidebar、媒体、窗口和会话持久化，多窗口编辑按字段合并且失败整组回退。

**独立测试**：分别用预设色盘和 `Show Colors…` 修改 Font/Border/Background，确认目标隔离、alpha、未变化关闭和实时预览；交错操作两个窗口后重开 Sidebar、换片、新建窗口并重启 IINA，确认八字段一致且失败/乱序结果不回跳。

### 测试（先写并确认失败）

- [X] T041 [P] [US3] 为 color open、连续 preview、changed/unchanged close、busy、gap、cancel 与崩溃恢复扩展客户端契约测试，文件：`tests/contract/style-picker-client.test.ts`
- [X] T042 [P] [US3] 为 NSColorPanel 协议、sRGB RGBA 量化、alpha、连续事件、未变化关闭和单实例 busy 编写 Swift 测试，文件：`native/style-picker/Tests/SubTandemStylePickerTests/ColorPickerTests.swift`
- [X] T043 [P] [US3] 为 native palette session、per-field pending、远端收敛、superseded 和组级错误扩展状态测试，文件：`tests/unit/sidebar-state.test.ts`
- [X] T044 [P] [US3] 为三个色样、可读颜色值、共享 palette、Show Colors、Escape/焦点归还与高对比度扩展 Sidebar 契约测试，文件：`tests/contract/sidebar-form.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T045 [P] [US3] 为多窗口不同字段合并、同字段最后 intent、旧 panel 晚关闭、重开/换片/新窗口/重启和失败整组回退扩展集成测试，文件：`tests/integration/subtitle-style-lifecycle.test.ts`
- [X] T046 [P] [US3] 为 50 次全字段快速编辑、latest-only 预览、零回跳和零播放中断扩展性能测试，文件：`tests/integration/performance.test.ts`
- [X] T047 [P] [US3] 为 preference、消息、helper、错误和日志的正文隔离及无新增外网目的地编写安全测试，文件：`tests/security/subtitle-style-privacy.test.ts`, `tests/security/credential-leakage.test.ts`, 与 `tests/security/redaction.test.ts`

### 实现

- [X] T048 [US3] 实现共享 NSColorPanel、showsAlpha、continuous target/action、sRGB 量化与 changed/unchanged close，文件：`native/style-picker/Sources/SubTandemStylePicker/ColorPicker.swift`
- [X] T049 [US3] 实现 color open 与连续事件解析、gap/current-state 恢复和安全故障分类，文件：`src/adapters/iina/style-picker-client.ts`
- [X] T050 [US3] 实现全局唯一 Color picker session、target 本地映射、最后 preview intent 提交、busy/迟到拒绝和崩溃整组恢复，文件：`src/global.ts`
- [X] T051 [US3] 将 picker-result、全量权威 state、同字段 pending 清理和多窗口 Overlay 收敛接入 Main，文件：`src/main.ts`
- [X] T052 [US3] 完善 native color session、每字段 saving、superseded 清理、groupError 与八字段回退，文件：`ui/sidebar-state.ts`
- [X] T053 [US3] 为既有三个 Color trigger 补齐统一命名预设、透明项、选中标记和 Show Colors 入口，文件：`ui/sidebar.html`
- [X] T054 [US3] 实现 palette 定位与焦点管理、目标字段隔离、预设直接提交、系统面板连续预览和未变化关闭，文件：`ui/sidebar.ts`
- [X] T055 [US3] 实现色样的文本/alpha 状态、palette 键盘焦点、选中态、亮暗色与高对比度外观，文件：`ui/sidebar.css`

**检查点**：三个用户故事均可验收，所有窗口最终收敛到同一已确认样式，失败不会阻塞播放或泄漏正文。

---

## 阶段 6：完善与跨领域交付

**目的**：把第三 helper 纳入精确发布边界，更新用户/开发文档，并重新执行全部测试、编译、打包和正式包实机验收。

- [X] T056 [P] 为第三 helper 的 manifest 权限、精确包清单、universal/755/签名/系统依赖与源码排除编写失败契约测试，文件：`tests/contract/package-manifest.test.ts`
- [X] T057 [P] 为第三 helper 的 release audit、哈希与工作流门禁编写失败契约测试，文件：`tests/contract/release-audit.test.ts` 与 `tests/contract/release-workflow.test.ts`
- [X] T058 将 style-picker 的 Swift 测试、arm64/x86_64 构建、lipo、755、ad-hoc 签名与哈希纳入 native 脚本，文件：`scripts/test-native.sh` 与 `scripts/build-native.sh`
- [X] T059 更新第三 loopback helper 与 file-system 执行用途且不新增外网域或正文权限，文件：`Info.json`
- [X] T060 将 `dist/native/subtandem-style-picker` 纳入精确 verify/pack/release audit 与 CI 清单，文件：`scripts/verify-package.sh`, `scripts/pack.sh`, `scripts/audit-release.mjs`, 与 `.github/workflows/release.yml`
- [X] T061 更新样式设置、默认值、选色和字体 fallback 的用户说明，文件：`README.md`, `docs/readme/README.zh-CN.md`, `docs/readme/README.ar.md`, `docs/readme/README.fr.md`, `docs/readme/README.ja.md`, `docs/readme/README.ko.md`, 与 `docs/readme/README.ru.md`
- [X] T062 更新 helper 开发/重建说明和自动化、包、IINA 验收边界，文件：`docs/engineering/development.md`, `docs/validation/automated.md`, `docs/validation/package.md`, 与 `docs/validation/iina-matrix.md`
- [X] T063 按聚焦命令重跑全部字幕样式 Vitest 与 Swift 测试并修复失败，文件：`specs/021-subtitle-text-style/quickstart.md`
- [X] T064 重跑 `npm test`、`npm run typecheck`、`npm run lint` 和 `npm run test:native` 全量门禁，文件：`package.json`
- [X] T065 重跑 `npm run build:native`、`npm run build`、`npm run verify:package` 和 `npm run pack` 并审计正式归档，文件：`scripts/build-native.sh`, `scripts/build-plugin.sh`, `scripts/verify-package.sh`, 与 `scripts/pack.sh`
- [X] T067 修复 style-picker 父进程监视器的 Swift 并发队列隔离崩溃，并以真实后台定时回调回归颜色与字体共用生命周期，文件：`native/style-picker/Sources/SubTandemStylePicker/Protocol.swift`, `native/style-picker/Sources/SubTandemStylePicker/main.swift`, 与 `native/style-picker/Tests/SubTandemStylePickerTests/FontPickerTests.swift`
- [X] T068 依据 IINA 参考截图把 Text Style 收敛为单一低对比表面、紧凑行内字段、中性色样控件与网格色盘，并保留键盘、高对比度和字段可读值，文件：`ui/sidebar.html`, `ui/sidebar.css`, `tests/contract/sidebar-form.test.ts`, 与 `tests/contract/sidebar-lifecycle.test.ts`
- [X] T069 修复 Overlay 在 Position 100 的首次换行测量与描边可见边界，使实际绘制块底部不超出有效区域，文件：`ui/overlay-state.ts`, `ui/overlay.ts`, `tests/unit/overlay-state.test.ts`, 与 `tests/contract/overlay-webview.test.ts`
- [ ] T066 使用正式 `.iinaplgz` 在 IINA 1.4.0 与 1.4.4 完成 quickstart 的单人视觉、键盘、多窗口、字体恢复、时延、失败和卸载验收，并保存不含正文的证据，文件：`docs/validation/subtitle-text-style.md`

---

## 依赖与执行顺序

### 阶段依赖

- **准备（阶段 1）**：无依赖，可立即开始；T001 与 T002 修改不同文件。
- **基础（阶段 2）**：依赖阶段 1；T003–T006 先并行建立失败测试，随后按 T007 → T008/T009 → T010 → T011 → T012 完成共享权威链路。
- **US1（阶段 3）**：依赖阶段 2，是 MVP；native font、Sidebar Font 与 Overlay font 三条分支最终在 Main/Global 集成。
- **US2（阶段 4）**：执行上依赖 US1，因为两者串行修改 `ui/sidebar*` 与 `ui/overlay*`；验收时可只使用 US1 默认值验证描边和背景。
- **US3（阶段 5）**：依赖 US1 的 native/font session 基础与 US2 的三个 Color 字段；扩展同一 helper、Global/Main 与 Sidebar 热点文件。
- **完善（阶段 6）**：依赖全部选定用户故事；发布脚本与工作流由同一负责人按 T058 → T060 合并；T067–T069 修复正式包人工验收发现的当前规格偏差，完成后必须重新执行 T063–T065 的门禁并重新开始 T066。

### 用户故事完成图

```text
准备 → 基础 → US1（MVP）→ US2 → US3 → 正式交付
```

这里的串行顺序来自共享文件所有权与真实产品依赖，不表示 US2 的验收必须主动修改 US1，也不允许多个 Agent 在同一工作区并发编辑热点文件。若由多个 Agent 执行并行任务，必须使用隔离 worktree，并按上述合并顺序集成。

### 每个用户故事内部顺序

- 先完成该故事全部测试任务并确认测试因缺少目标行为而失败。
- 再按 domain/native → Global/Main → Sidebar/Overlay → 集成的依赖顺序实现。
- 在故事检查点运行其聚焦测试；不得用较早的测试、编译或包结果替代最终阶段重跑。

## 并行机会示例

### 用户故事 1

完成基础阶段后，可在隔离 worktree 中并行编写以下不同文件的失败测试，再按所有权顺序合并：

```text
T013 Sidebar state tests
T014 Sidebar form tests
T016 Overlay state tests
T018 style-picker client tests
T019 Swift font/protocol tests
T020 lifecycle integration tests
```

### 用户故事 2

完成 US1 后，可在隔离 worktree 中并行编写以下不同测试切片：

```text
T033 Sidebar state tests
T034 Sidebar form/lifecycle tests
T035 Overlay state/WebView tests
T036 lifecycle integration tests
```

### 用户故事 3

完成 US2 后，可在隔离 worktree 中并行编写以下不同测试切片：

```text
T041 style-picker client tests
T042 Swift color tests
T043 Sidebar state tests
T044 Sidebar form/lifecycle tests
T045 multi-window lifecycle tests
T046 performance tests
T047 privacy/security tests
```

## 实施策略

### MVP 优先（只交付用户故事 1）

1. 完成阶段 1 的 native package 与 runtime 类型准备。
2. 完成阶段 2 的样式模型、preference、消息和全局权威。
3. 完成阶段 3 的 Font 五项、字体 helper 与 Overlay 重排。
4. 停止并按 US1 独立测试标准验收；未获用户明确实施授权时不得进入代码实现。

### 增量交付

1. **基础 + US1**：交付可保存、即时预览且支持字体回退的最小字体样式能力。
2. **加入 US2**：增加描边和文本块背景，回归 Position 与非交互边界。
3. **加入 US3**：增加统一色盘、系统颜色面板、多窗口合并与跨会话复用。
4. **正式交付**：完成发布契约、文档、全量测试/编译/打包与正式包实机验收。

## 备注

- `[P]` 只表示文件与依赖允许并行；多 Agent 执行仍必须使用隔离 worktree。
- 生产 TypeScript、Swift、HTML 与 CSS 不新增注释，生产自然语言使用英语。
- 样式 preference、消息、helper、日志与验收证据不得包含字幕正文、译文、媒体路径、token、字体文件路径或凭据。
- 不修改 `specs/016-customize-overlay-position/` 或 `specs/018-subtandem-initial-release/` 的任何 SDD 产物。
- 任一实现范围扩展到新的用户能力、权限、网络目的地或其他规格时，必须停止并重新进入完整 SDD 决策。
