# 验证指南：语言检测与不中断翻译

语料前置步骤在重新开发校准前执行，其余步骤验收当前候选实现；入口交付及通过状态见 [tasks.md](tasks.md)。行为依据见 [检测契约](contracts/language-detection.md)、[翻译任务契约](contracts/translation-task.md)，避免在证据中记录凭据、endpoint、字幕、译文或原始响应。

## 1. 环境与语料前置任务

使用 [开发环境](../../docs/engineering/development.md#开发环境)，在仓库根目录执行命令。性能基线固定为 Apple M5 Pro / 24 GB、macOS 26.6.2、Node.js 24.18.0、npm 11.16.0；宿主为 IINA 1.4.4，另用 1.4.0 验证正式包基线。环境改变时记录实际版本，不能沿用其他环境的性能结论。

```sh
npm ci
```

按 T045 → T050 顺序，重新开发校准前完成 `tests/fixtures/languages/` 的[语料记录](data-model.md#验收语料与冻结记录)：

- 冻结新的独立留出版本：至少 20 种可识别语言，每种至少 20 个自然、正文独立的单语正样本，另含不可可靠判断的负样本；覆盖 FR-013 全部分层，按完整作品及全部译本与全部开发材料隔离。已评估清单及正文保持可复现，只作为已知回归/开发材料。
- 校准包含多个独立作品、相近语言、达到有效文字门槛的负样本和实际超过 2048 码元的自然正文；按作品分组验证。校准前固定搜索范围及“错误约束→正确率→规则简单度”选择规则，移除脚本占比及固定支持比例搜索轴。
- 逐条核实字幕本身的再分发许可、署名、正文真值、哈希和选段；可平移选段时间起点，但保留原 cue 正文、相对时间及原范围记录。
- 保留开放许可的 `regression-short-5` 和 `regression-short-6`，所属作品不得进入校准；两者作为已知指定回归单列 SC-002，不称作未见留出样本。其余七个 FFmpeg 指定回归使用[本地输入契约](contracts/local-regressions.md)，正文不入库、不计入 SC-001，也不作为 T001 的前置条件；不能用其他正文冒充，缺失或失败仍使 SC-002 未验收。
- 混合主语言另建语义版本：先按正文标注语言区间、Unicode 字母码点量、未归属原因和主要语言/未知预期，再执行检测；覆盖检测契约的同/跨脚本、55:45、40:35:25、并列、cue 数与文字量不同及人名/译文/罗马字共存边界。该层单列，不能补足 400 个单语自然正样本或稀释其指标。
- 冻结同语言 case 集，覆盖已知同语言、未知同语言、混合条目、标点/大小写/空格、多行/内部空行、重复正文、中文简繁及 `pt-PT`。每条预先标注 `verbatim/translate`，固定当前任务实际发送的 `text`。

`tests/contract/language-corpus.test.ts` 检查版本/用途、manifest、受版本管理的文件及许可记录、哈希、去重/同源隔离、数量和分层，并通过生产 parser 核对 cue；另验证七个本地回归的安全元数据和默认关闭的输入边界。正文真值及授权仍需单名开发者依据来源审查，脚本通过不能代替。

```sh
npm test -- tests/contract/language-corpus.test.ts
```

前置任务通过后才允许校准及验收。冻结阈值配置后运行下一节；独立留出集一旦被评估，再次改进算法或调参前须按[校准门禁](contracts/language-detection.md#校准门禁)另建独立留出版本。留出尚未评估时，可继续仅使用校准材料开发。

校准失败时，可先运行以下默认关闭的归因入口。它仅使用当前校准材料，输出候选、非重叠区间、字母计数、归属与拒绝原因及受控对比，写入当前语料版本的 `diagnosis-result.json`；不记录正文、不评估留出集。基线对比及当前质量状态见 [verification.md](verification.md)。

```sh
SUBTANDEM_LANGUAGE_DIAGNOSIS=1 npm test -- tests/unit/language-diagnosis.test.ts
```

## 2. 聚焦自动化与性能

下列入口扩展现有生产回归；`source-languages.test.ts` 为新增映射测试。

```sh
npm test -- tests/unit/source-languages.test.ts tests/unit/language-detection.test.ts tests/unit/language-detection-coordinator.test.ts tests/integration/acceptance-metrics.test.ts
npm test -- tests/integration/auto-language-support.test.ts tests/integration/us2-cost-privacy.test.ts tests/contract/global-provider-client.test.ts tests/contract/ui-messages.test.ts
npm test -- tests/contract/openai.test.ts tests/contract/ollama.test.ts tests/contract/deepseek.test.ts tests/contract/claude.test.ts tests/contract/provider-output.test.ts tests/unit/session-cache.test.ts tests/integration/overlay-webview-lifecycle.test.ts
npm test -- tests/integration/performance.test.ts --maxWorkers=1 --no-file-parallelism
```

| 检查              | 必须报告的结果                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001            | 留出单语正样本正确可靠率 ≥95%；单语正样本与预标不可可靠判断负样本合计的错误可靠率 ≤1%；负样本可靠率 ≤1%；按语言、长度及现象分别报告正确、未知/不支持、错误可靠的计数和比例，混合主语言及已知回归不进入上述分母 |
| 混合主语言层      | 按独立语义版本核对预标语言/未知，报告正确、未知、错误及语言文字量分层；不得与单语质量门合并 |
| SC-002            | 两个开放许可短轨及七个独立本地回归全部符合预期；同一正文在正确/缺失/错误标签下结果变化为 0，本地回归与标签变体均不增加 SC-001 分母；本地执行见[契约](contracts/local-regressions.md)                                                            |
| SC-003            | 每种未知原因经 controller→Global/Broker→四类实际适配器仍发出目标明确的任务；无 source 拒绝、伪造语言或额外识别请求；使用受控 transport                                                                                                          |
| SC-004 插件部分   | 所有服务模式的提示、响应、progress、缓存及 Overlay 均保留原字符串；未知/同语言不跳过调用，条目与时间轴错配为 0；格式合法改写仍被接收，服务遵从性另做 live                                                                                       |
| SC-005 自动化部分 | 假时钟覆盖内部停止时间前/等于/之后、定时器延迟、同步片段跨越截止时间、同步异常和未完成异步步骤；第 499 ms 不启动新片段，终态只提交一次并自动调度翻译；实际等待超过 500 ms 仍判为失败；所有会话边界至少重复 20 次，双窗口使用不同 Main/Global ID |

性能测试须覆盖最大样本、20,000-cue 预处理、共享脚本、高 trigram 输入及完整可靠判断路径。至少 30 次独立实例测首次检测 p95，预热后至少 1000 次测热态 p95/同步片段 p99；冷实例包含模型初始化，另统计正文就绪到准入释放。预算分别为 100/50/16 ms 和 500 ms。超时/异常注入仅在测试使用，不能为人工验收添加生产故障开关。

## 3. 全量检查与正式包

每次完成代码修改后重新执行，不沿用修改前结果：

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

预期：测试、编译和打包全部成功；包内包含 franc 及正确第三方声明，离线可检测，已移除 franc-min；helper 的双架构、执行权限、签名和 manifest 权限检查通过。产物不含源码、tests/语料、依赖树、密钥或运行状态。不提升版本，不创建 Release。

## 4. 四类服务真实验证

取得用户对实际服务联网及可能费用的明确授权后执行。新增 `tests/integration/live-language-continuation.test.ts` 直接使用四种生产 provider 和冻结同语言 case，复用既有环境变量、授权开关及安全诊断方式：

| 服务              | 所需环境变量                                                    | 选择测试名称                     |
| ----------------- | --------------------------------------------------------------- | -------------------------------- |
| OpenAI-compatible | `SUBTANDEM_OPENAI_ENDPOINT/MODEL/KEY`；无认证 endpoint 可省 Key | `OpenAI language continuation`   |
| Ollama            | `SUBTANDEM_OLLAMA_ENDPOINT/MODEL`                               | `Ollama language continuation`   |
| DeepSeek          | `SUBTANDEM_DEEPSEEK_MODEL/KEY`，endpoint 沿用生产默认值         | `DeepSeek language continuation` |
| Claude-compatible | `SUBTANDEM_CLAUDE_ENDPOINT/MODEL/KEY`                           | `Claude language continuation`   |

变量名以斜线缩写展示，例如 `SUBTANDEM_OPENAI_ENDPOINT/MODEL/KEY` 指三项同前缀变量。值仅在本机环境安全配置，不写入仓库或证据；zsh 可用 `read -rs 'SUBTANDEM_OPENAI_KEY?API key: '; export SUBTANDEM_OPENAI_KEY` 隐藏输入 Key，其余服务使用对应变量名。

```sh
SUBTANDEM_LIVE_PROVIDER_TEST=1 npm test -- tests/integration/live-language-continuation.test.ts -t 'OpenAI language continuation'
SUBTANDEM_LIVE_PROVIDER_TEST=1 npm test -- tests/integration/live-language-continuation.test.ts -t 'Ollama language continuation'
SUBTANDEM_LIVE_DEEPSEEK_TEST=1 npm test -- tests/integration/live-language-continuation.test.ts -t 'DeepSeek language continuation'
SUBTANDEM_LIVE_CLAUDE_TEST=1 npm test -- tests/integration/live-language-continuation.test.ts -t 'Claude language continuation'
```

每种服务先做现有连接 Test，再运行全部冻结 case，记录模型/实际输出模式的非敏感配置标识和 case 计数。所有未知原因映射同一 `null` wire，故原因注入由上一节验证；live 验证真实服务接受 `null`。OpenAI/Ollama 所有封装模式由合同测试覆盖，live 按已选服务实际支持的模式运行并记录。

逐条核对成功响应：所有 `verbatim` 条目与请求正文的布尔相等判断必须 100% 为真；混合条目的 ID、目标变体和相邻上下文归属正确。任何 case 未成功返回也不能算通过。失败只输出 case ID、计数、安全错误类别或不一致计数，避免 Vitest 打印全文差异；不得用通用 `sourceEcho` 或单个词包含判断否定合法原样结果。未运行的服务保持未验收。

## 5. 单人 IINA 正式包验收

按[正式包验收说明](../../docs/engineering/development.md#正式包验收)安装刚打出的包，记录版本、SHA-256、macOS/架构和 IINA 版本。准备一个可播放至少 30 分钟的本地视频，在 IINA 中启用插件并对已配置服务执行 Save→Test→Select；先在 1.4.4 完成以下步骤，再在 1.4.0 重复主流程及卸载检查。

| 操作                                                                                                                          | 预期                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 打开视频，通过 IINA 字幕菜单加载本地输入 `regression-de-11` 和冻结集的 5–6 cue 短轨，选择与正文不同的目标语言并开启 Translate | 识别正确，自动进入翻译，无源语言输入和额外点击                      |
| 保持 Translate 开启，换到 `regression-romaji-29`                                                                              | 源语言显示未知但自动产生译文；视频和原字幕继续播放                  |
| 加载冻结同语言 case 对应字幕，保存相同目标语言；再加载多行/空格/重复正文和混合条目 case                                       | 进入正常运行；原样正文、多行及条目时间正确，混合条目各自处理        |
| 以简体中文字幕选择繁体目标；以含地区差异的葡语 case 选择 `pt-PT`                                                              | 目标变体实际生效，不因基础语言相同被跳过                            |
| 在外挂与已有可支持的内嵌文本轨间切换；另选择空/不可读或图形字幕                                                               | 可读正文遵循同一流程；准备失败无空任务，不阻塞原播放                |
| 翻译期间换轨、换片、seek、保存目标、切换已选 Profile、禁用/重新启用，另开第二个窗口                                           | 结果只属于当前窗口、正文和有效配置，无旧译文回流，无无限检测        |
| 对未知或同语言正文选择已授权但不可达的服务配置，触发一次翻译                                                                  | 显示既有服务错误/重试状态，不恢复语言阻断，原播放不受影响           |
| 连续播放至少 30 分钟，最后关窗、退出、重开并卸载正式包                                                                        | 无本功能造成的播放中断，状态/译文清理，多窗口互不污染，正式包可卸载 |

只记录非敏感样本 ID、耗时、状态和通过/失败。原样逐字符准确率由第 4 节程序验证，人工补充视觉和时间轴；宿主性能按以下步骤测量，不要求用户用肉眼估算毫秒。浏览器控制或 Computer Use 不属于执行方式。

### 5.1 宿主性能测量

计时工具由 T043 交付。工具必须提供以下入口，并输出明确的手动安装、运行、采集与卸载指引：

- `node scripts/measure-language-host.mjs prepare`：核对当前正式包、源码修订和锁文件，准备测试专用 IINA 插件及冻结样本；不自动操作应用界面。
- `node scripts/measure-language-host.mjs summarize`：读取用户提供的安全数值记录，检查样本完整性并计算结果。

单名开发者在 IINA 1.4.4 安装测试插件并启动测量。测试插件直接调用生产检测与协调器模块，覆盖最大样本、20,000-cue 预处理、共享脚本及高 trigram 输入。热态检测至少采样 1000 次，由工具自动执行并在工作片段间让出事件循环。

冷测至少取得 30 个独立宿主 JavaScript 上下文的首次检测结果，并计入模型初始化。工具必须提供可执行的实例创建或重载指引；在同一上下文中反复创建 Coordinator 不算独立冷测。无法取得模型初始化耗时或独立实例证据时，冷测保持未验收。

测试插件只证明生产模块在宿主运行时中的性能。完成后卸载测试插件，使用 T036 的正式包执行本节主流程，并通过 Main/Coordinator 的数值观测记录正文就绪、检测终态及准入释放之间的耗时。正式包计时与 T041 主流程可在同一轮操作中采集，分别记录性能和功能结果。准入等待测量要求正文就绪时翻译已启用，且 Profile 与目标语言有效；配置等待和已取消会话分别标记。

计时观测只包含会话内不透明编号、耗时、终态枚举及超限标志，不包含正文、路径、Profile、endpoint 或凭据；使用现有诊断通道，不新增持久设置，也不改变调度与请求行为。

分别报告冷测 p95、热测 p95、同步片段 p99、正式包准入等待最大值及超限数，对照 100/50/16/500 ms 预算验收。保留全部有效样本，任何准入等待超限均判为失败。证据记录宿主环境、工具版本、样本清单哈希及正式包 SHA-256；Node、测试插件和正式包结果分别列示。

## 验收完成条件

开放许可语料前置任务、七个指定本地回归、聚焦/全量测试、Node 性能、宿主模块性能、正式包准入计时、编译、打包、四类真实服务及单人宿主步骤都必须各有证据；未完成项继续保留为可执行任务。README/多语言说明与实际请求行为同步核对，禁止将自动化通过当作 live 或宿主通过。
