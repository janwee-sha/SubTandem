# 研究与技术决策：Provider 连接生命周期

## 跨路径主机门控与有界复用

**决策**：每个 native helper 的 `HTTPClient` 拥有一个系统代理共享会话，以及 `system` 与 `direct` 共用的 host 门控。每个 host 最多 4 个活动请求进入传输层；`direct` 通过最多 4 个 easy handle 的池保留并复用连接，每个 handle 的连接缓存固定为 1。

**理由**：`httpMaximumConnectionsPerHost` 是底层连接策略，不能单独证明代理 tunnel 或 libcurl 进入传输层前受到请求级门控。显式许可保证上游并发有界，复用同一 easy handle 则避免 TCP 连接总量随长视频请求数累积。

**考虑过的替代方案**：只设置 `httpMaximumConnectionsPerHost` 无法覆盖 libcurl；每请求清理 easy handle 或强制 `Connection: close` 会持续新建连接，并依赖上游及时回收；全局串行请求会不必要地牺牲不同 host 与同 host 的安全并发。

## 活动请求与取消所有权

**决策**：共享会话和跨路径 host 门控不共享任务终态。每个 job 仍登记独立的网络任务和取消闭包；等待、完成、失败或取消都以同一原子清理路径移除登记并只完成一次。

**理由**：现有 helper RPC 以 job ID 提供精确取消。把共享限制在传输会话和 host 许可，可保持 Global、窗口和 provider 任务身份不变。

**考虑过的替代方案**：按 host 或会话整体取消会误伤其他窗口；只依赖外层任务取消无法处理 helper `/v1/cancel` 与网络回调竞争。

## 按任务保存重定向状态

**决策**：共享会话的 delegate 以网络任务身份保存原始 URL 和重定向次数；每个任务继续最多允许 3 次同源重定向，终态时清除自身状态。

**理由**：原先每请求 delegate 隐含隔离。会话共享后必须显式恢复同等隔离，否则不同请求可能共用计数或原始目的地。

**考虑过的替代方案**：会话级单一计数会造成跨请求干扰；完全关闭重定向会改变现有行为；允许系统默认重定向会放松目的地安全边界。

## helper 关闭语义

**决策**：`HTTPClient` 具有幂等关闭状态。关闭开始后拒绝新请求，取消所有活动任务并使共享会话失效；`/v1/shutdown` 在请求进程退出前触发该清理。父进程丢失和空闲退出仍由进程终止兜底释放资源。

**理由**：显式关闭可验证且能避免迟到回调继续占用状态；进程级退出仍覆盖无法收到 RPC 的路径。

**考虑过的替代方案**：只依赖进程退出难以契约测试关闭竞争；等待所有上游自然完成会延长关闭并可能永久阻塞。

## `direct` 路径连接复用

**决策**：`proxyMode: "direct"` 继续使用 libcurl no-proxy 传输，不接入系统代理共享会话；它接入共同的 host 门控，并从 `DirectCurlTransport` 有界池取得 easy handle。请求结束后 handle 回池，保留可复用连接；helper 关闭时统一清理。

**理由**：libcurl 的连接缓存属于 easy handle；重复使用同一 handle 才能复用其持久连接。重置 handle 的请求选项不会清除活动连接，因此每次请求仍能使用独立回调、请求体和取消上下文，同时保留连接池。

**考虑过的替代方案**：把 `direct` 改为 `URLSession` 会改变代理、证书、重定向和取消语义；跨线程共享 libcurl connection cache 不受支持；使用单一 handle 会把全部 `direct` 请求串行化。

## 真实连接测试接口

**决策**：Global 使用的 Provider 运行时实现独立 `ProviderConnectionTester.testConnection(testId)`；基础 `TranslationProvider` 接口保持不变。每次调用必须至少执行一次当前 Profile 的真实服务请求；OpenAI-compatible 已知 capability 只决定本次请求格式，未知时仍按固定顺序发现；Ollama 继续检查版本、模型和结构化响应。正常翻译仍可复用已发现 capability。

**理由**：把“发现 capability”和“验证当前连接”分离，可消除缓存命中即成功，同时让每类 Provider 自己维护最小且准确的检查流程。

**考虑过的替代方案**：把测试方法加入全部翻译客户端会迫使 Main 侧适配器和测试 fake 承担不属于它们的能力；Global 清空 provider 缓存会丢失有效 capability；直接复用 `probe()` 无法表达缓存后仍须联网；用真实字幕批次测试会扩大字幕外发范围。

## OpenAI-compatible 运行期会话身份

**决策**：每个 OpenAI-compatible Provider 实例接收一个运行期生成且不含业务语义的身份，并在全部 Test 与翻译请求中以 `X-Session-Id` 携带。同一 Profile revision 缓存的 Provider 复用该身份；实例重建时生成新身份。该值不持久化、不记录，也不进入现有消息。

**理由**：部分兼容网关用请求内容生成具有较长 TTL 的会话，并以会话数量实施容量保护；两条一组的字幕请求内容持续变化，会在短时间内占满会话额度，即使 TCP 连接已经正确复用。显式稳定身份让这些请求属于同一客户端会话，同时不改变 wire 大小、渐进发布、重试或取消语义。

**考虑过的替代方案**：把每个逻辑批次合为一个 wire 请求会降低请求数，但改变渐进输出和模型基数可靠性；全局固定身份会把不同 Profile 混入同一上游会话；以 Profile ID、endpoint 或字幕散列作为身份会泄露稳定关联信息；只修改特定 OmniRoute endpoint 会把通用 Provider 与服务域名耦合。

## 唯一测试身份与 Global 隔离

**决策**：Global 为每条既有 `provider:test` 消息生成内部唯一 `testId`，并在瞬时注册表中关联权威 player ID、外部 request ID、Profile revision 和 provider。Provider 内的测试 job 均以该 `testId` 命名；完成、Profile 删除或全局清理只取消匹配记录。回复继续使用原外部 request ID。

**理由**：不同窗口可能产生相同外部 ID，provider 实例也可能被多个测试复用。独立内部身份能避免 Map 覆盖和宽泛的 `probe-*` 取消，同时无需修改消息格式。

**考虑过的替代方案**：以 provider 对象为唯一键不能表示并发测试；直接以外部 request ID 为键不能隔离跨窗口碰撞；新增消息字段会破坏既有契约。

## 错误、翻译与消息边界

**决策**：真实 Test 沿用现有安全错误归一化，429 继续归为配额错误；helper RPC、Global/Main/Sidebar 消息，25 cue/batch、2 cue/wire、最多三次额外重试和 Test/Select 独立语义全部不变。仅新增发送给用户已授权 OpenAI-compatible endpoint 的瞬时会话 header，不新增目的地、日志、持久化或敏感数据字段。

**理由**：本功能只修复资源生命周期和假成功，现有产品、安全与重试契约仍然有效。

**考虑过的替代方案**：为连接状态新增 RPC 或 UI 消息会扩大跨运行时范围；改变重试次数可能放大本次连接修复的外部副作用。
