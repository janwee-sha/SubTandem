# 契约：字幕文本样式消息

Sidebar、Main 与 Global 请求沿用严格 envelope：

```json
{
  "requestId": "subtitle-style:window-a:8",
  "revision": 1,
  "payload": {}
}
```

未知字段、无效枚举、非布尔值、越界 RGBA、过长/含控制字符的字体名和无效 envelope 必须拒绝。Global 绑定 IINA 回调提供的 player ID，不信任 payload 身份。媒体、字幕和译文正文不得进入本契约。

## Main → Global：请求快照

消息名：`subtitle-style:get`

```json
{
  "requestId": "subtitle-style:init:window-a",
  "revision": 1,
  "payload": {}
}
```

Global 只向源 Main 返回当前完整权威状态。Main 在快照到达前使用默认样式，随后 latest-only 收敛。

## Sidebar → Main → Global：单字段编辑

消息名：`subtitle-style:edit`

```json
{
  "requestId": "subtitle-style:window-a:9",
  "revision": 1,
  "payload": {
    "interactionId": "style-edit:window-a:5",
    "phase": "preview",
    "field": "fontColor",
    "value": { "r": 255, "g": 255, "b": 255, "a": 128 }
  }
}
```

`phase` 只能为 `preview | commit`。一次请求只能含一个字段：

- preview：Main 先 patch 本地 follower 并立即更新当前真实译文，再转发 Global；不得写 preference。
- commit：若 interaction 已有 preview，提交其最后 intent；无 preview 的离散控件把本次值同时视为新 intent 与提交。
- commit 的 field/value 必须与 interaction 最后有效值一致；同字段已有更晚 intent 时返回 superseded，不保存、不回跳。
- 无当前译文时仍转发并保存，但不得创建文本。

## Sidebar → Main → Global：打开 picker

消息名：`subtitle-style:picker-open`

颜色：

```json
{
  "requestId": "subtitle-style:picker:window-a:2",
  "revision": 1,
  "payload": { "kind": "color", "field": "borderColor" }
}
```

字体：

```json
{
  "requestId": "subtitle-style:picker:window-a:3",
  "revision": 1,
  "payload": { "kind": "font", "field": "fontFamily" }
}
```

Global 从权威 liveStyle 取得初始值并创建 session；Sidebar 不上传整组样式。全局已有 native picker 时返回安全 busy，不改状态。

## Global → Main：完整权威状态

消息名：`subtitle-style:state`

```json
{
  "phase": "preview",
  "liveStyle": {
    "fontColor": { "r": 255, "g": 255, "b": 255, "a": 255 },
    "fontSize": 40,
    "fontFamily": null,
    "bold": false,
    "italic": false,
    "borderColor": { "r": 0, "g": 0, "b": 0, "a": 255 },
    "borderWidth": 3,
    "backgroundColor": { "r": 0, "g": 0, "b": 0, "a": 0 }
  },
  "committedStyle": {
    "fontColor": { "r": 255, "g": 255, "b": 255, "a": 255 },
    "fontSize": 40,
    "fontFamily": null,
    "bold": false,
    "italic": false,
    "borderColor": { "r": 0, "g": 0, "b": 0, "a": 255 },
    "borderWidth": 3,
    "backgroundColor": { "r": 0, "g": 0, "b": 0, "a": 0 }
  },
  "changedField": "fontColor",
  "stateRevision": 18,
  "latestIntentSequence": 11,
  "committedRevision": 4,
  "fontResolution": {
    "preferredFamily": null,
    "availability": "available",
    "effectiveFamily": null,
    "fallbackActive": false,
    "catalogRevision": 2
  }
}
```

`liveStyle` 与 `committedStyle` 都必须是完整八字段对象，不得省略。`phase` 只能为 `snapshot | preview | committed | reverted | availability`。

- snapshot 只发源 Main；其他 phase 通过 deferred `global.postMessage(null, ...)` 广播。
- Main/Sidebar 只接受更大 `stateRevision`；相同 revision 只接受完全相同的幂等消息。
- committedRevision 只能随成功 sync 增长；availability 不改变持久样式。
- state 不含 request/player/media/正文、helper token 或内部错误。

## Global → 源 Main：保存与 picker 结果

消息名：`subtitle-style:save-result`

成功结果必须精确包含 `requestId`、`field`、`ok:true`、`outcome`、`intentSequence` 与 `authority`；`outcome` 为 `committed | superseded`，`authority` 是上一节定义的完整权威状态。

失败结果必须精确包含 `requestId`、`field`、`ok:false`、固定 `code:SUBTITLE_STYLE_SAVE_FAILED`、`userAction:EDIT_AGAIN`、`intentSequence` 与完整 `authority`。不得包含原始 preference 或内部错误。

picker 结果使用 `subtitle-style:picker-result`，只向源 Main 发送 `confirmed | cancelled | unchanged | busy | failed` 及完整 authority；不发送 helper 原始错误或字体目录。源 Sidebar 可结束匹配 request 的 busy，但只有 result authority 不旧于当前 state 时才能改值或反馈。不同字段 pending 可并存；旧结果不得清除同字段较新的 pending。

## Main → Overlay WebView

`overlay:layout` 与 `overlay:render` 在既有 position/region 基础上增加完整有效渲染 style；后者继续额外携带 `lines`。fontFamily 使用 effective family，不携带 preferred/availability。

```json
{
  "renderRevision": 31,
  "position": 42,
  "region": { "top": 0.125, "bottom": 0.875, "marginX": 16, "marginY": 16 },
  "style": {
    "fontColor": { "r": 255, "g": 255, "b": 255, "a": 255 },
    "fontSize": 40,
    "fontFamily": null,
    "bold": false,
    "italic": false,
    "borderColor": { "r": 0, "g": 0, "b": 0, "a": 255 },
    "borderWidth": 3,
    "backgroundColor": { "r": 0, "g": 0, "b": 0, "a": 0 }
  }
}
```

- layout/render/style、Position、region、正文与 clear 共用一个严格递增 `renderRevision`。
- WebView 只接受大于当前 revision 的精确 shape；clear 后旧消息不得恢复正文或样式。
- style 变化时 Main 立即发送 layout；有当前帧则重绘重测，无当前帧只缓存样式且不生成正文。
- ready 后首次 render 必须自带最新完整 style。
