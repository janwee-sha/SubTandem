# 数据模型：字幕文本样式设置

## RgbaColor

- `r`、`g`、`b`、`a`：0 至 255 的整数，统一表示 sRGB 与 alpha。

**规则**：四个字段必须完整且不得含未知字段；系统颜色在 native 边界转换到 sRGB 后只量化一次。透明色为 `{r:0,g:0,b:0,a:0}`，不得因 alpha 为 0 改写 RGB。

## SubtitleTextStyle

| 字段 | 类型 | 默认值 | 有效值 |
| --- | --- | --- | --- |
| `fontColor` | `RgbaColor` | 白色不透明 | 任意有效 RGBA |
| `fontSize` | number | `40` | `30,35,40,45,50,55,60,65,70` |
| `fontFamily` | string 或 `null` | `null` | `null` 或 1 至 256 字符、无控制字符的 family |
| `bold` | boolean | `false` | boolean |
| `italic` | boolean | `false` | boolean |
| `borderColor` | `RgbaColor` | 黑色不透明 | 任意有效 RGBA |
| `borderWidth` | number | `3` | `0,0.25,0.5,1,1.5,2,2.5,3,4,5` |
| `backgroundColor` | `RgbaColor` | 透明 | 任意有效 RGBA |

**读取规则**：JSON 对象逐字段验证，单个字段无效只使用该字段默认值；不可用字体仍是有效偏好。损坏 JSON 或非对象根整组使用默认值，且读取回退不写 preference。

**派生渲染值**：

```text
fontSizePx = fontSize × 29/40 × viewportHeight/720
strokeWidthPx = borderWidth × 2/3 × viewportHeight/720
```

派生值不进入 preference。Width 0 同时关闭 text stroke 与 shadow。

## FontResolution

- `preferredFamily`：来自 `SubtitleTextStyle.fontFamily`。
- `availability`：`available | unavailable | unknown`。
- `effectiveFamily`：可用时等于 preferred；系统默认或不可用时为 `null`。
- `fallbackActive`：只有 preferred 非空且 availability 为 unavailable 时为 true。
- `catalogRevision`：helper 每次字体目录变化递增的非负整数。

`availability` 与 `effectiveFamily` 只存在于运行期，不回写 preference。重新可用时 effective 自动恢复 preferred，并触发 Overlay 重排。

## StyleEditIntent

- `interactionId`：由发起 Sidebar 或 Global picker session 创建的不透明 ID。
- `sourcePlayerId`：只保留在 Global 路由上下文，不进入广播状态。
- `field` 与 `value`：一个经过严格验证的样式字段 patch。
- `intentSequence`：Global 对每次实际有效值变化分配的全局单调序号。
- `phase`：`previewing | pendingSave | committed | superseded | reverted`。
- `requestId`：保存或 picker 请求的源关联；不进入全部窗口广播。

同一 interaction 的连续颜色变化替换其 intent；完成时提交最后一个 intent。若该字段已有更大 sequence，则旧 intent 转为 superseded，不得保存或回跳。不同字段的 intent 可同时存在。

## StyleAuthorityState

- `phase`：`snapshot | preview | committed | reverted | availability`。
- `liveStyle`：当前全部 Overlay 与 Sidebar 应显示的完整样式。
- `committedStyle`：最后一次 preference sync 成功的完整样式。
- `changedField`：引发本状态的字段；snapshot、availability 或整组 revert 可为 `null`。
- `stateRevision`：每次权威状态转换递增，接收方 latest-only 的第一排序键。
- `latestIntentSequence`：已接受的最大 intent sequence。
- `committedRevision`：仅在保存成功后递增。
- `fontResolution`：当前字体偏好与 effective 状态。

**状态转换**：

```text
restore -> snapshot(live = committed)
valid edit -> preview(live[field] = value)
latest field intent + sync success -> committed(committed[field] = value)
older same-field completion -> superseded(no persistence, no style change)
sync failure -> reverted(live = committed, active interactions invalidated)
font catalog change -> availability(style unchanged, effective font may change)
```

保存候选只能由 `committedStyle + 当前字段 patch` 构造，不能持久化其他字段未完成的 preview。一个字段成功后，其他字段仍有效的 preview 保留在 live；任一真实保存失败按规格恢复整组 committed。

## PickerSession

- `requestId`、`interactionId`：Global 关联源操作与 style intent。
- `ownerPlayerId`：只在 Global 内存，用于窗口关闭取消和结果路由。
- `kind`：`color | font`。
- `targetField`：颜色三字段之一或 `fontFamily`；不发送给 helper。
- `originalValue`、`lastPreviewValue`、`lastIntentSequence`。
- `changed`：系统颜色面板是否产生有效变化。
- `eventRevision`：已接受的 helper 最大事件序号。
- `state`：`opening | active | focusing | closing | completed | cancelled | failed`。

全局同一时刻最多一个 active native picker。已有 session 时的新请求只把该 session 的窗口置于顶端并静默结束，不创建第二个 session。Sidebar 的颜色 picker 终态延迟时，用户再次点击 Show Colors 以新 requestId 原子替换本地 session；Global 仍按单一 active session 前置或打开窗口。未变化关闭或字体取消不产生 intent；颜色关闭提交最后 preview 的既有 intent；helper 失败使该 session 失效并按保存状态安全回退。

## SidebarStyleState

- `displayStyle`、`committedStyle`、`stateRevision`、`committedRevision`。
- `interactionByField`：各字段当前 interaction ID 或 null。
- `pendingByField`：各字段最新保存 request/intent 或 null。
- `feedbackByField`：`idle | saving | saved`。
- `groupError`：安全的非阻塞保存/picker 错误或 null。
- `fontResolution`：用于显示请求字体和 fallback 状态。
- `colorTarget`：当前 popover 的颜色字段或 null。

远端 preview/commit 可更新 display，但不得冒充本地 saving/saved；本地 saving 只通过所属控件的 busy 语义表达，不生成可见的例行操作消息。失败接受后八字段 display 一次恢复 committed、清除被回退的 interaction/pending 并设置 groupError；用户再次编辑前不自动重试。

## 关系与所有权

```text
Global 1 -> 1 StyleAuthorityState -> 1 committed JSON preference
Global 1 -> 0..1 PickerSession -> 1 native style-picker
StyleAuthorityState 1 -> 0..8 active latest field intents
Main 1 -> 1 authority follower -> 1 SidebarStyleState
Main 1 -> 1 effective SubtitleTextStyle -> 1 Overlay WebView
```

任何实体都不得持有字幕正文、译文、媒体路径、Profile 或凭据。
