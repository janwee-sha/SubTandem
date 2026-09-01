# Bug 评估：短内嵌字幕语言无法识别

- **Slug**：`embedded-subtitle-language`
- **创建日期**：2026-09-02
- **来源**：用户粘贴文本、本地截图与样本文件
- **结论**：invalid
- **严重程度**：low

## 报告

用户报告 SubTandem 无法检测所提供本地 MKV 样本中的内嵌字幕语言，并提供了现场截图。

截图显示所选内嵌字幕格式为 SubRip、共 5 条 cue，`Detected language` 为 `Unknown`，会话状态为 `Subtitle language could not be identified; playback continues`。

## 症状

SubTandem 能成功提取该 MKV 的内嵌 SubRip 字幕，但不会把其语言判为英语，而是显示无法识别并阻止翻译请求。按照当前规格，少于 12 条有效 cue 或 200 个文字的字幕必须失败关闭，因此这是预期行为，不是内嵌字幕检测缺陷。

## 复现

1. 在 IINA 中播放用户提供的本地 MKV 样本，选择其内嵌 SubRip 字幕并打开 SubTandem。
2. Sidebar 显示 5 条 cue、语言为 `Unknown`，且播放继续。
3. 使用生产 `SubtitleExtractor` 对同一文件执行本地探针：`ffIndex=2` 成功提取 5 条 cue、292 字节。
4. 使用生产 `parseSrt` 与 `sampleSubtitleCues` 处理提取结果：解析警告为 0，保留 5 条有效 cue，共 90 个字母。
5. 使用生产 `detectSubtitleLanguage` 检测同一结果：返回 `{ state: "unknown" }`。

## 涉及代码路径

- `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Extractor.swift:20` — 生产内嵌字幕提取入口；本次探针证明该路径成功输出完整的 5 条 SubRip cue。
- `src/main.ts:291` — 接收已提取的内嵌字幕，并在 `src/main.ts:313` 把 cue 交给语言检测器。
- `src/subtitles/language-detection.ts:7` — 固定最少 12 条有效 cue 和 200 个字母的可靠性下限。
- `src/subtitles/language-detection.ts:124` — `detectSubtitleLanguage` 在样本未达到任一下限时直接返回 `unknown`，尚未调用 `franc-min`。
- `src/app/controller.ts:112` — 将 `unknown` 检测结果提交到会话状态机。
- `ui/sidebar.ts:48` — 把 `languageUnrecognized` 映射为截图中的固定安全文案。
- `tests/unit/language-detection.test.ts:43` — 已有回归测试明确要求少于 12 条 cue 或 200 个字母时返回 `unknown`。

## 根因假设

置信度：高。样本只有 5 条有效 cue 和 90 个字母，同时低于 `MIN_CUES=12` 与 `MIN_LETTERS=200`。`detectSubtitleLanguage` 因此在分类前按可靠性门禁返回 `unknown`；截图中的 5 条 cue、生产提取探针和生产检测结果相互印证。`specs/007-auto-language-support/contracts/language-detection.md` 也明确规定该下限，并要求不得通过降低阈值或使用轨道元数据兜底来绕过准确率与隐私门禁。

## 建议处置

**首选**：不修改生产代码，将报告按预期行为关闭。验证“可成功识别”时，应使用至少包含 12 条不同有效 cue、200 个字母且正文语言一致的字幕；该短片样本可继续用于验证短输入显示 `Unknown`、不调用 Provider 且不阻断播放。

**备选方案**：若产品目标是让此类极短字幕也能自动翻译，应建立新的有界功能并走完整 SDD，重新定义短输入的可靠性门禁、使用独立短字幕语料校准误判率，并重新验证 Provider 零错误方向调用与隐私边界。不得直接降低现有阈值，也不得用可能错误的轨道语言元数据替代正文判断。

**预计修改文件**：

- 当前首选处置无需修改文件。
- 若批准新的短字幕识别能力，预计涉及 `src/subtitles/language-detection.ts`、`tests/unit/language-detection.test.ts`、`tests/fixtures/languages/` 和 `tests/integration/acceptance-metrics.test.ts`，并需建立独立 SDD 产物。

**测试建议**：

- 当前已有少于 12 条 cue、少于 200 个字母的单元回归覆盖；本次复核 `tests/unit/language-detection.test.ts` 与 `tests/unit/language-detection-coordinator.test.ts`，共 10 项通过。
- 若批准行为变更，增加该短样本等价语料的回归，并重新执行冻结短字幕语料的正确可靠率、误可靠率、Provider 零错误方向调用及性能门禁。

## 风险与注意事项

- 降低阈值会增加短文本误判，并可能把字幕正文按错误语言方向发送给用户选择的 Provider。
- 使用轨道语言标签兜底违反正文优先契约；缺失或错误标签会把安全失败变成错误翻译。
- 该文件总共只有 5 条 cue，不存在稍后积累到当前可靠性下限的机会。
- 当前行为不造成播放中断、数据丢失或凭据风险，影响限于短字幕源不会自动翻译。

## 待确认问题

- 无。若希望改变短字幕的产品行为，应另行提出新功能需求，而不是执行当前 bug 修复。
