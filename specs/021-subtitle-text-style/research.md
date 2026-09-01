# 研究：字幕文本样式设置

## 样式存储格式

- **决策**：使用单一 `translationSubtitleTextStyle` preference 保存八字段 JSON 字符串。Size/Width 保存用户选项，颜色保存 `{r,g,b,a}` 四个 0 至 255 的 sRGB 整数，`fontFamily=null` 表示系统默认。读取时逐字段验证，缺失或无效字段只回退该字段；损坏 JSON 或非对象根无法局部恢复时整组使用默认值，读取回退不写盘。
- **理由**：单 key 最接近整组提交和整组回退；稳定整数 RGBA 可严格比较、保留透明度并直接映射 CSS。保存名义 Size/Width 可让控件保持 40/3，同时把视觉比例留在渲染层。仓库已有 JSON-string preference 模式，而 IINA preference 未提供事务、CAS 或可靠删除。
- **备选方案**：八个 key 会产生部分写入；直接保存 JS object 的 property-list 支持未得到本项目契约验证；保存 CSS/派生像素混合了偏好与渲染；Display P3 或浮点颜色会扩大当前未要求的颜色空间与精度契约。

保存执行单 key `set + sync`；失败时恢复保存前 raw 值并再次 sync，原值缺失时使用 property-list-safe 无效 sentinel。只有 sync 成功才能推进 committed；底层写入和回滚都失败时无法保证磁盘原值，必须失败关闭且不得报告成功。

## Global 权威与字段合并

- **决策**：Global 是唯一 preference 读写者。Sidebar 只发送严格单字段 edit，不发送本地整组快照。Global 为每次有效值变化分配单调 `intentSequence`，记录每字段最后 intent；`stateRevision` 排序每次完整状态广播，`committedRevision` 只在整组保存成功后递增。
- **理由**：IINA preferences 没有跨窗口 CAS，Global 接收顺序是唯一可观察总序。单字段 patch 避免旧 Sidebar 用整组副本覆盖其他窗口的较新字段；独立 state/intent/commit 序号允许旧字段交互稍后提交，同时不让同字段晚关闭的旧 picker 覆盖新编辑。
- **备选方案**：让 Main/Sidebar 写盘不能建立总序；仅 request ID 无法给全部窗口排序；仅 committed revision 无法排序预览；把 save 当作新的同字段编辑会让旧颜色面板仅因晚关闭而抢回胜者。

规则如下：

- preview 只 patch `liveStyle[field]`，不写盘；离散下拉、复选框和预设色可直接创建并提交一个 intent。
- 交互完成提交其最后一次实际值变化的 intent；若该 intent 已不是该字段最新值，则标记 superseded，不保存、不回跳。
- 候选持久值由 `committedStyle + 当前字段 patch` 产生，不能把其他字段尚未完成的 preview 一并写盘。
- 成功只确认该字段并保留其他仍有效 preview；失败恢复 raw preference、把 live 整组恢复 committed、终止受影响的交互并广播非阻塞错误。
- preference API 当前为同步 `set + sync`，Global 在一个临界段内串行保存；若未来改成异步，必须显式 FIFO，不能按 Promise 完成顺序决定胜者。

## 运行时消息与即时预览

- **决策**：新增严格白名单的 `subtitle-style:get|edit|state|save-result|picker-open|picker-result` 消息族。Main 收到本地有效 edit 后先更新本窗口 Overlay，再转发 Global；Global 延迟广播完整 live/committed state。Main/Sidebar follower 以 `stateRevision` latest-only，源结果只结束匹配的 per-field pending，旧结果不得改值或反馈。
- **理由**：本窗口无需等待 Global 往返即可满足 200 毫秒预览；完整权威快照让其他窗口最终收敛，也避免 follower 重复实现 patch 合并。现有 deferred Global post 可避开 IINA 原生回调栈问题。
- **备选方案**：Overlay/Sidebar 直接读 preference 会绕过权威；Overlay 消费字段 patch 会复制合并逻辑；单一全局 pending 会让一个控件清除另一个控件的等待状态。

无当前译文时只更新缓存，不创建示例、源字幕副本或占位 DOM。样式消息、状态、错误与日志均不得包含媒体、字幕或译文正文。

## 原生 picker 能力边界

- **决策**：新增 macOS 12 Swift/AppKit `subtandem-style-picker`，由 Global 以单实例管理。Sidebar 自己实现紧凑色盘；只有 `Show Colors…`、字体族选择和字体目录变化进入 helper。
- **理由**：IINA 1.4 的 [插件 API 定义](https://github.com/iina/iina-plugin-definition/blob/master/iina/index.d.ts) 只提供 WebView、基础 dialog、文件选择和外部进程，没有 `NSColorPanel`/字体面板 bridge；StandaloneWindow 仍是 WebView。HTML color input 在目标 WebKit 上没有可依赖的 alpha 和完整系统面板契约，Web 字体枚举也不可靠。
- **备选方案**：把 UI 合并进 transport 会让持有凭据/外网能力的进程同时管理系统面板；每次交互启动一次短进程无法持续监听字体恢复，且 `utils.exec` 不提供 stdin 或取消句柄；通用 Web picker 无法满足系统颜色面板和已安装字体契约。

helper 使用 accessory activation policy，只在用户打开 picker 时激活。它绑定随机 `127.0.0.1` 端口，启动 stdout 只输出 bearer token/端口 ready frame；Global 通过认证 JSON HTTP 与带 revision 的 long-poll 事件通信。该模式避免长生命周期 stdout 累积，也沿用现有 helper 的本机认证边界。helper 监控父进程，Global 正常退出时显式 shutdown；播放器关闭时取消其 picker。崩溃或协议失败只回退当前样式交互并显示安全错误，播放、原字幕和翻译继续。

## 颜色面板与颜色规范化

- **决策**：三个 Color 控件共用一个 Sidebar popover，预设项包含可读名称、色样和透明色。`Show Colors…` 通过 helper 打开 `NSColorPanel.shared`，启用 `showsAlpha` 与 continuous target/action；每次变化先转换到 sRGB、量化一次为 RGBA 整数并预览，关闭时提交最后 preview intent。未变化关闭不保存。
- **理由**：Apple 的 [`NSColorPanel.showsAlpha`](https://developer.apple.com/documentation/appkit/nscolorpanel/showsalpha) 与连续 action 能同时提供完整系统面板、透明度和实时预览；[`usingColorSpace(.sRGB)`](https://developer.apple.com/documentation/appkit/nscolor/usingcolorspace(_:)) 给 WebView 建立稳定颜色边界。提交既有 intent 可防止旧面板晚关闭覆盖另一窗口更晚的同字段编辑。
- **备选方案**：只存 RGB 会丢 alpha；持久化 archived `NSColor` 与 CSS 不互通且跨系统不稳定；每次连续变化都 sync 会扩大 I/O 与失败面。

一次只能有一个全局 native picker；重复或并发请求只将当前活动窗口置于顶端并静默结束新请求，不改变任何字段。helper event 不携带 Font/Border/Background target，Global 以本地 session 映射目标，防止跨窗口串改。紧凑色盘监听 WebView 外部指针与失焦，系统颜色面板监听窗口失焦，两者都在点击外部时按 changed/unchanged 语义关闭，避免不可见 session 阻塞后续 picker。

## 字体选择、回退与恢复

- **决策**：保存字体 family，系统默认使用 `null`；Bold/Italic 保持独立。helper 使用 `NSFontManager.availableFontFamilies`，提供只选 family 的 AppKit panel：`NSSearchField`、`NSTableView`、固定本地示例预览、确认和取消。只有确认创建新 intent；取消不改变 Overlay 或 preference。
- **理由**：标准 `NSFontPanel` 会暴露 size/traits 且没有稳定的确认/取消边界，自定义 family-only panel 更符合八字段独立语义。`NSFontManager` 可枚举和验证 family，并用当前 size/traits 在 helper 内预览，且无需传入字幕正文。
- **备选方案**：保存 localized display name 或 Bold face 会与独立 Bold/Italic 冲突；Canvas/Web 字体探测不可靠且扩大指纹面；用真实字幕作预览违反正文最小化。

合法但不可用的 family 继续保存在 committed preference。helper 监听 Core Text [`kCTFontManagerRegisteredFontsChangedNotification`](https://developer.apple.com/documentation/coretext/kctfontmanagerregisteredfontschangednotification)，Global 广播 availability 变化；Main 派生系统 fallback，重新可用后恢复请求 family 并触发重测，不再次保存。缺少独立 Bold/Italic face 时保留浏览器 weight/style synthesis，选择最近呈现，不隐藏译文。

## Overlay DOM、CSS 与重排

- **决策**：把 Overlay 文本拆为透明满宽定位器与 `inline-block; max-width:100%; vertical-align:top` 文字块。外层承担 Position、边距和居中，内层承担正文、字体、描边、背景和块高测量。`overlay:layout` 与 `overlay:render` 都携带完整规范化 style，并与正文、Position、region、clear 共用严格递增的 `renderRevision`。
- **理由**：当前单元素带 `left/right`，直接设置背景会铺满可用宽度；收缩内层只覆盖单/多行文本块，同时保留既有换行和 Position 公式。完整快照避免 WebView 混合不同 revision 的字段，也让 ready 后首次 render 自包含。
- **备选方案**：逐字段样式消息要求 WebView 复制合并；独立 revision 会增加 clear/样式竞态；逐行背景改变文本块语义和现有换行。

720p 映射：

- `fontSizePx = selectedSize × 29/40 × viewportHeight/720`
- `strokeWidthPx = selectedWidth × 2/3 × viewportHeight/720`
- Bold 为 700，否则 400；Italic 为 `italic`，否则 `normal`
- 三种 RGBA 分别映射 `color`、`-webkit-text-stroke-color` 与 `background-color`
- 指定 effective family 通过 CSSOM 设置并附系统 fallback；系统默认沿用现有系统字体栈

Width 0 同时设置描边宽度 0、描边色透明、`text-shadow:none`；删除当前固定黑色 shadow。CSS 像素保留小数。样式先应用，再由合并的 `requestAnimationFrame` 测量内层高度；`ResizeObserver` 覆盖字体解析、自动换行和 viewport 宽度变化，每帧最多一次测量。正文继续用 text node 与 `<br>`，不得使用 `innerHTML`。

## 无障碍与外观

- **决策**：Sidebar 色样与 palette item 使用原生 button、文字名称/当前 RGBA、选中标记、`aria-haspopup/expanded`、Escape 或外部点击关闭并按需归还焦点；所有下拉、复选框和 Font 按钮具有关联 label、值、busy 与错误，但不显示例行 saving/saved 操作消息。CSS 同时覆盖 `:focus-visible`、`forced-colors` 和 `prefers-contrast: more`。native panel 使用标准 AppKit 控件和 accessibility label/value/help。
- **理由**：颜色不可只靠填充辨认；原生 Web/AppKit 控件提供稳定键盘和辅助技术语义。字体 preview 同时显示 family 文本，系统 `NSColorPanel` 保留平台无障碍行为。
- **备选方案**：自绘色盘/列表会增加 roving focus 和系统外观兼容成本；整组 disabled/busy 会阻塞无关字段并掩盖并发状态。

## 构建、打包与跨规格风险

- **决策**：native build/test 增加 SwiftPM style-picker，构建 arm64/x86_64、lipo、权限、ad-hoc 签名、系统动态依赖和哈希。verify、pack、release audit、工作流与对应生产契约测试把第三 helper 纳入精确清单；`Info.json` 不新增权限或外网域，但更新 loopback helper 与 file-system 执行用途说明。
- **理由**：正式 `.iinaplgz` 是交付对象，新 native 组件必须与已有两个 helper 接受同等重建和审计。AppKit/CoreText/Network/Security 都是系统框架，不新增第三方许可。
- **备选方案**：只在开发链接中调用本机工具会形成未跟踪依赖；放宽 `dist/native` allowlist 会削弱最小包约束。

016 的固定样式描述和 018 的双 helper 清单会被本功能增量契约取代相应边界。依据宪法 VII，本次只在 021 记录依赖和风险，不修改其他规格产物；共享源码、脚本、工作流与项目文档仍属于实现范围。

## 验证策略

- preference：缺失、坏 JSON、逐字段无效、alpha、全部枚举、不可用字体保留、raw 回滚和安全错误。
- authority：不同字段合并、同字段最后 intent、旧 picker 晚关闭、成功不提交他字段 preview、失败整组回退、三类 revision 与延迟乱序。
- helper：token/port、认证、严格 JSON、事件 revision、颜色 sRGB/RGBA、字体目录通知、外部点击关闭、活动窗口前置、cancel/shutdown、父进程退出和无正文日志。
- Sidebar：八字段结构、palette 目标隔离、确认/取消、per-field pending、组级错误、键盘、focus 与高对比度。
- Overlay：全部 Size/Width 和 360/720/1080 映射、Width 0、RGBA、双层背景、latest-only、无正文、clear、ResizeObserver 与 Position 回归。
- 集成：50 次快速编辑、多个窗口交错、重开 Sidebar、换片、新窗口、重启 IINA、字体失效/恢复和播放不受影响。

Node 自动化只能证明处理与消息边界，不能证明 WKWebView 实际绘制延迟、AppKit 面板或 IINA 宿主行为；这些由一名开发者按 [quickstart.md](./quickstart.md) 完成正式包验收。
