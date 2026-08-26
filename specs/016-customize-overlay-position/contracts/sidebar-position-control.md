# 契约：Sidebar 译文位置控件

## 结构与无障碍

- 区域标题必须为 `Subtitle`，其中提供一个标签为 `Position` 的原生 range：`min="0"`、`max="100"`、`step="1"`。
- 控件旁始终显示同一整数值；range、输出和反馈具有稳定的可访问名称与关联。
- 保存反馈使用紧邻控件的 `role="status" aria-live="polite"`，只显示安全的 saving、saved 或 save failed 状态。
- 窄 Sidebar 可换行，但 range、数值和反馈不得被截断；不增加单独 Save 按钮。

## 初始化与同步

- 首次 hydrate 使用 Main 提供的权威 `position/committedPosition/intentSequence/committedRevision`；缺失或无效时显示 0。
- 本页未处于更新交互时，接受不旧于当前 sequence 的远端 preview/commit/revert，并同步 range 与数值。
- 本页交互和 pending save 期间仍按全局 sequence 比较；不得因 `ui:poll` 无条件覆盖较新的本地或远端 intent。
- 其他设置页的更新最终必须通过 Main state 收敛；不得从 preferences 直接轮询或读取正文。

## 交互

| 事件 | 行为 |
| --- | --- |
| `input` | 读取 range 原生整数，立即更新数值并发送 preview；不保存。 |
| `change` | 完成本次交互；若尚未提交，发送当前值的一次 save，记录最新 request ID 并显示 saving。 |
| `pointerup`、`pointercancel`、`mouseup`、`touchend` | 在窗口级完成触控板或指针拖动；仅当本次 `input` 尚未由其他结束信号提交时保存一次。 |
| 指针越界 | 依赖 range 钳制为 0 或 100，不发送范围外值。 |
| 快速往返 | 每次有效 input 产生更新 intent；只呈现最新 sequence，不回放中间值。 |
| 无当前译文 | 控件和保存照常工作；不得要求或生成预览文本。 |

键盘调整必须沿原生 range 的方向：数值增大使译文向下。一次已提交的键盘 change 自动保存，不要求额外操作。触控板纯拖动不得依赖后续单击或宿主额外发出 `change`；拖动期间的短暂停顿不得保存中间值。

## 成功、失败与竞态

- 当前 request 成功且 sequence 未过时时，把权威值设为 committed、清除 pending 并显示 saved。
- 当前 request 失败且 sequence 未过时时，range、数值与所有浮层恢复最后 committed，并显示 `Translation position could not be saved. The previous position remains active.`。
- 旧成功、旧失败、重复结果和未知 request 不得清除较新 busy、改变数值、移动浮层或替换反馈。
- 多页面同时操作时，Global 接收顺序为总序；最后发起且保存成功的值最终生效，较新失败恢复到它之前最后成功的值。
- 位置失败不得禁用翻译、阻塞播放、清空当前译文或恢复过期正文。

## 范围边界

- 控件只改变全局垂直位置；不得改变横向位置、字体、颜色、描边、内容、时序、Profile 或窗口归属。
- 本功能不在播放器 Overlay 上提供拖动、焦点、hover 控件或任何其他输入入口。
