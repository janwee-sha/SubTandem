# 字幕文本样式实机验收

## 正式包

- 生成日期：2026-09-01
- 版本：0.1.2
- 审计基线提交：`2183f6e68cd7b774c20643a7ac65e63ae9c2fa1e`（安装包由当前未提交工作区构建）
- 安装包：`build/package/SubTandem-0.1.2.iinaplgz`
- SHA-256：`06c318bf02bf90eaa101398f7b78b6df265c6c3f3e82c37a4ed5f4670c56ade6`
- 发布审计：通过；归档精确包含三个已签名的 macOS 12 arm64/x86_64 universal helper。

## 验收状态

| IINA  | 架构   | 执行者 | 状态   | 证据   |
| ----- | ------ | ------ | ------ | ------ |
| 1.4.0 | 待记录 | 待记录 | 待执行 | 待记录 |
| 1.4.4 | 待记录 | 待记录 | 待执行 | 待记录 |

## 单人验收记录

按[验证指南](../../specs/021-subtitle-text-style/quickstart.md#iina-正式包人工验收)依次记录以下结论，不得记录媒体路径、字幕或译文正文、字体文件路径、helper token、Provider 请求或凭据。

- 安装、默认值与八字段布局：待执行。
- 全部 Size/Width、三类颜色与 alpha：待执行。
- Font picker、Cancel/Choose 与字体 fallback/恢复：待执行。
- 单行、多行、换行、长文本、Position 与 resize/fullscreen：待执行。
- 多窗口合并、同字段最后有效编辑与持久化：待执行。
- 键盘、焦点、亮暗色和提高对比度：待执行。
- 50 次实际绘制时延：待执行；目标为至少 95% 不超过 200 ms，回跳、播放中断、正文错误和 Position 改写均为 0。
- preference/helper 故障恢复、消息与日志正文命中 0：待执行。
- 卸载后 helper 结束、重装只恢复持久样式：待执行。

完成两版 IINA 验收并附上不含正文的证据位置后，方可把 T066 标记为已验收。
