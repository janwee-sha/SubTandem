---
description: "自定义译文浮层垂直位置的可执行任务"
---

# 任务：自定义译文浮层垂直位置

**输入**：`specs/016-customize-overlay-position/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格与项目宪法要求自动化回归；各故事先编写并确认聚焦测试失败，再实现生产行为。IINA 宿主行为由一名开发者使用正式包验收。

**组织方式**：任务按用户故事分组；共享消息、状态和测试端口先落在基础阶段。标记 `[P]` 的任务只修改不同文件且不依赖同阶段未完成任务。

## 阶段 1：准备共享运行时

**目标**：登记 Overlay 构建入口，并补齐后续测试和实现所需的宿主类型与假实现。

- [X] T001 在 `package.json` 增加以 `ui/overlay.html` 为源码、输出到 `dist/ui` 且使用相对资源 URL 的 Parcel Overlay target
- [X] T002 [P] 在 `src/types/iina-runtime.d.ts` 补充 `iina.overlay` WebView、非交互设置、消息、显示隐藏及所需窗口和 mpv 几何事件类型
- [X] T003 [P] 在 `tests/helpers/fake-iina.ts` 增加可观测的 Overlay WebView、preferences、Global 广播、窗口状态和几何事件测试端口，且不改变既有假播放器行为

---

## 阶段 2：基础位置契约与权威状态

**目标**：建立全部用户故事共享的严格消息、偏好回滚、位置校验和 latest-only 状态机。

**关键门禁**：本阶段完成前不得开始用户故事实现。

### 先行测试

- [X] T004 [P] 在 `tests/contract/package-manifest.test.ts` 增加先失败的契约，约束 `Info.json` 仅新增 `video-overlay`、包含英文用途说明和默认位置 0
- [X] T005 [P] 在 `tests/contract/overlay-position-messages.test.ts` 增加先失败的严格 envelope、preview/save/get/state/save-result 白名单、整数范围和正文排除测试
- [X] T006 [P] 在 `tests/contract/overlay-position-preferences.test.ts` 增加先失败的缺失/无效值回退、仅保存整数、`set + sync` 失败恢复原值及安全错误测试
- [X] T007 [P] 在 `tests/unit/overlay-position.test.ts` 增加先失败的 0 至 100 校验、默认值、有效区域归一化、宿主 margin 回退和无效几何测试
- [X] T008 [P] 在 `tests/unit/overlay-position-sync.test.ts` 增加先失败的 intent sequence、commit revision、preview/commit/revert、旧状态忽略和较新失败回退测试

### 基础实现

- [X] T009 [P] 在 `Info.json` 声明 `video-overlay` 英文权限用途并添加 `translationOverlayPosition: 0`，保持其余权限、域名和偏好默认值不变
- [X] T010 [P] 在 `src/domain/overlay-position.ts` 实现位置整数校验、默认值、有效区域及有限宿主几何和 margin 归一化
- [X] T011 在 `src/domain/messages.ts` 实现 `overlay-position:preview/save/get/state/save-result` 与 `overlay:ready/layout/render/clear` 的严格解析和安全类型
- [X] T012 在 `src/adapters/iina/overlay-position-preferences.ts` 实现全局偏好读取、默认回退、唯一整数写入、同步失败恢复和固定安全错误，复用 `src/domain/overlay-position.ts` 的整数校验
- [X] T013 在 `src/adapters/iina/overlay-position-sync.ts` 实现 Global 权威状态及 Main latest-only 应用状态机，依赖 `src/domain/overlay-position.ts`

**检查点**：共享契约与状态机可由聚焦测试独立验证，用户故事实现可以开始。

---

## 阶段 3：用户故事 1——拖动位置条并实时预览（P1）🎯 MVP

**目标**：Sidebar 以 0 至 100 原生 range 实时预览当前真实译文，完成交互时自动保存并在失败时安全回退。

**独立测试**：当前窗口显示真实译文时依次输入 0、50、100，range、整数输出和 Overlay 同步且单调向下；无当前译文时不生成正文，同一次交互结束只保存一次。

### 先行测试

- [X] T014 [P] [US1] 在 `tests/contract/overlay-webview.test.ts` 增加先失败的本地 classic script、CSP、text node、无 storage/网络和非交互 Overlay 契约测试
- [X] T015 [P] [US1] 在 `tests/contract/sidebar-form.test.ts` 增加先失败的原生 range、整数输出、可访问关联、相邻 live status 和无 Save 按钮测试
- [X] T016 [P] [US1] 在 `tests/unit/overlay-state.test.ts` 增加先失败的 DOM 实际块高、底部锚点、顶部钳制、端点、单调性、超高裁切和无效 offset 测试
- [X] T017 [P] [US1] 在 `tests/unit/sidebar-state.test.ts` 增加先失败的 input 预览、交互结束单次保存、request/sequence 过滤、成功反馈和失败回退测试
- [X] T018 [P] [US1] 在 `tests/integration/overlay-webview-lifecycle.test.ts` 增加先失败的 ready 前单帧缓存、render/layout/clear latest-only、空正文不渲染和加载失败不阻塞测试
- [X] T019 [P] [US1] 在 `tests/integration/performance.test.ts` 增加先失败的连续 101 个输入无回跳、无反向及 100/200 毫秒预览预算测试

### 实现

- [X] T020 [P] [US1] 在 `ui/overlay-state.ts` 实现 render revision、真实块高测量输入、边距换算、底部锚定、顶部钳制和有限布局签名去重
- [X] T021 [P] [US1] 在 `ui/overlay.html` 建立只含当前译文容器、本地 classic script/CSS 和禁止连接及远程图片的 CSP
- [X] T022 [P] [US1] 在 `ui/overlay.css` 复现与 010 `osd-overlay` 接近的白色固定视觉、2/720 黑色描边、横向居中、智能换行和可见边界裁切
- [X] T023 [US1] 在 `ui/overlay.ts` 接收严格 render/layout/clear 消息，以 text node 渲染当前真实行、DOM 测量后定位、resize 重排并发送空 payload ready
- [X] T024 [P] [US1] 在 `src/adapters/iina/webview-translation-overlay.ts` 实现每播放器单 Overlay 的本地加载、`setClickable(false)`、show/hide、ready 缓存和 latest-only 消息投递
- [X] T025 [P] [US1] 在 `ui/sidebar-state.ts` 增加位置控件的 display/committed/sequence/revision/interaction/pending/feedback 状态及过时结果过滤
- [X] T026 [P] [US1] 在 `ui/sidebar.html` 的 `Subtitle` 区域加入标签为 `Position` 的原生 range、整数输出和相邻 polite 状态节点
- [X] T027 [P] [US1] 在 `ui/sidebar.css` 增加位置控件的窄 Sidebar 换行、可见数值和反馈布局，避免 range 或文本截断
- [X] T028 [US1] 在 `ui/sidebar.ts` 实现原生整数读取、`input` 本地更新与 preview、`change` 和窗口级拖动结束信号共享的唯一 save、反馈显示及安全回退
- [X] T029 [P] [US1] 在 `src/global.ts` 接入位置权威状态、preview/save intent 排序、唯一 preference 写入、提交/回退广播和源窗口安全结果
- [X] T030 [US1] 在 `src/main.ts` 转发 Sidebar 位置消息、应用 Global state、维护当前真实译文帧，并用 `webview-translation-overlay.ts` 替换 ASS 显示入口
- [X] T031 [US1] 删除 `tests/integration/subtitle-overlay.test.ts` 的 ASS 适配器契约，并在 `tests/unit/translation-overlay.test.ts` 移除 ASS 编码断言但保留当前译文选择回归
- [X] T032 [US1] 按 `specs/016-customize-overlay-position/quickstart.md` 运行 US1 聚焦测试并确认失败用例已转绿且既有播放/翻译测试无回归

**检查点**：US1 可单独演示拖动、键盘调整、实时预览、自动保存和失败回退，是建议 MVP。

---

## 阶段 4：用户故事 2——以后继续使用所选位置（P2）

**目标**：最后成功值在 Sidebar 重开、换片、窗口重建和 IINA 重启后恢复；缺失或无效值始终安全回退 0。

**独立测试**：保存一个非默认值后重建 Sidebar、Main 和 Global 测试夹具，控件与下一条真实译文恢复相同值；缺失、非整数及越界偏好均显示 0 且不自动写盘。

### 先行测试

- [X] T033 [P] [US2] 在 `tests/contract/sidebar-lifecycle.test.ts` 增加先失败的 snapshot hydrate、Sidebar 重开、较新 intent 不被 `ui:poll` 覆盖和无效快照回退测试
- [X] T034 [P] [US2] 在 `tests/integration/overlay-lifecycle.test.ts` 增加先失败的换片、窗口重建、Global 重建、已保存值恢复及未配置默认 0 测试

### 实现

- [X] T035 [P] [US2] 在 `src/global.ts` 从 `overlay-position-preferences.ts` 恢复 committed/live 初值，并实现仅回复源 player 的 `overlay-position:get` snapshot
- [X] T036 [P] [US2] 在 `src/main.ts` 于显示前请求位置快照、以安全默认 0 启动、在换片和窗口生命周期中保留位置但清理正文
- [X] T037 [P] [US2] 在 `ui/sidebar-state.ts` 与 `ui/sidebar.ts` 实现权威 snapshot hydrate、重开恢复和不覆盖较新本地/远端 intent 的轮询收敛
- [X] T038 [US2] 按 `specs/016-customize-overlay-position/quickstart.md` 运行 US2 偏好与生命周期聚焦测试，确认默认回退不写盘且重建恢复率为 100%

**检查点**：US1 与 US2 组合后形成可长期使用的全局位置偏好。

---

## 阶段 5：用户故事 3——不同播放状态下保持相对位置（P3）

**目标**：多窗口、resize、全屏和黑边配置变化只重排当前真实帧；所有窗口 latest-only 收敛，Overlay 不接收播放器输入。

**独立测试**：两个播放窗口共享一个位置值，在窗口/全屏、有无黑边、宿主 margin 两态和多次 resize 中按各自有效区域重排；无正文窗口保持空，点击相关能力保持禁用。

### 先行测试

- [X] T039 [P] [US3] 在 `tests/unit/overlay-position.test.ts` 增加先失败的 `osd-dimensions` 视频区域、全屏 margin 开关、无黑边等价和无效几何恢复测试
- [X] T040 [P] [US3] 在 `tests/unit/overlay-state.test.ts` 增加先失败的 viewport/区域/边距变化重排、相同签名去重、多行向上扩展和 clear 后不复活测试
- [X] T041 [P] [US3] 在 `tests/integration/overlay-lifecycle.test.ts` 增加先失败的双窗口 preview/save 交错、迟到成功/失败、resize/全屏/seek/禁用/关闭和无正文窗口测试
- [X] T042 [P] [US3] 在 `tests/security/overlay-position-privacy.test.ts` 增加先失败的消息、preferences、日志、文件、storage、网络、字幕轨及输入监听边界测试

### 实现

- [X] T043 [P] [US3] 在 `src/adapters/iina/webview-translation-overlay.ts` 增加当前帧缓存清理、几何 revision、Overlay ready/resize 重放及 load/show 失败隔离
- [X] T044 [US3] 在 `src/main.ts` 统一读取 `osd-dimensions`、字幕 margin、`sub-use-margins` 与全屏状态，监听规划事件并只重排仍属当前会话的帧
- [X] T045 [P] [US3] 在 `src/global.ts` 使用 deferred `postMessage(null, ...)` 向全部 Main 广播 preview/committed/reverted，并保证跨窗口 sequence latest-only
- [X] T046 [P] [US3] 在 `ui/overlay-state.ts` 与 `ui/overlay.ts` 完成 viewport、有效区域和实际换行块高变化时的安全重排，clear 后不恢复 DOM 正文
- [X] T047 [US3] 按 `specs/016-customize-overlay-position/quickstart.md` 运行 US3 几何、多窗口、生命周期与隐私聚焦测试，确认正文外泄、过期恢复和输入监听均为 0

**检查点**：三个用户故事均可按各自独立测试标准验收。

---

## 阶段 6：打包、文档与跨故事验收

**目标**：移除旧 ASS 双路径，把 Overlay 资源纳入可重建正式包，并完成自动化和单人宿主验收。

- [X] T048 [P] 更新 `tests/contract/package-manifest.test.ts` 与 `tests/contract/release-audit.test.ts`，先加入正式包 Overlay 资源、classic script、CSP、最小权限和旧 `osd-overlay` 路径不存在的失败契约
- [X] T049 更新 `scripts/build-plugin.sh`、`scripts/verify-package.sh`、`scripts/pack.sh` 与 `scripts/audit-release.mjs`，使 T048 转绿：构建并精确校验 Overlay HTML/生成资源，同时继续拒绝源码、测试、运行目录和敏感材料
- [X] T050 [P] 更新 `README.md`、`docs/readme/README.ar.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.ru.md`、`docs/readme/README.zh-CN.md` 与 `docs/engineering/development.md`，准确披露本地非交互式 `video-overlay` 权限且不声称支持画面拖动
- [X] T051 按 `specs/016-customize-overlay-position/quickstart.md` 运行全部列出的 Vitest 聚焦测试，并确认生产代码、旧 ASS 测试和测试清单一致
- [X] T052 严格按 `specs/016-customize-overlay-position/quickstart.md` 依次运行 `npm test`、typecheck、lint、native 构建/测试、插件构建、包验证和 pack，生成同一候选 `.iinaplgz`
- [X] T053 由一名开发者按 `specs/016-customize-overlay-position/quickstart.md` 在 IINA 1.4.0 与 1.4.4 验收权限、定位、延迟、黑边、多窗口、生命周期、与 `osd-overlay` 接近的字号和字重视觉、播放器输入；仅在实际通过后把包 SHA-256 与环境证据写入 `docs/validation/iina-matrix.md`
- [X] T054 在 `tests/unit/overlay-state.test.ts` 与 `tests/contract/overlay-webview.test.ts` 增加 360p、720p、1080p 字号和描边等比缩放回归，并确认测试先失败
- [X] T055 在 `ui/overlay-state.ts`、`ui/overlay.ts` 与 `ui/overlay.css` 以 Overlay 实际 viewport 高度明确应用字号和 2/720 描边，避免依赖正式构建转换 CSS 乘除表达式
- [X] T056 运行 Overlay 聚焦测试、016 快速验证中的全部自动化、typecheck、lint、正式构建与包验证，确认候选包保留 010 固定视觉契约后再执行 T053
- [X] T057 在 `tests/unit/overlay-state.test.ts` 与 `tests/contract/overlay-webview.test.ts` 增加 29/720 CSS 字号、400 字重及 2/720 描边的视觉校准回归，并确认测试先失败
- [X] T058 在 `ui/overlay-state.ts`、`ui/overlay.ts` 与 `ui/overlay.css` 应用 29/720 CSS 字号和 400 字重，同时保持 2/720 描边不变
- [X] T059 运行 Overlay 聚焦测试、016 自动化、typecheck、lint、正式构建、包验证与 pack，生成供 T053 继续验收的同一候选包
- [X] T060 同步 `spec.md`、`plan.md`、`research.md`、`data-model.md`、渲染契约与 `quickstart.md`，把 29/720 CSS 字号、400 字重及与 010 `osd-overlay` 视觉接近的验收基线纳入 016 当前 SDD

---

## 阶段 7：Sidebar 文案与触控板纯拖动保存

**目标**：设置区使用最终文案，并让 WKWebView 未发出 `change` 的触控板纯拖动在结束时仍只保存一次最终值。

- [X] T061 同步 `spec.md`、`plan.md`、`research.md`、`data-model.md`、Sidebar 契约、`quickstart.md` 与需求清单，纳入 `Subtitle`/`Position` 文案及触控板纯拖动完成语义
- [X] T062 在 `tests/contract/sidebar-form.test.ts` 与 `tests/unit/sidebar-state.test.ts` 增加先失败的最终文案、窗口级拖动结束信号、纯拖动保存和重复结束信号去重回归
- [X] T063 在 `ui/sidebar.html`、`ui/sidebar-state.ts` 与 `ui/sidebar.ts` 实现 `Subtitle`/`Position` 文案，以及 `change`、`pointerup`、`pointercancel`、`mouseup`、`touchend` 共用的按交互状态去重保存入口
- [X] T064 运行 Sidebar 聚焦测试、016 全部聚焦自动化、`npm test`、typecheck、lint、正式构建与包验证，确认纯拖动最终值可持久化且原有位置同步、失败回滚和 Overlay 非交互边界不变

---

## 阶段 8：原生字幕端点对齐

**目标**：修复人工验收发现的 0、100 端点向画面内侧收缩，使译文使用 IINA 原生字幕 margin 与 libass `sub-pos` 的非对称端点语义。

- [X] T065 同步 `spec.md`、`plan.md`、`research.md`、`data-model.md`、渲染契约与 `quickstart.md`，以 IINA `sub-margin-x/y` 和 libass 顶部无 MarginV、底部保留 MarginV 的公式描述当前意图
- [X] T066 在 `tests/unit/overlay-state.test.ts`、`tests/unit/overlay-position.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts` 增加先失败的 0/100 端点、IINA 字幕 margin 默认/offset 和 Main 属性监听回归
- [X] T067 在 `src/domain/overlay-position.ts`、`ui/overlay-state.ts` 与 `src/main.ts` 实现原生字幕 margin 读取、归一化和非对称端点定位
- [X] T068 运行 016 聚焦自动化、`npm test`、typecheck、lint、正式构建、包验证与 pack，生成供 T053 重新验收的候选包

---

## 阶段 9：宿主几何与关闭安全

**目标**：隔离单项 mpv 属性读取失败，可靠检测宿主 node/flag 动态输入，并在 mpv shutdown 或窗口关闭前停止几何读取。

- [X] T069 同步 `spec.md`、`plan.md`、`research.md`、`data-model.md`、渲染契约、`quickstart.md` 与 `tasks.md`，纳入独立几何缓存、普通 resize 不读取 mpv 和关闭期监听解除约束
- [X] T070 在 `tests/unit/overlay-region-runtime.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts` 增加先失败的单项读取隔离、缓存全屏重排、关闭后零读取、普通 resize 零 mpv 访问和监听解除回归
- [X] T071 在 `src/adapters/iina/overlay-region-runtime.ts` 与 `src/main.ts` 实现逐项缓存、属性级刷新、全屏事件状态重排、关闭期停用与几何监听解除
- [X] T072 运行 016 聚焦自动化、`npm test`、typecheck、lint、native 构建/测试、正式构建、包验证与 pack，生成供 T053 重新验收的候选包
- [X] T073 在 `tests/unit/overlay-region-runtime.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts` 增加先失败的动态黑边配置、有效区域去重、shutdown 与关闭期停止读取回归
- [X] T074 在 `src/adapters/iina/overlay-region-runtime.ts` 与 `src/main.ts` 实现 `osd-dimensions`、`sub-use-margins` 的 100 毫秒变化检测及 shutdown/close 幂等清理
- [X] T075 运行 016 聚焦自动化、完整门禁与 pack，并使用阶段 9 候选包在 IINA 1.4.4 验收黑边配置连续切换和退出安全

---

## 依赖与执行顺序

### 阶段依赖

- 阶段 1 无依赖。
- 阶段 2 依赖阶段 1，并阻塞全部用户故事。
- US1 依赖阶段 2，是可交付 MVP。
- US2 依赖 US1 的控件、保存与 Overlay 基线，但可用自身重建场景独立验收。
- US3 依赖 US1 的渲染基线和 US2 的权威恢复基线，但可用几何与多窗口矩阵独立验收。
- 阶段 6 依赖计划交付的全部用户故事；正式包实机验收必须在自动化门禁和候选包生成后执行。
- 阶段 7 依赖既有 Sidebar 位置状态；T062 必须先失败，T063 转绿后才能执行 T064。T053 的正式包实机验收还必须覆盖阶段 7 的两种拖动方式。
- 阶段 8 来自 T053 的端点验收失败；T066 必须先失败，T067 转绿后执行 T068，T053 必须使用阶段 8 生成的新候选包重新验收。
- 阶段 9 依赖阶段 8；T070、T073 的测试必须先失败，对应实现转绿后执行候选包验证。T053 必须使用阶段 9 最新候选包重新覆盖黑边和关闭生命周期。

### 用户故事依赖图

```text
准备（阶段 1）→ 基础契约（阶段 2）→ US1（P1 / MVP）→ US2（P2）→ US3（P3）→ 打包与验收
```

### 故事内顺序

- 先完成并确认本故事的测试任务失败，再开始生产实现。
- 纯状态与契约先于运行时入口；Overlay/Sidebar 叶文件先于 `src/main.ts` 和 `src/global.ts` 热点集成。
- 每个故事完成聚焦验证后，方可进入依赖它的下一故事。

## 并行机会示例

并行执行必须使用隔离 worktree 或等效隔离工作区，并按下列文件所有权切片；`src/main.ts`、`src/global.ts`、`ui/sidebar.ts` 和发布脚本同一时间各只有一个负责人。

### US1

```text
负责人 A：T020-T023（ui/overlay-*）
负责人 B：T025-T028（ui/sidebar-*）
负责人 C：T024（src/adapters/iina/webview-translation-overlay.ts）
集成负责人：待 A/B/C 完成后串行执行 T029-T031
```

### US2

```text
负责人 A：T035（src/global.ts）
负责人 B：T036（src/main.ts）
负责人 C：T037（ui/sidebar-state.ts、ui/sidebar.ts）
集成负责人：三方按消息契约完成后执行 T038
```

### US3

```text
负责人 A：T043（WebView Overlay 适配器）
负责人 B：T045（Global 广播）
负责人 C：T046（Overlay UI 重排）
集成负责人：T043 完成后串行执行 T044，再执行 T047
```

## 实施策略

### MVP 优先

1. 完成阶段 1 和阶段 2。
2. 完成 US1 的测试、实现和聚焦验证。
3. 停止并按 US1 独立测试演示 0、50、100、无当前译文和保存失败场景。

### 增量交付

1. US1 交付实时预览与自动保存。
2. US2 增加跨 Sidebar、媒体、窗口和 IINA 生命周期恢复。
3. US3 增加几何、全屏黑边、多窗口和非交互宿主保证。
4. 最后统一完成打包、文档、完整门禁和正式包实机验收。

## 说明

- `[P]` 只表示契约稳定后可按文件边界并行，不授权多个执行者共享修改同一工作区热点文件。
- 生产代码不得新增注释，自然语言使用英语；SDD 与项目文档使用中文。
- 本任务清单只描述当前目标；实施验收后按顺序把对应任务标记为 `[X]`，不得删除、压缩或重新编号。
- 本阶段不执行实现；进入实施仍需用户明确授权。
