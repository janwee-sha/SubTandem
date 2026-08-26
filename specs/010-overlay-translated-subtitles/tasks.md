# 任务：覆盖层译文渲染

**输入**：`specs/010-overlay-translated-subtitles/` 下的规格、计划、研究、数据模型、覆盖层契约与验证指南。

**测试要求**：规格和项目宪法要求自动化回归、正式包审计与 IINA 实机验收。测试任务必须先编写并确认在对应实现前失败；不得通过解析 README、SDD 文档或人工清单建立文案测试。

**格式**：`[ID] [P?] [Story?] 描述与精确文件路径`

- **[P]**：依赖已满足后，可与同阶段其他 `[P]` 任务并行；并行 Agent 必须使用隔离 worktree，且不得同时修改同一文件。
- **[US1] / [US2] / [US3]**：对应规格中的用户故事。

## 阶段 1：准备共享测试基座

**目的**：让覆盖层命令、异常、播放器实例和宿主事件能够通过生产接口接受自动化验证。

- [X] T001 扩展 `tests/helpers/fake-iina.ts`，为每个 Fake 播放器提供相互隔离的 MPV 命令历史、属性读写、同步命令异常注入和事件注册/触发能力，同时保持现有测试兼容

---

## 阶段 2：基础能力

**目的**：先建立所有用户故事共用的当前译文选择与 IINA 覆盖层适配器；本阶段完成前不得开始用户故事实现。

### 测试

- [X] T002 [P] 在 `tests/unit/translation-overlay.test.ts` 添加失败中的生产单元测试，覆盖 `[startMs, endMs)`、零时长、未来/过期 cue、空译文、重叠 cue 源顺序、语义换行及 ASS `{`、反斜杠控制序列、CRLF、行首空格、NUL 和 Unicode 转义
- [X] T003 [P] 用 `tests/integration/subtitle-overlay.test.ts` 替换 `tests/integration/subtitle-track.test.ts`，添加失败中的生产适配器测试，覆盖固定 overlay ID、show/replace/remove 参数、重复 show/clear 去重、异常重试、双播放器隔离，并断言无轨道命令、字幕选择写入或译文临时文件

### 实现

- [X] T004 [P] 实现 `src/subtitles/active-translations.ts` 的当前译文选择函数，只返回当前位置命中的已验证译文并保持源 cue 顺序
- [X] T005 [P] 实现 `src/adapters/iina/subtitle-overlay.ts` 的同步 `IinaTranslationOverlay` 与最小 MPV port，按契约生成单一 ASS 事件、复用自有稳定 ID、提交成功后去重并幂等清理

**检查点**：T002–T003 从失败变为通过，基础 API 不包含 SRT、轨道 ID、文件路径、Profile 或 Provider 状态。

---

## 阶段 3：用户故事 1——无轨道切换地观看译文（P1）🎯 MVP

**目标**：译文由逐窗口覆盖层显示，原主字幕和第二字幕选择不变，不再创建、选择、重载或删除译文字幕轨。

**独立测试**：使用生产 controller、IINA adapter 和正式包连续处理当前 cue；自动化证明只显示当前译文且无旧轨道操作，随后在当前 IINA 1.4.4 完成 show/replace/remove 与宿主日志阻断预检。

### 测试

- [X] T006 [P] [US1] 将 `tests/integration/us1-playback.test.ts` 改为 `TranslationOverlaySink` 语义，按 cue 时段推进位置并覆盖当前译文、无占位、覆盖层异常不阻塞、禁用/换源清理和双窗口内容隔离
- [X] T007 [P] [US1] 将 `tests/integration/progressive-translation.test.ts` 改为当前位置覆盖层语义，覆盖首个有效 progress 立即显示、未来结果不提前显示、Provider in-flight 期间继续切换/清理、缓存保留和无异步 SRT publication 队列
- [X] T008 [P] [US1] 将 `tests/integration/embedded-subtitle.test.ts`、`tests/integration/performance.test.ts` 与 `tests/integration/us2-cost-privacy.test.ts` 的旧 track mock 和 SRT 断言迁移为纯文本 overlay show/clear 断言，保持原提取、性能和隐私覆盖
- [X] T009 [P] [US1] 更新 `tests/contract/sidebar-lifecycle.test.ts` 的生产入口契约，证明真实 `sid`/track-list 变化仍触发 source reload，而 `generatedTrack` 发布屏蔽、`sub-add`、`sub-remove` 和 `secondary-sid` 路径已不存在
- [X] T010 [P] [US1] 扩展 `tests/contract/package-manifest.test.ts`，通过生产 `Info.json` 验证“自行渲染译文”描述、最小权限集合和不再声明译文临时显示文件

### 实现

- [X] T011 [US1] 在 `src/app/controller.ts` 用同步 `TranslationOverlaySink.show(lines)`/`clear()` 替换 `GeneratedTrackSink`，在 Provider early-return 前及已接受进度/结果后同步当前帧，隔离 overlay 异常，并删除 SRT snapshot、pending publication、swap drain 和 publication idle 状态
- [X] T012 [P] [US1] 在 `src/main.ts` 为每个 `wirePlayer` 注入独立 `IinaTranslationOverlay`，移除生成轨期间的 source reload 屏蔽和过时生成资产说明，并删除 `src/adapters/iina/subtitle-track.ts`，同时保留真实用户换轨的 250 毫秒 settle/retry
- [X] T013 [P] [US1] 从 `src/subtitles/srt.ts` 删除仅用于译文输出的 `renderSrt`、时间格式化和输出转义，从 `src/app/playback-session.ts` 删除无生产用途的 `tempDirectory`，并同步收敛 `tests/unit/srt.test.ts` 与 `tests/unit/playback-session.test.ts`
- [X] T014 [P] [US1] 更新 `Info.json` 的产品描述与 file-system 权限说明为覆盖层自行渲染，移除“second subtitle track”和临时译文显示文件表述，不改变版本、最低 IINA 版本、权限或允许域
- [X] T015 [P] [US1] 将 `README.md`、`docs/readme/README.zh-CN.md`、`docs/readme/README.ar.md`、`docs/readme/README.fr.md`、`docs/readme/README.ja.md`、`docs/readme/README.ko.md` 与 `docs/readme/README.ru.md` 的简介、功能、使用步骤和故障排查统一为“自行渲染译文”，不改写历史 release notes
- [X] T016 [US1] 按 `specs/010-overlay-translated-subtitles/quickstart.md` 运行 US1 聚焦测试、类型检查、lint、构建、包审计和 `npm run pack`，仅在生产 bundle 无旧译文轨道路径且全部命令通过后进入宿主预检
- [X] T017 [US1] 使用 T016 的正式 `.iinaplgz` 在当前 IINA 1.4.4 执行 show/replace/remove 和合成 sentinel 日志阻断预检，并在 `docs/validation/iina-matrix.md` 追加 010 预检行、包 SHA-256、环境与命中计数；任一命令失败或日志命中非 0 时保持本任务未完成并返回 SDD

**检查点**：US1 可独立显示当前位置译文且不触碰字幕轨；T017 是后续实现的阻断门，mock 通过不能替代。

---

## 阶段 4：用户故事 2——清晰一致的默认样式（P2）

**目标**：译文固定为顶部居中、白色、40@720p 等比缩放、透明背景与黑色描边，安全换行且不提供自定义或拖动。

**独立测试**：直接导入生产编码器和适配器，核对全部 ASS 属性、转义矩阵和窗口变化时的命令稳定性；真实视觉与指针行为保留到最终正式包验收。

### 测试

- [X] T018 [P] [US2] 扩展 `tests/unit/translation-overlay.test.ts`，精确断言 `Default` reset、`an8`、自动换行、字号 40、白色、黑色描边、透明背景、单事件无原始换行，以及超高内容不被插件主动省略或缩字
- [X] T019 [P] [US2] 扩展 `tests/integration/subtitle-overlay.test.ts` 与 `tests/contract/sidebar-lifecycle.test.ts`，覆盖 `res_x=0`/`res_y=720`、resize/fullscreen 不重复发送相同正文、不使用 `compute_bounds`，且生产入口不注册覆盖层鼠标或拖动拦截

### 实现

- [X] T020 [US2] 在 `src/adapters/iina/subtitle-overlay.ts` 完成固定 ASS 前缀、mpv 等价文本转义、语义换行/重叠 cue 合并和同内容命令去重，不读取 IINA 字幕偏好、不新增样式设置或输入监听

**检查点**：US2 自动化独立通过；窗口视觉、自然裁切和播放器指针行为仍明确列在最终 IINA 验收中。

---

## 阶段 5：用户故事 3——播放生命周期只显示当前译文（P3）

**目标**：暂停、自然离开、seek、换轨、换片、配置变化、禁用、关窗和多个窗口均只保留所属会话的当前译文。

**独立测试**：用假时钟和两个生产 controller/adapter 实例反复推进位置与失效事件，证明 500 毫秒边界内更新/清理、暂停保持、缓存 seek 重绘和迟到结果拒绝。

### 测试

- [X] T021 [P] [US3] 新建 `tests/integration/overlay-lifecycle.test.ts`，覆盖暂停保持、自然离开 cue 清理、相邻边界不双显、seek 后缓存命中重绘、换轨/换片/配置/禁用/关窗清理和两个窗口互不影响
- [X] T022 [P] [US3] 扩展 `tests/integration/progressive-translation.test.ts`，覆盖请求 in-flight 时位置继续更新、六类失效后的 late progress/result 不恢复显示、show/clear 同步异常后下一 tick 可重试
- [X] T023 [P] [US3] 扩展 `tests/integration/performance.test.ts`，以假时钟验证 350 毫秒 tick 下至少 95% 有效译文在 500 毫秒内出现、100% 过期/失效内容在 500 毫秒内清理，并保持 100 cue 缓存与双窗口边界

### 实现

- [X] T024 [US3] 在 `src/app/controller.ts` 完成所有显示状态转换：暂停保留，空帧、seek、换源、换配置、禁用、end-file 与 close 幂等清理，旧 fingerprint 永不重新 show，失败仅影响所属窗口且后续 tick 可重试
- [X] T025 [US3] 在 `src/main.ts` 完成逐窗口 overlay 生命周期接线，确保 `mpv.seek`、文件事件和 `iina.window-will-close` 先失效再清理，并保持同一播放器上下文关闭后可复用且不清理其他窗口

**检查点**：US3 自动化独立通过，生命周期与多窗口无旧译文、串窗或播放阻塞。

---

## 阶段 6：跨故事收敛与正式验收

**目的**：完成安全、发布包和真实 IINA 行为门禁；全部通过前功能不得视为完成。

- [X] T026 [P] 扩展 `tests/security/redaction.test.ts` 与 `tests/security/credential-leakage.test.ts`，把源字幕、译文、ASS data、媒体路径和 Provider 请求作为输入验证现有诊断 allowlist 与 overlay 失败状态从不输出正文
- [X] T027 收敛 `src/adapters/iina/subtitle-overlay.ts` 与 `src/app/controller.ts` 的失败处理，只保留固定英文状态/错误码，不拼接、记录或向 Sidebar 传播译文、ASS data、路径或命令参数，并使 T026 通过
- [X] T028 [P] 在 `scripts/verify-package.sh` 增加正式 bundle 旧输出路径扫描，并在 `tests/contract/package-manifest.test.ts` 覆盖 `sub-add`、`sub-remove`、`secondary-sid` 和译文 `subtandem-*.srt` 不存在，同时明确允许内嵌原字幕的 `@tmp/subtandem-extraction`
- [X] T029 按 `specs/010-overlay-translated-subtitles/quickstart.md` 依次运行 `npm test`、typecheck、lint、format check、native build/test、plugin build、package verification 与 pack，检查工作树未纳入生成包、缓存或运行时状态
- [X] T030 使用 T029 的同一正式 `.iinaplgz` 完成 `specs/010-overlay-translated-subtitles/quickstart.md` 的 30 分钟/100 cue、轨道零变更、固定样式、20 次窗口变化、各 20 次生命周期、多窗口、指针、IINA OSD、安装卸载和日志 sentinel 验收，并仅将最终包 SHA-256、环境、合成样本 ID、耗时、计数与结果追加到 `docs/validation/iina-matrix.md`

**最终检查点**：自动化、包审计、当前 IINA 1.4.4 宿主兼容与日志安全全部通过，当前产物与实现一致。

---

## 依赖与执行顺序

### 阶段依赖

```text
阶段 1 T001
  -> 阶段 2 T002/T003 -> T004/T005
  -> US1 T006-T010 -> T011 -> T012-T016 -> T017 宿主阻断门
  -> US2 T018/T019 -> T020
  -> US3 T021/T022/T023 -> T024 -> T025
  -> 阶段 6 T026/T028 -> T027 -> T029 -> T030
```

- 阶段 2 阻断全部用户故事。
- US1 必须先完成；T017 未通过时不得开始 US2、US3 或保留第二字幕轨回退。
- US2 与 US3 的代码切片在 T017 通过后可使用隔离 worktree 并行：US2 只拥有 adapter 与样式测试，US3 只拥有 controller/Main 与生命周期测试。集成时先合入 US2，再合入 US3。
- T030 只能针对 T029 产生的同一最终正式包执行，早期预检证据不能替代最终验收。

### 任务级依赖

- T004 依赖 T002；T005 依赖 T001–T003，二者依赖满足后可并行。
- T011 依赖 T004、T006–T008；T012 依赖 T005、T009、T011；T013 依赖 T011；T014 依赖 T010。
- T016 依赖 T006–T015；T017 依赖 T016。
- T020 依赖 T018–T019；T024 依赖 T021–T023；T025 依赖 T024。
- T027 依赖 T026；T029 依赖 T020、T025、T027、T028；T030 依赖 T029。

## 并行执行示例

### US1

T006–T010 与 T015 修改互不重叠的测试/文档文件，可在阶段 2 完成后并行；T011 完成后，T012 与 T013 可分别处理 Main/旧适配器和字幕/session 清理。

### US2

T018 与 T019 可分别负责纯编码单元测试和 IINA 适配器/入口契约测试，完成后由 T020 统一修改 adapter 热点文件。

### US3

T021、T022、T023 可分别负责生命周期、渐进失效和性能时序测试，完成后由 T024 单独修改 controller 热点文件，再由 T025 接入 Main。

## 实施策略

### MVP 优先

1. 完成阶段 1–2。
2. 完成 US1 的 T006–T016。
3. 执行 T017 正式包宿主与日志预检；失败即停止并返工 SDD。
4. T017 通过后，US1 构成可独立验证的 MVP，但完整功能仍需 US2、US3 和最终门禁。

### 增量交付

1. US1 消除轨道副作用并证明宿主命令/日志边界。
2. US2 固定视觉与安全文本编码。
3. US3 收敛位置驱动、失效和多窗口生命周期。
4. 阶段 6 对最终正式包统一执行安全、构建、审计和单人实机验收。

## 约束备注

- 所有生产代码标识符、错误与自然语言使用英语，且不得新增生产代码注释。
- 不新增依赖、权限、持久化、自定义样式、拖动、HTML overlay、IPC/Lua 桥或第二字幕轨兼容路径。
- `@tmp/subtandem-extraction` 是内嵌原字幕输入链路，删除范围仅限译文显示文件。
- README 与本地化文档只做人工复核，不新增文案测试；历史 release notes 和既有已完成验收证据不得改写。
- T017、T030 只能在实际指定的 IINA 1.4.4 和正式安装包上标记完成；浏览器控制或 Computer Use 未经用户明确批准不得使用。
