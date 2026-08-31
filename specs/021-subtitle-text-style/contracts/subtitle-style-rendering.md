# 契约：字幕文本样式渲染

## DOM 与正文边界

Overlay 使用两层结构：

```html
<div id="translation" hidden>
  <span id="translation-text"></span>
</div>
```

- 外层透明、绝对定位、占用既有左右可用宽度，负责 Position、margin 与横向居中。
- 内层 `inline-block; max-width:100%; vertical-align:top`，负责文字、描边、背景和实际块高。
- 背景只应用内层；单行或多行都不得扩展为整个 Overlay 或完整可用宽度。
- 只有当前真实译文进入内层；使用 text node 与 `<br>`，不得使用正文 `innerHTML`。无当前译文时清空并隐藏，不生成示例、源字幕或占位文字。

Overlay 继续 `setClickable(false)`，不监听 pointer/mouse/touch/keyboard，不使用 fetch、XHR、WebSocket、storage 或远程资源；CSP 保持禁止连接与远程图片。

## 样式映射

完整 style 必须在测量前一次应用：

```text
scale = viewportHeight / 720
fontSizePx = selectedSize × 29/40 × scale
strokeWidthPx = selectedWidth × 2/3 × scale
fontWeight = bold ? 700 : 400
fontStyle = italic ? italic : normal
```

- Size 40 在 720p 为 29px；Width 3 为 2px；CSS 数值保留小数。
- fontColor、borderColor、backgroundColor 通过 CSSOM 映射为 sRGB `rgba()`。
- effective font family 非空时安全设置该 family 并附系统 fallback；null 使用现有系统字体栈。
- 不设置 `font-synthesis:none`；缺少独立 Bold/Italic face 时允许 WebKit 选择或合成最近呈现。
- Width 0 必须设置 stroke width 0、stroke color transparent、`text-shadow:none`；当前固定黑色 shadow 必须删除。非零 Width 也不得用固定 shadow 改变 Width 语义。
- Font/Background 透明、Width 0 或透明 Border 的组合原样显示，不自动纠正不可见字幕。

## Revision 与应用顺序

- `overlay:layout` 与 `overlay:render` 都携带完整 style；render 额外包含当前 lines。
- 样式、Position、region、正文和 clear 共用严格递增 `renderRevision`。WebView 只接受更大 revision 和精确 payload。
- Main 可去重完全相同的 style；任何字段或 fontResolution 的 effective family 变化都必须递增 revision。
- 有当前帧时 style 变化立即重绘和重测；无当前帧时只缓存最新 style，不创建 DOM 文本。
- ready 前 Main 最多缓存一个最新 style 和当前真实帧；ready 后首次 render 自带二者。clear 后旧 render/layout 不得恢复正文。

## 测量与位置回归

1. 应用 font family、size、weight、style、stroke、三种颜色。
2. 写入当前文本并显示内层。
3. 用合并后的单个 `requestAnimationFrame` 读取内层 `getBoundingClientRect().height`。
4. 使用既有 Position、有效区域、margin 和顶部钳制公式计算外层 top/left/right。

`ResizeObserver` 观察内层；字体解析、Bold/Italic、自动换行、background 不同 alpha 或 viewport 宽度变化导致尺寸变化时调度同一 latest-only rAF。每帧最多一次测量，不得按字符数、输入行数或固定行高估算。

Position 数值、横向居中、有效区域、顶部钳制、超高块裁切、resize/fullscreen/黑边行为继续遵循位置契约。样式变化只允许因字体度量改变换行和块高，不得修改 Position preference 或会话归属。

## 字体不可用

- preferred family 只存在于权威/Sidebar；Overlay 消费 Main 派生的 effective family。
- unavailable 时使用系统字体渲染且保留所有其他字段；正文不得消失或阻塞播放。
- Core Text 通知使 family 重新可用后，Main 重新发送同一持久 style 的新 effective family，Overlay 重测并恢复。
- helper availability unknown 时保留安全系统 fallback 栈并显示非阻塞状态，不得改写 preference。

## 验证边界

自动化必须覆盖全部 9 个 Size、10 个 Width 与 360/720/1080 viewport，Width 0、RGBA alpha、双层 DOM、严格 payload、clear/latest-only、字体重排和 Position 回归。WKWebView 实际绘制时延、系统字体外观、描边边界和背景覆盖由正式包实机验收；Node 结果不得替代宿主证据。
