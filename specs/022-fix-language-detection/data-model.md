# 数据模型：字幕正文语言检测

## 运行时实体

| 实体 | 字段与关系 | 校验及保留规则 |
| --- | --- | --- |
| `SourceLanguage` | `languageId`、`detectorCode`；固定映射对应规格附录 A | 恰好 67 个基础身份；`cmn → zh`；目标语言目录不增加条目；中文形式不是独立 profile |
| `DetectionText` | 规范正文流、有效文字位置索引、`letterCount` | 来自当前 `normalizedText`；正文清洗与计数按[检测契约](contracts/language-detection.md)；不修改显示/翻译正文 |
| `DetectionSpan` | 正文起止位置、分类上下文、`observedLetterCount`、`representedLetterCount` | 全量模式计入实际文字；抽样模式记录代表区间；区间互不重复，上下文不额外贡献权重 |
| `SpanEvidence` | 片段身份、候选语言、范围内/已确认范围外、模型排序证据 | 分数仅帮助归属判断，不是文字量或概率；未确认范围外时使用受支持候选；只留会话内存 |
| `LanguageWeight` | 规范语言身份、`estimatedLetterCount` | 累加各归属片段代表的文字数；不同范围外语言分开累计；选择最大值，平票确定性选择 |
| `DetectionAttempt` | `playerId`、`mediaEpoch`、`trackIdentity`、`contentHash`、`attemptId`、`deadlineAt`、工作游标 | 全部身份绑定 Main 本地生命周期；每个工作步骤及提交核验；不是 Global 发送方身份 |
| `LanguageDetectionResult` | `reliable + languageId`、`unknown` 或 `unsupported` | `reliable` 不保证正确；协调结果附加 `contentHash/attemptId`；不输出证据、正文、路径或异常 |

`estimatedLetterCount` 是生产模型的归属估计，不能用作语料真值。重复字幕在正文中每出现一次都计数；原始 cue 数只用于验收分层，不影响候选接受。

## 状态与所有权

```text
当前正文就绪 → detecting → reliable / unknown / unsupported
任何失效事件 → 丢弃工作与正文证据 → 新正文可创建新 attempt
```

换轨、换片、正文改变、禁用、关闭窗口使 attempt 失效；旧结果不提交。seek 保留同源结果；目标语言改变只重新计算翻译资格。每个窗口仅保留当前 attempt 和当前结果，不建立跨内容、跨窗口或跨会话检测缓存。检测结果至 Provider 的映射见[检测契约](contracts/language-detection.md)。

## 测试语料实体

以下实体存放在版本管理内的 `tests/fixtures/languages/`，与插件运行时数据严格分离；仅测试工具读取。

| 实体 | 必需字段 | 关系与校验 |
| --- | --- | --- |
| `SourceRecord` | `sourceId`、作品身份、来源 URL/修订、作者/译者、原件 SHA-256、许可、许可依据、署名、获取日期 | 保存可重分发文本及必要许可；下载位置或轨道标签不能代替授权与真值 |
| `SourceGroup` | `groupId`、`sourceIds`、作品/译本关联、`split` | `split` 为 `calibration` 或 `acceptance`；同作品、译本、相邻片段、镜像及派生版本不可跨集合 |
| `SubtitleSample` | `sampleId`、`groupId`、文件与 SHA-256、原始区间、`originalCueCount`、`effectiveLetterCount`、格式、内容标签、`statisticalUnitId`、`derivedFrom` | 独立自然片段才计主分母；分段、时长、格式和受控混合变体关联基准身份；不循环模板扩充 |
| `StatisticalUnit` | `statisticalUnitId`、`primarySampleId`、关联样本身份 | 冻结前选定唯一自然主样本贡献四类结果；其他译本及变体另作回归，主样本自身满足语言和长度覆盖 |
| `GroundTruth` | `sampleId`、正文语言区间、中文形式、各语言文字量、并列主语言集合、正文充分性、`positive`、行为预期、核对人/日期/依据 | 基于正文人工核对；文字区间互不重叠、覆盖有效文字；无法归属部分显式记录，不能伪造精确混合占比 |
| `CorpusFreeze` | 语料版本、两个集合的来源/样本/真值/分层/正样本归属哈希、核验状态 | 数据划分及真值在调参前冻结；补足准入条件前不标记冻结 |
| `DetectorConfiguration` | 模型与锁文件哈希、算法参数、源映射版本、校准报告身份 | 仅校准集决定，首次运行冻结验收前锁定；不写用户 preferences |
| `EvaluationRecord` | `sampleId`、语料/配置/构建身份、预期及实测语言、四类结果、耗时、内容/长度分层、Provider 调用计数 | 整体与分层只取各统计身份的主样本结果；变体另报成对一致率；无字幕正文、译文或凭据 |

行为预期区分“应选择候选”“应无法识别”“应不受支持”；实际是否调用 Provider 还取决于目标语言、启用状态、已选 Profile revision 和结果有效性。罗马字日语可以预期选择候选，但错选豪萨语仍属于识别错误。

## 语料状态

`待准入 → 许可已核验 → 正文真值已核对 → 来源组已划分 → 语料已冻结 → 参数已冻结 → 已评估`。

任何缺失条件都阻止进入下一状态。发现数据错误须保留失败证据并创建可追溯的新语料版本，不能因验收输出而改标签、移出正样本或删除失败样本。完整准入和统计规则见[语料与评估契约](contracts/corpus-evaluation.md)。
