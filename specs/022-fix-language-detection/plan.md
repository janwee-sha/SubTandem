# 实施计划：字幕语言检测修复与不中断翻译

**Git 分支**：`fix/language-detection` | **功能标识**：`022-fix-language-detection` | **日期**：2026-09-10

**规格**：[spec.md](spec.md) | **轨道**：完整 SDD | **状态**：阶段 0 与阶段 1 规划完成

## 摘要

使用标准 `franc` 替换 `franc-min`，以有界、去重的正文证据判断主要语言，取消固定 cue 数和固定匹配窗口数的否决门禁。可靠源语言和未确定源语言均可进入当前服务的翻译流程；全部任务要求逐条遵循目标语言及显式变体，已符合时原样返回正文。

本功能覆盖 Main 检测生命周期和翻译准入、Main↔Global 请求语义、四类 provider 提示、结果保留及 Sidebar 状态。字幕准备、逐条身份、时间轴、有限前瞻、重试、凭据、会话清理和目标偏好保存沿用既有边界。

## 技术上下文

| 项目       | 决定                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 语言与构建 | TypeScript 5.9.3、ES2020、Parcel 2.16.4；Node.js 24、npm 11                                                |
| 检测依赖   | 标准 `franc@6.2.0`；锁定依赖，静态打包并更新第三方声明                                                     |
| 运行平台   | macOS 12+、IINA 1.4.0+；Main/Global JavaScript 与 Sidebar/Overlay WebView                                  |
| 服务       | OpenAI-compatible、Ollama、DeepSeek、Claude-compatible；沿用 transport 与 wire 能力模式                    |
| 源语言范围 | 固定 119 个模型代码 → 113 个源语言身份，详见 [研究映射](research.md#2-固定源语言映射)；目标目录保持 156 项 |
| 存储       | 检测结果及译文仅保留在当前会话；无新增 preferences、持久缓存、endpoint 或 native RPC                       |
| 测试       | Vitest 3.2.7；直接调用生产检测、协调器、controller、provider、消息、缓存和显示适配器                       |
| 性能       | 正文就绪后检测等待 ≤500 ms；首次 p95 ≤100 ms、热检测 p95 ≤50 ms、同步片段 p99 ≤16 ms                       |
| 测量基线   | Apple M5 Pro / 24 GB，macOS 26.6.2，Node.js 24.18.0、npm 11.16.0；IINA 1.4.4，另保留 1.4.0 正式包冒烟      |
| 语料       | 逐条采集、许可/真值核验和清单冻结为实施首个前置任务；完成后才能校准及验收，全部数量、分层及质量门保留      |

## 宪法检查

依据 [项目宪法](../../docs/engineering/constitution.md) 4.3.0 和 [Agent 工作协议](../../AGENTS.md)。

| 门禁             | 研究前     | 设计后 | 设计依据                                                                                                                                                                         |
| ---------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 验证与产品安全   | 通过       | 通过   | [检测契约](contracts/language-detection.md)区分内部停止时间与准入等待上限；[验证指南](quickstart.md#51-宿主性能测量)区分 Node、宿主模块与正式包计时证据，由 T043/T044 交付和验证 |
| 生产代码约束     | 通过       | 通过   | 生产变更使用英语且不添加注释；移除被替代路径、同语言门禁和失效状态                                                                                                               |
| 隐私与副作用     | 通过       | 通过   | [翻译契约](contracts/translation-task.md)保留选择/凭据/正文边界，更新用户外发披露；检测样本留在 Main                                                                             |
| 可重建发布       | 通过       | 通过   | 正式包离线包含 franc 及许可；依赖锁、编译、helper 和归档审计全部进入验证流程                                                                                                     |
| 版本化与规格隔离 | 有条件通过 | 通过   | [数据模型](data-model.md)规定受版本管理的语料及许可；依据规格澄清，将采集/冻结设为实施首个前置任务，禁止私人路径依赖                                                             |
| 宿主一致性       | 通过       | 通过   | 以 IINA 1.4.4 当前 Sidebar/Overlay 为参照，复用组件；仅状态语义和正文保留按本规格变化，布局/样式/控件行为无偏离                                                                  |
| 交付与人工成本   | 通过       | 通过   | 单名开发者执行明确步骤；本次止于规划，实施需后续明确指示                                                                                                                         |

**结论**：规划门禁及截止时间、宿主性能验证方案的一致性复审通过，无宪法例外。调度余量、计时工具、语料、产品测试、真实服务及宿主行为仍须分别取得实施验证证据；设计通过不代表产品验收通过。

## 设计产物与实施顺序

- [research.md](research.md)：依赖、固定源语言映射、技术选择及语料来源池。
- [data-model.md](data-model.md)：检测/请求/缓存身份及语料冻结记录。
- [contracts/language-detection.md](contracts/language-detection.md)：采样、可靠性、deadline、生命周期及准入。
- [contracts/translation-task.md](contracts/translation-task.md)：跨运行时未知源语言、四类服务及逐字符结果。
- [quickstart.md](quickstart.md)：可执行测试、性能、live 与单人正式包验收。

实施依赖见 [tasks.md](tasks.md#依赖与执行顺序)：语料前置任务 → 校准与检测实现 → 统一请求/结果契约和准入集成 → 宿主计时工具 → 自动化/编译/打包 → 真实服务及宿主验收。允许在契约固定后对不共享文件的服务和检测切片并行实现，但公共类型及 Main/controller 必须串行集成。

## 工程结构与负责人边界

本功能延续现有单仓库结构。决策与依据见 [research.md](research.md)。

| 切片           | 负责路径                                                                                                                                                                                                                                                   | 依赖与集成顺序                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 语料与检测     | `tests/fixtures/languages/`、`src/subtitles/language-detection.ts`、拟新增 `src/domain/source-languages.ts`、对应检测及指标测试                                                                                                                            | 先固定许可/真值/分组清单，再校准，最后评估冻结集                                                                                                         |
| 生命周期与准入 | `src/app/language-detection.ts`、`src/app/controller.ts`、`src/main.ts`、`src/domain/language.ts`、`src/domain/status.ts`、`ui/sidebar.ts`                                                                                                                 | 依赖源语言和请求契约；controller/Main 串行集成                                                                                                           |
| 请求与结果     | `src/providers/{types,translation-task,openai,ollama,deepseek,claude,validation}.ts`、`src/app/{request-builder,session-cache}.ts`、`src/adapters/iina/{global-provider-client,webview-translation-overlay}.ts`、`src/global.ts`、`src/domain/messages.ts` | 先统一未知源语言字段及边界校验，再调整服务，最后贯通正文保留；Broker 授权逻辑通过回归验证                                                                |
| 目录与交付     | `src/domain/target-languages.ts`、`package.json`、`package-lock.json`、`THIRD_PARTY_NOTICES.txt`、`README.md`、`docs/readme/`、`docs/engineering/development.md`                                                                                           | 移除检测与目标目录的隐式耦合；更新与本功能相关的说明                                                                                                     |
| 集成验证       | `tests/contract/`、`tests/integration/`、`tests/security/`、`tests/unit/` 的受影响用例                                                                                                                                                                     | 生产切片完成后执行；正式包与实机证据不可由 mock 替代                                                                                                     |
| 宿主性能验证   | 拟新增 `tests/host/language-performance/`、`scripts/measure-language-host.mjs`、`tests/contract/language-host-performance.test.ts`，以及 Main/Coordinator 的数值计时观测                                                                                   | 测试专用 IINA 插件直接运行当前生产检测与协调器模块，完成重复采样；正式包另行测量真实正文就绪到准入释放的路径。工具和语料不进入正式包，具体步骤见验证指南 |

委派实现切片时必须使用隔离 worktree，明确契约、允许修改的文件、验证命令和完成条件；公共 types、controller、Main、lockfile 同时只能有一名负责人。具体分工与集成顺序见 [tasks.md](tasks.md)。

## 复杂度与验收风险

当前技术方案无需新增服务、线程运行时或 native helper。置信阈值应由独立校准集确定，不能把 franc 第一名或归一化分数当作概率，也不能降低验收指标解决误判。

样本许可/真值、400 轨冻结集和两个开放许可短轨由首个前置任务证明；七个 FFmpeg 指定回归按[本地回归契约](contracts/local-regressions.md)独立验收，不阻塞 T001 的入库门，但缺失或失败仍阻止 SC-002 验收。franc 覆盖不保证短轨可靠，阈值必须实际满足 SC-001/002；模型可能改写合法同语言正文，SC-004 需四类真实服务证明。事件循环及宿主时序必须实际测量，不能凭定时器或 Node 微基准宣称满足 SC-005。

实施范围、依赖及验收工作以 [tasks.md](tasks.md) 为准；进入实施仍须获得用户明确指示。
