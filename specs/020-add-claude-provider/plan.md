# 实现计划：添加 Claude 翻译服务

**分支**：`020-add-claude-provider` | **日期**：2026-08-29 | **规格**：[spec.md](./spec.md)

## 摘要

新增独立 `claude` Service type 与 `ClaudeProvider`，把 Claude Profile 接入现有 Sidebar、Global、凭据、模型目录、Test、Select、Broker 和播放会话。Provider 使用非流式 Messages 契约，不发送采样参数、服务端 Schema 或工具字段；顶层 system 约束唯一 JSON 输出，响应按拒绝信号、`end_turn`、文本块拼接和精确 wire ID 集合一次性校验。模型刷新使用 `/v1/models`，接受 Anthropic 游标分页与 Ollama-compatible `object: "list"` 单页终态，并由逐页 owner guard 保护；失败保留现有目录与 Custom Model ID。既有 OpenAI、DeepSeek 与 Ollama Profile 行为不变，并同步用户披露、自动化回归、正式构建和打包验收。

## 技术上下文

- **语言与版本**：Node.js 24、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、Swift 6.0、HTML/CSS、JSON。
- **主要依赖**：IINA Plugin API、Parcel 2.16.4、Vitest 3.2.7、现有 Swift transport helper 与系统 libcurl；不新增依赖。
- **存储**：Claude Profile metadata 与现有 Profile 一同保存在 IINA preferences；API Key 继续由 helper 保存到插件私有 `credentials.json`；模型目录、分页 owner、provider cache、字幕与译文仅保留在现有运行期或会话边界，不新增迁移或持久化数据。
- **测试**：Vitest 单元、契约、集成与安全测试；Swift transport 回归；TypeScript 类型检查、lint、正式 native/plugin 构建、包审计与打包；一名开发者完成 IINA 1.4.4 正式包及明确授权的 Claude-compatible live test。
- **目标平台**：macOS 12+，arm64 与 x86_64，IINA 1.4+；正式宿主验收使用 IINA 1.4.4。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：不改变每批最多 25 cues/5000 code points、每个远端 wire 最多 2 个目标和播放非阻塞行为；正常服务条件下 3 分钟内完成 Profile 全流程，连续至少 20 个 Claude wire 不因 Messages 格式或 Schema 依赖失败。
- **约束**：固定 Service type 顺序为 OpenAI、Claude、DeepSeek、Ollama；默认 API Root 为 `https://api.anthropic.com` 且 API Key 必填，不预置 Model ID；请求不发送采样参数、Schema、tools 或 thinking；只接受无拒绝信号的 `end_turn` 完整 JSON；凭据、Provider 原始响应和 Claude 字幕内容不得进入禁止位置；生产代码不新增注释且自然语言使用英语。
- **规模与范围**：第四种 Service type、一个专用 Messages Provider、共享 Claude URL 构造、Anthropic 分页与 Ollama-compatible 单页模型目录、owner guard、跨运行时 kind 枚举、Sidebar 第四份草稿、当前用户文档和聚焦回归；不新增 native RPC、依赖、权限、模型推荐或持久化目录。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 契约测试直接执行 Messages 请求、响应和分页；集成、安全、native、正式构建与包审计覆盖凭据、竞态、跨运行时和交付边界；IINA/live 场景保留单人验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 修改的 TS、HTML 与 CSS 不新增注释；标识符、错误码与 UI 文案使用英语，中文仅用于 SDD 和默认中文项目文档。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | Claude 请求继续经过 loopback helper；只有当前 Profile revision/窗口可发送最小字幕。逐页 owner guard 阻止旧 Key 继续分页；默认 Claude Root 形成新网络目的地，因此同步披露与安全回归。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | 不新增依赖、权限或 native 文件；使用锁文件和现有脚本重建 helper 与插件，执行白名单、架构、签名和敏感材料审计。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | 只新增当前需要的 Claude kind、Messages/Models 契约、严格校验和语义准确的批次共享；不增加未来 Provider 框架、服务端 Schema 探测或模型能力表。 |
| VI. 版本化管理 | 通过 | 通过 | 规划只引用版本管理内的当前代码、文档和 020 SDD，以及公开官方契约；不引用 `docs/providers/` 下被忽略的本地凭据资料。 |
| VII. 规格边界隔离 | 通过 | 通过 | 只修改 `specs/020-add-claude-provider/` 的 SDD；其他规格只读，不回写其产物。 |
| 工作协议 | 通过 | 通过 | 新增用户故事、默认网络目的地并跨 Global/Main/Sidebar，采用完整 SDD；规划停在 Phase 1，实施前仍需用户明确指示；共享热点文件在实施阶段串行负责。 |

## 项目结构

### 本功能文档

```text
specs/020-add-claude-provider/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── claude-messages.md
│   ├── claude-profile-and-models.md
│   └── claude-sidebar.md
└── tasks.md
```

`tasks.md` 由后续 `$speckit-tasks` 生成，本阶段不创建。

### 实现与测试

```text
src/
├── app/
│   ├── controller.ts
│   └── retry-policy.ts
├── domain/
│   ├── messages.ts
│   └── types.ts
├── providers/
│   ├── claude-api.ts                 # 新增
│   ├── claude.ts                     # 新增
│   ├── deepseek.ts
│   ├── errors.ts
│   ├── model-discovery.ts
│   ├── openai.ts
│   ├── profiles.ts
│   ├── translation-batches.ts        # 由 chat-completions.ts 改名
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
├── fixtures/providers/claude-success.json
├── contract/
│   ├── claude.test.ts
│   ├── global-rpc.test.ts
│   ├── package-manifest.test.ts
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
├── security/
│   ├── credential-leakage.test.ts
│   └── redaction.test.ts
└── unit/
    ├── model-catalog-sync.test.ts
    ├── provider-cache.test.ts
    ├── retry.test.ts
    └── sidebar-state.test.ts
Info.json
README.md
docs/
├── engineering/development.md
├── readme/README.{zh-CN,fr,ja,ko,ru,ar}.md
└── validation/iina-matrix.md
```

**结构决策**：Global 继续是 Profile metadata、凭据读取、Provider 构造、模型目录和外部请求的唯一权威边界；Main 的消息转发与 `ModelCatalogSync` 保持 provider 无关，只扩展严格 kind 联合类型；Sidebar 按 Service type 保存隔离草稿并呈现固定顺序和必填凭据状态。新增 `ClaudeProvider` 与共享 `claudeApiUrl()`，复用现有严格 validator、Broker、cache、transport 和会话所有权。协议无关的二项 wire 编排改为 `translation-batches.ts`，现有 OpenAI/DeepSeek 仅更换导入与符号名。native helper 无需修改 RPC、权限或生产代码。

## 设计阶段

1. [research.md](./research.md) 固化专用 Provider、路径、采样参数替代、严格输出、分页 owner、必填凭据、安全错误和验证决策。
2. [data-model.md](./data-model.md) 定义 Claude Profile、凭据、模型刷新、目录、Messages wire、响应候选与 Sidebar 草稿的字段和状态转换。
3. [claude-messages.md](./contracts/claude-messages.md)、[claude-profile-and-models.md](./contracts/claude-profile-and-models.md) 与 [claude-sidebar.md](./contracts/claude-sidebar.md) 约束外部 HTTP、跨运行时 Profile/目录和用户界面行为。
4. [quickstart.md](./quickstart.md) 定义聚焦自动化、完整门禁、候选包检查以及一名开发者完成的 compatible Endpoint 与 IINA 验收。

## 复杂度跟踪

无宪法例外。独立 Messages Provider 隔离现有方言；共享 URL 构造和语义准确的批次编排只服务当前 Claude 接入，避免路径与取消逻辑复制。分页逐页 owner guard 是保护旧凭据不继续产生外部副作用所必需的最小新增状态。
