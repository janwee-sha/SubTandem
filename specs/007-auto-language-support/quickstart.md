# 验证指南：字幕语言自动识别与目标语言偏好

## 前置条件

- macOS 12+、Node.js 24、npm 11；正式宿主验收使用 IINA 1.4.0 与当前固定发布版。
- 使用版本化、可公开或合成的语言 fixture；校准集与验收集来源隔离，不记录用户字幕。
- 目标语言、识别状态和持久化行为分别遵循 [目录](./contracts/language-catalog.md)、[识别](./contracts/language-detection.md) 与 [偏好](./contracts/target-language-preference.md) 契约。
- 生产与测试输出不得包含字幕正文、识别样本、译文、文件路径或凭据。

## 聚焦自动化

实施完成后运行：

```sh
npx vitest run tests/unit/target-languages.test.ts tests/unit/language-detection.test.ts tests/unit/language.test.ts
npx vitest run tests/contract/target-language-preferences.test.ts tests/contract/ui-messages.test.ts tests/contract/sidebar-form.test.ts
npx vitest run tests/integration/auto-language-support.test.ts tests/integration/progressive-translation.test.ts tests/integration/overlay-lifecycle.test.ts
npx vitest run tests/security/credential-leakage.test.ts tests/security/redaction.test.ts
```

预期：

- 生产目录恰好 156 项，顺序、ID、英文名和 Provider label 唯一；中文、葡萄牙语、Ga 与 Krio 映射固定。
- 无手动源语言控件、消息字段、偏好读取、缓存身份或 Provider 影响；旧键存在时也不能改变结果。
- 识别对空白、符号、极短、混合、相关语种和不受支持文字失败关闭；元数据错误时正文仍是唯一权威。
- 检测进行、无法识别、不受支持和无需翻译四种状态可区分，后三者 Provider 调用为 0。
- 换轨、换片、正文 hash 变化、禁用、关窗和双窗口迟到写入为 0；seek 不重跑同源识别。
- 保存请求在 Global 成功回执前不改变 Controller；旧键清理与缺失态回滚不写入 `null`，写入/同步失败回滚旧值，成功后取消旧目标请求并清缓存和 overlay。
- Sidebar 首次恢复已保存值；不同选择只建立一个 pending，poll 不覆盖 pending 候选，失败恢复 committed 值，关闭重开恢复 committed 值。

## 冻结语料与指标

验收集至少覆盖 20 种不同文字或语系，每种不少于 20 条自然字幕 cue，并包含：

- 有效、缺失和错误轨道元数据；
- 片名、专有名词、数字、符号、URL 与重复行；
- 简体、繁体与无法区分书写系统的短中文；
- 相近语言、2/2 与 3/1 混合语言窗口；
- 分类器不覆盖的文字与不受支持语言。

聚合结果必须满足：

- 可靠且正确 / 全部可识别验收样本 ≥95%；
- 不可靠样本被错误标为可靠语言 ≤1%；
- 元数据错误但正文充分时正确方向 ≥95%；
- unknown、unsupported、同语言和生命周期迟到场景的 Provider 调用均为 0。

性能在最弱受支持的 IINA/macOS/架构组合上使用 64 cue/4,000 字样本测量：首次 p95 ≤100 ms、热识别 p95 ≤50 ms、同步分片 p99 ≤16 ms，视频与原字幕中断为 0。不得把 calibration 样本计入 acceptance 指标。

## 完整自动化与正式包门禁

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

比较变更前后的 `dist/main.js` 与 `.iinaplgz`：Main bundle 增量不得超过 1 MiB，包增量不得超过 500 KiB。确认 `package-lock.json` 精确锁定分类器，`THIRD_PARTY_NOTICES.txt` 包含分类器及传递依赖；归档不得出现 `node_modules`、动态模型、WASM、`.node`、源码、测试、规格、运行时目录或新网络权限。

## IINA 正式包人工验收

所有步骤使用同一个正式 `.iinaplgz`，记录版本或 SHA-256、macOS、架构和 IINA 版本。

1. 完整退出 IINA，清除目标语言偏好后启动；打开 Sidebar，确认 `Languages` 中只有 `Target Language`，不存在语言保存按钮，默认显示 Chinese (Simplified)。
2. 核对 156 项顺序；重点检查首项、中间项、末项、Chinese (Traditional)、Chinese (Simplified)、Portuguese、Portuguese (Portugal)、Ga 和 Krio。
3. 选择任一非默认语言；确认立即且只发起一次保存，等待期间选择器不可重复操作，成功后当前会话立即清除旧译文并按新目标继续。
4. 对列表首项、中间项、末项及上述变体分别完成自动保存；制造一次失败或取消，确认选择器恢复先前已提交值并可重新选择同一候选。
5. 连续保存两个不同目标，完整退出并重启 IINA；确认恢复最后一次成功值，重复打开 Sidebar 或切换窗口不会回退默认。
6. 使用正文充足且元数据正确、缺失和错误的外挂 SRT/ASS；确认识别方向只由正文决定。
7. 使用空白、仅符号、短文本、混合与不受支持样本；确认状态可区分，视频和原字幕持续播放，Provider 调用为 0。
8. 使用简体、繁体、`pt-BR` 与 `pt-PT` 样本核对等价矩阵；同身份不外发，显式变体之间仍进入翻译。
9. 在检测与翻译期间反复换轨、换片、修改字幕、禁用、关闭窗口，并用两个窗口并发；旧状态、请求、缓存和 overlay 进入错误会话的次数为 0。
10. 检查 IINA Log Viewer 与项目允许的诊断输出，确认字幕正文、样本、译文、路径、旧源语言偏好和凭据命中数均为 0。

开发者本人不查阅额外说明，从打开 Sidebar 起应在 30 秒内找到 `Target Language`、选择任一项并看到明确的自动保存结果。

## 验收记录边界

只记录包版本/hash、环境、非私密样本 ID、语言预期/状态、准确率聚合值、耗时、Provider 调用计数、播放是否中断、恢复值和通过/失败。不得记录文件名或路径、字幕正文、译文、候选分数、Provider 请求正文或凭据。
