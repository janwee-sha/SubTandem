# 实现计划：自定义译文浮层垂直位置

**分支**：`016-customize-overlay-position` | **日期**：2026-08-24 | **规格**：[spec.md](./spec.md)

## 摘要

在 Sidebar 的 `Subtitle` 区域增加标签为 `Position` 的 0 至 100 原生位置条和整数值显示，`input` 期间实时预览，`change` 或指针、鼠标、触控结束后通过同一个幂等入口自动保存。Global 作为插件范围的位置权威，以接收顺序分配 intent sequence、串行保存 IINA preference，并向全部 Main 广播预览、提交或回退状态；Main 维护逐播放器几何与当前译文，只在真实译文存在时更新显示。现有 ASS `osd-overlay` 完全迁移为声明 `video-overlay` 权限的非交互式 `iina.overlay` WebView；Main 先以空 Simple Mode 预热宿主 WebView，再加载包内页面并使用 DOM 实际块高完成底部锚定、顶部钳制和多行布局。WebView 以 `29/720 × viewportHeight` 的 CSS 字号和 400 字重接近迁移前 ASS `40/720` 的可见字形，并保持 `2/720 × viewportHeight` 描边。Main 独立读取并缓存 mpv 几何、字幕 margin 和黑边配置；标量 margin 使用属性事件，宿主不能可靠观察的 `osd-dimensions` 与 `sub-use-margins` 每 100 毫秒检测一次且只在有效区域变化时重排。普通 viewport resize 与全屏事件使用缓存，`mpv.shutdown` 或窗口关闭时先停止检测并封闭读取。Overlay 不联网、不持久化正文，也不接收任何输入。

## 技术上下文

- **语言与版本**：Node.js 24.18.0、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、HTML/CSS、JSON。
- **主要依赖**：IINA Plugin API 0.99.4、Parcel 2.16.4、Vitest 3.2.7；不新增第三方依赖或 native 代码。
- **存储**：IINA plugin preferences 中一个 0 至 100 的整数 `translationOverlayPosition`，默认值 0；预览、提交序列、DOM 尺寸、几何与译文正文只存在于当前运行期。
- **测试**：Vitest 单元、契约、集成、安全与性能测试；360p、720p、1080p 字号、字重和描边缩放回归；正式构建、包审计，以及开发者一人在 IINA 1.4.0 与 1.4.4 完成正式包验收。
- **目标平台**：macOS 12+，arm64 与 x86_64，IINA 1.4+。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、Overlay WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：位置预览 95% 在输入后 100 毫秒内可见，100% 在 200 毫秒内可见；连续 101 个值不回跳、不反向；位置更新不得阻塞播放或翻译调度。
- **约束**：新增且仅新增 `video-overlay` 权限；Overlay 必须 `setClickable(false)`，只加载包内 classic script/CSS 并通过 CSP 禁止网络；固定使用随 viewport 高度缩放的 29/720 CSS 字号、400 字重和 2/720 描边，不新增样式配置；位置端点读取 IINA 当前 `sub-margin-x/y` 与可用的 `sub-margin-y-offset`，各属性失败互不连带，并复现 libass 顶部不应用 MarginV、底部保留 MarginV 的 `sub-pos` 语义，不得改用 OSD margin；动态区域检测周期不得高于 100 毫秒，值不变不得重绘，普通窗口 resize、`mpv.shutdown` 与关闭后的回调不得读取 mpv；Sidebar 不依赖 WKWebView 是否发出 `change`，同一次拖动的多个完成信号只能触发一次保存，且不得以空闲防抖在拖动中写盘；不写字幕轨、译文文件或正文 preference；保存失败恢复最后提交值；生产代码不新增注释且自然语言使用英语。
- **规模与范围**：一个全局 preference、一套跨窗口 intent/commit 状态、一个 Sidebar 控件、每个播放器一个 Overlay WebView；替换现有 ASS 适配器与对应测试，不增加横向位置、样式编辑或画面拖动。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 自动化直接执行生产位置校验、布局、消息、竞态、偏好回滚和 Overlay 生命周期；正式包权限提示、宿主黑边映射、视觉一致性、延迟和播放器输入不受影响由一名开发者实机验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新增 TS、HTML、CSS、manifest 文案均使用英语且不添加生产注释；中文只用于 SDD 与项目文档。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | `video-overlay` 权限已由规格明确授权；Overlay 只接收当前显示所需译文，CSP 禁止联网，清理时移除 DOM 正文，消息、preferences 与日志不得保留正文。同步更新 manifest 与用户披露。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | Parcel 从版本控制内源码构建 `dist/ui/overlay.html` 及资源；包脚本把 Overlay 资源纳入精确必需清单，并继续拒绝源码、测试、运行状态与敏感材料。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | 完全移除 ASS 渲染路径，只实现当前位置条、全局同步和非交互式 WebView 渲染；不保留兼容层，也不实现画面拖动或未来样式系统。 |
| VI. 版本化管理 | 通过 | 通过 | 所有 Overlay HTML、CSS、脚本、契约和披露均纳入版本控制；构建与包不引用本地私有文件。 |
| 工作协议：完整 SDD、中文优先、并行边界与人工成本 | 通过 | 通过 | 本功能跨 Global/Main/两个 WebView 并改变权限与打包契约，采用完整 SDD；共享消息、入口、UI 与发布脚本串行修改；宿主验收由一名开发者完成。 |

## 项目结构

### 本功能文档

```text
specs/016-customize-overlay-position/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── overlay-position-messages.md
│   ├── overlay-position-rendering.md
│   └── sidebar-position-control.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 实现与测试

```text
src/
├── adapters/iina/
│   ├── overlay-position-preferences.ts
│   ├── overlay-region-runtime.ts
│   ├── overlay-position-sync.ts
│   └── webview-translation-overlay.ts
├── domain/
│   ├── messages.ts
│   └── overlay-position.ts
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
tests/
├── contract/
│   ├── overlay-position-messages.test.ts
│   ├── overlay-position-preferences.test.ts
│   ├── overlay-webview.test.ts
│   ├── package-manifest.test.ts
│   ├── sidebar-form.test.ts
│   └── sidebar-lifecycle.test.ts
├── integration/
│   ├── overlay-webview-lifecycle.test.ts
│   ├── overlay-lifecycle.test.ts
│   └── performance.test.ts
├── security/
│   └── overlay-position-privacy.test.ts
└── unit/
    ├── overlay-position.test.ts
    ├── overlay-position-sync.test.ts
    ├── overlay-state.test.ts
    └── sidebar-state.test.ts
Info.json
package.json
scripts/
├── build-plugin.sh
├── verify-package.sh
├── pack.sh
└── audit-release.mjs
README.md
docs/
├── engineering/development.md
├── readme/README.*.md
└── validation/iina-matrix.md
```

**结构决策**：Global 独占全局顺序与 preference 写入；`overlay-position-sync.ts` 只处理 intent/commit/revert 的 latest-only 状态。`overlay-region-runtime.ts` 为每个播放器独立读取并缓存 `osd-dimensions`、`sub-margin-x/y`、可用的 `sub-margin-y-offset`、全屏和宿主 margin flags；Main 用属性事件刷新标量 margin，用活动期定时检测刷新 node/flag 输入，全屏只使用事件状态，shutdown 与关闭共用幂等清理。`webview-translation-overlay.ts` 保存当前真实帧并安全投递。`overlay-state.ts` 以 viewport 高度计算固定字号和描边，再按 libass `sub-pos` 的非对称端点、归一化区域、位置值和 DOM 实际高度计算布局，便于在 Node 中直接验证同一生产逻辑；字体样式必须在 DOM 块高测量前应用。`subtitle-overlay.ts` 及 ASS 编码测试在迁移时删除，不保留双渲染路径。

## 设计阶段

1. [research.md](./research.md) 固化渲染迁移、权限、几何、持久化、并发、隐私、打包与验证决策。
2. [data-model.md](./data-model.md) 定义全局位置状态、意图、有效区域、真实译文帧和 Sidebar/Overlay 状态转换。
3. [overlay-position-messages.md](./contracts/overlay-position-messages.md)、[overlay-position-rendering.md](./contracts/overlay-position-rendering.md) 与 [sidebar-position-control.md](./contracts/sidebar-position-control.md) 约束跨运行时消息、DOM 渲染和设置交互。
4. [quickstart.md](./quickstart.md) 定义聚焦自动化、完整门禁、候选包检查和单人 IINA 验收。

## 复杂度跟踪

无宪法例外。新增 Overlay WebView 与 `video-overlay` 权限是满足 DOM 实际块高钳制所需的最小公开宿主能力；旧 ASS 路径将被删除，未形成兼容层或并存架构。
