# 验证记录：语言检测与不中断翻译

**状态**：T001–T002 已验收；当前实现未通过 T014 的 SC-001/002。其余任务保持未验收，未进入 US2/US3 或真实服务/宿主验收。

## 环境与前置检查

- 核查日期：2026-09-11；分支：`fix/language-detection`；源码修订：`d4200497e1c1624b4bfdbe16c06701b667cfdcc8`。
- 实际环境：macOS 26.6.2（25G83）、arm64、Node.js 24.18.0、npm 11.16.0；未进行性能或 IINA 宿主测量。
- `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` 成功定位本功能，所需规划产物齐备。
- `checklists/requirements.md`：16 项已勾选、0 项未勾选；未修改清单。
- Git、Prettier、ESLint 忽略规则覆盖现有依赖、构建及缓存目录；包声明为私有，无需新增 npm 发布配置。
- `.specify/extensions.yml` 的 `hooks` 为空，无实施前后钩子。

## 语料冻结与 T001–T002

冻结版本：`022-corpus-2026-09-10-1`。审查执行者为 Codex，依据逐轨来源、许可证据及完整选段正文核验；未声称用户已完成手动审查。真值及同语言预期先于检测评估确定，本页下方记录参数冻结后的首次验收结果。

| 集合 | 内容 | 同源组隔离 |
| ---- | ---- | ---------- |
| 校准 | 58 个自然正样本、7 个原创负边界；20 种语言 | Sintel 与独立原创校准组 |
| 验收 | 402 个自然正样本、5 个自然负样本、8 个原创负边界 | Elephants Dream、Cosmos Laundromat、Tears of Steel 与独立原创验收组 |
| 同语言 | 11 个场景、17 个条目，含中文简繁、pt-PT、逐字符边界 | 引用冻结验收正文及明确字符变换 |

验收正样本中英语、德语各 21 个，其余 18 种语言各 20 个；长度为短轨 362、中等轨 39、长轨 1。校准正样本为短轨 38、中等轨 19、长轨 1。每个选段保留实际正文和时间，原轨范围不重叠；不同语言及重发布版本按完整作品隔离。IETF 两个短轨映射回同作品完整字幕的保守范围，避免重复计数。

来源目录共 93 项，正文 480 个文件。许可及署名见[官方 Blender 字幕](../../tests/fixtures/languages/licenses/blender-open-subtitles.md)、[Wikimedia 固定版本字幕](../../tests/fixtures/languages/licenses/commons-open-subtitles.md)、[两个原始短轨](../../tests/fixtures/languages/licenses/elephants-dream.md)和[原创负边界](../../tests/fixtures/languages/licenses/authored-boundaries.md)。38 个 Wikimedia 固定版本页面均核对具体页面的 CC BY-SA 4.0 链接，并保留贡献者及版本历史来源；原作品许可另行记录。原创音节和假名转写仅证明对应无语义边界，不计入 400 个自然正样本，也不代替指定罗马字回归。

正文审查剔除单语正样本中未翻译英语、重复等弱证据；可确定为混合或不足的片段单列负样本，其余不计数。源文件编码转换和格式修复有来源记录，ASS 样式样本解析后正文与对应自然选段一致。清单记录每项真值依据，不能由容器标签或检测结果决定。

| 清单 | manifestHash |
| ---- | ------------ |
| `sources.json` | `cc6030d6635d89aebe8a6583728806e14d1cb50b25824259fe43ac4a18f676c8` |
| `calibration.json` | `5e0740b399327946079f60587ef95798bf85d37e969fcf44a4b1c034923aea18` |
| `acceptance.json` | `25c2f31436895dc716cb537348855be1ed4747feeb10809c73f1bace4799b270` |
| `same-language.json` | `53704458eeff34ae142603b4bc3236f9db3c98ba0de3fd52ffb797f524f4d3ef` |

哈希算法见[数据模型](data-model.md#验收语料与冻结记录)。受版本管理的正文、来源及许可均已纳入 Git 索引，尚未创建提交。

| 检查 | 结果 |
| ---- | ---- |
| `npm test -- tests/contract/language-corpus.test.ts` | 12/12 通过：来源隔离、原轨重叠、正文去重、计数、哈希、许可记录、路径边界及同语言预期 |
| 本地入口默认关闭 | 14 项跳过，无提取或外网请求；跳过不计为检测通过 |
| 显式本地入口，仅选择 `loads original input` | 7/7 通过；生产 helper 提取，校验媒体及 SRT 摘要、cue/字母计数，三种标签通过生产准备函数；临时正文清理 |
| 新增语料 helper、contract、integration 的 ESLint | 通过 |

本地 helper 使用回环服务，在沙盒外执行上述专项检查。语料门检查不计为检测通过；当前检测、构建及打包结果见下文。

### 指定回归材料定位

已从用户指出的三个媒体及同目录的第四个媒体读取 27 条字幕轨，复核结果与[缺陷评估](../../.specify/bugs/subtitle-language-detection/assessment.md)的 A–D 统计吻合。沿用 A–D 标识，并以媒体 SHA-256 识别材料，不让受版本管理的证据依赖本地私有路径。

| 媒体 | 字幕轨数 | 媒体 SHA-256                                                       |
| ---- | -------- | ------------------------------------------------------------------ |
| A    | 1        | `ee3fcb50c69a56a827a55f9d835a939a70319ff866647ef3604b5c7880836fde` |
| B    | 2        | `f0cb97b762712f3dc97b05fec721c0ab5fc2b4e3cf6380f1e6db415dffe70459` |
| C    | 16       | `cd233bed8ba0cfb0d5b7afbc9f49b6d4aee0f6c2e6d6da146e8ef43973d2accf` |
| D    | 8        | `92acdc33bb0b5d7a4d9b0d6ca792230a78c786a30179dc9999cee41c28642842` |

核查使用 `ffprobe -v quiet -show_format -show_streams -of json <本机原始媒体>` 枚举轨道；临时 CLI 直接编译当前生产 `Protocol.swift`、`Extractor.swift`，链接仓库锁定的 FFmpeg 静态库逐轨提取，再用 Node.js 直接导入生产 `parseSrt`、`sampleSubtitleCues` 和 `detectSubtitleLanguage`。27 条轨均成功提取，解析警告为 0，输出哈希全部与提取器返回值一致。以下是缺陷复核，不是新实现或冻结验收集的指标测试。

| 回归 ID                | 媒体 / `ffIndex`（从 0 起） | cue 数 | 采样字母数 | 当前检测结果  | 提取 SRT 的 SHA-256                                                |
| ---------------------- | --------------------------- | ------ | ---------- | ------------- | ------------------------------------------------------------------ |
| `regression-de-11`     | B / 3                       | 11     | 332        | `unknown`     | `ad8a5e5696ea6bd9c57fb79a845ea13913678993c3c2856baa191b0f982bc775` |
| `regression-short-5`   | D / 2                       | 5      | 90         | `unknown`     | `75246eb540b3a56a9272141d19cec97dce970239ea9f4b9016f02b0b4f16c8ae` |
| `regression-short-6`   | D / 4                       | 6      | 130        | `unknown`     | `0f59c5483c789d3df572ef50093d9cbe7d570edcdee97527ae38ac3b9300e79f` |
| `regression-hu-19`     | C / 9                       | 19     | 406        | `unknown`     | `cb650cfc715d3fc20874aa4416fb24e620381517039bd5cec56953d2343e5b73` |
| `regression-it-19`     | C / 10                      | 19     | 448        | `unknown`     | `feaefc31dda66b483c80c1fe5b04b1ed480c117ad0d35fd4ef8dd98350f831ad` |
| `regression-ru-19`     | C / 15                      | 19     | 471        | `unknown`     | `bd0a71bb3c86115d48aee1cc523d4dd3f36e60d53f8ce9d13ed637775e28fc8c` |
| `regression-sv-19`     | C / 17                      | 19     | 429        | `unknown`     | `9973daf5ce224ef0bbe41ac4e93371381c30d9a343acf4fc578e9df2f7ece065` |
| `regression-en-38`     | A / 2                       | 38     | 651        | `unknown`     | `012682fbae670be1fb0419febc77bece4728da8ad7a6e58b2d3dee7b94282615` |
| `regression-romaji-29` | C / 11                      | 29     | 493        | `reliable/ha` | `a1937b76570b7f672cff6088410aa6ac04ab20fd51ab3ad9149abc89ceda5ca9` |

- 英语轨共有 38 cue、670 个正文字母；当前采样保留 37 cue、651 个字母，四窗口为 `eng/fra/swh/eng`。德语短轨 11 cue、332 个字母，四窗口均为 `deu`。
- C / 11 的容器标签为 `jpn`，当前检测却返回 `reliable/ha`，四窗口为 `hau/swh/hau/hau`，重现指定误判统计。
- 两个短轨按正文审查固定为 D / 2（英语、5 cue）和 D / 4（德语、6 cue），原提取正文及摘要完整保留。
- 两个短轨的来源为 IETF CELLAR `test5.mkv`；其余七个指定回归来自三个 FFmpeg 样本。D 的两条字幕已采集到测试目录；A–C 按用户批准的[本地验收契约](contracts/local-regressions.md)只保留[安全元数据](../../tests/fixtures/languages/local-regressions.json)，不要求正文或再分发许可入库，不计入 SC-001，也不作为 T001 前置条件。

### 原始下载来源与许可

结合技能来源目录、对应历史下载命令及文件摘要核对，四个本地文件均能定位原始下载地址。B、C、D 的 SHA-256 与技能已有记录完全一致；A 的历史下载命令明确将 `honey.mkv` 保存为用户指出的文件。A、B、C 的 MD5 另与官方目录摘要核对，仅用于来源匹配，语料身份继续使用 SHA-256。

| 媒体 | 原始来源                                                                                                                  | 当前许可证据                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | [FFmpeg honey.mkv](https://samples.ffmpeg.org/Matroska/subtitles/honey.mkv)                                               | [伴随说明](https://samples.ffmpeg.org/Matroska/subtitles/honey.txt)描述影片片段及 ASS 问题，没有字幕再分发授权                                                                                                                                         |
| B    | [FFmpeg mov_text 样本](https://samples.ffmpeg.org/MPEG-4/embedded_subs/1Video_2Audio_2SUBs_timed_text_streams_.mp4)       | [目录](https://samples.ffmpeg.org/MPEG-4/embedded_subs/)仅提供媒体及摘要，未找到再分发许可                                                                                                                                                             |
| C    | [FFmpeg SSA_15subtitles.mkv](https://samples.ffmpeg.org/Matroska/subtitles/SSA_15subtitles.mkv)                           | [伴随说明](https://samples.ffmpeg.org/Matroska/subtitles/SSA_15subtitles.txt)描述字幕轨和播放问题，没有字幕再分发授权                                                                                                                                  |
| D    | [IETF CELLAR test5.mkv](https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/master/test_files/test5.mkv) | [官方说明的第 5 项及许可章节](https://github.com/ietf-wg-cellar/matroska-test-files#5-multiple-audiosubtitles)明确来源为 Elephants Dream，并列出 CC BY 及署名；[作品许可页](https://orange.blender.org/blog/creative-commons-license-2/)链接 CC BY 2.5 |

公开下载地址和技术测试用途不是字幕再分发许可。A–C 保持本地使用，SC-002 仍要求原始七项断言通过。D 的两条短轨已完成来源、许可和正文核验，纳入冻结验收集。

## 当前检测实现与校准

标准依赖已迁移为 `franc@6.2.0`；119 个模型代码映射到独立的 113 个源身份，156 项目标语言目录的身份、顺序及显示内容摘要不变。实现包含分片采样/分类、单次终态和 450 ms 独立唤醒；Main 的完整运行时链路覆盖、未知继续翻译及同语言原样返回尚未完成。

校准仅使用冻结校准集比较 1,944 组参数，先最小化错误可靠率，再最大化正样本正确率，最后按固定参数向量确定并列顺序。选定参数为 `minimumLatinLetters=65`、`minimumOtherLetters=40`、`shortMargin=0.001`、`longMargin=0.0001`、`minimumScriptRatio=0.9`、`minimumSupport=0.9`、`minimumModelCoverage=0.2`；模型覆盖指锁定 franc 模型的 trigram 覆盖，不把相对距离解释为概率。校准结果为 57/58 正样本正确可靠、8 项未知（含 7 个负样本）、0 项错误可靠；完整参数、搜索范围与结果见[校准记录](../../tests/fixtures/languages/calibration-result.json)。

- 检测文件 SHA-256：`84d32f744d08402935f4cef5eba5a1076c7bc3ffc770d10124106b3a760c1b2b`。
- lockfile SHA-256：`c5df072dfdafa0b4b2970af43f1ebc7e855cc197fba6669fcba4b6105c7093f6`。
- 验收后未修改检测参数、样本真值或样本成员；当前验收集已经过评估，后续若据此重新校准，必须建立独立冻结版本。

## SC-001/002 当前结果

| 指标 | 实际值 | 要求 | 结果 |
| ---- | ------ | ---- | ---- |
| 正样本正确可靠 | 353/402 = 87.81% | ≥95% | 失败 |
| 全部样本错误可靠 | 32/415 = 7.71% | ≤1% | 失败 |
| 负样本可靠 | 0/13 = 0% | ≤1% | 通过 |
| 正样本未知 | 17/402 | 保留并报告 | 已记录 |
| 全部样本未知 | 30/415 | 保留并报告 | 已记录 |
| 冻结轨道的正确/缺失/错误标签差异 | 0/415 | 0 | 通过 |
| 两个指定开放许可短轨 | 2/2，`reliable/en`、`reliable/de` | 全部通过 | 通过 |

下表的“正确”是正样本得到正确可靠语言；“未知”包含全部未知原因，“错误”是错误可靠输出。统计单位始终为独立轨道，标签变体不增加分母。

| 语言 | 样本 | 正确 | 未知 | 错误 |
| ---- | ---- | ---- | ---- | ---- |
| `cs` | 20 | 15 | 0 | 5 |
| `da` | 20 | 18 | 0 | 2 |
| `de` | 21 | 21 | 0 | 0 |
| `el` | 20 | 20 | 0 | 0 |
| `en` | 21 | 17 | 4 | 0 |
| `es` | 20 | 15 | 0 | 5 |
| `fa` | 20 | 19 | 1 | 0 |
| `fi` | 20 | 20 | 0 | 0 |
| `fr` | 20 | 20 | 0 | 0 |
| `he` | 20 | 20 | 0 | 0 |
| `hu` | 20 | 19 | 1 | 0 |
| `id` | 20 | 9 | 2 | 9 |
| `it` | 20 | 20 | 0 | 0 |
| `ja` | 20 | 20 | 0 | 0 |
| `negative` | 13 | 0 | 13 | 0 |
| `nl` | 20 | 18 | 1 | 1 |
| `pl` | 20 | 20 | 0 | 0 |
| `pt` | 20 | 19 | 0 | 1 |
| `ru` | 20 | 11 | 4 | 5 |
| `sv` | 20 | 16 | 0 | 4 |
| `zh` | 20 | 16 | 4 | 0 |

| 长度/现象 | 样本 | 正确 | 未知 | 错误 |
| --------- | ---- | ---- | ---- | ---- |
| `ass-styling` | 1 | 1 | 0 | 0 |
| `authored-boundary` | 8 | 0 | 8 | 0 |
| `designated-regression` | 2 | 2 | 0 | 0 |
| `digits` | 1 | 0 | 1 | 0 |
| `emptyLetters` | 1 | 0 | 1 | 0 |
| `insufficient-evidence` | 2 | 0 | 2 | 0 |
| `links` | 1 | 0 | 1 | 0 |
| `long` | 1 | 1 | 0 | 0 |
| `lyrics` | 1 | 0 | 1 | 0 |
| `medium` | 39 | 32 | 3 | 4 |
| `mixed` | 4 | 0 | 4 | 0 |
| `names` | 1 | 0 | 1 | 0 |
| `repeated` | 2 | 0 | 2 | 0 |
| `romanized-japanese` | 1 | 0 | 1 | 0 |
| `shared-script` | 285 | 247 | 11 | 27 |
| `short` | 375 | 320 | 27 | 28 |
| `symbols` | 1 | 0 | 1 | 0 |

七条本地原轨全部通过提取身份检查，标签差异均为 0；检测预期仅 5/7 通过。未通过项不得由其他语料替代。

| 回归 | 当前结果 | 预期检查 |
| ---- | -------- | -------- |
| `regression-en-38` | `unknown/ambiguous` | 失败 |
| `regression-de-11` | `reliable/de` | 通过 |
| `regression-hu-19` | `reliable/hu` | 通过 |
| `regression-it-19` | `reliable/it` | 通过 |
| `regression-ru-19` | `unknown/ambiguous` | 失败 |
| `regression-sv-19` | `reliable/sv` | 通过 |
| `regression-romaji-29` | `unknown/ambiguous` | 通过 |

## Node 性能与构建

独立性能入口 9/9 通过；总计 30 个独立进程包含模型初始化、1,000 次预热后检测，实际工作片段及 25 次 Coordinator 等待分别计时。各负载的结果如下；不代替 IINA 宿主或自动翻译准入验收。

| 负载 | 冷 p95 / ms | 热 p95 / ms | 同步片段 p99 / ms | 最大检测等待 / ms |
| ---- | ----------- | ----------- | ----------------- | ----------------- |
| `maximum` | 19.78 | 2.06 | 1.35 | 6.86 |
| `preprocessing` | 21.93 | 3.04 | 0.05 | 196.46 |
| `shared-script` | 21.79 | 1.29 | 1.23 | 4.97 |
| `high-trigram` | 27.18 | 8.47 | 4.15 | 14.69 |
| `reliable` | 19.62 | 1.87 | 1.33 | 6.87 |

| 命令 | 当前结果 |
| ---- | -------- |
| `npm test` | 761 通过、1 失败、19 跳过；失败为 SC-001 质量门，真实服务及本地媒体默认关闭 |
| `npm run typecheck`、`npm run lint` | 通过 |
| `npm run build:native` | 通过，三个 helper 双架构构建与签名完成 |
| `npm run test:native` | 通过，退出码 0 |
| `npm run build`、`npm run verify:package`、`npm run pack` | 通过；未安装、未发布、未提升版本 |

打包版本 `0.1.3`；归档 SHA-256 为 `7d3c49d4601d07b6fb1d1e389ef25ff400eb7fbebd96315cf84b1a3df606263e`。因质量门失败，不能把此包视为已验收修复，产品代码任务也未勾选。

## 后续边界

T014 的质量失败保持可复现，不能跳过失败、修改真值或通过替换短轨补数。顺序实现停在该质量门；SC-003/004、完整 Main 生命周期覆盖、IINA 性能与实机流程均未验收。

已继续核查公开的独立来源池：[Valkaama 官方目录](https://www.valkaama.com/index.php?l=en&page=valkaama)列出 7 种字幕；Wikimedia 的 Sita Sings the Blues 目录有 15 种字幕，但[作品许可](https://www.sitasingstheblues.com/license.html)对歌曲另有例外，必须排除受限歌曲并核实字幕贡献许可。这些仅是候选，没有作为新一版冻结集，也没有取代当前失败结果。
