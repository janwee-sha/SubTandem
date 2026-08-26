# 自动化验证

当前门禁要求 macOS、Node.js 24、npm 11 与 Swift 6。正式结论以本次命令输出、Release 审计和 Git 历史为准，本文不保存过时的逐次大小或哈希。

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

内嵌字幕聚焦测试另见 [`specs/008-embedded-subtitle-translation/quickstart.md`](../../specs/008-embedded-subtitle-translation/quickstart.md)，覆盖：

- 外挂、内嵌、远程、图形与未知轨道的失败关闭分类；
- SubRip、ASS、SSA、`mov_text` 的真实小样本提取与 UTF-8 SRT 规范化；
- 15 秒超时、显式 Retry、迟到结果释放、换轨/换片/seek/禁用/关窗和双窗口隔离；
- 两个 native 可执行文件的 macOS 12 双架构、签名、系统动态依赖、权限与固定错误码；
- 至少 30 个不透明样本 ID、20,000 cue/4 小时流式边界和每类 20 次生命周期模拟。

native transport 测试需要绑定本机回环端口；受限沙箱若返回 `Operation not permitted`，应在获批的本地权限下原样重跑，不得把环境限制记为产品通过或失败。
