# 实现任务：版本化用户发布说明

**输入**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/) 与 [quickstart.md](./quickstart.md)

**测试要求**：发布正文、审计证据和远端不可变行为属于公共发布契约，必须先写失败回归再实现；完成后严格执行发布门禁和单人验收。

**组织方式**：共享正文校验是所有故事的基础；其后按 P1、P2、P3 交付可独立验证的增量。共享脚本、测试文件和 workflow 由单一负责人按任务顺序修改。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：前置任务完成后，可在隔离 worktree 中与同组任务并行，且不修改相同文件。
- **[US1]–[US3]**：对应 [spec.md](./spec.md) 中的三个用户故事。
- Setup、Foundational 和收尾任务不使用故事标签。

## 阶段 1：准备

**目的**：把新契约测试纳入现有发布测试入口，不改变依赖或运行时。

- [X] T001 在 `package.json` 的 `test:release` 脚本中注册 `tests/contract/release-notes.test.ts`，保留现有四组发布测试

---

## 阶段 2：共享基础

**目的**：先建立元数据、审计和发布器共同依赖的正文身份、解析、摘要与比较规则。

**关键要求**：本阶段完成前不得开始任何用户故事实现。

- [X] T002 在 `tests/contract/release-notes.test.ts` 先添加固定标题、变化/无变化模式、正文规范化和原始摘要的失败契约测试，并确认测试在实现前失败
- [X] T003 在 `scripts/release-notes.mjs` 实现路径派生、UTF-8 读取、基础 Markdown 解析、原始 SHA-256 与 CRLF/末尾空白规范化，使 T002 通过且不添加生产代码注释

**检查点**：三个发布边界可以复用同一正文身份和比较规则。

---

## 阶段 3：用户故事 1——用户快速理解版本变化（优先级：P1）🎯 MVP

**目标**：新版本公开正文直接采用版本化用户说明，不再生成技术证据页或固定打赏段落。

**独立测试**：使用当前 `docs/releases/v0.1.0.md` 运行聚焦测试和本地元数据/审计路径，确认审计产物中的 `release-notes.md` 与源文件原始摘要一致，正文只含用户变化，既有四项公开资产和八项门禁编排不变。

### 测试

- [X] T004 [P] [US1] 在 `tests/contract/release-metadata.test.ts` 先覆盖当前版本说明的唯一路径、标题版本、GitHub output 路径和原始摘要，并确认新增断言失败
- [X] T005 [P] [US1] 在 `tests/contract/release-audit.test.ts` 先覆盖审计原样复制用户正文、记录源路径/摘要且不再生成技术正文或打赏段落，并确认新增断言失败
- [X] T006 [P] [US1] 在 `tests/contract/release-workflow.test.ts` 先固定元数据→审计→下载产物→发布的正文传递、Actions 技术摘要和禁止 workflow 生成正文，并确认新增断言失败

### 实现

- [X] T007 [P] [US1] 在 `scripts/release-metadata.mjs` 读取并验证 `docs/releases/vX.Y.Z.md`，向 JSON 与 GitHub output 增加发布说明路径和原始摘要
- [X] T008 [P] [US1] 在 `scripts/audit-release.mjs` 移除 `buildReleaseNotes` 技术正文生成，复验初始摘要并原样写入 `build/release/release-notes.md`，同时在 `release-audit.json` 记录正文身份
- [X] T009 [US1] 在 `.github/workflows/release.yml` 把元数据输出传给最终审计、上传审计后的正文副本并继续让发布任务读取 `build/release/release-notes.md`
- [X] T010 [US1] 运行 `npx vitest run tests/contract/release-notes.test.ts tests/contract/release-metadata.test.ts tests/contract/release-audit.test.ts tests/contract/release-workflow.test.ts`，确认用户故事 1 的正向路径通过

**检查点**：在不改变远端状态机的情况下，下一次新版本的 Release body 已只来自版本化用户说明。

---

## 阶段 4：用户故事 2——维护者按版本保存权威正文（优先级：P2）

**目标**：维护者能按目标版本创建唯一、严格、英文且由用户指定已验收规格支撑的发布说明；可机器判断的错误在构建前失败。

**独立测试**：在测试临时目录中准备两个合法稳定版本、合法无变化版本及各类非法文档，确认版本各自定位唯一文件；缺失、错版、空章节、非法结构、非英文条目和技术证据均失败；发布技能仍要求用户先提供版本与规格。

### 测试

- [X] T011 [P] [US2] 扩充 `tests/contract/release-notes.test.ts`，先覆盖固定章节顺序、重复/未知/空章节、额外段落、非英文条目、技术证据禁区、两版本唯一性、无变化句互斥及 `.agents/skills/iina-plugin-release/SKILL.md` 的版本/规格输入边界
- [X] T012 [P] [US2] 扩充 `tests/contract/release-metadata.test.ts`，先覆盖发布说明缺失、非普通文件、BOM/无效 UTF-8、文件名/标题/项目版本错配和非法正文在昂贵构建前失败

### 实现

- [X] T013 [P] [US2] 在 `scripts/release-notes.mjs` 完成 [versioned-release-notes.md](./contracts/versioned-release-notes.md) 的严格 Markdown 子集、英文条目和技术证据拒绝规则
- [X] T014 [US2] 在 `scripts/release-metadata.mjs` 完成权威路径和文件身份的失败关闭行为，确保调用者不能选择其他文档路径
- [X] T015 [P] [US2] 在 `docs/engineering/development.md` 增加简短的发布准备入口、`docs/releases/vX.Y.Z.md` 命名、用户指定规格前置条件及 009 规格链接，不重复技能正文
- [X] T016 [US2] 按 `specs/009-versioned-release-notes/quickstart.md` 运行结构与版本化验收，确认 `docs/releases/v0.1.0.md` 只作为合法结构样本且不把它自动声明为已获发布授权

**检查点**：维护者可以长期按版本定位权威正文，自动门禁与发布准备流程分别承担结构和语义验收。

---

## 阶段 5：用户故事 3——失败关闭且保留技术证据（优先级：P3）

**目标**：任何正文或摘要冲突都在覆盖前失败；技术证据完整迁移到审计 JSON、Actions 摘要与日志，公开版本正文一致才只读跳过。

**独立测试**：模拟摘要漂移、draft target/正文冲突、公开正文一致/偏差、并发公开和最终正文未收敛，确认合法状态按契约恢复或跳过，所有冲突的 GitHub 写命令数为零；审计证据字段、宿主未覆盖状态、八项门禁和四项资产全部保留。

### 测试

- [X] T017 [P] [US3] 扩充 `tests/contract/release-audit.test.ts`，先覆盖初始/最终摘要漂移失败、技术证据字段完整、三项 `not-covered` 宿主状态、Actions 摘要和用户正文零技术字段
- [X] T018 [P] [US3] 扩充 `tests/contract/release-publish.test.ts`，先覆盖审计正文摘要错配、公开正文相同只读跳过、正文偏差零写入冲突、并发公开正文比较及公开后正文复核
- [X] T019 [P] [US3] 扩充 `tests/contract/release-workflow.test.ts`，先固定正文校验发生在远端写入前、技术证据不进入 Release body/附件、四项资产与读写权限边界保持不变

### 实现

- [X] T020 [P] [US3] 在 `scripts/audit-release.mjs` 完成摘要漂移失败、完整 `release-audit.json`、三项宿主覆盖状态及 Actions 技术摘要输出，保持技术证据不进入用户正文
- [X] T021 [P] [US3] 在 `scripts/publish-release.mjs` 复验审计正文结构与原始摘要，公开稳定版本只在规范化正文一致时跳过，正文偏差失败且新发布完成后复核正文
- [X] T022 [US3] 在 `.github/workflows/release.yml` 接入审计摘要输入与 `$GITHUB_STEP_SUMMARY`，确认失败不会进入发布任务且 workflow 不修改、commit 或 push 仓库文档
- [X] T023 [US3] 运行 `npm run test:release`，确认摘要、draft、公开正文、并发、证据隔离和 workflow 失败关闭场景全部通过

**检查点**：三个用户故事全部可独立验收，公开正文、技术证据和远端不可变性职责分离。

---

## 阶段 6：当前意图收敛与完整验证

**目的**：移除旧 SDD 和稳定文档中的冲突要求，保留既有任务历史，并执行完整发布级验证。

- [X] T024 [P] 在 `specs/004-automatic-github-release/spec.md`、`plan.md` 与 `research.md` 中把正文来源收敛为 009 版本化用户说明，把技术证据迁至审计与 Actions，同时保留门禁、资产、权限和 Latest 当前意图
- [X] T025 [P] 在 `specs/004-automatic-github-release/data-model.md`、`contracts/archive-audit.md`、`contracts/release-lifecycle.md`、`quickstart.md` 与 `checklists/requirements.md` 中同步正文身份、审计输出和公开正文一致性，保持 `specs/004-automatic-github-release/tasks.md` 全部任务、编号和 `[X]` 状态不变
- [X] T026 [P] 在 `specs/006-sponsor-entry/spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/sponsor-entry.md` 与 `quickstart.md` 中移除 Release 打赏入口要求，只保留 README、二维码、Sponsor 与 Ko-fi 当前意图，保持 `specs/006-sponsor-entry/tasks.md` 全部任务、编号和 `[X]` 状态不变
- [X] T027 [P] 在 `docs/validation/package.md` 把 `docs/releases/vX.Y.Z.md` 定义为用户正文来源，把安装包、门禁、归档、helper、FFmpeg 和宿主覆盖状态定义为校验文件、`release-audit.json`、Actions 摘要与日志中的技术证据
- [X] T028 按 `specs/009-versioned-release-notes/quickstart.md` 搜索非任务产物中的旧正文/打赏要求，运行 `git diff -- specs/004-automatic-github-release/tasks.md specs/006-sponsor-entry/tasks.md` 和 `git diff --check`，确认旧任务清单未改且当前意图一致
- [X] T029 依次运行 `npm run test:release`、`npm run test`、`npm run typecheck`、`npm run lint` 与 `npm run format:check`，修复失败后在 `specs/009-versioned-release-notes/tasks.md` 标记对应已验收任务
- [X] T030 严格按 `specs/009-versioned-release-notes/quickstart.md` 依次运行 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack` 和最终归档审计，确认正文副本、技术证据与四项公开资产契约
- [X] T031 完成 `specs/009-versioned-release-notes/quickstart.md` 的开发者单人验收，确认未执行远端 Release 写入，IINA 图形界面安装、卸载和实际播放仍记录为 CI 未覆盖

---

## 依赖与执行顺序

### 阶段依赖

- **准备（阶段 1）**：无依赖，可立即开始。
- **共享基础（阶段 2）**：依赖 T001，完成后才可开始用户故事。
- **用户故事 1（阶段 3）**：依赖 T002–T003，不依赖 US2 或 US3，是建议 MVP。
- **用户故事 2（阶段 4）**：依赖 T002–T003；行为上可独立于 US1，但与其共享热点文件，单 worktree 中应按编号顺序执行。
- **用户故事 3（阶段 5）**：发布器子任务只依赖共享基础；审计副本和 workflow 集成依赖 US1 的 T008–T009，不依赖 US2。
- **当前意图收敛与完整验证（阶段 6）**：依赖所有目标用户故事完成。

### 用户故事依赖图

```text
T001 -> T002 -> T003
                  ├─> US1 (T004–T010) ─┐
                  ├─> US2 (T011–T016)  ├─> 阶段 6
                  └─> US3 tests        │
US1 T008–T009 ───────> US3 integration (T020–T023)
```

### 故事内顺序

- 测试任务必须先完成并确认新增断言失败，再执行对应实现任务。
- US1：T004–T006 → T007–T008 → T009 → T010。
- US2：T011–T012 → T013 → T014；T015 可与测试任务并行；最后执行 T016。
- US3：T017–T019 → T020–T021 → T022 → T023。
- 阶段 6 的 SDD 文档任务可并行，所有代码与文档稳定后再执行 T028–T031。

## 并行执行示例与所有权

并行任务必须使用隔离 worktree；每项委派只允许修改下表文件，并以对应聚焦测试或文档检查作为完成条件。

| 并行组 | 任务 | 独占文件 | 完成条件 |
| --- | --- | --- | --- |
| US1 测试 | T004、T005、T006 | 三个不同的 `tests/contract/release-*.test.ts` | 各自新增断言可稳定失败，且未修改实现文件。 |
| US1 实现 | T007、T008 | `scripts/release-metadata.mjs`、`scripts/audit-release.mjs` | 各自聚焦测试通过，接口与正文传递契约一致。 |
| US2 测试/文档 | T011、T012、T015 | `release-notes.test.ts`、`release-metadata.test.ts`、`development.md` | 严格语法与元数据失败断言已建立，文档只引用不重复。 |
| US3 测试 | T017、T018、T019 | audit、publish、workflow 三个测试文件 | 摘要、正文冲突和 workflow 失败关闭断言可稳定失败。 |
| US3 实现 | T020、T021 | `scripts/audit-release.mjs`、`scripts/publish-release.mjs` | 两组聚焦测试分别通过，无远端写入。 |
| SDD 收敛 | T024、T025、T026、T027 | 004 分片、006 分片、`package.md` 互不重叠 | 非任务产物只描述当前意图，004/006 的 `tasks.md` 无 diff。 |

`scripts/release-notes.mjs`、`scripts/release-metadata.mjs`、`scripts/audit-release.mjs`、`.github/workflows/release.yml` 及其各自测试是热点文件；同一文件的多次任务必须由同一负责人顺序执行或事先规定合并顺序。

## 实现策略

### MVP 优先

1. 完成阶段 1–2。
2. 完成 US1 的 T004–T010。
3. 停止并运行 US1 独立测试，确认 GitHub Release body 已从技术证据页切换为版本化用户说明。
4. 未获得用户明确发布授权时，不执行真实 GitHub Release 创建、恢复或修改。

### 增量交付

1. **US1**：建立用户可读正文的正向发布链路。
2. **US2**：补全严格格式、版本唯一性和规格驱动的发布准备边界。
3. **US3**：补全摘要防漂移、远端正文冲突和技术证据独立保存。
4. **阶段 6**：收敛当前文档并执行完整发布级验证。

## 完成条件

- 31 个任务全部保留唯一 ID、checkbox、适用故事标签和明确文件路径，并在实际验收后标记 `[X]`。
- 每个用户故事的测试任务先失败后通过，`npm run test:release` 与完整项目检查全部通过。
- 八项发布门禁和最终归档审计按固定顺序通过；`.iinaplgz` 与四项公开资产契约不变。
- GitHub Release 正文只来自对应版本化用户说明；技术证据完整保留且不进入正文。
- 实现阶段不创建、恢复或修改任何远端 Release；真实发布仍需用户另行明确授权目标版本和规格。
