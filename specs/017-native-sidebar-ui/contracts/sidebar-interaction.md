# 契约：侧栏语言交互与视觉层级

## Target Language 自动保存

1. DOM 只包含一个 `Target Language` 选择器及其紧邻状态区域，不包含 `Save Languages` 按钮。
2. 选择器初始禁用；首次权威快照完成初始化后才恢复可操作，且初始化不触发保存。
3. 用户选择与 committed 不同的目录成员时，Sidebar 立即按[目标语言偏好契约](../../007-auto-language-support/contracts/target-language-preference.md)发送一个 `defaults:save`。
4. pending 建立后选择器设置 `disabled` 和 `aria-busy=true`；匹配结果结束后恢复可操作状态。
5. 成功结果必须同时包含匹配 request ID、目标语言与有效 revision，之后 committed 和选择器对齐返回值；成功只通过选择器最终值和视觉隐藏播报确认，不显示可见成功消息。
6. 失败、取消或 transport error 必须把选择器恢复到保存前 committed 值并就近显示异常；用户可再次选择同一候选重试。
7. pending 期间的状态快照、未知结果、重复结果和旧 request ID 不得覆盖候选或改变反馈。

`defaults:save`、`defaults:saved`、`operation:result` 和 `operation:error` 的字段、所有权及 Global 原子性不变。

## 操作反馈层级

| 类型 | 控件内 busy | 可见成功 | 持久领域状态 | 可见异常 |
| --- | --- | --- | --- | --- |
| Translate、Target Language、Position | 禁用、`aria-busy` 或实时值 | 无 | 最终开关、选中值或位置值 | 失败回滚原因 |
| Profile Save/Update/Create | 按钮忙碌文案 | 无 | 新建或更新后的卡片、凭据已配置状态 | 保存失败或凭据部分失败 |
| Profile Select/Delete | 按钮忙碌文案 | 无 | 选中样式或条目消失 | 失败原因；主动取消可静默 |
| Profile Test | `Testing…` 按钮 | 无句式消息 | 当前 revision 的 `Not tested`、`Test passed` 或 `Test failed` | `Test failed` 的安全可执行原因 |
| Model refresh | 旋转图标和 `aria-busy` | 无通用文案 | 模型数量或空目录说明 | 保留旧目录并说明失败原因 |
| Subtitle Retry | `Retrying…` 按钮 | 无 | Session 准备状态 | 不再可重试或执行失败原因 |

- 普通 busy、success 和用户主动取消只写入单一视觉隐藏 `role="status" aria-live="polite"` 播报槽，不占用布局。
- error、回滚和部分成功写入所属控件紧邻的可见状态区；同一结果不得同时在播报槽和可见状态区重复公布。
- Test 状态绑定 `profileId + revision`，删除或 revision 更新必须清除旧状态；成功不得要求已处于 Selected 的 Profile 再次 Select。
- 模型成功状态必须显示有效数量，空目录必须说明仍可使用 Custom Model ID；普通成功使用低强调文字，不使用整行绿色高亮。
- Profile revision 已创建而凭据保存失败时必须说明 Profile 已保存但凭据未保存；完整成功由卡片权威状态表达。
- Profile 更新使选择失效时，卡片恢复未选择状态和可用 Select 操作，不追加可见成功说明。

## 视觉层级

| 层级 | 布局 | 表面 | 用途 |
| --- | --- | --- | --- |
| 根表面 | 占满 WebView | 透明 | 继承宿主可提供的背景 |
| Section | 全宽，20px 横向内边距 | 透明、相邻分隔线 | Subtitle 与 Translate、Translation service、Session |
| Group | section 内部，10px 圆角 | 无 blur、无常驻外框的低对比半透明填充 | Profile 集合与 Session 摘要 |
| Control | 约 26px 高，6px 圆角 | 无常驻描边的透明语义填充 | input、select、button |
| Switch | 44×20px 轨道、26×16px 胶囊形滑块 | off 语义灰、on 系统蓝 | Translate |
| Slider | 20px 命中区、3px 轨道、18×14px 且 7px 圆角的矩形旋钮 | 中性半透明轨道、无额外描边和投影的浅色旋钮 | Position |

- 宿主插件标签下不得重复显示 SubTandem 标题；Translate 与 Subtitle 必须共用首个 section 标题行。
- 顶层 Section 不得使用圆角、阴影或独立 backdrop blur。
- 主操作使用系统蓝；次要按钮使用低对比灰；危险操作只改变文字或边框语义，不引入大面积红底。
- 亮色与暗色必须分别定义文字、分隔线、控件、分组与状态色。
- Profile 和 Session 不得增加嵌套 blur；`prefers-reduced-transparency` 时半透明填充必须改为不透明语义底色。
- `prefers-contrast`、`prefers-reduced-motion` 与 `forced-colors` 行为继续可用。
- Target Language 和服务表单使用标签在上的单列控件；Model ID 下拉框与自定义编辑框之间保持 5px 垂直间距；窄宽度下按钮组必须回退，页面不得横向滚动。
- Position 不得保留 WKWebView 默认深色凹槽、正圆旋钮、黑色外框或额外投影；强制颜色模式必须回退系统 range 外观。

## 不变行为

- `Save profile` 继续显式确认服务配置和凭据，不改为自动保存。
- Translate、Position、模型刷新、Profile Test/Select/Edit/Delete 与 Session 保持既有事件、消息字段、请求归属和业务语义；仅反馈呈现按本契约分层。
- 不修改 IINA 顶部插件切换条、宿主原生 sidebar 或 WebView 外部区域。
