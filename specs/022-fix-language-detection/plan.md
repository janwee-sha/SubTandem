# 实施计划：修复字幕正文语言检测

**功能标识**：`022-fix-language-detection` | **Git 分支**：`fix/language-detection` | **日期**：2026-09-08

**规格**：[spec.md](spec.md) | **交付轨道**：完整 SDD

## 概要

取消固定 cue 数、最低文字量、候选分差及窗口一致性对受支持正文候选的拒绝。采用 `franc-all@7.2.0` 离线模型与固定的 67 种源语言映射；完整模型额外提供范围外语言证据，不扩展可翻译源语言。混合正文按局部语言归属累计有效文字量，在范围内候选中选占比最高者，范围外占优不触发拒绝；仅在没有范围内候选且正文可确认仅属范围外时返回 `unsupported`。现有 `reliable` 表示已选定正文候选，允许低置信度结果进入既有翻译门控。

先取得并冻结有许可、人工核对真值的自然字幕，再校准与实现检测策略。生产检测采用可分片的同一计算核心，覆盖正文准备、分类和聚合；协调器在实际工作之间检查身份及期限。设计依据见 [research.md](research.md)，精确语义见 [检测契约](contracts/language-detection.md)。

## 技术上下文

| 项目 | 选择与约束 |
| --- | --- |
| 语言与工具链 | TypeScript 5.9.3、ES2020；Node.js 24、npm 11 用于开发；既有 Swift 6 helper |
| 主要依赖 | `franc-all@7.2.0` 替换 `franc-min@6.2.0`；沿用 Parcel 2.16.4、Vitest 3.2.7；依赖及传递依赖写入锁文件 |
| 运行平台 | macOS 12+、IINA 1.4.0+ 的 Main JavaScript 运行时；不新增 native 服务、Web Worker 或网络识别 |
| 存储 | 检测正文、候选证据和结果仅存当前窗口会话内存；自然测试语料、许可与真值纳入版本管理 |
| 测试 | Vitest 直接调用生产解析、检测、协调器和翻译门控；正式 helper 的字幕提取集成；开发者单人正式包验收 |
| 性能 | 正文准备完成后首次 p95 ≤100 ms、重复 p95 ≤50 ms、实际同步分片 p99 ≤16 ms；总期限 500 ms |
| 规模 | 67 种基础源语言及中文形式；覆盖既有 20,000 cue 输入上限；有界模型输入与全轨位置覆盖 |
| 产品边界 | 使用附录 A 源范围与既有语言等价规则；无手动源语言、逐 cue 翻译、目标目录扩容或新 UI |

## 宪法检查

依据[项目宪法](../../docs/engineering/constitution.md) 5.0.0 与 [AGENTS.md](../../AGENTS.md)。研究前与设计后均通过规划门禁；下列实施验证是交付条件，不表示产品已经通过验收。

| 门禁 | 设计约束与后续验收 |
| --- | --- |
| I：验证与产品安全 | 自然语料四类指标、实际分片性能、零调用状态、迟到结果和正式宿主验证；失败不得降低规格门槛 |
| II、V：生产代码规范与当前范围 | 只实现本规格；生产代码不新增注释，使用英语；移除被替代的门禁和 `franc-min` 路径 |
| III：敏感数据与副作用 | 离线检测；候选只影响已明确选择的 Profile revision；不增加网络目的地、重试或凭据流；保留 Log Viewer 正文调试并允许宿主日志持久化，禁止作为翻译缓存复用 |
| IV：可重建发布 | 更新锁文件与第三方声明；模型随包离线运行，语料不入包；重新测试、编译、打包并审计 |
| VI、VII：版本管理与规格隔离 | 只改本规格及下列负责文件；不用私有媒体作依赖，不改 007 或其他规格产物 |
| VIII：宿主一致性 | 沿用当前 Sidebar 的语言状态区域、固定英文文案及控件；本切片不修改可见组件，宿主验收确认状态正确 |
| 工作协议 | 中文精简产物；语料核对及宿主操作由开发者单人完成；实机提供手动步骤；实施需明确指示 |

无宪法例外。需求检查清单 [requirements.md](checklists/requirements.md) 已全部通过；本阶段无待用户澄清项。

## 项目结构与文件责任

```text
specs/022-fix-language-detection/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── language-detection.md
│   └── corpus-evaluation.md
└── checklists/requirements.md

src/
├── domain/source-languages.ts          （新增：固定源语言映射）
├── domain/target-languages.ts          （移出仅供检测使用的元数据与反向查询）
├── subtitles/language-model.ts         （锁定模型的等价倒排查询，无正文跨会话缓存）
├── subtitles/language-detection.ts     （正文采样、候选、聚合与分片核心）
├── app/language-detection.ts           （实际分片调度与 attempt 失效）
├── app/controller.ts                  （候选到翻译资格的集成）
├── main.ts                            （统一正文入口与生命周期提交）
└── entry.ts                           （宿主启动门控，构建入口不导出模块）

tests/
├── fixtures/languages/                （自然字幕、来源、真值与冻结清单）
├── fixtures/media/                    （必要的有许可最小格式派生样本）
├── helpers/language-corpus.ts         （新增：加载、统计与结果汇总）
├── unit/language-corpus.test.ts       （新增：准入、来源隔离与统计分母回归）
├── unit/language-detection.test.ts
├── unit/language-detection-coordinator.test.ts
├── integration/acceptance-metrics.test.ts
├── integration/main-language-detection.test.ts
├── integration/auto-language-support.test.ts
├── integration/embedded-subtitle.test.ts
├── integration/performance.test.ts
└── security/language-detection.test.ts （新增：正文与失效边界）

scripts/language-detection-validation.mjs （新增：受控 Provider 与宿主指标汇总）
scripts/freeze-language-detection.ts     （校准证据核验及配置冻结）
scripts/language-corpus-audit.ts          （新增：只读草稿核验与待核对项汇总）
scripts/build-language-media.mjs         （最小格式、标签媒体及压力媒体重建）
```

共享交付文件限于 `package.json`、`package-lock.json`、`THIRD_PARTY_NOTICES.txt`，以及 README 与 `docs/readme/` 中直接相关的语言说明。移出目标目录的检测元数据时同步更新 `tests/unit/target-languages.test.ts`；目标语言 ID、显示名、排序、等价规则及保存契约保持有效。`src/domain/language.ts` 继续提供语言等价实现。必要的验证证据放在拟新增的 `docs/validation/language-detection.md`，只记录安全统计与环境。

## 阶段 0：研究与决策

研究已完成，决策、替代方案和来源见 [research.md](research.md)。技术未知项已转化为明确设计及实施验收条件；自然语料须先完成准入与冻结，再进行数值校准，不将模型选择等同于准确率证明。

## 阶段 1：设计与契约

- [data-model.md](data-model.md)：正文权重、候选、会话身份和语料实体。
- [检测契约](contracts/language-detection.md)：固定语言范围、采样、候选接受、范围外确认、期限和翻译状态。
- [语料与评估契约](contracts/corpus-evaluation.md)：独立来源、人工真值、冻结顺序及统计分母。
- [quickstart.md](quickstart.md)：后续可执行检查、正式包手动验证与证据要求。

设计后复查：符合全部宪法门禁；未新增消息字段、权限或持久化数据。007 的生命周期、等价与性能契约继续适用，检测接受条件和指标以本目录为准。

## 实施依赖与交付条件

1. 取得合法自然语料、人工核对真值、分配来源组并冻结两集合；覆盖不足时先补语料，不开始调参。
2. 建立生产检测评估入口；只用校准集选择契约内参数，再冻结配置。实现固定映射、正文证据和真正分片；删除模板扩充的语言准确率验收路径，其余无关验收保持职责独立。
3. 集成候选与翻译门控，完成入口、生命周期及隐私回归；交付本地受控服务、最小媒体和宿主安全计时入口；完善用户说明，明确候选可能错误、检测离线和仅向已选服务发送附近正文。
4. 执行冻结验收，按规格逐项报告；随后完成全套测试、编译、正式打包及开发者实机验收。失败保留为未验收工作，不能修改真值、排除样本或增加拒绝门槛来达标。

具体实施顺序与验收状态见 [tasks.md](tasks.md)。若并行实施，语料、检测核心和集成须使用隔离工作区；检测契约先冻结，`main.ts`、依赖文件和最终集成同一时间只有一个负责人。

## 主要风险

- 完整模型增加包体与首次加载成本；必须用锁定版本及真实 IINA 环境测量，未达性能门禁不得交付。
- 局部语言分类与长轨抽样都可能误估混合占比；跨采样上限、成团、交错、近似并列及分段变体必须直接验收。
- 两集合已完成许可、人工核对与冻结；模型覆盖和混合局部归属尚须满足全部校准门禁，当前缺口见[验证报告](../../docs/validation/language-detection.md)。
- 20 种语言的真值核对依赖可追溯的正文参考；开发者无法核实的片段保持未准入，不以标签或检测输出代替真值。
