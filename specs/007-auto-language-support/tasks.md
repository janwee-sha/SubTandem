# 任务：字幕语言自动识别、目标语言扩展与偏好持久化

**输入**：`specs/007-auto-language-support/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**测试要求**：规格明确要求自动化回归、冻结语料指标和正式包人工验收，因此各用户故事先建立会失败的生产接口测试，再实施对应行为。

**组织方式**：任务按用户故事分组；`[P]` 仅表示该任务与同批任务不存在未完成依赖且不修改相同文件。

## 阶段 1：准备

**目的**：固定离线识别依赖、验收语料与分发合规边界。

- [X] T001 在 `package.json` 与 `package-lock.json` 精确锁定 `franc-min@6.2.0`，确认其完整依赖闭包可由 Parcel 静态打入 Main bundle
- [X] T002 [P] 在 `tests/fixtures/languages/calibration.json` 与 `tests/fixtures/languages/acceptance.json` 建立来源隔离的冻结语料，覆盖至少 20 种文字或语系、每种至少 20 条自然字幕 cue，并包含元数据冲突、简繁中文、相近语言、混合语言与不受支持文字
- [X] T003 根据 `package-lock.json` 的实际生产依赖闭包，在 `THIRD_PARTY_NOTICES.txt` 补充 `franc-min` 及其传递依赖的许可声明

---

## 阶段 2：共享基础

**目的**：建立三个用户故事共同依赖的目标语言身份、规范化与等价规则。

**门禁**：本阶段完成前不得开始用户故事实现。

- [X] T004 [P] 在 `tests/unit/target-languages.test.ts` 先编写失败测试，校验目录恰好 156 项且顺序、ID、英文名称、Provider label 唯一，并固定 `zh-Hans`、`zh-Hant`、`pt`、`pt-PT`、`gaa`、`kri` 与 detector code 映射
- [X] T005 [P] 在 `tests/unit/language.test.ts` 先改写失败测试，覆盖 `iw→he`、`in→id`、`ji→yi` 规范化以及通用目标、显式 script、显式 region 的等价矩阵，并删除 manual/track source 解析预期
- [X] T006 按 `specs/007-auto-language-support/contracts/language-catalog.md` 在 `src/domain/target-languages.ts` 实现唯一只读目录、成员校验、detector code 映射与固定 Provider label 派生
- [X] T007 在 `src/domain/language.ts` 移除 `LanguageOrigin` 与 `resolveSourceLanguage`，实现旧别名规范化及由目标目录策略驱动的语言等价判断，使 T005 通过

**检查点**：目标语言身份与翻译等价规则可由生产模块直接复用。

---

## 阶段 3：用户故事 1——无需配置即可识别字幕语言（P1）🎯 MVP

**目标**：正文充足时自动识别字幕主要语言；正文识别成为 Provider 请求前的强制门禁，轨道元数据和旧手动设置均不能决定翻译方向。

**独立测试**：分别载入元数据正确、缺失和错误的正文充足字幕，确认无需源语言控件或确认动作即可按正文方向翻译；当识别语言与目标等价时 Provider 调用为 0。

### 测试

- [X] T008 [P] [US1] 在 `tests/unit/language-detection.test.ts` 先编写失败测试，覆盖四等分确定性取样、空白/数字/符号/URL/重复行过滤、64 cue/4,000 字上限、12 cue/200 字下限、窗口一致性、80% 支持率与 0.12 分差门禁
- [X] T009 [P] [US1] 在 `tests/contract/ui-messages.test.ts` 先编写失败测试，要求语言保存 payload 不能包含 `sourceLanguage` 或 `sourceLanguageMode`，会话状态只公开安全语言 ID 与固定检测/无需翻译状态
- [X] T010 [P] [US1] 在 `tests/integration/auto-language-support.test.ts` 先编写失败测试，覆盖外挂与内嵌文本字幕在元数据正确、缺失和冲突时均以正文识别结果门控 Provider，并验证同语言零调用与旧手动偏好零影响
- [X] T011 [P] [US1] 在 `tests/integration/progressive-translation.test.ts`、`tests/integration/overlay-lifecycle.test.ts`、`tests/integration/embedded-subtitle.test.ts` 与 `tests/integration/us1-playback.test.ts` 先迁移控制器场景，使翻译、缓存和 overlay 断言等待可靠正文识别而不注入源语言
- [X] T012 [P] [US1] 在 `tests/contract/openai.test.ts` 与 `tests/contract/ollama.test.ts` 先编写失败测试，确认 Provider prompt 使用目录派生的 `English Name [id]`，请求仍只传稳定语言 ID

### 实现

- [X] T013 [P] [US1] 按 `specs/007-auto-language-support/contracts/language-detection.md` 在 `src/subtitles/language-detection.ts` 实现有界采样、script 预判、`franc-min` 分类、detector code 映射与可靠结果判定，且不输出样本、候选、分数或异常文本
- [X] T014 [P] [US1] 在 `src/subtitles/types.ts` 与 `src/subtitles/source.ts` 将轨道语言降为非权威元数据，删除 manual origin，并为外挂和内嵌文本字幕统一提供 cues、`contentHash` 与源身份
- [X] T015 [US1] 在 `src/app/language-detection.ts` 实现逐窗口 detection attempt 协调器，绑定 `playerId + mediaEpoch + trackIdentity + contentHash + attemptId`，分四片让出事件循环并执行 500 ms 期限
- [X] T016 [P] [US1] 在 `src/domain/status.ts` 与 `src/domain/messages.ts` 加入 `detectingLanguage`、`languageUnrecognized`、`languageUnsupported`、`noTranslationNeeded` 安全状态，移除 `waitingForLanguage`、`nativeNoTranslation` 与 `CONFIRM_SOURCE_LANGUAGE`
- [X] T017 [US1] 在 `src/app/controller.ts` 接入检测结果和翻译决策，只允许可靠且与目标不等价的结果建立 Provider 请求，并以 `setTargetLanguage` 替换 `setLanguages`
- [X] T018 [US1] 在 `src/main.ts` 将外挂和内嵌文本字幕接入同一检测协调器，删除旧源语言偏好读取、manual override 与 Sidebar source-language 状态，并在换轨、换片、正文 hash 变化、禁用和关窗时失效 attempt
- [X] T019 [P] [US1] 在 `src/app/request-builder.ts`、`src/providers/openai.ts` 与 `src/providers/ollama.ts` 从生产目录派生 source/target Provider label，同时保持消息与缓存中的稳定 ID 不变
- [X] T020 [US1] 在 `ui/sidebar.html`、`ui/sidebar.ts` 与 `ui/sidebar.css` 移除手动字幕语言控件和确认提示，并渲染检测中、无需翻译及安全失败状态而不显示分类器、分数或正文

**检查点**：US1 可单独运行；所有 Provider 调用都已通过可靠正文识别和目标等价门禁。

---

## 阶段 4：用户故事 2——保存并恢复目标语言（P2）

**目标**：Sidebar 展示完整目标语言目录，只有 Global 成功完成原子持久化后，发起窗口才提交新目标并清理旧目标工作；重启后恢复最近一次成功值。

**独立测试**：依次保存目录首项、中间项、末项、两个中文和两个葡萄牙语目标，模拟完整退出并重建 Main，确认恢复最近成功值；未保存草稿、写入失败、同步失败和迟到回执均不改变当前会话或持久值。

### 测试

- [X] T021 [P] [US2] 在 `tests/contract/target-language-preferences.test.ts` 与 `tests/contract/global-rpc.test.ts` 先编写失败测试，覆盖严格 envelope、目录校验、Global `set + sync`、缺失态回滚、固定错误、权威 playerId 与请求关联回执
- [X] T022 [P] [US2] 在 `tests/contract/sidebar-form.test.ts` 先编写失败测试，校验唯一 `Target Language`、156 项顺序、dirty 草稿、单 pending、poll 不覆盖草稿、关闭重开恢复 committed 值及成功/失败反馈
- [X] T023 [P] [US2] 在 `tests/integration/auto-language-support.test.ts` 先追加失败测试，覆盖有效/缺失/非法偏好初始化、连续保存、Global 成功前不切换、失败保持旧上下文、成功清除旧目标请求/缓存/overlay 以及多窗口会话快照

### 实现

- [X] T024 [P] [US2] 在 `src/adapters/iina/target-language-preferences.ts` 封装同步读取、目录校验、内存默认、`set + sync` 原子写入、旧值/缺失态回滚及 property-list 安全的旧源语言键清理
- [X] T025 [P] [US2] 在 `src/domain/messages.ts` 实现 `defaults:save`、`defaults:saved`、`operation:error` 与 `operation:result` 的严格语言消息解析，拒绝附加字段、非法目标、错误 revision 和不匹配 requestId
- [X] T026 [US2] 在 `src/global.ts` 使用偏好 adapter 成为 `targetLanguage` 唯一写入者，初始化时有界清空 `sourceLanguage`/`sourceLanguageMode`，并仅在 `set + sync` 成功后向 IINA 提供的发起窗口回执
- [X] T027 [US2] 在 `src/main.ts` 创建 Controller 前恢复有效偏好或内存默认 `zh-Hans`，通过首次 `state:update` 提供目标目录、committed 值和 revision，维护单一 pending，并仅在匹配 `defaults:saved` 后提交当前窗口且忽略未知或迟到回执
- [X] T028 [P] [US2] 在 `src/app/controller.ts` 完成 `setTargetLanguage` 提交语义：取消 Provider/重试、递增 session epoch、清译文/失败/错误/缓存/overlay，同时保留当前字幕源和可靠识别结果并重新门控
- [X] T029 [P] [US2] 在 `ui/sidebar.html` 与 `ui/sidebar.ts` 从 Main 的 `state:update` 生产目录数据渲染 156 项 `Target Language`，实现 committed/draft/dirty/pending 状态、保存期间防重复提交及请求关联反馈

**检查点**：US2 可独立验证目标目录、保存原子性、当前窗口切换与跨 IINA 会话恢复。

---

## 阶段 5：用户故事 3——识别失败时保持播放安全（P3）

**目标**：样本不足、混合、低置信、不受支持、超时或生命周期失效时失败关闭，原视频和原字幕继续播放，且无错误方向外发或迟到写入。

**独立测试**：使用空白、符号、极短、2/2 与 3/1 混合、相近语言及不受支持文字字幕，并在识别期间换轨、换片、改正文、seek、禁用、关窗和双窗口并发；确认状态可区分、Provider 调用为 0、播放不中断且迟到写入为 0。

### 测试

- [X] T030 [P] [US3] 在 `tests/unit/language-detection.test.ts` 先追加失败测试，覆盖 unknown/unsupported、共享文字不可唯一映射、保守 `zh`、简繁证据、2/2 与 3/1 混合、超时和分类异常失败关闭
- [X] T031 [P] [US3] 在 `tests/integration/auto-language-support.test.ts` 先追加失败测试，覆盖换轨、换片、正文 hash、禁用、关窗、seek 与双窗口的 attempt 失效和迟到拒绝，并断言失败场景 Provider 调用为 0
- [X] T032 [P] [US3] 在 `tests/integration/acceptance-metrics.test.ts` 与 `tests/integration/performance.test.ts` 接入冻结 acceptance 语料和最大样本基准，先建立 ≥95% 正确可靠、≤1% 误可靠、元数据冲突 ≥95%、首次/热 p95 与同步分片 p99 门禁
- [X] T033 [P] [US3] 在 `tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts` 先追加失败测试，确保偏好、消息、诊断和错误不包含字幕正文、识别样本、译文、文件路径、旧源语言值、候选分数或凭据

### 实现

- [X] T034 [US3] 在 `src/subtitles/language-detection.ts` 完成不受支持 script、混合/相关语言竞争、保守中文与超时/异常路径，使所有失败均返回最小 `unknown` 或 `unsupported` 结果
- [X] T035 [US3] 在 `src/app/language-detection.ts` 为每个分片继续前和最终提交前校验完整 attempt 身份，确保 seek 复用同源结果而其他生命周期事件不可恢复旧 attempt
- [X] T036 [US3] 在 `src/app/controller.ts` 与 `src/main.ts` 完成失败关闭和迟到拒绝集成，保证检测失败只更新安全状态，不暂停原播放、不建立 Provider 请求且不污染新会话缓存或 overlay
- [X] T037 [US3] 在 `ui/sidebar.ts` 将 unknown、unsupported 与 no-translation-needed 映射为契约规定的固定英文文案，并保证 WebView 重载或迟到消息不能覆盖新草稿和新会话状态

**检查点**：三个用户故事均可按各自独立测试执行，失败路径保持零外发和播放安全。

---

## 阶段 6：收尾与跨领域门禁

**目的**：验证完整回归、静态交付、包体边界与正式 IINA 宿主行为。

- [X] T038 按 `specs/007-auto-language-support/quickstart.md` 运行四组聚焦 Vitest 命令，并修正 `tests/unit/`、`tests/contract/`、`tests/integration/` 与 `tests/security/` 中所有失败直至通过
- [X] T039 通过 `package.json` 依次运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native` 与 `npm run build`，确认生产代码无新增注释且生产自然语言仅使用英语
- [X] T040 运行 `scripts/verify-package.sh` 与 `scripts/pack.sh`，审计 `dist/main.js` 和 `build/package/SubTandem-0.1.0.iinaplgz` 已静态包含分类器、无 `node_modules`/模型/WASM/native module/新权限，且 bundle 增量 ≤1 MiB、包增量 ≤500 KiB
- [x] T041 由开发者按 `specs/007-auto-language-support/quickstart.md` 的 10 步清单使用同一个 `build/package/SubTandem-0.1.0.iinaplgz` 完成 IINA 1.4.0+ 正式包人工验收，并仅记录允许的包 hash、环境、样本 ID、聚合指标、耗时、调用计数与通过/失败

---

## 依赖与执行顺序

### 阶段依赖

- 阶段 1 无前置依赖；T002 可与 T001 并行，T003 在 T001 后按实际 lock 闭包完成。
- 阶段 2 依赖阶段 1，并阻塞所有用户故事实现；T004 与 T005 可并行，T006/T007 分别使对应失败测试通过。
- US1 与 US2 在共享基础完成后均可开始测试，但二者都会修改 `src/main.ts`、`src/domain/messages.ts` 和 Sidebar 热点文件；单 worktree 中按 US1→US2 合并，若并行则必须使用隔离 worktree，并按同一顺序解决共享文件。
- US3 的实现依赖 US1 的检测器和 attempt 协调器；不依赖 US2 的持久化完成，但最终集成必须使用已提交的目标语言语义。
- 阶段 6 依赖计划交付的全部用户故事完成；T038→T039→T040→T041 顺序执行。

### 用户故事依赖

- **US1（P1）**：共享基础完成后开始，无其他故事依赖，是建议 MVP。
- **US2（P2）**：共享基础完成后可建立测试和偏好 adapter；对共享文件的实现按 US1 后合并，行为可单独验收。
- **US3（P3）**：依赖 US1 的可靠识别主路径，独立验证所有失败关闭和生命周期场景。

### 故事内顺序

- 每个故事先完成其“测试”任务并确认测试因缺失产品行为失败，再开始“实现”任务。
- 纯 domain/subtitles 实现先于 app 协调与 Controller 集成；跨运行时消息契约先于 Main/Global/Sidebar 接线。
- 每个故事到达检查点并通过独立测试后，才进入下一优先级的共享文件编辑。

## 并行执行示例

### US1

```text
并行：T008、T009、T010、T011、T012
并行：T013、T014、T016、T019
顺序：T015 → T017 → T018 → T020
```

### US2

```text
并行：T021、T022、T023
并行：T024、T025、T028、T029
顺序：T026 → T027；随后合并 T028、T029 并运行 US2 独立测试
```

### US3

```text
并行：T030、T031、T032、T033
顺序：T034 → T035 → T036 → T037
```

## 实施策略

### MVP 优先

1. 完成阶段 1 与阶段 2。
2. 完成 US1 的失败测试、实现和独立验收。
3. 停止并确认正文识别、同语言零调用和无手动源语言路径均成立。

### 增量交付

1. US1 交付自动识别与翻译门禁。
2. US2 交付完整目标目录、原子保存和恢复。
3. US3 收紧失败关闭、生命周期、准确率、性能与隐私门禁。
4. 最后执行完整构建、正式打包和 IINA 人工验收。

## 说明

- 所有自动化测试必须直接调用或检查生产实现与正式交付接口，不得把 SDD 文案或文件存在性当作产品契约。
- 生产代码不得新增注释；新增用户文案、标识符和逻辑自然语言使用英语。
- 任何准确率、性能、生命周期、隐私或包体门禁失败都必须停止发布，不得以轨道元数据兜底、降低可靠阈值或扩大字幕外发。
- T041 在开发者实际完成正式包宿主验收前保持未勾选。
