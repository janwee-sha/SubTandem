# 契约：译文 Overlay WebView 渲染

## 权限与资源

- `Info.json` 必须声明 `video-overlay` 并提供仅用于本地非交互式译文显示的英文权限说明。
- Main 每个播放器只创建一个 `iina.overlay` WebView；必须先调用空的 `simpleMode()` 并等待首次 `iina.plugin-overlay-loaded`，再加载正式包内 `dist/ui/overlay.html`。Simple Mode 不得接收、缓存或显示正文。
- Main 必须在正式页面发送 `overlay:ready` 后调用 `show()`，在实例销毁前调用 `hide()`；预热、加载或显示失败只能停用 SubTandem 译文显示，不得阻塞视频和原字幕。
- Overlay 必须调用 `setClickable(false)`；HTML 不得包含 `data-clickable`，脚本不得监听 pointer、mouse、touch 或 keyboard 输入。
- HTML、CSS 与脚本必须由 Parcel 从版本控制内资源构建；不得引用 root-absolute、远程或未跟踪资源。
- CSP 必须至少拒绝连接和远程图片；代码不得调用 fetch、XHR、WebSocket、EventSource、localStorage、sessionStorage、IndexedDB 或 Cache API。

## 正文与样式

- 只有当前真实译文可进入 DOM；无当前译文时容器为空且隐藏，不生成示例、源字幕或占位文本。
- 文本按 text node 写入，不能用未转义 `innerHTML`；换行只来自当前 `lines` 和既有换行规则。
- 以 010 `osd-overlay` 的 ASS 40/720 常规字重为可见字形基准，保持现有白色、黑色 2/720 描边、横向居中、居中对齐和智能换行；WebView 必须固定使用 29/720 视口高度的 CSS 字号与 400 字重完成视觉校准，不得直接沿用名义 40/720 CSS 字号。左右换行边距继承当前 `sub-margin-x`，无效时使用 IINA 默认 25 个 720p 逻辑单位。位置功能不得引入可配置样式。
- DOM 完成换行后必须以实际 `getBoundingClientRect().height` 计算垂直位置；不得按字符数、输入行数或固定行高猜测块高。

## 有效区域

- Main 分别读取并缓存 `osd-dimensions`、`sub-margin-x`、`sub-margin-y`、可用的 `sub-margin-y-offset` 与 `sub-use-margins`；任一读取失败只回退该项，不得清除其他有效输入。几何字段必须为有限数，`h>0`，video margins 非负且和小于 h；否则使用 0 至 1 安全回退。字幕 margin 必须为非负有限数；横向、纵向基值与纵向 offset 无效时分别回退 25、22、0。
- 窗口模式使用实际视频区域；全屏且 `sub-use-margins=true` 时使用完整 Overlay，否则使用实际视频区域。
- 活动播放器每 100 毫秒独立检测 `osd-dimensions` 与 `sub-use-margins`；最终开关值以 `sub-use-margins` 为准，相同有效区域不得发送重复 layout。
- 无上下黑边时，配置两态必须得到相同区域。区域变化不得修改持久位置。
- 标量字幕 margin 的 mpv 属性事件只刷新自身缓存；全屏事件使用其状态参数与缓存输入重排。普通窗口 resize 不得读取 mpv；`mpv.shutdown` 或窗口开始关闭时必须先停止动态检测、解除全部位置几何监听并禁止后续读取。

## 位置公式

设 viewport 高度为 `H`、块高为 `B`、区域为 `[T,R]`、位置为 `P`、当前逻辑垂直边距为 `MY`：

```text
M = min(MY / 720 × H, (R - T) × H / 2)
safeTop = T × H
safeBottom = R × H - M
rawAnchor = safeTop + (safeBottom - safeTop) × P / 100
bottomAnchor = min(safeBottom, max(rawAnchor, safeTop + B))
topOffset = bottomAnchor - B
```

- 对能容纳的块，`P=0` 时顶部为不含纵向 margin 的 `safeTop`，`P=100` 时底部为扣除当前原生字幕纵向 margin 的 `safeBottom`；不得再叠加 OSD margin。
- 多行以整个块底部定位并向上扩展；较小值可因顶部钳制得到相同位置，但 P 增大不得使块向上移动。
- 块高超过安全区域时保持字体和换行，按容器既有边界裁切。
- 所有 CSS offset 必须为有限值；无效输入不更新当前可见布局。

## 重绘与清理

- 位置、viewport、有效区域或当前正文变化时重新布局；相同 revision 和布局签名可去重。
- resize、全屏、黑边配置和画面比例变化只重排当前帧，不重新显示已 clear 的正文。
- clear、禁用、seek、换片、结束、窗口关闭或会话失效必须清空 DOM text、测量状态与 Main 当前帧缓存。
- WebView 未 ready 时 Main 最多保留一个最新当前帧；ready 后只重放该帧。不存在当前帧时只发送 clear/layout，不生成正文。

## 打包

- `build-plugin.sh` 必须构建 Overlay target。
- `verify-package.sh`、`pack.sh` 和 release audit 必须要求 Overlay HTML 及构建引用资源存在，并继续拒绝源码、测试、运行目录、凭据和密钥材料。
- 包契约测试必须验证 `video-overlay`、权限说明、CSP、非交互、classic script 和最小资源集合。
