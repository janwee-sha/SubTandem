# 实现计划：IINA 自动更新发现

**分支**：`feat/iina-auto-update`  
**日期**：2026-08-19  
**规格**：[spec.md](./spec.md)

## 摘要

SubTandem 0.1.0 在正式插件清单中声明固定 GitHub 更新仓库和由稳定版本确定的递增更新序号。共享 Node.js 校验模块由发布元数据、包验证和最终归档审计共同调用，使源码清单、版本元数据与 `.iinaplgz` 保持同一更新身份；README 与 v0.1.0 发布说明明确首版已可由 IINA 检查后续版本。现有 GitHub Release 下载、权限、翻译运行时和八项发布门禁保持不变。

## 技术上下文

- **语言与版本**：Node.js 24.18.0、TypeScript 5.9、ECMAScript modules、POSIX shell、JSON。
- **主要依赖**：Node.js 标准库、Vitest、现有 `release-metadata.mjs`、`audit-release.mjs`、`verify-package.sh` 与 IINA 1.4.4 打包工具；不新增依赖。
- **存储**：版本控制内的 `Info.json`、项目版本字段和版本化发布说明；不新增运行时持久化。
- **测试**：Vitest 直接验证更新身份生产模块、发布元数据与最终归档；随后运行八项发布门禁和归档审计。
- **目标平台**：macOS 12+、IINA 1.4+、Apple Silicon 与 Intel；发布验证固定 IINA 1.4.4。
- **项目类型**：IINA 插件及其发布自动化。
- **性能目标**：不改变播放或翻译性能；更新身份校验在现有发布命令内完成。
- **约束**：稳定 SemVer；`ghRepo` 固定为 `janwee-sha/SubTandem`；更新序号为安全整数且由版本唯一确定；不新增权限、网络目的地、兼容迁移或分支。
- **规模与范围**：一个共享更新元数据模块、三个现有发布/打包接口、聚焦契约测试、用户文档、012 SDD 与 0.1.0 版本准备。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。*

| 原则 | 阶段 0 前 | 阶段 1 后 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 自动化直接调用生产更新身份模块，并通过发布元数据、包验证和最终归档审计覆盖；IINA GUI 保留人工验收。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新增脚本不添加代码注释，标识符和错误消息使用英语。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 只增加公开仓库和整数版本身份，不触碰凭据、字幕、Provider 或运行时网络。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 更新身份进入现有 `Info.json`，由源码、staging 和最终 ZIP 审计三层验证；产物白名单不变。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 只实现 IINA 现有更新契约，不引入自定义更新器、兼容分支或未来渠道。 |
| 完整 SDD 与当前意图 | 通过 | 通过 | 012 独立承载更新功能；004 仅移除已过时的“不新增自动更新”边界并引用本规格。 |
| 中文优先与职责单一 | 通过 | 通过 | SDD 和项目文档使用中文；协议字段、代码与命令保留英文。 |

## 项目结构

### 本功能文档

```text
specs/012-iina-auto-update/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── update-identity.md
├── checklists/requirements.md
└── tasks.md
```

### 实现与测试

```text
Info.json
package.json
package-lock.json
scripts/
├── plugin-update-metadata.mjs
├── release-metadata.mjs
├── audit-release.mjs
├── verify-package.sh
└── pack.sh
.agents/skills/iina-plugin-release/SKILL.md
tests/contract/
├── plugin-update-metadata.test.ts
├── package-manifest.test.ts
├── release-metadata.test.ts
├── release-audit.test.ts
└── release-workflow.test.ts
README.md
docs/readme/
docs/releases/v0.1.0.md
specs/004-automatic-github-release/spec.md
```

**结构决策**：更新身份规则集中在一个无外部依赖的生产模块中。源码发布元数据、staging 包验证和最终 ZIP 审计复用该规则，避免 shell、workflow 与测试各自复制版本算法。版本化发布说明只描述用户可感知的更新能力和首版身份边界；技术验证仍保留在现有发布证据中。

## 设计阶段

1. [research.md](./research.md) 固化 IINA 更新字段、默认分支兼容、更新序号、首版引导和验证分层决策。
2. [data-model.md](./data-model.md) 定义更新身份、正式包和首版安装的状态关系。
3. [update-identity.md](./contracts/update-identity.md) 约束字段、版本映射、验证失败和发布边界。
4. [quickstart.md](./quickstart.md) 定义聚焦回归、八项门禁、归档检查和 IINA 人工验收。

## 复杂度跟踪

无宪法例外。共享更新元数据模块是确保三个生产交付接口使用同一规则的最小实现。
