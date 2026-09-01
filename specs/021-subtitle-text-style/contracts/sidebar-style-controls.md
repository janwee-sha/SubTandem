# 契约：Sidebar 字幕样式控件

## 结构

全部控件位于现有 `Subtitle` 区域、Position 之后，且其他区域不得重复：

```text
Font
  Color | Size | Font | Bold | Italic
Border
  Color | Width
Background
  Color
```

- Size 为单选下拉：30、35、40、45、50、55、60、65、70。
- Width 为单选下拉：0、0.25、0.5、1、1.5、2、2.5、3、4、5。
- Bold/Italic 为相互独立的 checkbox。
- Font 为显示请求 family 或 `System Default` 的 button；fallback 时继续显示请求 family，并附 `using System Font` 状态。
- 三个 Color trigger 显示色样、可读颜色/alpha 值和所属字段名称。

## 紧凑色盘

- 三个 trigger 共用同一 popover 组件和同一组静态预设，至少包含保持默认值所需的白、黑与透明，并提供 `Show Colors…`。
- Global/Sidebar 以 `colorTarget` 关联发起字段；选择一个预设只产生该字段的一次 commit，随后关闭 popover并归还焦点。
- 打开后未选择、Escape、点击色盘外部、WebView 失焦或 Show Colors 面板未变化关闭不得改变或保存任何字段。
- 每个预设必须有文本/aria-label、RGBA/透明度和选中标记，不得只靠色样区分。

## 字体选择

- 激活 Font button 请求 native family-only picker；打开期间 button 表达 busy，但不得禁用其他样式字段。
- helper 内筛选、列表和固定 preview 不进入 Overlay；只有 Choose 返回的 family 形成一次 commit。
- Cancel 保持打开前样式和 preference。picker 失败保留 committed，显示安全非阻塞错误。
- 已有颜色或字体 picker 时再次激活 Font 或 `Show Colors…`，只将活动 picker 置于顶端；不得显示冲突错误、创建第二个 session 或留下不可见 busy。
- 当前请求字体不可用时控件明确显示 fallback；重新可用后状态自动消失，控件仍显示同一请求 family。

## 编辑、保存与同步

| 交互 | 行为 |
| --- | --- |
| Size/Width change | 当前窗口即时 preview，并提交一次保存。 |
| Bold/Italic change | 只 patch 对应字段，当前窗口即时 preview，并提交一次保存。 |
| preset color | 只 patch 发起颜色字段，即时 preview 并提交一次保存。 |
| system color continuous change | 每次有效变化 preview；关闭且 changed 时提交最后 preview intent。 |
| font Choose | 只 patch fontFamily 并提交；Cancel 不产生 edit。 |
| 无当前译文 | 控件和保存照常，不生成 preview 文本。 |

- 每字段独立通过控件 busy 语义表达 saving；不得用整组 disabled 阻止其他字段编辑，也不得显示字段名拼接的例行 saving/saved 消息。
- 本地保存成功由最终值和清除 busy 表达；远端 commit 不显示本地 saved。
- 远端完整 state 按 stateRevision 更新所有字段；本地 pending 不得无条件遮蔽更晚权威值。
- 不同字段 pending 可并存；同字段以 Global 最后有效 intent 胜出。superseded 结果只清理对应旧 busy，不回跳或报错。
- 保存失败使八字段一次恢复最新 committed、清理受回退交互，并在 Subtitle 区域显示固定组级错误；无 Retry，用户重新修改后才保存。

## 键盘与外观

- Tab/Shift-Tab 可到达全部八项；select、checkbox、button 保留平台原生键盘行为。
- Color trigger Enter/Space 打开；palette 内方向键或 Tab 可导航，Enter/Space 选择，Escape 关闭并回 trigger。
- Font native panel 的搜索、列表、Choose/Cancel 全部可由键盘完成。
- label、当前值、busy、fallback、错误和焦点必须可辨识；颜色名称/数值不得仅通过色样表达。
- CSS 使用 `:focus-visible`，并在 `forced-colors`、`prefers-contrast: more`、亮色与暗色外观下保留边界、文字、选中和焦点状态。
- 窄 Sidebar 可换行，但组标题、字段值、色样与错误不得截断或覆盖 Position。

## 错误与隐私

错误文案仅使用安全分类，例如 `Subtitle style could not be saved. The previous style remains active.` 或 picker unavailable；不得显示 helper 原始错误、字体路径、字幕或译文。样式控件失败不得禁用翻译、清空当前译文、修改 IINA 原字幕或提供自动重试。
