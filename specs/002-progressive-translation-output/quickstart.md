# 验证指南：渐进式字幕翻译输出

## 前置条件

- Node.js 24、npm 11；已安装锁文件依赖。
- IINA 1.4+ 正式安装包验收环境。
- 用户已授权的 OpenAI-compatible Profile。
- 用户自行准备且可合法用于测试的本地视频，以及包含密集时间段的对应外挂 SRT/ASS 字幕夹具；不得在证据中记录媒体路径、字幕正文或凭据。

## 聚焦自动化验证

```sh
npx vitest run tests/contract/openai.test.ts tests/contract/ollama.test.ts
npx vitest run tests/contract/global-rpc.test.ts tests/contract/ui-messages.test.ts
npx vitest run tests/integration/progressive-translation.test.ts tests/integration/subtitle-track.test.ts
```

预期结果：

- 25 cue 合成字幕形成一个逻辑批次和 13 个 wire 请求；阻塞第 2–13 个请求时，第 1 个请求已增加缓存并启动发布。
- provider 逐 wire 上报、终态完整聚合；后段失败后只重试未解决 cue；取消和无效结果不产生进度。
- 同一 cue 的进度与终态结果去重。
- 快速进度期间单窗口最大并发 `swap` 为 1，最终内容是最新快照。
- 跳转、换轨、换片、服务切换、禁用和关闭后，迟到进度与发布不修改当前状态。

## 完整自动化与构建

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:package
```

全部命令必须通过。package 校验必须继续证明发布产物不包含规格、测试、依赖树、缓存、凭据或运行时数据。

## IINA 人工验收

1. 使用正式可卸载包启动 IINA，打开已准备的本地视频夹具。
2. 在 IINA 中手动加载并选择对应的外挂 SRT/ASS 字幕夹具；确认插件没有自动加载字幕，也没有尝试读取内嵌字幕。
3. 选择已授权的 OpenAI-compatible Profile，启用翻译。
4. 观察密集字幕区：缓存应从 0 渐进增加，第二字幕在逻辑批次全部完成前开始显示，状态在首个快照显示后进入运行中。
5. 在后续请求进行时跳转并换轨，确认旧进度不改变新位置缓存或第二字幕。
6. 再次启用后关闭窗口，确认迟到结果不创建残留插件轨道。

只记录包版本/哈希、IINA 版本、缓存计数变化、状态、是否出现第二字幕和生命周期结果。不得记录媒体路径、API key、Authorization、字幕正文或 provider 原始响应。
