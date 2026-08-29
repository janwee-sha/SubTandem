# 契约：Claude Profile、凭据与模型目录

## Profile kind 与安全视图

所有现有严格联合类型增加 `claude`，不新增 Claude 专属 RPC 名称。持久 Profile metadata：

```json
{
  "profileId": "profile-id",
  "displayName": "Claude",
  "kind": "claude",
  "endpoint": "https://api.anthropic.com",
  "model": "exact-model-id",
  "proxyMode": "system"
}
```

发往 Main/Sidebar 的安全视图：

```json
{
  "profileId": "profile-id",
  "revision": 1,
  "displayName": "Claude",
  "kind": "claude",
  "endpoint": "https://api.anthropic.com",
  "endpointFingerprint": "opaque-fingerprint",
  "proxyMode": "system",
  "model": "exact-model-id",
  "credentialConfigured": true
}
```

安全视图不得包含 Key、credential object、分页 cursor、原始 Provider 数据或内部 owner。Claude 不使用或持久化 OpenAI capability。

## 保存与凭据

`profile:create-revision` 沿用现有 metadata payload；API Key 只通过后续 `credential:set` 单向发送。

- 新建 Claude、由其他 kind 改为 Claude或未配置 Claude 时，Sidebar 在 Key 为空时不得发送保存。
- Global 不信任 UI；缺少非空 Key 的 Claude 不得执行模型网络请求、Test、Select 或翻译。
- 已配置 Claude 编辑 metadata 时，空 Key 表示保留当前 Profile-scoped Key。
- 新 Key 写入成功后 credential epoch 递增，取消该 Profile 的旧翻译、Test 与模型 owner，并清除 provider cache 与目录。
- kind 改变前取消 owner并删除旧 Key；旧服务 Key 不得进入 Claude，Claude Key 也不得进入其他服务。
- credential 写失败时 metadata 可以保持未配置，但 UI 必须报告部分失败；该 revision 不可联网或被选择。
- 删除必须先取消相关 owner，再删除 Key、Profile revisions、选择、lease、cache 与目录；失败不得报告删除成功。

## 选择与授权

`profile:select` 继续提交 `profileId`、`revision`、`endpointFingerprint`。Global 在授权前确认：

1. Profile/revision 存在且为最新可选择状态；
2. fingerprint 与保存的 kind、Endpoint 和 route 一致；
3. Claude 已存在非空保存 Key；
4. 当前窗口发起选择。

Test 不自动 Select。编辑 revision、kind 改变或删除使相应窗口选择失效；其他窗口仍沿用项目既有 revision/lease 契约。只有当前窗口明确选择的精确 revision 能建立 Messages wire。

## Models URL 与请求

| API Root | 首页 URL |
| --- | --- |
| `https://api.anthropic.com` | `https://api.anthropic.com/v1/models` |
| `https://host/base/v1/` | `https://host/base/v1/models` |

每页：

```http
GET {modelsUrl}[?after_id={encodedCursor}]
x-api-key: {non-empty current key}
anthropic-version: 2023-06-01
```

首次不发送 cursor；只使用 `after_id`，不发送 `before_id`、固定 model filter 或内置 Model ID。未保存 Key 只能通过手动 `provider:models-preview` 用于本次请求。

## 分页响应

```json
{
  "data": [
    { "id": "model-a" },
    { "id": "model-b" }
  ],
  "has_more": true,
  "last_id": "model-b"
}
```

规则：

- 每页必须为 object，`data` 必须为数组，`has_more` 必须为 boolean。
- 只收集 `data[].id` 中 trim 后非空的字符串；跨页精确、区分大小写去重，保留首次顺序。
- `has_more: true` 时，页面必须有非空且尚未使用的 `last_id`；空 `data`、空 cursor 或重复 cursor 均使整次刷新失败。
- 下一页使用 URL 编码后的 `last_id`；每页重复发送两个必填认证/版本头。
- `has_more: false` 时结束；只有此时且 owner 仍有效，才一次提交完整 `models`。
- 任一页 HTTP、JSON、结构或 cursor 失败时不返回已累积的部分目录。

Claude-compatible Endpoint 可以只实现 Messages。`/v1/models` 404、无效或不支持时显示安全错误，保留当前 Model ID、上次成功目录与 Custom 输入，不降级解析 OpenAI/Ollama 目录。

## 请求 owner

保存态 context 至少包含：

```text
kind + endpoint + proxyMode + profileId + profileRevision
+ endpointFingerprint + credentialEpoch + player/request sequence
```

preview context 还必须包含 `draftCredentialEpoch`，但不得包含 Key 值。分页每页发送前和响应后核对相同 owner：

- Global `activeModelRequests` 保护窗口级 helper job；
- `ModelCatalogSync` 保护 Main 窗口当前 request/context；
- Sidebar 以 requestId 与 editor context signature 拒绝迟到反馈；
- startup prefetch 逐页核对 Profile revision 与 credential epoch。

manual、credential、Service type、Endpoint、route、Profile、revision、Key 输入或窗口变化会 supersede 旧 owner。失效 owner 取消当前 helper job，且不得继续发下一页、提交目录或覆盖反馈。

## 模型结果

成功沿用通用安全结果：

```json
{
  "requestId": "request-id",
  "ok": true,
  "contextKey": "opaque-context-key",
  "models": ["model-a", "model-b"]
}
```

失败只返回通用 allowlist 字段：

```json
{
  "requestId": "request-id",
  "ok": false,
  "contextKey": "opaque-context-key",
  "category": "authentication",
  "retryable": false,
  "code": "CLAUDE_MODELS_HTTP_401",
  "userAction": "CHECK_CREDENTIALS"
}
```

结果不得包含 Key、请求 header、Endpoint、cursor、Profile 内部状态、response body 或任意上游 message。

## 兼容数据

- 既有 `openai`、`deepseek`、`ollama` metadata 原样恢复，不改名、不迁移、不重算为 Claude。
- 现有 Provider 的 Endpoint 规范化、认证 header、模型路径、解析、Test 与翻译契约不改变。
- 同一 Endpoint 用不同 kind 保存时，fingerprint、草稿、目录、凭据 owner 与 Provider cache 必须保持隔离。
