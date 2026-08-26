# 实现计划：自动 GitHub Release

**分支**：`main`  
**日期**：2026-08-14  
**规格**：[spec.md](./spec.md)

## 摘要

Node.js 发布元数据、最终归档审计和 GitHub Release 发布接口由 `.github/workflows/release.yml` 在远程 `main` 推送或限定的手动重试中编排。构建任务在 `macos-15` Arm64 runner 上固定 Node.js 24.18.0、npm 11 和校验后的 IINA v1.4.4，严格执行八项门禁；发布任务只消费经过审计的工作流产物，以 `contents: write` 创建或恢复 draft、核对正文与四项资产后公开为 Latest。已发布版本仅在正文一致时只读跳过，任何对象冲突都失败且不覆盖。

## 技术上下文

- **语言与版本**：Node.js 24.18.0、ECMAScript modules、POSIX shell、GitHub Actions YAML；现有 TypeScript 5.9 与 Swift 6.0 构建不变。
- **主要依赖**：Node.js 标准库、系统 `unzip`/`lipo`/`codesign`、GitHub CLI、官方 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 和 `actions/download-artifact`；不新增 npm 依赖。
- **存储**：009 定义的版本化用户说明；`build/` 下的瞬时归档、校验、审计 JSON 与正文副本；不新增产品持久化。
- **测试**：Vitest 对正文身份、元数据、ZIP 中央目录安全规则、native 属性失败和发布状态决策做回归；静态工作流契约测试固定触发器、权限、Action SHA 和门禁顺序；最后运行完整八项门禁。
- **目标平台**：GitHub-hosted `macos-15` Arm64 构建 runner；独立 Ubuntu 发布 runner；插件仍支持 macOS 12+、arm64/x86_64、IINA 1.4+。
- **项目类型**：IINA 插件仓库的发布自动化，不修改插件运行时。
- **性能目标**：不设运行时性能目标；单次触发只形成一个发布身份，重复触发不覆盖任何既有对象。
- **约束**：稳定 SemVer；正文符合 009 契约；精确触发 SHA；官方 Action 固定完整 SHA；IINA v1.4.4 固定哈希；构建只读、发布可写；生产脚本不添加注释或非英语自然语言。
- **规模与范围**：一个 workflow、四个发布脚本、四组聚焦测试、004 SDD 与发布技能/验证约定。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 元数据、归档、native 和状态机均有自动回归；明确 CI 不声称 IINA 图形界面验收通过。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新增可执行脚本只使用英语标识与消息，不添加生产代码注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 不读取 provider 信息或产品数据；发布任务只写目标仓库 Release。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 八项门禁和最终 ZIP 中央目录审计共同验证可重建、白名单和 helper 属性。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 只实现稳定自动 Release，不预留 prerelease、公证或更新机制。 |
| 完整 SDD 与当前意图 | 通过 | 通过 | 004 独立描述当前目标、设计和未完成任务。 |
| 中文优先与职责单一 | 通过 | 通过 | SDD、技能和验证文档使用中文，代码与协议名保留必要英文。 |

## 项目结构

### 本功能文档

```text
specs/004-automatic-github-release/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── archive-audit.md
│   └── release-lifecycle.md
├── checklists/requirements.md
└── tasks.md
```

### 实现与测试

```text
.github/workflows/release.yml
scripts/
├── release-notes.mjs
├── release-metadata.mjs
├── audit-release.mjs
└── publish-release.mjs
tests/contract/
├── release-metadata.test.ts
├── release-audit.test.ts
├── release-publish.test.ts
└── release-workflow.test.ts
.agents/skills/iina-plugin-release/SKILL.md
docs/validation/package.md
```

**结构决策**：可本地执行的 Node.js 脚本拥有正文校验、版本、ZIP 安全和发布状态机规则，workflow 只负责编排环境、严格门禁、权限和跨任务产物。正文契约由 009 的共享模块提供；最终归档审计直接读取 ZIP 中央目录，先拒绝危险条目再解包；发布接口通过 `gh` 读写 draft、tag 和资产，workflow 不复制状态机。

## 设计阶段

1. [research.md](./research.md) 固化 runner、IINA、Action SHA、权限、draft、正文与证据决策。
2. [data-model.md](./data-model.md) 定义发布版本、归档审计和草稿发布的瞬时状态。
3. [archive-audit.md](./contracts/archive-audit.md) 约束版本、ZIP 路径、白名单和 helper 验收。
4. [release-lifecycle.md](./contracts/release-lifecycle.md) 约束新建、跳过、恢复、冲突和公开顺序。
5. [quickstart.md](./quickstart.md) 定义聚焦测试、完整门禁和 GitHub 场景验收。

## 复杂度跟踪

无宪法例外。独立 `publish-release.mjs` 是把 draft 恢复和资产不可覆盖规则从 YAML 中提取为可测试发布接口所需的最小组件。
