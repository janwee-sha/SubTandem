# 研究：自定义译文浮层垂直位置

## 渲染路径与权限

- **决策**：删除 ASS `osd-overlay` 渲染，改用每个 Main 实例独占的 `iina.overlay` WebView，并在 `Info.json` 声明 `video-overlay`。
- **理由**：FR-010 需要自动换行后的实际块高。mpv 原生 `compute_bounds` 能返回 bounds，但 [IINA JavaScript bridge](https://github.com/iina/iina/blob/develop/iina/JavascriptAPIMpv.swift) 的 `command` 明确返回 `void`；公开插件 API 无法读取结果。WebView 可用 DOM 实际布局完成精确钳制，且用户已授权权限扩展。
- **备选方案**：固定行高、按输入行数估算或在低值切换 `\an8` 会在自动换行和不同字体下产生裁切或跳变；新增另一条测量渲染后端会保留双路径，违反当前功能最小化。

## 固定字体视觉校准

- **决策**：以 010 的 ASS `40/720` 常规字重可见字形为视觉基准，WebView 固定使用 `29/720 × viewportHeight` 的 CSS 字号与 400 字重，黑色描边继续使用 `2/720 × viewportHeight`；viewport 变化时先更新字体样式，再测量 DOM 块高和计算位置。
- **理由**：ASS/libass 与 DOM/WKWebView 的字体度量不同，相同名义字号不会产生相同可见字形。对同尺寸参考截图中的共享字形进行外接框比较后，CSS 40/720 明显偏大，约 29/720 才接近 ASS 40/720；显式使用常规字重可避免 WebView 默认或继承样式造成额外加粗。
- **备选方案**：直接沿用 CSS 40/720 会让译文明显放大；按内容临时缩小或开放样式设置会改变固定视觉与功能范围；同时缩小 2/720 描边会偏离 010 的轮廓基线。

## 非交互式 Overlay

- **决策**：Main 初始化时调用 `overlay.setClickable(false)`，Overlay HTML 不包含 `data-clickable`，不注册 pointer、mouse、touch 或 keyboard handler。
- **理由**：[IINA WebView 文档](https://github.com/iina/iina-plugin-definition/blob/master/pages/webviews.md) 说明 Overlay 默认不交互，启用点击可能吸收播放器输入。当前规格明确排除画面拖动，保持非交互可保护单击暂停、双击全屏、窗口拖动和快捷键。
- **备选方案**：让译文块可拖会新增用户故事、保存入口和输入冲突矩阵，不属于本功能。

## 块底部定位与顶部钳制

- **决策**：Overlay 在 DOM 完成文本布局后读取块高。Main 读取 `sub-margin-x`、`sub-margin-y` 和 `sub-margin-y-offset`，无效时分别回退 IINA 默认 25、22 和 0。顶部边界直接使用有效区域顶部，不应用纵向 margin；底部边界扣除不超过区域高度一半的有效字幕纵向 margin。原始底部锚点在两者间按位置值线性插值，最终底部为 `max(rawAnchor, top + blockHeight)`，并钳制不超过底部边界。块高超过有效区时沿用容器裁切。
- **理由**：[IINA 启动配置](https://github.com/iina/iina/blob/develop/iina/MPVController.swift) 把用户的字幕位置和 margin 分别映射到 `sub-pos`、`sub-margin-x/y`，[IINA 默认值](https://github.com/iina/iina/blob/develop/iina/Preference.swift) 为 25 和 22；[mpv 字幕实现](https://github.com/mpv-player/mpv/blob/master/sub/sd_ass.c) 把 `sub-pos` 转为 libass line position，[libass 定位公式](https://github.com/libass/libass/blob/master/libass/ass_render.c) 的顶部端点不使用 `MarginV`，底部端点才保留它。原实现读取并对称应用 `osd-margin-x/y`，会使 0、100 两端都额外向内收。底部锚点和实际块高钳制继续满足 FR-010。
- **备选方案**：把 101 个值重新映射到“减去块高后的可移动距离”会让所有值严格线性移动，不符合已确认的 IINA/mpv 顶部钳制语义；CSS transform 不读取块高仍会在顶部裁切。

## 有效垂直区域与宿主黑边配置

- **决策**：Main 读取 mpv `osd-dimensions` 的 `h/mt/mb`，以 `mt/h` 和 `(h-mb)/h` 表示实际视频区域。窗口模式使用视频区域；全屏时若 `sub-use-margins` 为真则使用完整 `[0,1]`，否则使用视频区域。无效或缺失几何安全回退到 `[0,1]`，下一次有效检测再收敛。
- **理由**：[mpv `osd-dimensions`](https://mpv.io/manual/stable/#property-osd-dimensions) 的 margins 描述视频在 OSD 中的实际区域；[IINA MPVController](https://github.com/iina/iina/blob/develop/iina/MPVController.swift) 把 `displayInLetterBox` 同时映射为 `sub-use-margins` 与 `sub-ass-force-margins`。使用宿主已应用的 flags 不需访问 IINA 私有 preferences。
- **备选方案**：用窗口 frame 和视频宽高自行计算无法可靠覆盖裁切、旋转、HiDPI 和宿主 viewport；读取 plugin preferences 得不到 IINA app 的设置。

## 几何与生命周期重算

- **决策**：`overlay-region-runtime.ts` 在 Main 安全初始化时分别读取并缓存 `osd-dimensions`、`sub-margin-x`、`sub-margin-y`、可用的 `sub-margin-y-offset` 与 `sub-use-margins`；单项读取失败只使用该项默认值。标量 margin 使用对应 `mpv.*.changed` 事件刷新；`osd-dimensions` 与 `sub-use-margins` 每 100 毫秒独立检测，只有归一化区域变化才重排。`iina.window-fs.changed` 使用事件参数更新缓存，不读取 mpv；普通窗口 resize 只由 Overlay WebView 使用缓存重排。`mpv.shutdown` 与 `iina.window-will-close` 共用幂等清理，先停定时器、解除监听并关闭缓存，再销毁 Overlay。
- **理由**：IINA 1.4.4 的 [JavascriptAPIEvent](https://github.com/iina/iina/blob/v1.4.4/iina/JavascriptAPIEvent.swift) 对未列入内建观察表的 mpv 属性使用默认格式注册，而 [MPVController](https://github.com/iina/iina/blob/v1.4.4/iina/MPVController.swift) 的内建表不含 `osd-dimensions` 与 `sub-use-margins`；node 与 flag 的动态通知因此不能作为可靠刷新入口。生命周期受控的变化检测可直接获得宿主已应用值，值不变时不发送 layout。IINA 在退出全屏和应用退出期间仍可能发送窗口事件，而 mpv 句柄可能已销毁；shutdown/close 双入口清理保证之后不再调用属性 API。独立缓存同时避免一个可选属性缺失时把已成功读取的黑边状态与视频区域一起丢弃。
- **备选方案**：依赖这两个不可靠属性事件会保留动态开关失配；窗口事件中重新读取完整 mpv 状态会扩大关闭竞态；用一个 `try/catch` 包住全部读取无法隔离属性缺失，也无法捕获宿主原生段错误；每个 tick 无条件发送 layout 会产生无效重绘。

## Overlay WebView 生命周期与隐私

- **决策**：Main 先调用空的 `simpleMode()` 并等待 `iina.plugin-overlay-loaded`，再加载包内 `overlay.html`、CSS 和 classic script；这规避 IINA 1.4.4 在尚未完成 Overlay WebView 初始化时静默丢失 `loadFile()` 的宿主时序。生产页面使用 CSP `default-src 'self'; connect-src 'none'; img-src 'none'` 禁止网络和远程资源。WebView 只向 Main 发送无 payload 的 ready；Main→Overlay 消息仅含当前真实译文、位置和归一化区域。clear、禁用、seek、换片、关闭与会话失效立即清空 DOM 和适配器缓存。
- **理由**：空 Simple Mode 只用于宿主预热，不显示或接收正文，也不形成第二条译文渲染路径；译文跨入正式 WebView 是显示所必需的最小运行期流动。本地资源、CSP、非交互和及时清理保持宪法 III 的正文边界。
- **备选方案**：在 Overlay 自行 fetch 或读取 storage 会新增网络/持久化边界；把字幕时间线送入 WebView 会超过当前显示所需数据。

## 偏好读取、保存与失败回滚

- **决策**：新增 `translationOverlayPosition`，只接受 0 至 100 的整数；缺失或无效时内存返回 0。保存执行 `set + sync`，失败时恢复先前值或 property-list-safe 缺失 sentinel，再抛出固定安全错误。拖动预览不写 preference。
- **理由**：沿用现有 `TargetLanguagePreferences` 的已验证模式可保证重启恢复、无效输入回退和失败不伪装成功，同时避免连续拖动放大同步 I/O。
- **备选方案**：每次 `input` 保存会阻塞交互并增加失败面；在 Main 分别写入会破坏全局顺序和多窗口一致性。

## 跨窗口顺序与广播

- **决策**：Global 是唯一权威，按收到 preview/save 的顺序分配单调 `intentSequence`，成功保存时递增 `committedRevision`。预览、提交和回退通过 deferred `global.postMessage(null, ...)` 广播全部 Main；源窗口另收 request-correlated save result。接收方只应用不小于当前 sequence 的显示状态，迟到响应不得移动浮层或改写 Sidebar。
- **理由**：IINA preferences 不提供跨窗口 CAS；Global 接收顺序是可观察的唯一总序。保存为同步串行操作，最后到达且成功的 intent 成为最终提交；较新失败恢复最后成功值。
- **备选方案**：复用逐窗口 envelope revision 或 `TargetLanguageSession` 无法建立跨窗口全序；按完成时间取胜会违反 FR-014。

## Sidebar 交互

- **决策**：使用原生 `<input type="range" min="0" max="100" step="1">` 和可访问数值输出。`input` 严格校验并预览；`change` 与窗口级 `pointerup`、`pointercancel`、`mouseup`、`touchend` 统一调用按交互状态去重的完成入口，使 WKWebView 未为触控板纯拖动发出 `change` 时仍保存最终值。保存期间仍允许产生较新 intent，反馈和回退只接受当前 request/sequence。其他设置页通过 Main state 与安全 `ui:poll` 收敛。
- **理由**：原生 range 提供指针端点钳制和键盘行为，但宿主 WKWebView 的触控板纯拖动可更新值而不发出 `change`。窗口级结束信号能覆盖指针在控件外结束的情况，状态去重能避免同一次拖动因 `change` 和多个结束信号重复保存；本页 DOM 与本窗口 Overlay 仍在 `input` 时立即更新。
- **备选方案**：按 `input` 空闲时间防抖保存会在拖动短暂停顿时写入中间值；只增加 range 自身的结束监听会漏掉在控件外结束的拖动；自制拖动条增加无障碍和指针边界复杂度；额外 Save 按钮违反自动保存需求。

## 构建、打包与披露

- **决策**：Parcel 新增 `overlay` target；构建、验证、pack 和 release audit 把 `dist/ui/overlay.html` 及其生成资源纳入正式清单。`Info.json` 增加 `video-overlay` 和英文用途说明，根 README、全部当前多语言 README 与开发文档说明该权限只用于非交互式本地译文显示。
- **理由**：权限与新运行时资源属于公共交付契约，正式包必须可重建、完整且不含多余材料。
- **备选方案**：运行时拼接全部 HTML/CSS 会削弱 CSP、构建和包审计；不更新披露会让安装权限说明与实际行为不一致。

## 验证边界

- **决策**：自动化覆盖全部整数、布局公式、竞态、偏好回滚、消息白名单、WebView CSP/非交互、生命周期、隐私和包清单；正式包在 IINA 1.4.0 与 1.4.4 由一名开发者验证权限提示、DOM 视觉、黑边配置、两个窗口、输入不被拦截和真实可见延迟。
- **理由**：Node 测试能证明确定性生产逻辑，但不能替代 WKWebView 字体度量、宿主 margin 事件、正式权限和播放器交互。
- **备选方案**：只做截图或只解析 SDD 不能证明生产行为；开发链接不能证明正式包权限与资源完整性。
