# 契约：原生样式选择 helper

## 产物与职责

- 产物固定为 `dist/native/subtandem-style-picker`，Swift 6、macOS 12、arm64/x86_64 universal、权限 755、ad-hoc 签名有效，只允许系统动态依赖。
- helper 只提供系统颜色面板、字体族选择、字体可用性与目录变化通知；不得写 plugin preference、读取媒体/字幕、持有 Provider/凭据、访问外网或写持久文件。
- Global 是唯一进程管理者和样式权威；同一时间最多一个 helper 实例和一个 active native picker。

## 启动与认证

Global 通过 `iina.utils.exec` 启动 `subtandem-style-picker serve`。stdout 只能输出一条 ready JSON：

```json
{ "protocolVersion": 1, "port": 49152, "token": "opaque-random-token" }
```

- port 必须由 IPv4 `127.0.0.1` 随机绑定产生；不得绑定 wildcard、IPv6 wildcard 或固定端口。
- token 必须使用系统安全随机源生成，只存在于 Global/helper 内存，不得写日志、状态、诊断或 Sidebar。
- 除 ready frame 外 stdout/stderr 不得输出正常事件、颜色、字体或内部详情。
- ready 超时、非法 shape、提前退出或非零状态均视为安全失败；不得回退到未认证服务。

后续请求使用 `Authorization: Bearer <token>` 与 JSON content type。缺失/错误 token、未知 endpoint/method、未知字段、过大 body 或无效 JSON 必须拒绝且不得改变 panel 状态。

## HTTP 接口

### `POST /v1/color/open`

```json
{
  "requestId": "picker:8",
  "color": { "r": 255, "g": 255, "b": 255, "a": 128 }
}
```

打开 `NSColorPanel.shared`，启用 alpha 与 continuous action。返回 `opened`；已有 picker 时前置当前窗口并返回 `focused`。target field/player 不得发送给 helper。

### `POST /v1/font/open`

```json
{
  "requestId": "picker:9",
  "fontFamily": null,
  "fontSize": 40,
  "bold": false,
  "italic": false
}
```

打开 family-only AppKit panel。固定本地 preview 文本由 helper 自身提供；请求不得含字幕/译文。返回 `opened`；已有 picker 时前置当前窗口并返回 `focused`。

### `POST /v1/font/status`

```json
{ "fontFamily": "Example Family" }
```

返回 `available | unavailable` 与当前 `catalogRevision`。`null` 系统字体始终 available。

### `GET /v1/events?after=<revision>`

认证 long-poll；返回严格大于 after 的有序事件，或在有界超时后返回空数组。服务端只保留有界事件窗口，客户端遇到 gap 必须重新查询当前 picker/font 状态，不得猜测。

### `POST /v1/activate`

只接受当前 `requestId`。活动 picker 存在时将其窗口置于顶端并返回 `activated`，否则返回 `unchanged`；不得创建 session、发送事件或改变样式。

### `POST /v1/cancel` 与 `POST /v1/shutdown`

cancel 只接受当前 requestId；关闭 panel 并发 cancelled。shutdown 关闭 panel、HTTP listener 和 AppKit run loop。重复请求幂等。

## 事件

每条事件包含递增 `revision`、`requestId`、`type` 及该类型精确 payload：

- `color-preview`：有效 sRGB RGBA；Global 建立新 preview intent。
- `color-closed`：`changed` 与最后 RGBA；changed 时提交 session 最后 preview intent，未变化不保存。
- `font-confirmed`：`fontFamily` 为有效 family 或 null；Global 创建一次 commit intent。
- `font-cancelled`：无字体值，不改样式。
- `font-catalog-changed`：只含 `catalogRevision`；Global 用当前 preferred family 查询 status 后广播 availability。
- `picker-failed`：固定安全 code；不得包含 AppKit/字体路径/内部错误。

事件不得包含 target field、player ID、媒体、字幕、译文、preference、token 或路径。Global 只接受当前 session requestId 且 revision 更新的事件；focused、迟到、重复和取消后的事件不得改样式。

## 颜色面板

- 使用 `NSColorPanel.shared`、`showsAlpha=true` 与 continuous target/action。
- 输入/输出在 native 边界转换为 sRGB；通道量化为 0 至 255 整数，转换失败不发 preview。
- panel 关闭保留最后选择；未变化关闭发 `changed=false`。
- 点击 panel 外部使其失焦时按正常关闭处理；重复打开请求只将现有 panel 置于顶端。
- helper 只在用户请求后激活 accessory app；关闭时不得在用户已切换应用的情况下强抢焦点。

## 字体面板与目录

- 面板只选择 family，包含 `NSSearchField`、`NSTableView`、family 名称、固定本地 preview、Choose 与 Cancel。
- 搜索匹配 family/localized display；保存值始终为稳定 family。Size/Bold/Italic 只用于 preview，不由面板修改。
- 初始焦点在搜索；方向键移动列表，Enter 确认，Escape 取消；标准控件必须有 accessibility label/value/help 和焦点环。
- 使用 `NSFontManager.availableFontFamilies` 与 family members 生成列表；监听 Core Text 字体注册变化并递增 catalogRevision。
- helper 不可用时不得改写 preferred family；Global 以 unknown 状态安全降级并提供非阻塞错误。

## 生命周期、构建与隐私

- helper 监控 parent PID；IINA 退出时必须结束。Global 正常结束显式 shutdown，所属窗口关闭时取消 picker。
- 崩溃、HTTP/认证失败或事件 gap 不得阻塞播放；若本 session 已产生颜色 preview，则 Global 使该交互失效并恢复 committed 整组状态。
- Swift 测试直接覆盖协议 parser、认证、RGBA、字体过滤、事件顺序和生命周期纯逻辑；真实 AppKit panel、键盘、VoiceOver 与高对比度由单人实机验收。
- `build-native.sh`、`test-native.sh`、native hash、verify/pack、release audit 与工作流必须把第三 helper 纳入精确清单，不得放宽为通配 allowlist。
