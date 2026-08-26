# 研究：覆盖层译文渲染

## 决策 1：controller 按播放位置生成当前译文帧

**决策**：`PlaybackController` 在每次位置更新时，从当前会话已验证译文中选择满足 `startMs <= positionMs < endMs` 的 cue，按源顺序把纯文本行交给逐窗口覆盖层。渐进结果到达时立即重算当前帧；翻译请求仍在执行时也继续更新时间与清理。

**理由**：第二字幕轨由 mpv 根据 SRT 时间自动切换，`osd-overlay` 不处理事件时间。把时序留在已有 controller 和 session fingerprint 边界，可继续拒绝迟到结果，并在 seek、缓存命中和 cue 离开时正确重绘或清理。

**备选方案**：继续发布完整 SRT 会保留轨道副作用；让适配器接收全部 cue 并自行计时会复制会话、缓存和 seek 责任；每个 cue 使用独立 overlay 会增加 ID、排序和清理状态。

## 决策 2：每个播放器复用一个固定 `osd-overlay`

**决策**：每个 Main 播放器实例创建一个覆盖层适配器，使用插件自有的稳定正整数 ID。显示时按 mpv 0.38 的固定位置参数传递 `id, ass-events, data, 0, 720, 0, no, no`；清理时对同一 ID 传递 `id, none, "", 0, 720, 0, no, no`。不启用 `compute_bounds`。

**理由**：相同 ID 会替换既有内容，`format=none` 会移除覆盖层；`res_x=0` 根据窗口宽高比推导逻辑宽度，`res_y=720` 建立字号缩放基准。IINA 的 `mpv.command(name, string[])` 返回 `void`，不能读取实验性的 bounds 或命令结果。[mpv 0.38 `osd-overlay`](https://github.com/mpv-player/mpv/blob/v0.38.0/DOCS/man/input.rst#L1036-L1130)、[IINA MPV API](https://docs.iina.io/interfaces/IINA.API.MPV)

**备选方案**：HTML overlay 会引入不同渲染和输入边界；mpv IPC 或 Lua 桥会扩大进程、权限与安全范围；为每次更新分配新 ID 会增加泄漏与误清理风险。

## 决策 3：单一 ASS 事件承载固定样式和全部当前译文

**决策**：输出一个无原始 CR/LF 的 `ass-events` 事件。固定样式使用 `Default` reset、顶部居中、自动换行、白色字号 40、黑色描边、无阴影和透明背景；译文自身换行及多个同时有效 cue 的边界均编码为 `\N`。超出窗口高度时允许宿主裁切，不额外缩字、分页或省略。

**理由**：多个原始 LF 会被 mpv 拆成多个独立 ASS 事件，布局和碰撞行为不稳定；单事件可原子更新并保持顺序。720 PlayRes 会随窗口高度等比缩放，普通 resize 不需要重新发送相同内容。[mpv 0.38 OSD/libass 实现](https://github.com/mpv-player/mpv/blob/v0.38.0/sub/osd_libass.c#L91-L127)

**备选方案**：固定 `res_x=1280` 不适配不同宽高比；读取 IINA 字幕偏好违反固定默认样式；使用 `\pos` 会绕过普通字幕换行；超高文本自动缩小、分页或滚动均不属于当前规格。

## 决策 4：在适配器边界复刻 mpv 的 ASS 文本转义

**决策**：纯转义函数先把 CRLF/CR 规范化为 LF，再把 LF 转为 `\N`；在 `{` 前加反斜杠；在译文字面反斜杠后插入 U+2060 WORD JOINER；把行首 ASCII 空格转换为 `\h`；把 NUL 替换为 U+FFFD。固定样式前缀与译文分别构造，传给 mpv 的 data 不含原始换行。

**理由**：IINA 的 `void` 命令 API 无法取得 mpv `escape-ass` 的返回值。复刻 mpv 0.38 的 `osd_mangle_ass` 可以阻止译文中的 `{...}`、`\N`、`\p`、`\r` 等内容改变样式或进入绘图模式。[mpv 0.38 `osd_mangle_ass`](https://github.com/mpv-player/mpv/blob/v0.38.0/sub/osd_libass.c#L181-L220)

**备选方案**：只转义花括号不能阻止反斜杠控制序列；HTML 转义不适用于 ASS；调用 `escape-ass` 无法通过当前 IINA API取得结果。

## 决策 5：显式、幂等地同步和清理

**决策**：位置 tick 先同步当前覆盖层，再决定是否调度 Provider。进度或最终结果被当前 session 接受后立即同步；无有效译文、seek、换轨、换片、配置变化、禁用、结束或关窗时清理。适配器只在命令调用未抛错后提交去重状态，重复 show/clear 不重复发送；异常仅产生不含正文的固定状态，并允许后续 tick 重试。

**理由**：现有会话 token 已覆盖窗口、媒体、字幕源和配置归属。先同步再执行 Provider early-return，才能让缓存命中的 cue 在 seek 后恢复，并在请求执行期间按时清除。显式清理不能依赖插件对象或 libmpv client 最终析构。

**备选方案**：仅在结果到达时更新会漏掉自然离开和缓存 seek；仅在关窗清理会残留错译；失败时回退第二字幕轨会重新引入通知与双路径。

## 决策 6：彻底删除第二字幕轨发布路径

**决策**：删除译文 SRT 生成、临时译文文件、`sub-add`/`sub-remove`、轨道发现、`sid`/`secondary-sid` 写入、第二轨恢复和由发布过程引起的源轨事件屏蔽。保留内嵌原字幕提取产生的输入临时文件，以及真实用户字幕轨变动所需的 source reload settling。

**理由**：这些代码只服务于被替代的输出机制；保留任一路径都会违反“自行渲染译文”和无轨道副作用契约。内嵌字幕提取仍是翻译输入链路，不属于译文发布。

**备选方案**：兼容开关、隐藏译文轨或失败回退都会保留过时实现，违反项目宪法。

## 决策 7：本版本不实现拖动

**决策**：不注册覆盖层鼠标事件，也不使用 `compute_bounds` 模拟命中；保持 IINA 原有单击、双击和窗口拖动行为。

**理由**：`osd-overlay` 没有命中或指针事件契约；IINA 的 drag 回调不能可靠接管连续拖动，`command(): void` 也无法取得 bounds。[IINA Input API](https://docs.iina.io/interfaces/IINA.API.Input)

**备选方案**：以全窗口输入监听或 HTML overlay 模拟拖动会改变播放器交互边界，留待独立功能评估。

## 宿主门禁

- IINA 仅暴露位置字符串参数，mpv 建议 `osd-overlay` 使用命名参数。正式 `.iinaplgz` 必须在当前 IINA 1.4.4 验证 show、replace、remove；失败即停止实现收敛并返工规格或方案。本功能不要求跨版本或跨架构宿主矩阵。
- IINA 不返回命令错误或实际渲染边界，样式、裁切、500 毫秒时序和鼠标非干扰必须实机验收，mock 不能替代。
- IINA 的宿主日志路径可能记录 mpv 命令参数。正式包必须用非敏感合成 sentinel 检查 Log Viewer 与文件日志，命中数必须为 0；若命中，方案违反“字幕内容不得泄漏到诊断信息”的宪法门，不能发布。
- 同一 libmpv client 内 overlay ID 可能与第三方客户端碰撞；稳定的大整数 ID、仅更新/清理自有 ID 和正式宿主共存测试共同降低风险，不承诺任意第三方 overlay 的顺序。
