# 数据模型：原生侧栏视觉与语言自动保存

## SidebarTargetLanguageState

- `committedTargetLanguage`：Main 最近确认的目标语言 ID。
- `targetLanguageRevision`：当前 committed 值的修订号；保存请求携带该值。
- `targetLanguageHydrated`：选择器是否已从权威状态初始化。
- `pendingLanguageSaveRequestId`：当前唯一等待结果的保存请求；无等待时为 `null`。
- `displayedTargetLanguage`：选择器当前显示值；idle 时与 committed 一致，pending 时为候选值。

**验证规则**：候选值必须来自已渲染目录；首次 hydrate 前选择器不可操作；候选等于 committed 时不创建请求；pending 存在时选择器不可再次变更；结果只在 request ID 匹配时改变状态。

**状态转换**：

```text
unhydrated --state snapshot--> idle(committed)
idle --choose different value--> pending(candidate, requestId)
pending --matching success--> idle(returned committed, new revision)
pending --matching failure/cancel/error--> idle(previous committed)
pending --unmatched result/snapshot--> pending(candidate, requestId)
```

不再存在独立 dirty 草稿或显式提交状态；关闭 Sidebar 后以 Main committed 状态重新初始化。

## SidebarOperationFeedback

- `regionId`：请求所属操作区域；目标语言继续使用 `language-settings`。
- `actionId`：既有操作身份；目标语言继续使用 `languages`，保持 Main 返回结果兼容。
- `control`：承担 busy 和可见权威结果的原操作控件。
- `phase`：`busy | success | error | cancelled`。
- `visibility`：`assistive | visible`；普通 busy、success 和用户主动取消为 `assistive`，error、回滚与部分成功为 `visible`。
- `message`：固定英文辅助技术播报或安全异常说明。

该实体沿用通用 Sidebar operation coordinator 和逐区域 latest 请求；可见反馈仍只接受当前请求，普通成功不再创建 Profile 删除结果槽。单一视觉隐藏播报区域不保存业务状态，也不参与 Profile、Session 或模型目录渲染。

## SidebarDomainStatus

- `profileTest`：`not tested | passed | failed`，绑定 `profileId + revision`；成功只显示紧凑卡片状态，失败同时显示可执行原因。
- `modelCatalog`：`idle | busy | success | error`；busy 只驱动刷新控件，成功显示有效模型数量或空目录说明，失败保留上次目录并显示原因。
- `overlayPosition`：保存中和成功只通过控件 busy、权威数值及视觉隐藏播报表达；失败恢复 committed 并显示原因。
- `profileSave`：完整成功由卡片创建或更新表达；revision 已创建但凭据失败时产生可见部分成功状态；选择失效由卡片恢复 Select 表达。

领域状态不参与通用成功消息竞态；Profile revision、模型上下文或新请求使对应旧状态失效。

## SidebarVisualSurface

- `hostSurface`：透明根表面，承接 IINA 可提供的背景。
- `section`：全宽顶层区域，以间距和分隔线划分。
- `groupSurface`：仅 Profile 集合与 Session 摘要使用的低对比半透明圆角区域。
- `controlSurface`：输入框、选择器和次要按钮的低对比透明语义填充；仅交互焦点和辅助功能模式显示明确边界。
- `accent`：亮色和暗色对应的 macOS 系统蓝近似值。

**视觉约束**：宿主插件标签下不重复显示插件标题；顶层 section 不得拥有圆角、阴影或独立玻璃底；group surface 不得叠加 blur 或常驻外框，且在减少透明度模式下必须变为不透明语义底色；Target Language 和服务表单均使用标签在上的单列布局；Translate 开关使用 44×20px 轨道与 26×16px 胶囊形滑块；Position 在 20px 命中区内使用 3px 中性轨道与 18×14px、7px 圆角的浅色矩形旋钮，旋钮不增加独立描边或投影，强制颜色模式交还系统绘制；Model ID 下拉框与自定义编辑框保持 5px 垂直间距。

## 所有权关系

```text
Global preference 1 -> 0..N Main committed snapshots
Main snapshot      1 -> 1 Sidebar committed state
Sidebar selection  1 -> 0..1 existing save attempt
save result        1 -> 1 matching Sidebar transition

IINA host surface  1 -> 1 transparent WebView root
WebView root       1 -> N flat sections
flat section       1 -> 0..N grouped surfaces
```

持久层、消息 payload、Main revision 和 Global 原子提交保持[既有目标语言契约](../007-auto-language-support/contracts/target-language-preference.md)不变。
