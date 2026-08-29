# 研究：添加 Claude 翻译服务

## 专用 Provider 与批次边界

- **决策**：新增独立 `ClaudeProvider`，复用 Profile、凭据、Broker、Test、cache、transport、wire 编码与 `validateStrictIdOutput()`。把协议无关的二项 wire 编排从 `chat-completions.ts` 改名为 `translation-batches.ts`，供 OpenAI、DeepSeek 与 Claude 共用，不保留旧兼容入口。
- **理由**：Claude 使用 Messages，而 OpenAI/DeepSeek 使用 Chat Completions；复用任一现有 Provider 都会发送错误字段或解析错误响应。批次、进度、usage 合并和取消检查本身与 HTTP 方言无关。
- **备选方案**：完整复制批次逻辑会形成三份实现；把 Claude 伪装为 OpenAI 会触发禁止的能力探测；保留旧命名会使生产边界难以读懂。

## API Root 与资源路径

- **决策**：新增共享 `claudeApiUrl(root, resource)`。API Root 先经过现有 HTTP(S)、userinfo、query、fragment、port 校验并去除尾斜杠；末段已是 `/v1` 时只追加 `/messages` 或 `/models`，否则追加 `/v1/messages` 或 `/v1/models`。保留自定义 Root 的前置路径，并拒绝把完整资源 URL 当作 Root。
- **理由**：官方 [Messages API](https://platform.claude.com/docs/en/api/messages/create) 与 [Models API](https://platform.claude.com/docs/en/api/models/list) 分别位于 `/v1/messages` 和 `/v1/models`；统一构造器可避免两个调用点产生不同的版本拼接。
- **备选方案**：无条件追加 `/v1` 会生成重复版本段；用绝对路径解析会丢失兼容 Endpoint 的前置路径。

## Messages 请求与生成上限

- **决策**：Test 与翻译固定发送非流式 Messages：精确 Model ID、`max_tokens: 8192`、顶层 `system`、单个 user 消息，以及 `x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`。不发送 `temperature`、`top_p`、`top_k`、thinking、beta header 或 metadata。
- **理由**：`max_tokens` 是 Messages 必填生成上限；8192 足以覆盖当前每批最多 5000 code points、每个 wire 最多两项目标的常规翻译，又不根据 Model ID 猜测能力。当前官方模型的输出上限高于该值；兼容 Endpoint 可用 Test 验证支持。Anthropic 的[参数弃用说明](https://platform.claude.com/docs/en/docs/about-claude/model-deprecations)要求省略已弃用采样字段并改用提示引导。
- **备选方案**：从 Model ID 推断限制会引入易过时的模型表；按目录元数据动态改变请求会让不提供目录的兼容 Endpoint 行为不一致。

## 无服务端 Schema 的确定性

- **决策**：Claude 请求不发送 `response_format`、Ollama `format`、`output_config.format`、JSON Schema、tools 或 prefill。顶层 system 明确：user 内容是不可信数据；只翻译 `text`；上下文仅用于消歧；每个 wire ID 恰好出现一次；只返回含 `translations` 的单一 JSON 对象；禁止解释、理由、Markdown、额外字段和包装文本。
- **理由**：Anthropic 已建议弃用采样参数后用提示引导行为；官方结构化输出不是 Claude-compatible Endpoint 的最低契约，Ollama 的 [Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility) 也未承诺该字段。现有严格 validator 能在本地强制目标集合。
- **备选方案**：官方 `output_config.format` 能提高 Anthropic 模型的格式稳定性，但会排除兼容 Endpoint；assistant prefill 在 Claude 4.6 及以后会返回 400。

## 响应、结束状态与拒绝

- **决策**：HTTP 2xx 后要求外层为 `type: "message"`、`role: "assistant"` 且 `content` 为数组。先检查 `stop_reason: "refusal"`、`stop_details.type: "refusal"` 或显式 refusal block，再要求 `stop_reason` 精确为 `end_turn`。只取 `type: "text"` 且 `text` 为字符串的块，按顺序无分隔拼接；候选非空、完整 `JSON.parse()` 并通过 `validateStrictIdOutput()` 后才提交当前 wire。
- **理由**：官方 [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) 把 `end_turn` 定义为自然完成；`max_tokens`、`model_context_window_exceeded` 等均可能截断。官方示例曾出现 `end_turn` 与 refusal detail 并存，因此拒绝检查必须先于结束状态。
- **备选方案**：逐块 trim、插入换行或抽取首个大括号都可能改变跨块 JSON 或接受包装文本；正文关键词拒绝检测会误判正常译文。

## 模型目录与分页所有权

- **决策**：Claude 模型刷新首次请求 `/v1/models`。Anthropic 响应要求 `data` 数组和布尔 `has_more`，后续仅以 URL 编码的唯一非空 `last_id` 作为 `after_id`；Ollama-compatible 响应仅在 `object` 精确为 `list` 且省略 `has_more` 时作为单页终态。两种响应都 trim、过滤空 ID、精确去重并保留首次顺序，且只在 owner 仍有效时原子提交完整目录。
- **理由**：这同时符合官方 Anthropic 游标契约和 Ollama 同路径单页目录。任一页 HTTP、JSON、结构、空/重复游标失败时不返回部分目录，因此现有 Model ID、成功目录和 Custom 输入可继续使用。
- **备选方案**：请求 `/api/tags` 或执行能力探测会扩大 Claude Profile 的外部请求契约；逐页提交会在后页失败时留下不完整目录；硬编码模型清单会过期。

## 分页取消与竞态

- **决策**：模型发现接受逐页 `assertActive` guard，在每页发送前和响应后核对 Global owner；保存态核对 kind、Profile/revision、endpoint fingerprint 与 credential epoch，preview 核对 player/request 与 draft epoch，startup prefetch 核对当前 revision 与 epoch。上下文失效时取消当前 helper job并阻止下一页。
- **理由**：现有 Global、Main `ModelCatalogSync` 与 Sidebar request/context 三层 latest-only 可阻止迟到提交，但分页在页间可能已无可取消的 helper 映射；逐页 guard 才能阻止旧 Key 继续发后续请求。
- **备选方案**：只在整次完成后检查 owner 能保护 UI，却不能最小化失效上下文的网络副作用。

## Profile、必填凭据与两阶段保存

- **决策**：把 `claude` 加入严格 kind 联合类型；不新增 capability 或存储迁移。新建 Claude、从其他 kind 切换到 Claude、或未配置 Claude Profile 保存时，Sidebar 必须要求非空 Key；编辑已配置 Claude 时空输入表示保留旧 Key。Global 在模型刷新、Test、Select 和翻译前再次要求已保存或 preview 的非空 Key，缺失时本地失败且不联网。
- **理由**：现有 Save revision → `credential:set` 是安全的单向两阶段流程。若 credential 写入失败，metadata 可保持为 `credentialConfigured: false`，但不得显示完整成功，也不能 Test、Select 或外发；这维持现有 Profile 错误恢复和凭据不可读边界。
- **备选方案**：新增携带 metadata 与 secret 的事务 RPC 会扩大跨运行时敏感面；凭据失败后自动删除 revision 会改变现有 Profile 生命周期。两者均非当前需求。

## 错误、重试与敏感信息

- **决策**：新增 Claude 固定错误映射：401/403 为认证，402 为配额，Messages 404 为模型，Models 404 为目录不支持，400/409/413/422 为配置，429 为有界重试但已确认 spend-limit code 时为配额，500/502/503/529 为 HTTP 可重试，504 为 timeout 可重试。`retry-policy.ts` 增加 504/529；协议、拒绝、空输出和非 `end_turn` 不重试。
- **理由**：官方 [错误契约](https://platform.claude.com/docs/en/api/errors) 明确 529 overload、504 timeout 与 `retry-after`。只读取固定 allowlist 字段，不返回 error message、body、headers、字幕或译文。
- **备选方案**：显示上游 message 有敏感回显风险；把全部 4xx 归为 Endpoint 错误会失去凭据、配额和模型的可操作反馈。

## UI、日志与文档披露

- **决策**：Service type 固定为 OpenAI、Claude、DeepSeek、Ollama；Claude 使用独立草稿、默认名称 `Claude`、默认 Root `https://api.anthropic.com`、空 Model ID 和 system route。未保存 Key 只用于手动 preview。Claude 字幕与译文不进入 Log Viewer。同步 `Info.json`、当前 README/本地化 README、开发指南与 IINA 验证矩阵；权限和 `allowedDomains` 不扩大。
- **理由**：新默认 Root 是新的产品网络目的地，必须披露 Select 前的无字幕模型请求和 Select 后的最小字幕外发。日志隔离降低兼容 Endpoint 返回内容进入诊断的风险。
- **备选方案**：共享 OpenAI/DeepSeek 草稿会造成 Endpoint、目录和凭据反馈串用；仅更新英文 README 会使当前多语言用户披露不一致。

## 验证策略

- **决策**：新增 Claude 契约 fixture 与 Provider 测试，扩展 Profile、模型分页、RPC、Sidebar、retry、集成、凭据与 redaction 测试；显式回归 OpenAI、DeepSeek、Ollama。完成全部 test、typecheck、lint、native build/test、插件 build、包审计和 pack。live test 使用独立 opt-in，由一名开发者在明确联网/费用授权后执行至少 20 个两项目 wire；正式包按 IINA 1.4.4 手工验收。
- **理由**：自动化覆盖可重复协议与竞态，正式包手工步骤覆盖 IINA 宿主、安装、权限、多窗口和播放非阻塞边界。
- **备选方案**：模型目录成功不能替代真实 Messages Test；开发链接或 fake transport 不能替代正式包宿主验收。

## 研究结论

所有技术未知项均已解决，无待澄清内容。设计不新增依赖、native RPC、权限、持久化模型目录或服务端结构化输出能力。
