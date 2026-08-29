# 实现计划：添加 DeepSeek 翻译服务

**分支**：`019-add-deepseek-provider` | **日期**：2026-08-29 | **规格**：[spec.md](./spec.md)

## 摘要

新增内部类型 `deepseek` 与独立 `DeepSeekProvider`，把 DeepSeek Profile 接入现有 Sidebar、Global、凭据、模型目录、Test、Select、Broker 和翻译会话。Provider 固定请求 `{API Root}/chat/completions`，只发送 `response_format: {"type":"json_object"}`、`thinking: {"type":"disabled"}` 与 `temperature: 0`，不执行 OpenAI 的 JSON Schema 能力探测；提示明确 JSON 目标结构，响应按完整对象和精确 wire ID 集合一次性校验。模型刷新复用现有受限 helper、只写凭据与 latest-only 上下文，向 `{API Root}/models` 获取全部有效 Model ID。既有 OpenAI 与 Ollama 数据和行为保持不变，并同步当前用户披露、自动化回归、正式构建和打包验收。

## 技术上下文

- **语言与版本**：Node.js 24、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、Swift 6.0、HTML/CSS、JSON。
- **主要依赖**：IINA Plugin API、Parcel 2.16.4、Vitest 3.2.7、现有 Swift transport helper 与系统 libcurl；不新增依赖。
- **存储**：DeepSeek Profile metadata 与既有 Profile 一同保存在 IINA preferences；API Key 继续由 helper 保存到插件私有 `credentials.json`；模型目录、请求 owner、provider cache 与译文只保留在现有运行期或会话边界，不新增迁移或持久化数据。
- **测试**：Vitest 单元、契约、集成与安全测试；Swift transport 回归；TypeScript 类型检查、lint、正式构建、包审计与打包；开发者一人完成 IINA 1.4.4 正式包及显式授权的 DeepSeek live test。
- **目标平台**：macOS 12+，arm64 与 x86_64，IINA 1.4+；正式宿主验收使用 IINA 1.4.4。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：不改变每个 Chat Completions wire 最多 2 个目标、现有调度和播放非阻塞行为；正常服务条件下 3 分钟内完成 Profile 全流程，连续至少 20 个 DeepSeek wire 不因输出模式或默认 thinking 失败。
- **约束**：固定 Service type 顺序为 OpenAI、DeepSeek、Ollama；默认 API Root 为 `https://api.deepseek.com`，但不得预置 Model ID；Chat Completions 只用 JSON object 且关闭 thinking；每个 wire 必须全量校验后才能提交；凭据、字幕、译文和原始响应不得进入禁止位置；生产代码不新增注释且自然语言使用英语。
- **规模与范围**：第三种 Service type、一个专用 Provider、现有模型目录与跨运行时消息枚举扩展、Sidebar 第三份草稿、当前用户文档和聚焦回归；不新增 API 路径、权限、native RPC、模型推荐或持久化目录。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 契约测试直接执行 DeepSeek 请求与解析；集成、安全、native、正式构建和包审计覆盖跨运行时、凭据、竞态与发布边界；IINA 与 live 场景保留单人验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 修改的 TS、HTML 与 CSS 不新增注释；标识符、错误码和 UI 文案使用英语，中文仅用于 SDD 与默认中文项目文档。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | DeepSeek 请求继续经过 loopback helper；只在当前 Profile/revision/窗口授权下发送最小字幕。默认 DeepSeek API Root 会形成新网络目的地，因此同步更新 `Info.json`、README、安全契约与回归。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | 不新增依赖、权限或 native 文件；使用锁文件和现有脚本重建 helper 与插件，执行包白名单、架构、签名和敏感材料审计。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | 只新增当前需要的 DeepSeek 类型、固定请求和严格校验；不增加 Responses/Anthropic 路径、thinking UI、模型预置或未来 Provider 框架。 |
| VI. 版本化管理 | 通过 | 通过 | 产物只引用仓库内受版本管理的代码、文档和 019 SDD，以及规格已列明的公开官方契约；不引用本地私密配置。 |
| VII. 规格边界隔离 | 通过 | 通过 | 只修改 `specs/019-add-deepseek-provider/` 的 SDD；既有规格仅作为当前契约依据读取，不回写其产物。 |
| 工作协议 | 通过 | 通过 | 该变更新增用户故事、默认网络目的地并跨 Global/Main/Sidebar，采用完整 SDD；规划停在 Phase 1，实施前仍需用户明确指示；共享热点文件在实施阶段串行负责。 |

## 项目结构

### 本功能文档

```text
specs/019-add-deepseek-provider/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── deepseek-chat-completions.md
│   ├── deepseek-profile-and-models.md
│   └── deepseek-sidebar.md
└── tasks.md
```

`tasks.md` 由后续 `$speckit-tasks` 生成，本阶段不创建。

### 实现与测试

```text
src/
├── app/controller.ts
├── domain/
│   ├── messages.ts
│   └── types.ts
├── providers/
│   ├── deepseek.ts
│   ├── errors.ts
│   ├── model-discovery.ts
│   ├── openai.ts
│   ├── profiles.ts
│   ├── translation-task.ts
│   ├── types.ts
│   └── validation.ts
├── adapters/iina/model-catalog-sync.ts
├── global.ts
└── main.ts
ui/
├── provider-status.ts
├── sidebar-state.ts
├── sidebar.ts
└── sidebar.html
tests/
├── contract/
│   ├── deepseek.test.ts
│   ├── provider-model-discovery.test.ts
│   ├── provider-output.test.ts
│   ├── provider-profiles.test.ts
│   ├── sidebar-form.test.ts
│   ├── sidebar-lifecycle.test.ts
│   └── ui-messages.test.ts
├── integration/
│   ├── live-providers.test.ts
│   ├── provider-connection-lifecycle.test.ts
│   └── us3-providers.test.ts
└── security/
    ├── credential-leakage.test.ts
    └── redaction.test.ts
Info.json
README.md
docs/
├── engineering/development.md
└── readme/
    ├── README.zh-CN.md
    ├── README.fr.md
    ├── README.ja.md
    ├── README.ko.md
    ├── README.ru.md
    └── README.ar.md
```

**结构决策**：Global 继续是 Profile metadata、凭据读取、Provider 构造、模型目录和外部请求的唯一权威边界；Main 的消息转发与 `ModelCatalogSync` 保持 provider 无关，只扩展严格 kind 联合类型；Sidebar 按 Service type 保存隔离草稿并呈现固定顺序和默认值。新增公开 `DeepSeekProvider`，通过当前两种方言共用的 Chat Completions 内核复用批次、取消和解析框架，但固定绕过 OpenAI 的探测/降级状态机并使用 DeepSeek 严格校验。Main 把安全 kind 传入 Controller，使 DeepSeek 内容不进入 Log Viewer。native helper 已是通用受限 HTTP transport，无需修改协议或 Swift 生产代码。

## 设计阶段

1. [research.md](./research.md) 固化专用 Provider、DeepSeek 官方协议、严格输出、Profile/模型目录、凭据、竞态、文档与验证决策。
2. [data-model.md](./data-model.md) 定义 DeepSeek Profile、凭据、模型目录、请求、响应和 Sidebar 草稿的字段与状态转换。
3. [deepseek-chat-completions.md](./contracts/deepseek-chat-completions.md)、[deepseek-profile-and-models.md](./contracts/deepseek-profile-and-models.md) 与 [deepseek-sidebar.md](./contracts/deepseek-sidebar.md) 约束外部 HTTP、跨运行时 Profile/目录和用户界面行为。
4. [quickstart.md](./quickstart.md) 定义聚焦自动化、完整门禁、候选包检查以及开发者一人完成的 DeepSeek 与 IINA 验收。

## 复杂度跟踪

无宪法例外。独立公开 Provider 与显式方言策略既避免错误能力探测和隔离既有 OpenAI 行为，也避免复制整套 Chat Completions 批次/取消代码；通用 transport、任务构造、wire 编码、Profile 生命周期、模型目录与安全设施全部复用。
