# 实现任务：Provider 连接生命周期

**输入**：`spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`
**测试策略**：所有行为变更均先写失败回归，再实现并运行聚焦验证；任务完成状态以复选框记录。
**组织方式**：按用户故事排序；共享热点文件由后续任务串行接管。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：仅表示与同阶段其他已标记任务修改不同文件，且不依赖尚未完成的同级任务。
- **[US1]–[US3]**：对应 [spec.md](./spec.md) 中的三个用户故事。
- 并行 Agent 必须使用隔离 worktree；`src/global.ts`、`src/providers/connection-tests.ts` 与 native 生命周期文件按下列顺序单负责人修改。

## 阶段 1：共享测试准备

**目的**：提供可重复的当前服务状态、请求计数和并发门控夹具，不改变生产行为。

- [X] T001 在 `tests/helpers/provider-server.ts` 增加可切换成功/429、请求计数、阻塞与释放的本地 Provider 测试能力，并保证记录不包含凭据、字幕或完整请求正文（支撑 FR-007–FR-010、SC-003）

**检查点**：后续 Provider 与集成测试可确定地制造“已缓存 capability 后当前返回 429”和并发任务场景。

---

## 阶段 2：基础前置

现有 native helper、Provider transport、Global RPC 和测试框架已经满足前置条件，无需新增项目初始化或共享生产基础设施。每个用户故事直接从失败测试开始。

---

## 阶段 3：用户故事 1——长视频翻译持续可用（优先级：P1）🎯 MVP

**目标**：两条网络路径在 helper 生命周期内共用 host 门控并复用有限连接，每 host 最多 4 个请求；OpenAI-compatible Profile 的连续调用复用一个运行期会话身份，同时保持任务级取消、系统路径重定向和 `direct` no-proxy 行为。

**独立测试**：运行 native 契约测试，证明两条路径超过 4 个同 host 请求都会在传输层外显式排队；25 次连续 `direct` 请求复用同一连接，取消/重定向只影响目标 job，关闭释放资源，`direct` 仍走 libcurl no-proxy。

### 先写失败测试

- [X] T002 [P] [US1] 在 `native/transport/Tests/SubTandemTransportTests/HTTPClientTests.swift` 增加共享系统会话、两条路径每 host 最大 4 个活动请求、25 次 `direct` 请求连接复用、排队取消、完成/取消竞争、任务级重定向和 no-proxy 边界的失败回归（FR-001–FR-004、FR-006、SC-002、SC-007）
- [X] T003 [P] [US1] 在 `native/transport/Tests/SubTandemTransportTests/ServerTests.swift` 增加关闭开始后拒绝新请求、活动请求唯一终态、重复关闭幂等和迟到回调无效的失败回归（FR-005、SC-005）

### 实现

- [X] T004 [US1] 在 `native/transport/Sources/SubTandemTransport/HTTPClient.swift` 和 `DirectCurlTransport.swift` 实现 helper 级共享系统代理会话、两条路径共用的每 host 最多 4 个活动请求门控、`direct` 有界 easy handle 与连接复用、按任务重定向状态、精确活动 job 清理和幂等关闭（依赖 T002、T003）
- [X] T005 [US1] 在 `native/transport/Sources/SubTandemTransport/Protocol.swift` 将现有 `/v1/shutdown` 编排接入 `HTTPClient` 关闭，并保持 RPC 路径、字段与错误码不变（依赖 T004）
- [X] T006 [US1] 运行 `npm run test:native`，确认 `native/transport/Tests/SubTandemTransportTests/HTTPClientTests.swift` 与 `ServerTests.swift` 全部通过且覆盖 FR-001–FR-006（依赖 T004、T005）
- [X] T026 [US1] 在 `tests/contract/openai.test.ts` 先增加同一 Provider 的连续 Test/翻译使用相同 `X-Session-Id` 的失败回归，再在 `src/providers/openai.ts` 与 `src/global.ts` 注入每实例运行期身份，保持 2 cue/wire、渐进输出和消息结构不变（FR-013–FR-015、SC-006–SC-007）

**检查点**：US1 可独立交付；两条路径的连接总量不再随请求数累积，`direct` no-proxy 与 helper RPC 均未改变。

---

## 阶段 4：用户故事 2——Profile Test 反映当前服务状态（优先级：P2）

**目标**：每次 Test 都以唯一身份真实联网，缓存 capability 仅作为请求格式选择，当前 429 等错误不能假成功，播放选择保持不变。

**独立测试**：先缓存 capability，再把测试服务切到 429 并重复 Test；每次调用的请求计数至少增加 1，结果为配额错误，消息和当前选择不变。

### 先写失败测试

- [X] T007 [P] [US2] 在 `tests/contract/openai.test.ts` 增加已缓存 capability 仍真实请求、连续 Test 使用不同 job、429 不 fallback 且不泄漏原始错误的失败契约测试（FR-007–FR-009、SC-003）
- [X] T008 [P] [US2] 在 `tests/contract/ollama.test.ts` 增加每次 Test 重新检查服务/模型/结构化响应，以及按 testId 精确取消的失败契约测试（FR-007、FR-009–FR-010）
- [X] T009 [P] [US2] 新建 `tests/contract/provider-connection-tests.test.ts`，先覆盖外部 request ID 碰撞、同一 Provider 并发 Test、唯一内部身份、完成只清理自身和不创建播放选择的失败测试（FR-007、FR-010–FR-011、SC-004）

### 实现

- [X] T010 [US2] 在 `src/providers/provider.ts` 定义独立 `ProviderConnectionTester.testConnection(testId)` 与 Global 配置 Provider 的组合类型，保持基础 `TranslationProvider`、`attempt`、进度和取消签名不变（依赖 T007–T009）
- [X] T011 [P] [US2] 在 `src/providers/openai.ts` 实现每次真实联网的 `testConnection`，以 testId 命名测试子请求，已知 capability 仍验证一次且非兼容性错误立即终结（依赖 T010）
- [X] T012 [P] [US2] 在 `src/providers/ollama.ts` 实现按 testId 隔离的真实服务、模型和结构化响应检查，并收紧测试子请求取消范围（依赖 T010）
- [X] T013 [US2] 新建 `src/providers/connection-tests.ts`，登记权威 player ID、外部 request ID、内部 testId、Profile revision 和 Provider，使并发完成只清理匹配任务（依赖 T010–T012）
- [X] T014 [US2] 在 `src/global.ts` 将 `provider:test` 切换到连接测试注册表和 `testConnection`，生成内部唯一 testId，并保持 `provider:test`/`provider:test-result` 字段及 Test/Select 独立语义不变（依赖 T013）
- [X] T015 [US2] 运行 `npx vitest run tests/contract/openai.test.ts tests/contract/ollama.test.ts tests/contract/provider-connection-tests.test.ts tests/contract/ui-messages.test.ts`，确认 FR-007–FR-012 与 SC-003 通过（依赖 T014）

**检查点**：US2 可独立验证；历史 capability 不会跳过当前联网检查，Test 不改变播放选择或消息结构。

---

## 阶段 5：用户故事 3——生命周期操作继续互相隔离（优先级：P3）

**目标**：把 US1/US2 的共享资源纳入既有多窗口、Profile 删除、取消和 helper 生命周期边界，不产生跨任务结果或迟到写入。

**独立测试**：两个窗口使用相同外部 request ID 并发翻译和 Test；删除一个 Profile 或取消一个请求后，其他窗口继续完成，helper 关闭后无新工作或迟到终态。

### 先写失败测试

- [X] T016 [P] [US3] 新建 `tests/integration/provider-connection-lifecycle.test.ts`，增加双窗口同 ID、翻译与 Test 并发、Profile 删除精确取消、迟到结果丢弃和 helper 关闭隔离回归（FR-003、FR-005、FR-010、SC-004–SC-005）
- [X] T017 [P] [US3] 在 `tests/contract/global-rpc.test.ts` 增加连接测试跨窗口身份回归，并在 `tests/contract/ui-messages.test.ts` 固定 Global/Main/Sidebar 既有 Test 消息结构（FR-011–FR-012、SC-004、SC-007）

### 实现与集成

- [X] T018 [US3] 在 `src/providers/connection-tests.ts` 实现按 testId、Profile 和全局范围的幂等完成/取消，确保相同 Provider 或外部 request ID 不会覆盖其他活动测试（依赖 T016、T017）
- [X] T019 [US3] 在 `src/global.ts` 用连接测试注册表替换按 Provider 对象和固定 `provider-test` 标签的宽泛取消，使 Profile 删除与全局清理只作用于目标任务，并保持既有翻译 broker 多窗口隔离（依赖 T018）
- [X] T020 [US3] 运行 `npx vitest run tests/integration/provider-connection-lifecycle.test.ts tests/contract/global-rpc.test.ts tests/contract/ui-messages.test.ts tests/integration/us3-providers.test.ts` 和 `npm run test:native`，确认跨窗口结果、误取消与迟到终态均为 0（依赖 T019）

**检查点**：三个用户故事共同通过；共享会话和共享 Provider 不会共享任务终态或窗口状态。

---

## 阶段 6：完整验证、正式包验收与问题关闭

**目的**：验证所有不变边界，在正式包上完成实机标准，并只在证据完整后关闭 Bug。

- [X] T021 依照 `specs/003-provider-connection-lifecycle/quickstart.md` 运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:native`、`npm run build` 和 `npm run verify:package`，确认 FR-012–FR-015、SC-006–SC-007 及全部回归通过
- [X] T022 使用 `scripts/pack.sh` 和 `scripts/verify-package.sh` 生成并校验正式可卸载包，在 `docs/validation/package.md` 记录版本/哈希、双架构、权限、签名和最小包内容证据，不记录敏感数据
- [X] T023 按 `specs/003-provider-connection-lifecycle/quickstart.md` 在 IINA 1.4+ 正式安装包中完成至少 100 cue 或 5 分钟远程 OpenAI-compatible `direct` 翻译、双窗口隔离和缓存 capability 后当前 429 Test，并在 `docs/validation/iina-matrix.md` 只记录允许的环境与结论（SC-001、SC-003–SC-007）
- [X] T024 仅在 T021–T023 全部通过且连接耗尽、Test 假成功和跨窗口回归均为 0 后，依据 `docs/validation/iina-matrix.md` 中的 003 验收证据关闭对应 Bug；任何未完成实机项都必须保持该 Bug 未关闭
- [X] T025 实现收敛后保留完整任务清单，以复选框记录完成状态，并再次执行只读一致性分析

---

## 依赖与执行顺序

### 阶段依赖

- **阶段 1**：无依赖。
- **阶段 2**：确认无需新增共享前置代码。
- **US1**：可在 T001 后独立开始；T002/T003 先于 T004/T005，T006 收敛该故事。
- **US2**：依赖 T001；T007–T009 先行，T010 后 T011/T012 可并行，随后 T013→T014→T015。
- **US3**：依赖 US1 与 US2 的实现；T016/T017 先行，随后 T018→T019→T020。
- **阶段 6**：依赖三个故事及 T026 的聚焦验证全部通过；T024 严格依赖 T021、T022、T023。

### 用户故事依赖图

```text
T001
├── US1 (T002–T006、T026) ─┐
└── US2 (T007–T015) ─┴─> US3 (T016–T020) -> 完整验证与关闭 (T021–T025)
```

- **US1** 是可先交付的 MVP，以跨路径 host 门控、有界连接复用和 OpenAI-compatible 运行期会话复用解决远程连接/网关会话耗尽。
- **US2** 可与 US1 在隔离 worktree 中并行实现，但两者在进入 US3 前必须各自完成聚焦验证。
- **US3** 是跨 native/Global/Provider 的集成保护，必须在两个前置故事合并后执行。

### 并行机会与文件所有权

- T002 与 T003 修改不同 native 测试文件，可并行；T004 开始后 `HTTPClient.swift` 由单一负责人持有。
- T007、T008、T009 修改不同测试文件，可并行；T010 完成后 T011 与 T012 修改不同 Provider 文件，可并行。
- T016 与 T017 修改不同测试文件，可并行。
- `src/global.ts` 只按 T014→T019 的顺序修改；`src/providers/connection-tests.ts` 只按 T013→T018 的顺序修改。
- `docs/validation/package.md`、`docs/validation/iina-matrix.md` 和 Bug 记录均为共享集成文件，阶段 6 串行更新。

## 并行执行示例

### 用户故事 1

```text
任务 A：T002，仅修改 HTTPClientTests.swift
任务 B：T003，仅修改 ServerTests.swift
合并顺序：A/B 完成后由单一负责人执行 T004→T005→T006
```

### 用户故事 2

```text
第一批：T007、T008、T009，各自在隔离 worktree 修改不同测试文件
第二批：T010 合并后并行执行 T011 与 T012
集成顺序：Provider 变更合并后执行 T013→T014→T015
```

### 用户故事 3

```text
第一批：T016 与 T017 在隔离 worktree 中并行写失败回归
集成顺序：测试合并后执行 T018→T019→T020
```

## 实现策略

### MVP 优先

1. 完成 T001。
2. 完成 US1 的 T002–T006。
3. 停止并验证 native 聚焦回归；此时核心连接耗尽修复可单独审阅。
4. 再进入真实 Test 与跨生命周期隔离。

### 增量交付

1. US1：共享系统会话、跨路径 host 请求门控与 `direct` 有界连接复用。
2. US2：每次 Test 真实联网与唯一身份。
3. US3：多窗口、Profile 删除、取消和迟到结果集成保护。
4. 完整自动化、正式包、IINA 实机、Bug 关闭和 SDD 收敛。

## 完成条件

- 26 个任务均符合 checkbox、唯一 ID、故事标签和明确文件路径格式。
- 所有行为变更均有先行失败测试，且聚焦与完整命令均通过。
- 正式包连续处理至少 100 cue 或播放 5 分钟，第二字幕持续输出且连接或网关会话耗尽为 0。
- capability 已缓存后当前 429 的 Test 真实联网并报告配额错误，假成功为 0。
- 多窗口、单项取消、Profile 删除和 helper 关闭没有跨任务结果或迟到写入。
- Bug 只在自动化、包校验和实机证据全部完成后关闭；`tasks.md` 保留完整任务并以复选框记录完成状态。
