# 数据模型：添加 DeepSeek 翻译服务

## Provider 身份

| 内部值 | 可见名称 | Chat/模型路径 |
| --- | --- | --- |
| `openai` | OpenAI | 既有兼容契约，保持不变。 |
| `deepseek` | DeepSeek | `{API Root}/chat/completions`、`{API Root}/models`。 |
| `ollama` | Ollama | 既有 Ollama 契约，保持不变。 |

`kind` 进入 Profile snapshot、Endpoint fingerprint、模型上下文、Sidebar 草稿和 Provider factory。不同 kind 即使 Endpoint、Model ID 或 Profile 名相同，也不得共享目录、凭据反馈、请求 owner 或 Provider 实例。

## DeepSeek Profile

持久配置，继续以 `profileId + revision` 标识不可变快照。

| 字段 | 约束 |
| --- | --- |
| `profileId` | 稳定 UUID；凭据和删除生命周期键。 |
| `revision` | 从 1 单调递增；任何保存产生新 revision。 |
| `displayName` | 新建草稿系统默认 `DeepSeek`；用户可编辑；已保存名称不会因切换 Service type 自动改写。 |
| `kind` | 固定为 `deepseek`。 |
| `endpoint` | 规范化后的完整 HTTP(S) API Root；默认 `https://api.deepseek.com`；不得含用户信息、query 或 fragment。 |
| `endpointFingerprint` | `kind + endpoint + proxyMode` 的不可逆身份，用于 Select 与请求所有权。 |
| `model` | trim 后非空的精确自定义或目录 Model ID；产品不预置、不推荐、不改写。 |
| `proxyMode` | `system` 或 `direct`。 |
| `credentialConfigured` | 只存在于安全 view 的派生布尔值；不代表 Key 可读。 |
| `capability` | DeepSeek 不保存该字段；输出能力固定为 JSON object。 |

关系：一个 Profile 有多个历史 revision，但列表、编辑和新选择只使用最新 revision；一个窗口最多选择一个精确 revision；一个 Profile ID 最多关联一份 Provider Credential。

## Provider Credential

| 字段 | 约束 |
| --- | --- |
| `profileId` | 关联唯一 Profile。 |
| `apiKey` | 非空只写值；只在 helper 私有文件中保存，权限沿用 `0700/0600`。 |
| `credentialEpoch` | Global 内存中的单调代次；替换或清理时使旧目录、Provider、Test 和翻译 owner 失效。 |

Key 值不得进入 Profile metadata、安全 view、preferences、模型目录、context key、日志、诊断、进程参数、安装包或 UI 状态。手动刷新使用的未保存 Key 只属于当次 preview request，不创建 Provider Credential。

kind 变化时执行凭据转换：

```text
旧 revision + 旧 kind Key
  ──校验新配置──> 待转换
  ──清理旧 Key/owner 成功──> 新 kind revision，credentialConfigured=false
  ──清理失败──> 保留旧 revision + 旧 Key，不发布新 revision
```

新 kind 必须由用户显式写入新 Key；不得把旧 kind 的 Key 继承到新 revision。

## DeepSeek 模型目录

| 字段 | 约束 |
| --- | --- |
| `contextKey` | kind、Endpoint、route、可选 Profile/revision/fingerprint 与 credential epoch 的非敏感摘要。 |
| `models` | `GET /models` 的 `data[].id` 清洗结果；精确去重、保持顺序，可以为空。 |
| `commitSequence` | 仅允许仍属当前 owner 的最近成功结果提交。 |

目录只保留在运行期，不含 Key、原始响应、`owned_by`、价格或推荐信息。成功空数组替换旧目录；失败、取消、迟到和无效响应保留上次成功目录与当前自定义 Model ID。

刷新状态：

```text
idle/stale ──有效触发──> pending
pending ──同上下文最新成功──> succeeded ──提交目录
pending ──同上下文最新失败──> failed ──保留目录
pending ──kind/Endpoint/route/Profile/Key/window/owner 变化──> stale/cancelled
stale/cancelled ──迟到结果──> 丢弃
```

## DeepSeek 翻译请求

瞬时请求，属于精确 Profile revision、窗口、播放会话和 wire。

| 字段 | 约束 |
| --- | --- |
| `playerId` | Main 与 Global 各自使用所属身份空间；Global 以 IINA 发送方身份完成授权。 |
| `sessionId/sessionEpoch/windowEpoch` | 会话、媒体窗口变化时拒绝迟到提交。 |
| `profileId/profileRevision/endpointFingerprint` | 必须与窗口当前明确选择完全一致。 |
| `requestId/batchId/jobId` | 分别用于业务、调度与 helper 取消；不得包含凭据或字幕。 |
| `sourceLanguage/targetLanguage` | 当前任务语言。 |
| `items` | 每个 wire 最多 2 个临时 ID、目标正文和可选相邻上下文；原始字幕 ID 在发送前映射为 `c1`、`c2`。 |
| `model` | Profile 的精确 Model ID。 |
| `responseFormat` | 固定 `{ "type": "json_object" }`。 |
| `thinking` | 固定 `{ "type": "disabled" }`。 |
| `temperature` | 固定 `0`。 |

请求不包含 JSON Schema、thinking UI 值、Provider capability、原始字幕身份、持久缓存键或本地会话 header。Test 使用同一请求契约，但只含一个固定的无敏感探针目标，并且每次都真实发送。

## DeepSeek wire 结果

| 字段 | 约束 |
| --- | --- |
| `translations` | 数量必须等于请求 ID 数量；每项只有唯一请求 ID 与 trim 后非空译文。 |
| `providerRequestId` | 仅在响应头已被 helper 允许且符合安全格式时保留。 |
| `usage` | 只保留有限数值计数；不保留原始 usage 对象。 |
| `safeError` | 仅含 category、retryable、允许的 status/code、retryAfter 与 userAction。 |

状态转换：

```text
created ──helper 接受──> in-flight
in-flight ──取消/会话或选择变化──> stale/cancelled ──零提交
in-flight ──HTTP/外层/内容/ID 任一失败──> rejected ──该 wire 零提交
in-flight ──全部验证通过──> validated ──恢复原字幕 ID──> committed
```

先前独立 wire 已提交的渐进结果不回滚；失败 wire 不提交其任何子集。

## Sidebar DeepSeek 草稿

| 字段 | 初始值/约束 |
| --- | --- |
| `kind` | `deepseek`。 |
| `displayName` | `DeepSeek`，mode 为 `system`。 |
| `endpoint` | `https://api.deepseek.com`。 |
| `model` | 空字符串；必须由目录选择或用户精确输入后才能保存。 |
| `proxyMode` | `system`。 |
| `enteredApiKey` | 空；切换 Service type 时清空且提升 draft credential epoch。 |
| `modelCatalog` | 独立 DeepSeek context 的运行期目录。 |

OpenAI、DeepSeek、Ollama 各有独立草稿。切换类型先保存当前非敏感草稿，再载入目标草稿；API Key、pending 请求、反馈和目录不得随草稿复用。

## 选择与内容日志策略

窗口的选择状态在 `profileId/revision/endpointFingerprint` 之外携带安全的 `kind`，用于本地行为门禁。DeepSeek 的字幕正文、上下文和译文不得送入 IINA console/Log Viewer；OpenAI 与 Ollama 的既有会话内日志行为不由本功能改变。无论 kind 如何，Provider 原始请求、响应和凭据均不得记录。
