# 功能规格：添加 DeepSeek 翻译服务

**功能目录**：`specs/019-add-deepseek-provider`  
**创建日期**：2026-08-29  
**状态**：草案

**输入**：新增 DeepSeek Service type，使用 DeepSeek 支持的 OpenAI-compatible Chat Completions 格式完成字幕翻译，并适配其 JSON 输出与默认 thinking 行为。

## 用户场景与测试

### 用户故事 1：配置并使用 DeepSeek Profile（优先级：P1）

拥有 DeepSeek API 凭据的用户希望直接创建独立的 DeepSeek Profile，测试并选择后用于字幕翻译，而不必把 DeepSeek 伪装成 OpenAI 服务。

**优先级理由**：独立且完整的 Profile 流程是用户实际使用 DeepSeek 翻译字幕的前提。

**独立测试**：从新建 Profile 开始选择 DeepSeek，完成模型刷新、保存、Test、Select 和字幕翻译，再编辑并删除该 Profile，确认各步骤均作用于 DeepSeek 且不改变其他 Profile。

**验收场景**：

1. **假如** 用户打开 Service type 下拉框，**当** 查看选项，**那么** 顺序必须为 OpenAI、DeepSeek、Ollama。
2. **假如** 用户选择 DeepSeek，**当** 新建 Profile 表单切换完成，**那么** 表单使用 DeepSeek 名称和官方 API Root 作为初始值，并保留 Endpoint、Model ID、API Key 与网络路线的配置能力。
3. **假如** 用户填写可用配置并保存，**当** 依次执行 Test、Select 和字幕翻译，**那么** 测试通过、当前窗口选择该 Profile，并持续显示与字幕对应的译文。
4. **假如** 用户编辑或删除已保存的 DeepSeek Profile，**当** 操作完成，**那么** Profile revision、选择失效、凭据替换或清理行为与其他服务保持一致，且不影响无关 Profile。

---

### 用户故事 2：获得符合 DeepSeek 契约的结构化译文（优先级：P1）

用户希望 DeepSeek 翻译请求避开其不支持的 OpenAI JSON Schema 格式，并关闭字幕翻译不需要的 thinking，使返回内容可以稳定映射回原字幕。

**优先级理由**：若请求携带不受支持的输出格式或保持默认 thinking，Profile 即使配置正确也可能失败，且确定性设置可能不生效。

**独立测试**：让 DeepSeek 处理含多个字幕 ID 的翻译请求，检查请求只要求 JSON object、明确关闭 thinking，并确认有效结果逐条映射；再返回空内容、畸形 JSON、缺失或重复 ID，确认失败被安全拒绝。

**验收场景**：

1. **假如** DeepSeek Profile 执行 Test 或翻译，**当** 请求发送，**那么** 请求只使用 DeepSeek Chat Completions 支持的 JSON object 输出模式，不包含 OpenAI 风格的 JSON Schema 输出声明。
2. **假如** 所选 DeepSeek 模型默认开启 thinking，**当** 执行字幕翻译，**那么** 请求明确关闭 thinking，并保留字幕翻译所需的确定性设置。
3. **假如** DeepSeek 返回有效 JSON object，且每个目标 ID 恰好出现一次并具有非空译文，**当** 系统处理结果，**那么** 译文按 ID 提交到所属字幕和会话。
4. **假如** DeepSeek 返回空内容、截断内容、畸形 JSON、额外 ID、缺失 ID、重复 ID 或空译文，**当** 系统处理结果，**那么** 结果不会作为有效字幕提交，用户得到安全分类后的反馈，原始播放与原字幕继续正常工作。

---

### 用户故事 3：安全刷新 DeepSeek 模型并保持服务隔离（优先级：P2）

用户希望从当前 DeepSeek Endpoint 获取模型，也能输入自定义 Model ID；刷新、认证失败或并发请求不得泄漏凭据、覆盖其他服务状态或授权字幕外发。

**优先级理由**：模型发现降低配置错误，但必须服从既有凭据和请求所有权边界。

**独立测试**：使用正确、缺失和错误凭据刷新 DeepSeek 模型，再制造 Endpoint 切换、凭据替换和乱序响应，确认列表、自定义值、错误反馈与凭据始终归属于正确上下文。

**验收场景**：

1. **假如** 当前 DeepSeek Endpoint 返回有效模型列表，**当** 自动或手动刷新完成，**那么** 用户可选择响应中的全部有效 Model ID，或继续输入精确的自定义 Model ID。
2. **假如** 模型刷新失败或响应无效，**当** 结果返回，**那么** 当前 Model ID、上次成功列表和自定义输入能力保持可用，Profile 选择与翻译授权不变。
3. **假如** 用户手动刷新时填写了尚未保存的 API Key，**当** 请求完成，**那么** 该 Key 只用于本次刷新且不会进入响应、模型目录、持久偏好、日志、诊断或无关 UI 状态。
4. **假如** 旧 Endpoint、旧凭据或旧 Profile 的响应迟到，**当** 当前上下文已经改变，**那么** 旧结果不得覆盖当前模型列表、操作反馈或翻译状态。

### 边界情况

- DeepSeek 官方服务因 API Key 缺失、无效、余额不足、限流或服务不可用而拒绝请求时，必须沿用现有安全错误分类，且不得暴露授权头或原始敏感响应。
- Endpoint 不提供兼容的模型列表时，用户仍可填写自定义 Model ID，并通过 Test 判断该模型能否用于翻译。
- JSON object 语法有效但结构或字幕 ID 集合不符合请求时，结果仍视为协议失败，不得部分提交。
- DeepSeek 在 JSON 输出模式下偶发返回空内容或输出被长度限制截断时，不得把空译文或不完整批次显示给用户。
- 用户在 DeepSeek、OpenAI 与 Ollama 之间切换时，各 Service type 的草稿、模型目录、凭据状态和请求结果不得串用。

## 需求

### 功能需求

- **FR-001**：产品必须新增用户可见名称为 “DeepSeek” 的第三种 Service type；下拉框中的固定顺序必须为 OpenAI、DeepSeek、Ollama。
- **FR-002**：新建 DeepSeek Profile 必须以 “DeepSeek” 作为系统拥有的默认名称，并以 `https://api.deepseek.com` 作为初始 API Root；用户仍可编辑名称与有效的完整 HTTP(S) API Root。
- **FR-003**：DeepSeek Profile 必须支持现有 Profile 的保存、模型刷新、Test、Select、编辑、删除、revision 与网络路线流程；只有用户明确 Select 的当前 revision 才能接收当前窗口授权外发的字幕。
- **FR-004**：DeepSeek 模型目录必须来自当前 API Root 的兼容模型列表响应，提取、去重、保留自定义 Model ID、刷新失败保留和竞态隔离规则必须与现有模型发现契约一致；产品不得预置或猜测 DeepSeek Model ID。
- **FR-005**：DeepSeek API Key 必须用于所属 Profile 的模型刷新、Test 和翻译，并沿用现有只写、替换、已配置状态与随 Profile 删除的凭据生命周期；保存后不得向 Sidebar 或 Main 返回凭据值。
- **FR-006**：DeepSeek Test 与翻译必须使用其 OpenAI-compatible Chat Completions 契约，并把结构化输出模式固定为 `json_object`；请求不得发送 DeepSeek Chat Completions 不支持的 `json_schema` 输出模式或其 Schema 内容。
- **FR-007**：启用 `json_object` 时，翻译指令必须明确要求只返回 JSON，并描述每个目标 ID 恰好对应一个非空译文的目标结构。
- **FR-008**：每次 DeepSeek Test 与翻译请求必须显式把 thinking 设为 `disabled`，并继续把 temperature 设为 `0`；不得依赖 thinking 开启时不会生效的 temperature 行为。
- **FR-009**：DeepSeek 返回内容必须经过完整 JSON、目标集合、精确 ID、唯一性和非空译文校验；只要任一检查失败，该次 wire 结果不得部分提交。
- **FR-010**：DeepSeek 的能力判断不得先发送已知不受支持的 `json_schema` 请求再降级；Test 必须对当前 Profile revision 执行真实联网检查，且缓存状态不得替代该检查。
- **FR-011**：DeepSeek 请求必须沿用现有字幕最小外发、批次与 wire 上限、取消、超时、重试、响应大小、重定向、目的地校验、提示注入防护和会话所有权边界。
- **FR-012**：DeepSeek 的认证、配额、限流、网络、配置、协议、拒绝和空输出失败必须转换为不含凭据、授权头、字幕正文、译文或未清洗服务响应的可操作反馈；失败不得阻塞原始播放。
- **FR-013**：DeepSeek 凭据、字幕正文和译文不得进入 preferences、日志、诊断、进程参数、安装包或无关 UI 状态；临时显示文件与内存缓存必须随所属会话清理。
- **FR-014**：新增 DeepSeek 不得改变既有 OpenAI 与 Ollama Profile 的可见性、保存数据、Endpoint、模型发现、凭据、选择或翻译行为，也不得把既有 Profile 自动改为 DeepSeek。
- **FR-015**：当前用户文档必须说明 DeepSeek 的配置、选择、API Key 风险、可能产生的服务费用与错误排查，并把受支持服务更新为 OpenAI、DeepSeek 和 Ollama。
- **FR-016**：自动化验证必须覆盖 Service type 顺序与默认值、Profile 全生命周期、模型发现、自定义 Model ID、正确请求模式、thinking 关闭、有效与无效响应、错误分类、竞态隔离及敏感数据不泄漏；使用真实 DeepSeek 服务的验证必须保留可由单名开发者执行的明确步骤。

### 关键实体

- **DeepSeek Profile**：用户保存的 DeepSeek 翻译服务配置，包含名称、Service type、API Root、Model ID、网络路线、revision 与凭据已配置状态；API Key 值不属于可读 Profile 状态。
- **DeepSeek 翻译请求**：属于特定 Profile revision、窗口和字幕 wire 的瞬时请求，要求 JSON object 输出并关闭 thinking。
- **DeepSeek 模型目录**：某一 API Root、Profile、凭据状态与请求时序最近一次成功返回的有效 Model ID 集合，可以为空且不得跨上下文复用。
- **Provider 凭据**：与单个 DeepSeek Profile 关联的只写 API Key，只在模型刷新、Test 和用户明确授权的翻译中使用。

## 成功标准

### 可度量结果

- **SC-001**：所有 Service type 展示位置的选项顺序与 OpenAI、DeepSeek、Ollama 的匹配率为 100%，新建 DeepSeek Profile 的名称和 API Root 初始值正确率为 100%。
- **SC-002**：使用有效 Endpoint、API Key 和当前可用模型时，单名开发者可在 3 分钟内完成新建、刷新模型、保存、Test、Select 并看到首条 DeepSeek 译文的完整流程。
- **SC-003**：对配置有效且服务正常响应的 DeepSeek Profile，Test 首次通过率为 100%，有效字幕批次获得可提交结构化译文的比例为 100%。
- **SC-004**：有效响应中的字幕 ID 与提交译文的匹配率为 100%；空、截断、畸形或 ID 集合不完整的响应被部分提交的次数为 0。
- **SC-005**：连续完成至少 20 个 DeepSeek 字幕 wire 的验收中，因 DeepSeek 输出模式不兼容或默认 thinking 导致的失败次数为 0，原始播放被翻译等待或失败阻塞的次数为 0。
- **SC-006**：正确、缺失和错误凭据、刷新竞态、Profile revision 变化及会话清理的安全验收中，凭据或字幕内容进入禁止位置、跨 Profile 结果或迟到提交的次数均为 0。
- **SC-007**：新增 DeepSeek 后，既有 OpenAI 与 Ollama 的 Profile、模型发现、Test、Select 和翻译回归通过率为 100%。

## 范围边界

- 本功能新增独立 DeepSeek Service type，包含 Profile UI、模型发现、Test、字幕翻译、凭据安全、错误反馈、自动化验证和当前用户文档。
- 本功能只支持 DeepSeek 的 OpenAI-compatible Chat Completions 格式，不新增 Anthropic 或 Responses API 翻译路径。
- 本功能不提供 thinking 开关或推理强度设置；字幕 Test 与翻译始终关闭 thinking。
- 本功能不预置、推荐或自动选择具体 Model ID，也不管理 DeepSeek 账号、API Key、余额、充值、配额或服务端模型。
- 本功能不改变字幕批次、重试、缓存、提示词安全、显示、Profile 选择授权或现有服务契约，不新增持久化字幕、译文或模型目录。

## 假设

- DeepSeek 官方 API Root 为 `https://api.deepseek.com`，模型列表位于该 Root 的 `/models`，Chat Completions 位于 `/chat/completions`。
- 用户配置的其他 API Root 需要兼容本规格所述 DeepSeek 模型列表与 Chat Completions 行为；不提供模型列表时可使用自定义 Model ID。
- 用户自行取得可用 API Key、选择服务当前返回的模型并承担服务费用；SubTandem 不提供 API 额度。
- DeepSeek JSON Output 可能偶发空内容，现有有界重试与安全错误反馈足以处理该情况，不为此新增无限重试或特殊持久化状态。
- 既有 Provider Profile、凭据存储、模型目录、翻译提交和会话清理契约可扩展到第三种 Service type，无需迁移已有 OpenAI 或 Ollama Profile。

## 外部契约依据

- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek JSON Output 指南](https://api-docs.deepseek.com/guides/json_mode/)
- [DeepSeek 模型列表 API](https://api-docs.deepseek.com/api/list-models)
