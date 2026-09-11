# 数据模型：语言判断与翻译正文

本文定义本功能的数据职责；行为见 [检测契约](contracts/language-detection.md)及[翻译任务契约](contracts/translation-task.md)。

## 源语言身份

| 字段            | 约束                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `detectorCode`  | 锁定 franc 包实际输出的 ISO 639-3 代码                                     |
| `languageId`    | [固定映射](research.md#2-固定源语言映射)的 113 个源语言身份之一            |
| `providerLabel` | 英文语言名称及 ID；通用中文为 `Chinese [zh]`，不补出未确定的书写系统或地区 |

映射是静态产品数据，与 156 项目标语言目录分开管理。移除目标目录中仅供旧检测器使用的 `detectorCode` 和反查逻辑；目标 ID、排序、显示名、显式变体和偏好保存保持既有契约。模型代码不等于可靠性结论。

## 检测 attempt 与结果

| 实体/字段                      | 含义与约束                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`                        | Main 生成的 `playerId`、`sessionId`、`sessionEpoch`、`mediaEpoch`、`trackIdentity`、`contentHash`；不包含随 seek 变化的 `windowEpoch` |
| `attemptId`                    | Coordinator 单调生成的不透明身份，同一 owner 仅一个活动 attempt                                                                       |
| `sourceReadyAt`                | 当前正文首次就绪时间；检测重入不得重置                                                                                                |
| `workDeadlineAt`、`deadlineAt` | 内部停止时间与准入等待验收上限；计算及处理规则见[检测契约](contracts/language-detection.md#deadline-与生命周期)                       |
| `sample`                       | 检测专用正文副本、选中 cue 身份、有效文字量、片段及去重统计；不得外发或写日志                                                         |
| `evidence`                     | 仅检测内部使用的非重叠样本区间、候选证据及可靠模型归属或未归属标记；区间总长受同一采样预算限制，不进入逐 cue 产品接口 |
| `languageLetterCounts`、`unassignedLetterCount` | 按 Unicode `Letter` 码点计权的可靠语言量及未归属量；宏语言身份归一化，未映射模型保留竞争，不以 cue 数、脚本或分数代替 |
| `result.state`                 | `reliable` 或 `unknown`                                                                                                               |
| `result.languageId`            | 仅 `reliable` 存在，且必须属于源语言身份集合                                                                                          |
| `result.reason`                | 仅 `unknown` 存在：`insufficient-evidence`、`ambiguous`、`unsupported`、`unmapped`、`error`、`timeout`、`interrupted`                 |

`unsupported` 表示没有可用模型证据，`unmapped` 表示模型候选没有产品身份；二者与其他未知原因都允许翻译。原因是 Main 内部安全枚举，不作为新的阻断 UI 状态，也不进入 provider 请求。

状态转换：`detecting → reliable / unknown`，每次 attempt 至多提交一次终态；失效的 attempt 只停止工作，不能向新 owner 提交。目标或 Profile 生效时若检测尚未完成，Main 为当前配置设置 `unknown/interrupted` 并继续翻译；同一已加载正文已提交的判断可继续使用。正文改变、禁用、换片及关闭后清理对应状态，不建立跨播放会话结果缓存。

## 翻译任务与结果

| 字段                                          | 约束                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `sourceLanguage`                              | `string \| null`；可靠时为源语言 ID，其他结果均为 `null`                                                           |
| `targetLanguage`                              | 目标目录有效 ID；必须完整保留用户选择的变体                                                                        |
| `items[].id/text/contextPrevious/contextNext` | 沿用冻结条目；`text` 是逐字符比较基准，上下文只用于理解                                                            |
| `translations[].id/text`                      | 既有结果形状；`text` 必须是非空白字符串，保存 JSON 解码后的原字符串                                                |
| 请求身份                                      | 沿用 `playerId/sessionId/sessionEpoch/windowEpoch/requestId/batchId/profileId/profileRevision/endpointFingerprint` |
| `CacheIdentity.sourceLanguage`                | 与请求同为 `string \| null`；`null` 与任一可靠 ID 区分，目标变体及 Profile 指纹继续参与键                          |

同语言结果不新增类型、标记或缓存。正常成功结果允许 `translations[].text === items[].text`；运行时不新增语言判断、语义审计或因文本相等触发重试。

## 验收语料与冻结记录

位置为 `tests/fixtures/languages/`；现有 `sources.json`、`calibration.json`、`acceptance.json`、`tracks/`、`licenses/` 和 `same-language.json` 保持可复现。T050 以版本目录保存新清单，并用用途索引明确选择 `calibration`、`holdout`、`known-regression` 与 `mixed-semantics`，禁止默认把已评估清单当留出集。正文及许可全部纳入版本控制，均不随插件打包；来源通过 `sourceTrack` 引用，避免重复保存。

| 字段                                        | 约束                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `sampleId`、`sourceWorkId`、`sourceGroupId` | 稳定样本身份、作品及同源组；翻译、重发布和同源片段归到同一组                     |
| `sourceUrl`、`sourceTrack`、`cueRange`      | 可追溯来源、原轨及不重叠选段边界；不引用私人媒体路径                             |
| `sourceCueIndices`、`canonicalTrackId`、`canonicalCueRange` | 原文件经生产 parser 解析后的块索引（从 1 起，可有无效块形成的间隙）；重发布版本另映射到同一原轨及保守范围以检查重叠 |
| `license`、`attribution`、`licenseEvidence` | 明确许可、作者/字幕贡献者署名和仓库内许可记录；不能只采用聚合站的笼统标签        |
| `file`、`sha256`、`bodyHash`                | 仓库内相对路径、文件字节哈希及解析后正文去重哈希                                 |
| `languageTruth`、`reviewBasis`              | 正文核验的语言/变体或不可可靠判断标注及依据；不能由 detector 结果或容器标签决定  |
| `cueCount`、`letterCount`、`phenomena`      | 实际计数，短/中/长轨、共享脚本、罗马字/歌词、混合、ASS 等标签可重叠              |
| `split`、`regressionId`                     | `calibration` 或 `acceptance`；两个开放许可短轨有独立回归 ID，不能用替代样本冒充 |
| `frozenRevision`、`manifestHash`            | 冻结清单版本和哈希；校准产物记录所用版本，验收另记录代码修订及包哈希             |

新版本用途索引记录清单路径及哈希、语义版本、用途、是否已评估和完整作品/译本分组。评估状态不覆盖冻结清单；加载器必须拒绝已评估材料用作 `holdout`，并在校准开始前检查校准、开发及留出作品隔离。`known-regression` 保留原始 ID、正文和真值；指定短轨所属作品不得出现在校准用途。

混合语义版本逐样本记录正文内不重叠区间的语言真值或未归属原因、去重后的 Unicode 字母码点数、唯一最高语言或并列/不足/不可映射的未知预期及正文审查依据。同/跨脚本混合、55:45、40:35:25、并列、cue 数与文字量赢家不同、人名、译文、重复正文和充分长度罗马字均须预标。语义变化新建版本，不覆盖冻结记录；该层不补足或稀释 SC-001 单语分母。

同语言语料另记录每个 case 的 `sourceLanguage`、`targetLanguage`、冻结正文和逐条 `expectation`（`verbatim` 或 `translate`），后者预先注明目标变体的核验依据。此预期仅供验收使用，不进入生产 provider 请求。

来源的 `origin` 区分 `natural-subtitle` 与 `authored-boundary`。原创无语义音节、数字等只作为负边界，不计入自然正样本数量，也不替代自然歌词或指定本地罗马字回归。清单哈希为删除 `manifestHash` 后按原字段顺序 `JSON.stringify` 的 SHA-256；`bodyHash` 为解析后 `normalizedText` 数组的同类摘要，文件及许可证据使用字节摘要。

语料状态为 `collected → license-verified → truth-reviewed → frozen`。重新开发校准前，T050 冻结多个作品的校准材料及独立留出版本，保留全部数量和分层；元数据变化、格式变体和重复正文不增加独立样本数。单语留出、混合主语言层及已知指定回归分别报告。七个 FFmpeg 指定回归的受版本管理记录只含公开来源、摘要、轨道身份及预期，结构和本地输入边界见[本地回归契约](contracts/local-regressions.md)；不计入冻结集数量，不共享正文到校准路径。
