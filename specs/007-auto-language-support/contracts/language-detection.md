# 契约：字幕正文语言识别

## 输入边界

识别器只接收当前窗口已解析的 `SubtitleCue[]`、`contentHash` 和所属身份，不重新读取文件。外挂 SRT/ASS 与内嵌文本字幕使用同一入口。轨道 `lang` 可展示，但不得覆盖、提升或替代正文判断。

```ts
interface LanguageDetectionInput {
  playerId: string;
  mediaEpoch: number;
  trackIdentity: string;
  contentHash: string;
  cues: readonly SubtitleCue[];
}

type LanguageDetectionResult =
  | { state: "reliable"; languageId: string; contentHash: string; attemptId: string }
  | { state: "unknown"; contentHash: string; attemptId: string }
  | { state: "unsupported"; contentHash: string; attemptId: string };
```

不得输出样本文本、候选、分数、文件路径、轨道原始元数据或分类器异常。

## 采样与可靠门禁

1. 使用 cue 的 `normalizedText`，删除空白、仅符号、仅数字、明显 URL 与精确重复行。
2. 按时间轴四等分，每层最多取 16 条不同 cue；总计最多 64 条和 4,000 个 Unicode 文字。
3. 少于 12 条有效 cue 或 200 个文字时返回 `unknown`。
4. 每层及总样本执行 script 预判与 `franc-min` 分类。
5. 只有总样本第一名与至少 3/4 有效窗口第一名一致、加权支持率 ≥80%、第一与第二候选分差 ≥0.12 时返回 `reliable`。
6. 文字量充分但主要 script 没有受支持分类 profile 时返回 `unsupported`；混合、相关语种竞争或低置信返回 `unknown`。
7. 四个分片间让出事件循环；总期限 500 ms，超时或异常返回 `unknown`。

Kana、Hangul 等高区分文字只能缩小或佐证候选；Arabic、Cyrillic、Devanagari、Han、Hebrew 等共享文字不得直接映射成唯一语言。中文只有正文证据足以区分时输出 `zh-Hans`/`zh-Hant`，否则可靠中文输出 `zh`。

## 生命周期

attempt 必须绑定 `playerId + mediaEpoch + trackIdentity + contentHash + attemptId`。每个分片继续前及最终提交前核验全部字段。

| 事件 | 识别处理 | 翻译处理 |
| --- | --- | --- |
| 换轨、换片、正文 hash 变化 | 当前 attempt 失效，新源创建新 attempt | 取消请求并清缓存/overlay |
| 禁用、关窗 | 当前 attempt 失效 | 取消并清理会话 |
| seek | 保留同源识别结果 | 只使现有 window epoch 失效 |
| 目标语言成功保存 | 可复用同源可靠结果 | 取消旧目标工作，按新目标重新门控 |
| 迟到分片或结果 | 丢弃 | 不改变状态，不触发 Provider |

## Provider 门禁与用户状态

| 检测/比较结果 | Session 状态 | Provider 调用 | 固定英文文案 |
| --- | --- | ---: | --- |
| attempt 进行中 | `detectingLanguage` | 0 | `Detecting subtitle language…` |
| `unknown` | `languageUnrecognized` | 0 | `Subtitle language could not be identified; playback continues` |
| `unsupported` | `languageUnsupported` | 0 | `This subtitle language is not supported; playback continues` |
| reliable 且与目标等价 | `noTranslationNeeded` | 0 | `The subtitle already matches the target language` |
| reliable 且不等价 | 现有 `preparing/running` | 允许 | 现有翻译状态 |

UI 不得显示分类器名、置信分数、正文或内部错误。

## 等价矩阵

| source | target | 决策 |
| --- | --- | --- |
| `en-US` | `en` | 不翻译 |
| `pt-BR` | `pt` | 不翻译 |
| `pt-BR` | `pt-PT` | 翻译 |
| `pt-PT` | `pt-PT` | 不翻译 |
| `zh-CN` / `zh-Hans` | `zh-Hans` | 不翻译 |
| `zh-TW` / `zh-Hant` | `zh-Hant` | 不翻译 |
| `zh-Hans` | `zh-Hant` | 翻译 |
| `zh-Hant` | `zh-Hans` | 翻译 |
| `zh` | `zh-Hans` 或 `zh-Hant` | 翻译 |

source 入口可规范 `iw→he`、`in→id`、`ji→yi`；目标目录和新偏好不得产生旧别名。

## 指标与失败关闭

- 冻结验收集可靠且正确比例 ≥95%，不可靠样本被判为可靠语言 ≤1%。
- 元数据缺失或错误但正文充分时，正确方向比例 ≥95%。
- `unknown`、`unsupported`、同语言和迟到结果的 Provider 调用均为 0。
- 最大样本首次 p95 ≤100 ms、热识别 p95 ≤50 ms、单个同步分片 p99 ≤16 ms。
- 任一准确率、性能、生命周期或隐私门禁失败时，不得通过降低阈值、使用轨道元数据兜底或外发正文来发布。
