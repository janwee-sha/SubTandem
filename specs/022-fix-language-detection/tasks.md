# 任务：字幕语言检测修复与不中断翻译

**输入**：[规格](spec.md)、[计划](plan.md)、[研究](research.md)、[数据模型](data-model.md)、[检测契约](contracts/language-detection.md)、[翻译契约](contracts/translation-task.md)、[验证指南](quickstart.md)。

**交付轨道**：完整 SDD；实施须获得用户明确指示，且已采用的需求检查清单须全部通过。验收状态以各项勾选及验证记录为准。

**组织方式**：按三个 P1 用户故事划分；规格明确要求自动化回归、性能、真实服务与单人宿主验收。路径均相对仓库根目录；标注“新增”的路径由对应任务创建。`[P]` 仅表示满足下文前置依赖后可并行，`[USn]` 对应规格用户故事。

**验收记录**：实施时在本目录新增 `verification.md`，只保留当前候选实现的环境、代码修订、语料/阈值版本与哈希、命令及结果、包版本与 SHA-256、未通过项；不得记录凭据、endpoint、字幕、译文或原始响应。每次完成代码变更后，重新执行验证指南第 3 节的测试、编译与正式打包；三项均成功才能将对应代码任务标为 `[X]`，不得沿用修改前结果。真实服务和宿主任务分别验收。

## 阶段 1：语料前置准备

**目标**：首先取得可复现的自然字幕与冻结清单。T001–T002 通过前，不开展检测校准或产品验收。

- [X] T001 按 `specs/022-fix-language-detection/quickstart.md` 第 1 节及数据模型采集、逐条核验许可/署名与正文真值，在 `tests/fixtures/languages/calibration.json`、`tests/fixtures/languages/acceptance.json`、新增 `tests/fixtures/languages/tracks/`、`tests/fixtures/languages/licenses/` 和 `tests/fixtures/languages/same-language.json` 冻结受版本管理的语料；验收正样本至少 20 种语言各 20 个独立轨道，另含负样本、全部长度/现象分层及两个开放许可指定短轨，同语言集预标 `verbatim/translate`；校准与验收按完整同源组隔离，保留哈希、选段及真值依据，开放许可集合缺少正文或授权时保持未验收，不以替代或循环正文补数；七个 FFmpeg 指定回归只在新增 `tests/fixtures/languages/local-regressions.json` 保留[本地回归契约](contracts/local-regressions.md)要求的安全元数据，正文不入库且不作为本任务前置条件。
- [X] T002 新增 `tests/helpers/language-corpus.ts` 和 `tests/contract/language-corpus.test.ts`，直接使用生产 SRT/ASS parser 加载 T001 语料，检查文件及许可记录纳入版本管理、清单/正文哈希、实际 cue/文字计数、同源隔离、正文去重、数量、分层、两个开放许可指定短轨与同语言预期；验证七个本地回归元数据，并新增默认关闭的 `tests/integration/local-language-regressions.test.ts` 本地入口，直接使用生产 native helper 和检测器、验证来源/提取哈希及安全输出，本阶段只验证加载与输入边界，检测缺陷验收由 T014 执行；执行 `npm test -- tests/contract/language-corpus.test.ts`，将自动化结果及单名开发者的许可/真值审查结论记录到新增 `specs/022-fix-language-detection/verification.md`。

**检查点**：完整语料前置门通过；自动检查不代替许可与真值审查。

## 阶段 2：共享检测依赖与语言身份

**目标**：固定标准模型和独立源语言目录，供三个故事共同使用；依赖阶段 1。

- [ ] T003 在 `package.json`、`package-lock.json` 将检测依赖锁定为 `franc@6.2.0` 并移除 `franc-min`，同步迁移 `src/subtitles/language-detection.ts` 的模型导入，更新 `THIRD_PARTY_NOTICES.txt` 的实际随包依赖及许可声明；保持项目版本、权限和网络目的地不变。
- [ ] T004 新增 `tests/unit/source-languages.test.ts` 并更新 `tests/unit/target-languages.test.ts`，覆盖研究固定的 119 个模型代码→113 个源身份、宏语言归一化、英文 provider 标签、未映射候选、通用 `zh/pt` 不推断变体，以及 156 项目标 ID/顺序/显示名保持原契约。
- [ ] T005 新增 `src/domain/source-languages.ts` 实现固定映射、源身份校验及标签查询；在 `src/domain/target-languages.ts` 移除仅供检测使用的 `detectorCode` 与反查逻辑，同步迁移 `src/subtitles/language-detection.ts` 的源身份查询并使用完整模型候选集合，保持目标变体及偏好契约，运行 T004 测试。

**检查点**：源/目标身份边界及检测器引用完成迁移，可继续实现可靠性规则。

## 阶段 3：用户故事 1——可信的正文语言判断（P1，最小可交付范围）

**目标**：短轨和自然对白依据整体有效正文获得可信判断，含糊正文保留未知。

**独立验收**：生产检测器在冻结轨道集满足 SC-001 的三类分母及分层统计；九个指定回归全部符合预期，正确/缺失/错误标签造成的结果变化为 0。检测及协调器另满足 SC-005 的本地性能、deadline 与归属约束。

### 回归覆盖

以下测试可在阶段 2 后按文件并行编写。先证明边界用例能暴露缺陷；冻结验收集的检测指标只在 T011 固定参数后执行，不用于调参。

- [ ] T006 [P] [US1] 扩展 `tests/unit/language-detection.test.ts`，覆盖充分短轨无 cue/窗口下限、重复正文只贡献一次证据、数字/链接/专名/无语义歌词及无可靠赢家的混合正文未知、混合主语言按 T045 契约选择、ASS 准备后正文、四区域覆盖、64 cue/4096 码元总界限、至多 4 个且各 ≤2048 码元片段、代理对安全、完整模型竞争、无第二候选不自动可靠及不推断变体；算法用例采用校准集或独立边界数据。
- [ ] T007 [P] [US1] 扩展 `tests/unit/language-detection-coordinator.test.ts` 与 `tests/integration/auto-language-support.test.ts` 的检测用例，直接验证真实工作分片、正文就绪计时、内部停止时间前/等于/之后、同步异常、永不完成步骤、一次终态、失效后停工，以及 Main 的外挂/内嵌正文归属、元数据不影响结果和 seek 保留判断；补充剩余预算耗尽、定时器延迟及同步片段跨越截止时间的用例，验证第 499 ms 不会启动新的检测片段，实际超过 500 ms 的样本仍被性能验收判为失败。
- [ ] T008 [P] [US1] 重写 `tests/integration/acceptance-metrics.test.ts` 的语言指标部分，复用 T002/T050 加载器按明确用途读取独立留出版本，对每个独立轨道调用生产检测器一次；分别计算正样本正确可靠率、全部样本错误可靠率、负样本可靠率，按语言/长度/现象报告正确、未知/不支持、错误可靠计数与比例，混合主语言层单列；两个开放许可指定短轨作为已知回归单列 SC-002，七个 FFmpeg 指定回归使用 T002 的独立本地入口，均不进入留出分母；标签变体不得重复计入分母，保留该文件其他功能验证。
- [ ] T009 [P] [US1] 扩展 `tests/integration/performance.test.ts` 的语言测量，覆盖最大样本、20,000-cue 预处理、共享脚本、高 trigram 和完整可靠判断路径；至少 30 次独立冷实例包含模型初始化，预热后至少 1000 次测热态与各同步片段，并测正文就绪到检测终态的总等待，保留其他性能用例。

### 实现与验收

- [ ] T010 [US1] 在 `src/subtitles/language-detection.ts` 切换标准 franc 与 T005 源目录，实现检测契约的去重、有界四区域采样、分片及候选证据聚合；提供 Coordinator 可逐步执行的实际工作单元，预处理每批至多扫描 128 cue 且拆分大文本；统一 `reliable/unknown` 及原因枚举，删除固定 cue/匹配窗口门禁、50 次幂、旧脚本拒绝与变体猜测路径。
- [ ] T011 [US1] 新增 `tests/helpers/language-calibration.ts` 并通过 `tests/unit/language-detection.test.ts` 的显式校准用例调用生产检测路径，仅使用 T050 用途索引选择的校准版本按正文量/脚本分层比较有界阈值组合，不包含脚本占比或固定支持比例门禁；先固定搜索范围及“错误可靠率→正确可靠率→规则简单度”选择规则，使用 `SUBTANDEM_LANGUAGE_CALIBRATION=1 npm test -- tests/unit/language-detection.test.ts -t calibration` 执行，再将选定参数写入 `src/subtitles/language-detection.ts`，将清单版本/哈希、选择规则及参数记录到新增 `tests/fixtures/languages/calibration-result.json`；此开关仅用于测试工具，普通回归只读取冻结配置，不自动重调参数。
- [ ] T012 [US1] 在 `src/app/language-detection.ts` 执行 T010 实际采样/分类片段并在片段间让出事件循环，绑定完整 owner/attempt、使用传入的正文就绪时间，按检测契约分别落实内部停止时间和 500 ms 验收上限，在内部停止时间安排独立唤醒；片段前后及提交时检查身份和时间，停止后不再启动工作，未知终态立即触发准入检查；异常与到期分别提交一次 `unknown/error`、`unknown/timeout`，失效 attempt 停止后续工作，普通 seek 不取消同正文检测。不得将定时器已触发或已返回 unknown 当作等待时限通过的证据。
- [ ] T013 [US1] 在 `src/main.ts` 的外挂与内嵌正文就绪入口传递 `sourceReadyAt`、播放器/会话/媒体/轨道/正文身份，适配新的终态模型；换轨、换片、正文变化、禁用、结束播放和关闭时清理对应 attempt，迟到结果不得更新 Sidebar 或新会话，tick/轮询不得重启同一次未知终态；配置变更和自动翻译衔接由 T021 完成。
- [ ] T014 [US1] 参数冻结后执行 `specs/022-fix-language-detection/quickstart.md` 第 2 节的映射、检测、协调器、指标测试及 T007 的 Main 检测用例，将 SC-001/002 的分母、各层结果和冻结版本记录到 `specs/022-fix-language-detection/verification.md`；正确可靠率须 ≥95%，全部样本错误可靠率与负样本可靠率各 ≤1%，冻结集指定短轨及标签不变性须全部通过；另按本地回归契约显式执行七个 FFmpeg 指定回归及标签不变性，单独记录通过/失败/未运行，不与 SC-001 分母合并；失败时不得调整验收真值或删样本，重新校准须另建独立冻结验收版本。
- [ ] T015 [US1] 在计划测量环境执行 `npm test -- tests/integration/performance.test.ts --maxWorkers=1 --no-file-parallelism`，向 `specs/022-fix-language-detection/verification.md` 记录实际环境、采样次数及原始安全耗时统计，分别核对首次 p95 ≤100 ms、热态 p95 ≤50 ms、同步片段 p99 ≤16 ms 和检测总等待 ≤500 ms；自动翻译准入的衔接由 T021/T022 验证，Node 结果不能代替宿主验收。

**检查点**：US1 检测能力可独立演示和评估；整项功能仍需后续继续翻译与原样返回能力。

## 阶段 4：用户故事 2——未知源语言继续翻译（P1）

**目标**：任何未知原因均自动进入当前已选服务，源语言语义为 `null`，目标及配置条件保持有效。

**独立验收**：七类未知原因均经 Main/controller→Global/Broker→四类实际适配器的受控 transport 发出任务；没有伪造源语言、额外识别请求或用户补填操作。检测到期立即释放准入，服务失败沿用既有状态/有限重试。

### 回归覆盖

- [ ] T016 [P] [US2] 扩展 `tests/contract/global-provider-client.test.ts`、`tests/contract/global-rpc.test.ts`、`tests/contract/ui-messages.test.ts` 和 `tests/unit/session-cache.test.ts`，覆盖必填 `sourceLanguage` 的可靠 ID/合法 `null`、缺失/空串/`auto`/`und`/未映射 ID 拒绝、非法 target 在 transport 前拒绝、目标变体保留、缓存 `null` 与可靠 ID 隔离及未知状态消息；以不同 Main ID/IINA sender ID 验证授权和原窗口回复。
- [ ] T017 [P] [US2] 扩展 `tests/integration/auto-language-support.test.ts`、`tests/integration/us2-cost-privacy.test.ts`、`tests/security/credential-leakage.test.ts` 和 `tests/security/redaction.test.ts`，覆盖全部未知原因、空/不可读/图形字幕无空任务、配置优先、用户禁用无请求、服务失败有限重试及必要上下文边界；使用生产启动入口/协调器/controller/Global/Broker/四类适配器和受控 transport，按验证指南对会话边界各重复至少 20 次并验证双窗口、无独立检测请求及无正文/凭据泄漏。

### 实现与验收

- [ ] T018 [US2] 在 `src/providers/types.ts`、`src/app/request-builder.ts`、`src/app/session-cache.ts` 贯通 `sourceLanguage: string | null`；在 `src/domain/messages.ts`、`src/adapters/iina/global-provider-client.ts`、`src/global.ts` 的正式消息路径完成必填源/目标身份校验，合法 `null` 原样往返；保持请求 envelope、Profile revision/指纹、权威 IINA sender 授权及原窗口路由，不把 Main ID 等同于 sender ID。
- [ ] T019 [US2] 在 `src/providers/translation-task.ts` 统一可靠源标签和未知源正文理解提示，源标签使用独立源目录；更新 `src/providers/openai.ts`、`src/providers/ollama.ts`、`src/providers/deepseek.ts`、`src/providers/claude.ts` 的内部 source 参数及共同 builder 调用，使四类服务所有现有模式接受 `null`，保持连接 probe、封装、取消和重试能力边界。
- [ ] T020 [US2] 在 `src/app/controller.ts` 允许检测任意未知终态以 `null` 建立请求及缓存身份，删除 `und`/虚构目标兜底，按检测契约落实启用、可读正文、有效已选 Profile/target、检测中、终态的准入顺序；在 `src/domain/status.ts`、`src/domain/messages.ts`、`ui/sidebar.ts` 删除 `languageUnrecognized/languageUnsupported` 阻断状态及文案，复用 IINA 1.4.4 当前 Sidebar 组件显示未知源信息。
- [ ] T021 [US2] 在 `src/main.ts` 接通可靠/未知终态后的当前位置即时调度；已生效目标或 Profile revision 变化时使未完成 attempt 失效并对当前配置提交 `unknown/interrupted`，不重启 500 ms 等待，已完成的同正文判断可继续使用；确保过期结果不能回流且一次终态只触发一次准入调度，更新 T007/T017 用例及 `tests/integration/performance.test.ts`，测量并验证正文就绪到自动准入释放 ≤500 ms。
- [ ] T022 [US2] 执行 T016/T017 所列测试及验证指南第 2 节的未知源语言回归，在 `specs/022-fix-language-detection/verification.md` 记录七类原因×四类服务的实际适配器请求矩阵、deadline/生命周期和安全计数；SC-003 与自动化 SC-005 必须全部通过，不能只用 fake provider 证明四类服务覆盖。

**检查点**：检测未知时一次启用即可继续翻译，读取失败及无效配置仍阻止请求。

## 阶段 5：用户故事 3——同语言原样返回正文（P1）

**目标**：继续调用当前服务，统一逐条原样/翻译规则，保留合法响应的全部正文字符。

**独立验收**：本地同语言、未知同语言、混合条目及显式目标变体均发出真实适配器请求；冻结 `verbatim` 条目通过 validator、progress/result、controller、缓存和 Overlay 后逐字符相等，ID 与半开显示时间不变。格式合法的语义改写仍按成功接收；真实服务遵从性单独验收。

### 回归覆盖

- [ ] T023 [P] [US3] 扩展 `tests/contract/openai.test.ts`，对 `strict-json-schema/json-object/prompt-json` 三种模式验证相同的未知源、逐条原样、精确目标变体及不复制上下文规则，合法相同正文被接受且不触发额外 probe/重试，维持当前逐条有效结果处理。
- [ ] T024 [P] [US3] 扩展 `tests/contract/ollama.test.ts`，对 `json-schema/prompt-json` 及降级路径验证 T023 的共同规则和合法原样结果，保持既有兼容、部分提交及有限重试行为。
- [ ] T025 [P] [US3] 扩展 `tests/contract/deepseek.test.ts` 与 `tests/contract/claude.test.ts`，覆盖共同原样规则、混合条目及目标变体，保留 DeepSeek JSON object/thinking 配置、Claude Messages/system/text blocks/`end_turn` 规则和两者严格完整 wire ID 校验；缺失、重复、额外 ID 及空白结果仍失败。
- [ ] T026 [P] [US3] 扩展 `tests/contract/provider-output.test.ts` 与 `tests/unit/session-cache.test.ts`，直接验证普通/严格 validator 和缓存保留前后空格、标点、大小写、换行及内部空行，拒绝纯空白而不裁剪合法字符串；与源正文相同及格式合法的语义改写均正常接收，不新增语义重试。
- [ ] T027 [P] [US3] 扩展 `tests/integration/auto-language-support.test.ts`、`tests/integration/translation-alignment.test.ts`、`tests/integration/overlay-webview-lifecycle.test.ts`、`tests/integration/us2-cost-privacy.test.ts`、`tests/unit/language.test.ts` 和 `tests/contract/ui-messages.test.ts` 的同语言用例，使用冻结 case 覆盖四类实际适配器调用、未知/混合正文、重复 ID 之外的重复正文、progress/result 到 Overlay 的字符保留、目标变体转换及显示时间；移除同语言不调用服务与无需翻译状态的旧断言。

### 实现与验收

- [ ] T028 [US3] 在 `src/providers/translation-task.ts` 让所有服务 system 提示共用逐条语言/原样规则，要求已符合精确目标及显式变体时原样返回，否则仅翻译该条 `text`；删除与合法原样结果冲突的绝对 source-text 禁令，保留上下文只供理解、不附加原文副本和不可信字幕边界，各服务仅追加自身封装约束。
- [ ] T029 [US3] 在 `src/app/controller.ts` 删除同语言发送门禁，在 `src/domain/language.ts` 删除 `shouldTranslate`，并从 `src/domain/status.ts`、`src/domain/messages.ts`、`ui/sidebar.ts` 删除 `noTranslationNeeded` 定义/接受集合/文案；同语言走正常 preparing/running/服务失败流程，不本地复制或跳过 provider。
- [ ] T030 [US3] 在 `src/providers/validation.ts`、`src/app/controller.ts`、`src/app/session-cache.ts` 仅用 `trim()` 判空，返回、提交、存储均使用 JSON 解码后的原字符串；核对 `src/adapters/iina/global-provider-client.ts`、`src/global.ts`、`src/domain/messages.ts` 的 progress/result 路径保留原字符串及现有身份校验，保持各服务现有无效结果提交粒度。
- [ ] T031 [US3] 在 `src/adapters/iina/webview-translation-overlay.ts` 将每个活动 cue 的完整正文作为一项 `lines` 传递，保留内部空行，沿用文本节点与 `pre-wrap` 及原半开时间区间；以 IINA 1.4.4 当前 Overlay 为参照，保持布局、样式和交互契约，运行 T027 对应显示回归。
- [ ] T032 [US3] 新增 `tests/integration/live-language-continuation.test.ts`，按验证指南第 4 节使用四种生产 provider、冻结同语言 case、既有环境变量与授权开关；未显式启用时不联网，逐 case 检查成功/字符相等/ID 及变体预期，仅输出安全计数，避免失败差异泄露正文；更新 `tests/integration/live-providers.test.ts`，使 `sourceEcho` 断言仅适用于预标需要翻译的条目。
- [ ] T033 [US3] 执行 T023–T027 的全部测试及 T032 默认关闭联网的测试入口，在 `specs/022-fix-language-detection/verification.md` 记录所有服务模式、冻结 case、字符链路、ID/时间轴及变体结果；插件部分的原样一致率必须 100%，同语言跳过调用和身份/时间错配为 0，真实服务结果留待 T037–T040。

**检查点**：三个故事完成自动化集成，真实服务与正式包仍需下阶段独立证据。

## 阶段 6：产品说明与交付验收

**目标**：同步披露，完成当前实现的测试、编译、打包以及不可由 mock 替代的验收。

- [ ] T043 交付 `specs/022-fix-language-detection/quickstart.md` 第 5.1 节的宿主计时能力：新增 `tests/host/language-performance/`、`scripts/measure-language-host.mjs` 和 `tests/contract/language-host-performance.test.ts`，在 `src/main.ts`、`src/app/language-detection.ts` 接入有界的安全数值观测；实现独立冷实例、自动热测、完整样本检查及汇总入口。工具直接调用生产模块，正式包不包含测试插件或语料；执行 `npm test -- tests/contract/language-host-performance.test.ts tests/unit/language-detection-coordinator.test.ts tests/integration/auto-language-support.test.ts`，验证工具入口、样本完整性、观测不改变调度/取消/请求行为且不泄露敏感内容。完整操作指引及可执行入口通过前保持未验收；宿主实测结果由 T044 验收。
- [ ] T034 [P] 更新 `README.md`、`docs/readme/README.zh-CN.md`、`docs/readme/README.ar.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md`、`docs/readme/README.ru.md` 和 `docs/engineering/development.md` 的相关功能/配置/隐私/排错说明，移除手动源语言和源目标必须不同的要求，明确本地检测失败或同语言仍向当前已选服务发送必要正文；多语言 README 沿用各自语言，开发文档引用本规格验证指南，不增加文档自动化测试。
- [ ] T035 [P] 在 `tests/contract/package-manifest.test.ts` 与 `scripts/verify-package.sh` 补齐本次依赖迁移的正式交付检查，验证锁定 franc 的离线随包能力、第三方声明及 `franc-min` 移除，保留 helper 双架构/执行权限/签名、manifest 权限/最低版本和产物排除规则，确保源码、tests/语料、T043 计时工具及测试插件、依赖树、密钥与运行状态不进入安装包。
- [ ] T036 在全部代码及 T043、T034–T035 完成后，按 `specs/022-fix-language-detection/quickstart.md` 第 2–3 节重新运行聚焦与性能回归，以及 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`；检查正式包内容及离线检测，将环境、结果、当前版本及包 SHA-256 记录到 `specs/022-fix-language-detection/verification.md`，不提升版本或创建 Release。
- [ ] T037 具备用户对实际服务联网及可能费用的明确授权后，按验证指南第 4 节执行 `tests/integration/live-language-continuation.test.ts` 的 `OpenAI language continuation`，先连接 Test 再运行全部冻结 case；将实际模型/模式的安全标识、成功数、原样一致率、混合/目标变体检查结果记录到 `specs/022-fix-language-detection/verification.md`，任一失败或未运行均保持未验收。
- [ ] T038 按 T037 的授权及验收规则执行 `tests/integration/live-language-continuation.test.ts` 的 `Ollama language continuation`，使用既有 Ollama 环境变量及开关，将全部冻结 case 的服务遵从性结果记录到 `specs/022-fix-language-detection/verification.md`。
- [ ] T039 按 T037 的授权及验收规则执行 `tests/integration/live-language-continuation.test.ts` 的 `DeepSeek language continuation`，使用既有 DeepSeek 环境变量及开关，将全部冻结 case 的服务遵从性结果记录到 `specs/022-fix-language-detection/verification.md`。
- [ ] T040 按 T037 的授权及验收规则执行 `tests/integration/live-language-continuation.test.ts` 的 `Claude language continuation`，使用既有 Claude 环境变量及开关，将全部冻结 case 的服务遵从性结果记录到 `specs/022-fix-language-detection/verification.md`；四类服务各自应原样返回条目的成功逐字符一致率须为 100%，不能用其他服务的结果替代。
- [ ] T044 使用 T036 的正式包，按 `specs/022-fix-language-detection/quickstart.md` 第 5.1 节完成 IINA 1.4.4 宿主模块测量及正式包准入计时；在 `specs/022-fix-language-detection/verification.md` 分别记录样本数、分位数、最大等待、超限数、环境及包哈希。缺少冷初始化证据、采样不足或任一预算失败时保持未验收。
- [ ] T041 向用户提供并由单名开发者手动执行 `specs/022-fix-language-detection/quickstart.md` 第 5 节主流程表的全部 IINA 1.4.4 正式包步骤，覆盖短轨/未知/同语言、变体、外挂/内嵌、准备失败、配置及生命周期、多窗口、服务失败、至少 30 分钟连续播放和卸载；在 `specs/022-fix-language-detection/verification.md` 记录当前包哈希、环境、Sidebar/Overlay 宿主参照、SC-005/006 结果及未通过项，性能证据引用 T044 的第 5.1 节验收结果，不重复要求人工计时，不调用浏览器控制或 Computer Use。
- [ ] T042 使用 T036 同一正式包，在 IINA 1.4.0 按 `specs/022-fix-language-detection/quickstart.md` 第 5 节重复短轨、未知源、同语言主流程及安装/卸载冒烟，将包哈希、架构/macOS/IINA 版本与结果记录到 `specs/022-fix-language-detection/verification.md`；未实际运行不得标记通过。

## 依赖与执行顺序

```text
T001 → T002 → T003 → T004 → T005
  → US1：T006–T009 → T010 → T011 → T012 → T013 → T014 → T015
  → US2：T016–T017 → T018 → T019 → T020 → T021 → T022
  → US3：T023–T027 → T028 → T029 → T030 → T031 → T032 → T033
  → T043 → T034–T035 → T036 → T037–T040、T044 → T041 → T042
```

- 箭头表示前置产出可用后继续集成；代码任务仍须在当批集成后的测试、编译、打包全部通过才标为 `[X]`。T001–T002 的语料门以完整冻结清单及语料专项检查通过为准；新清单的语言指标调用方在 T008 迁移。
- 当前修复先执行阶段 7 的 T045/T050 前置，再落实图中各故事及其对应修复任务；US2 使用 US1 的检测终态，US3 使用 US2 的 nullable source 与请求链路，三个故事不作为整块并发修改。
- T014 不得在 T050 独立版本及 T011/T051 参数冻结前执行验收指标；T015 验证 Node 检测性能，T021/T022 验证自动准入释放，T036 复验当前代码，T044 单独验证宿主性能及正式包准入计时。
- T043 在 T033 后串行集成，并作为 T035/T036 的前置任务；涉及共享生产文件时由集成负责人独占。T044 依赖 T036，与 T037–T040 分别执行，并作为 T041 完成验收的前置条件；正式包计时可与 T041 主流程同轮采集，分别记录结果。计时相关代码修改后仍须重新测试、编译和正式打包。
- 测试先覆盖契约缺陷，再实施对应逻辑；冻结验收集不参与开发调参。任何调参后的验收版本必须符合检测契约的独立性规则。
- T037–T040 可在 T036 后分别进行，授权与环境按服务确认，某一服务未验收不阻止其他服务验证。共用验收记录由一个负责人串行汇总；主流程人工验收在相应服务验证通过后执行。
- 后续修复代码时重新执行测试、编译和打包，并针对新包重做受影响的 live/宿主验收；保留所有任务 ID，实际未验收项保持 `[ ]`。

## 并行示例与文件所有权

下表只描述可选执行分工。使用多个 Agent 时必须隔离 worktree，并在委派中给出表内任务范围、所引用契约、对应任务列出的允许修改文件、验证命令和通过条件。公共 `types`、controller、Main、Global、lockfile 与 `verification.md` 同时只由集成负责人修改；集成顺序遵循上图。

| 范围 | 可并行任务及前置条件                                                                                               | 验证命令与完成条件                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US1  | 阶段 2 后 T006、T007、T008、T009 分别编写检测、生命周期、指标和性能覆盖，文件互不重叠；生产实现 T010–T013 串行集成 | 例如 T006 执行 `npm test -- tests/unit/language-detection.test.ts`，T007 执行 `npm test -- tests/unit/language-detection-coordinator.test.ts tests/integration/auto-language-support.test.ts`；指标与性能按 T014/T015 验收 |
| US2  | US1 接口稳定后 T016 与 T017 分别负责消息/缓存契约和完整链路/隐私回归；不同时编辑 Main/controller                   | 按 T022 执行各自任务列出的完整测试集合；例如 `npm test -- tests/contract/global-provider-client.test.ts` 与 `npm test -- tests/integration/auto-language-support.test.ts` 可独立验证消息和流程，不能代替完整矩阵           |
| US3  | US2 集成后 T023、T024、T025、T026、T027 分别负责不同测试文件；T028 的公共提示和 T029–T031 的共享生产文件串行处理   | 例如 T023 执行 `npm test -- tests/contract/openai.test.ts`，T024 执行 `npm test -- tests/contract/ollama.test.ts`；全部模式、字符串及时间轴按 T033 验收                                                                    |
| 交付 | 三个故事及 T043 集成后 T034 文档与 T035 打包检查可并行；T043 独占 Main/Coordinator                                 | 文档人工核对 FR-012；打包检查运行 `npm test -- tests/contract/package-manifest.test.ts`，最终由 T036 验证正式产物；宿主计时由 T044 验收                                                                                    |

实际委派须为所选任务给出全部测试路径组成的完整命令；性能使用 T015 的独立命令。并行只缩短编写时间，不取消依赖、授权或最终集成验证。

## 增量交付策略

1. 先完成自然语料门、源目录和 US1，作为可信本地检测的最小演示范围；通过相应回归与正式构建验证后评估，不宣称整项功能完成。
2. 接入 US2，验证任何未知原因均自动请求当前服务；再交付 US3，验证同语言请求和原字符链路。
3. 交付宿主计时工具，同步产品说明并完成当前候选包的全部自动化、宿主模块性能与正式包准入计时、四类真实服务及两个 IINA 版本验收。全部必需证据通过后，整项功能才可验收。

## 阶段 7：收敛

**当前决定**：取消主要文字系统占比门禁。混合轨按去重后有效正文中各语言的文字量选择占比最高的主要语言，不要求超过 50% 或固定支持比例；并列、证据不足或主要语言不可映射时保留未知。语言占比不等于 Unicode 文字系统占比、cue 数占比或 franc 相对分数。FR-003 的可靠性、SC-001 的质量指标及九个指定回归继续适用。

**执行边界**：本节补齐既有未验收任务的缺口，不替代其逐项验收；T001–T044 的编号和勾选保留。T045 先统一当前意图，T050 在新一轮开发校准前冻结材料；T049/T046/T051 完成检测修复，T047/T052 衔接未知准入，T048/T053/T054 衔接原样返回，T055/T058/T056 完成交付准备，最后执行 T057。公共 Main、Controller、检测器及验证记录串行集成。代码批次继续执行既有测试、编译与打包要求。

- [X] T045 [CRITICAL] 在本功能 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/language-detection.md`、`quickstart.md` 中落实上述主要语言决定，直接移除冲突约束并只读复核一致性；固定检测副本内的有界语言证据归属、有效文字按 Unicode 字母码点计权、未归属证据不强配语言、并列/不足的未知出口。明确同脚本多语言、跨脚本混合、人名、译文与罗马字歌词共存的预期；仅在检测内部估计占比，不新增逐 cue 产品接口或翻译语义校验。混合主语言另列验收层，不用于补足 SC-001 的 400 个单语自然正样本。对应 F1、新决定、FR-001/003/013、US1/AC2–3（missing）。
- [ ] T046 [CRITICAL] 依赖 T045/T050，在 `src/subtitles/language-detection.ts` 完成 T010 的主要语言选择：移除活动参数及决策中的 `minimumScriptRatio` 门禁，包括单候选路径；取消以 `minimumSupport` 固定比例或匹配片段数否决混合轨的逻辑。按可靠语言证据的有效文字权重选择最高者，保持完整模型竞争及未映射候选作用，保留不依赖脚本占比的罗马字/无语义内容保护。在 `tests/unit/language-detection.test.ts` 补充同/跨脚本混合、55:45、40:35:25、并列、cue 数与文字量赢家不同、重复正文、人名及充分长度罗马字的生产路径回归；测试正文预期由 T050 先行确定，执行 T006 对应命令。对应 F2、新决定、FR-001–004、US1/AC1–4（contradicts）。
- [ ] T047 [CRITICAL] 按 T016–T022 完成未知准入：贯通 `src/providers/types.ts`、请求 builder、缓存、Main↔Global 消息校验及四类实际适配器的必填 `sourceLanguage: string | null`；在 `src/app/controller.ts`、状态定义和 Sidebar 移除未知/不支持阻断与虚构语言兜底，源标签改用独立源目录。依赖 T045 和检测终态接口，联同 T052 执行 T022 的七类未知原因×四类服务矩阵，验证无效配置/不可读字幕/禁用不发请求，保留权威 sender、Profile revision、重试和隐私边界。对应 F3、FR-005/006/010/011、SC-003（contradicts）。
- [ ] T048 [CRITICAL] 依赖 T047，按 T023–T025/T028/T029 在 Controller、语言比较、状态和 Sidebar 删除同语言跳过调用路径；在 `src/providers/translation-task.ts` 统一四类服务逐条原样/翻译及显式目标变体要求，移除禁止合法原文相同结果的提示，沿用既有 wire 模式及上下文约束。执行所列 provider contract 与同语言集成回归，证明可靠同语言和未知同语言均调用当前服务，简繁及地区变体不被基础身份吞并。对应 F4、FR-007/009/010、US3/AC1–4（contradicts）。
- [X] T049 [HIGH] 依赖 T045/T050，修复 `src/subtitles/language-detection.ts` 中只凭 `cues.length <= 64` 使用前部总预算的采样分支：同时考虑有效独立 cue 与正文预算，超限时保留四区域覆盖，范围内保留全部有效正文。在 `tests/unit/language-detection.test.ts` 增加 63/64/65 cue 且正文超过 4096 码元、稀疏有效正文、单个超长 cue、后段主要语言与代理对边界；执行 T006/T009，保持总量、单片及每次预处理预算。对应 F5、FR-002、计划采样/性能决定、T010（partial）。
- [X] T050 [HIGH] 依赖 T045，扩充 `tests/fixtures/languages/` 的校准与独立冻结版本，并在 `tests/helpers/language-corpus.ts`、`tests/contract/language-corpus.test.ts` 支持明确的版本与用途校验：校准包含多个独立作品、相近语言、达到有效文字门槛的负样本及实际超过 2048 码元的自然输入；新留出集保持至少 20 种语言各 20 个独立单语自然正样本、许可和全部分层。已评估材料只作已知回归/开发材料，按完整作品及译本隔离，两个指定短轨所属作品不得进入校准；已知指定回归与未参与开发的留出结果分开报告。当前冻结清单及正文保持可复现，混合预期因本次决定改变时先按正文另建语义版本和依据，不能据检测输出来重标、删去单语失败项或用混合正样本补数。七个 FFmpeg 正文继续只在本地使用；执行 T002 的加载、哈希、许可、隔离和计数检查。对应 F6、FR-013、SC-001/002、T001/T002/T011（partial）。
- [ ] T051 [HIGH] 依赖 T046/T049/T050，在 `tests/helpers/language-calibration.ts` 和生产检测器中使用标准 `franc@6.2.0` 重新校准语言证据归属、候选排序与可靠性；移除被取消门禁的搜索轴，按作品分组验证，采用事先固定的错误约束、正确率和简单度选择规则，并记录各规则被有效检验的证据及算法/清单摘要。处理 id/ms、ru/bg、es/gl、sv/no 等相近语言竞争，不能只把错误改为未知或过滤掉竞争语言。先冻结参数，再通过 `tests/integration/acceptance-metrics.test.ts` 与本地回归入口执行 T014：正确可靠率 ≥95%、两项错误可靠率各 ≤1%、九项指定回归全部通过、标签差异为 0；混合主语言层核对 T045 的预标预期，既有分母不被混合样本稀释。质量通过前不验收检测修复，不擅自替换模型或降低指标。对应 F7、FR-003/004、SC-001/002、T008/T011/T014（partial）。
- [ ] T052 [HIGH] 完成 T007/T012/T013/T021 的 Main 真实入口覆盖：在 `src/main.ts` 接通终态后的即时调度，目标或 Profile revision 生效变化时中断未完成检测而不重启等待；在 `tests/integration/auto-language-support.test.ts` 使用生产启动入口与受控宿主/transport，覆盖外挂与内嵌正文就绪、配置变化、换轨/换片、禁用/关闭、seek、双窗口及迟到结果。检测归属部分随 T046 集成，自动准入部分依赖 T047；执行 T007/T017/T022 和性能回归，证明真实准入释放 ≤500 ms、各边界至少 20 次、无跨 owner 提交或额外请求，不能以 fake provider 或 Coordinator 单测替代 Main 链路。对应 F8、FR-011、SC-005、计划生命周期决定（partial）。
- [ ] T053 [HIGH] 依赖 T048，按 T026/T027/T030/T031 修复 `src/providers/validation.ts`、`src/app/controller.ts`、`src/app/session-cache.ts` 和 `src/adapters/iina/webview-translation-overlay.ts`：仅用裁剪副本判空，传递和存储原始 JSON 字符串，每个活动 cue 保留完整多行正文及内部空行。用冻结同语言 case 验证四类服务的 progress/result→缓存→Overlay 全链路逐字符相等，保持 ID、半开时间区间、现有非法结果提交粒度及宿主布局；执行 T033 的相关测试。对应 F9、FR-008/009、SC-004、US3/AC2–4（contradicts）。
- [ ] T054 [HIGH] 依赖 T047/T048/T053，完成 T032 的 `tests/integration/live-language-continuation.test.ts`，为四类生产适配器建立默认关闭的真实服务入口；调整 `tests/integration/live-providers.test.ts` 的 `sourceEcho` 断言，仅对预标需翻译条目禁止原文回显。使用冻结 case 和受控 transport 先验证未知源、同语言、混合条目、目标变体与安全计数，执行 T022/T033；默认运行不联网，实际模型遵从性由 T057 按原服务任务分别验收。对应 F10、FR-006–009、SC-003/004（missing）。
- [ ] T055 [HIGH] 依赖检测及准入链路完成，按 T043 创建 `tests/host/language-performance/`、`scripts/measure-language-host.mjs`、`tests/contract/language-host-performance.test.ts` 并接入 Main/Coordinator 安全数值观测；运行 T043 的完整命令，交付可由单名开发者操作的冷初始化、热测、同步片段及正式包准入计时工具。工具必须直接调用生产实现，不改变取消/调度行为，不输出正文/凭据，测试插件与语料不进入正式包。对应 F11、SC-005、计划宿主测量决定（missing）。
- [ ] T056 [HIGH] 依赖全部代码及 T055/T058，完成 T035 的正式包 franc 离线能力、依赖/声明和测试材料排除检查，并按 T036 对当前实现重新执行完整测试、typecheck、lint、native 构建/测试、插件构建、verify:package 和 pack。复核 T003–T005 的迁移与目录测试及 T015 性能，逐项验收满足条件的原任务；在本功能 `verification.md` 记录当前算法、清单、参数、环境、命令结果和包摘要，任何质量失败不得以打包成功代替通过，不提升版本或发布。对应 F12、FR-004/011、SC-001–005、计划交付决定（partial）。
- [ ] T057 [HIGH] 依赖 T054–T056，按 T037–T040 分别取得四类真实服务的实际遵从性证据，并按 T044/T041/T042 分别完成 IINA 1.4.4 性能、至少 30 分钟单人主流程及 IINA 1.4.0 正式包冒烟；各项继续使用原任务的授权、环境、命令和明确手动步骤，记录同一当前包摘要及独立结果。未运行、失败或仅有 Node/mock 证据的原任务保持未验收；后续代码变更须重建并重验受影响项。对应 F13、SC-004–006、计划真实服务/宿主验收决定（missing）。
- [ ] T058 [MEDIUM] 在当前行为确定后完成 T034，只更新所列 README 和开发文档的本功能说明：移除手动确认源语言及源目标必须不同的要求，说明混合轨按主要语言判断、本地未知或同语言仍发送必要正文到当前已选服务；核对目标变体、状态和隐私披露与生产行为一致，保留各语言 README 的语言及宿主操作术语，不增加文档自动化测试。作为 T056 的披露前置，人工审阅所改段落。对应 F14、FR-012、计划产品说明决定（contradicts）。
