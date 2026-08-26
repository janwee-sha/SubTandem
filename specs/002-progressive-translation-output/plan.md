# 实现计划：渐进式字幕翻译输出

**分支**：`main`  
**日期**：2026-08-12  
**规格**：[spec.md](./spec.md)

## 摘要

在现有单次 provider attempt 边界上增加逐 wire 请求的同步增量通知。OpenAI-compatible 与 Ollama 每验证完最多 2 个 cue 就恢复原始 cue ID 并上报；Global 以权威 player/request 身份转发；Main 立即缓存、缩减未解决集合并请求发布完整快照。每个播放器使用单飞发布协调器串行替换 IINA 第二字幕轨，只合并保留最新待发布快照。最终 attempt 仍返回完整聚合结果，不产生进度的 provider 保持兼容。

## 技术上下文

- **语言与版本**：TypeScript 5.9 strict、ES2020；Node.js 24/npm 11 构建。
- **主要依赖**：IINA 1.4+ Plugin API、现有 provider transport 与字幕轨适配器；不新增运行时依赖。
- **存储**：只使用现有 `PlaybackSession` 内存缓存和 `@tmp/` 生成字幕；不新增持久化。
- **测试**：Vitest 单元、provider/消息契约和 controller/字幕轨集成测试；IINA 1.4+ 正式安装包人工验收。
- **目标平台**：macOS 12+、IINA 1.4+。
- **项目类型**：IINA 插件，包含每窗口 Main、单例 Global 与 Sidebar；本功能不修改 native helper 协议。
- **性能目标**：25 cue 拆成 13 个 wire 请求时首个有效响应即可推动缓存与发布；单窗口最大并发字幕替换数为 1。
- **约束**：保持 120 秒/40 cue 前瞻、25 cue/5,000 字符逻辑批次、2 cue/wire 和最多 3 次额外重试；不新增日志中的字幕或秘密数据；生产代码不新增注释。
- **规模与范围**：两类 provider、每播放器一个活动逻辑批次、多个播放器互相隔离。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。*

| 原则 | 结果 | 本功能落实方式 |
| --- | --- | --- |
| 验证与产品安全 | 通过 | 行为变更先增加 provider、消息、controller 与轨道并发回归；保留正式包实机验收任务。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 新增标识符和可执行文本使用英语，不添加生产代码注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 只重试未解决 cue；进度不含凭据、头、原始响应，不扩大请求和保留边界。 |
| 可重建且最小的发布产物 | 通过 | 不新增包内数据；运行完整构建与 `verify:package`。 |
| 完整 SDD 轨道 | 通过 | 变更跨 Main、Global、provider 与 IINA 轨道边界，使用独立 `002` 规格、设计、任务、分析和验证。 |
| 当前意图与中文精简上下文 | 通过 | `002` 只描述目标状态；`001` 只改写被取代的契约并引用本规格。 |

## 项目结构

### 本功能文档

```text
specs/002-progressive-translation-output/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── progress-messages.md
│   ├── publication.md
│   └── translation-provider.md
├── checklists/requirements.md
└── tasks.md
```

### 源码与测试

```text
src/
├── adapters/iina/global-provider-client.ts
├── app/controller.ts
├── domain/messages.ts
├── providers/
│   ├── broker.ts
│   ├── ollama.ts
│   ├── openai.ts
│   ├── provider.ts
│   └── types.ts
├── global.ts
└── main.ts

tests/
├── contract/
│   ├── global-provider-client.test.ts
│   ├── global-rpc.test.ts
│   ├── ollama.test.ts
│   ├── openai.test.ts
│   └── ui-messages.test.ts
├── integration/
│   ├── progressive-translation.test.ts
│   └── subtitle-track.test.ts
└── helpers/fake-provider.ts
```

**结构决策**：沿用现有 provider→Global→Main→controller→track 分层。provider 只产生经验证增量和完整终态；Global 只做权威路由；controller 独占会话接受、缓存、重试与发布策略；轨道适配器继续执行单次原子替换。

## 设计阶段

1. 在 [research.md](./research.md) 固化进度边界、去重/重试、单飞发布和生命周期决策。
2. 在 [data-model.md](./data-model.md) 定义增量、活动 attempt、未解决集合与发布状态转换。
3. 以 [contracts/](./contracts/) 约束 provider 回调、Global→Main 消息和发布协调器。
4. 以 [quickstart.md](./quickstart.md) 定义合成 25 cue 自动验证与通用外挂字幕实机验证。

## 复杂度跟踪

无宪法例外或新增系统组件。单飞发布状态是避免 IINA 轨道替换并发所需的最小窗口内协调状态。
