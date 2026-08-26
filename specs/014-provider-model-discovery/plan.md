# 实现计划：服务模型发现与凭据扩展

**分支**：`014-provider-model-discovery` | **日期**：2026-08-21 | **规格**：[spec.md](./spec.md)

## 摘要

为 OpenAI 与 Ollama 增加独立于翻译 Provider 的运行期模型发现层：Global 通过现有 native transport 请求当前 Endpoint，按权威 Profile 上下文读取可选凭据，保存最近一次成功目录，并用请求身份、完整上下文与凭据代次拒绝迟到结果；新建认证 Profile 可由用户手动发起一次性草稿凭据刷新，Key 只用于该请求且不持久化、回传或进入目录缓存。Main 只转发逐窗口消息并隔离窗口状态，Sidebar 以带自定义项的 Model ID 下拉控件、400 毫秒 Endpoint 防抖和手动刷新呈现目录。Ollama 沿用现有只写 `apiKey` 存储并让发现、Test 与翻译统一携带可选 Bearer，同时按 Endpoint 能力在 JSON Schema 与严格 prompt-only JSON 间选择。Profile 创建结果立即更新窗口列表，凭据刷新取代保存前请求。用户可见名称改为 OpenAI，同时保留内部 `kind: "openai"`、既有 Profile 数据和自定义 API Root 语义。

## 技术上下文

- **语言与版本**：Node.js 24.18.0、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、Swift 6.0、HTML/CSS、JSON。
- **主要依赖**：IINA Plugin API、Parcel 2.16.4、Vitest 3.2.7、现有 Swift transport helper 与系统 libcurl；不新增依赖。
- **存储**：Profile metadata 继续保存在 IINA preferences，OpenAI/Ollama 的可选 `apiKey` 继续保存在 helper 私有 `credentials.json`；模型目录、请求身份与凭据代次只存在于当前 Global/窗口/Sidebar 生命周期。
- **测试**：Vitest 单元、契约、集成与安全测试，既有 Swift transport 回归，正式构建与包校验，以及开发者一人完成的 IINA 1.4.4 正式包验收。
- **目标平台**：macOS 12+，arm64 与 x86_64，IINA 1.4+；正式宿主验收使用 IINA 1.4.4。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：服务在 3 秒内返回时，至少 95% 的刷新在触发后 5 秒内呈现；目录解析与去重为响应条目数的线性操作；刷新不得阻塞播放、打开 Sidebar 或翻译调度。
- **约束**：OpenAI 请求 `{API Root}/models` 并读取 `data[].id`；Ollama 请求 `{server root}/api/tags` 并读取每项 `model`、缺失时回退 `name`；仅 trim、过滤空值、按精确大小写首次出现顺序去重。请求沿当前 system/direct 路线，常规刷新凭据只由 Global 从 helper 读取；非空未保存 Key 只可由用户手动触发的严格草稿请求使用一次。模型请求不含字幕、译文或播放状态。自动刷新改变了 Select 前的网络副作用，必须同步更新 manifest 与用户文档披露，但不扩大权限或 `allowedDomains`。生产代码不新增注释且自然语言使用英语。
- **规模与范围**：两个既有 Service type、一个运行期模型目录协调器、一个 Sidebar 模型区域、四类刷新触发、现有逐 Profile 凭据存储和多窗口消息链；不增加 Provider 类型、模型管理能力、持久目录或 native 协议。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 自动化直接执行生产模型解析、消息校验、目录状态、Provider 凭据和竞态逻辑；启动、Sidebar 打开、正式安装、多窗口与播放不阻塞保留单人实机验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 修改的 TS、HTML 与 CSS 不新增注释；标识符、错误码和 UI 文案使用英语，中文仅用于 SDD 与项目文档。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | 刷新只访问用户当前配置或正在编辑的 Endpoint，不发送字幕；凭据只在权威已保存 Profile 完全匹配时由 Global 读取。同步修订 `Info.json` 与 README，披露 Select 前的无字幕模型请求。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | 不新增依赖、权限或 native 文件；执行既有八项门禁与包敏感材料审计。本功能由 0.1.0 发布，版本与 release notes 在验收后的发布准备中统一更新。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | 只为 OpenAI/Ollama 增加目录、刷新、名称和 Ollama 凭据行为；不构建通用未来 Provider 框架、模型管理或持久缓存。 |
| 工作协议：完整 SDD、中文优先、并行边界与人工成本 | 通过 | 通过 | 本功能跨 Global/Main/Sidebar 且改变外部副作用和凭据契约，采用完整 SDD；共享 UI、消息与文档文件串行修改；人工验收只需开发者一人。 |

## 项目结构

### 本功能文档

```text
specs/014-provider-model-discovery/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── model-directory.md
│   ├── model-refresh-messages.md
│   └── sidebar-model-control.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 实现与测试

```text
src/
├── adapters/iina/model-catalog-sync.ts
├── credentials/store.ts
├── domain/messages.ts
├── providers/
│   ├── model-discovery.ts
│   ├── provider.ts
│   ├── types.ts
│   ├── openai.ts
│   └── ollama.ts
├── global.ts
└── main.ts
ui/
├── sidebar-state.ts
├── sidebar.ts
├── sidebar.html
├── sidebar.css
└── provider-status.ts
tests/
├── contract/
│   ├── provider-model-discovery.test.ts
│   ├── openai.test.ts
│   ├── ollama.test.ts
│   ├── provider-profiles.test.ts
│   ├── ui-messages.test.ts
│   ├── sidebar-form.test.ts
│   ├── sidebar-lifecycle.test.ts
│   └── package-manifest.test.ts
├── integration/
│   ├── us3-providers.test.ts
│   └── provider-connection-lifecycle.test.ts
├── security/
│   ├── credential-leakage.test.ts
│   └── redaction.test.ts
└── unit/
    ├── model-catalog-sync.test.ts
    └── sidebar-state.test.ts
Info.json
README.md
docs/
├── engineering/development.md
├── readme/
│   ├── README.zh-CN.md
│   ├── README.fr.md
│   ├── README.ja.md
│   ├── README.ko.md
│   ├── README.ru.md
│   └── README.ar.md
└── validation/iina-matrix.md
```

**结构决策**：Global 继续作为 Profile metadata、凭据读取、Provider 构造和外部请求的唯一权威边界，并新增只保存成功结果的运行期模型目录；Main 用 `model-catalog-sync.ts` 保存逐窗口目录快照和最新请求，只在活动 WebView 的轮询中安全送达；Sidebar 持有表单草稿、控件模式、请求所有权与可见反馈。`src/providers/model-discovery.ts` 只实现两种当前协议的 GET、解析和清洗，避免让强制 Model ID 的翻译 Provider 承担发现职责。native helper、transport RPC、权限集合和 `allowedDomains` 保持不变。

## 设计阶段

1. [research.md](./research.md) 固化 Provider 协议、目录所有权、凭据授权、竞态、防抖、UI、披露和验证决策。
2. [data-model.md](./data-model.md) 定义 Profile、发现上下文、运行期目录、刷新操作、模型选择和凭据代次。
3. [model-directory.md](./contracts/model-directory.md)、[model-refresh-messages.md](./contracts/model-refresh-messages.md) 与 [sidebar-model-control.md](./contracts/sidebar-model-control.md) 约束上游协议、跨运行时消息与 Sidebar 行为。
4. [quickstart.md](./quickstart.md) 定义聚焦自动化、完整门禁、候选包检查与单人 IINA 验收。

## 复杂度跟踪

无宪法例外。Global 目录代次负责外部请求与凭据权威，Main/Sidebar 请求身份负责逐窗口当前表单和可见结果；两层分别隔离跨运行时副作用和本地编辑竞态，均只保存运行期状态。
