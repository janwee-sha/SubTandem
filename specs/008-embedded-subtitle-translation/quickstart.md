# 验证指南：内嵌字幕翻译

## 前置条件

- macOS 12+，Node.js 24、npm 11、Swift 6。
- 最终集成验收前，产品统一字幕语言决策已可同时处理外挂与内嵌字幕；其余验证不以该能力先行交付为前置。
- IINA 1.4.0 基线与 IINA 1.4.4 固定发布版；Apple Silicon 与 Intel 正式包环境。
- 已按 [字幕准备契约](./contracts/subtitle-preparation.md) 准备合法测试媒体；不得在证据中记录路径、字幕正文、译文或凭据。
- 验收环境不预装或不暴露 `ffmpeg`/`ffprobe`，证明正式包自带运行能力。

## 聚焦自动化

```sh
npx vitest run tests/unit/subtitle-source.test.ts tests/unit/subtitle-preparation.test.ts
npx vitest run tests/integration/embedded-subtitle.test.ts tests/integration/subtitle-track.test.ts tests/integration/progressive-translation.test.ts
npx vitest run tests/contract/subtitle-extractor-client.test.ts tests/contract/sidebar-lifecycle.test.ts tests/contract/package-manifest.test.ts
npx vitest run tests/security/credential-leakage.test.ts tests/security/redaction.test.ts
npm run test:native
```

预期：

- local/remote、外挂/内嵌、文本/图形分类准确，图形与远程输入不启动 extractor 或 Provider。
- `ff-index`/`src-id`/codec 不一致时失败关闭；同语言同标题多轨仍只提取所选 stream。
- 15 秒超时先失效再取消，迟到结果被释放；轮询不重试，Retry 创建新 ID。
- seek 不取消准备；换轨、换片、停止、禁用、关窗和双窗口不会接受旧结果。
- Profile 选择或 revision 变化后，旧请求及其迟到结果不会进入当前会话。
- SubRip、ASS、SSA、`mov_text` 规范化后复用现有有限前瞻和第二字幕；外挂 SRT/ASS 行为不变。
- 临时目录权限、大小/cue 上限、安全错误和启动遗留清理通过。

## 完整自动化与正式包门禁

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

随后执行最终归档审计。预期包内包含仓库 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt`，且第三方声明、FFmpeg lock、裁剪配置和对应源码资产一致；两个 native 组件均为 macOS 12 arm64/x86_64、可执行、签名有效且无非系统动态依赖；包内不存在源码、测试、构建缓存、运行时目录、路径、字幕或秘密材料。

## 30 个样本矩阵

| 组别 | 最少数量 | 证明内容 |
| --- | ---: | --- |
| Matroska + SubRip | 6 | 单轨、多语言、多轨同元数据、空轨 |
| Matroska + ASS/SSA | 8 | ASS/SSA、样式对白、附件、同 codec 多轨 |
| MOV/MP4 + `mov_text` | 6 | `.mov`/`.mp4`/`.m4v`、多轨与语言元数据差异 |
| 图形/未知字幕 | 3 | PGS、VobSub、DVB/未知 codec 均不提取 |
| 损坏/非法/超时 | 3 | 安全错误、Retry、迟到结果丢弃 |
| 外挂回归 | 4 | UTF-8/UTF-16 SRT、ASS、内嵌↔外挂切换 |

合计至少 30。另用合法本地样本验证 4 小时、20 GB、20,000 cue 上界；只记录 cue 数、耗时、状态和通过/失败，不记录内容或路径。

换轨、换片、跳转、禁用、关闭窗口和双窗口并发各执行不少于 20 次；每类旧状态、迟到结果、缓存或第二字幕进入错误会话的次数必须为 0。

## IINA 正式包人工验收

1. 移除开发链接，安装本次 `.iinaplgz`，记录包版本/SHA-256、macOS、架构和 IINA 版本。
2. 打开本地样本，在 IINA 选择一条受支持内嵌文本字幕作为主字幕，启用翻译。
3. 确认出现准备状态，原字幕与视频持续播放；准备后只在当前位置附近发起翻译，译文作为第二字幕出现。
4. 在准备中与翻译中分别切换 Profile revision，确认旧请求和迟到结果不会进入当前会话。
5. 在同一文件的两条相同语言/title 字幕间切换，确认译文严格跟随实际所选轨。
6. 准备期间 seek，确认完成后从最新位置工作；随后换轨、换片、禁用和关闭，确认旧结果不创建 source 或第二字幕。
7. 在两个窗口同时使用不同媒体/轨道，确认状态、临时目录、缓存和译文不交叉。
8. 选择 PGS、VobSub、DVB、空/损坏文本轨和远程媒体，确认状态原因匹配、Provider 调用为 0、播放不受影响。
9. 制造超时，确认 15 秒后没有自动重试；点击 Retry 后只有新 attempt 可成功。
10. 切换回外挂 SRT/ASS，确认操作、有限前瞻、错误处理、隐私与第二字幕行为保持不变。
11. 正常关闭与强制结束 IINA 后重新启动，确认 `@tmp/subtandem-extraction` 无正文遗留；检查安全日志样本命中数为 0。

Apple Silicon 与 Intel、IINA 1.4.0 与 IINA 1.4.4 组成的四个架构/宿主组合均需完成，并记录每项实际 macOS 版本与包 SHA-256。开发链接、`lipo` 输出或单一架构结果不能替代正式包宿主验收。

## 权限与卸载人工验收

1. 使用与正式包人工验收相同的 `.iinaplgz`，分别执行本地媒体访问允许和拒绝路径。
2. 确认允许后只读取当前本地媒体的所选文本轨；拒绝后不启动提取、不调用 Provider，原字幕与播放不受阻塞。
3. 正常结束会话并从 IINA 插件管理界面卸载，确认插件安装项、运行进程和会话临时字幕数据不残留。
4. 重新安装同一正式包，确认不会恢复旧会话字幕、译文或中间文件。
5. 在 `docs/validation/iina-matrix.md` 与 `docs/validation/package.md` 只记录包 SHA-256、macOS、架构、IINA 版本和通过/失败。

## 开发者单人可用性验收

开发者本人使用正式包且不查阅额外操作说明，计时完成两项操作：在 30 秒内为本地媒体选中内嵌文本字幕并开始翻译；遇到不支持字幕时，仅依据状态说明选择可行下一步。两项均须通过，结果记录到 `docs/validation/usability.md`。

## 验收记录边界

只记录：包版本/hash、macOS/IINA/架构、样本类别与不透明编号、cue 数、准备耗时、状态、播放是否中断、第二字幕与清理结果，以及可用性步骤耗时和通过/失败。不得记录媒体文件名或路径、字幕正文、译文、Provider 请求、token、凭据或 native 原始错误。
