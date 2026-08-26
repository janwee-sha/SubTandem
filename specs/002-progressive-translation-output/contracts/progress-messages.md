# Provider 进度消息契约

## Global 到 Main

消息名：`provider:attempt-progress`

```ts
{
  requestId: string;
  progress: TranslationBatchProgress;
}
```

## 路由规则

- Global 使用 IINA 回调提供的权威 player ID，不信任请求 payload 中的 player ID。
- broker 以 `authoritativePlayerId + requestId` 查找活动 attempt，只有同一活动记录可转发进度。
- profile 删除、全局取消、单请求取消、成功或错误终态都会使活动记录失效。
- Main 以 request ID 查找 pending attempt；未知、已取消或已终态 request 的进度直接丢弃。
- Main 交给 controller 前不记录或转换 `progress` 内容。

## Controller 接受条件

进度必须同时匹配当前 player、session ID、session/window epoch、Profile ID/revision、endpoint fingerprint、batch ID、request ID 和该 attempt 的 cue 集合。任一条件不匹配时写入次数和发布次数均为 0。

## 终态顺序

Main 在处理 `provider:attempt-result` 或 `provider:attempt-error` 时先删除 pending entry，再 resolve/reject attempt，确保之后到达的进度无法被消费。
