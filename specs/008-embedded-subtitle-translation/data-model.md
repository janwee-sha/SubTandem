# 数据模型：内嵌字幕翻译

## SubtitleTrackIdentity

- `trackId`：IINA 当前主字幕 ID。
- `origin`：`external | embedded`。
- `codec`：规范化 codec；内嵌首版只允许 `subrip | ass | ssa | mov_text`，mpv 的 `srt` 别名先规范化为 `subrip`。
- `ffIndex`：mpv 报告的 FFmpeg stream index；内嵌准备必填。
- `sourceId`：IINA demuxer 的容器原生 stream ID，始终参与 Main 会话身份；仅在其语义与 libavformat `AVStream.id` 可比较时进入 extractor 一致性验证。Matroska 内建 demuxer 的 TrackNumber 不跨边界比较。
- `language`、`title`：可选元数据，不参与轨道匹配。

**规则**：身份来自当前 `sid` 对应的同一条 `track-list` 项。不得根据元数据替换为另一条轨。

## MediaSessionIdentity

- `playerId`：逐窗口不透明 ID。
- `mediaEpoch`：每次 file-loaded、停止或结束后递增。
- `localPath`：仅存在于 Main adapter 与 extractor 请求边界，不进入 UI、日志或持久状态。
- `isNetworkResource`：远程为 true 时禁止创建提取 job。

## SubtitlePreparationAttempt

- `attemptId`：不可复用 UUID。
- `mediaEpoch` 与 `trackIdentity`：接受结果的权威关联。
- `startedAt`、`deadlineAt`：15 秒墙钟期限。
- `status`：`preparing | ready | unsupportedType | remoteUnsupported | emptyOrUnreadable | timedOut | failed | invalidated`。
- `jobId`：native extractor job；只在已启动时存在。

**状态转换**：

```text
selection
  -> unsupportedType
  -> remoteUnsupported
  -> preparing -> ready
               -> emptyOrUnreadable
               -> timedOut
               -> failed
               -> invalidated

emptyOrUnreadable | timedOut | failed --explicit retry--> preparing(new attemptId)
any state --track/file/disable/close--> invalidated
```

超时或失效后，同一 attempt 不得回到 `ready`。seek 不改变 attempt 状态。

## ExtractionJob

- `jobId`：与 attempt 一一对应的 UUID。
- `mediaPath`：绝对本地文件路径，只存在于认证请求和 native 内存。
- `streamIdentity`：`ffIndex`、可选且可比较的 `sourceId`、codec；Matroska 使用 `ffIndex` 与 codec，MOV/MP4 在 IINA 提供时同时校验 `sourceId`。
- `resultId`：成功时等于 job ID，用于定位固定临时目录。
- `cueCount`、`byteCount`、`sha256`：Main 读取前的完整性元数据。
- `state`：`created | running | ready | cancelled | failed | released`。

**验证**：输入必须是本地普通文件；目标 stream 必须存在、为 subtitle、codec 匹配且未超过 20,000 cue/16 MiB。native 原始错误不得跨协议。

## ExtractedSubtitleResult

- 路径：`@tmp/subtandem-extraction/<resultId>/output.srt`。
- 格式：UTF-8 SRT，只保留有效对白、顺序与显示时间。
- 权限：父目录 `0700`、文件 `0600`。
- 生命周期：Main 解析并 hash 校验后立即释放；失败、取消、超时、关闭或下次启动清理。

## PreparedSubtitleSource

- `trackId`、`origin`、`codec`。
- `contentHash`：规范化字幕字节的 SHA-256。
- `languageResult`：产品统一字幕语言决策产生的会话级结果，不绑定能力来源。
- `cues`：现有 `SubtitleCue[]`，最多 20,000 条。

Prepared source 只属于一个 MediaSessionIdentity，不持有 Profile、凭据、媒体路径或临时文件。它进入 `PlaybackController` 后继续使用现有有限前瞻、缓存和第二字幕契约；每次 Provider 请求独立捕获当前 Profile revision，请求或结果的 revision 不再有效时必须丢弃。

## SourcePreparationView

- `state`：对 Sidebar 安全公开的准备状态。
- `origin`、`codec`、`cueCount`：仅在不泄露正文或路径时公开。
- `canRetry`：只对 `emptyOrUnreadable | timedOut | failed` 为 true。
- `canReselect`：除 `ready` 外为 true。

UI view 不包含 attempt/job ID、媒体路径、字幕文字、native 错误或 FFmpeg 输出。

## 关系与所有权

```text
MediaSessionIdentity 1 -> 0..1 current SubtitleTrackIdentity
current identity      1 -> 0..1 active SubtitlePreparationAttempt
attempt               1 -> 0..1 ExtractionJob
ready job             1 -> 1 ExtractedSubtitleResult
validated result      1 -> 1 PreparedSubtitleSource
prepared source       1 -> 1 PlaybackController source
```

每个播放器窗口拥有独立关系图；任何实体都不得跨 media epoch 或 player 复用。
