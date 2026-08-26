# 验证指南：覆盖层译文渲染

本指南用于实现后的自动化与正式 IINA 验收。具体显示与安全规则见[译文覆盖层契约](./contracts/translation-overlay.md)，状态边界见[数据模型](./data-model.md)。

## 前置条件

- macOS 12+，Node.js 24、npm 11。
- 当前 IINA 1.4.4；正式验收必须安装 `.iinaplgz`，开发链接不能替代。本功能不要求其他 IINA 版本、macOS 版本或 CPU 架构的交叉验收。
- 使用非敏感合成媒体与字幕，至少覆盖外部 SRT/ASS、内嵌 SubRip/ASS/SSA/mov_text、重叠 cue、CJK、RTL、emoji、ASS 控制字符和超长内容。
- Provider 使用测试凭据或可控 stub；证据不得保存凭据、媒体路径、字幕、译文或 Provider 请求。

## 1. 聚焦自动化

实现后按实际测试文件执行覆盖层单元、适配器、生命周期与安全回归：

```sh
npm test -- tests/unit/translation-overlay.test.ts tests/integration/subtitle-overlay.test.ts tests/integration/progressive-translation.test.ts tests/integration/us1-playback.test.ts tests/integration/embedded-subtitle.test.ts tests/integration/performance.test.ts
npm test -- tests/security/redaction.test.ts tests/security/credential-leakage.test.ts tests/contract/package-manifest.test.ts tests/contract/sidebar-lifecycle.test.ts
npm run typecheck
npm run lint
```

应直接导入生产 selector、controller 和 IINA adapter，证明：

- `[startMs, endMs)` 选择、源顺序合并、缓存 seek 重绘和 cue 离开清理；
- Provider in-flight 期间仍按位置同步，渐进结果只在当前时段立即显示；
- ASS 固定样式、换行和控制字符转义；重复 show/clear 去重，命令异常不阻塞播放；
- 两个独立播放器互不发命令；全过程无 `sub-add`、`sub-remove`、`sid`、`secondary-sid` 写入和译文临时文件；
- 失效与迟到结果不恢复旧内容，诊断不含字幕、译文或 ASS data。

不得新增解析 README、SDD 产物或人工测试清单的文案测试。

## 2. 完整质量门

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

记录生成包的版本、SHA-256、macOS、架构和 IINA 版本。检查正式 bundle 不包含旧译文轨道适配器、译文 SRT 输出、源码、测试、规格、依赖树、环境文件或运行时状态，权限集合和 native helper 要求保持不变。

## 3. 阻断性宿主预检

在 IINA 1.4.4 安装正式包，先用合成译文完成：

1. show 首帧、replace 内容、`format=none` remove，再重复 show/clear。
2. 开启和关闭 IINA 可用的诊断日志级别，在 Log Viewer 与文件日志搜索一次性合成 sentinel。
3. 只记录日志命中计数；不得把 sentinel、命令 data 或真实内容写入验收证据。

任一版本无法真实显示/更新/清理，或日志命中数不为 0，立即停止后续验收并返回规格与方案阶段；不能用 fake 或应用层脱敏测试放行。

## 4. 正式包人工验收

由一名开发者完成并记录通过/失败、耗时和非敏感样本 ID。

### 无轨道副作用

1. 预先选择主字幕和已有第二字幕，记录两者 ID 与轨道列表。
2. 启用翻译并连续播放至少 30 分钟、显示至少 100 条译文。
3. 过程中切换 Sidebar 状态但不手动改轨；结束后复核轨道 ID 和列表。

预期：插件引起的轨道新增、重载、选择、移除和轨道通知均为 0；原视频和原字幕不被阻塞。

### 样式与窗口

1. 显示单行、多行、重叠 cue、长 CJK、长连续拉丁字符、RTL、emoji、连续空行和 ASS 标签形文本。
2. 在窗口、全屏和至少 20 次不同尺寸变化中观察。
3. 在超高文本样本中确认固定字号和自然裁切，不要求完整可见。

预期：顶部居中、白色、40@720p 等比缩放、透明背景和黑色描边保持一致；文本不能改变固定样式，插件不主动省略、截断或额外缩字。

### 时间与生命周期

对暂停、自然离开 cue、前后 seek、换轨、换片、禁用、Provider 失败和关窗各执行至少 20 次，并同时操作两个窗口。

预期：仍在时段内的暂停译文保持；有效结果 95% 在 500 毫秒内出现，离开时段或失效后 100% 在 500 毫秒内清理；旧内容不恢复，窗口之间不串扰。

### 播放器交互与 OSD

1. 在译文区域执行单击、双击和窗口拖动。
2. 同时触发音量、seek 等 IINA 自身 OSD。

预期：播放器原有输入行为不变；译文不误清理 IINA OSD，IINA OSD 也不造成字幕轨变化。不同类型 OSD 的永久层级不作为兼容承诺。

## 5. 验收记录

记录以下最小信息：

- 包版本与 SHA-256；
- macOS、CPU 架构、IINA 版本；
- 合成样本 ID、场景、通过/失败和显示/清理耗时；
- 轨道操作次数、轨道通知次数、日志 sentinel 命中次数。

视觉证据只使用合成非敏感文本；不得保存真实媒体路径、字幕正文、译文、Provider 请求或凭据。
