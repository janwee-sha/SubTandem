# 数据模型：渐进式字幕翻译输出

## TranslationBatchProgress

- `translations`：当前 wire 请求中新验证的 `{ id, text }`，ID 已恢复为原始 cue ID。
- 可选的安全 provider request ID 和 usage 元数据；不得包含凭据、授权头或原始响应。

**规则**：只包含请求内唯一、非空且可映射的结果。每次通知是增量；最终 `TranslationBatchResult` 仍是完整聚合。

## ActiveProviderAttempt

- 权威 player ID 与逻辑 request ID 组成的路由键。
- Profile ID/revision、provider 实例与取消/终态状态。
- 可选同步进度接收器。

**状态转换**：

```text
created -> active -> completed
                 -> failed
                 -> cancelled
```

只有 `active` 可发送进度；任一终态都会清除路由。

## UnresolvedCueSet

- 当前 controller 逻辑批次中尚未成功的 cue。
- 初始值是符合现有 25 cue/5,000 字符边界的批次。
- 每次接受进度或终态结果后按 cue ID 移除。

只有集合中的 cue 可进入下一次 provider attempt。进度与终态重复 ID 不会产生第二次缓存写入或重试。

## PublicationSnapshot

- 完整渲染的当前译文 SRT 内容。
- 所属 player、session、session epoch 与 window epoch。
- 由当前缓存和翻译映射生成，不持有 provider 原始响应。

## PublicationCoordinator

- `active`：当前是否执行字幕轨替换。
- `pendingLatest`：在途期间最后一个有效快照，最多一个。
- `idleWaiters`：测试和生命周期收敛使用的完成等待。

**状态转换**：

```text
idle + snapshot -> publishing
publishing + snapshot -> publishing(pendingLatest replaced)
publishing complete + pendingLatest -> publishing(latest)
publishing complete + no pending -> idle
lifecycle invalidation -> pendingLatest cleared; late completion cleaned
```

同一播放器的 `swap` 最大并发数为 1；不同播放器各自拥有协调器。

## 与既有实体的关系

- `PlaybackSession` 是进度和发布快照的生命周期权威。
- `TranslationBatchRequest` 提供 batch/request/Profile/endpoint 身份。
- `SessionTranslationCache` 只接收 controller 再验证后的新 cue。
- `GeneratedSubtitleTrack` 继续表示唯一插件自有轨道；失效发布只能清理该轨道。
