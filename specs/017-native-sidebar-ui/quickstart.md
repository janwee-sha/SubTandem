# 验证指南：原生侧栏视觉与语言自动保存

## 前置条件

- macOS 12+、Node.js 24、npm 11、IINA 1.4.0+。
- 使用当前开发链接或同一构建产物完成全部实机步骤。
- 自动保存遵循[交互契约](./contracts/sidebar-interaction.md)和[状态模型](./data-model.md)。

## 聚焦自动化

```sh
npx vitest run tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts tests/contract/ui-messages.test.ts tests/contract/target-language-preferences.test.ts
npm run typecheck
npm run lint
```

预期：

- HTML 不含 `Save Languages`，普通操作保留异常状态区，并提供单一视觉隐藏辅助技术播报槽。
- 不同选择立即发出一个 revisioned `defaults:save`；相同选择不发送；等待期间选择器 disabled 且 busy。
- 匹配成功采用权威语言和 revision；失败、取消和异常恢复 committed；旧结果和 pending 期间 snapshot 不覆盖候选。
- 宿主插件标签下没有重复的 SubTandem 标题，Translate 与 Subtitle 共用首个分区标题行。
- 顶层 section 无圆角、阴影和模糊；Profile 与 Session 使用无嵌套 blur、无常驻外框的低对比分组。
- 输入框和选择器使用正常字重、低对比透明填充和无常驻描边；Model ID 下拉框与自定义编辑框之间保留 5px 间距；Position 轨道不使用大面积系统蓝。
- Translate 开关使用 44×20px 轨道与 26×16px 胶囊形滑块。
- Position 使用 20px 命中区内的 3px 中性轨道与 18×14px、7px 圆角的浅色矩形旋钮，不显示 WKWebView 默认深色凹槽、正圆轮廓、黑色外框或额外投影。
- Translate、Target Language、Position、Profile Save/Update/Create/Select/Delete 与成功的 Subtitle Retry 不显示可见 busy/success 消息；busy 在控件内表达，失败和部分成功就近可见。
- Profile Test 在卡片内保留 revision 绑定状态，成功不追加句式消息；模型刷新成功显示模型数量或空目录且不使用整行绿色强调，失败保留旧目录并说明原因。
- Profile 保存、Translate、Position、模型发现与服务配置的消息字段、请求和持久化契约继续通过。

## 完整自动化

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

对本次修改文件执行 Prettier 检查和 `git diff --check`。仓库其他无关文件的既有格式问题不计入本功能，但必须如实记录。

## IINA 单人实机验收

1. 在 macOS 亮色外观启动 IINA，打开任意视频和 SubTandem 侧栏；确认 Subtitle 与 Translation service 是全宽平铺分区，没有顶层白色悬浮卡片。
2. 核对根背景可透出宿主表面；宿主插件标签下不重复显示 SubTandem 标题，Translate 与 Subtitle 位于同一标题行，section 仅由细分隔线划分。
3. 核对 Translate 开关采用约 44×20px 轨道和胶囊形滑块，与 IINA 原生开关的高度、滑块轮廓及行内对齐接近；Position 与宿主滑块同样采用细中性轨道和 18×14px 的高圆角矩形旋钮，不出现 WebView 默认深色凹槽、正圆轮廓、黑色外框或额外投影；选择器、输入框和按钮紧凑且没有常驻亮色描边，Target Language 使用标签在上的全宽布局且不存在保存按钮，Model ID 下拉框与自定义编辑框之间有清晰但紧凑的垂直间距。
4. 选择一个不同目标语言；确认选择器立即进入不可操作状态且没有新增可见保存中消息；成功后恢复可操作并保留新值，且没有可见成功消息。
5. 重开 Sidebar、完整退出并重启 IINA；确认恢复最近成功语言，后续翻译使用该值。
6. 通过测试环境故障注入使保存失败；确认选择器恢复原语言并就近显示失败，随后可再次选择同一语言重试。
7. 切换 macOS 暗色外观并重开 Sidebar；确认背景不过度纯黑、分组不过度发亮、文字和交互边界清晰、系统蓝状态醒目但不铺满次要操作。
8. 缩窄播放器侧栏；确认服务字段回退为单列且无横向滚动。
9. 分别启用提高对比度、减少透明度和减少动态效果；确认边界增强、分组改用不透明语义底色、动画缩短。
10. 回归 Translate、Position、Profile Save/Update/Create/Select/Delete 与 Subtitle Retry；确认 busy 只在控件内表达，成功由最终控件或内容状态证明，不出现可见成功消息，失败仍就近可见。
11. 对未选择和已选择 Profile 分别执行 Test；确认卡片显示当前 revision 的 `Test passed` 或 `Test failed`，成功不再出现要求已选 Profile 再次 Select 的句式消息，失败保留可执行原因。
12. 手动刷新模型并覆盖非空、空目录和失败；确认刷新图标表达 busy，成功显示模型数量或 Custom 可用说明且不使用整行绿色强调，失败保留旧目录并显示原因。
13. 使用 VoiceOver 或 DOM 可访问性检查确认普通 busy/success 由单一视觉隐藏 live region 公布，可见异常只播报一次。

## 宿主差异记录

只记录 IINA 版本、macOS 外观、插件构建身份、通过或失败项及不含敏感数据的界面描述。顶部插件切换条、原生 AppKit vibrancy 和 WebView 外部背景差异属于宿主边界，不记为插件 CSS 缺陷。
