# 数据模型：自定义译文浮层垂直位置

## 译文浮层位置偏好

插件范围的唯一持久值。

| 字段 | 约束 |
| --- | --- |
| `key` | 固定为 `translationOverlayPosition`。 |
| `value` | 0 至 100 的整数，包含端点；默认 0。 |
| `source` | `saved` 或 `default`；缺失、非整数和越界值均为 `default`。 |

读取默认值不得写盘。成功保存只持久化该整数；失败恢复先前持久值，不包含字幕、译文、窗口或媒体身份。

## 全局位置状态

Global 当前生命周期内的权威快照。

| 字段 | 约束 |
| --- | --- |
| `livePosition` | 最新已接受 intent 的显示值。 |
| `committedPosition` | 最近一次成功持久化的值。 |
| `intentSequence` | 每次接受 preview/save 后递增；跨窗口显示排序依据。 |
| `committedRevision` | 每次成功保存后递增；失败和预览不改变。 |
| `pendingRequestId` | 当前同步保存源请求的关联身份；不作为跨窗口顺序。 |

状态转换：

```text
restore ──有效读取──> live = committed
live ──preview(seq+1)──> 更新 live 并广播 preview
live ──save(seq+1) 成功──> live = committed = value；revision+1；广播 committed
live ──save(seq+1) 失败──> live = committed；广播 reverted
任意状态 ──旧 sequence 到达 Main/Sidebar──> 忽略显示变化
```

## 位置意图

一次设置页预览或保存请求。

| 字段 | 约束 |
| --- | --- |
| `requestId` | 发送页面范围的安全 ID；用于源结果关联。 |
| `playerId` | Global 从 IINA 回调上下文绑定，不信任 payload。 |
| `kind` | `preview` 或 `save`。 |
| `position` | 0 至 100 的整数。 |
| `intentSequence` | Global 接收后分配的全局单调值。 |
| `state` | `accepted`、`committed`、`reverted` 或 `stale`。 |

同名 request ID 可以存在于不同 player scope；只有 `intentSequence` 决定跨窗口显示顺序。

## 有效垂直定位区域

每个播放器的运行期布局输入，以 Overlay viewport 高度的比例表达。

| 字段 | 约束 |
| --- | --- |
| `top` | 0 至 1；不得大于 `bottom`。 |
| `bottom` | 0 至 1；不得小于 `top`。 |
| `fullscreen` | 当前 IINA 窗口全屏状态。 |
| `useMargins` | mpv 已应用的 IINA 黑边字幕配置。 |
| `marginX` | 当前 `sub-margin-x` 的非负 720p 逻辑值；无效时使用 IINA 默认 25。 |
| `marginY` | 当前 `sub-margin-y + sub-margin-y-offset` 的非负 720p 逻辑值；基值无效时使用 IINA 默认 22，offset 无效时使用 0。 |
| `geometryRevision` | 每次接受新几何后递增，只用于重新布局。 |
| `active` | `mpv.shutdown` 或窗口关闭前为 `true`；任一关闭信号到达后为 `false`，不再接受事件或读取 mpv。 |

各 mpv 输入独立读取和缓存；单项缺失或失败只回退该项，不清除其他有效输入。`osd-dimensions` 有效时，视频区域为 `mt/h` 至 `(h-mb)/h`。全屏且 `useMargins=true` 时区域为 0 至 1；其他情况使用视频区域。无黑边时两者相同。无效几何回退 0 至 1，不改变位置偏好。活动期每 100 毫秒独立读取 `osd-dimensions` 与 `sub-use-margins`，只在归一化区域变化时递增几何 revision；普通 viewport resize 只重算像素布局，全屏状态来自事件参数。`mpv.shutdown` 或窗口关闭开始后先停止定时检测，再转为 inactive 并解除几何监听。

## 当前译文帧

每个播放器当前唯一可显示正文，仅在内存和 DOM 中存在。

| 字段 | 约束 |
| --- | --- |
| `renderRevision` | Main 内单调值，clear 后旧消息不得恢复。 |
| `lines` | 当前真实有效译文行；不得为空白，不含未来 cue。 |
| `position` | 当前 live position 快照。 |
| `region` | 当前有效垂直定位区域。 |
| `state` | `absent`、`pendingWebView` 或 `visible`。 |

`absent` 状态不得构造占位内容。ready、resize、全屏或位置变化只可重放仍为 current 的帧；clear 立即删除适配器缓存与 DOM 文本。

## Overlay 布局状态

Overlay WebView 内的当前生产布局。

| 字段 | 约束 |
| --- | --- |
| `viewportHeight` | 当前 DOM viewport 的正有限高度。 |
| `fontSize` | `29/720 × viewportHeight`，用于接近 010 的 ASS `40/720` 可见字形。 |
| `fontWeight` | 固定为常规字重 400。 |
| `strokeWidth` | `2/720 × viewportHeight`，保持 010 的黑色描边基线。 |
| `blockHeight` | 译文块完成换行后的 `getBoundingClientRect().height`。 |
| `safeTop` | `region.top × viewportHeight`；与 libass 顶部端点一致，不应用纵向 margin。 |
| `safeBottom` | `region.bottom × viewportHeight - verticalMargin`。 |
| `rawAnchor` | `safeTop + (safeBottom-safeTop) × position/100`。 |
| `bottomAnchor` | `clamp(max(rawAnchor, safeTop+blockHeight), safeTop, safeBottom)`。 |
| `topOffset` | `bottomAnchor - blockHeight`；正常可容纳时不小于 `safeTop`。 |

每次 viewport 变化都先更新 `fontSize`、`fontWeight` 与 `strokeWidth`，再测量 `blockHeight`。`verticalMargin` 为 `min(region.marginY/720 × viewportHeight, 区域高度/2)`，只从底部边界扣除；左右换行边距为 `region.marginX/720 × viewportHeight`。当块高超过安全区域时，容器按现有可见边界裁切；除随 viewport 等比缩放外，不得为单条内容额外缩小字体、改变换行或改写正文。

## Sidebar 位置控件状态

| 字段 | 约束 |
| --- | --- |
| `displayPosition` | range 与数值输出当前显示的整数。 |
| `committedPosition` | 最近收到的权威成功值。 |
| `intentSequence` | 最近应用的全局显示 sequence。 |
| `committedRevision` | 最近应用的成功 revision。 |
| `interaction` | `idle` 或 `previewing`。 |
| `pendingSaveRequestId` | 当前页面最新保存请求；可为空。 |
| `feedback` | `idle`、`saving`、`saved` 或 `error`；错误不含内部异常。 |

本地 `input` 先更新 `displayPosition` 并把 `interaction` 设为 `previewing`；`change` 或窗口级指针、鼠标、触控结束信号仅在该状态下把它原子切换为 `idle` 并开始一次保存，因此同一次拖动的后续结束信号不会重复提交。权威 state 只有 sequence 不旧于当前值时才能覆盖。保存失败仅在对应 intent 仍为最新时回退到 `committedPosition`。
