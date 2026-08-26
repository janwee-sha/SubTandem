# 实施计划：原生侧栏视觉与语言自动保存

**分支**：`017-native-sidebar-ui` | **日期**：2026-08-25 | **规格**：[spec.md](./spec.md)

**输入**：`specs/017-native-sidebar-ui/spec.md`

## 摘要

在现有 Sidebar WebView 内移除 `Save Languages`，由 Target Language 的 `change` 事件复用既有 `defaults:save` 请求链路；等待期间禁用选择器，成功后采用权威值与修订号，失败、取消或异常时恢复上一个已提交值。视觉层使用透明宿主表面上的全宽分区，移除宿主插件标签下的重复标题，把 Translate 合并到 Subtitle 标题行；仅 Profile 和 Session 保留无嵌套 blur 的低对比分组，并按 IINA/macOS 尺度收敛控件，其中 Position 显式使用宿主式细轨道与高圆角矩形旋钮，避免 WKWebView 默认 range 外观。Sidebar 进一步把反馈分为控件内 busy、权威界面状态、Profile Test/模型目录领域状态、可见异常和辅助技术播报：状态可自证的成功不占用可见布局，失败与部分成功仍在所属区域说明。

## 技术上下文

**语言与版本**：TypeScript 5.9.3、HTML5、CSS；生产目标 ES2020/ESNext；Node.js 24 与 npm 11 用于构建和测试。

**主要依赖**：IINA Plugin API 0.99.4、WKWebView、Parcel 2.16.4；不新增运行时或开发依赖。

**存储**：沿用 Global 独占写入的 IINA `targetLanguage` preference；不新增键、文件或数据迁移。

**测试**：Vitest 3.2.7、TypeScript 严格类型检查、ESLint、Prettier、Parcel 正式构建，以及开发者在 IINA 亮色和暗色外观下检查视觉层级、反馈分层和辅助技术语义。

**目标平台**：macOS 12+、IINA 1.4.0+ 的 Sidebar WebView；Apple Silicon 与 Intel 行为一致。

**项目类型**：跨 Sidebar、Main、Global 的桌面播放器插件；本切片只改变 Sidebar 的提交触发、视觉和反馈呈现，不修改既有跨运行时消息格式。

**性能目标**：用户操作后同步进入控件内 busy；每次有效选择只发送一个保存请求；反馈分层和视觉样式不增加轮询、计时器或网络活动。

**约束**：生产代码不新增注释且自然语言只用英语；保留 request ID/revision 校验、凭据与字幕隐私边界；不使用未经批准的浏览器控制或 Computer Use；宿主插件切换条和 WebView 外部材质不可修改。

**规模与范围**：5 个 Sidebar 生产文件、4 个聚焦测试文件、受影响功能的非任务当前意图 SDD 与本功能设计产物；不修改 Main、Global、Provider 实现、native helper、权限、消息字段或打包契约。

## 宪法检查

### Phase 0 前门禁

| 原则 | 结论 | 计划约束 |
| --- | --- | --- |
| I. 验证与产品安全 | 通过 | 自动化检查真实 HTML、CSS、Sidebar 状态转换、反馈可见性与既有消息链路；实机视觉保留开发者单人验收步骤。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | HTML、CSS 与 TypeScript 不新增注释，用户可见状态继续使用英语。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 只改变既有目标语言 preference 的触发时机；不新增字段、目的地、正文或凭据流。 |
| IV. 可重建且最小的发布产物 | 通过 | 不新增依赖或资源；正式构建继续由锁文件与现有脚本生成。 |
| V. 生产代码只实现当前功能需求 | 通过 | 删除显式保存 DOM、dirty 草稿、重复成功结果槽和对应兼容路径，不保留双触发或双呈现方式。 |
| VI. 版本化管理 | 通过 | 不在受版本控制文档中引用忽略的实机截图；人工步骤描述可复现的宿主状态。 |
| 工作协议：轻量双轨与当前意图 | 通过 | 因持久化和反馈交互变化使用完整 SDD；实施时收敛 007、013、014、016 非任务产物，保留各自 `tasks.md` 全部编号与完成状态。 |

不存在需豁免的门禁失败。

## 项目结构

### 本功能文档

```text
specs/017-native-sidebar-ui/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── sidebar-interaction.md
└── tasks.md
```

### 源码、测试与当前意图

```text
ui/
├── sidebar.html
├── sidebar.css
├── sidebar.ts
├── sidebar-state.ts
└── provider-status.ts

tests/contract/
├── sidebar-form.test.ts
├── sidebar-lifecycle.test.ts
└── ui-messages.test.ts

tests/unit/
└── sidebar-state.test.ts

specs/007-auto-language-support/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/target-language-preference.md

specs/013-local-openai-profile-ux/
specs/014-provider-model-discovery/
specs/016-customize-overlay-position/
```

**结构决策**：不新增视觉组件框架或状态模块。`sidebar.html` 增加单一视觉隐藏播报槽并保留异常状态区；`sidebar.ts` 连接选择事件、操作协调器和现有消息；`sidebar.css` 负责宿主适配及视觉隐藏；`sidebar-state.ts` 在保持请求归属的前提下区分辅助技术与可见反馈；`provider-status.ts` 只生成安全领域状态。007、013、014 与 016 的非任务 SDD 直接改写为当前意图，既有已完成任务清单不修改。

## Phase 0 研究结论

实现决策、替代方案和宿主边界见 [research.md](./research.md)。技术上下文不存在未解决项。

## Phase 1 设计

- 状态字段、反馈分层和转换见 [data-model.md](./data-model.md)。
- 自动保存与视觉契约见 [sidebar-interaction.md](./contracts/sidebar-interaction.md)。
- 自动化和人工验证路径见 [quickstart.md](./quickstart.md)。

### 设计后宪法复核

| 原则 | 结论 | 设计证据 |
| --- | --- | --- |
| I | 通过 | 契约覆盖单请求、成功提交、失败回滚、迟到拒绝、反馈唯一呈现、视觉适配与不变行为。 |
| II | 通过 | 设计没有要求生产注释或非英语生产文案。 |
| III | 通过 | 数据模型只包含语言 ID、revision 和 request ID，不新增敏感数据。 |
| IV | 通过 | 方案只修改现有源码和测试，不引入交付资源。 |
| V | 通过 | 显式保存按钮、dirty 草稿、可见重复成功消息和双路径均从目标状态移除。 |
| VI | 通过 | 契约与验证不依赖忽略文件，可由任一干净检出执行。 |

设计后仍无门禁失败或复杂度豁免。
