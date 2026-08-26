# 快速验证：Provider HTTP 与 Profile 交互优化

## 前置条件

- macOS 12+，Node.js 24.18.0、npm 11、Swift 6.0，并已按 lock 安装依赖。
- IINA 1.4.4 与其 `iina-plugin` CLI。
- 目标身份 `0.1.0`、`ghVersion: 1000`，锁定 FFmpeg 源位于 `native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz`。
- 为 OpenAI-compatible 与 Ollama 分别准备可用的回环、局域网或私网、公网 HTTP 测试服务，以及现有 HTTPS 回归服务；若 Service type 需要凭据，使用专用测试凭据。
- 凭据、Authorization、完整 endpoint、字幕、译文与 Provider 原始响应不得写入仓库或验收证据。

## 聚焦自动化

```sh
npx vitest run \
  tests/contract/provider-profiles.test.ts \
  tests/contract/openai.test.ts \
  tests/contract/ollama.test.ts \
  tests/contract/sidebar-form.test.ts \
  tests/contract/sidebar-lifecycle.test.ts \
  tests/contract/ui-messages.test.ts \
  tests/unit/profile-list-sync.test.ts \
  tests/unit/sidebar-state.test.ts \
  tests/integration/us3-providers.test.ts \
  tests/security/credential-leakage.test.ts \
  tests/security/redaction.test.ts
npm run test:native
```

预期：

- OpenAI-compatible 与 Ollama 对 HTTPS 及回环、私网、公网 HTTP 均通过 Save、恢复、Provider 构造、Test、Select 和翻译路径，system/direct 结果一致；自动化使用生产校验与 fake transport，不依赖真实公网可用性。
- 空或相对 URL、非 HTTP(S)、userinfo、query、fragment、无效端口和残缺 authority 在请求前拒绝且不改变 revision、选择或凭据。
- system 只跟随最多三次同源重定向且重验目标，跨 scheme/host/有效端口或带禁止字段的第二跳不发送；direct 不跟随。
- 删除成功立即收敛，迟到列表和重复事件不恢复条目；失败或取消保留业务状态。所有区域同时最多显示一条操作消息，任一区域的新消息立即替换其余区域消息；消息不按时间自动消失，重复、未知或同区域非最新结果不得清除当前消息，消息替换不得改变 pending、busy 或业务状态。
- 默认名称取 Service type 可见文本并保护用户输入和既有名称；两段式 Update 与 Test 使用规格指定的精确文案。
- Profile View、反馈、错误和日志不含凭据、Authorization、完整 endpoint、字幕或响应正文。

## 版本与发布接口

```sh
node scripts/plugin-update-metadata.mjs --manifest Info.json
node scripts/release-metadata.mjs
npx vitest run \
  tests/contract/plugin-update-metadata.test.ts \
  tests/contract/package-manifest.test.ts \
  tests/contract/release-metadata.test.ts \
  tests/contract/release-audit.test.ts
npm run test:release
```

预期：当前身份为 `0.1.0`、`janwee-sha/SubTandem`、`1000`，目标归档为 `build/package/SubTandem-0.1.0.iinaplgz`；任一版本、正文或路径漂移都会失败。

## 完整门禁与最终归档

严格依次运行；只有前八项全部成功后才能记录 gate JSON：

```sh
set -e
npm run test
npm run typecheck
npm run lint
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
node -e 'require("node:fs").writeFileSync("build/release-gates.json", JSON.stringify({test:true,typecheck:true,lint:true,buildNative:true,testNative:true,build:true,verifyPackage:true,pack:true}))'
SUBTANDEM_COMMIT=$(git rev-parse HEAD)
SUBTANDEM_NOTES_SHA=$(shasum -a 256 docs/releases/v0.1.0.md | awk '{print $1}')
mkdir -p build/release
node scripts/audit-release.mjs \
  --artifact build/package/SubTandem-0.1.0.iinaplgz \
  --expected-version 0.1.0 \
  --expected-github-repository janwee-sha/SubTandem \
  --expected-github-version 1000 \
  --expected-commit "$SUBTANDEM_COMMIT" \
  --build-helper dist/native/subtandem-transport \
  --build-extractor dist/native/subtandem-subtitle-extractor \
  --ffmpeg-source native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz \
  --ffmpeg-lock native/ffmpeg.lock.json \
  --gates build/release-gates.json \
  --release-notes docs/releases/v0.1.0.md \
  --release-notes-sha256 "$SUBTANDEM_NOTES_SHA" \
  --summary-file build/release-summary.md \
  --output-dir build/release
```

预期：最终归档而非仅 staging 通过版本身份、根白名单、双 helper 架构/权限/签名/最低 macOS/系统依赖、合规材料、锁定 FFmpeg 源和敏感材料审计，并生成 SHA-256 与审计结果。

## IINA 正式包验收

1. 确认不存在同名开发链接，安装最终 `SubTandem-0.1.0.iinaplgz`，记录包 SHA-256、macOS、架构与 IINA 版本。
2. 对 OpenAI-compatible 与 Ollama，分别用回环、局域网或私网、公网 HTTP endpoint 完成 Save、Test、Select 和一次实际字幕翻译；不得因 HTTP 或主机位置被拒绝，也不得出现风险提示、HTTPS 要求或额外确认。Test 不得自动 Select。
3. 对两个 Service type 分别回归 HTTPS；选取 HTTP Profile 用 system 与 direct 路线各完成一次请求，确认产品不自动改路由。
4. 尝试空或相对 URL、非 HTTP(S)、userinfo、query、fragment、非法端口和残缺 IPv6；均在请求前失败且旧 Profile、选择与凭据状态不变。跨来源 redirect 不得发出第二跳。
5. 对未选择、已选择、正在编辑和已有 Test 状态的 Profile 分别删除；成功送达后 1 秒内条目消失并清理关联状态，迟到同步、重复结果、刷新和重新打开 Sidebar 均不恢复。
6. 取消一次原生删除确认并制造一次删除失败；条目及原业务状态保留，结果显示在原 Profile 行操作区，直至下一条被接受的消息替换。成功时原条目变为同位置的只读成功结果槽，结果槽在其他区域写入下一条被接受的消息时移除，Profile 不恢复。
7. 依次及交错执行 Translate、Target Language 选择器自动保存、Profile Save/Update、Select、Test、Delete 和 Subtitle Retry；busy 与终态均在对应控件正下方，并保持可见直至下一条被接受的消息写入。任一区域出现新消息时，其余区域消息必须立即清空且全局最多一条；消息替换不取消仍在执行的操作或解除控件 busy，同一区域旧结果不得覆盖或清除较新消息，屏幕阅读器不重复播报 Profile 行状态。
8. 新建两种 Service type，确认默认名分别为可见文本 `OpenAI-compatible` 与 `Ollama`；用户改名、清空、输入相同默认文本和编辑既有 Profile 后切换类型均不被覆盖。
9. 确认 Update 与 Test 精确文案、两段式凭据保存、revision、Credential/Test/Select 独立语义、凭据隔离及多窗口互不影响。
10. 完成播放和翻译冒烟后卸载正式包，确认安装项可移除。

IINA GUI 场景必须由开发者在最终包上实际完成后才能标记通过；开发链接和自动化结果不能替代。

## 证据边界

只记录包版本或哈希、环境版本、Service type、主机位置类别、scheme、proxy mode、场景通过/失败和 UI 位置结论。不得记录媒体绝对路径、完整 endpoint、API key、Authorization、字幕、译文或 Provider 原始响应。
