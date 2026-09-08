# 缺陷评估：侧边栏轮询触发 IINA 崩溃

- **标识**：`iina-sidebar-message-crash`（自动生成）
- **日期**：2026-09-08
- **来源**：用户提供的 IINA 崩溃报告，崩溃时间为 2026-09-08 19:05:15 +0800；关键证据摘录如下。
- **轨道**：轻量诊断，仅评估归因。
- **判定**：崩溃有效；SubTandem 轮询触发及宿主空值解包已确认，回调失效原因待复现。
- **严重程度**：高；导致整个播放器退出。

## 现象

IINA 1.4.4（168）、ARM64、macOS 26.6.2 在主线程发生 `EXC_BREAKPOINT (SIGTRAP)`。
预期插件侧边栏消息在回调失效时被安全忽略，不应终止宿主。

关键调用栈：

```text
JavascriptMessageHub.callListener(forEvent:withDataString:) + 2136
JavascriptMessageHub.receiveMessageFromUserContentController(_:) + 268
JavascriptAPISidebarView.userContentController(_:didReceive:) + 64
WebKit ScriptMessageHandlerDelegate::didPostMessage(...)
```

## 归因证据

1. 报告的 `x23 = 0x006c6c6f703a6975`，按小端字节解码为 `ui:poll\0`。
   同版本二进制显示函数入口通过 `mov x23, x0` 保存事件名的第一部分，并在回调查找时使用该寄存器。
2. `ui/sidebar.ts:1798` 每 750 ms 发送 `ui:poll`；`src/main.ts:455` 注册其回调。
   当前安装的 SubTandem 0.1.3 产物包含相同发送与接收代码；检查的其他已安装插件脚本未出现该消息名。
3. 本机 IINA 的 ARM64 UUID 与报告完全一致：`3FCBBE5C-67D3-33B3-9467-A86D52874731`。
   将报告加载基址 `0x100ee8000` 还原到 Mach-O 基址 `0x100000000` 后，
   `pc = 0x10109d118` 对应 `0x1001b5118`，`lr = 0x10109c99c` 对应 `0x1001b499c`。
   该二进制反汇编为：

   ```text
   1001b4990: bl  _objc_msgSend$value
   1001b4998: bl  _objc_retainAutoreleasedReturnValue
   1001b499c: cbz x0, 0x1001b5118
   1001b49a4: bl  _objc_msgSend$context
   1001b5118: brk #0x1
   ```

   报告中的 `x0 = 0`，与取得 `JSManagedValue.value` 后因空值跳转到陷阱完全吻合。
4. [IINA v1.4.4 的消息分发实现](https://github.com/iina/iina/blob/v1.4.4/iina/JavascriptMessageHub.swift#L56-L82)
   只检查字典中是否有 `JSManagedValue`，随后直接访问 `callback.value.context`。
   本机 macOS SDK 的 `JavaScriptCore/JSManagedValue.h` 明确说明，被管理的 JSValue 回收后，`value` 可以为 `nil`。

## 根因与边界

**高置信度结论**：SubTandem 的侧边栏轮询消息进入 IINA 后，宿主找到回调包装对象，
但其 JSValue 已为空；IINA 未检查空值就解包，在执行 SubTandem 的接收回调及解析本次消息正文之前崩溃。
因此，SubTandem 是本次触发来源，直接使整个应用退出的缺陷位于 IINA 原生消息桥。

**尚未确认**：回调为何失去保活，以及是否与插件生命周期或垃圾回收时序有关。
[侧边栏清理实现](https://github.com/iina/iina/blob/v1.4.4/iina/JavascriptAPISidebarView.swift#L23-L25)
仅移除标签，没有显式清空消息监听器，这是一条排查方向，不能据此断言本次发生了卸载。
报告记载距唤醒 51 秒；同次运行的宿主日志最后记录为 18:56:28 暂停播放，未检出插件卸载记录。
这些时间信息不能证明睡眠唤醒或卸载就是根因。

## 复现与验证

目前未复现，崩溃前的具体交互未知。建议开发者手动验证：

1. 使用同一 IINA 版本，仅启用 SubTandem，打开视频和插件侧边栏。
2. 分别观察暂停后等待、睡眠唤醒、关闭播放窗口、重载插件这些独立场景，并记录触发条件。
3. 用禁用 SubTandem 后的相同操作作对照；核对新增崩溃是否仍为相同调用栈。

这是排查方案，不是已经证实的复现步骤。一次未崩溃不能证明问题消失。

## 建议修复

**优先修复宿主**：IINA 在 `JavascriptMessageHub.callListener` 中先安全取得并局部保活
`callback.value` 及必要的 context，再解析数据和调用；失效时移除监听器或直接返回。
检查同类重载，并在侧边栏清理时清除监听器、解除 WebKit 消息处理器，阻止迟到消息访问旧上下文。
需要覆盖失效 managed value 和清理后的迟到消息，另做宿主实机验收。

**插件侧缓解候选**：`ui/sidebar.ts` 管理轮询 timer，在页面离开或关闭时停止发送；
评估 `src/main.ts` 与侧边栏的终止握手。现有轮询未保存 timer ID，也没有页面退出清理。
这些措施只能减少触发机会，无法保证回调在页面仍存活时不被宿主错误释放，也无法撤回已排队消息。
暂停隐藏页面轮询前应核对状态同步，防止重新打开侧边栏后状态滞后。

当前不建议仅修改轮询频率或添加 JS `try/catch` 后宣称修复；本次陷阱位于原生桥接层。

## 待确认

- 崩溃前是否关闭过窗口、重载或禁用插件，以及睡眠唤醒前后的操作。
- 回调失效是上下文释放还是存活上下文中的保活缺陷。
- 最小复现能否稳定触发，以及宿主防护后是否仍存在侧边栏停止更新的问题。

本次完成日志、安装产物、同 UUID 二进制和上游源码核对；未修改生产代码，未执行交互式自动化。
