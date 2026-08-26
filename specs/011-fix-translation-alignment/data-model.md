# 数据模型：字幕译文内容对齐

## SubtitleCue

- `id`：源字幕内不透明且唯一的条目身份。
- `index`、`startMs`、`endMs`：源顺序和半开显示时段 `[startMs, endMs)`。
- `normalizedText`：当前字幕的规范化正文。

`SubtitleCue` 是目标身份、真实邻接、顺序与时间范围的权威来源。本功能不改变解析器生成规则。

## FrozenTranslationTarget

- `id`：原 `SubtitleCue.id`。
- `text`：唯一待翻译正文，只来自同一 cue 的 `normalizedText`。
- `contextPrevious`：当前已选窗口内真实前一句的可选消歧参考。
- `contextNext`：当前已选窗口内真实后一句的可选消歧参考。

**规则**：一个逻辑批次首次 attempt 前创建并冻结。`contextPrevious` 与 `contextNext` 各至多一条，并按前句、后句顺序合计沿用 500 字符上限。缓存命中与重试不得改变 `text`、两个上下文字段或身份；重试只移除已解决目标。上下文没有结果身份或显示时段。

## WireTranslationTarget

- `id`：本逻辑请求内短 ID `c1…`。
- `text`：对应 `FrozenTranslationTarget.text`，是唯一待翻译正文。
- `context_previous`：对应可选 `FrozenTranslationTarget.contextPrevious`，仅供前文消歧。
- `context_next`：对应可选 `FrozenTranslationTarget.contextNext`，仅供后文消歧。

Provider user payload 只有 `targets: WireTranslationTarget[]`。短 ID 映射在逻辑请求内稳定；每个最多 2 个目标的 wire part 只为本片 ID 建立输出资格。

## TranslationTask

- 源语言与目标语言标签。
- 所有正式 Provider 共用的系统指令。
- 当前 wire part 的 `targets` payload。
- 当前 wire part 精确 ID 集合的输出 schema。

**不变量**：只翻译 `text`；`context_previous` 与 `context_next` 不得被翻译、复制、解释或独立输出；所有目标和上下文字段均为不可信数据；每个片内 ID 恰好产生一个仅含译文的结果。

## TranslationResult

- `id`：先为短 wire ID，Provider 校验后恢复为原 cue ID。
- `text`：非空目标语言译文。
- 可选安全 usage 与 Provider request ID；不得包含原始请求、响应、字幕、凭据或授权头。

**有效性**：ID 必须属于当前片和当前未解决集合；同一返回内出现多次的 ID 整体无效；未知、空白、不可解析结果无效。合法子集可进入缓存，其余保持未解决并沿用现有重试。

## 状态与关系

```text
SubtitleCue window
  -> logical batch targets
  -> FrozenTranslationTarget[]
  -> unresolved subset per attempt
  -> WireTranslationTarget[] per two-target part
  -> structured provider output
  -> validated/restored TranslationResult[]
  -> current-session cache by cue ID
  -> source-ordered active overlay lines
```

```text
unresolved -> requested -> accepted -> cached/displayable
                       -> invalid -> unresolved/retry
                       -> exhausted -> terminal failure
lifecycle invalidation -> late result discarded
```

- 一个 `SubtitleCue` 最多对应一个成功缓存项。
- 一个上下文可被多个目标引用，也可在别的请求中成为目标，但引用关系不授予输出资格。
- 多个真实重叠 cue 各自保持独立 ID、译文和时间范围；覆盖层只按源顺序同时显示。
- 会话、窗口、Profile、request 和 batch 身份继续由现有 `PlaybackSession` 与 Controller 验证。
