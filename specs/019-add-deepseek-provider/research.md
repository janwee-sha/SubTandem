# 研究：添加 DeepSeek 翻译服务

## 专用 Provider 边界

- **决策**：新增公开 `DeepSeekProvider`，让当前 OpenAI 与 DeepSeek 通过显式方言策略共用 Chat Completions 批次、取消和外层解析框架，并复用 `ProviderTransport`、`buildTranslationTask()`、`encodeWireItems()` 与安全错误形状；DeepSeek 方言固定绕过 `OpenAICompatibleProvider` 的 capability probe、fallback 和 capability cache。
- **理由**：OpenAI Provider 会从 `json_schema` 开始探测并缓存能力，而 DeepSeek Chat Completions 已知只需要 `json_object`。独立类能保证 Test 与翻译从首个请求起即符合 FR-006/FR-010，并避免改变 OpenAI 的探测和回退行为。
- **备选方案**：直接构造 `OpenAICompatibleProvider({ capability: "json-object" })` 无法固定 thinking、严格校验和错误语义；完整复制 `openai.ts` 会重复批次、取消与解析；面向未知未来 Provider 的插件框架则扩大范围。

## API Root 与模型目录

- **决策**：内部新增 `kind: "deepseek"`。规范化完整 HTTP(S) API Root，去除请求拼接处的尾斜杠；Chat Completions 请求 `POST {root}/chat/completions`，模型目录请求 `GET {root}/models`，解析对象中的 `data[].id`，按现有规则 trim、过滤空值、精确去重并保留顺序。
- **理由**：DeepSeek 官方 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 与 [模型列表](https://api-docs.deepseek.com/api/list-models) 使用这两个路径和 OpenAI-compatible 响应外形。保留现有目录上下文、draft credential、失败保留和 latest-only 规则即可满足服务隔离。
- **备选方案**：复用 `kind: "openai"` 会丢失独立 UI、默认值、持久身份和请求策略；预置当前官方模型会过时并违反响应驱动要求。

## Chat Completions 请求

- **决策**：每次 Test 与翻译固定发送 `stream: false`、`temperature: 0`、`thinking: {"type":"disabled"}` 和 `response_format: {"type":"json_object"}`；`response_format` 不包含 `json_schema`、schema、`strict`、`name` 或其他嵌套内容。headers 只含 Content-Type 与可选 Bearer，不向 DeepSeek 外发本地 `X-Session-Id`。
- **理由**：DeepSeek 当前官方 Chat Completions 文档把 thinking 表示为含 `type` 的对象，默认值为 enabled；其 JSON Output 只要求 `json_object`。显式关闭 thinking 后 `temperature: 0` 才保持预期的确定性语义。
- **备选方案**：先发 `json_schema` 再降级违反规格；仅发送字符串 `"disabled"` 不符合当前官方对象形状；依赖模型名推断 thinking 模式会随目录变化失效。

## JSON 提示与完整校验

- **决策**：DeepSeek system message 在共享翻译指令后追加一个非 JSON Schema 的紧凑 JSON 目标示例，明确 `translations` 数组、当前 wire 的每个 ID 恰好一次、仅允许非空 `text`，并要求只输出 JSON。响应先验证外层 Chat Completions、finish reason、非空 `message.content` 和完整 JSON 对象，再严格比较条目数量、字段、请求 ID 集合、唯一性与非空译文；任一失败则该 wire 零提交。
- **理由**：DeepSeek [JSON Output 指南](https://api-docs.deepseek.com/guides/json_mode/) 要求提示中明确 JSON 和期望格式，并说明内容可能为空或被截断。现有 `validateIdOutput()` 有意保留部分有效结果，不能直接满足 DeepSeek 的 all-or-nothing 要求；应新增专用严格验证入口而不改变 OpenAI/Ollama 语义。
- **备选方案**：把正式 JSON Schema 放入 `response_format` 不受支持；从自然语言、Markdown 或首个大括号中猜测 JSON 会扩大协议接受面；全局收紧现有 validator 会改变既有 Provider 行为。

## Test、缓存与重试

- **决策**：`testConnection()` 每次对当前 Profile revision 发送一个真实的固定 DeepSeek 翻译探针并完成相同严格解析，不把 provider cache 或模型目录成功视为 Test。翻译沿用当前每 wire 超时、最大响应、取消和有界 retry policy；空内容、截断、畸形或 ID 失败作为安全协议/拒绝错误交给现有有界策略，不新增无限或 provider 专属持久重试。
- **理由**：真实探针同时验证 Endpoint、Key、Model、JSON object、thinking 参数与响应结构。现有 Provider cache 只复用配置实例，不应跳过联网 Test；会话 retry 已负责可重试网络/HTTP 失败并保持播放非阻塞。
- **备选方案**：用 `GET /models` 代替 Test 无法证明 Chat Completions；成功 capability 缓存替代 Test 违反 FR-010；空内容无限重试会扩大成本和延迟。

## 错误与敏感信息

- **决策**：DeepSeek 只按 HTTP status、finish reason 与本地验证结果生成固定 allowlist code；不转发任意上游 `error.code/type`。401/403 为 authentication，402 为 quota，429 与可重试 5xx 沿用安全 HTTP/retry-after 分类，finish reason、空内容和结构失败映射为 DeepSeek 专属本地 code。不得回传响应正文、错误 message、headers、Endpoint、凭据、字幕或译文。
- **理由**：现有 `normalizeProviderError()`、ProviderTransport 响应上限、redirect/目的地校验和 Sidebar 状态文案已经建立最小安全反馈形状；只需补齐 DeepSeek 可操作分类，不需要暴露服务原文。
- **备选方案**：直接显示 DeepSeek 错误正文可能泄漏请求数据或供应商回显；把全部失败折叠为 endpoint 错误会让凭据、余额和限流不可操作。

## Profile、凭据与兼容数据

- **决策**：把 `deepseek` 加入当前 Provider kind、Profile 保存/恢复、安全 view、模型请求与消息解析联合类型。DeepSeek Profile 使用既有 revision、selection、lease、credential epoch、provider cache 和删除清理；API Key 仍以 Profile ID 为键只写保存。既有 `openai`/`ollama` metadata 原样恢复，不迁移、不改名、不新增 capability 字段；DeepSeek 不持久化 capability。
- **理由**：现有生命周期已经保证保存后不回读 Key、编辑使选择失效、替换凭据取消旧任务、删除清理凭据和目录。内部新 kind 能隔离 fingerprint、目录 context 与 Sidebar 草稿，并保留旧数据兼容。
- **备选方案**：把 DeepSeek 保存成 OpenAI Profile 会违反独立类型并可能触发错误探测；修改 Profile ID 或凭据 schema 会引入无必要迁移。

## Service type 变更与反馈所有权

- **决策**：已保存 Profile 的 kind 变化属于凭据所有权转换。新 revision 生效前必须原子清除旧 kind 的 Key、取消旧 provider/test/model owner 并把 `credentialConfigured` 置为 false；用户必须显式输入新 Key，清理失败则旧 revision 与凭据继续权威。凭据保存结果还必须核对 request、profile/revision 和当前编辑上下文；迟到结果可以收敛权威列表，但不得覆盖另一 Service type/Profile 的编辑器反馈。
- **理由**：当前凭据只以 Profile ID 为键，若 kind 改为 DeepSeek且输入留空，旧服务 Key 可能被发送到新 Endpoint；当前编辑器反馈也需要与模型目录相同的 owner 约束。这两点都是 FR-005/FR-014 的跨服务隔离边界。
- **备选方案**：只在 UI 清空输入无法约束不可信消息和 Global 权威状态；禁止编辑 kind 会改变既有 OpenAI/Ollama 体验；让旧 Key 跟随 Profile ID 会发生跨服务复用。

## 模型刷新与竞态

- **决策**：DeepSeek 复用现有正常刷新和 `provider:models-preview` 草稿凭据消息；只扩展严格 kind 枚举和 DeepSeek `/models` 解析分支。Endpoint、kind、route、Profile/revision、credential epoch、draft credential epoch、window 与 request owner 任一变化都使旧结果失效；失败保留当前 Model ID、Custom 能力与最近成功目录。
- **理由**：现有 Global owner、`ModelCatalogSync` 和 Sidebar context signature 已覆盖保存态与草稿态竞态。DeepSeek 的模型列表与 OpenAI 是同一数据形状，但上下文必须保留独立 kind，不能共享目录。
- **备选方案**：新增第二套刷新协议会重复敏感数据边界；只按 Endpoint 缓存会在相同地址的不同 Service type 或凭据间串用结果。

## Sidebar 顺序、默认与草稿

- **决策**：HTML 固定选项顺序为 OpenAI、DeepSeek、Ollama；Sidebar 为 DeepSeek 增加独立草稿，初始名称 `DeepSeek`、API Root `https://api.deepseek.com`、空 Model ID、system route。切换类型保存当前草稿并清空未保存 Key；当前二分 provider 分支改为穷举映射，使 DeepSeek 使用自己的 Chat Completions URL、提示和错误文案，不自动选择或猜测模型。
- **理由**：现有 `providerDrafts`、系统拥有名称状态和模型控件可直接扩展，既能保留切换体验，也能避免 DeepSeek 落入 Ollama 的 fallback 文案或跨服务草稿污染。
- **备选方案**：复用 OpenAI 草稿会让 Endpoint/Model 串用；静态默认模型会违反 FR-004；继续使用二分 ternary 会把第三种类型错误归为 Ollama。

## 网络披露与文档

- **决策**：更新 `Info.json`、根 README、全部当前本地化 README 与开发指南，列出 OpenAI、DeepSeek、Ollama，说明 DeepSeek 默认 API Root、Chat Completions、模型刷新、只写 Key、费用及排错。明确切换到默认 DeepSeek 表单可能在 Select 前发出不含字幕的模型目录请求，只有明确 Select 的当前 revision 才接收字幕。
- **理由**：新增默认官方 Root 是新的内置网络目的地，必须同步用户披露与安全回归；权限仍只允许插件连接 loopback helper，外部访问继续由 helper 执行，因此无需扩大 manifest 权限或 `allowedDomains`。
- **备选方案**：只更新中文 README 会让当前多语言说明不一致；只写“OpenAI-compatible”不能解释独立 DeepSeek 类型与费用边界。

## DeepSeek 内容日志隔离

- **决策**：Main 在选择安全 Profile view 时把 `kind` 纳入 Controller 的本地选择上下文；Controller 对 `deepseek` 禁止调用字幕对照 Log Viewer sink，而 OpenAI/Ollama 的既有会话内日志行为保持不变。Provider 请求/响应与凭据对所有 kind 均不得记录。
- **理由**：当前 Controller 会把已接受 source、相邻上下文和 translation 格式化后写入 IINA console；FR-013 明确禁止 DeepSeek 字幕与译文进入日志。kind 已存在于 Main 的安全 Profile 列表，可作为不外发的确定性门禁，无需改变 Global 授权身份。
- **备选方案**：全局移除 Log Viewer 会改变既有服务行为；只在 DeepSeek Provider 内控制日志无效，因为日志发生在 Provider 返回后的 Controller；记录后再 redaction 已经越过禁止边界。

## 验证边界

- **决策**：新增 DeepSeek 契约测试并扩展 Profile、消息、模型、Sidebar、集成和安全回归；同时明确运行 OpenAI/Ollama 现有测试。DeepSeek live test 使用独立 opt-in 开关，必须先获用户授权，至少翻译 40 个目标以覆盖 20 个两项 wire，并且只记录计数和安全分类。最后执行项目八项 test/typecheck/lint/native/build/package 门禁，并用同一正式包由一名开发者完成 IINA 验收。
- **理由**：自动化可证明请求字段、解析、竞态和敏感数据边界，但不能替代真实 DeepSeek、IINA WebView、正式安装、多窗口和播放非阻塞。单人步骤符合人工成本约束。
- **备选方案**：默认公网测试会产生费用并引入不稳定性；开发链接不能证明正式包；只断言文档字符串不能证明生产行为。
