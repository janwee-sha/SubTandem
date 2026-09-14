# 实施计划：翻译服务自动识别源语言

**Git 分支**：`fix/language-detection` | **功能标识**：`023-provider-language-detection` | **日期**：2026-09-11 | **规格**：[spec.md](spec.md)

**输入**：移除本地字幕语言检测及其准入门禁，让当前已选翻译服务在既有翻译请求内逐条理解源语言，并正确处理同语言正文。

## 摘要

删除本地检测器、源语言目录、检测状态、轨道语言保存、旧偏好键及 `franc` 依赖。Main 在字幕可读、翻译启用、目标语言和 Profile 有效且位置可用时，直接构造只含精确目标语言的翻译任务；四类正式 Provider 共用逐条自动理解和同语言逐字符原样规则。结果校验、会话缓存和 Overlay 只用 `trim()` 判空，始终保存及传递原字符串。既有授权、有限前瞻、批次、重试、跨窗口路由、会话清理和播放安全边界保持不变。

## 技术上下文

**语言/版本**：TypeScript 5.9.3（strict、ES2020、ESNext/Bundler）；Node.js 24、npm 11；Swift 6.0 native helper 不改行为

**主要依赖**：Parcel 2.16.4、Vitest 3.2.7、ESLint 9.39.5、`iina-plugin-definition` 0.99.4、`@noble/hashes` 2.3.0；删除仅服务本地检测的 `franc` 6.2.0 及其传递依赖声明

**存储**：IINA preferences 保存目标语言和 Profile；插件私有 `credentials.json` 保存凭据；译文仅存当前会话 `Map`。不保存、缓存或迁移源语言

**测试**：Vitest 的 unit/contract/integration/security 测试；Swift 合同测试；构建、包审计和 `.iinaplgz` 打包；IINA 正式包单人手动验收

**目标平台**：macOS 12+、IINA 1.4.0+；Main/Global JavaScript、Sidebar/Overlay WKWebView、三个 arm64/x86_64 universal Swift helper

**项目类型**：IINA 桌面插件，包含多 JavaScript 运行时、WebView 界面和本地 helper；本功能不改 native RPC 或 helper

**性能目标**：字幕正文及全部配置就绪后 500ms 内开始首批 Provider attempt；不增加检测等待

**约束**：保留 120 秒/40 cue 前瞻、25 cue/5,000 code point Controller 批次、每次 Provider wire 最多 2 项、每目标相邻上下文合计最多 500 code point、单窗口一次 in-flight 和最多 3 次会话重试；不新增 endpoint、独立检测请求、持久缓存、语义复核或播放阻塞

**规模/范围**：OpenAI-compatible、Ollama、DeepSeek、Claude-compatible 四类正式服务；156 项目标语言目录；外挂 SRT/ASS 与本地内嵌 SubRip/ASS/SSA/`mov_text`；远程和图形字幕继续失败关闭

## 宪法检查

*门禁：Phase 0 前检查，结果为通过。*

- **I 验证与产品安全**：计划包含生产实现直连的自动化回归、跨运行时安全测试、完整测试/编译/打包门禁和正式包人工步骤；原播放、会话归属、凭据隔离及包边界保持。
- **II 生产代码约束**：实现阶段不新增生产代码注释，生产自然语言继续使用英语。
- **III 敏感数据最小化**：只在用户启用翻译并选择有效 Profile 后发送附近必要正文、上下文和精确目标；不新增目的地、正文保留或重试。
- **IV 可重建发布物**：移除 `franc` 后同步 lockfile 与第三方声明，并以正式构建、包审计和打包验证交付物。
- **V 当前需求代码**：直接删除本地检测、旧状态、旧偏好写入和 source 字段，不保留 `null`、`auto`、`und` 或兼容路径。
- **VI 版本化管理**：设计、样本和文档只引用受版本管理内容；本地媒体不成为验收依赖。
- **VII 规格边界隔离**：仅修改本规格产物及其负责的代码、测试和共享文档；不改写其他规格目录。
- **VIII 宿主一致性**：只删除失效的 Sidebar 信息行和状态，不新增组件或偏离 IINA/macOS 交互。
- **工作协议**：采用完整 SDD；文档中文优先；人工验收由单名开发者完成；本计划不授权实现。

## 项目结构

### 本功能文档

```text
specs/023-provider-language-detection/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── translation-task.md
│   └── session-state.md
└── tasks.md                 # 后续由 speckit-tasks 生成
```

### 相关源码与测试

```text
src/
├── app/                     # 准入、请求构造、会话缓存与生命周期
├── adapters/iina/           # 字幕源、Main↔Global 与 Overlay 边界
├── domain/                  # 目标语言、状态和运行时消息校验
├── providers/               # 共同任务、四类 Provider、wire 与结果校验
├── subtitles/               # 字幕解析、准备结果与显示选择
├── main.ts                  # 播放器会话和 Sidebar 状态
└── global.ts                # Profile 授权与 Provider 调度
ui/
├── sidebar.html
├── sidebar.ts
├── overlay-state.ts
└── overlay.ts
tests/
├── unit/
├── contract/
├── integration/
├── security/
├── helpers/
└── fixtures/
```

**结构决策**：沿用现有插件分层，不新增子项目或 native 能力。删除 `src/app/language-detection.ts`、`src/subtitles/language-detection.ts`、`src/domain/source-languages.ts`、`src/domain/language.ts` 及只服务检测的代码、测试和语料。把仍有价值的同语言、混合、罗马字和目标变体样本收敛为自包含的 Provider 行为 fixture。

## 实施策略

1. **移除源语言状态**：字幕源与 Controller 不再读取或保存轨道语言；删除检测协调器、检测门禁、同语言短路、四个失效状态、Sidebar 检测字段、旧 preference default 和启动时旧键写入。
2. **收紧跨运行时请求**：`TranslationBatchRequest` 与缓存身份删除 `sourceLanguage`；目标目录删除仅服务 source 的特殊标签分支；Main/Global 对完整请求形状、精确目标语言、身份和大小边界做运行时校验，拒绝额外 source 字段。
3. **统一 Provider 语义**：共同任务构造器只接收目标语言及冻结条目，并在 system task 与结构化 user payload 中重复同一可信目标；四类 Provider 和连接测试共用逐条自动理解、精确变体、同语言原样、上下文只读和结构化 ID 规则。Claude-compatible 请求优先显式关闭 thinking，仅在服务明确拒绝该字段时省略后原样重试一次；其余 HTTP 封装与有限能力 fallback 保持不变。
4. **保证字符保真**：Provider validator、progress/result、Controller、session cache 和 Overlay 都只判定“是否全空白”，不裁剪合法结果；Overlay 允许包含内部空行的非空文本。相同正文是普通成功结果并正常缓存。
5. **清理依赖与披露**：删除 detector-only 测试/语料和 `franc`，同步 `package-lock.json`、`THIRD_PARTY_NOTICES.txt`、`Info.json`、README、多语言 README 及工程/验证文档；历史 release 文档和其他规格保持不变。

## 验证策略

- 用受控 transport 覆盖四类 Provider 的请求体、共同语义、system/user 目标一致性、目标变体、结构化 ID、部分/严格提交差异、Claude thinking 关闭与有界兼容降级，以及原样字符串回传。
- 用集成测试证明短轨、中等轨、长轨、罗马字、混合语言、错误/缺失轨道标签及同语言正文均不经检测直接 attempt；以可控时钟证明首批启动不超过 500ms。
- 逐层断言首尾空格、大小写、标点、换行和内部空行经过 validator、跨运行时 progress/result、Controller、cache 与 Overlay 后保持；纯空白、缺失、重复或未知 ID 仍无效。
- 保留未启用/未选 Profile 不外发、有限窗口与批次、换轨/换片/seek/目标/Profile/禁用/关窗、多窗口隔离、迟到结果拒绝和服务失败不阻塞播放的现有回归。
- 最后一次代码变更后依次重跑 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build:native`、`npm run test:native`、`npm run build`、`npm run verify:package`、`npm run pack`；联网 Provider 验收仅在用户明确批准费用和网络后运行。

## 设计后宪法复核

*Phase 1 后复核：通过。*

设计没有新增持久化、权限、网络目的地、native 接口、UI 组件或兼容层；字符保真修改被限制在合法非空译文链路，现有无效输出与安全边界不变。自动化、正式包和单人宿主验收均有可执行路径，且所有新产物只位于本规格目录。
