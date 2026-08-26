# 数据模型：字幕语言自动识别与目标语言偏好

## TargetLanguageOption

- `id`：规范 BCP 47 身份；preferences、RPC、缓存和 Provider 请求的唯一值。
- `displayName`：Sidebar 固定英文名称。
- `providerLabel`：Provider prompt 使用的固定英文表达；由目录派生，不持久化。
- `detectorCode`：可选 ISO 639-3 分类器身份；只用于可靠结果映射。
- `equivalence`：`base | exact-script | exact-region`，决定何时跳过翻译。
- `order`：1–156，与规格附录 A 完全一致。

**验证规则**：`id`、`displayName`、`order` 均唯一；规范化 `id` 后不变；目录恰好 156 项；`zh-Hans`、`zh-Hant`、`pt`、`pt-PT`、`gaa` 和 `kri` 映射固定。完整目录见 [language-catalog.md](./contracts/language-catalog.md)。

## TargetLanguagePreference

- `targetLanguageId`：目录成员；缺失或非法时内存默认 `zh-Hans`。
- `revision`：Main 内提交态版本；首次加载为 1，每次本窗口成功保存后递增。
- `source`：`saved | default`，仅用于初始化判断，不进入 Provider 请求。

Global 是唯一持久化写入者。其他窗口可以持有已提交的会话快照，但不得建立独立的持久化键。

## LanguageSaveAttempt

- `requestId`：Sidebar、Main、Global 和结果反馈共享的不透明 ID。
- `candidateTargetLanguageId`：待保存目录成员。
- `previousTargetLanguageId`：Global 回滚依据。
- `originPlayerId`：IINA 提供的权威播放器身份，不接受 payload 伪造。
- `state`：`pending | committed | failed | superseded`。

**状态转换**：

```text
idle --choose different target--> pending
pending --set+sync success--> committed --> Main session switch
pending --validation/set/sync failure--> failed --> previous preference/session unchanged
pending --window/sidebar lifecycle invalidation--> superseded --> late reply ignored by UI
```

同一 Sidebar 同时最多一个 pending。Global 按收到顺序同步提交不同窗口请求，持久层最终值是最后一次成功提交。

## SubtitleLanguageDetectionAttempt

- `attemptId`：逐源不可复用 ID。
- `playerId`：逐窗口身份。
- `mediaEpoch`：当前媒体代次。
- `trackIdentity`：当前所选字幕轨身份。
- `contentHash`：正文身份；同轨内容变化创建新 attempt。
- `sampleBudget`：最多 64 cue、4,000 个 Unicode 文字。
- `startedAt`、`deadlineAt`：500 ms 总期限。
- `state`：`sampling | classifying | reliable | unknown | unsupported | invalidated`。

**状态转换**：

```text
source ready -> sampling -> classifying -> reliable
                                     -> unknown
                                     -> unsupported
sampling | classifying --deadline/error--> unknown
any active state --track/file/hash/disable/close--> invalidated
```

seek 不改变 attempt。`invalidated` 或超时后不得回到 `reliable`。

## SubtitleLanguageResult

- `state`：`reliable | unknown | unsupported`。
- `languageId`：仅 `reliable` 时存在，使用规范 BCP 47；中文可为 `zh-Hans`、`zh-Hant` 或保守的 `zh`。
- `contentHash`、`attemptId`：提交前的所属校验。

结果不含字幕样本、候选列表、分数、路径、轨道原始元数据或异常文本，不跨会话持久化。

## TranslationLanguageContext

- `sourceLanguageId`：当前可靠识别结果。
- `targetLanguageId`：当前窗口已提交偏好。
- `decision`：`translate | noTranslationNeeded | blockedUnknown | blockedUnsupported | detecting`。
- `sessionEpoch`：目标、字幕源、启用态或 Profile 变化时用于拒绝旧工作。

只有 `decision=translate` 才能建立 Provider 请求。缓存身份继续包含 `sessionId + sourceContentHash + sourceLanguageId + targetLanguageId + providerSemanticFingerprint`，并在目标保存成功后同步清空。

## SidebarLanguageState

- `committedTargetLanguageId`：Main authoritative state。
- `committedRevision`：用于首次加载和成功保存后的 hydrate。
- `displayedTargetLanguageId`：idle 时与 committed 一致，pending 时显示候选值，不提前进入播放逻辑。
- `hydrated`：是否已从首次权威快照初始化；为 false 时选择器禁用。
- `pendingRequestId`：保存中请求；完成前禁用重复提交。
- `operationState`：`idle | saving | saved | failed`。

选择不同值立即建立唯一 pending；匹配成功采用返回的 committed 值和 revision，失败、取消或异常恢复先前 committed 值。关闭并重新打开 Sidebar 时重新以 Main committed state 初始化；完整退出 IINA 后 Main 从 Global preferences 恢复。

## 关系与所有权

```text
TargetLanguageOption catalog 1 -> 1 TargetLanguagePreference
Sidebar selection          1 -> 0..1 LanguageSaveAttempt
Global preference          1 -> 0..N Main committed snapshots

Player window              1 -> 0..1 current subtitle source
current source             1 -> 0..1 DetectionAttempt
reliable DetectionAttempt  1 -> 1 SubtitleLanguageResult
LanguageResult + Preference 1 -> 1 TranslationLanguageContext
TranslationLanguageContext 1 -> 0..N provider attempts/cache entries
```

持久化层只拥有一个有效语言值 `targetLanguageId`；旧源语言键只允许保留 property-list 安全的空字符串墓碑。每个播放器窗口独立拥有检测 attempt、结果、翻译上下文、缓存和覆盖层。
