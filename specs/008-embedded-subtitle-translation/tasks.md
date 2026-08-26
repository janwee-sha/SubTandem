# 任务：内嵌字幕翻译

**输入**：`specs/008-embedded-subtitle-translation/` 中的规格、计划、研究、数据模型、契约与验证指南

**测试要求**：本功能跨 TypeScript、Swift、FFmpeg、IINA 宿主与发布边界；所有行为变更必须先补自动化回归，再实现，并保留正式 `.iinaplgz` 的双架构 IINA 人工验收。

## 阶段 1：准备与依赖锁定

**目的**：建立可重建的 native 工程事实源，不等待其他功能完整交付。

- [X] T001 [P] 创建 `native/ffmpeg.lock.json`，固定 FFmpeg 8.1.2 官方源码 URL、SHA-256、许可证、完整裁剪参数以及 Matroska、MOV/MP4、SubRip/ASS/SSA/`mov_text` 白名单
- [X] T002 [P] 创建 `native/subtitle-extractor/Package.swift` 及 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/`、`native/subtitle-extractor/Tests/SubTandemSubtitleExtractorTests/`，声明 Swift 6、macOS 12 与可执行目标
- [X] T003 根据 `native/ffmpeg.lock.json` 更新 `THIRD_PARTY_NOTICES.txt`，写明 FFmpeg 8.1.2 许可、裁剪配置和对应源码资产位置

---

## 阶段 2：基础工具链（阻塞全部用户故事）

**目的**：让锁定的 FFmpeg 与两个 universal native 组件可由仓库脚本构建、测试和精确暂存。

**关键门禁**：本阶段完成前不得进入用户故事实现。

- [X] T004 在 `tests/contract/package-manifest.test.ts` 先增加 FFmpeg lock 完整性、禁用 network/GPL/nonfree、精确 codec/demuxer 白名单及双 native 产物命名的失败合同测试
- [X] T005 创建 `scripts/build-ffmpeg.sh`，校验 `native/ffmpeg.lock.json` 的源码摘要，并分别构建 macOS 12 arm64/x86_64 的最小静态 FFmpeg 库，拒绝 PATH 二进制与未锁定输入
- [X] T006 更新 `scripts/build-native.sh` 与 `scripts/test-native.sh`，精确清理 `dist/native/`，构建、合并、签名并验证 `subtandem-transport` 与 `subtandem-subtitle-extractor` 的双架构产物，并运行两个 Swift 测试套件

**检查点**：锁定工具链就绪；所有用户故事可基于同一 native 构建边界开发。

---

## 阶段 3：用户故事 1——直接翻译本地媒体的内嵌文本字幕（P1）🎯 MVP

**目标**：精确读取当前所选的本地 SubRip、ASS/SSA 或 `mov_text` 内嵌轨，将会话级 cue 送入既有有限前瞻翻译与第二字幕链，且正式包无需外部工具。

**独立测试**：分别播放包含 Matroska SubRip、ASS/SSA 与 MOV/MP4 `mov_text` 的本地样本；选中目标轨并启用翻译后，原字幕和播放不中断，当前位置附近的正确 cue 进入已选 Provider，译文只作为第二字幕出现，环境不提供外部 `ffmpeg`/`ffprobe`。

### 用户故事 1 测试

> 先完成 T007–T011 并确认其对尚未实现的能力失败，再开始实现任务。

- [X] T007 [P] [US1] 在 `tests/unit/subtitle-source.test.ts` 增加外挂路径保持不变、受支持内嵌 codec 归一化、唯一 `track-list` 选轨快照与禁止读取内嵌 `@sub/<id>` 的单元测试
- [X] T008 [P] [US1] 创建 `tests/contract/subtitle-extractor-client.test.ts`，覆盖 ready frame、Bearer 认证、严格 `/v1/prepare` JSON、结果元数据校验及响应不含路径或正文
- [X] T009 [P] [US1] 在 `native/subtitle-extractor/Tests/SubTandemSubtitleExtractorTests/ExtractionTests.swift` 增加 SubRip、ASS、SSA、`mov_text` 的精确 stream 提取、UTF-8 SRT 规范化、顺序和时间码测试
- [X] T010 [P] [US1] 创建 `tests/integration/embedded-subtitle.test.ts`，覆盖受支持内嵌轨从准备到有限前瞻 Provider 请求及第二字幕发布的完整流程，证明请求只使用当前 Profile revision，revision 在准备中或翻译中变化时旧请求与结果被丢弃，并证明 seek 后从最新位置工作
- [X] T011 [P] [US1] 在 `tests/contract/package-manifest.test.ts` 增加正式包必须包含仓库 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt`，并必须携带且只携带两个 universal、macOS 12、已签名、无非系统动态依赖 native 可执行文件的合同测试

### 用户故事 1 实现

- [X] T012 [US1] 在 `src/subtitles/types.ts` 建模 `SubtitleTrackIdentity`、`MediaSessionIdentity`、`SubtitlePreparationAttempt`、`ExtractionJob`、`ExtractedSubtitleResult`、`PreparedSubtitleSource` 与 `SourcePreparationView`
- [X] T013 [US1] 扩展 `src/adapters/iina/subtitle-source.ts` 并补齐 `src/types/iina-runtime.d.ts`，原子读取本地/远程状态、当前主字幕和唯一 mpv `track-list` 节点，以 ID、`selected`、`main-selection`、`ff-index`、`src-id`、codec 分类来源
- [X] T014 [US1] 创建 `src/adapters/iina/subtitle-extractor.ts`，逐窗口启动随包 extractor，解析单行 ready frame，并按 `contracts/subtitle-preparation.md` 实现认证 prepare 客户端与安全错误映射
- [X] T015 [P] [US1] 在 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Protocol.swift` 实现严格请求/响应 DTO、Bearer 认证、UUID 与固定安全错误码，拒绝未知字段且不暴露路径、正文或 libav 错误
- [X] T016 [US1] 在 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Extractor.swift` 使用锁定 FFmpeg C API 验证本地普通文件及真实 subtitle stream，并将 SubRip、ASS/SSA、`mov_text` 规范化为最多 20,000 cue、16 MiB 的 UTF-8 SRT
- [X] T017 [US1] 在 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Server.swift` 与 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/main.swift` 实现仅绑定 `127.0.0.1` 的 ready、health、prepare 服务和父进程/空闲退出边界
- [X] T018 [P] [US1] 在 `src/domain/status.ts` 与 `src/domain/messages.ts` 定义不含敏感字段的准备视图、`preparing`/`ready` 状态及 Main–Sidebar 消息结构
- [X] T019 [US1] 创建 `src/app/subtitle-preparation.ts`，实现单窗口单 attempt 的 happy path、15 秒 deadline 登记、结果身份/大小/hash/cue/解析校验及成功后的立即 release
- [X] T020 [US1] 扩展 `src/subtitles/source.ts`，将已校验的会话级 UTF-8 SRT 解析为既有 `SubtitleCue[]`、内容 hash，并接入产品统一字幕语言决策，不绑定能力来源且不保留媒体路径或临时文件
- [X] T021 [US1] 重构 `src/main.ts`，把外挂源继续送入既有 reader，把受支持内嵌源送入逐窗口准备协调器，并仅在当前 identity/attempt 仍有效时调用 `PlaybackController.setSource`
- [X] T022 [US1] 更新 `ui/sidebar.ts`、`ui/sidebar.html` 与 `ui/sidebar.css`，在既有翻译状态之前显示英文 `preparing` 状态，准备成功后无额外操作回到既有翻译体验
- [X] T023 [US1] 更新 `scripts/verify-package.sh` 与 `scripts/pack.sh`，对白名单中的两个 native 文件执行架构、最低系统、执行位、签名、动态依赖和仓库构建 hash 校验，并拒绝 FFmpeg 构建材料进入归档
- [X] T024 [US1] 按 `specs/008-embedded-subtitle-translation/quickstart.md` 运行 US1 单元、合同、native 与 happy-path 集成测试，并在无外部 FFmpeg 的正式包环境完成三类 codec 的聚焦验收

**检查点**：US1 可独立演示核心内嵌文本字幕翻译，且外挂字幕路径保持原样。

---

## 阶段 4：用户故事 2——切换字幕源时保持结果正确（P2）

**目标**：换轨、换片、停止、禁用、关窗和双窗口并发均使旧工作失效；seek 只移动翻译窗口，外挂字幕切换不增加步骤。

**独立测试**：在两条内嵌文本字幕与一条外挂字幕之间连续切换、跳转和开关翻译，并同时操作两个 IINA 窗口；每个窗口只接受当前媒体、当前轨道和当前 attempt 的 cue、缓存与第二字幕，任何迟到结果均被释放。

### 用户故事 2 测试

> 先完成 T025–T029 并确认生命周期测试失败，再开始实现任务。

- [X] T025 [P] [US2] 在 `tests/unit/subtitle-preparation.test.ts` 增加 media epoch、track identity、attempt ID、15 秒期限联合验收，以及 seek 不取消、换轨/换片/停止/禁用/关窗立即失效的单元测试
- [X] T026 [P] [US2] 扩展 `tests/contract/subtitle-extractor-client.test.ts`，覆盖 `/v1/cancel`、`/v1/release`、`/v1/shutdown` 的幂等语义和失效优先于取消响应
- [X] T027 [P] [US2] 扩展 `tests/integration/embedded-subtitle.test.ts`，覆盖同元数据多轨精确切换、内嵌↔外挂恢复、迟到 prepare/Provider 结果丢弃及双窗口隔离
- [X] T028 [P] [US2] 扩展 `tests/integration/subtitle-track.test.ts`，证明用户主字幕始终保留、仅当前会话译文占用第二字幕，清理不会删除其他窗口或用户轨道
- [X] T029 [P] [US2] 在 `native/subtitle-extractor/Tests/SubTandemSubtitleExtractorTests/LifecycleTests.swift` 增加同窗口单活动 job、跨进程隔离、取消/释放/父进程退出和精确 UUID 目录清理测试

### 用户故事 2 实现

- [X] T030 [P] [US2] 扩展 `src/app/subtitle-preparation.ts`，使换轨、换片、停止、禁用和关窗先失效 attempt/source，再取消 job、清理结果并阻止迟到回调；seek 仅更新后续翻译位置
- [X] T031 [P] [US2] 扩展 `src/adapters/iina/subtitle-extractor.ts`，实现幂等 cancel/release/shutdown、进程退出收敛及逐窗口 job 所有权，不把媒体路径或完整字幕发送给 Global
- [X] T032 [P] [US2] 扩展 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Server.swift` 并创建 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/ExtractionJobs.swift`，实现单活动 job、可取消读取、精确释放与 shutdown/父进程/空闲清理
- [X] T033 [P] [US2] 扩展 `src/adapters/iina/subtitle-track.ts`，按播放器会话隔离生成轨道与临时译文文件，并在 source 失效时恢复原第二字幕而不改变当前主字幕
- [X] T034 [US2] 更新 `src/main.ts`，把 IINA track-list、file-loaded、end-file、翻译禁用与 window-close 生命周期接入协调器，并在切回外挂字幕时恢复既有同步读取流程
- [X] T035 [US2] 按 `specs/008-embedded-subtitle-translation/quickstart.md` 运行 US2 生命周期、换轨、外挂回归和双窗口聚焦测试，确认错误会话接受结果次数为 0

**检查点**：US1 与 US2 均可验收；换源和多窗口不会互相污染。

---

## 阶段 5：用户故事 3——不受支持或准备失败时安全观看（P3）

**目标**：图形字幕、硬字幕、远程媒体、非法轨道、空/损坏/超限字幕和准备超时均显示可区分状态，不调用 Provider、不阻塞播放，并只允许用户显式重试失败 attempt。

**独立测试**：依次选择 PGS、VobSub、DVB、远程内嵌、空/损坏文本轨并制造超时；核对状态与原因匹配、Provider 调用为 0、原字幕和播放持续、15 秒后不自动重试、Retry 生成新 ID，重启后无会话临时数据。

### 用户故事 3 测试

> 先完成 T036–T041 并确认失败边界测试失败，再开始实现任务。

- [X] T036 [P] [US3] 扩展 `tests/unit/subtitle-source.test.ts`，覆盖无唯一主轨、远程内嵌、PGS/VobSub/DVB、未知 codec、硬字幕无轨及字段冲突全部失败关闭且不启动 extractor
- [X] T037 [P] [US3] 扩展 `tests/unit/subtitle-preparation.test.ts`，覆盖空/不可读、输出超限、失败、15 秒超时先失效后取消、迟到 release、轮询不重试及显式 Retry 创建新 attempt/job ID
- [X] T038 [P] [US3] 扩展 `tests/contract/sidebar-lifecycle.test.ts`，覆盖准备状态优先级、英文文案、`canRetry`/`canReselect`、`subtitle:retry-preparation` revision 校验及安全失败响应
- [X] T039 [P] [US3] 扩展 `tests/integration/embedded-subtitle.test.ts`，证明所有不支持与失败输入的 Provider 调用为 0、播放不中断、原字幕不隐藏且第二字幕不创建
- [X] T040 [P] [US3] 扩展 `tests/security/credential-leakage.test.ts` 与 `tests/security/redaction.test.ts`，拒绝日志、异常、Sidebar、Global 消息和包中出现媒体路径、字幕正文、译文、token、native 原始错误或 Provider 请求
- [X] T041 [P] [US3] 在 `native/subtitle-extractor/Tests/SubTandemSubtitleExtractorTests/SecurityTests.swift` 增加 URL/设备/stdin、身份不匹配、图形 codec、未知字段、cue/字节上限、目录权限与启动遗留清理测试

### 用户故事 3 实现

- [X] T042 [P] [US3] 扩展 `src/adapters/iina/subtitle-source.ts`，把远程内嵌、图形/未知 codec、无唯一选轨与不可证明的 stream identity 分类为契约状态，禁止静默改用相似轨道
- [X] T043 [P] [US3] 扩展 `src/domain/status.ts` 与 `src/domain/messages.ts`，加入 `unsupportedType`、`remoteUnsupported`、`emptyOrUnreadable`、`timedOut`、`failed`、`invalidated` 和严格 Retry 消息
- [X] T044 [US3] 扩展 `src/app/subtitle-preparation.ts`，实现安全错误到用户状态的固定映射、15 秒硬超时、迟到结果 release、失败后无自动重试及仅显式 Retry 可创建新 attempt
- [X] T045 [P] [US3] 强化 `native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Extractor.swift`、`Protocol.swift` 与 `ExtractionJobs.swift`，执行文件/stream/codec/上限校验、`0700`/`0600` 权限、固定错误码及合法 UUID 范围内的启动遗留清理
- [X] T046 [US3] 更新 `ui/sidebar.ts`、`ui/sidebar.html` 与 `ui/sidebar.css`，按 `contracts/source-state.md` 显示可区分英文状态、重新选轨提示和仅失败态可见的 Retry 操作
- [X] T047 [US3] 更新 `src/main.ts`，校验 Retry 仍属于当前媒体与轨道，确保不可用状态不调用 Provider、不清除用户原字幕、不阻塞播放，并对所有外发状态做敏感字段裁剪
- [X] T048 [US3] 更新 `Info.json` 的描述与 `file-system` 权限说明，准确披露只读取当前本地媒体的所选文本轨、临时用途、清理时机和远程/图形字幕边界，且不新增权限或域名
- [X] T049 [US3] 按 `specs/008-embedded-subtitle-translation/quickstart.md` 运行 US3 失败、超时、Retry、安全与清理聚焦测试，确认无效字幕 Provider 调用和敏感数据命中均为 0

**检查点**：三个用户故事的正常、隔离与失败边界均可独立验收。

---

## 阶段 6：发布、文档与跨故事验收

**目的**：完成对应源码分发、全量回归、样本矩阵、归档审计和真实 IINA 宿主验收。

- [X] T050 [P] 在 `tests/contract/release-audit.test.ts`、`tests/contract/release-metadata.test.ts`、`tests/contract/release-publish.test.ts` 与 `tests/contract/release-workflow.test.ts` 先增加仓库 `LICENSE`、包内第三方声明、FFmpeg lock、对应源码 tarball 与校验文件之间的一致性检查，并覆盖双 native 审计及发布上传白名单的失败合同测试
- [X] T051 更新 `scripts/audit-release.mjs`、`scripts/release-metadata.mjs` 与 `scripts/publish-release.mjs`，记录两个 native 组件的架构/最低系统/执行位/签名/依赖/hash，并生成、审计和发布 lock 对应 FFmpeg 源码资产与校验文件
- [X] T052 更新 `.github/workflows/release.yml`，在固定环境构建锁定 FFmpeg 与 extractor，运行新增门禁，并仅把审计后的 `.iinaplgz`、校验文件和对应源码资产交给发布作业
- [X] T053 [P] 更新 `README.md` 与 `docs/readme/README.ar.md`、`README.fr.md`、`README.ja.md`、`README.ko.md`、`README.ru.md`、`README.zh-CN.md`，说明支持格式、当前选轨操作、不支持边界、播放优先、临时数据和无需外部工具
- [X] T054 [P] 更新 `docs/engineering/development.md`、`docs/validation/automated.md`、`docs/validation/package.md` 与 `docs/validation/iina-matrix.md`，记录锁定 FFmpeg 构建、两个 native 门禁、隐私证据边界及正式包双架构验收步骤
- [X] T055 在 `tests/fixtures/media/README.md` 建立不少于 30 个合法本地样本的不透明清单与可重建小样本说明，并扩展 `tests/integration/acceptance-metrics.test.ts`、`tests/integration/performance.test.ts` 验证选轨 100%、cue 完整率、95% 五秒准备、4 小时/20 GB/20,000 cue 上界、播放中断为 0，以及换轨、换片、跳转、禁用、关窗和双窗口并发各不少于 20 次且错误会话接受结果为 0；不得提交大型或受版权限制媒体
- [X] T056 按 `specs/008-embedded-subtitle-translation/quickstart.md` 依次运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package` 与 `npm run pack`
- [X] T057 使用 `scripts/audit-release.mjs` 审计最终 `.iinaplgz`、两个 native 组件及 FFmpeg 对应源码资产，确认包内包含仓库 `LICENSE` 和正确的 `THIRD_PARTY_NOTICES.txt`，声明与 FFmpeg lock、裁剪配置及源码资产一致；同时确认包内没有源码、测试、缓存、临时字幕、路径、正文、译文、凭据或非白名单文件
- [ ] T058 按 `specs/008-embedded-subtitle-translation/quickstart.md` 在 Apple Silicon 与 Intel、IINA 1.4.0 与 IINA 1.4.4 组成的四个架构/宿主组合中人工安装正式包，记录实际 macOS 版本与包 SHA-256，确认统一字幕语言决策同时处理外挂与内嵌字幕，并完成 30 样本、换轨、双窗口、失败、超时、外挂与重启清理验收，只将允许字段记录到 `docs/validation/iina-matrix.md` 与 `docs/validation/package.md`
- [ ] T059 由开发者本人按 `specs/008-embedded-subtitle-translation/quickstart.md` 使用正式包完成单人可用性验收，不查阅额外操作说明，在 30 秒内开始内嵌字幕翻译并仅依据状态说明处理不支持字幕，将两项耗时和通过/失败记录到 `docs/validation/usability.md`
- [ ] T060 按 `specs/008-embedded-subtitle-translation/quickstart.md` 使用与 T058 相同的正式包完成权限与卸载实机验收：分别验证本地媒体访问允许和拒绝路径、拒绝后播放不受阻塞、卸载后插件及会话临时数据不残留、重新安装后无旧会话数据，并在 `docs/validation/iina-matrix.md` 与 `docs/validation/package.md` 记录包 SHA-256、macOS、架构、IINA 版本和结论

---

## 依赖与执行顺序

### 阶段依赖

- 阶段 1 无代码前置；T001 与 T002 修改不同文件且可并行，T003 依赖 T001。
- 阶段 2 依赖阶段 1；T004 必须先于 T005–T006，T006 依赖 T002 与 T005。
- US1 依赖阶段 2，是 US2、US3 共用的核心准备与翻译链。
- US2 与 US3 均依赖 US1；逻辑上可分别验收。它们会修改 `src/main.ts`、`src/app/subtitle-preparation.ts` 和 native 热点文件，单工作区按 US2→US3 串行；若使用隔离 worktree，可并行开发并按 US2→US3 顺序合并。
- 阶段 6 依赖所选用户故事完成；统一字幕语言决策只阻塞 T058–T059 的最终集成与可用性验收，不阻塞此前实现；正式发布必须完成全部三个用户故事和 T050–T060。

### 用户故事依赖图

```text
阶段 1 → 阶段 2 → US1 ─┬→ US2 ─┐
                       └→ US3 ─┴→ 阶段 6 → T058/T059
                                         ↑
                              统一字幕语言决策可用
```

### 故事内顺序

- 每个故事先完成其“测试”小节并观察预期失败，再进入实现。
- US1 的 native 分支为 T015→T016→T017，TypeScript 分支为 T012→T013/T014/T018→T019/T020，二者在 T021 汇合；T023 等待 native 产物可构建。
- US2 的 T030–T033 可在测试完成后按文件所有权并行，T034 汇合所有生命周期实现。
- US3 的 T042、T043、T045 可在测试完成后并行；T044 依赖 T042/T043，T046 依赖 T043，T047 汇合分类、状态、协调器与 UI。

## 并行执行示例

### 用户故事 1

```text
并行测试：T007、T008、T009、T010、T011
实现分支 A：T012 → T013 → T014 → T019 → T020
实现分支 B：T015 → T016 → T017
状态分支：T018
汇合：T021 → T022/T023 → T024
```

### 用户故事 2

```text
并行测试：T025、T026、T027、T028、T029
并行实现：T030、T031、T032、T033
汇合：T034 → T035
```

### 用户故事 3

```text
并行测试：T036、T037、T038、T039、T040、T041
并行起步：T042、T043、T045
后续：T042/T043 → T044；T043 → T046；T044/T045/T046 → T047 → T048/T049
```

## 实施策略

### MVP 优先

1. 完成阶段 1 的依赖锁定与 native 工程准备。
2. 完成阶段 2 的可重建 native 工具链。
3. 完成 US1（T007–T024）。
4. 在无外部 FFmpeg 的正式包环境独立验证三类受支持 codec；通过前不进入范围扩张。

### 增量交付

1. US1 交付受支持内嵌文本字幕的核心体验。
2. US2 收紧换源、迟到结果和多窗口隔离。
3. US3 补齐不支持、失败、超时、显式重试与数据最小化边界。
4. 阶段 6 统一完成发布资产、文档、全量门禁和宿主矩阵；任一未验收任务保持未勾选。

## 任务格式说明

- `[P]` 仅表示在其前置测试或阶段门禁完成后，可由不同文件负责人并行执行。
- `[US1]`、`[US2]`、`[US3]` 分别映射规格中的三个用户故事。
- 生产代码不得新增注释，自然语言使用英语；SDD、项目文档与验收记录使用简明中文。
