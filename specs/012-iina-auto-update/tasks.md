# 实现任务：IINA 自动更新发现

**输入**：`spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`  
**测试策略**：先为生产更新身份、发布元数据和最终归档写失败回归，再实现并运行聚焦测试与完整发布门禁。  
**组织方式**：按用户故事排序；共享发布文件和版本文件串行修改。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：只表示文件不同、无未完成依赖且不会修改共享热点文件。
- **[US1]–[US3]**：对应 [spec.md](./spec.md) 中的三个用户故事。

## 阶段 1：测试准备

- [X] T001 [P] 在 `tests/contract/plugin-update-metadata.test.ts` 先覆盖 0.1.0 合法身份、稳定版本映射、仓库不匹配、字段缺失、非法整数和版本漂移（FR-001–FR-004、SC-001–SC-003）
- [X] T002 [P] 在 `tests/contract/release-metadata.test.ts` 先覆盖发布元数据返回并校验更新仓库、更新序号及版本映射（FR-003–FR-004）
- [X] T003 [P] 在 `tests/contract/release-audit.test.ts` 先覆盖最终归档更新身份通过与漂移失败（FR-005、FR-010）
- [X] T004 [P] 在 `tests/contract/package-manifest.test.ts` 与 `tests/contract/release-workflow.test.ts` 固定生产清单字段、staging 校验和发布门禁调用路径（FR-001–FR-006、FR-010）

## 阶段 2：基础前置

- [X] T005 在 `scripts/plugin-update-metadata.mjs` 实现稳定版本到安全递增更新序号的唯一映射、固定仓库校验和可供 shell 调用的清单校验命令（依赖 T001）
- [X] T006 在 `package.json` 的 `test:release` 纳入 `tests/contract/plugin-update-metadata.test.ts`，保持现有依赖与测试发现方式不变（依赖 T001）

## 阶段 3：用户故事 1——后续版本可由 IINA 发现（优先级：P1）🎯 MVP

**目标**：正式 0.1.0 包包含 IINA 可读取且与公开仓库一致的更新身份。

**独立测试**：生产模块接受 `{version: 0.1.0, ghRepo: janwee-sha/SubTandem, ghVersion: 1000}`，正式归档保留相同字段，其他身份失败。

- [X] T007 [US1] 在 `Info.json` 增加 `ghRepo` 与 `ghVersion` 并把清单版本更新为 0.1.0（依赖 T005）
- [X] T008 [US1] 在 `package.json`、`package-lock.json` 两处项目版本和 `scripts/pack.sh` 两处安全路径把项目版本精确更新为 0.1.0（依赖 T007）
- [X] T009 [US1] 在 `scripts/verify-package.sh` 调用生产更新身份校验，确保源码和 staging 包都满足契约（依赖 T005、T007）
- [X] T010 [US1] 在 `scripts/audit-release.mjs` 复用生产更新身份校验并把包内身份纳入最终归档审计结果（依赖 T003、T005、T007）
- [X] T011 [US1] 运行 `npx vitest run tests/contract/plugin-update-metadata.test.ts tests/contract/package-manifest.test.ts tests/contract/release-audit.test.ts` 验证正式包更新身份路径（依赖 T007–T010）

## 阶段 4：用户故事 2——发布版本不会遗漏更新序号（优先级：P2）

**目标**：后续版本提升但更新身份未同步时，现有发布门禁在公开 Release 前失败。

**独立测试**：发布元数据接口只接受与稳定版本唯一映射一致的更新身份，并把该身份传递给归档审计。

- [X] T012 [US2] 在 `scripts/release-metadata.mjs` 复用更新身份校验并输出 `githubRepository` 与 `githubVersion`（依赖 T002、T005、T007）
- [X] T013 [US2] 在 `.agents/skills/iina-plugin-release/SKILL.md` 把 `ghRepo` 与版本映射后的 `ghVersion` 纳入每次稳定版本变更和一致性检查（依赖 T005、T012）
- [X] T014 [US2] 在 `.github/workflows/release.yml` 把发布元数据中的更新身份作为最终归档审计输入，保持权限、触发器和八项门禁顺序不变（依赖 T004、T010、T012）
- [X] T015 [US2] 运行 `npx vitest run tests/contract/release-metadata.test.ts tests/contract/release-audit.test.ts tests/contract/release-workflow.test.ts` 验证发布阻断路径（依赖 T012–T014）

## 阶段 5：用户故事 3——首版用户获得更新指引（优先级：P3）

**目标**：首版用户知道 v0.1.0 已包含更新身份，并可使用 IINA 检查后续版本。

**独立测试**：人工审阅安装说明和 v0.1.0 发布说明，能够确认首版身份、安装方式和后续更新检查方式。

- [X] T016 [P] [US3] 在 `README.md` 与 `docs/readme/README.zh-CN.md` 更新 GitHub 安装和更新说明，明确 v0.1.0 首版已包含更新元数据（FR-007–FR-008、SC-005）
- [X] T017 [P] [US3] 在其余 `docs/readme/README.*.md` 本地化文档同步同一更新语义，不扩展功能范围（FR-007–FR-008）
- [X] T018 [US3] 在 `docs/releases/v0.1.0.md` 根据本规格撰写英文用户发布说明，并在 `specs/004-automatic-github-release/spec.md` 移除已过时的“不新增自动更新机制”边界、引用 012 当前职责（FR-008）

## 阶段 6：完整验证与宿主验收

- [X] T019 依照 `specs/012-iina-auto-update/quickstart.md` 严格运行八项发布门禁并生成 `build/package/SubTandem-0.1.0.iinaplgz`
- [X] T020 对最终归档执行版本、更新身份、清单白名单、SHA-256、双 native helper 架构、执行权限和签名审计，并记录自动化通过与 IINA GUI 未覆盖状态
- [X] T021 由用户在 IINA 1.4.4 对最终 0.1.0 包完成人工安装、无错误更新检查、字幕翻译冒烟和卸载验收，再记录实际结果

## 依赖与执行顺序

```text
T001 -> T005 -> T007 -> T008 -> T009 -> T010 -> T011
T002 -------------------------> T012 -> T013 -> T014 -> T015
T003 -------------------------------> T010
T004 -------------------------------------------> T014
T016 ─┐
T017 ─┼-> T018 -> T019 -> T020 -> T021
T015 ─┘
```

- 阶段 1 的四个测试文件互不重叠，可并行准备。
- T016 与 T017 修改不同文档，可并行；T018 在实现与文档范围稳定后串行完成。
- `Info.json`、`package.json`、发布脚本、workflow 和最终归档是共享热点，按任务顺序串行修改。
- T021 依赖用户实际操作，自动化不得代替或预先标记完成。

## 实施策略

1. 先完成 T001–T006，确认失败回归准确约束生产接口。
2. 完成 P1 的清单、版本、staging 与归档路径，独立证明 0.1.0 包可更新。
3. 完成 P2 的发布阻断，确保未来版本不会回归。
4. 完成 P3 的首版更新披露与 v0.1.0 发布说明。
5. 运行完整发布门禁和归档审计；最后把正式包交给用户进行 IINA GUI 验收。
