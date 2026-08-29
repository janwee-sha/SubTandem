# 契约：DeepSeek Profile、凭据与模型目录

## Profile 保存与安全 view

现有 Profile/RPC 名称保持不变，只扩展严格 `kind` allowlist：

```json
{
  "displayName": "DeepSeek",
  "kind": "deepseek",
  "endpoint": "https://api.deepseek.com",
  "proxyMode": "system",
  "model": "exact-model-id"
}
```

- 新建草稿的系统默认名称为 `DeepSeek`，默认 API Root 为 `https://api.deepseek.com`；两者均可按现有规则编辑。
- `model` trim 后必须非空，但只能来自服务返回值或用户精确输入；不得预置、推荐、猜测或自动选择。
- 保存生成新 revision；编辑当前所选 Profile 后，旧选择失效并要求重新 Select。
- 持久恢复必须接受 `deepseek`，且不迁移、不改写任何既有 `openai`/`ollama` Profile。
- 返回 Sidebar/Main 的安全 view 只含 metadata、`credentialConfigured` 和可选运行期目录，绝不含 Key 或 capability。

## 凭据生命周期

- DeepSeek 复用现有 `apiKey` 字段、Profile ID 键和 helper 私有存储。
- 保存后 Main/Sidebar 只能得到 `credentialConfigured`；编辑表单不回填 Key。
- Key 替换成功时递增 credential epoch，取消该 Profile 的旧模型请求、Test 与翻译，清除全部 revision 的 Provider cache 与模型目录；失败时旧 Key 继续权威。
- 删除 Profile 时先清理活动 owner 与 Key，再删除 revision、选择、lease、目录、cache 与代次；无关 Profile 不变。
- kind 变化时不得继承旧 Key。只有旧 Key 和 owner 已安全清理后才能发布新 revision；清理失败则保留旧 revision。新 kind Key 必须由用户重新输入。
- 凭据保存反馈只在 request/profile/revision 与当前编辑器 owner 都匹配时显示；迟到反馈不得覆盖其他 Service type/Profile 的当前状态。

## 模型目录 HTTP

```http
GET {normalizedApiRootWithoutTrailingSlash}/models
Authorization: Bearer {apiKey}
```

- 请求必须经过现有 helper，使用当前 route、10 秒 timeout 和 1 MiB 响应上限；body 为空。
- 已保存 Profile 只有在 kind、Endpoint、route、revision 与 fingerprint 全部匹配 Global 权威 snapshot 时才可读取 Key。
- 未保存 Key 只能由用户手动触发 `provider:models-preview`，只用于当次请求，不缓存、不持久化、不回传。
- 请求不含 Model ID、字幕、译文、播放位置、选择或本地身份。

成功响应必须是对象且 `data` 为数组：

```json
{
  "object": "list",
  "data": [{ "id": "model-id", "object": "model", "owned_by": "provider" }]
}
```

只读取 `id`。按响应顺序 trim、丢弃空值、用区分大小写的精确值去重并保留首次出现；忽略 `owned_by` 和其他字段。合法空数组是成功并清空已知项；畸形结构、非 2xx、timeout、取消或迟到结果不改变上次成功目录。

## 消息与竞态

继续使用现有：

- `provider:models`
- `provider:models-preview`
- `provider:models-result`
- `profile:save/create-revision`
- `secret:set/credential:set`
- `provider:test`
- `profile:select/release/delete`

只扩展所有相关 payload、安全 view 与 context token 的 kind 为 `openai | deepseek | ollama`。不新增 `deepseek:*` 消息。

模型结果必须依次通过：Global helper-job owner、Main `ModelCatalogSync` owner、Sidebar request ID 与完整表单 context。kind、Endpoint、route、Profile/revision/fingerprint、credential epoch、draft credential epoch、窗口或 owner 变化后，旧结果完全忽略，不得改变目录、Model ID、feedback、Test、Select 或翻译授权。

## 选择与字幕授权

- Refresh、Save 和 Test 均不得自动 Select。
- 只有用户明确 Select 的当前 DeepSeek `profileId + revision + endpointFingerprint` 才可接收所属窗口的最小字幕 wire。
- 编辑、kind 变化、凭据替换、删除、关窗、换片或取消会使旧请求失效。
- DeepSeek 的字幕、上下文和译文不得进入 console/Log Viewer；Profile、Key 和原始 Provider 数据对所有 kind 均不得记录。
