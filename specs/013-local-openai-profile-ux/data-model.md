# 数据模型：Provider HTTP 与 Profile 交互优化

本功能不新增持久化实体。Provider Profile、凭据与版本身份沿用现有存储；列表代次、删除墓碑、区域请求身份、全局操作消息和名称来源只存在于所属 Main 或 Sidebar 生命周期。

## ProviderProfile

- `profileId`：稳定 Profile 身份。
- `revision`：不可变配置修订号。
- `displayName`：用户可见名称。
- `kind`：`openai | ollama`。
- `endpoint`：通过完整 HTTP(S) URL 校验后的 API root。
- `endpointFingerprint`：由 kind、规范化 endpoint 与 proxy mode 派生。
- `proxyMode`：`system | direct`。
- `model`：目标模型。
- `credentialConfigured`：只读布尔状态；凭据值不属于 Profile View。

保存或恢复必须先校验 endpoint。失败不得创建 revision、清理选择或改变凭据。Select 继续绑定精确 `profileId + revision + endpointFingerprint`，Test 不创建选择。

## EndpointValidation

- `scheme`：`http | https`。
- `host`：URL 中非空且结构有效的主机；网络位置不参与许可判断。
- `port`：可省略，提供时必须为有效数字端口。
- `path`：Provider API root 路径。
- `normalizedEndpoint`：保留各 Provider 既有路径语义后的存储值。

以下输入无有效状态：空或相对 URL、非 HTTP(S) scheme、userinfo、query、fragment、空 host、非法端口、残缺 IPv6 或其他无效 authority。TypeScript 与 native 对共享边界 corpus 必须得到等价安全结论；native 仍是最终出站防线。

## ProfileListSyncState

- `sequence`：逐窗口严格递增的列表请求序号。
- `latestRequestId`：Main 当前允许提交的 `profiles:list` 请求身份。
- `profiles`：最近一次被接受的安全 Profile View 集合。

```text
idle --request--> pending(requestId)
pending(A) --request--> pending(B)
pending(B) --result(A)--> pending(B)，忽略 A
pending(B) --result(B)--> committed(B)
任意状态 --profile:deleted--> 立即过滤目标，再进入新的 pending
```

只有 `requestId === latestRequestId` 的结果可更新 Main 快照。请求身份不得只依赖可能碰撞的时间戳。

## SidebarProfileState

- `profiles`：按当前显示顺序保存的 Profile View。
- `deletedProfileIds`：当前 WebView 生命周期内收到权威删除成功的身份集合。
- `editingProfileId`：当前编辑目标，可为空。
- `selectedProfileId`：当前窗口选择，可为空。
- `credentialDisplayProfileId`：编辑器当前展示凭据状态的 Profile，可为空。
- `profileTests`：按 Profile 保存当前 revision 的 Test 记录。
- `latestRequestByRegion`：每个操作区域当前允许产生终态消息的最新请求身份。
- `activeFeedback`：全局唯一可见操作消息，可为空。

应用列表快照前始终过滤 `deletedProfileIds`。墓碑随 WebView 销毁，不进入 preferences；重新打开时 Global 的持久删除状态成为权威来源。

## ProfileTestRecord

- `profileId`、`revision`、`requestId`。
- `state`：`pending | passed | failed`。

只有 request、Profile、revision 与该 Profile 行的最新请求全部匹配时才可进入终态。删除或 revision 更新使旧 Test 记录和迟到结果失效。

## OperationRequest

- `requestId`：跨运行时请求身份。
- `regionId`：`translation-toggle | language-settings | profile-editor | profile-row:<profileId> | subtitle-retry`。
- `actionId`：对应 Translate、Target Language 自动保存、Save/Update/Credential、Select、Test、Delete 或 Retry 控件。
- `profileId`、`revision`：仅 Profile 行或编辑操作需要。
- `busyMessage`：安全的运行中英语文案。

请求状态只保存控件身份，不保存 DOM 节点。每个区域独立维护 latest request；Profile 行重绘据此恢复 busy/idle，即使该请求的消息已被其他区域的新消息替换。

## OperationFeedback

- `requestId`：产生该消息的请求身份。
- `regionId`：消息实际显示的所属区域。
- `actionId`：消息对应的控件操作。
- `phase`：`busy | success | error | cancelled`。
- `message`：安全的用户可见英语消息。
- `placement`：普通区域或删除成功后的原列表位置。

```text
idle --区域 A 写入 busy(A.1)--> active(A.1)
active(A.1) --任一区域 B 写入新消息(B.1)--> active(B.1)，立即清除 A.1
active(A.1) --同 request A 写入终态(A.2)--> active(A.2)
active(A.2) --无新消息--> active(A.2)，保持可见
active(B.1) --区域 A 的非 latest/未知/重复结果--> active(B.1)
```

全局同时最多存在一个 `activeFeedback`。只有通过所属区域 latest request 校验的消息写入才能替换当前消息并清除其他区域；另一区域仍为 latest 的 pending 请求后来产生终态时，该终态视为新的全局消息。未知、重复或同区域非 latest 结果不得改变当前消息。消息不按时间自动清除；替换只清理旧文案或删除结果槽，不删除请求、不解除控件 busy、不改变选择、删除或其他权威业务状态。

## PendingProfileSave

- `requestId`：Profile Save 与随后可选 Credential Save 共用的请求身份。
- `profileId`、`revision`：revision 创建后补全。
- `secretPending`：是否等待 write-only 凭据保存终态。
- `selectionInvalidated`：本次更新是否使当前选择失效。

无凭据时以 revision 结果结束；有凭据时等待 `credential:state`。若 `selectionInvalidated` 为真，最终成功消息始终使用规格指定的 Update 文案，不被通用 Credential 成功文案覆盖。

## ProfileNameState

- `value`：当前输入值。
- `mode`：`system | user | saved`。
- `serviceTypeLabel`：当前 `<option>` 的可见文本。

```text
初始/New/reset -> system（value = serviceTypeLabel）
system --Service type changed--> system（value 跟随）
system --任何用户 input--> user
load existing Profile -> saved
user/saved --Service type changed--> mode 与 value 不变
```

用户清空、输入空白或重新输入默认文本仍属于 `user`。保存发送实际 trim 值并继续使用下游既有空白名称处理，不把 placeholder 或 UI 通用回退值当作输入。

## DeletedProfileResultSlot

- `profileId`：仅关联原列表位置，不代表可操作 Profile。
- `requestId`：必须对应本窗口发起的删除请求。
- `phase`：固定为 `success`。
- `message`：删除成功终态。
- `position`：删除前的列表顺序位置。

成功后 Profile 数据与按钮立即消失，结果槽在原位置以 `role="status" aria-live="polite"` 公布。结果槽是全局当前消息的特殊 placement；任意区域写入下一条被接受的消息时移除。其他窗口收到无本地请求归属的删除事件只收敛权威状态，不创建结果槽。

## PluginVersionIdentity

- `version`：`0.1.0`。
- `githubRepository`：`janwee-sha/SubTandem`。
- `githubVersion`：`1000`。
- `artifactName`：`SubTandem-0.1.0.iinaplgz`。

源码 manifest、npm 两处根版本、pack 安全路径、v0.1.0 发布正文、staging 和最终归档必须一致；其他包的验收证据不作为当前发布身份。
