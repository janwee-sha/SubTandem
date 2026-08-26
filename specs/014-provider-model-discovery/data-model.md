# 数据模型：服务模型发现与凭据扩展

## Provider Profile

既有持久配置，仍以 `profileId + revision` 标识不可变快照。

| 字段 | 约束 |
| --- | --- |
| `profileId` | UUID；同一 Profile 的凭据和删除生命周期键。 |
| `revision` | 从 1 单调递增；保存新配置时生成新快照。 |
| `displayName` | 用户名称；既有值一律保留，新建表单的系统默认值为 `OpenAI` 或 `Ollama`。 |
| `kind` | `openai` 或 `ollama`；持久值不因可见名称变化而迁移。 |
| `endpoint` | 规范化的完整 HTTP(S) API Root。 |
| `endpointFingerprint` | `kind + endpoint + proxyMode` 的不透明摘要。 |
| `proxyMode` | `system` 或 `direct`。 |
| `model` | 唯一权威 Model ID；已知项和自定义项使用同一字段。 |
| `credentialConfigured` | 只读派生状态；持久 Profile metadata 不含密钥。 |

关系：一个 Profile 有多个历史 revision、一个当前 revision、至多一个按 `profileId` 保存的 Provider 凭据，以及零个或多个运行期发现上下文。列表刷新不创建 revision、不改变 `model`、不创建选择或租约。

## Provider 凭据权威

| 字段 | 约束 |
| --- | --- |
| `profileId` | 与单个 Provider Profile 关联。 |
| `apiKey` | 可选、最长 8192 字符；只存在于 Sidebar 保存消息的瞬时路径、Global、helper 与出站 Authorization。 |
| `configured` | 传给 Main/Sidebar 的布尔状态；不得由其反推出值。 |
| `credentialEpoch` | Global 生命周期内从 0 单调递增；成功替换或删除时变化，不持久化、不含密钥材料。 |

成功替换后取消该 Profile 的活动发现、Test 与翻译任务，清除全部 revision Provider cache 和旧目录；保存失败保持旧 epoch 与旧凭据权威。

## 草稿凭据刷新

仅存在于一次手动模型刷新生命周期，不属于 Provider Profile 或凭据存储。

| 字段 | 约束 |
| --- | --- |
| `apiKey` | Sidebar 当前非空输入；最长 8192 字符，只可进入严格草稿请求与本次出站 Bearer。 |
| `draftCredentialEpoch` | 当前窗口内从 1 单调递增；输入 Key 变化即递增，用于使旧结果失效，不含 Key 派生材料。 |
| `requestId` | 当前窗口最新手动请求；结果只可由同一 owner 接收。 |

草稿 Key 不持久化、不回显、不进入上下文摘要或模型目录缓存。草稿刷新成功只更新当前 Sidebar 的已知模型；保存完整 Profile 后仍由既有 revision 与凭据流程建立权威状态。

## 模型发现上下文

一次目录请求的不可变身份。

| 字段 | 约束 |
| --- | --- |
| `requestId` | 每个窗口模型区域单调且唯一；手动刷新始终创建新值。 |
| `trigger` | `startup`、`open`、`endpoint`、`profile`、`credential` 或 `manual`。 |
| `playerId` | Main/Sidebar 请求的窗口归属；启动预取为空。 |
| `kind` | `openai` 或 `ollama`。 |
| `endpoint` | 已通过生产规范化的 HTTP(S) Endpoint；不得进入反馈或日志。 |
| `endpointFingerprint` | 不透明上下文比较值。 |
| `proxyMode` | `system` 或 `direct`。 |
| `profileId` / `profileRevision` | 可选；只有与权威快照完全匹配时才授权读取凭据。 |
| `credentialEpoch` | Global 内部值；草稿匿名上下文为 0。 |
| `contextKey` | 上述非敏感上下文字段的摘要；草稿请求可加入窗口、request ID 与 `draftCredentialEpoch`，但不包含 Model ID、API Key、字幕或播放状态。 |

身份规则：Service type、Endpoint、网络路线、Profile、revision、凭据 epoch 或窗口请求所有权任一变化都会使旧操作失效。草稿上下文即使来自正在编辑的已保存 Profile，只要与权威快照不完全相同，也不得携带已保存凭据。

## 模型目录

某个完整发现上下文最近一次成功响应的运行期快照。

| 字段 | 约束 |
| --- | --- |
| `contextKey` | 唯一目录键；不同上下文不得合并。 |
| `modelIds` | 零个或多个精确字符串；trim、过滤空值、区分大小写去重，保持首次出现顺序。 |
| `commitSequence` | Global 或 Main 内部单调值，只允许最新权威成功提交。 |

目录不持久化，不包含原始响应、`owned_by`、Ollama 详情、凭据或时间历史。成功空数组替换旧目录；失败、取消、迟到和无效响应不改变旧目录。Global 目录用于启动预取与权威失效，Main/Sidebar 快照只服务所属窗口。

## 刷新操作

| 字段 | 约束 |
| --- | --- |
| `requestId` | 与跨运行时响应关联。 |
| `contextKey` | 必须仍等于当前表单或 Profile 上下文。 |
| `trigger` | 区分可合并的自动请求与必须取代旧请求的手动操作。 |
| `jobId` | native transport 取消身份，不暴露给 UI。 |
| `state` | `pending`、`succeeded`、`failed`、`cancelled` 或 `stale`。 |
| `safeError` | 仅含 category、允许的 status/code、retryable 与 userAction。 |

状态转换：

```text
idle/stale ──有效触发──> pending
pending ──同上下文最新成功──> succeeded ──提交目录
pending ──同上下文最新失败──> failed ──保留旧目录
pending ──新请求/上下文变化/删除/凭据变化──> stale 或 cancelled
stale/cancelled ──迟到结果──> 丢弃
```

等价自动触发可共享已有 pending 操作；手动与凭据成功触发必须成为新 owner。旧请求不得清除较新请求的 busy 或反馈。

Profile revision 创建成功时，Main 立即把安全 Profile view 插入或替换到逐窗口列表，并使创建前的列表请求失效；后续权威列表请求只负责收敛凭据状态与模型目录等派生字段。

## Model ID 控件状态

| 字段 | 约束 |
| --- | --- |
| `value` | 当前唯一 Model ID；保存时 trim 后必须非空。 |
| `mode` | `known` 或 `custom`。 |
| `knownModelIds` | 当前目录的精确副本，可为空。 |
| `contextKey` | 目录归属；切换上下文不得沿用其他目录。 |
| `refreshState` | `idle`、`busy`、`success` 或 `error`；反馈属于模型区域。 |

若 `value` 存在于 `knownModelIds`，模式为 `known`；否则为 `custom`。新目录只改变模式与选项，不改变 `value`。选择已知项把其精确 ID 写入 `value`；选择 Custom 后由文本输入维护 `value`。自动或手动刷新不保存 Profile、不 Test、不 Select、不发字幕。

## 用户可见 Provider 身份

| 内部值 | 当前可见名称 | Endpoint 语义 |
| --- | --- | --- |
| `openai` | OpenAI | OpenAI API 契约兼容的任意有效自定义 HTTP(S) API Root。 |
| `ollama` | Ollama | Ollama API 契约兼容的任意有效自定义 HTTP(S) server root。 |

用户文档、Sidebar 类型选项、默认 Profile 名、Profile 行和当前反馈使用可见名称；内部类名、kind、旧 revision 与网络路线不变。
