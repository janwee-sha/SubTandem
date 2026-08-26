# 字幕准备契约

## IINA 选轨快照

Main 在 source 变化时原子取得：

- `core.status.isNetworkResource` 与当前媒体 URL；
- `core.subtitle.id` 对应的 IINA Track；
- `mpv track-list` 中唯一满足 `type=sub`、`id` 相同、`selected=true`、`main-selection=0` 的节点及其 `external`、`codec`、`src-id`、`ff-index`。

选轨在准备提交前后均须再次核对。title、language、顺序位置不得作为替代轨选择依据。

## source 分类

1. 无主字幕或主轨节点不唯一：保持等待/无法读取状态，不猜测轨道。
2. `external=true`：调用现有 `@sub/<track-id>` 读取与 SRT/ASS parser；该 IINA 伪路径不得用于内嵌轨。
3. 远程媒体中的内嵌字幕：返回 `remoteUnsupported`，不启动 extractor。
4. PGS/VobSub/DVB 或未知内嵌 codec：返回 `unsupportedType`，不启动 extractor。
5. 本地受支持内嵌文本轨：创建一次准备 attempt。

## extractor 会话

Main 以绝对路径启动随包 `subtandem-subtitle-extractor`，命令行只允许：

```text
--temp-directory <plugin extraction temp root>
--parent-pid <IINA pid>
```

进程在 stdout 只发送一行 ready frame：

```json
{"type":"ready","port":49152,"token":"opaque","protocolVersion":1}
```

服务只绑定 `127.0.0.1`；token、端口、路径和正文不得进入日志或 Sidebar。

## 本机 HTTP 操作

所有请求使用严格 JSON、Bearer token、未知字段拒绝。

### `POST /v1/prepare`

```json
{
  "jobId": "uuid",
  "mediaPath": "/absolute/local/media",
  "stream": {
    "ffIndex": 3,
    "sourceId": null,
    "codec": "ass"
  },
  "deadlineMs": 15000,
  "maxCueCount": 20000,
  "maxOutputBytes": 16777216
}
```

- `mediaPath` 只允许绝对本地普通文件，不允许 URL、设备、stdin 或网络协议。
- `sourceId` 可为 null；MOV/MP4 中存在且可比较时必须与容器 stream 相等。Matroska 内建 demuxer 的 TrackNumber 只用于 Main 会话身份，提取请求必须传 null，避免与不同语义的 libavformat `AVStream.id` 比较。
- 实际 stream 必须为 subtitle，index 与 codec 必须匹配。
- 同一 job ID 重复提交返回固定冲突错误，不复用结果。

成功响应：

```json
{
  "jobId": "uuid",
  "state": "ready",
  "resultId": "uuid",
  "format": "srt",
  "cueCount": 1200,
  "byteCount": 180000,
  "sha256": "64-lowercase-hex"
}
```

响应不携带字幕正文或媒体路径。Main 从固定 `@tmp` 路径读取结果，验证 byteCount/hash/parse/cueCount 后才建立 source。

### `POST /v1/cancel`

请求 `{ "jobId": "uuid" }`，响应 state 只允许 `cancelled | already-completed | unknown`。取消必须中断读取并删除 job 目录；Main 无论响应如何都已先使 attempt 失效。

### `POST /v1/release`

请求 `{ "resultId": "uuid" }`。成功或幂等缺失均删除合法 UUID 目录，不能影响其他 job、译文轨或凭据目录。

### `POST /v1/health` 与 `POST /v1/shutdown`

health 无副作用；shutdown 取消活动 job、清理所属目录并停止 listener。父进程死亡或空闲超时执行相同清理。

## 安全错误码

协议只允许：

- `INVALID_REQUEST`
- `UNSUPPORTED_CODEC`
- `TRACK_IDENTITY_MISMATCH`
- `EMPTY_OR_UNREADABLE`
- `OUTPUT_LIMIT`
- `TIMED_OUT`
- `CANCELLED`
- `EXTRACTION_FAILED`

不得透传 libav 日志、文件名、路径、字幕内容、errno 文本或堆栈。

## Main 接受规则

结果只有在以下条件全部成立时可接受：

- 当前 player、media epoch、track identity、attempt ID 均与提交时一致；
- attempt 仍为 `preparing` 且未超过 15 秒；
- IINA 当前主字幕仍是同一 Track ID；
- 结果文件大小、hash、cue 数、时间码和文本解析均通过。

否则立即 release；不得调用 Provider、`controller.setSource` 或创建第二字幕轨。

## Provider 分发边界

- Prepared source 不保存 Profile 或凭据；每次 Provider 请求使用当前窗口明确选择的 Profile revision。
- Global 在请求入队与结果回传时均校验当前 Profile revision；Profile 选择或 revision 变化后，旧请求及其迟到结果不得进入当前会话。
- 媒体路径、完整字幕轨和准备状态不得为 revision 校验而发送给 Global。
