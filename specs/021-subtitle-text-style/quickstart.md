# 验证指南：字幕文本样式设置

## 前置条件

- macOS 12+、Node.js 24、npm 11、Swift 6、Xcode Command Line Tools。
- IINA 1.4.0 基线与 IINA 1.4.4 固定发布版；最终包覆盖 arm64/x86_64 native 产物。
- 准备一段能持续显示 SubTandem 单行、多行和自动换行译文的本地媒体；证据不得记录字幕或译文正文。
- 使用本功能的[消息契约](./contracts/subtitle-style-messages.md)、[picker 契约](./contracts/style-picker-helper.md)与[渲染契约](./contracts/subtitle-style-rendering.md)判定结果，不复制内部实现。

## 聚焦自动化

实现后运行：

```sh
npx vitest run tests/unit/subtitle-style.test.ts tests/unit/subtitle-style-sync.test.ts
npx vitest run tests/unit/sidebar-state.test.ts tests/unit/overlay-state.test.ts
npx vitest run tests/contract/subtitle-style-messages.test.ts tests/contract/subtitle-style-preferences.test.ts tests/contract/style-picker-client.test.ts
npx vitest run tests/contract/sidebar-form.test.ts tests/contract/sidebar-lifecycle.test.ts tests/contract/overlay-webview.test.ts
npx vitest run tests/integration/subtitle-style-lifecycle.test.ts tests/integration/overlay-webview-lifecycle.test.ts tests/integration/performance.test.ts
npx vitest run tests/security/subtitle-style-privacy.test.ts tests/security/credential-leakage.test.ts tests/security/redaction.test.ts
npm run test:native
```

预期：

- 默认值、坏 JSON 逐字段回退、RGBA alpha、全部 Size/Width 枚举和 raw preference 回滚通过。
- 不同字段合并、同字段最后 intent、旧 picker 晚关闭、superseded、延迟/乱序结果和失败整组回退均不回跳。
- helper 认证、严格协议、事件 revision、颜色规范化、字体目录通知、cancel/shutdown 与正文隔离通过。
- Overlay 默认保持 29/2 基线，Width 0 无轮廓；样式先应用再重测，背景只位于内层文本块。
- 无当前译文不生成正文；样式状态、preference、picker、错误和日志不含字幕或译文。

## 完整门禁与正式包

代码变更完成后重新执行全部命令，不得沿用变更前结果：

```sh
npm test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

预期第三 helper 与已有 helper 一样为 macOS 12 arm64/x86_64 universal、权限 755、签名有效、哈希匹配且只有系统动态依赖。正式包精确包含 `dist/native/subtandem-style-picker`，不包含 native 源码、测试、构建缓存、运行状态、字幕、译文、字体路径、token 或秘密材料；release audit 与工作流使用同一精确清单。

## IINA 正式包人工验收

1. 移除开发链接，安装本次 `.iinaplgz`，记录包版本/SHA-256、macOS、架构与 IINA 版本。
2. 打开 Sidebar，确认八项只位于 Subtitle/Position 后，默认依次为白色、40、System Default、非粗体、非斜体、黑色、3、透明。
3. 显示真实译文，逐项切换全部 Size/Width；确认 40/3 与升级前 29/2 视觉一致，Width 0 无固定阴影或轮廓。
4. 对 Font/Border/Background 分别选择不透明、半透明和透明预设；确认只改变发起字段，背景只覆盖单行/多行文本块。
5. 分别从三个 Color 进入 `Show Colors…`，拖动系统颜色与 alpha；确认当前译文实时预览，关闭保留最后选择，未变化关闭不保存；紧凑色盘和系统颜色面板都可点击外部关闭。
6. 打开 Font picker，搜索并预览字体；Cancel 保持原值，Choose 后当前译文立即改变。将活动 picker 遮挡后再次点击 Font 或 `Show Colors…`，确认只静默前置活动窗口且无冲突错误或无响应。测试无独立 Bold/Italic face 的字体，确认译文仍可见。
7. 通过系统字体管理停用当前请求字体，确认 Sidebar 显示 fallback 且 Overlay 使用系统字体；重新启用后无需重新保存即自动恢复。
8. 在单行、显式多行、自动换行、超长文本与 Position 0/100 下调整 size/font/bold/italic；resize/fullscreen 后确认横向居中、背景边界、顶部钳制和已保存 Position 不变。
9. 清空当前译文后继续调整并保存，确认 Overlay 不生成示例、源字幕或占位文字；下一条真实译文使用最新样式。
10. 打开两个播放窗口与两个 Sidebar，交错修改不同字段，确认合并；交错修改同一字段，确认最后实际有效编辑胜出且旧 panel 晚关闭不覆盖。
11. 重开 Sidebar、切换媒体、新建窗口并重启 IINA，确认八字段恢复且全部当前窗口一致。
12. 使用键盘完成八字段、palette、系统颜色面板与字体 picker；在亮色、暗色、提高对比度/强制颜色外观下确认 label、值、选中、fallback、busy、错误和焦点可辨识。

浏览器控制与 Computer Use 未获授权不得用于这些步骤；由开发者按以上步骤手动操作。

## 时延与稳定性

对当前真实译文执行 50 次覆盖全部字段的有效调整，以 60fps 或更高录屏按帧统计从用户有效变化到最新样式可见的时间：至少 95% 不超过 200 毫秒。记录只包含字段类别、序号、耗时和通过/失败，不包含颜色以外的用户数据，更不得包含字幕或译文。

同时确认：样式回跳 0 次、播放中断 0 次、字幕内容错误 0 次、Position preference 改写 0 次。Node 性能测试不能替代 WKWebView 实际绘制证据。

## 失败与安全验收

- 自动化注入 preference set/sync 失败，确认 raw 尝试回滚、八字段恢复最新 committed、只显示安全错误且无 Retry；旧结果不得覆盖后续成功。
- 注入 helper ready/认证/事件 gap/崩溃，确认已有颜色 preview 安全回退，picker 可在下一次用户操作重启，视频、原字幕与翻译继续。
- 检查 Global/Sidebar/Overlay/helper 消息、preference、日志和诊断 sentinel：字幕/译文命中数必须为 0；helper 只绑定认证的 `127.0.0.1` 且无外网连接。
- 卸载正式包后确认 style-picker 进程结束；重新安装可恢复持久样式，但不得恢复 picker session、正文或运行时 token。

## 验收记录边界

只记录包版本/hash、macOS/IINA/架构、字段/场景类别、时延、状态与通过/失败。不得记录媒体路径、字幕正文、译文、字体文件路径、helper token、Provider 请求或凭据。
