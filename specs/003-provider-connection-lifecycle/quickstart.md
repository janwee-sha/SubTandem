# 验证指南：Provider 连接生命周期

## 前置条件

- Node.js 24、npm 11、Swift 6.0，并已按锁文件安装依赖。
- IINA 1.4+ 正式安装包验收环境。
- 一个已授权的远程 OpenAI-compatible `direct` Profile，以及可控返回 429 的同类测试环境。
- 用户自行准备且可合法用于测试的本地视频与对应外挂 SRT/ASS 字幕。只在本机环境中设置媒体目录，例如 `SUBTANDEM_ACCEPTANCE_MEDIA_DIR`；不得把实际绝对路径写入仓库或验收证据。

## 聚焦自动化验证

```sh
npm run test:native
npx vitest run tests/contract/openai.test.ts tests/contract/ollama.test.ts tests/contract/provider-connection-tests.test.ts
npx vitest run tests/integration/provider-connection-lifecycle.test.ts tests/contract/global-rpc.test.ts tests/contract/ui-messages.test.ts
```

预期结果：

- 两条网络路径共用 host 门控，每 host 最多 4 个请求进入传输层并复用有限连接；等待、取消和完成按 job 隔离，系统路径的重定向状态按 job 隔离。
- helper 关闭拒绝新工作、取消活动请求并释放共享会话；迟到回调不会产生第二次终态。
- `direct` 继续使用 libcurl no-proxy 路径，在至少 25 次连续同源请求中复用有界连接，并保持现有安全和错误行为。
- OpenAI-compatible 在 capability 已缓存后仍真实请求；当前 429 返回配额错误而非成功。
- 同一 OpenAI-compatible Provider 实例的连续 Test 与翻译请求复用一个 `X-Session-Id`，不同实例不共用，且 wire 与渐进输出边界不变。
- Ollama 每次 Test 继续真实检查服务、模型和结构化输出。
- 相同外部 request ID 的多窗口 Test、并发翻译、Profile 删除和单项取消互不影响，消息结构和播放选择不变。

## 完整自动化与构建

```sh
npm run typecheck
npm run lint
npm test
npm run test:native
npm run build
npm run verify:package
```

所有命令必须通过。包校验必须继续证明 native helper 含 arm64/x86_64、具有可执行权限和签名，且正式包不包含规格、测试、依赖树、缓存、凭据或运行时数据。

## IINA 正式包验收

1. 使用本次构建的正式可卸载包安装并启动 IINA，记录包版本或哈希及 IINA 版本。
2. 开始前在 OmniRoute `/dashboard/health` 的 Sessions 区域确认 Active count 低于配置上限；若此前已经达到上限，停止请求并等待 15 分钟空闲清理，或重启 OmniRoute 后再开始，避免旧会话污染本次结果。
3. 从 `SUBTANDEM_ACCEPTANCE_MEDIA_DIR` 在本机选择视频和对应外挂字幕；在 IINA 中手动加载并选择字幕，不在证据中记录文件路径或字幕正文。
4. 选择一个已授权的远程 OpenAI-compatible `direct` Profile，启用翻译；连续处理至少 100 个 cue 或播放 5 分钟。
5. 观察第二字幕持续输出，并确认 OmniRoute Sessions Active count 相对起点最多增加 1；期间不得出现 TCP 连接或网关活动会话耗尽、因累计到上限导致的中断或需要重启 helper 才恢复的情况。
6. 打开第二个播放器窗口并发翻译；在一个窗口执行跳转、取消、结束播放或关闭，确认另一窗口持续输出且没有跨窗口状态变化。
7. 先在可用服务上执行一次 Test 使 capability 已知，再把受控服务切换为 429；再次执行 Test，确认发生新的联网请求并显示配额错误。
8. 确认上述 Test 前后各窗口当前选择不变，未测试的窗口没有收到结果，随后关闭窗口并完成 helper 生命周期清理。

## 证据边界

只记录包版本/哈希、IINA 与 macOS 版本、Profile 类型和代理模式、cue 数或播放时长、第二字幕持续性、错误分类、连接上限结论及多窗口/关闭结果。不得记录媒体绝对路径、字幕正文、译文、API key、Authorization、完整 endpoint、provider 原始响应或 helper token。
