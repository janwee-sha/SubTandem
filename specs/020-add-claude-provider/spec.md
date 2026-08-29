# 功能规格：添加 Claude 翻译服务

**功能目录**：`specs/020-add-claude-provider`  
**创建日期**：2026-08-29  
**状态**：草案

**输入**：新增 Claude Service type，使用 Claude/Anthropic Messages 格式完成字幕翻译，并使 Claude 在 Service type 下拉框中位于 OpenAI 之后。

## Clarifications

### Session 2026-08-29

- Q: 当 Claude Messages 响应中的 JSON 译文有效时，哪些结束状态允许提交字幕？ → A: 仅接受 `stop_reason: end_turn` 且无拒绝信号。

## 用户场景与测试

### 用户故事 1：配置并使用 Claude Profile（优先级：P1）

拥有 Anthropic API 凭据或 Claude-compatible Endpoint 的用户希望直接创建独立的 Claude Profile，测试并选择后用于字幕翻译，而不必把该服务伪装成 OpenAI 或 Ollama。

**优先级理由**：独立且完整的 Profile 流程是用户实际使用 Claude 格式翻译字幕的前提。

**独立测试**：从新建 Profile 开始选择 Claude，完成模型刷新、保存、Test、Select 和字幕翻译，再编辑并删除该 Profile，确认各步骤均作用于 Claude 且不改变其他 Profile。

**验收场景**：

1. **假如** 用户打开 Service type 下拉框，**当** 查看选项，**那么** 固定顺序必须为 OpenAI、Claude、DeepSeek、Ollama。
2. **假如** 用户选择 Claude，**当** 新建 Profile 表单切换完成，**那么** 表单使用 Claude 名称和官方 API Root 作为初始值，并保留 Endpoint、Model ID、API Key 与网络路线的配置能力。
3. **假如** 用户填写可用配置并保存，**当** 依次执行 Test、Select 和字幕翻译，**那么** 测试通过、当前窗口选择该 Profile，并持续显示与字幕对应的译文。
4. **假如** 用户编辑或删除已保存的 Claude Profile，**当** 操作完成，**那么** Profile revision、选择失效、凭据替换或清理行为与其他服务保持一致，且不影响无关 Profile。

---

### 用户故事 2：获得符合 Claude Messages 契约的结构化译文（优先级：P1）

用户希望 Claude 翻译请求使用其原生 Messages 契约，并在没有服务端 JSON Schema 约束的兼容 Endpoint 上仍能把结果安全、完整地映射回原字幕。

**优先级理由**：Claude 与现有 Chat Completions、Ollama 原生格式不同；请求或响应契约错误会使配置正确的 Profile 仍无法翻译，或把错误内容提交为字幕。

**独立测试**：让 Claude-compatible Endpoint 处理含多个字幕 ID 的翻译请求，检查请求头、顶层 system 指令、消息正文和必填生成上限，并确认有效 `content[].text` 结果逐条映射；再返回空内容、非文本内容、畸形 JSON、截断输出、缺失或重复 ID，确认失败被安全拒绝。

**验收场景**：

1. **假如** Claude Profile 执行 Test 或翻译，**当** 请求发送，**那么** 请求使用 Claude Messages 契约，携带所需版本与 API Key，并把系统指令与用户消息放在该契约规定的位置。
2. **假如** Claude-compatible Endpoint 不支持服务端 JSON Schema，**当** 执行字幕翻译，**那么** 请求通过严格指令要求只返回目标 JSON，不发送 OpenAI `response_format`、Ollama `format` 或其他结构化输出声明。
3. **假如** 服务返回有效 Messages 响应，且文本内容组成的 JSON 中每个目标 ID 恰好出现一次并具有非空译文，**当** 系统处理结果，**那么** 译文按 ID 提交到所属字幕和会话。
4. **假如** 服务返回空内容、无可用文本、截断内容、畸形 JSON、额外 ID、缺失 ID、重复 ID 或空译文，**当** 系统处理结果，**那么** 该结果不会作为有效字幕提交，用户得到安全分类后的反馈，原始播放与原字幕继续正常工作。

---

### 用户故事 3：安全刷新 Claude 模型并保持服务隔离（优先级：P2）

用户希望从当前 Claude Endpoint 获取模型，也能输入自定义 Model ID；模型目录不可用、认证失败或并发请求不得泄漏凭据、覆盖其他服务状态或授权字幕外发。

**优先级理由**：模型发现降低配置错误，但 Claude-compatible 服务可能只实现 Messages；刷新能力必须在兼容性和既有安全边界之间保持平衡。

**独立测试**：使用正确、缺失和错误凭据刷新 Claude 模型，再让 Endpoint 不提供模型目录，并制造 Endpoint 切换、凭据替换和乱序响应，确认列表、自定义值、错误反馈与凭据始终归属于正确上下文。

**验收场景**：

1. **假如** 当前 Claude Endpoint 返回有效模型目录，**当** 自动或手动刷新完成，**那么** 用户可选择该服务公开的全部有效 Model ID，或继续输入精确的自定义 Model ID。
2. **假如** Endpoint 不提供兼容模型目录、刷新失败或响应无效，**当** 结果返回，**那么** 当前 Model ID、上次成功列表和自定义输入能力保持可用，Profile 选择与翻译授权不变。
3. **假如** 用户手动刷新时填写了尚未保存的 API Key，**当** 请求完成，**那么** 该 Key 只用于本次刷新且不会进入响应、模型目录、持久偏好、日志、诊断或无关 UI 状态。
4. **假如** 旧 Endpoint、旧凭据或旧 Profile 的响应迟到，**当** 当前上下文已经改变，**那么** 旧结果不得覆盖当前模型列表、操作反馈或翻译状态。

### 边界情况

- Claude 官方服务或兼容 Endpoint 因 API Key 缺失、无效、余额不足、限流、版本不兼容或服务不可用而拒绝请求时，必须沿用现有安全错误分类，且不得暴露请求头或原始敏感响应。
- Endpoint 只实现 Messages 而不提供模型目录时，用户仍可填写自定义 Model ID，并通过 Test 判断该模型能否用于翻译。
- 模型目录采用分页时，用户应能获得服务在 `has_more` 变为 false 前公开的全部有效 Model ID；所需分页游标为空、重复或异常时必须终止刷新，且不得清空已有选择。
- Messages 响应包含多个文本块时，其文本只能按服务返回顺序形成一个候选结果；没有文本块、候选结果不是单一完整 JSON、`stop_reason` 不是 `end_turn`，或响应包含拒绝信号时，结果均视为协议失败。
- JSON 语法有效但结构或字幕 ID 集合不符合请求时，结果仍视为协议失败，不得部分提交。
- 用户在 Claude、OpenAI、DeepSeek 与 Ollama 之间切换时，各 Service type 的草稿、模型目录、凭据状态和请求结果不得串用。
- 用户配置本机或局域网 Claude-compatible Endpoint 时，URL、重定向、代理与目的地检查不得因其使用 HTTP 或私有地址而绕过既有安全规则。

## 需求

### 功能需求

- **FR-001**：产品必须新增用户可见名称为 “Claude” 的第四种 Service type；下拉框中的固定顺序必须为 OpenAI、Claude、DeepSeek、Ollama。
- **FR-002**：新建 Claude Profile 必须以 “Claude” 作为系统拥有的默认名称，并以 `https://api.anthropic.com` 作为初始 API Root；用户仍可编辑名称与有效的完整 HTTP(S) API Root。
- **FR-003**：Claude Profile 必须支持现有 Profile 的保存、模型刷新、Test、Select、编辑、删除、revision 与网络路线流程；只有用户明确 Select 的当前 revision 才能接收当前窗口授权外发的字幕。
- **FR-004**：Claude API Root 必须用于访问 `/v1/messages` 与 `/v1/models`；路径组合必须避免重复版本段，并对末尾斜杠产生一致结果，使官方服务及遵循相同路径的自定义兼容服务均可配置。
- **FR-005**：Claude 模型目录必须从当前 API Root 的模型列表响应提取非空 Model ID、去除完全重复项，并在 `has_more` 为 true 时把唯一非空的 `last_id` 作为 `after_id` 继续刷新，直至 `has_more` 为 false；产品不得预置、推荐、猜测或自动选择 Claude Model ID。
- **FR-006**：模型刷新失败、模型目录不受支持或分页响应无效时，系统必须保留当前 Model ID、上次成功列表与自定义输入能力；只有当前 Service type、Endpoint、Profile、凭据状态和请求时序完全匹配的最新结果可以更新当前目录。
- **FR-007**：Claude Profile 必须要求用户提供非空 API Key；该 Key 必须作为 Claude 契约凭据用于所属 Profile 的模型刷新、Test 和翻译，并沿用现有只写、替换、已配置状态与随 Profile 删除的凭据生命周期。
- **FR-008**：每次 Claude 模型刷新、Test 与翻译请求必须携带 `x-api-key` 和 `anthropic-version: 2023-06-01`，且凭据保存后不得向 Sidebar 或 Main 返回其值。
- **FR-009**：Claude Test 与翻译必须使用非流式 Messages 契约；请求必须包含精确 Model ID、正数生成上限、`temperature: 0`、顶层 system 指令，以及承载该批目标的 user 消息。
- **FR-010**：Claude 翻译指令必须把目标文本及上下文视为不可信数据，只翻译每个目标的 `text`，仅使用上下文消歧，并要求每个输入 ID 恰好返回一次非空目标语言译文及单一 JSON 对象，不得输出说明、包装文本或额外字段。
- **FR-011**：Claude 请求不得发送 OpenAI `response_format`、Ollama `format`、JSON Schema、工具调用或其他 Claude-compatible 验证目标不要求的结构化输出能力；结构化结果必须由严格指令和本地完整校验共同保证。
- **FR-012**：Claude 响应只能从 `content` 中的文本块按返回顺序形成候选结果；候选结果必须通过完整 JSON、目标集合、精确 ID、唯一性和非空译文校验，`stop_reason` 必须为 `end_turn`，且响应不得包含拒绝信号。任一检查失败时，该次 wire 结果不得部分提交。
- **FR-013**：Claude Test 必须对当前 Profile revision 执行真实 Messages 请求并验证可用的结构化结果；模型目录成功、缓存状态或基础服务版本响应不得替代 Test。
- **FR-014**：Claude 请求必须沿用现有字幕最小外发、批次与 wire 上限、取消、超时、重试、响应大小、重定向、目的地校验、提示注入防护和会话所有权边界。
- **FR-015**：Claude 的认证、配额、限流、网络、配置、版本、协议、拒绝和空输出失败必须转换为不含凭据、请求头、字幕正文、译文或未清洗服务响应的可操作反馈；失败不得阻塞原始播放。
- **FR-016**：新增 Claude 不得改变既有 OpenAI、DeepSeek 与 Ollama Profile 的可见性、保存数据、Endpoint、模型发现、凭据、选择或翻译行为，也不得把既有 Profile 自动改为 Claude。
- **FR-017**：当前用户文档必须说明 Claude 的配置、选择、API Key 风险、可能产生的服务费用、Claude-compatible 自定义 Endpoint 与错误排查，并把受支持服务更新为 OpenAI、Claude、DeepSeek 和 Ollama。
- **FR-018**：自动化验证必须覆盖 Service type 顺序与默认值、Profile 全生命周期、模型发现及分页、自定义 Model ID、Messages 请求与响应、提示式 JSON 约束、有效与无效结果、错误分类、竞态隔离及敏感数据不泄漏；真实兼容服务验证必须保留可由单名开发者执行的明确步骤。

### 关键实体

- **Claude Profile**：用户保存的 Claude 翻译服务配置，包含名称、Service type、API Root、Model ID、网络路线、revision 与凭据已配置状态；API Key 值不属于可读 Profile 状态。
- **Claude 翻译请求**：属于特定 Profile revision、窗口和字幕 wire 的瞬时 Messages 请求，包含顶层 system 指令、目标消息与有界生成设置。
- **Claude 翻译响应**：Messages 返回的瞬时结果；只有文本内容形成的单一 JSON 候选通过完整目标集合校验后才能提交。
- **Claude 模型目录**：某一 API Root、Profile、凭据状态与请求时序最近一次成功返回的有效 Model ID 集合，可以为空且不得跨上下文复用。
- **Provider 凭据**：与单个 Claude Profile 关联的只写 API Key，只在模型刷新、Test 和用户明确授权的翻译中使用。

## 成功标准

### 可度量结果

- **SC-001**：所有 Service type 展示位置的选项顺序与 OpenAI、Claude、DeepSeek、Ollama 的匹配率为 100%，新建 Claude Profile 的名称和 API Root 初始值正确率为 100%。
- **SC-002**：使用有效 Endpoint、API Key 和可用模型时，单名开发者可在 3 分钟内首次尝试完成新建、刷新或填写模型、保存、Test、Select 并看到首条 Claude 译文的完整流程。
- **SC-003**：对配置有效且服务正常响应的 Claude Profile，Test 首次通过率为 100%，有效字幕批次获得可提交结构化译文的比例为 100%。
- **SC-004**：有效响应中的字幕 ID 与提交译文的匹配率为 100%；空、非文本、截断、畸形或 ID 集合不完整的响应被部分提交的次数为 0。
- **SC-005**：连续完成至少 20 个 Claude 字幕 wire 的验收中，因 Messages 格式或服务端 JSON Schema 依赖导致的失败次数为 0，原始播放被翻译等待或失败阻塞的次数为 0。
- **SC-006**：正确、缺失和错误凭据、模型分页异常、刷新竞态、Profile revision 变化及会话清理的安全验收中，凭据或字幕内容进入禁止位置、跨 Profile 结果或迟到提交的次数均为 0。
- **SC-007**：新增 Claude 后，既有 OpenAI、DeepSeek 与 Ollama 的 Profile、模型发现、Test、Select 和翻译回归通过率为 100%。

## 范围边界

- 本功能新增独立 Claude Service type，包含 Profile UI、模型发现、Test、字幕翻译、凭据安全、错误反馈、自动化验证和当前用户文档。
- 本功能支持 Anthropic Messages 契约及遵循同一必要契约的自定义 Endpoint；不把 Claude 限制为 Anthropic 官方托管服务。
- 本功能只处理非流式文本字幕翻译，不新增图像、PDF、工具调用、Prompt caching、Batch、流式输出或 thinking 配置。
- 本功能不依赖服务端 JSON Schema 或工具调用约束结构化输出，不提供相关能力探测或降级重试。
- 本功能不预置、推荐或自动选择具体 Model ID，也不下载、安装或管理兼容服务上的模型。
- 本功能不管理 Anthropic 账号、API Key、余额、充值、配额或服务端模型，也不提供凭据读回。
- 本功能不改变字幕批次、重试、缓存、提示词安全、显示、Profile 选择授权或现有服务契约，不新增持久化字幕、译文或模型目录。

## 假设

- Anthropic 官方 API Root 为 `https://api.anthropic.com`，Messages 位于 `/v1/messages`，模型目录位于 `/v1/models`，稳定版本请求头使用 `2023-06-01`。
- 自定义 Claude-compatible Endpoint 至少实现本规格所需的非流式 Messages 行为；模型目录是可选兼容能力，不提供时可使用自定义 Model ID。
- Ollama 0.14.0 或更高版本的 Anthropic-compatible Endpoint 是本功能的单开发者 live test 目标之一，但不是产品默认 Endpoint、内置模型来源或运行时依赖。
- 用户自行取得可用 API Key、选择服务当前可用模型并承担远程服务费用；无需认证但兼容客户端要求非空 Key 的本地服务由用户填写其接受的占位值。
- Claude-compatible 验证目标不提供本功能可依赖的 JSON Schema 输出约束，因此严格提示与响应校验是所有 Claude Profile 的一致行为。
- 既有 Provider Profile、凭据存储、模型目录、翻译提交和会话清理契约可扩展到第四种 Service type，无需迁移已有 OpenAI、DeepSeek 或 Ollama Profile。

## 外部契约依据

- [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Claude Models API](https://platform.claude.com/docs/en/api/models/list)
- [Ollama Anthropic API compatibility](https://docs.ollama.com/api/anthropic-compatibility)
