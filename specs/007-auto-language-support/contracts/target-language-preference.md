# 契约：目标语言选择与偏好提交

## 所有权

| 层 | 所有状态 | 禁止事项 |
| --- | --- | --- |
| Sidebar | 156 项选择器、committed 值、单一 pending 候选、操作反馈 | 不读写 preferences，不提前改变翻译上下文 |
| Main | 当前窗口已提交目标、revision、Controller 与会话失效 | 不在保存请求到达时直接写 preferences 或提前切换目标 |
| Global | `targetLanguage` 唯一有效语言值的持久化写入、校验、失败回滚 | 不保存字幕、源语言值、窗口候选或 Provider 专属目标 |

当前偏好对同一安装全局持久化；保存成功只立即切换发起窗口，其他已运行窗口保持各自当前会话快照，新窗口或完整重启读取最新成功值。

## 初始化读取

1. Main 在创建 Controller 前同步读取 `targetLanguage`。
2. 字符串且为目录成员时原样使用；缺失、非字符串或目录外值只在内存回退 `zh-Hans`。
3. `ui:ready`、`ui:poll`、打开 Sidebar 或切换窗口不得写默认值。
4. 首次 `state:update` 包含 `{targetLanguage, targetLanguageRevision}`。
5. Sidebar 首次 hydrate committed 和选择器显示值；用户选择不同值后立即建立唯一 pending，周期 poll 不覆盖 pending 候选。

旧的 `sourceLanguage` 与 `sourceLanguageMode` 在 Global 初始化的有界清理中覆盖为空字符串。空字符串是 IINA property list 可安全持久化的墓碑；不得写入 JavaScript `null`。Main、Sidebar、Controller、缓存、Provider 和日志永远不读取或发送这些值。

## 保存请求

Sidebar→Main→Global 沿用严格 RPC envelope：

```json
{
  "requestId": "language-save-opaque-id",
  "revision": 1,
  "payload": {
    "targetLanguage": "pt-PT"
  }
}
```

- 消息名：`defaults:save`。
- payload 必须恰好包含一个字符串 `targetLanguage`，且为目录成员。
- 不接受 `sourceLanguage`、`sourceLanguageMode`、`enabledByDefault` 或其他附加字段。
- Sidebar 只在已水合、无 pending 且选择值不同于 committed 时发送；每次有效选择只发送一个请求。
- Main 同一时间最多转发一个语言保存请求；pending 时 Sidebar 禁用选择器和重复提交。
- Global 使用 IINA 提供的权威 `playerId`，不接受 payload 中的播放器身份。

## Global 原子提交

1. 严格解析 envelope 与目录成员。
2. 记录先前 `targetLanguage` 的值或缺失态。
3. 执行 `preferences.set("targetLanguage", candidate)` 与 `preferences.sync()`。
4. 两步均无异常才发送成功回执。
5. 任一步抛错时恢复旧值；API 无删除时用空字符串墓碑表示缺失，再执行一次 `sync()`；不得用会破坏整份 property list 写盘的 `null`。
6. 回滚后发送固定错误；不得把异常文本透传。

成功回执 Global→Main：

```json
{
  "requestId": "language-save-opaque-id",
  "targetLanguage": "pt-PT"
}
```

- 消息名：`defaults:saved`。
- 只有 requestId 与当前 Main pending 匹配且语言等于候选值时可提交当前会话。

失败回执 Global→Main：

```json
{
  "requestId": "language-save-opaque-id",
  "code": "TARGET_LANGUAGE_SAVE_FAILED",
  "userAction": "NONE"
}
```

- 消息名：`operation:error`。
- 非法目录成员使用 `INVALID_TARGET_LANGUAGE`；写入或同步失败使用 `TARGET_LANGUAGE_SAVE_FAILED`。
- Main 清理对应 pending，不改变 Controller、committed state 或 revision，并向 Sidebar 返回失败操作结果。

## Main 成功提交

匹配的 `defaults:saved` 到达后，Main 按以下顺序提交：

1. 调用 `controller.setTargetLanguage(targetLanguage)`。
2. Controller 取消 Provider/重试工作、递增 session epoch、清译文、失败集合、错误、缓存与 overlay；当前字幕源和可靠识别结果保留。
3. 更新 committed target 与 revision。
4. 更新 `state:update`。
5. 向 Sidebar 发送 `operation:result`：

```json
{
  "requestId": "language-save-opaque-id",
  "ok": true,
  "action": "languages",
  "targetLanguage": "pt-PT",
  "targetLanguageRevision": 2
}
```

Sidebar 只在匹配 pending 时结束 busy；成功时采用返回的 committed 值和 revision，失败、取消或异常时恢复先前 committed 值。未知、迟到、重复或 Sidebar 重载前的 UI 回执不得改变新 WebView 状态或反馈。

## 恢复与失败矩阵

| 场景 | 当前窗口 | preferences | Sidebar |
| --- | --- | --- | --- |
| 首次使用 | `zh-Hans` | 不因读取而写入 | 显示 Chinese (Simplified) |
| 有效已保存值 | 恢复该值 | 不变 | 显示对应选项 |
| 缺失/非法旧值 | 内存使用 `zh-Hans` | 读取阶段不覆盖 | 显示默认 |
| 保存成功 | 立即切换并清旧工作 | 写入候选 | 采用返回的 committed 值和 revision 并提示成功 |
| 保存失败或取消 | 保持原语言与旧工作上下文 | 回滚原值 | 恢复 committed 值并提示失败或取消 |
| pending 时关闭 Sidebar | 当前语言不变 | 按实际提交结果决定 | 重开后从 Main committed 状态初始化 |
| 完整退出并重启 | 恢复最后成功值 | 保留最后成功值 | 首次 state hydrate 正确值 |

任何 preferences、Sidebar state、诊断或错误不得包含旧源语言值、字幕正文、识别样本、译文或凭据；旧源语言键若仍存在只能取空字符串。
