# 实施计划：字幕语言自动识别、目标语言扩展与偏好持久化

**分支**：`007-auto-language-support` | **日期**：2026-08-18 | **规格**：[spec.md](./spec.md)

**输入**：`specs/007-auto-language-support/spec.md`

## 摘要

在逐窗口 Main 中对已解析的外挂或内嵌文本字幕执行离线、有界且失败关闭的语言识别，可靠结果成为 Provider 请求前的强制门禁。产品使用一份 Provider 无关的 156 项 BCP 47 目标语言目录；Global 是目标语言偏好的唯一持久化写入者，Main 仅在请求关联的保存成功回执后切换当前会话并取消旧目标语言工作。旧手动源语言 UI、偏好、消息字段和运行时路径全部移除。

## 技术上下文

**语言与版本**：TypeScript 5.9.3，生产目标 ES2020/ESNext；Node.js 24 与 npm 11 仅用于构建和测试；现有 Swift 6 native helper 不变。

**主要依赖**：IINA Plugin API 0.99.4、Parcel 2.16.4、`@noble/hashes` 2.3.0；新增精确版本 `franc-min` 6.2.0 及其锁定传递依赖，用于 Main 内离线识别。

**存储**：IINA preferences 仅以规范化的 `targetLanguage` 作为有效跨会话语言值；旧源语言键使用 property-list 安全的空字符串墓碑清除。字幕样本、识别结果、字幕和译文只保留在所属播放器会话内存中。

**测试**：Vitest 3.2.7、TypeScript 严格类型检查、ESLint、Parcel 正式构建、包审计，以及正式 `.iinaplgz` 的 IINA 人工验收。

**目标平台**：macOS 12+、IINA 1.4.0+ 的 Main/Global JavaScriptCore 与 Sidebar WebView；Apple Silicon 和 Intel 正式包。

**项目类型**：跨 Main、Global 与 Sidebar 的桌面播放器插件；不新增服务、网络端点、native helper 或持久化文件。

**性能目标**：每个字幕源最多采样 64 条 cue 和 4,000 个 Unicode 文字；首次识别 p95 不高于 100 ms、热识别 p95 不高于 50 ms，单个同步分片 p99 不高于 16 ms，总期限 500 ms。识别期间视频和原字幕中断次数为 0。

**约束**：识别必须先于任何字幕正文外发；可靠率和误判门禁分别满足 SC-001/SC-002；无可靠结果时 Provider 调用为 0；生产代码不新增注释且只使用英文自然语言；新增依赖必须静态进入 `dist/main.js` 并补齐第三方声明，正式包不得新增模型文件、WASM、native 模块或 `node_modules`。

**规模与范围**：156 个有序目标语言选项；检测校准与验收覆盖至少 20 种文字或语系、每种不少于 20 条自然字幕；既有单源上限为 20,000 cue/16 MiB，但检测工作量保持常量。

## 宪法检查

### Phase 0 前门禁

| 原则 | 结论 | 计划约束 |
| --- | --- | --- |
| I. 验证与产品安全 | 通过 | 自动化直接调用生产目录、识别器、消息解析、偏好存储与 Controller；IINA 恢复和正式包行为保留人工验收，播放、会话与隐私门禁均可测。 |
| II. 生产代码无注释且默认仅使用英语 | 通过 | 新增生产模块不写注释，标识符、状态文案、英文语言名和 Provider label 使用英语。 |
| III. 敏感数据与外部副作用最小化 | 通过 | 识别只在 Main 内处理有界样本，不新增网络或日志；preferences 只保留目标语言 ID 与清除旧源语言值所需的空墓碑。 |
| IV. 可重建且最小的发布产物 | 通过 | 依赖精确锁定并静态打包，更新第三方声明并以现有 build、verify、pack 接口审计产物。 |
| V. 生产代码只实现当前功能需求 | 通过 | 完全移除手动源语言路径，不保留兼容模式；不为未来 Provider 或自定义语言扩展抽象。 |

不存在需豁免的门禁失败。

## 项目结构

### 本功能文档

```text
specs/007-auto-language-support/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── language-catalog.md
│   ├── language-detection.md
│   └── target-language-preference.md
└── tasks.md
```

### 源码与测试

```text
src/
├── domain/
│   ├── language.ts
│   ├── target-languages.ts
│   ├── messages.ts
│   └── status.ts
├── subtitles/
│   ├── language-detection.ts
│   ├── source.ts
│   └── types.ts
├── app/
│   ├── language-detection.ts
│   ├── controller.ts
│   ├── playback-session.ts
│   └── session-cache.ts
├── adapters/iina/
│   └── target-language-preferences.ts
├── main.ts
└── global.ts

ui/
├── sidebar.html
├── sidebar.ts
└── sidebar.css

tests/
├── fixtures/languages/
├── unit/
├── contract/
├── integration/
└── security/

package.json
package-lock.json
Info.json
THIRD_PARTY_NOTICES.txt
```

**结构决策**：目录、语言等价和纯识别逻辑放在生产 domain/subtitles 模块；识别 attempt 生命周期由逐窗口 app 协调器拥有；IINA preferences 写入封装为可注入 adapter 并仅由 Global 调用。Main 负责播放器提交态和会话失效，Sidebar 负责目录渲染、已提交值、单一 pending 候选与请求关联反馈；不同选择立即复用既有保存链路。现有 Provider 请求结构继续传稳定语言 ID，Provider adapter 从同一目录派生英文 prompt label。

## Phase 0 研究结论

技术决策与替代方案见 [research.md](./research.md)。所有技术上下文中的不确定项均已解决；依赖的实际 bundle 兼容、体积与语料指标属于实施门禁，不是未决产品需求。

## Phase 1 设计

- 实体、状态和所有权见 [data-model.md](./data-model.md)。
- 156 项稳定身份见 [language-catalog.md](./contracts/language-catalog.md)。
- 采样、可靠门禁、状态和失效规则见 [language-detection.md](./contracts/language-detection.md)。
- 保存、初始化和 Sidebar 提交契约见 [target-language-preference.md](./contracts/target-language-preference.md)。
- 可执行验证路径见 [quickstart.md](./quickstart.md)。

### 设计后宪法复核

| 原则 | 结论 | 设计证据 |
| --- | --- | --- |
| I | 通过 | 识别准确率、零错误 Provider 调用、保存原子性、迟到拒绝、多窗口和正式包恢复均有自动化或人工验收路径。 |
| II | 通过 | 生产数据使用固定英文显示名；中文仅存在于 SDD 与项目验证文档。 |
| III | 通过 | 数据模型没有字幕样本持久实体，UI/RPC 只公开固定状态与非敏感语言 ID。 |
| IV | 通过 | 依赖静态打包、许可、体积与包清单均进入交付门禁，不改变 native 或权限清单。 |
| V | 通过 | 设计删除 `sourceLanguage`、`sourceLanguageMode`、手动模式和确认动作，不保留双路径。 |

设计后仍无门禁失败或复杂度豁免。
