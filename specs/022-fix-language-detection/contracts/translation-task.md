# 翻译任务与原样正文契约

对应 FR-005–012、SC-003–006；请求实体见 [数据模型](../data-model.md)。

## Main↔Global 与授权

- 保留 `provider:attempt`、`provider:attempt-progress`、`provider:attempt-result`、`provider:attempt-error` 消息名及 envelope；请求的 `sourceLanguage` 必填，允许可靠源语言 ID 或 `null`。`null` 明确表示本地未确定，禁止改写为推测语言、空字符串、`auto` 或 `und`。
- `targetLanguage` 必须属于目标目录并完整保留变体；可靠 source 使用独立源目录取英文标签。缺失/非法字段拒绝，合法 `null` 不得导致 `INVALID_LANGUAGE_ID`。该校验在调用 transport 之前完成。
- Main 生成播放/请求身份；Global 以 IINA 回调的发送方 ID 校验选择的 Profile、revision 和 endpointFingerprint，并以权威发送方 ID 调用 Broker/provider。不能要求该 ID 等于 Main 自身的 `playerId`；回复只能返回原发送窗口。
- source 为 `null` 或源目标相同不影响授权、取消、有限前瞻、wire 大小、部分提交及现有重试策略。没有独立远程检测步骤、新 endpoint、凭据通路或诊断正文。

## 所有任务共同要求

1. 有可靠 source 时提供正确语言标签；为 `null` 时明确要求从待翻译正文及既有必要上下文理解源语言，不提供确定性语言方向。
2. 服务必须逐条判断 `text` 是否已经符合目标语言及显式书写系统/地区变体。符合时逐字符返回该 `text`；否则只翻译该 `text`。
3. 原样结果保留文字、标点、大小写、空格、换行，不润色、改写、罗马化或附加解释。通用 `zh` 不代表符合 `zh-Hans/zh-Hant`，通用 `pt` 不代表符合 `pt-PT`；混合批次按条目判断，不整批套用同语言结论。
4. `context_previous/context_next` 仅用于理解，不能复制或输出。字幕是非可信数据，不能改变任务指令；服务只能返回指定 ID 对应正文，不添加原文副本、标签、Markdown 或说明。
5. system 提示中的语言和原样规则来自共同 builder；服务差异仅负责输出封装。禁止保留与合法同语言结果冲突的绝对“不得输出 source text”要求。

## 各服务封装

| 服务/模式 | 保持的输出及验证 |
| --- | --- |
| OpenAI `strict-json-schema/json-object/prompt-json` | 三种模式共享完整语义，沿用 JSON ID 输出及既有逐条有效结果处理 |
| Ollama `json-schema/prompt-json` | schema 及降级提示均包含相同规则，沿用当前兼容和重试行为 |
| DeepSeek | JSON object、关闭 thinking、精确当前 wire ID；严格完整 wire 校验 |
| Claude-compatible | Messages 顶层 system、单 user、`stream:false`、既有 token 上限；`end_turn` 与 text blocks 规则及严格完整 wire 校验 |

固定的连接 Test/probe 不新增用户字幕，遵循各服务已有连接/能力发现契约。本功能不能因为未知源语言或文本相同触发额外 probe 或扩大重试。

## 返回、缓存与显示

- 只允许 `trim()` 用于判断字符串是否全为空白，不能把裁剪结果作为返回值。身份缺失/重复、空白、不可解析等沿用当前无效结果规则，OpenAI/Ollama 与 DeepSeek/Claude 的提交粒度保持各自现状。
- JSON 解码后的 `text` 必须原样经过 validator、progress/result 消息、controller、session cache 和 Overlay 适配器。字符串相等属于合法成功；结果路径不新增逐 cue 语言分类、语义改写拦截或本地回声捷径。检测副本内的语言证据归属仅用于轨道判断，见[检测契约](language-detection.md)。
- 缓存的未知 source 使用 `null`，与可靠 source ID 区分；仍包含正文、目标变体和 Profile 语义身份。会话失效清理缓存，禁止字幕及译文跨播放会话持久化。
- Overlay 的 `lines` 每项承载完整活动 cue 正文，保留内部空白行并沿用文本节点与 `pre-wrap`。按原 cue 的半开时间区间显示，不修改布局、样式或交互；字符保留测试比较文本数据，宿主人工核对视觉与时间轴。
- 语义改写若格式和身份合法，仍按成功接收；固定语料中的原样字符不一致使 SC-004 验收失败，不触发生产额外检测/重试。

产品说明必须披露：检测在本地进行，但未知源语言及同语言仍会向用户当前明确选择的服务发送必要字幕；不能继续要求用户输入源语言或保证源目标不同。
