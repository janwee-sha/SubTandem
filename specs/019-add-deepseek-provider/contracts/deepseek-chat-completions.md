# 契约：DeepSeek Chat Completions

## 请求边界

DeepSeek Test 与翻译必须经 Global 的现有 `ProviderTransport` 和 loopback helper 发出，沿 Profile 的 `system` 或 `direct` route，继续服从现有 URL、同源重定向、取消、超时、响应大小和响应头 allowlist。

```http
POST {normalizedApiRootWithoutTrailingSlash}/chat/completions
Content-Type: application/json
Authorization: Bearer {apiKey}
```

- `Authorization` 只在当前 Profile 具有非空 Key 时发送。
- 不发送本地 player/session/profile 身份 header、cookie、query、JSON Schema 或其他凭据。
- Test timeout 为现有 10 秒边界，翻译 timeout 与最大 1 MiB 响应边界保持现状。

## 请求 body

```json
{
  "model": "exact-model-id",
  "stream": false,
  "temperature": 0,
  "thinking": { "type": "disabled" },
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "safe translation and JSON instructions" },
    { "role": "user", "content": "{\"targets\":[...]}" }
  ]
}
```

精确约束：

- `response_format` 的唯一字段是 `type: "json_object"`；不得出现 `json_schema`、`schema`、`strict`、`name` 或嵌套 `json_object`。
- `thinking` 每次均为对象 `{ "type": "disabled" }`；不得省略或由模型名推断。
- `temperature` 每次均为 `0`；不得因关闭 thinking 而移除。
- system message 必须包含单词 JSON、只返回一个 JSON object、`translations` 数组示例、当前每个 wire ID 恰好一次、无额外 ID和非空译文要求；示例不是 JSON Schema。
- user message 只能是包含临时 wire target 的 JSON 数据；字幕和相邻上下文均视为不可信数据，不得改变 system 指令。

Test 必须在每次用户操作时发送新的同形 POST，并完成响应校验；模型目录、缓存或旧 Test 状态不得代替。

## 成功响应

外层必须是完整 JSON object，且：

1. `choices` 是非空数组，只读取第一项；
2. `finish_reason` 不得为 `length`、`content_filter` 或其他明确失败状态；
3. `message.content` 必须是非空字符串；
4. content 必须整体解析为单一 JSON object，不接受 Markdown fence、前后自然语言或局部大括号提取；
5. 顶层只能包含所需 `translations`；数组长度等于请求 ID 数；
6. 每项只能包含字符串 `id` 与 `text`，ID 必须属于请求集合且恰好一次，`text.trim()` 必须非空；
7. 任一条件失败时，该 wire 不调用 progress，不写 cache，不显示任何子集。

成功后才恢复原字幕 ID。允许从外层 `usage.prompt_tokens/completion_tokens` 提取数值计数，并从 helper 放行的 `x-request-id` 提取符合安全格式的请求 ID；其余响应字段全部丢弃。

## 安全错误

| 条件 | category | retryable | userAction |
| --- | --- | --- | --- |
| HTTP 401/403 | `authentication` | false | `CHECK_CREDENTIALS` |
| HTTP 402 | `quota` | false | `CHECK_QUOTA` |
| HTTP 429 | `http` | true | `CHECK_NETWORK` |
| HTTP 400/422 | `configuration` 或 `protocol` | false | `CHECK_ENDPOINT` |
| HTTP 500/503 | `http` | true | `CHECK_NETWORK` |
| `content_filter` 或明确拒绝 | `refusal` | false | `CHECK_ENDPOINT` |
| `length`、空 content、畸形外层/内容/ID | `protocol` | false | `CHECK_ENDPOINT` |
| transport timeout/network/cancel | 现有安全分类 | 现有规则 | 现有规则 |

DeepSeek 只生成本地固定 allowlist code；不得把任意上游 `error.code`、`error.type`、message、body 或 header 送入 Main、Sidebar、日志或诊断。失败不阻塞原视频或原字幕。

## 批次与取消

- 继续用 `encodeWireItems()` 把原字幕 ID 映射为 `c1`、`c2`，每个 Chat Completions wire 最多 2 项。
- 每个 wire 独立完成全量校验；已成功提交的前序 wire 不回滚，失败 wire 零提交。
- request、Profile revision、选择、媒体、窗口或会话失效时，取消所有匹配 helper job 并拒绝迟到 progress/终态。
- 重试只由现有播放会话策略发起，不由 helper 自动重放，不新增无限或持久重试。
