# 实现任务：自动 GitHub Release

**输入**：`spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`  
**测试策略**：元数据、归档安全、发布状态和 workflow 先写失败回归，再实现并运行聚焦与完整门禁。  
**组织方式**：按用户故事排序；共享脚本和 workflow 串行修改。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：只表示文件不同且不依赖尚未完成的同级任务。
- **[US1]–[US3]**：对应 [spec.md](./spec.md) 中的三个用户故事。

## 阶段 1：共享测试准备

- [X] T001 在 `vitest.config.ts` 纳入自动发布契约测试，并在 `package.json` 增加可本地执行的发布元数据、归档审计测试入口（支撑 FR-002、FR-005–FR-012）

## 阶段 2：基础前置

- [X] T002 [P] 在 `tests/contract/release-metadata.test.ts` 先覆盖合法版本、非法 SemVer、五个版本位置不一致和产物路径不一致的失败回归（FR-002、SC-005）
- [X] T003 [P] 在 `tests/contract/release-audit.test.ts` 先覆盖包名/包内版本、根目录、禁用文件、路径穿越、反斜线、重复路径、符号链接及 native 属性丢失的失败回归（FR-005–FR-006、SC-005–SC-006）
- [X] T004 [P] 在 `tests/contract/release-publish.test.ts` 先覆盖新建、公开跳过、draft 恢复、commit/正文/资产冲突和不可覆盖决策（FR-007–FR-012、SC-001–SC-004）
- [X] T005 [P] 在 `tests/contract/release-workflow.test.ts` 固定触发器、权限、Arm64 runner、Node/IINA 版本、Action SHA、八项门禁顺序和构建/发布任务边界（FR-001、FR-003–FR-004、FR-013–FR-015）

## 阶段 3：用户故事 1——新版本自动正式发布（优先级：P1）🎯 MVP

**目标**：新版本通过完整门禁和最终归档审计后形成唯一、可校验、可追溯的稳定 Release。

**独立测试**：聚焦测试与完整八项门禁通过；模拟不存在 Release 的状态得到 create-draft 计划，生成的正文和两项资产满足契约。

- [X] T006 [US1] 在 `scripts/release-metadata.mjs` 实现稳定 SemVer、五处版本、tag 与产物名验证，并支持 JSON 和 GitHub job output（依赖 T002）
- [X] T007 [US1] 在 `scripts/audit-release.mjs` 实现 ZIP 中央目录预检、包内版本、白名单、禁用内容、双 helper 验收、SHA 文件、审计 JSON 和英文正文生成（依赖 T003、T006）
- [X] T008 [US1] 在 `scripts/publish-release.mjs` 实现通过 GitHub CLI 创建 draft、验证 tag/正文、上传并复核两项资产、公开普通 Release 和标记 Latest（依赖 T004、T007）
- [X] T009 [US1] 在 `.github/workflows/release.yml` 实现 `push.main` 与限定的手动触发、`macos-15` Arm64、Node 24.18.0/npm 11、校验 IINA v1.4.4、八项顺序门禁、最终审计和独立发布任务（依赖 T005–T008）
- [X] T010 [US1] 运行 `npx vitest run tests/contract/release-metadata.test.ts tests/contract/release-audit.test.ts tests/contract/release-publish.test.ts tests/contract/release-workflow.test.ts`，确认 FR-001–FR-009 与 SC-001、SC-005–SC-006（依赖 T009）

## 阶段 4：用户故事 2——未提升版本时安全验证（优先级：P2）

**目标**：公开同版本在全部门禁后只读跳过，不移动 tag 或修改 Release/资产。

**独立测试**：公开 Release 决策直接返回 skip，且 workflow 的跳过只发生在构建和审计任务成功之后。

- [X] T011 [US2] 在 `scripts/publish-release.mjs` 收敛公开版本只读跳过路径，并确保后续提交 SHA 不触发 tag 移动（依赖 T008）
- [X] T012 [US2] 在 `tests/contract/release-publish.test.ts` 和 `tests/contract/release-workflow.test.ts` 验证同版本跳过不产生任何写命令且仍依赖完整构建任务（依赖 T011）

## 阶段 5：用户故事 3——失败与重试不公开残缺版本（优先级：P3）

**目标**：只有完全一致的 draft 可恢复；资产逐项核对且永不覆盖，冲突保留现场并失败。

**独立测试**：匹配 draft 与部分资产得到 resume/upload-missing，commit、正文、额外资产或内容冲突均在 publish 前失败。

- [X] T013 [US3] 在 `scripts/publish-release.mjs` 实现并发创建后重读、tag peel、draft target/正文核对、远端资产下载哈希比较和冲突失败（依赖 T008、T011）
- [X] T014 [US3] 在 `tests/contract/release-publish.test.ts` 补齐中断恢复、额外资产、同名不同内容和发布后 tag 精确 SHA 回归（依赖 T013）
- [X] T015 [US3] 在 `.github/workflows/release.yml` 配置不取消的 ref 级并发组，并确保任何构建或审计失败都不会启动发布任务（依赖 T009、T013）

## 阶段 6：文档、完整验证与收敛

- [X] T016 在 `.agents/skills/iina-plugin-release/SKILL.md` 与 `docs/validation/package.md` 更新自动 Release 证据约定，不回写每版本证据且明确 IINA GUI 行为未覆盖（FR-014–FR-015）
- [X] T017 依照 `specs/004-automatic-github-release/quickstart.md` 严格运行八项门禁和最终归档审计，确认构建与包内 helper、归档清单、SHA 和英文正文均通过
- [X] T018 保留完整任务清单并将已验收任务标记 `[X]`，再次执行只读一致性分析，确认规格、计划、任务和实现一致

## 依赖与执行顺序

```text
T001
├── T002 -> T006 ─┐
├── T003 ─────> T007 ─┐
├── T004 ─────────> T008 -> T011 -> T013
└── T005 ───────────────────────────────┴─> T009/T015
                                               ├─> T010/T012/T014
                                               └─> T016 -> T017 -> T018
```

- T002–T005 修改不同测试文件，可在同一阶段并行；实现任务按共享契约串行。
- `scripts/publish-release.mjs` 按 T008→T011→T013 单负责人修改。
- `.github/workflows/release.yml` 按 T009→T015 单负责人修改。
- 公开 Release 是外部副作用；本地实现阶段只运行脚本与静态/模拟测试，不创建远端 Release。

## 完成条件

- 18 个任务均符合 checkbox、唯一 ID、故事标签和明确文件路径格式，并在验收后标记 `[X]`。
- 聚焦自动发布测试与八项门禁全部通过。
- 最终归档审计从 `.iinaplgz` 读取版本、清单、大小、SHA 和两份 helper 属性，并生成英文正文。
- workflow 只在新版本创建稳定 Release，同版本只验证并跳过；draft 可恢复且任何 tag、正文或资产冲突都不覆盖。
- 发布技能与验证文档不再要求 workflow 回写仓库，且不把 IINA GUI 行为标记为 CI 已验证。
