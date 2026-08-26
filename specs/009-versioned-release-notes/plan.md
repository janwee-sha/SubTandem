# 实现计划：版本化用户发布说明

**功能标识**：`009-versioned-release-notes` | **日期**：2026-08-17 | **规格**：[spec.md](./spec.md)

**输入**：`specs/009-versioned-release-notes/spec.md`

## 摘要

把 `docs/releases/vX.Y.Z.md` 作为对应稳定版本 GitHub Release 正文的唯一仓库来源。新增共享的发布说明解析与校验边界，由元数据阶段尽早验证版本、标题、允许章节和技术证据禁区；最终归档审计复核源文件未被后续步骤改变，将原始正文复制进只读工作流产物并记录摘要；发布阶段再次核对摘要和正文，只允许正文一致的 draft 恢复或公开版本跳过。技术发布证据改由 `release-audit.json`、校验文件及 Actions 摘要与日志承载，不进入用户正文，也不改变现有八项门禁、四项公开资产或 `.iinaplgz` 内容。

## 技术上下文

**语言与版本**：Node.js 24.18.0、ECMAScript modules、GitHub Actions YAML、Markdown；现有 TypeScript 5.9 与 Swift 6.0 运行时不变

**主要依赖**：Node.js 标准库、GitHub CLI、现有 pinned GitHub Actions、Vitest 3.2.7；不新增 npm 依赖

**存储**：版本控制中的 `docs/releases/vX.Y.Z.md`；`build/release/` 下的瞬时正文副本、审计 JSON 和校验文件；GitHub Release 远端正文

**测试**：元数据、最终归档审计、发布状态和 workflow 的 Vitest 回归；`npm run test:release`、完整项目检查和单人发布说明验收。版本化正文由发布脚本在运行时校验，不维护专门的文档测试套件

**目标平台**：GitHub-hosted `macos-15` Arm64 构建任务与 Ubuntu 24.04 发布任务；本地 Node.js 24；GitHub Releases

**项目类型**：IINA 桌面插件仓库中的发布自动化与版本化项目文档，不修改插件运行时

**性能目标**：发布说明结构校验在昂贵构建开始前完成，当前文档规模下不新增网络请求且耗时低于 1 秒

**约束**：只支持稳定 `X.Y.Z`；英文用户正文；固定小型 Markdown 子集；workflow 不生成或回写仓库文档；跨任务正文按原始摘要绑定；公开 Release 不覆盖；生产脚本不新增注释

**规模与范围**：每个稳定版本 1 份发布说明、最多 4 类章节；1 个共享校验模块、3 个现有发布脚本、1 个 workflow、4 组聚焦契约测试及相关当前意图文档

## 宪法检查

*门禁：Phase 0 前检查，并在 Phase 1 后复查。*

| 原则 | Phase 0 前 | Phase 1 后 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 结构、身份、摘要、draft、公开正文和 workflow 均设计自动回归；语义范围保留明确的开发者单人验收。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新脚本逻辑不添加注释；发布说明、技术状态与错误均使用英语。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 不接触凭据或字幕；本地实现与测试不写远端，正式发布继续只使用既有最小 `contents: write` 任务。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 发布说明和证据不进入 `.iinaplgz`；八项门禁、四项公开资产和最终归档审计保持不变。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 移除旧技术正文生成器，不保留双正文或旧版兼容路径，不引入 prerelease、自动摘要或通用 Markdown 框架。 |
| 完整 SDD 与当前意图 | 通过 | 通过 | 009 独立承载新功能；实施时同步收敛 004 与 006 中冲突的当前意图，并保留既有已完成任务编号与状态。 |
| 中文优先、职责单一与低人工成本 | 通过 | 通过 | SDD 和项目文档使用简洁中文；一次开发者验收核对规格来源与用户措辞，不要求多名目标用户。 |

Phase 0 前无宪法门禁失败或待澄清项。Phase 1 设计复查确认正文、技术证据、远端状态和现有发布包职责互不混合，全部门禁继续通过。

## 项目结构

### 本功能文档

```text
specs/009-versioned-release-notes/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── versioned-release-notes.md
│   └── release-body-handoff.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 实现与测试

```text
.github/workflows/release.yml
docs/
├── releases/
│   └── vX.Y.Z.md
├── engineering/development.md
└── validation/package.md
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
specs/
├── 004-automatic-github-release/
└── 006-sponsor-entry/
```

**结构决策**：发布说明语法和正文规范化放入独立的 `scripts/release-notes.mjs`，由元数据、审计和发布三个边界复用，避免规则漂移。元数据阶段记录触发提交中文件的原始摘要；审计阶段在全部构建步骤后复核摘要并复制正文到跨任务产物；发布阶段只消费该审计副本。004 继续拥有通用发布状态和资产契约，006 继续拥有 README 与 Sponsor 入口；两者只移除与 009 冲突的正文要求。

## 设计阶段

1. [research.md](./research.md) 固化正文来源、语法、摘要链路、技术证据位置、远端一致性和 SDD 收敛决策。
2. [data-model.md](./data-model.md) 定义版本发布范围、版本化发布说明、审计身份和远端 Release 状态。
3. [versioned-release-notes.md](./contracts/versioned-release-notes.md) 约束路径、Markdown 子集、无变化模式与技术证据禁区。
4. [release-body-handoff.md](./contracts/release-body-handoff.md) 约束 metadata、audit、publish 之间的原文摘要传递，以及 draft/公开正文比较。
5. [quickstart.md](./quickstart.md) 定义聚焦测试、失败关闭、完整回归和不产生远端写入的本地验收。

## 复杂度跟踪

无宪法例外。独立校验模块由三个发布边界共享，是防止正文语法、规范化和摘要规则分叉所需的最小组件。
