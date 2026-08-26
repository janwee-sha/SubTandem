# 实现计划：Provider HTTP 与 Profile 交互优化

**分支**：`013-local-openai-profile-ux` | **日期**：2026-08-20 | **规格**：[spec.md](./spec.md)

## 摘要

让 OpenAI-compatible 与 Ollama 对用户明确配置的任意有效 HTTP(S) endpoint 使用同一许可规则，不再按协议或主机网络位置阻断，并在 TypeScript 保存/构造层与 native 最终出站层继续拒绝无效 URL、URL 凭据、片段和跨来源重定向。Sidebar 以可独立测试的瞬时状态模型实现删除收敛、操作消息全局互斥与持续显示、区域请求竞态及默认名称来源保护；Main 以请求代次拒绝迟到 Profile 列表。最后把当前交付身份统一更新为 0.1.0，并只准备和审计候选包，不执行远端发布。

## 技术上下文

- **语言与版本**：Node.js 24.18.0、npm 11、TypeScript 5.9.3 strict、ES2020/ESNext、Swift 6.0、POSIX shell、JSON。
- **主要依赖**：IINA Plugin API、Parcel 2.16.4、Vitest 3.2.7、Foundation/Network、系统 libcurl、锁定的 FFmpeg 8.1.2；不新增依赖。
- **存储**：沿用 Profile metadata、preferences 与 helper 私有凭据文件；删除墓碑、列表请求代次、区域请求身份、全局操作消息和名称来源只存在于所属 Main/Sidebar 生命周期。
- **测试**：Vitest 单元、契约、集成与安全测试，Swift transport 契约测试，正式构建、包校验、最终归档审计，以及开发者一人完成的 IINA 实机验收。
- **目标平台**：macOS 12+，arm64 与 x86_64，IINA 1.4+；正式包验收使用 IINA 1.4.4。
- **项目类型**：包含 Global、逐窗口 Main、Sidebar WebView、native helper 与发布自动化的 IINA 桌面插件。
- **性能目标**：删除权威成功结果送达 Sidebar 后立即收敛，并满足 1 秒可见目标；操作消息写入时同步替换其他区域消息，反馈协调和列表过滤为线性于当前 Profile 数量的内存操作，不阻塞播放或翻译。
- **约束**：所有 Service type 均接受完整有效的 HTTP(S) URL，不按回环、局域网、私网、公网、域名或 IP 分类，不增加风险提示、确认或强制网络路线；继续拒绝非 HTTP(S)、URL 凭据、query、fragment、无效 authority 与跨来源重定向；Sidebar 操作消息保持可见直至下一条被接受的消息同步替换，但不得取消请求、解除控件 busy 或改变业务状态；保持凭据单向流、明确 Select、最小字幕外发、日志隔离、多窗口与包白名单边界；生产代码不新增注释且自然语言使用英语；不执行 commit、push、tag、上传或 GitHub Release 修改。
- **规模与范围**：两个可配置 Service type、TypeScript/native 双层 endpoint 校验、一个 Sidebar 瞬时状态模块、一个 Main 列表同步状态、一个全局可见操作消息与区域请求身份集合、现有消息流和 0.1.0 交付身份。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过，无待解释例外。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| I. 验证与产品安全 | 通过 | 通过 | 自动化直接执行 endpoint 生产校验、Sidebar 状态转换、全局消息竞态、持续显示与替换、跨运行时消息、native transport 与发布接口；正式包的 GUI、安装和播放行为保留单人实机验收。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 修改的 TS、Swift、HTML、CSS 与 shell 不新增注释；标识符、错误码及用户文案使用英语。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 通过 | 远程 HTTP 只来自用户自行填写并明确 Select 的 endpoint，按宪法 3.0.0 不触发额外披露；凭据单向流、精确 revision/fingerprint、最小字幕范围、日志隔离、同源重定向和会话清理不变。 |
| IV. 可重建且最小的发布产物 | 通过 | 通过 | 0.1.0 身份由现有元数据、八项门禁和最终 `.iinaplgz` 审计证明；包白名单、双 helper、签名、权限与最低版本不变。 |
| V. 生产代码只实现当前功能需求 | 通过 | 通过 | endpoint 变更只移除规格禁止的网络位置限制；Sidebar 状态只承载本规格的删除、全局单消息竞态、区域请求竞态和名称来源，不构建通用框架或未来 Provider 兼容层。 |
| 工作协议：完整 SDD、中文优先、并行边界与人工成本 | 通过 | 通过 | 本功能改变跨运行时网络安全契约并采用完整 SDD；产物中文且只描述当前意图；共享 UI、版本和发布文件串行修改；人工验收仅由开发者一人执行。 |

## 项目结构

### 本功能文档

```text
specs/013-local-openai-profile-ux/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── endpoint-http.md
│   ├── sidebar-interactions.md
│   └── version-identity.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 实现与测试

```text
src/
├── adapters/iina/profile-list-sync.ts
├── providers/
│   ├── profiles.ts
│   ├── openai.ts
│   └── ollama.ts
├── global.ts
└── main.ts
ui/
├── sidebar-state.ts
├── sidebar.ts
├── provider-status.ts
├── sidebar.html
└── sidebar.css
native/transport/
├── Sources/SubTandemTransport/HTTPClient.swift
└── Tests/SubTandemTransportTests/HTTPClientTests.swift
tests/
├── contract/
│   ├── provider-profiles.test.ts
│   ├── openai.test.ts
│   ├── ollama.test.ts
│   ├── sidebar-form.test.ts
│   ├── sidebar-lifecycle.test.ts
│   ├── ui-messages.test.ts
│   ├── plugin-update-metadata.test.ts
│   ├── package-manifest.test.ts
│   ├── release-metadata.test.ts
│   └── release-audit.test.ts
├── integration/us3-providers.test.ts
├── security/
│   ├── credential-leakage.test.ts
│   └── redaction.test.ts
└── unit/
    ├── profile-list-sync.test.ts
    └── sidebar-state.test.ts
Info.json
package.json
package-lock.json
scripts/pack.sh
docs/releases/v0.1.0.md
docs/engineering/development.md
```

**结构决策**：保持 Global 为 Profile metadata、凭据操作和删除结果的权威来源，Main 为逐窗口选择与 Profile 列表同步协调者，Sidebar 为界面瞬时状态和渲染者，native helper 为最终出站边界。`src/adapters/iina/profile-list-sync.ts` 提供 Main 专用的纯列表代次状态，`ui/sidebar-state.ts` 以 classic script 全局工厂形式分别保存区域最新请求和全局唯一可见消息，使现有 IINA WebView 非 module 加载契约不变；`sidebar.ts` 只连接 IINA 消息与 DOM。IINA 的 `allowedDomains` 与 helper 的 loopback RPC 绑定不变，它们不代表上游 Provider 白名单。版本和发布文件属于共享热点，在所有功能切片收敛后串行修改与验收。

## 设计阶段

1. [research.md](./research.md) 固化任意 HTTP(S) 许可、保留的 URL/重定向边界、删除竞态、全局单消息竞态、区域请求竞态、默认名称、文案与 0.1.0 身份决策。
2. [data-model.md](./data-model.md) 定义既有 Profile、Main 列表同步状态及 Sidebar 的删除、全局操作消息、区域请求和名称来源瞬时状态。
3. [endpoint-http.md](./contracts/endpoint-http.md)、[sidebar-interactions.md](./contracts/sidebar-interactions.md) 与 [version-identity.md](./contracts/version-identity.md) 约束跨运行时、安全、UI 与交付接口。
4. [quickstart.md](./quickstart.md) 定义聚焦自动化、八项门禁、最终归档审计和单人 IINA 正式包验收。

## 复杂度跟踪

无宪法例外。Main 的请求代次阻止异步凭据读取产生的旧列表成为权威快照；Sidebar 墓碑保证当前 WebView 在权威删除后不被已排队的旧状态恢复。两者处理不同竞态层级，且均为生命周期内状态。
