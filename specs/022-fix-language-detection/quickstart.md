# 验证指南：字幕正文语言检测

本指南供后续实施验收使用。当前仅完成规划；新增自然语料和评估模式尚未实现，现有合成语料测试通过不能视为本规格通过。

## 前提

- 按[开发指南](../../docs/engineering/development.md)准备 macOS 12+、IINA 1.4.0+、Node.js 24、npm 11、Swift 6 与构建工具。
- 取得用户对规格实施的明确指示后，再实施检测器和测试。浏览器控制及 Computer Use 不属于这些步骤。
- 先完成[语料契约](contracts/corpus-evaluation.md)的逐件许可、人工真值、独立来源和两集合冻结；检查覆盖数量，不足时继续采集。
- 受控 Provider 默认离线或只绑定本机回环。真实收费服务不是自动化验收依赖。

以下命令均从仓库根目录执行：

```sh
npm ci
```

## 校准与冻结验收

实施时在现有 `tests/integration/acceptance-metrics.test.ts` 中提供名称含 `language detection` 的生产检测评估用例，并支持以下校准选择；默认模式只读取已冻结的验收集和配置，不自动调参或重写数据。

```sh
SUBTANDEM_LANGUAGE_CORPUS=calibration npm test -- tests/integration/acceptance-metrics.test.ts -t 'language detection'
```

校准输出只包含安全指标与参数身份。先按契约选择配置并记录哈希，再执行冻结验收：

```sh
npm test -- tests/integration/acceptance-metrics.test.ts -t 'language detection'
```

预期：逐片段及总体/语言/长度/内容分层均有四类结果，分母完整，指定回归和混合主语言断言通过，SC-001–SC-005 达标。准确率失败必须以非零状态退出；不能自动跳过缺失语料或把低置信度样本移出分母。

## 聚焦回归与完整交付

```sh
npm test -- tests/unit/language-detection.test.ts tests/unit/language-detection-coordinator.test.ts tests/integration/auto-language-support.test.ts tests/integration/embedded-subtitle.test.ts tests/integration/performance.test.ts tests/security/language-detection.test.ts
```

预期：少于 12 cue 和少量文字但有候选时可选定语言；范围外和无候选状态正确；改变格式、标签、分段和时长符合契约；失效 attempt 零提交、零请求；计时针对真实计算步骤。性能用例分别报告独立冷启动、热调用和步骤分位数。

代码最后一次变更后依次重新执行：

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

检查正式包包含锁定离线模型及正确第三方许可，且不含测试语料、源码或运行时数据。测试、编译、打包三项全部成功后再做正式安装验收；任一失败不得使用前次产物冒充本次成功。

## 开发者单人正式包验收

以下本地工具命令由实施阶段交付，与自然语料一同验收；本轮尚未创建该工具。先在单独终端启动受控服务：

```sh
node scripts/language-detection-validation.mjs serve --port 8765
```

在插件中新建 OpenAI-compatible Profile，Endpoint 填 `http://127.0.0.1:8765/v1`，Model 填 `validation-model`，不填写 Key，选择直接连接；执行 Save、Test、Select。服务终端用 Ctrl-C 停止。每个场景前后可读取安全计数，比较实际翻译调用增量：

```sh
curl -fsS http://127.0.0.1:8765/metrics
```

1. 按[正式包安装说明](../../docs/engineering/development.md#正式包验收)移除开发链接，双击本次打包产物安装并重启 IINA；记录版本、SHA-256、设备、系统和宿主版本。
2. 按上述配置选择受控 Profile，从版本管理内的语料清单找到样本 ID 对应的最小测试媒体与字幕。使用纳入仓库的小媒体，或按其来源记录中的重建命令生成；不得要求开发者自行寻找私有影片。
3. 在播放器中打开测试媒体，通过“字幕”菜单加载清单中的德语 11 cue、英语 ASS、hu/it/ru/sv 及 5–6 cue 样本；选择不同目标并开启 Translate。核对 Sidebar 的识别语言、译文出现及持续播放。
4. 依次加载罗马字日语、自然豪萨语和混合字幕：有候选应进入翻译；豪萨语须识别正确；混合主语言应与清单一致。把目标改成主语言，确认无需翻译且本地 Provider 无新增翻译请求；中文及地区变体按既有等价规则核对。
5. 使用同正文的外挂/内嵌 SRT、ASS、SubRip、SSA、`mov_text` 及标签变体，核对同一结果。加载清单中的纯数字/符号/网址和可确认范围外样本，确认对应状态、零翻译请求和播放持续。
6. 连续换轨、换片、禁用 Translate、关闭窗口；同时打开两个窗口选择不同正文。确认旧结果不覆盖新源、不产生跨窗口请求；seek 与保存目标语言后保持当前源结果并正确重新门控。可确定性延迟的完整失效序列由前述自动化回归补证。
7. 播放 20,000 cue 压力媒体并操作 seek；确认视频和原字幕连续。在既有 Log Viewer 中复制检测计时记录，用下方命令汇总。新播放器运行时的首次检测和同运行时的后续检测分开统计，按工具提示补足样本；使用本次正式包，不能以目测代替毫秒指标。
8. 从 IINA 插件设置卸载正式包，确认可以正常卸载。将各场景通过/失败及证据记录到本规格负责的验证报告。

复制安全计时记录后，在终端执行：

```sh
pbpaste | node scripts/language-detection-validation.mjs host-metrics
```

受控服务、最小媒体与安全计时工具必须在任务阶段列为明确交付项；工具未交付、未实际操作或缺少宿主计时证据时，对应验收保持未完成。不要从旧报告推断本次通过，也不要为完成这些步骤自动调用交互式自动化。

## 完成判定

逐项核对规格 SC-001–SC-006、两份契约、测试/编译/打包结果与正式包手动证据。验证报告只保存安全统计及产物/环境身份；未验收项留在后续 `tasks.md` 中，不在 SDD 产物中追加开发日记。
