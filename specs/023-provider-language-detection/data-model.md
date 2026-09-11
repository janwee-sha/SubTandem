# 数据模型：翻译服务自动识别源语言

## 可提交字幕源

表示字幕读取或内嵌提取成功后的会话内输入。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `trackId` | number | 当前主字幕轨身份 |
| `origin` | `external` \| `embedded` | 保持既有读取边界 |
| `format` / `codec` | 文本字幕格式 | 仅用于解析和摘要，不推断语言 |
| `contentHash` | SHA-256 | 标识正文版本并参与会话缓存 |
| `cues` | `SubtitleCue[]` | 至少一个可读取 cue；空源不生成任务 |
| `warnings` | `string[]`（可选） | 仅表达解码/解析问题 |

实体不包含轨道语言、检测语言、置信度或检测状态。轨道标签和文件名不得进入翻译方向；文件扩展名仍可用于格式识别。

## 自动源语言翻译请求

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `playerId` | opaque string | Main 生成生命周期身份；Global 调用 Provider 前以权威发送方 ID 覆盖 |
| `requestId` / `batchId` | opaque string | 当前 attempt 与逻辑批次唯一 |
| `sessionId` | opaque string | 当前播放会话 |
| `sessionEpoch` / `windowEpoch` | non-negative integer | 用于拒绝迟到结果 |
| `profileId` / `profileRevision` | opaque string / positive integer | 必须匹配当前选中 Profile revision |
| `endpointFingerprint` | opaque string | 必须匹配当前授权 endpoint |
| `targetLanguage` | target language ID | 必须属于目标目录并保留精确变体 |
| `items` | `FrozenTranslationTarget[]` | Controller 批次最多 25 项/5,000 code point；非空 |

请求不得包含 `sourceLanguage`、检测结果、轨道语言、文件名或独立检测身份。

## 冻结翻译目标

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | opaque string | 批次内唯一；wire 前映射为 `c1...` |
| `text` | string | 实际翻译目标；不得为空或全空白 |
| `contextPrevious` | string（可选） | 与下一字段合计最多 500 code point，只用于理解 |
| `contextNext` | string（可选） | 不得作为目标或结果输出 |

冻结发生在首次 attempt 前；仅重试未解决条目时不重算正文或上下文。Provider 每次 wire 最多接收 2 项。

## Provider 翻译结果

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `translations[].id` | opaque string | 必须是请求 ID 且恰好对应一项；重复/未知 ID 无效 |
| `translations[].text` | string | 只以 `trim()` 判定非全空白，保存原字符串 |
| `providerRequestId` | safe string（可选） | 沿用现有安全格式 |
| `usage` | numeric object（可选） | 只保留现有允许字段 |

`text === requested.text` 是正常成功。格式和身份合法但语义不正确的结果仍属于服务质量边界，不创建本地语言或语义复核状态。

## 会话缓存身份

```text
sessionId + sourceContentHash + targetLanguage + providerSemanticFingerprint + cueId
```

缓存仅在内存中存在；原样结果和译文使用相同路径。换源、目标、Provider、禁用、换片或关闭后，旧条目不得被新会话读取。缓存不包含源语言。

## 本地会话字幕摘要

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `format` | string | 展示字幕格式 |
| `cueCount` | number | 展示已准备条目数 |
| `warnings` | string[]（可选） | 展示仍有操作价值的信息 |

摘要不包含 `detectedLanguage` 或 `Unknown` 占位。

## 关系与状态转换

```text
可提交字幕源
  └─按当前位置选择有限窗口
      └─冻结翻译目标 + 精确目标语言 + 当前 Profile
          └─自动源语言翻译请求
              └─Provider 翻译结果
                  ├─会话缓存
                  └─当前时间轴 Overlay
```

- 未启用：`disabled`。
- 已启用但字幕不可用：`waitingForSubtitle` 或字幕准备错误。
- 字幕可用但目标/Profile 无效：`waitingForConfiguration`。
- 全部条件和位置有效：直接进入 `preparing`，随后为 `running`、`partialFailure` 或 `serviceUnavailable`。
- 状态机不存在检测中、无法识别、不支持语言或无需翻译状态。
- 换轨、换片、目标/Profile 变化、禁用、seek 窗口变化和关窗继续推进既有 epoch/取消边界；迟到结果不得提交。
