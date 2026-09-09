# 字幕语言语料

当前版本为 `commons-2026-09-09-v1`。开发者已于 2026-09-10 在当前会话确认“已核对通过”，186 项核对记录已写入清单；[冻结清单](freeze.json)固定两组的来源、正文、真值、分层和统计身份。核对及数量不代表检测准确率；验收集在配置冻结前仅做准入核验。

| 集合                     | 来源文件／作品 | 自然主样本 | 派生回归 | 短／中／长正样本 |
| ------------------------ | -------------- | ---------- | -------- | ---------------- |
| [校准](calibration.json) | 28／26         | 68         | 25       | 24／20／20       |
| [验收](acceptance.json)  | 29／28         | 69         | 24       | 22／20／22       |

两集合均覆盖 20 种规定源语言、每种至少 20 条自然 cue，以及[语料契约](../../../specs/022-fix-language-detection/contracts/corpus-evaluation.md)的内容标签。来源作品、译本谱系、原文件和规范正文经过隔离检查；自然主样本的原始 cue 不重复计数。由受控混合连接的来源归入同组，各原作品身份仍单独保留。作品谱系已纳入本次核对。

## 核对依据

[校准片段索引](calibration/review.md)、[验收片段索引](acceptance/review.md)及对应 [校准核对表](calibration/review.csv)／[验收核对表](acceptance/review.csv)保存逐项结论。人工真值覆盖语言区间、中文形式、混合文字量、范围内最高占比、正文充分性、正样本归属及自然片段边界。派生项依据已核对父样本及明确的变换复核，不增加独立自然分母。

两组 `de-eleven` 分别为 11 cue／332 和 330 个有效字母；`en-ass` 为 38 cue。`romanized-mixed` 保留已发布歌词中的译文和罗马字日语，`romanized-only` 只保留原第二行。验收歌词原件首块时间格式无效，自然片段仅截取后四个有效原始块；该边界已包含在核对范围内。

## 检查命令

从仓库根目录运行：

```sh
node_modules/.bin/vite-node scripts/language-corpus-audit.ts
node_modules/.bin/vite-node scripts/language-corpus-audit.ts --list-pending
npm test -- tests/unit/language-corpus.test.ts
```

草稿审查调用生产字幕解析器，检查来源和样本哈希、连续原始范围、派生关系、唯一主样本、区间计算、覆盖及跨集合隔离，报告核对状态，并在冻结清单存在时核验其哈希，不运行检测。真实准入入口 `loadCorpus()`／`loadFrozenCorpora()` 仍拒绝缺少人工核对记录的数据。

## 来源、许可与重建

- `originals/` 保存 Wikimedia Commons TimedText 固定修订的完整正文，按 UTF-8 原样保存；来源 URL、修订、SHA-256、作品 ID、译本谱系及作者／译者署名入口登记在集合清单。
- 每个来源的 `licenses/` 快照保存字幕修订历史入口、原作品固定修订、许可和署名原始字段、上游来源及许可依据。Commons 非结构化正文的 CC BY-SA 4.0 依据固定在 [Commons 正文许可快照](licenses/commons-text-policy.json)；其 SHA-256 同时保存在各来源快照。原作品许可另行保留，不把视频许可冒充译本许可。
- 字幕及其改编按各清单和快照中的 CC BY-SA 条款分发；原作品还保留其 CC BY、CC BY-SA 或公有领域说明。完整贡献者署名可通过每个来源的修订历史访问。语料不进入插件安装包。
- `samples/` 的自然主样本只抽取完整、连续的原始 SRT 块，保留原正文和原时间。`originalRanges` 使用生产解析结果中从零起、不含终点的 cue 范围；`review.sourceBlockRange` 对应原文件块。坏块在所选范围外时不把它补写成自然 cue。
- 重建自然片段时，按上述范围取出原始块，以一个空行连接并保留末尾换行，再核对清单中的字节及规范正文哈希。相邻片段只在同一集合内；平行译本、格式转换和重新分段不增加自然主样本数。
- 派生项的 `derivedFrom` 和 `derivation` 记录父样本、变换、字母偏移／数量、排列和重复次数。受控混合按父样本规范正文的 Unicode Letter 偏移切片，保留区间内标点和空格，末词可能被截断；超过预算的压力项明确重复 40 次，仅用于边界验证。
- [媒体对应表](media.json)登记四种格式、正确／缺失／错误标签共 12 个最小媒体。每个媒体的视频为 FFmpeg 测试图；第一字幕流来自 `calibration-en-6`，第二字幕流来自 `calibration-de-eleven`，后者默认选中，`ffIndex=2`。字幕改编沿用父样本许可与署名；不增加自然准确率分母。

## 媒体重建与手动加载

安装 FFmpeg 后，从仓库根目录执行：

```sh
node scripts/build-language-media.mjs
node scripts/build-language-media.mjs --stress
```

第一条命令重建 `tests/fixtures/media/language/` 的最小媒体、外挂 ASS／SSA 及对应表。第二条还生成临时 20,000 cue 字幕和四小时压力媒体；输出位置由受版本管理的生成脚本定义，不纳入 Git。

手动测试先打开最小媒体，再从 IINA 的“字幕 → 添加字幕…”选择 `calibration/samples/` 中的 `de-eleven.srt`、`en-ass.ass`、`hu-19.srt`、`it-19.srt`、`ru-19.srt`、`sv-19.srt`、`romanized-only.srt`、`ha-6.srt`、`mixed-unsupported-majority.srt` 或 `no-letters.srt`。其他 ID 的准确路径以[校准清单](calibration.json)的 `file` 字段为准。同媒体切换两条内嵌轨时应分别识别英语和德语；标签变体应保持结果一致。
