# 本地会话状态契约

对应 FR-003、FR-012–015。

## Sidebar 状态

会话状态只允许：

```text
disabled
waitingForSubtitle
waitingForConfiguration
preparing
running
partialFailure
serviceUnavailable
```

删除 `detectingLanguage`、`languageUnrecognized`、`languageUnsupported` 和 `noTranslationNeeded`。用户启用翻译后，可读字幕不经过语言状态；配置完整且位置有效时直接开始准备当前窗口。

字幕摘要只包含格式、cue 数、解析警告以及既有缓存/工作上限信息。不得包含 `detectedLanguage`、语言值或 `Unknown` 占位。

## 状态优先级

1. 翻译关闭：`disabled`。
2. 字幕未选择、不可读或准备失败：`waitingForSubtitle` 或既有 `sourcePreparation` 错误；不生成空任务。
3. 目标语言无效或 Profile 未选择：`waitingForConfiguration`。
4. 条件与当前位置有效且存在待处理 cue：`preparing`，收到合法结果后为 `running`。
5. 部分条目终止失败：`partialFailure`；暂时性服务失败耗尽有限重试：`serviceUnavailable`。

同语言、混合语言、罗马字、错误/缺失轨道标签和短轨不形成额外状态。

## 生命周期

- 换轨、换片、正文 hash、目标语言或 Profile revision 改变时，清空当前译文和缓存、取消旧 attempt 并推进既有会话身份。
- 禁用和关窗清除 Overlay 与会话数据；关窗还释放 Profile 和本地 helper。
- seek 保持现有窗口 epoch、取消和有限前瞻行为，不启动语言检测工作。
- 多窗口继续以各自 Main 生命周期身份接收状态，以 Global 权威发送方身份授权 Provider；不得串写。

## Overlay 文本

Overlay 只显示当前时间范围内的合法结果。换行拆分后必须保留首尾和内部空行的位置；若整条结果全为空白则不显示。Overlay 不改变缓存中的原字符串，也不新增网络、存储或交互能力。
