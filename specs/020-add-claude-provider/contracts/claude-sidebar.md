# 契约：Claude Sidebar

## Service type 与默认值

`Translation service` 的固定顺序：

1. OpenAI
2. Claude
3. DeepSeek
4. Ollama

新建 Claude 草稿：

| 控件 | 初始值或行为 |
| --- | --- |
| Profile name | `Claude`，在用户编辑前由系统名称状态拥有。 |
| API Root | `https://api.anthropic.com`。 |
| Model ID | 空；Custom 输入可用，不自动选择目录首项。 |
| Network route | `Use macOS proxy settings`。 |
| API Key | 空且必填；password 输入，保存后不回显。 |
| Request URL | 显示规范化后将使用的 `/v1/messages`，不得显示 `/chat/completions`。 |

Endpoint hint 必须说明输入的是完整 HTTP(S) API Root，可带兼容服务的前置路径或末段 `/v1`，不能输入完整 Messages URL。Model hint 必须说明可刷新目录或填写精确 Custom Model ID，不推荐具体模型。

## 草稿隔离

每个 Service type 独立保留 Endpoint、Model ID 和 route 草稿。切换类型时：

1. 保存离开类型的非敏感草稿；
2. 清空 API Key 输入并递增 `draftCredentialEpoch`；
3. 载入目标类型草稿和对应名称/提示；
4. 使旧模型 request、credential feedback 与保存 owner 失效；
5. 不把旧类型目录、测试状态或 Key configured 状态显示到 Claude。

新建系统名称在用户尚未编辑时随 Service type 更新为 `Claude`；用户输入或已保存 Profile 名称不得被自动覆盖。

## 模型刷新

- 未保存或未配置的 Claude 不自动发无 Key 请求；用户输入非空 Key 后可手动 Refresh。
- 手动 Refresh 使用 `provider:models-preview`，Key 只属于该 request 与 draft epoch。
- 已保存且配置 Key 的 Claude 可使用通用 open/profile/credential/manual 刷新。
- Refresh 期间按钮呈 busy；成功显示安全模型数量；失败显示认证、timeout 或 HTTP 分类，不显示上游正文。
- 成功目录不覆盖当前仍合法的 Custom Model ID；失败保留当前值和上次成功目录。
- Endpoint、route、Service type、Profile、revision、Key 输入或 requestId 改变后，迟到结果不得改变目录、反馈或控件模式。

## Save

Save 前必须满足有效 Root、非空精确 Model ID，以及以下 Key 规则：

| 场景 | Key 输入 |
| --- | --- |
| 新建 Claude | 必须非空。 |
| 其他 kind 改为 Claude | 必须非空；旧 Key 不继承。 |
| 编辑 `credentialConfigured=false` 的 Claude | 必须非空。 |
| 编辑 `credentialConfigured=true` 的 Claude | 可空；空表示保留保存 Key。 |

不满足时不发送保存消息，显示可操作错误并聚焦对应控件。保存采用现有 metadata revision → credential 两阶段消息：

- metadata 失败：保持编辑器内容，报告失败。
- metadata 成功且无需替换 Key：报告 Profile 保存成功。
- metadata 成功且等待 Key：在 `credential:state=ready` 前保持 saving。
- Key 保存失败：报告 Profile 已保存但凭据失败，不显示完整成功；该 Profile 显示 `no key saved`，不可 Test/Select。
- 保存响应只有在 requestId、Profile/revision 与 editor signature 均匹配时才能覆盖当前反馈。

## Test、Select、Edit 与 Delete

- Test 只对按钮所属当前 revision 发真实 Messages 请求；成功只把该 revision 的 Test 状态标为 passed，不自动 Select。
- 缺 Key 的 Claude Test 和 Select 在 Global 本地拒绝；不得产生 Provider 网络请求或授权字幕。
- Select 成功后当前窗口显示 Selected，并把精确 Profile/revision/fingerprint/kind 交给 Main。
- 编辑保存产生新 revision；当前编辑窗口的旧选择失效并提示重新 Select，旧 Test 状态不得沿用。
- kind 改变要求新服务凭据；旧 Claude Key 清理后不得回到任何编辑器状态。
- Delete 使用现有确认提示；成功后移除 Profile、测试状态与当前选择，并显示 Key 已删除。失败时列表保持权威状态。

## 安全反馈

Claude Test 的 `CHECK_ENDPOINT` 文案必须指向 API Root、`/v1/messages`、版本兼容和精确 Model ID，不得回退为 OpenAI Chat Completions 或 Ollama chat 文案。

允许显示：

- 安全 HTTP status；
- authentication、quota、timeout、network、model、configuration、protocol、refusal 类别；
- 固定 user action；
- 模型数量与 Key configured 状态。

禁止显示：

- API Key 或认证 header；
- 完整 request/response body；
- 字幕、上下文或译文；
- 上游 error message、refusal explanation 或任意未知 code；
- 旧 Profile/Service type 的迟到反馈。

错误和等待不得关闭原字幕、暂停播放或阻塞 Sidebar 其他 Profile 操作。

## 通用消息映射

Claude 只扩展通用 payload 的 `kind: "claude"`：

| Sidebar 消息 | Main → Global | 结果 |
| --- | --- | --- |
| `profile:save` | `profile:create-revision` | `profile:revision-created` / `operation:error` |
| `secret:set` | `credential:set` | `credential:state` / `credential:result` |
| `provider:models` | 同名 | `provider:models-result` |
| `provider:models-preview` | 同名 | `provider:models-result` |
| `provider:test` | 同名 | `provider:test-result` |
| `profile:select` | 同名 | `profile:selected` |
| `profile:delete-request` | `profile:delete` | `profile:deleted` / `operation:error` |

不得新增携带 Key 的 Profile 消息、Claude 专属消息名或可读凭据 RPC。所有严格解析器必须拒绝未知 kind、额外敏感字段和非法 owner 组合。

## 可访问性与状态

- 模型、保存、Test、Select 与 Delete 的 busy/success/error 继续通过现有 `role=status`、`aria-live` 和 `aria-busy` 呈现。
- 自动刷新不得抢占当前可见的手动操作反馈；迟到结果不得重新启用已被新 owner 占用的控件。
- 列表摘要显示 `Claude`、精确 Model ID、route 与 `key saved`/`no key saved`，不显示 Key 或自动推荐语。
