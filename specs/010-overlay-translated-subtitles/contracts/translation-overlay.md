# 契约：译文覆盖层

## 1. Controller 输出端口

```ts
interface TranslationOverlaySink {
  show(lines: readonly string[]): void;
  clear(): void;
}
```

- `show` 只接收当前会话、当前播放位置已经验证的纯译文，按源 cue 顺序排列；每个元素可以保留内部换行。
- controller 不向 sink 传递 SRT、时间戳、轨道 ID、文件路径、Profile、Provider 信息或样式设置。
- 无当前有效译文时必须调用 `clear`，不得用空白占位、错误文本或未来 cue 代替。
- sink 调用为同步边界；同步异常必须被 controller 隔离，不得中断播放、字幕源刷新或后续 Provider 调度。

## 2. 当前帧选择

- cue 的有效区间为 `[startMs, endMs)`；相邻 cue 在共同边界不双显，零时长 cue 不显示。
- 只使用通过当前 `playerId`、媒体、字幕源、语言、Provider 配置和 generation fingerprint 验证的译文。
- 多个 cue 同时命中时保持源数组顺序；cue 内换行保留，空译文忽略。
- 350 毫秒位置 tick 必须先同步显示帧，再执行 disabled、无 source、无 position 或 Provider in-flight 等调度 early-return。
- 当前 session 接受新的渐进或最终译文后，必须用最新位置立即重算；不得提前显示未来译文，也不得恢复已过期译文。
- 暂停且位置仍在区间内时保持当前译文；seek 先使旧 session/generation 失效并清理，再由新位置缓存或新结果重绘。

## 3. IINA/mpv 命令

每个 Main 播放器持有一个适配器和一个稳定的插件自有正整数 overlay ID。不得为每次更新分配新 ID。

### 显示或替换

```text
iina.mpv.command("osd-overlay", [
  OVERLAY_ID,
  "ass-events",
  ASS_DATA,
  "0",
  "720",
  "0",
  "no",
  "no"
])
```

参数依次对应 `id`、`format`、`data`、`res_x`、`res_y`、`z`、`hidden`、`compute_bounds`。

### 清理

```text
iina.mpv.command("osd-overlay", [
  OVERLAY_ID,
  "none",
  "",
  "0",
  "720",
  "0",
  "no",
  "no"
])
```

- 只允许更新或清理自有 ID；不得使用会清除 IINA OSD、字幕或其他插件内容的全局命令。
- 相同 ASS data 不重复 show，空状态不重复 clear；命令抛错时不提交新的去重状态，使后续同步可以重试。
- 普通窗口 resize/fullscreen 依赖 `res_x=0`、`res_y=720` 的宿主重排，不因尺寸事件重复发送相同正文。

## 4. ASS 输出

每次 show 只发送一个事件，结构为“固定前缀 + 已转义译文”；`ASS_DATA` 不得含原始 CR 或 LF。固定前缀必须等价于以下属性：

```ass
{\rDefault\an8\q0\fs40\fscx100\fscy100\b0\i0\u0\s0\1c&HFFFFFF&\1a&H00&\3c&H000000&\3a&H00&\bord2\shad0\4a&HFF&\blur0}
```

- `\an8` 顶部居中，`\q0` 自动换行，`\fs40` 配合 PlayResY 720 等比缩放。
- 白色填充、黑色描边、无阴影和透明背景为本版本固定值；不得读取用户字幕偏好或新增设置。
- 译文自身换行和相邻 cue 边界均转换为 `\N`。超出窗口高度时允许裁切，不得为单条内容额外缩字、分页或省略。

### 文本转义

按 Unicode code point 顺序处理译文：

1. 把 CRLF 和 CR 规范化为 LF。
2. 把 LF 转为 `\N`，并重新进入行首状态。
3. 在 `{` 前插入反斜杠。
4. 在每个译文字面反斜杠后插入 U+2060 WORD JOINER，阻止其形成 ASS 控制序列。
5. 把每个语义行开头的 ASCII 空格转换为 `\h`。
6. 把 NUL 替换为 U+FFFD。

转义测试至少覆盖 `{...}`、`\N`、`\p`、`\r`、CRLF、连续空行、行首空格、CJK、RTL、emoji 和组合字符。

## 5. 生命周期与隔离

- 无有效 cue、seek、换字幕源、换片、配置变化、禁用、end-file、关窗和插件退出必须清理所属覆盖层。
- 清理前先使旧 session/generation 失效；任何迟到进度、结果或回调都必须先复核 fingerprint。
- 每个窗口独立持有 controller、sink 和 mpv port；窗口 A 的 show、clear 或失败不得向窗口 B 发命令。
- 不注册鼠标命中、拖动或全窗口输入处理；IINA 原有单击、双击和窗口拖动继续生效。

## 6. 禁止的副作用

覆盖层路径不得：

- 调用 `sub-add`、`sub-remove` 或字幕 reload；
- 读取或写入 `sid`、`secondary-sid`；
- 创建译文 SRT 或其他译文临时显示文件；
- 输出字幕正文、译文、ASS data、Provider 请求或媒体路径到项目日志、诊断或错误；
- 在失败时恢复第二字幕轨或显示技术占位。

内嵌原字幕的临时提取仍属于输入链路，不受“不得创建译文显示文件”限制。

## 7. 宿主验收门

自动化 fake 只证明命令构造和应用状态，不证明 IINA 接受或渲染命令。正式包必须同时满足：

1. 当前 IINA 1.4.4 可执行 show、replace、remove 位置参数形式的 `osd-overlay`。
2. IINA Log Viewer 与文件日志对非敏感合成 sentinel 的命中数为 0。
3. 原主字幕、第二字幕选择和轨道列表不变，插件引起的轨道通知为 0。
4. 真实窗口中的样式、换行、允许的超高裁切、500 毫秒显示/清理和指针非干扰符合规格。

第 1 或第 2 项失败时不得继续发布，也不得以 mock 通过替代；必须回到规格和技术方案重新规划。
