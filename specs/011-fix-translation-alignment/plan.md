# 实现计划：字幕译文内容对齐

**分支**：`011-fix-translation-alignment`  
**日期**：2026-08-19  
**规格**：[spec.md](./spec.md)

## 摘要

把“当前字幕是唯一翻译目标、邻近字幕只用于消歧”的语义集中到所有 Provider 共用的任务构造边界。Controller 从当前既有 120 秒/40 cue 窗口中的真实邻接关系一次生成并冻结目标、前句上下文与后句上下文，重试只筛除已成功目标；Provider 将其编码为明确区分 `text`、`context_previous` 与 `context_next` 的短 ID wire payload，并复用同一系统指令与输出约束。结果继续经过片内结构校验和 ID 恢复，Controller 在缓存前额外整体拒绝重复、未知、空白结果。现有前瞻、批次、重试、缓存、时间轴、覆盖层和生命周期不变。

## 技术上下文

- **语言与版本**：TypeScript 5.9 strict、ES2020；Node.js 24/npm 11 构建。
- **主要依赖**：现有 OpenAI-compatible Chat Completions、Ollama `/api/chat`、Provider transport、`PlaybackController`；不新增运行时依赖。
- **存储**：仅使用现有逐播放会话内存缓存；不新增持久化、跨会话缓存或临时文件。
- **测试**：Vitest 单元、Provider 契约、Controller 集成、安全与性能回归；实际 Provider 验收；正式 `.iinaplgz` 的 IINA 1.4.4 单人验收。
- **目标平台**：macOS 12+、IINA 1.4+；正式宿主验收使用当前 IINA 1.4.4。
- **项目类型**：包含逐窗口 Main、单例 Global、Sidebar 与 native helper 的 IINA 桌面插件；本功能只收紧 Main→Provider 翻译内容契约。
- **性能目标**：保持 120 秒/40 cue 窗口、25 cue/5,000 code points 逻辑批次、2 cue/wire 和单窗口单飞请求；不得增加 Provider 调用次数或播放阻塞。
- **约束**：上下文仍限当前窗口内真实相邻字幕，`context_previous` 与 `context_next` 各至多一条并按前句、后句顺序合计沿用 500 字符上限；字幕数据不进入日志或诊断；生产代码不新增注释且自然语言使用英语。
- **规模与范围**：两类正式 Provider；100 条连续 cue、20 个 wire 拆分边界、20 个真实重叠区间，以及首尾、无上下文、多行、重复文本与指令注入样本。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。实际模型语义与宿主连续播放保留为实施阶段验收门，不能由 mock 推断通过。*

| 原则 | 阶段 0 | 阶段 1 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 自动化直接覆盖生产请求构造、Provider 与 Controller；实际 Provider 和正式包验收验证模型内容、视频与原字幕连续性。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 共用任务指令、标识符和错误使用英语，不新增生产代码注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 不扩大前瞻、上下文数量、请求次数、日志、诊断或保留期；重试复用冻结上下文，不重新采集数据。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 不新增依赖、权限或包内数据；沿用完整构建、包审计和正式包验收。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 只统一当前两类 Provider 的翻译任务并补强当前结果入口，不建立通用语义审查器或服务专用兼容路径。 |
| 完整 SDD 与中文精简上下文 | 通过 | 通过 | 变更影响外部 Provider 契约和安全边界，使用完整 SDD；研究、模型、契约和验证各自单一职责。 |
| 控制人工验收成本 | 通过 | 通过 | 可确定行为自动化；不可由 fake 证明的实际模型与 IINA 行为由一名开发者完成。 |

## 架构与数据流

```text
当前既有 cue 窗口 + 当前逻辑批次目标
  -> 按源 cue 顺序生成并冻结 {id, text, contextPrevious?, contextNext?}
  -> 每次重试只筛选未解决目标
  -> 短 wire ID + {text, context_previous?, context_next?}
  -> 共用翻译任务指令 + Provider 专用传输格式
  -> 片内 schema/ID/空白校验
  -> 恢复原 cue ID
  -> Controller 整体重复校验 + 会话身份校验
  -> 现有缓存与 [startMs, endMs) 覆盖层显示
```

- `PlaybackController` 继续拥有窗口、逻辑批次、重试、会话指纹、缓存和显示；它在首次 attempt 前冻结目标，后续 attempt 不重建邻接关系。
- 请求构造只从当前已选窗口查找目标的真实前后邻居；前邻居映射为 `context_previous`，后邻居映射为 `context_next`。邻居可属于另一逻辑批次或 wire part，但没有输出资格。
- Provider 公共层拥有短 ID、共用任务指令、wire payload 与输出 schema；OpenAI-compatible 和 Ollama 只保留协议、能力和响应封装差异。
- Provider 校验阻止片外、重复、空白和不可解析结果；Controller 对每个增量或终态再次按当前未解决集合整体计数，重复 ID 的所有候选均不进入缓存。
- 不按字符串猜测译文是否含原文、罗马化或解释；这会误伤合法专名、数字和源语言片段。语义服从由共用任务约束与实际 Provider 验收共同证明。

## 项目结构

### 本功能文档

```text
specs/011-fix-translation-alignment/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── provider-translation-task.md
└── checklists/
    └── requirements.md
```

### 源码与验证

```text
src/
├── app/
│   ├── controller.ts
│   └── request-builder.ts
└── providers/
    ├── types.ts
    ├── wire-items.ts
    ├── translation-task.ts
    ├── openai.ts
    ├── ollama.ts
    └── validation.ts

tests/
├── unit/
│   └── request-builder.test.ts
├── contract/
│   ├── provider-output.test.ts
│   ├── openai.test.ts
│   └── ollama.test.ts
├── integration/
│   ├── translation-alignment.test.ts
│   ├── live-providers.test.ts
│   ├── progressive-translation.test.ts
│   ├── us1-playback.test.ts
│   ├── overlay-lifecycle.test.ts
│   ├── performance.test.ts
│   └── us2-cost-privacy.test.ts
└── security/
    ├── credential-leakage.test.ts
    └── redaction.test.ts
```

**结构决策**：保持 Controller→Provider→transport 的现有分层。`request-builder.ts` 负责从当前窗口冻结产品级目标；`wire-items.ts` 继续负责短 ID 与恢复；新增职责单一的 `translation-task.ts` 集中两类 Provider 必须共享的 wire 字段、系统指令和 user payload，避免语义再次漂移。Global、消息、调度、缓存、覆盖层和 native helper 不改。

## 设计产物

- [research.md](./research.md)：共用任务、稳定上下文、结果拒绝和验证边界的技术决策。
- [data-model.md](./data-model.md)：冻结目标、消歧上下文、wire 目标与结果状态流。
- [contracts/provider-translation-task.md](./contracts/provider-translation-task.md)：所有正式 Provider 必须遵守的输入、输出、拆分、安全和失败契约。
- [quickstart.md](./quickstart.md)：聚焦自动化、实际 Provider、完整质量门和 IINA 正式包验收。

## 复杂度跟踪

无宪法例外。新增共用任务构造模块是消除两类 Provider 语义漂移所需的最小共享边界；不新增运行组件、依赖、权限或持久状态。
