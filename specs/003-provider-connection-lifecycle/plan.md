# 实现计划：Provider 连接生命周期

**分支**：`003-provider-connection-lifecycle`  
**日期**：2026-08-13  
**规格**：[spec.md](./spec.md)

## 摘要

系统代理请求使用 helper 生命周期内的共享会话，`system` 与 `direct` 共用显式 host 门控，限制最多 4 个同主机请求进入传输层；`direct` 继续以 libcurl 显式绕过代理，并通过有界 easy handle 池让连续请求复用连接。每个 OpenAI-compatible Provider 实例生成一个无业务语义的运行期会话身份，供 Test 与翻译请求共同携带，避免网关把每个字幕请求保留为独立活动会话。活动请求仍按 job 身份独立取消，系统路径的重定向状态按任务保存。Provider 每次 Test 都真实联网，Global 按窗口、Profile revision 和任务隔离完成与取消；外部消息结构、播放选择和翻译边界不变。

## 技术上下文

- **语言与版本**：Swift 6.0；TypeScript 5.9 strict、ES2020；Node.js 24/npm 11。
- **主要依赖**：Foundation `URLSession`、Network、现有 libcurl system library、IINA 1.4+ Plugin API；不新增依赖。
- **存储**：只新增 helper、Global 和 Provider 实例内的瞬时状态；不新增文件、偏好或跨运行期持久化。
- **测试**：现有 Swift 自包含契约测试、Vitest provider/Global/集成回归，以及 IINA 1.4+ 正式安装包人工验收。
- **目标平台**：macOS 12+、arm64 与 x86_64、IINA 1.4+。
- **项目类型**：IINA 插件，包含 native helper、单例 Global、每窗口 Main 与 Sidebar。
- **性能目标**：两条网络路径对每 host 最多放行 4 个并发请求，连续请求复用有限连接；同一 OpenAI-compatible Profile 复用一个网关会话身份，连续 100 cue 或 5 分钟翻译不发生连接或会话耗尽。
- **约束**：保持同源最多 3 次重定向、25 cue/batch、2 cue/wire、最多三次额外重试、消息结构和 Test/Select 独立语义；生产代码不新增注释或非英语自然语言。
- **规模与范围**：一个 helper 共享系统代理会话和两条路径的 host 门控，多个窗口和多个 Provider/Test 任务并发；`direct` 保留独立 libcurl 传输；每个 OpenAI-compatible Provider 实例拥有一个瞬时会话身份。

## 宪法检查

*阶段 0 前与阶段 1 设计后分别检查；两次均通过。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 本功能落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 原生连接、Provider Test、Global 隔离均先写回归；保留完整检查和正式包 IINA 验收任务。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 计划中的生产代码只使用英语命名与现有错误码，不添加生产代码注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 不扩大目的地、字幕外发、凭据或日志；Test 只使用当前 Profile 已允许的最小请求。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 不新增包内容类别；完整构建、包校验和双架构 helper 验收继续作为关闭门槛。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 只引入共享会话、跨路径 host 请求门控、`direct` 有界连接复用、Provider 运行期会话身份和真实 Test 所需状态。 |
| 完整 SDD 与当前意图 | 通过 | 通过 | 003 独立描述当前设计和未执行任务，不改写 001/002，不把历史修复过程写入产物。 |
| 中文优先与职责单一 | 通过 | 通过 | SDD 文档使用中文并通过相互引用避免重复；代码名、协议名和命令保留必要英文。 |

## 项目结构

### 本功能文档

```text
specs/003-provider-connection-lifecycle/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── connection-lifecycle.md
│   └── provider-test.md
├── checklists/requirements.md
└── tasks.md
```

### 源码与测试

```text
native/transport/
├── Sources/SubTandemTransport/
│   ├── HTTPClient.swift
│   └── Protocol.swift
└── Tests/SubTandemTransportTests/
    ├── HTTPClientTests.swift
    └── ServerTests.swift

src/
├── global.ts
└── providers/
    ├── connection-tests.ts
    ├── ollama.ts
    ├── openai.ts
    └── provider.ts

tests/
├── contract/
│   ├── global-rpc.test.ts
│   ├── ollama.test.ts
│   ├── openai.test.ts
│   ├── provider-connection-tests.test.ts
│   └── ui-messages.test.ts
└── integration/
    └── provider-connection-lifecycle.test.ts
```

**结构决策**：跨路径请求门控和连接所有权留在现有 native `HTTPClient`，libcurl easy handle 与连接复用留在 `DirectCurlTransport`；协议处理器只负责关闭编排。OpenAI-compatible Provider 负责把 Global 生成的运行期身份加到其全部请求；Provider 自己知道如何形成最小真实检查。独立的连接测试注册表只管理窗口/Profile/内部测试身份，`global.ts` 保持消息适配职责。Main 与 Sidebar 无生产改动，因为既有消息已经能表达目标行为。

## 设计阶段

1. [research.md](./research.md) 固化共享系统会话、跨路径每 host 4 个请求、Provider 运行期会话身份、任务级取消/重定向、真实连接测试和不变边界。
2. [data-model.md](./data-model.md) 只定义共享会话、活动请求、重定向状态和连接测试任务的瞬时状态。
3. [connection-lifecycle.md](./contracts/connection-lifecycle.md) 约束两条路径的门控与连接复用、取消、关闭及多窗口隔离。
4. [provider-test.md](./contracts/provider-test.md) 约束每次 Test 真实联网、错误分类、唯一身份和不改变播放选择。
5. [quickstart.md](./quickstart.md) 定义聚焦自动化、完整检查与 IINA 正式包验收。

## 复杂度跟踪

无宪法例外。Global 中独立的连接测试注册表是并发 Test、Profile 删除和多窗口取消不互相影响所需的最小瞬时组件。
