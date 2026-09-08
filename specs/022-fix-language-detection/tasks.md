# 任务：修复字幕正文语言检测

**功能标识**：`022-fix-language-detection`　**交付轨道**：完整 SDD

**输入**：[规格](spec.md)、[计划](plan.md)、[研究](research.md)、[数据模型](data-model.md)、[检测契约](contracts/language-detection.md)、[语料契约](contracts/corpus-evaluation.md)、[验证指南](quickstart.md)。

**实施前提**：已采用的[需求清单](checklists/requirements.md)全部通过；进入实施前须取得用户明确指示。任务中的人工核对和正式包操作由开发者单人完成，使用验证指南中的命令和交互步骤。

**格式**：`- [ ] T编号 [P?] [US编号?] 描述及文件路径`。`[P]` 只表示下文指定依赖满足且文件互不冲突时可并行；验收通过才标记 `[X]`，保留全部任务及编号。

**验证约束**：规格明确要求自动化回归。先补充能够暴露生产缺陷的测试，再实现；自然语料的实施回归显式读取校准集，合成数据仅用于边界、故障注入和压力测试。冻结验收集在 T035 前仅做准入核验，不运行检测获取结果。不得为项目文档增加自动化测试。

## 阶段 1：准备评估入口

**目的**：复用既有 TypeScript、Vitest 和构建工程，建立真实语料的准入与评估能力。

- [ ] T001 在 `tests/helpers/language-corpus.ts` 实现数据模型所列来源、来源组、样本、人工真值、统计身份及冻结清单的加载与核验；调用生产字幕解析入口，检查文件/规范正文哈希、派生谱系、唯一主样本、文字区间及覆盖矩阵，拒绝模板扩充、跨集合泄漏和缺失准入信息。
- [ ] T002 在 `tests/integration/acceptance-metrics.test.ts` 替换循环模板语言验收，接入 T001；新增名称含 `language detection` 的校准/冻结评估用例，支持 `SUBTANDEM_LANGUAGE_CORPUS=calibration`，默认要求语料与配置均已冻结；直接调用生产检测及正文到翻译入口，按统计主样本输出四类结果和整体/语言/长度/内容分母，变体另报一致率，执行 SC-001–SC-005 断言并对缺失数据或验收失败返回非零状态；保留无关验收用例。

## 阶段 2：建立共同前提

**目的**：取得可重现语料并冻结真值与集合，固定离线模型和源语言边界。本阶段完成前不开始用户故事实现或调参。

- [ ] T003 [P] 收集 `tests/fixtures/languages/calibration/` 中的自然字幕及逐件许可/署名，在 `tests/fixtures/languages/calibration.json` 登记来源、修订、哈希、作品/译本谱系、样本及待核对真值；按语料契约补齐至少 20 种语言及短中长、指定回归、真实混语、罗马字日语、自然豪萨语、共享文字和范围外分层，不以可下载或轨道标签代替许可与真值。
- [ ] T004 [P] 从与 T003 隔离的作品和译本谱系收集 `tests/fixtures/languages/acceptance/`，在 `tests/fixtures/languages/acceptance.json` 登记同等准入信息；唯一自然主样本须覆盖至少 20 种源语言、每种至少 20 条自然 cue，5–11、12–30、≥31 cue 正样本组各至少 20 个独立片段，并补齐语料契约全部内容分层及指定回归；分段、格式及受控混合变体不能补数量。
- [ ] T005 由开发者逐项核对 `tests/fixtures/languages/calibration.json` 和 `tests/fixtures/languages/acceptance.json` 的正文真值、中文形式、语言文字区间、混合占比、范围内最高占比的预期集合、正文充分性、正样本归属及核对依据；用 T001 核验两集合完整覆盖、来源隔离和主样本分母后，将正文/真值/来源组/分层哈希写入 `tests/fixtures/languages/freeze.json`；缺失许可、无法核对或覆盖不足时继续补足，不标记冻结。
- [ ] T006 在 `tests/unit/language-detection.test.ts` 增加附录 A 的 67 种源身份与锁定模型代码一致性回归，在 `tests/unit/target-languages.test.ts` 调整检测映射断言归属并保留 156 项目标目录的 ID、显示名、顺序、Provider 标签和等价属性检查；证明目标选项不扩展源范围。
- [ ] T007 在 `package.json`、`package-lock.json` 将 `franc-min@6.2.0` 替换为固定 `franc@6.2.0`，核验全部源模型代码及范围外候选数据，并更新 `THIRD_PARTY_NOTICES.txt` 中实际分发组件和传递依赖声明。
- [ ] T008 新增 `src/domain/source-languages.ts` 的固定源映射，将 `src/domain/target-languages.ts` 中仅供检测的元数据和反向查询迁出，更新 `src/subtitles/language-detection.ts` 的依赖与映射导入；保留 `cmn → zh` 和源身份范围，移除 `franc-min` 生产路径，通过 T006 回归。

**检查点**：两集合真实语料已冻结，模型与源映射可构建；数值配置尚待 T034 校准冻结。

## 阶段 3：用户故事 1——短轨与中等轨自动翻译（P1，最小可验证范围）

**目标**：正文充分的短轨和局部含噪声的中等轨依据正文候选进入正确翻译方向。

**独立验收**：校准集对应的德语 11 cue、英语 ASS 约 38 cue、hu/it/ru/sv 约 19 cue、正文充分的 5–6 cue 拉丁文字及高区分文字样本全部正确；相同正文跨 12 cue 分段边界不改变翻译资格。最终冻结集的同类证明由 T035 完成。

### 回归测试

- [ ] T009 [P] [US1] 在 `tests/unit/language-detection.test.ts` 用冻结校准自然样本覆盖上述指定语言、极短/短/中/长轨、短句/专名、ASS 标记、重复歌词及 11/12 cue 成对分段；替换少于 12 cue、少于 200 字母或局部不一致即拒绝的旧断言，测试直接调用生产核心。
- [ ] T010 [P] [US1] 在 `tests/integration/auto-language-support.test.ts` 从生产正文解析入口串联协调器、controller 和受控 Provider，验证这些短中轨在启用且选定可用 Profile revision 后按正确方向发送附近必要字幕；检测期间零调用，目标等价时零调用，不直接注入语言结果代替正文识别。
- [ ] T011 [P] [US1] 在 `tests/unit/language-detection-coordinator.test.ts` 补充真实工作步骤之间让出执行、正文就绪起计时、步骤前后身份/期限检查、剩余预算不足、异常、仅一次超时提交及失效清理测试；断言扫描和分类发生在被测步骤内，不能用预先空让出代替。

### 实现与验证

- [ ] T012 [US1] 在 `src/subtitles/language-detection.ts` 建立可分片的正文扫描、NFC 规范化、Unicode Letter 计数、位置索引及内容片段工作状态；剥除格式与完整网址，保留结合标记和重复出现次数，跨 cue 构造上下文，避免按时长/ID 排序或先无界拼接，不修改显示及翻译正文。
- [ ] T013 [US1] 在 `src/subtitles/language-detection.ts` 接入受支持 `francAll` 查询并显式设置 `minLength: 0`，按码点限制单次含上下文输入至契约上限；删除 cue/文字量/幂变换分差/固定窗口及支持率拒绝门禁，按片段语言累计有效文字量并确定性选主语言，部分片段无候选不能丢弃其他已有候选；同步 `detectSubtitleLanguage()` 与异步消费接口使用同一生产工作核心。
- [ ] T014 [US1] 在 `src/app/language-detection.ts` 用 T012–T013 的真实工作步骤替换四次空让出加整段同步检测；扫描、取样、分类和聚合之间调度，逐步及提交前核验五项 attempt 身份，500 ms 期限或剩余步骤预算不足时当前 attempt 只提交一次 `unknown`，失效 attempt 不提交并释放正文证据。
- [ ] T015 [US1] 在 `src/main.ts` 和 `src/app/controller.ts` 接入新的协调结果，保持 `reliable` 为已选候选，复用启用状态、有效 Profile revision、`shouldTranslate()` 及当前位置门控；确保外挂和内嵌正文进入同一检测流程，保留英文状态与 Sidebar 结构，不新增置信度门槛。
- [ ] T016 [US1] 运行 `tests/unit/language-detection.test.ts`、`tests/unit/target-languages.test.ts`、`tests/unit/language-detection-coordinator.test.ts` 和 `tests/integration/auto-language-support.test.ts` 的本故事回归，并执行下文增量交付检查；在 `docs/validation/language-detection.md` 记录指定校准样本结果、方向、分段一致性和本次构建/包身份，不把校准结果记作冻结验收通过。

## 阶段 4：用户故事 2——含混与混合正文优先尝试翻译（P1）

**目标**：有受支持候选就尝试翻译；混合正文按有效文字量在范围内选主语言，范围外占优不触发拒绝；没有范围内候选且正文可确认仅属范围外时返回 `unsupported`。

**独立验收**：罗马字/稀少文字存在候选时不返回 `unknown`，自然豪萨语识别正确；混合多数、40/35/25、范围外占优、范围内外等比、范围内并列及分段/时长变体符合范围内最高文字量规则；空白/数字/符号/网址、无候选和仅范围外正文的状态及零调用正确。误判仍计识别错误。

### 回归测试

- [ ] T017 [P] [US2] 在 `tests/unit/language-detection.test.ts` 增加校准集真实混语、罗马字日语与自然豪萨语回归，并以登记派生关系的边界样本覆盖文字量与 cue 数/时长相反、40/35/25、范围内最高并列、同 cue/跨 cue、词内拆分/Han 换行、成团/交错、超采样上限及重复次数；覆盖用户故事 2 场景 6–7、范围外多语言合计占优、范围内少量文字及仅范围外混合，断言范围外文字不转计且占比分母完整；覆盖 fi/he/no、无法稳定归属的范围外文字、低分差/无候选注入和中文形式冲突。
- [ ] T018 [P] [US2] 在 `tests/integration/auto-language-support.test.ts` 从正文入口验证低置信度、罗马字/歌词、混合及稀少文字候选进入已选 Provider，覆盖范围外占优但选中范围内语言；所选范围内主语言与目标等价时零调用；正确/缺失/错误标签均不能覆盖正文候选或使无候选触发翻译，误判与翻译可用性分别断言。

### 实现与验证

- [ ] T019 [US2] 在 `src/subtitles/language-detection.ts` 完成混合片段的局部/邻近上下文归属及长轨均匀采样：全量预算内计实际文字，超预算最多 64 个代表区间，观测文字不超所选预算，按区间实际代表文字计权且上下文不重复计权；整轨候选仅补无局部候选片段，仅从范围内候选选择累计文字量最大者，范围内平票按规范语言 ID 的 Unicode 码点序选择。
- [ ] T020 [US2] 在 `src/subtitles/language-detection.ts` 实现独立范围外证据判断：完整查询的局部/上下文同身份与校准分差仅确认范围外，证据不足回到受支持候选；范围外语言分别累计，无稳定身份的文字保留未归属量，均保留在占比分母且不参与范围内排序、不转计文字量；范围外占优不能拒绝已有范围内候选；没有范围内候选且正文可确认仅属范围外时返回 `unsupported`，仅无有效文字/无候选/异常/超时返回 `unknown`。
- [ ] T021 [US2] 在 `src/subtitles/language-detection.ts` 先以 `zh` 参与主语言比较，再仅用归属中文的正文判别书写形式；保留至少三种独有形式字的证据规则，排除 `后/里/云` 等共享字，证据不足或冲突返回 `zh`，保留 `src/domain/language.ts` 的既有等价行为。
- [ ] T022 [US2] 运行 `tests/unit/language-detection.test.ts`、`tests/integration/auto-language-support.test.ts` 的本故事及 US1 回归，并执行增量交付检查；在 `docs/validation/language-detection.md` 记录混合范围内最高文字量/并列/变体一致性、范围外占优时的候选与翻译资格、仅范围外及无候选零调用，以及罗马字误判和自然豪萨语的独立结果。

## 阶段 5：用户故事 3——入口、既有语言与会话一致（P2）

**目标**：正式字幕入口使用同一正文判断，保留既有长轨正确性、语言等价、生命周期隔离与播放连续性，并交付可执行宿主验证工具。

**独立验收**：同正文的外挂 SRT/ASS 和内嵌 SubRip/ASS/SSA/`mov_text` 及标签变体结果一致；所有失效事件零提交/零请求，多窗口互不污染，seek 和成功保存目标语言复用当前源结果；真实计算满足性能与隐私契约。

### 回归测试

- [ ] T023 [P] [US3] 在 `tests/integration/auto-language-support.test.ts` 补充正式 Main 正文入口的标签变体、既有长轨、中文/地区等价、未启用、未选择/失效 Profile revision、seek 和目标保存成功/失败回归；禁止用 `ControllerSource.language` 的元数据赋值或直接 `setLanguageDetection()` 冒充端到端检测。
- [ ] T024 [P] [US3] 在 `tests/integration/embedded-subtitle.test.ts` 用同正文格式派生媒体调用正式 native helper 提取，再进入生产准备、检测和翻译流程，验证 SubRip/ASS/SSA/`mov_text` 与外挂结果和方向一致；覆盖正确/缺失/错误标签和精确选轨，不能只用伪造提取回复证明格式兼容。
- [ ] T025 [P] [US3] 在 `tests/unit/language-detection-coordinator.test.ts` 扩充换轨、换片、正文改变、禁用、关窗、同正文新 attempt、双窗口并发及每种真实步骤间迟到结果回归；断言失效后零提交/零请求、引用释放，seek 不重检、目标改变只重新门控。
- [ ] T026 [P] [US3] 新增 `tests/security/language-detection.test.ts`，调用生产检测、Main 和 controller 检查离线处理、仅选定 Profile revision 接收附近必要字幕、无跨会话缓存；按 FR-012 允许仅会话保留的 Log Viewer 日志包含字幕正文、译文，验证日志随所属会话销毁、不持久化、不跨会话复用；其他日志/诊断及检测消息/错误不含正文、译文，所有日志/诊断及检测消息/错误不含候选、路径、原始标签或凭据；验证安全计时仅白名单字段，并调用 T029 工具证明回环监听、计数区分、无正文输出及宿主输入不回显。
- [ ] T027 [P] [US3] 在 `tests/integration/performance.test.ts` 替换将同进程前 20 次当作首次的检测测试：至少 40 次独立进程初始化和 40 次热调用分别测量，另列模型导入成本；通过生产协调器计时扫描/取样/分类/聚合和调度总耗时，报告首次 p95 ≤100 ms、重复 p95 ≤50 ms、实际步骤 p99 ≤16 ms、总期限 ≤500 ms，覆盖 20,000 cue 及超采样预算输入，不以 Node 结果代替宿主验收。

### 实现与验证

- [ ] T028 [P] [US3] 在 `src/main.ts` 和 `src/app/controller.ts` 完成 T023–T026 揭示的入口及生命周期集成：失效事件撤销当前工作，提交核验窗口/媒体/轨道/正文/attempt，正文标签不能绕过检测，seek 与目标保存复用同源候选；关闭窗口和禁用后清理会话证据，保持现有状态和播放行为。
- [ ] T029 [P] [US3] 新增 `scripts/language-detection-validation.mjs`：按语料契约实现 `serve --port 8765` 的回环 OpenAI-compatible models/chat/metrics 接口，按生产 ID wire 回复且区分连接测试与翻译计数，不打印/保存请求；实现 `host-metrics` 白名单读取标准输入并输出样本数、首次/重复 p95、步骤 p99、最慢值和门禁结论，不足 40 次首次或热调用时明确未完成。
- [ ] T030 [US3] 在 `src/app/language-detection.ts` 注入真实步骤与总时长接收器，在 `src/main.ts` 将首次/重复类别、步骤/总时长和最终状态接入既有会话 Log Viewer，字段与 T029 工具一致；不得输出语言、候选、内容哈希、身份、正文或路径，完成/失效后释放计时及正文工作状态。
- [ ] T031 [P] [US3] 在 `tests/fixtures/media/` 制作或提供可重建的最小格式/标签派生媒体及 20,000 cue 压力媒体，在 `tests/fixtures/languages/media.json` 登记样本 ID、主样本谱系和媒体对应，在 `tests/fixtures/languages/README.md` 给出完整生成命令及许可/署名；自然准确率只统计原主样本，大型压力媒体可按命令生成，人工操作不依赖私有影片。
- [ ] T032 [US3] 按 `specs/022-fix-language-detection/quickstart.md` 执行聚焦回归、正式 helper 提取集成及 T029 工具命令行冒烟检查，再执行增量交付检查；在 `docs/validation/language-detection.md` 记录入口/标签一致率、固定分母的正确方向比例、失效零调用、安全检查和 Node 性能，宿主项保持待实测。

## 阶段 6：校准、冻结验收与交付

**目的**：仅用校准集选择最终生产参数，完整执行冻结验收与正式包单人验证。

- [ ] T033 更新 `README.md`、`docs/readme/README.zh-CN.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.fr.md`、`docs/readme/README.ru.md`、`docs/readme/README.ar.md` 的直接相关语言说明；明确离线正文候选可能错误、混合主语言、范围外/无法识别/无需翻译状态及仅向已选服务发送附近正文，删除手动确认源语言的过时说明，不扩大目标选项对应的检测承诺。
- [ ] T034 在 `tests/integration/acceptance-metrics.test.ts` 的校准模式按检测契约有限参数表运行同一生产核心，结合 `tests/integration/performance.test.ts` 和行为回归排除不合格配置，按最差长度组/总体正确率、范围外行为及预算顺序选择；将最终参数落实到 `src/subtitles/language-detection.ts`，在 `tests/fixtures/languages/detector-config.json` 冻结参数、模型/锁文件/实现与语料哈希及校准报告身份，在 `docs/validation/language-detection.md` 保存安全指标；无合格配置则保持未验收并修订本规格设计，不运行冻结验收或增加候选拒绝门槛。
- [ ] T035 在配置冻结后运行 `npm test -- tests/integration/acceptance-metrics.test.ts -t 'language detection'`，使用全部冻结主样本及登记变体验证 SC-001–SC-005：总体和三长度组正样本正确率各 ≥95%、同分母拒绝合计 ≤5%，指定回归/混合选择/平票及变体规则全部通过，端到端翻译资格和零调用完整，元数据缺失/错误固定分母正确方向 ≥95%；将逐片段四类结果、全部分层分子/分母及构建身份记录到 `docs/validation/language-detection.md`，失败不删样本、不改真值、不反向调参。
- [ ] T036 最后一次代码修改后按 `specs/022-fix-language-detection/quickstart.md` 依次运行完整 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`；核验本次正式包的离线模型/许可、helper 双架构/执行权限/签名、manifest 权限/最低宿主与排除语料/源码/运行时数据，在 `docs/validation/language-detection.md` 记录命令结论、版本和 SHA-256，任何失败不沿用旧包。
- [ ] T037 由开发者按 `specs/022-fix-language-detection/quickstart.md` 正式包步骤 1–6 安装本次产物、配置回环 Profile，完成指定语言、罗马字/豪萨语/混合、等价、无有效文字/范围外、格式/标签、换轨换片禁用关窗和多窗口操作；以 Provider 翻译调用增量、状态、译文出现及视频/原字幕连续性验收，在 `docs/validation/language-detection.md` 记录包哈希、环境和逐场景结论。
- [ ] T038 由开发者按 `specs/022-fix-language-detection/quickstart.md` 步骤 7 使用本次正式包及压力媒体，采集至少 40 次独立播放器运行时首次检测和 40 次同运行时热调用，通过 `pbpaste | node scripts/language-detection-validation.mjs host-metrics` 验证首次/重复 p95、真实步骤 p99、最迟 500 ms 及 20,000 cue 播放/seek 连续性；在 `docs/validation/language-detection.md` 分别记录设备/系统/IINA/架构、参数与包身份和宿主指标，不以目测或 Node 测量代替。
- [ ] T039 按 `specs/022-fix-language-detection/quickstart.md` 步骤 8 卸载正式包并核对 SC-001–SC-006 与两份契约的全部证据，完成 `docs/validation/language-detection.md` 的验收结论；在 `specs/022-fix-language-detection/tasks.md` 仅将实际验收任务标记 `[X]`，缺语料、失败指标或未执行人工步骤保持 `[ ]`。

## 依赖与执行顺序

```text
T001 → T002 → (T003 ∥ T004) → T005 → T006 → T007 → T008
  → US1（T009–T016）→ US2（T017–T022）→ US3（T023–T032）
  → T033 → T034 参数冻结 → T035 冻结验收 → T036 正式包
  → T037 宿主功能 → T038 宿主性能 → T039 最终验收
```

- US1 复用共同前提；US2 复用 US1 的正文核心、片段累计和调度；US3 复用前两故事的候选语义。因此三个故事按顺序集成，各自有独立行为验收，不能同时修改检测器或集成文件。
- 每个故事先完成测试编写，再按实现任务顺序执行，最后通过该故事验证任务。US3 的 T028、T029、T031 可在 T023–T027 测试编写后并行；T030 依赖 T028、T029；T032 等待全部实现及媒体就绪。
- T003/T004 先按作品/译本谱系分配互斥来源组，各自只写所属集合文件；T005 统一核对并冻结。T034 只看校准结果，T035 才首次运行冻结验收。
- 冻结验收暴露后如需优化检测，不使用同一验收集继续选参；保留失败证据，按语料契约取得未暴露独立来源并建立新版本，再完成冻结与验证。

## 并行示例与文件所有权

| 阶段/故事 | 满足前置条件后的可并行任务 | 独占文件边界 |
| --- | --- | --- |
| 语料准备 | T003 ∥ T004 | 各自的集合目录及 JSON；共同冻结清单由 T005 负责 |
| US1 | T009 ∥ T010 ∥ T011 | 检测器单测、语言集成测试、协调器单测分别独占 |
| US2 | T017 ∥ T018 | 检测器单测与语言集成测试分别独占；T019–T021 串行修改核心 |
| US3 测试 | T023 ∥ T024 ∥ T025 ∥ T026 ∥ T027 | 五个测试文件分别独占，不并发改共享 helper |
| US3 实现 | T028 ∥ T029 ∥ T031 | Main/controller、本地工具、派生媒体及对应表分别独占；随后 T030 接入计时 |

如委派独立切片，MUST 使用隔离 worktree 或等效工作区；委派说明列出任务 ID、相关契约章节、允许修改文件、该任务的验证命令和完成条件。`src/subtitles/language-detection.ts`、`src/main.ts`、`src/app/controller.ts`、依赖文件、共享评估 helper 和验证报告同一时间只有一个负责人；验证报告由集成人员统一写入。`[P]` 不授权同时写入共享文件。

## 增量交付检查与实施策略

每次代码变更形成可验收增量后，先运行其聚焦测试，再依次运行以下命令；全部成功后才能勾选该批代码任务。测试失败的中间修改不能记为完成；最后一次代码变更后的完整检查由 T036 承担。

```sh
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

校准命令与默认冻结验收命令分别采用 [quickstart.md](quickstart.md) 中的显式调用，不能自动切换集合或用跳过缺失数据取得通过。

1. **最小可验证范围**：阶段 1–3，完成 US1 的短中轨正文到 Provider 流程及聚焦测试/编译/打包，作为校准集上的可演示增量。完整功能交付仍需后续冻结验收和正式宿主验证。
2. **逐故事增量**：按 US2、US3 顺序补齐混合/范围外、入口/会话与工具；每次验证保留前序故事回归，共享文件串行集成。
3. **最终交付**：先冻结配置，再评估独立验收集，最后执行全套交付检查及开发者正式包手动验证；证据保存在验证报告，不向 SDD 追加开发日记或改写其他规格。
