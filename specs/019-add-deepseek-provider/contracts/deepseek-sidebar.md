# 契约：DeepSeek Sidebar

## Service type 与默认值

Service type 下拉框的 DOM 与视觉顺序必须固定为：

1. OpenAI
2. DeepSeek
3. Ollama

新建 DeepSeek 草稿：

| 控件 | 初始值 |
| --- | --- |
| Profile name | `DeepSeek`，system-owned |
| Endpoint | `https://api.deepseek.com` |
| Model ID | 空，Custom 可输入 |
| API key | 空且不回显 |
| Network route | `system` |

用户编辑名称后，切换 Service type 不得覆盖其用户值；载入已保存 Profile 时保留其名称。OpenAI、DeepSeek、Ollama 的 Endpoint、Model ID 与 route 草稿相互独立；API Key、目录、pending owner 和反馈不得跨草稿保留。

## Provider 元数据与文案

第三种 kind 必须通过穷举映射或穷举 switch 处理，不得用 `openai ? ... : ollama` 的二分 fallback。

DeepSeek 当前文案必须说明：

- Endpoint 是完整 HTTP(S) API Root；实际 Chat 请求追加 `/chat/completions`；
- 模型刷新追加 `/models`，可选择返回的 ID 或输入精确 Custom Model ID；
- API Key 保存后只写，官方服务需要可用 Key，调用可能收费；
- endpoint、Key、余额/配额、限流、Model ID 和 network route 是可操作排错项。

错误反馈不得把 DeepSeek 误称为 OpenAI 或 Ollama，也不得包含 Endpoint、Key、Authorization、字幕、译文或服务原文。

## Model ID 控件

- 继续使用当前原生 select、固定 `Custom model ID…` 项、条件显示的必填文本输入和手动刷新按钮。
- 已知选项只来自当前 DeepSeek 目录；不得加入静态模型。
- 新目录不得自动选择首项、清空或改写当前值。
- 刷新失败保留当前值、Custom 能力和上次成功目录；成功空目录只留下 Custom。
- 手动刷新时存在非空未保存 Key 才使用 preview；自动刷新不得读取该 Key。
- Model ID 为空时 Save 在 Sidebar 本地停止并聚焦模型控件，不发送半成品 Profile。

## Profile 操作

- Save 成功只创建 revision；若同时保存 Key，必须等待 Key 结果后完成当前操作反馈。
- Test 每次显示独立 busy/结果，不改变选择。
- Select 只选择安全 view 中的当前 revision；已选按钮与状态属于精确 Profile。
- Update 增长 revision并使原选择失效；kind 变化还清除旧凭据状态并要求新 Key。
- Delete 使用现有确认，成功后清理目标 Profile 行、测试状态、编辑状态与选择；其他 Profile 不变。

所有操作结果必须核对 request ID 与所属 Profile/revision；模型和凭据反馈还必须核对当前编辑上下文。迟到结果不得结束较新的 busy 或覆盖较新反馈。

## 可访问性与布局

沿用当前字段标签、`aria-describedby`、模型 `role="status" aria-live="polite"`、按钮 busy 状态与键盘焦点。新增 DeepSeek 选项和提示不得改变窄 Sidebar 下的可操作性，也不得把 API Key 的只写说明合并进输入标签。

## 文档一致性

根 README、全部当前本地化 README、`Info.json` 网络披露和开发指南必须同步为 OpenAI、DeepSeek、Ollama，并明确：

- 默认 DeepSeek API Root 可能在 Select 前收到不含字幕的模型目录请求；
- 只有明确 Select 的当前 Profile revision 才接收字幕；
- Key 本地只写保存的风险与权限；
- DeepSeek 服务费用、认证、余额/配额、限流和网络排错；
- 翻译等待或失败不阻塞播放与原字幕。
