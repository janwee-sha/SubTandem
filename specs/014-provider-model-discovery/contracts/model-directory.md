# 契约：Provider 模型目录

## 公共请求边界

- 请求必须经 Global 的 `ProviderTransport` 与现有 loopback helper 发出，沿上下文指定的 `system` 或 `direct` 路线。
- 请求方法为 GET，body 必须为空，headers 只可包含协议所需字段和可选 Bearer；不得包含字幕、译文、Model ID、播放位置、选择或会话正文。
- Endpoint 必须通过现有生产 HTTP(S) 规范化；native 的 URL、同源重定向、响应头和大小边界继续生效。
- 只有请求上下文与已保存 Profile 的当前 revision、kind、Endpoint fingerprint 和网络路线完全一致时，Global 才可读取并使用该 Profile 的 API Key；其他上下文匿名请求。
- timeout 为 10 秒，响应上限为 1 MiB；取消使用 transport job ID。

## OpenAI

```http
GET {normalizedApiRootWithoutTrailingSlash}/models
Authorization: Bearer {apiKey}  # 仅已配置时
```

成功响应必须是对象且 `data` 为数组。每项只读取字符串 `id`，不读取或筛选 `owned_by`。

## Ollama

```http
GET {normalizedServerRoot}/api/tags
Authorization: Bearer {apiKey}  # 仅已配置时
```

成功响应必须是对象且 `models` 为数组。每项优先读取非空字符串 `model`；该字段无效时读取 `name`。一个条目最多产生一个 Model ID。

Ollama 的 `/api/version`、`/api/tags` 与 `/api/chat` 必须共用同一可选 Bearer 规则；空 Key 不发送 Authorization。

## 结果规范化

按响应顺序对候选值执行：

1. 只接受字符串；
2. 移除首尾空白；
3. 丢弃空值；
4. 按区分大小写的精确值去重，只保留首次出现；
5. 不排序、不折叠大小写、不改写字符。

HTTP 2xx 且结构合法时，即使结果为 `[]` 也属于成功并替换旧目录。JSON 无效、结构无效、非 2xx、超时、取消或网络失败不得更新目录。

## 安全失败

跨运行时只允许返回规范化后的：

- `category`
- `retryable`
- 可选 `statusCode`
- 可选且符合既有安全格式的 `code`
- 可选 `retryAfterMs`
- `userAction`

不得返回 Endpoint、Authorization、API Key、请求 headers、响应 body、服务错误原文、字幕、译文或播放状态。401/403 归类为 `authentication`；协议结构失败归类为 `protocol`。
