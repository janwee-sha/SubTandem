# 数据模型：Provider 连接生命周期

本功能没有持久化实体。以下状态只存在于 native helper 或 Global 进程内，并随所属生命周期清理。

## UpstreamConnectionLifecycle

- `session`：系统代理请求共享的连接会话。
- `maximumConnectionsPerHost`：固定为 4。
- `hostRequestLimiter`：两条网络路径共用，按 host 保存最多 4 个活动许可和保持任务身份的等待队列。
- `directHandlePool`：最多保留 4 个空闲 easy handle，每个 handle 的连接缓存固定为 1；请求选项重置后仍保留可复用连接。
- `state`：`open`、`closing` 或 `closed`。
- `activeRequests`：按 job ID 保存的活动上游请求集合。
- `redirectStates`：按网络任务身份保存的重定向状态。

**状态转换**：

```text
open -> closing -> closed
```

只有 `open` 可接受新请求。请求取得 host 许可后才能进入传输层，并在任一终态释放许可；`direct` handle 回到池中供后续请求复用。`closing` 立即取消活动与等待请求并拒绝新请求，连接会话与 handle 池清理且所有登记清除后进入 `closed`。重复关闭不产生额外终态。

## ActiveUpstreamRequest

- `jobId`：helper RPC 中现有的唯一 UUID。
- `transportKind`：`system` 或 `direct`。
- `networkTask` 或等价取消入口。
- `terminalState`：完成、失败或取消之一。
- `continuationState`：保证调用方只恢复一次的瞬时完成状态。

**状态转换**：

```text
registered -> running -> completed
                      -> failed
                      -> cancelled
```

请求在开始网络工作前完成登记。任一终态都从活动集合删除；完成与取消竞争时只有先取得终态所有权的一方可恢复调用方。

## RedirectState

- `taskId`：共享会话内的网络任务身份。
- `originalOrigin`：初始 URL 的 scheme、host 和有效端口。
- `redirectCount`：当前任务已经接受的重定向次数，初始为 0。

每次重定向只读取和增加对应任务的计数。目标必须与 `originalOrigin` 同源且计数不超过 3；任务终态或取消后立即删除。

## ProviderConnectionTestTask

- `testId`：Global 内部生成的唯一身份，不进入现有消息结构。
- `playerId`：IINA 回调提供的权威窗口身份。
- `requestId`：Sidebar/Main 原有消息身份，仅用于把结果送回调用方。
- `profileId` 与 `profileRevision`：本次检查绑定的不可变 Profile 快照。
- `provider`：执行真实联网检查的 Provider 实例。
- `state`：`created`、`running`、`completed`、`failed` 或 `cancelled`。

**状态转换**：

```text
created -> running -> completed
                   -> failed
                   -> cancelled
```

只有 `running` 可接收完成或取消。Profile 删除只取消相同 `profileId` 的活动任务；不同 player、revision、testId 的任务保持独立。测试任务不创建或修改播放选择。

## ProviderRuntimeSession

- `sessionId`：创建 OpenAI-compatible Provider 实例时生成且不含业务语义的运行期 UUID。
- `scope`：该 Provider 实例对应的单个 Profile revision。
- `transport`：仅作为 `X-Session-Id` 发送给已授权 endpoint。
- `lifetime`：随 Provider 实例创建和销毁，不持久化。

Test 与翻译共用该值，但 helper job ID、外部 request ID、player ID 和字幕内容不参与生成。不同 Provider 实例不共享该值。

## 关系与清理

- 一个 helper 只有一个 `UpstreamConnectionLifecycle`，可拥有多个 `ActiveUpstreamRequest`。
- 两条路径的活动请求都先取得 host 许可；系统代理活动请求另在共享会话中对应一个网络任务和一个 `RedirectState`，`direct` 请求没有共享会话重定向状态。
- 一个 Global 可拥有多个 `ProviderConnectionTestTask`，即使它们复用同一 Provider 或外部 request ID。
- Provider 测试产生的 helper job 仍是普通 `ActiveUpstreamRequest`，通过 `testId` 关联取消范围。
- 一个 OpenAI-compatible Provider 实例拥有一个 `ProviderRuntimeSession`，其所有 Test 与翻译请求都携带该身份；它不改变任务终态或窗口路由。
- 所有状态均为瞬时状态，不写入 preferences、文件、日志或包产物。
