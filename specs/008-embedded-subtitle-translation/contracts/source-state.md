# 字幕源状态契约

## 状态优先级

准备状态优先于现有翻译状态显示：

| state | 英文 UI 文案意图 | Retry | Provider 调用 |
| --- | --- | --- | --- |
| `preparing` | Preparing the selected embedded subtitle… | 否 | 禁止 |
| `unsupportedType` | This subtitle type is not supported. Select a text subtitle in IINA. | 否 | 禁止 |
| `remoteUnsupported` | Embedded subtitles in remote media are not supported. | 否 | 禁止 |
| `emptyOrUnreadable` | The selected subtitle is empty or unreadable. | 是 | 禁止 |
| `timedOut` | Subtitle preparation timed out. Playback continues. | 是 | 禁止 |
| `failed` | Subtitle preparation failed. Playback continues. | 是 | 禁止 |
| `ready` | 交由既有翻译 `SessionStatus` | 否 | 按现有门控 |

所有不可用状态都应提示用户可在 IINA 重新选择主字幕；插件不提供自己的轨道选择器。

## 重试消息

Sidebar 仅在 `canRetry=true` 时发送：

```json
{
  "requestId": "ui-generated-id",
  "revision": 1,
  "payload": {}
}
```

消息名：`subtitle:retry-preparation`。

Main 只有在当前媒体和轨道仍与失败状态一致、没有活动 attempt 时接受。每次接受必须创建新的 attempt/job ID；重复点击、过期消息或不匹配 source 返回安全失败，不复用旧 job。

## 生命周期

- 换轨、换片、停止、禁用或关窗立即撤销 Retry 所针对的旧 source。
- seek 不改变准备 UI；准备成功后从最新位置进入现有有限前瞻。
- 外挂字幕沿用既有状态与操作，不增加步骤。
- UI state、操作结果和错误不得含路径、字幕正文、job ID、token 或 native 原始错误。
