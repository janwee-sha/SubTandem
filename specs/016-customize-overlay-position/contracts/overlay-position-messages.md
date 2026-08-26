# 契约：译文浮层位置消息

所有 Sidebar 和 Main 请求沿用严格 envelope：

```json
{
  "requestId": "overlay-position:window-a:8",
  "revision": 1,
  "payload": {}
}
```

未知字段、非整数、范围外值和无效 envelope 必须拒绝。字幕或译文正文不得进入本契约的 Global 消息。

## Sidebar → Main → Global：预览

消息名：`overlay-position:preview`

```json
{
  "requestId": "overlay-position:window-a:8",
  "revision": 1,
  "payload": { "position": 42 }
}
```

Main 先对所属播放器立即应用有效值，再转发 Global。Global 绑定回调提供的 player ID，分配新 `intentSequence` 并广播；preview 不写 preference、不改变 `committedRevision`。

## Sidebar → Main → Global：保存

消息名：`overlay-position:save`

```json
{
  "requestId": "overlay-position:window-a:9",
  "revision": 1,
  "payload": { "position": 42 }
}
```

Global 按接收顺序分配 sequence，并执行唯一的 `set + sync`。成功后更新 committed；失败恢复先前值。任何窗口不得直接写该 preference。

## Main → Global：请求快照

消息名：`overlay-position:get`

```json
{
  "requestId": "overlay-position:init:window-a",
  "revision": 1,
  "payload": {}
}
```

Global 只向源 player 返回当前 live/committed 快照。新 Main 在显示任何译文前必须完成请求或先使用安全默认 0，并在快照到达后收敛。

## Global → Main：权威状态

消息名：`overlay-position:state`

```json
{
  "phase": "preview",
  "position": 42,
  "committedPosition": 25,
  "intentSequence": 18,
  "committedRevision": 4
}
```

`phase` 只能是 `snapshot`、`preview`、`committed` 或 `reverted`。

- `snapshot` 只发源 player；其他 phase 通过 deferred `global.postMessage(null, ...)` 广播所有 player。
- `position` 是本消息建议显示值；`committedPosition` 是最后成功持久值。
- `intentSequence` 与 `committedRevision` 均为非负整数。接收方只应用不小于最近已接受 sequence 的显示状态。
- `committed` 的 `position` 必须等于 `committedPosition` 且 revision 递增。
- `reverted` 的显示值必须恢复到 `committedPosition`；若接收方已接受更大 sequence，则完全忽略该回退。
- state 不包含 request ID、player ID、媒体、字幕、译文或内部错误。

## Global → 源 Main：保存结果

消息名：`overlay-position:save-result`

成功：

```json
{
  "requestId": "overlay-position:window-a:9",
  "ok": true,
  "position": 42,
  "intentSequence": 18,
  "committedRevision": 5
}
```

失败：

```json
{
  "requestId": "overlay-position:window-a:9",
  "ok": false,
  "code": "OVERLAY_POSITION_SAVE_FAILED",
  "userAction": "NONE",
  "committedPosition": 25,
  "intentSequence": 18,
  "committedRevision": 4
}
```

Main 先按同一 sequence 把结果应用到本地位置状态，再转为所属 Sidebar 的安全 `operation:result`；其他窗口由权威 state 收敛。源 Sidebar 只有在 request ID 仍是最新 pending 且 sequence 未过时时才能改变反馈或回退。

## Main → Overlay WebView

Overlay ready：WebView 只发送 `overlay:ready`，payload 必须为空。

布局消息 `overlay:layout`：

```json
{
  "renderRevision": 31,
  "position": 42,
  "region": { "top": 0.125, "bottom": 0.875, "marginX": 16, "marginY": 16 }
}
```

显示消息 `overlay:render`：

```json
{
  "renderRevision": 32,
  "lines": ["current translated line"],
  "position": 42,
  "region": { "top": 0.125, "bottom": 0.875, "marginX": 16, "marginY": 16 }
}
```

清理消息 `overlay:clear`：

```json
{ "renderRevision": 33 }
```

- `renderRevision` 必须严格 latest-only；clear 后较旧 render/layout 不得恢复正文。
- `lines` 只含当前真实有效译文，不得含源字幕、未来 cue、占位文本或历史帧。
- WebView 不向 Global、Sidebar 或网络转发正文，不使用 storage。
