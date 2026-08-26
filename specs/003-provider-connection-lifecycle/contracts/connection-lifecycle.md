# Provider 连接生命周期契约

## 适用范围

本契约约束 native helper 中 `proxyMode: "system"` 与 `proxyMode: "direct"` 的上游请求，以及这些请求在并发、取消、重定向和 helper 关闭时的行为。

## 请求门控与连接复用

1. 同一 helper 生命周期内，全部系统代理请求必须使用同一个共享会话；`direct` 继续使用独立 libcurl 请求。
2. 两条路径共用 host 门控，每个目的 host 同时进入传输层的请求最大为 4；更多请求必须排队，不得依赖底层连接配置推断排队已经发生。
3. `system` 必须复用共享会话，`direct` 必须复用有界 easy handle 池；连接总量不得随已完成请求数量持续累积。
4. 连接共享不得合并请求身份、响应、请求体、凭据或取消状态。

## 请求登记与终态

1. 每个请求必须在启动网络任务前以现有 job ID 登记。
2. 同一活动 job ID 继续返回既有 `duplicate-job` 错误。
3. 请求只能进入一次完成、失败或取消终态；所有终态都清除活动登记和重定向状态。
4. 响应仍只返回既有 allowlist headers、安全错误码和大小受限的 body，不新增诊断字段。

## 精确取消

- `/v1/cancel` 只取消匹配 job ID 的网络任务。
- 取消一个正在运行或排队的请求不得取消系统会话、关闭共享门控或改变其他请求终态。
- 完成与取消竞争时只产生一个终态；后续取消继续返回既有 `already-completed` 或 `unknown` 状态。
- 多窗口可并发使用共享会话，但只能通过各自 helper job ID 操作自己的工作。

## 重定向

- 原始 origin 与已接受次数按网络任务保存，不得使用会话级共享计数。
- 每个请求最多接受 3 次重定向，且每个目标都必须与原始 URL 同源。
- 跨源或超限重定向只终止对应请求，不影响同一会话中的其他请求。
- 目的地校验、协议限制和响应 header allowlist 保持现有行为。

## 关闭

1. helper 关闭开始后，共享会话进入 `closing`，拒绝新的上游请求。
2. 所有活动上游请求被取消，共享等待队列和重定向状态被清除，系统代理会话随后失效。
3. 关闭操作幂等；迟到网络回调不得恢复已结束请求或产生第二次响应。
4. 显式 `/v1/shutdown`、空闲退出和父进程退出最终都不得遗留可继续工作的连接资源。

## `direct` 不变边界

`proxyMode: "direct"` 继续使用 libcurl no-proxy 路径，不加入系统代理共享会话。除接入 host 门控和有界 easy handle 池外，其目的地限制、取消、超时、最大响应大小、安全错误分类和不跟随重定向行为必须通过回归验证。

## 不变接口

- `/v1/request`、`/v1/cancel`、`/v1/shutdown` 的路径、请求字段、响应字段和安全错误码不变。
- Global、Main 与 Sidebar 不接收连接计数、会话身份或重定向状态。
- 不新增日志、持久化状态、网络目的地或敏感数据流。

## OpenAI-compatible Provider 会话

- 同一 Provider 实例的 Test 与翻译请求必须携带同一个无业务语义的运行期 `X-Session-Id`，不同 Provider 实例不得共用。
- 会话身份只发往用户已经授权的 Profile endpoint；不得由 Profile ID、endpoint、字幕、窗口或凭据派生。
- header 被服务忽略时不得影响标准 OpenAI-compatible 请求；被服务接受时不得改变两条一组的 wire、渐进输出、重试、取消或错误分类。
- 会话身份不得进入 helper RPC 字段、Global/Main/Sidebar 消息、UI、日志、preferences、credential 文件或正式包静态内容。
