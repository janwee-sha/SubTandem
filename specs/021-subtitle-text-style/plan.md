# 实现计划：字幕文本样式设置

**功能目录**：`021-subtitle-text-style`

**Git 分支**：`feat/subtitle_text_style`

**日期**：2026-09-01

**规格**：[spec.md](./spec.md)

## 摘要

在 Sidebar 的 `Subtitle` 区域、现有 Position 之后增加 Font、Border 与 Background 三组八项样式控件。Global 以单字段 intent 合并全部窗口的预览，以单一 JSON preference 保存并整组回退样式，并用 intent/state/committed 三类序号拒绝过期结果；Main 立即更新当前窗口，再由 Global 广播使其他窗口收敛。紧凑色盘由 Sidebar 实现；完整系统颜色面板、字体族筛选与字体可用性监听由新增的单实例 Swift/AppKit `subtandem-style-picker` 提供。Overlay 改为透明定位器与收缩文字块两层 DOM，按规格比例映射字号和描边，在每次样式变化后重新测量并沿用既有 Position 布局。

## 技术上下文

- **语言与版本**：Node.js 24、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、HTML/CSS；Swift 6、macOS AppKit/Core Text。
- **主要依赖**：IINA Plugin API 0.99.4、Parcel 2.16.4、Vitest 3.2.7；native helper 只链接 AppKit、CoreText、Network 与 Security 系统框架，不新增第三方依赖。
- **存储**：IINA plugin preference `translationSubtitleTextStyle` 保存一份八字段 JSON 字符串；颜色为 sRGB RGBA 四通道 0 至 255 整数，字体保存请求的 family，预览、picker session、字体可用性与序号只存在于运行期。
- **测试**：Vitest 单元、契约、集成、安全与性能测试；Swift helper 协议和纯逻辑测试；正式构建、native universal 构建、包验证与归档审计；开发者一人在 IINA 1.4.0 与 1.4.4 完成人工验收。
- **目标平台**：macOS 12+，arm64 与 x86_64；IINA 1.4+。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、非交互式 Overlay WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：50 次覆盖全部字段的有效调整中至少 95% 在 200 毫秒内显示最新预览；快速样式更新不产生布局回跳、过期保存覆盖或播放中断。
- **约束**：Size 与 Width 仅接受规格枚举并分别按 `29/40`、`2/3` 映射；Width 0 不得残留描边或阴影；颜色统一转换为 sRGB 且保留 alpha；Global 是唯一 preference 写入者；保存失败整组回退；字体不可用不改写偏好；helper 与样式消息不得接收字幕正文或访问外网；Overlay 继续不可交互、禁用网络与 storage；生产代码不新增注释且自然语言使用英语。
- **规模与范围**：一个全局样式 preference、八个字段、三个 Color 入口、一个全局 native picker、任意当前播放窗口及其 Sidebar/Overlay；不修改 IINA 原字幕、Position 偏好、翻译链路或正文生命周期。

## 宪法检查

*阶段 0 前与阶段 1 后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 自动化直接覆盖生产校验、消息、合并、回滚、Overlay 样式和 helper 协议；系统面板、字体恢复、视觉、键盘、多窗口与宿主行为保留单人正式包验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新增 TS、Swift、HTML、CSS、manifest 文案均使用英语且不新增生产注释；本目录 SDD 使用中文。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | preference、picker、错误和 Global 样式消息只含样式值；helper 仅绑定认证的 `127.0.0.1`，不接收字幕正文、不持久化数据、不访问外网。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | 新 helper 由仓库 Swift 源码构建为 macOS 12 arm64/x86_64 universal、签名并纳入哈希、精确 allowlist、包与 release audit；只链接系统框架。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | helper 只提供完整颜色面板、字体族选择与可用性通知；不增加主题、预设、导入导出、按媒体样式或通用 native UI 框架。 |
| VI. 版本化管理 | 通过 | 通过 | 样式源码、helper、协议、构建和包清单全部纳入版本控制，不引用本地私有资源。 |
| VII. 规格边界隔离 | 通过 | 通过 | 只修改 021 SDD；016 的固定样式描述与 018 的双 helper 清单仅作为跨规格风险记录，不改写其产物。021 渲染和 helper 契约分别成为本功能范围的当前增量契约。 |
| 工作协议：完整 SDD、中文优先、并行边界与人工成本 | 通过 | 通过 | 变更跨 Global/Main/两个 WebView/native/打包，采用完整 SDD；共享入口、消息、构建与 release 文件在实现阶段串行负责；实机验收只需一名开发者。 |

## 架构与所有权

```text
Sidebar controls
  -> Main optimistic style cache -> current Overlay
  -> Global style authority -> JSON preference
       -> broadcast full live/committed state -> every Main -> Sidebar + Overlay
       -> authenticated loopback -> subtandem-style-picker
            -> NSColorPanel / family-only font panel / font catalog notifications
```

- Global 独占持久样式、全局 intent 顺序、每字段最后 intent、整组 commit revision、picker session 和 helper 生命周期；重复 picker 请求只前置当前活动窗口，不创建冲突会话或错误反馈。
- Main 只拥有当前播放器的 follower、Sidebar 快照和 Overlay effective style；本地有效编辑先作用于当前真实译文，再转发 Global。
- Sidebar 只提交单字段值，不发送整组快照；每字段独立维护交互、等待和反馈，组级错误承载整组回退；紧凑色盘在外部点击或 WebView 失焦时关闭，例行保存只由控件 busy/final 状态表达。
- Overlay 只接收完整规范化样式、Position/区域和当前真实译文；字体可用性由 Main 映射为 effective family，WebView 不读 preference 或系统字体目录。
- native helper 只处理 picker UI、字体目录和安全协议，不写 preference、不读取媒体或字幕、不接触 Provider/凭据。

## 项目结构

### 本功能文档

```text
specs/021-subtitle-text-style/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── sidebar-style-controls.md
│   ├── style-picker-helper.md
│   ├── subtitle-style-messages.md
│   └── subtitle-style-rendering.md
└── checklists/
    └── requirements.md
```

### 源码、native 与验证

```text
src/
├── adapters/iina/
│   ├── style-picker-client.ts
│   ├── subtitle-style-preferences.ts
│   ├── subtitle-style-sync.ts
│   └── webview-translation-overlay.ts
├── domain/
│   ├── messages.ts
│   └── subtitle-style.ts
├── global.ts
├── main.ts
└── types/iina-runtime.d.ts

ui/
├── overlay-state.ts
├── overlay.ts
├── overlay.html
├── overlay.css
├── sidebar-state.ts
├── sidebar.ts
├── sidebar.html
└── sidebar.css

native/style-picker/
├── Package.swift
├── Sources/SubTandemStylePicker/
└── Tests/SubTandemStylePickerTests/

tests/
├── contract/
├── integration/
├── security/
└── unit/

scripts/
├── build-native.sh
├── test-native.sh
├── verify-package.sh
├── pack.sh
└── audit-release.mjs

.github/workflows/release.yml
Info.json
README.md
docs/readme/
docs/engineering/development.md
docs/validation/
```

**结构决策**：新增独立 AppKit helper，而不把 UI 生命周期并入持有凭据和外网能力的 transport；Global 复用现有认证 loopback 启动模式并独占 picker 与持久化顺序。样式 domain、preference 和 authority 与 IINA adapter 分离，便于直接测试严格校验和竞态。Overlay 继续使用现有页面与统一 `renderRevision`，只把完整样式加入 layout/render 快照，不新增第二条样式通道。

## 设计产物

- [research.md](./research.md)：固化存储、全局合并、AppKit picker、字体恢复、Overlay 映射、无障碍、隐私与打包决策。
- [data-model.md](./data-model.md)：定义八字段样式、字体可用性、编辑 intent、权威状态、picker session 与 Sidebar 状态转换。
- [subtitle-style-messages.md](./contracts/subtitle-style-messages.md)：约束 Sidebar、Main、Global 与 Overlay 的严格消息、序号和失败语义。
- [style-picker-helper.md](./contracts/style-picker-helper.md)：约束 native helper 的启动、认证 loopback、颜色/字体事件与生命周期。
- [sidebar-style-controls.md](./contracts/sidebar-style-controls.md)：约束三组控件、色盘、反馈、键盘和多窗口收敛。
- [subtitle-style-rendering.md](./contracts/subtitle-style-rendering.md)：约束 CSS 映射、文本块背景、字体 fallback、重排与正文边界。
- [quickstart.md](./quickstart.md)：定义聚焦自动化、完整门禁、正式包与单人 IINA 验收。

## 跨规格边界

- `specs/016-customize-overlay-position` 中“固定样式、不得配置”的描述是该位置功能当时的边界；021 实施后，位置公式与有效区域继续由 016 负责，样式值与重排由本目录契约负责。本次不修改 016 产物。
- `specs/018-subtandem-initial-release` 的包契约记录了当时两个 native helper；021 新增第三个 helper 后，本目录 [style-picker-helper.md](./contracts/style-picker-helper.md) 负责新增产物的当前增量约束。本次不修改 018 产物。
- 实现阶段必须更新共享构建、精确包清单、release audit、工作流和用户/开发文档；不得以同步旧规格为由编辑其他规格目录。

## 复杂度跟踪

无宪法例外。新增单一 AppKit helper 是在 IINA Plugin API 不提供原生颜色/字体面板、WKWebView 又无法可靠枚举字体或保留系统颜色 alpha 的条件下满足当前需求的最小组件；它不接触正文、凭据或外网，也不形成通用 UI 平台。
