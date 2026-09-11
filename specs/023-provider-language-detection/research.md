# 研究结论：翻译服务自动识别源语言

所有技术未知项已解决，无未决澄清事项。

## 决策 1：删除本地检测，不设置替代源语言

**Decision**：删除本地检测器、协调器、源语言目录、检测专属依赖/测试/语料，以及字幕源、Controller、请求、缓存、偏好和 UI 中的源语言字段。请求不保留 nullable source，也不使用 `auto` 或 `und`。

**Rationale**：任一 source 哨兵或兼容字段都会继续维护已废弃的方向契约，并可能重新成为准入或缓存维度。字幕可读性、非空正文、用户授权和目标语言已经足以决定是否提交。

**Alternatives considered**：调低本地阈值仍保留误判面；轨道标签或文件名兜底不可信；独立远程检测增加请求、费用和失败面；均不采用。

## 决策 2：目标语言是唯一语言输入

**Decision**：`TranslationBatchRequest` 只携带目标语言、冻结条目和既有生命周期/Profile 身份。目标必须来自 `TARGET_LANGUAGES`，完整保留 `zh-Hans`、`zh-Hant`、`pt-PT` 等书写系统或地区变体；Main↔Global 边界拒绝额外 source 字段和非法目标。

**Rationale**：Provider 需要明确输出目标，但不需要本地推测输入语言。运行时校验可防止类型断言让旧字段或非法目标穿过跨运行时边界。

**Alternatives considered**：只依赖 TypeScript 静态类型无法保护消息边界；把轨道语言作为提示会重新引入错误方向；均不采用。

## 决策 3：四类 Provider 共用逐条自动理解和原样规则

**Decision**：共同 system task 要求每个 `text` 独立理解源语言；已经完全符合精确目标时逐字符返回，否则只翻译该条；上下文只用于理解且不得输出；字幕数据不可信；每个 wire ID 恰好一次且只返回结构化 JSON。DeepSeek 和 Claude 只追加各自封装约束，OpenAI/Ollama 的能力模式不得改变任务语义。

**Rationale**：共同 task builder 是四类服务已有的语义汇合点，可避免 Provider 漂移。混合批次和目标变体只能逐条判断，不能依赖轨道级结论。

**Alternatives considered**：各适配器分别维护 prompt 容易分叉；本地比较后绕过服务违反同语言仍调用；语义二次审核会扩大产品边界；均不采用。

## 决策 4：判空与字符串保存分离

**Decision**：`trim()` 只用于判定字符串是否全空白；Provider validator、progress/result、Controller、session cache 和 Overlay 始终保留 JSON 解码后的原字符串。Overlay 仅在全部内容为空白时清除，合法文本的首尾空格、换行和内部空行继续传递。

**Rationale**：现有 validator、Controller 和 cache 会保存裁剪值，Overlay 还会删除空行；只改 prompt 无法达到逐字符一致。相等结果不需要新类型或特殊分支。

**Alternatives considered**：只修 validator 会被下游再次裁剪；客户端覆盖 Provider 结果会掩盖不遵约；为原样结果增加专用类型会扩大协议；均不采用。

## 决策 5：保留现有批次、提交、重试和授权语义

**Decision**：Controller 继续使用 120 秒/40 cue 前瞻、25 cue/5,000 code point 批次和最多 3 次有限重试；Provider wire 继续最多 2 项。OpenAI/Ollama 保留合法子集提交，DeepSeek/Claude 保留当前 wire 全有或全无。既有能力 probe/fallback 不因语言未知、同语言或语义怀疑触发，也不视为语言检测。

**Rationale**：本功能只改变翻译准入和任务语义；现有结构化提交、错误分类、取消、授权和网络目的地已有独立安全契约。

**Alternatives considered**：统一为严格全量会破坏渐进提交；对原样结果自动重试会增加费用且本地无法可靠判断；均不采用。

## 决策 6：缓存只表达仍有语义的身份

**Decision**：缓存键使用 `sessionId + sourceContentHash + targetLanguage + providerSemanticFingerprint + cueId`，删除源语言维度。相同正文正常缓存，纯空白仍拒绝；换源、目标、Profile、禁用、换片和关闭继续清理或隔离。

**Rationale**：正文 hash、精确目标、Provider 语义身份和会话已经完整决定复用边界；固定 source 哨兵没有信息量。

**Alternatives considered**：保留固定 `auto` 会掩盖旧依赖；不缓存原样结果会导致回看重复计费；持久缓存违反范围；均不采用。

## 决策 7：以小型 Provider fixture 替代检测语料体系

**Decision**：删除只服务检测准确率、校准、性能和诊断的测试与大规模语料；建立自包含的 Provider 行为 fixture，覆盖短/中/长轨、罗马字、混合语言、错误/缺失标签、同语言、重复正文、空格/换行以及目标变体。mock 测试验证插件契约，真实 Provider 测试默认关闭并须经用户批准。

**Rationale**：检测 corpus 不再验证任何生产能力；保留会造成死历史和 `franc` 依赖。结构化 mock 能确定性验证请求与字符链路，live test 才能评估具体模型遵约。

**Alternatives considered**：继续运行旧准确率门禁会迫使保留废弃实现；只依赖 live test 昂贵且不稳定；均不采用。

## 决策 8：同步用户披露与包材料

**Decision**：README、多语言 README、`Info.json` 和工程/验证文档说明 Provider 在现有翻译请求内理解源语言，并明确短轨、未知源语言及同语言正文仍会发送到当前已选服务且可能收费。移除 `franc` 后同步 lockfile、第三方声明和包审计；历史 release 文档及其他规格不改。

**Rationale**：实际外发条件扩大到此前由本地判断挡住的正文，用户必须在启用和选择服务前理解费用与隐私影响；网络目的地和授权方式本身不变。

**Alternatives considered**：只改代码会使披露与行为不一致；改写历史文档会破坏权威历史和规格隔离；均不采用。
