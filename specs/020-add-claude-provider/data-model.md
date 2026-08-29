# 数据模型：添加 Claude 翻译服务

## Claude Profile

持久 metadata，与现有 Profile 共用 IINA preferences。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `profileId` | string | 稳定唯一 ID；凭据与目录按此归属。 |
| `revision` | positive integer | 每次保存递增；只有精确 revision 可被窗口选择。 |
| `displayName` | string | 新建默认 `Claude`；用户名称 trim 后保存。 |
| `kind` | literal | 固定为 `claude`。 |
| `endpoint` | string | 完整 HTTP(S) API Root；无 userinfo/query/fragment，去除尾斜杠。 |
| `endpointFingerprint` | string | 由 kind、规范化 Endpoint 与 route 生成。 |
| `proxyMode` | `system` \| `direct` | 默认 `system`。 |
| `model` | string | trim 后非空；不预置、不猜测、不自动选择。 |
| `credentialConfigured` | boolean | 只读派生状态；不得包含 Key 值。 |

Claude 不持久化 OpenAI capability、模型目录、分页 cursor、字幕或译文。既有 Profile 无迁移。

```text
草稿 ──Save metadata──> revision N / credentialConfigured=false
revision N ──credential:set 成功──> revision N / credentialConfigured=true
revision N ──编辑保存──> revision N+1，当前编辑窗口旧选择失效
任意 revision ──kind 改变──> 取消 owner、删除旧 Key、credential epoch+1
任意 revision ──Delete──> 删除全部 revision、Key、目录、cache、lease 与选择
```

凭据写入失败时 metadata 可以保留，但 Profile 不得显示完整成功，也不得 Test、Select、刷新或翻译联网。

## Provider 凭据

只写敏感实体，由 helper 保存到插件私有 `credentials.json`。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `profileId` | string | 指向单个 Claude Profile。 |
| `apiKey` | secret string | trim 后非空，最长沿用现有消息上限；只进入 preview 或 helper。 |
| `credentialEpoch` | non-negative integer | 每次替换、删除或 kind 转换递增；只保留在 Global 内存。 |

```text
absent ──有效 secret:set──> configured
configured ──替换成功──> configured / epoch+1 / 旧 owner 取消
configured ──kind 改变或删除──> absent / epoch+1
任意状态 ──helper 失败──> unavailable，不回传 Key
```

Sidebar 与 Main 只能看到 `credentialConfigured`。未保存 Key 仅属于一次 `provider:models-preview` 请求，不进入 Profile、preferences、日志或目录。

## Claude Sidebar 草稿

逐 Service type、逐窗口的 UI 状态。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `endpoint` | string | 初始 `https://api.anthropic.com`。 |
| `model` | string | 初始空；可来自当前目录或 Custom 输入。 |
| `proxyMode` | `system` \| `direct` | 初始 `system`。 |
| `draftCredentialEpoch` | positive integer | Key 输入或 Service type 改变时递增。 |
| `enteredApiKey` | transient string | 不写入草稿映射；切换类型、加载 Profile 或保存完成后清空。 |

新建、从其他 kind 切换或 `credentialConfigured=false` 时，Claude Save 要求 `enteredApiKey` 非空；编辑已配置 Claude 时空值表示保留已保存 Key。

## Claude 模型刷新

一次分页刷新是单个原子事务。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `requestId` / `jobId` | string | 标识 Sidebar/Main owner 与当前 helper job。 |
| `trigger` | enum | 沿用 open、endpoint、profile、credential、manual、startup。 |
| `kind` | literal | `claude`。 |
| `endpoint` / `proxyMode` | string / enum | 请求创建时冻结。 |
| `profileId` / `profileRevision` | optional | 保存态请求必须精确匹配。 |
| `endpointFingerprint` | optional string | 保存态 owner 的目的地身份。 |
| `credentialEpoch` | integer | 保存态凭据身份。 |
| `draftCredentialEpoch` | optional integer | preview 凭据身份。 |
| `contextKey` | string | 上述非敏感上下文的哈希。 |
| `afterId` | optional string | 下一页 cursor；URL 编码后发送。 |
| `seenCursors` | Set<string> | 空或重复 cursor 使整次刷新失败。 |
| `models` | string[] | 跨页首次顺序、精确去重的暂存 ID。 |

```text
idle/cached ──有效触发──> pending(page 1)
pending ──has_more=true 且 owner/cursor 有效──> pending(next page)
pending ──has_more=false 且 owner 有效──> succeeded / 原子提交完整目录
pending ──HTTP、结构、cursor 或 owner 失败──> failed/cancelled / 不提交部分目录
superseded ──迟到响应──> discarded
```

每页发送前和响应后必须调用 owner guard。Claude 网络请求缺少非空 Key 时在本地失败。

## Claude 模型目录

仅内存状态，属于一个完整上下文。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `contextKey` | string | 包含 kind、Endpoint、route、Profile/revision、fingerprint 与凭据 epoch。 |
| `models` | string[] | 可以为空；每项 trim 后非空、精确唯一。 |
| `commitSequence` | non-negative integer | latest-only 提交顺序。 |

失败或不支持 `/v1/models` 时保留当前 Model ID、上次成功目录和 Custom 模式；目录不得跨窗口上下文、Service type、Endpoint、Profile 或凭据复用。

## Claude Messages wire 请求

瞬时实体，由当前选择和一个最多两项目标的 wire 组成。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `playerId`、`sessionId`、epochs | branded identity | 必须仍属于当前播放和窗口。 |
| `profileId` / `profileRevision` | identity | 必须与 Global 当前选择一致。 |
| `endpointFingerprint` | identity | 必须与选择和 Profile 一致。 |
| `requestId` / `batchId` | identity | 用于取消、重试、progress 与迟到结果拒绝。 |
| `sourceLanguage` / `targetLanguage` | language ID | 必须能解析为 provider label。 |
| `targets` | 1–2 wire items | ID 为 `c1`、`c2`；`text` 是唯一翻译目标，上下文只用于消歧。 |
| `system` | string | 严格 JSON、精确 ID、不可信数据和禁止解释约束。 |
| `userMessage` | string | `{"targets":[...]}` 的 JSON 字符串。 |
| `model` | string | Profile 的精确非空 Model ID。 |
| `max_tokens` | positive integer | 固定 8192。 |
| `stream` | boolean | 固定 false。 |

请求不得包含 `temperature`、`top_p`、`top_k`、`response_format`、`format`、`output_config`、Schema、tools、thinking 或本地会话 header。

## Claude Messages 响应候选

瞬时且在提交前不可信。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `type` / `role` | literals | 必须为 `message` / `assistant`。 |
| `stopReason` | string | 只有 `end_turn` 可继续。 |
| `refusalSignal` | boolean | stop reason、stop detail 或显式 refusal block 任一命中即拒绝。 |
| `textBlocks` | string[] | 只取合法 text block，按顺序无分隔拼接。 |
| `candidate` | string | trim 后非空且必须是单一完整 JSON。 |
| `translations` | `{id,text}[]` | 顶层仅 `translations`；数量、字段、ID 集合、唯一性与非空译文精确通过。 |
| `usage` | optional counts | 只接受有限非负 `input_tokens` / `output_tokens`。 |

```text
received
  ├── refusal signal ──> rejected(refusal)
  ├── stop_reason != end_turn ──> rejected(protocol)
  ├── text/JSON/ID 校验失败 ──> rejected(protocol)
  └── 全部通过且 owner 有效 ──> validated ──> committed(progress/result)
```

当前 wire 任一失败均零提交；已由前序 wire 完成的合法 progress 不回滚。owner 失效时 validated 结果仍不得提交。

## 关系与清理

- 一个 Claude Profile 有多个不可变 revision，但只有一个最新 metadata 和一个 Profile-scoped Key。
- 每个窗口最多选择一个精确 Profile revision；只有该选择能创建 Messages wire。
- 一个模型刷新只属于一个 context owner；一个目录只属于一个 `contextKey`。
- kind 改变、凭据替换、Profile 删除、换片、播放结束或关窗会取消对应 owner，并按现有会话规则清理瞬时请求、目录引用、字幕与译文。
