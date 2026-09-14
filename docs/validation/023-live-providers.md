# 真实 Provider 验收证据

日期：2026-09-14。范围：[023 T039](../../specs/023-provider-language-detection/tasks.md)，执行方法见[验证指南](../../specs/023-provider-language-detection/quickstart.md)。代码提交：`25ae3c5476869a89d8230879feeb79bd8e1d2642`。

沿用用户对联网与潜在费用的明确授权，凭据仅从 Keychain 注入测试进程。环境为 macOS 26.6.2（25G83）、arm64、Node.js 24.18.0、npm 11.16.0。本记录不包含 endpoint、凭据、字幕、译文或原始响应。

## 执行结果

三组命令均运行原有 `tests/integration/live-providers.test.ts`，成功退出码均为 0；每组仅跳过未启用的其他 Provider。

| 测试开关                         | Provider          | 公开模型 ID           | 用例耗时   | 结果 |
| -------------------------------- | ----------------- | --------------------- | ---------- | ---- |
| `SUBTANDEM_LIVE_DEEPSEEK_TEST=1` | DeepSeek          | `deepseek-v4-flash`   | 25.471 秒  | 通过 |
| `SUBTANDEM_LIVE_CLAUDE_TEST=1`   | Claude-compatible | `claude-haiku-4-5`    | 157.296 秒 | 通过 |
| `SUBTANDEM_LIVE_PROVIDER_TEST=1` | OpenAI-compatible | `cx/gpt-5.6-luna-low` | 0.334 秒   | 通过 |
| `SUBTANDEM_LIVE_PROVIDER_TEST=1` | 本地 Ollama       | `qwen3:14b`           | 49.926 秒  | 通过 |

DeepSeek、Claude 分别通过新的连接测试与 40 条连续翻译（20 次双条目 wire）；OpenAI-compatible、Ollama 分别通过 probe 与 50 条连续翻译。四类服务的返回数量和身份顺序正确，原文回显、相邻上下文、罗马字说明、字段名、语言标签及额外说明计数均为 0。

四类服务均通过以下冻结矩阵：

| 场景                         | 结果                                    |
| ---------------------------- | --------------------------------------- |
| `same-language-preservation` | 6/6 逐字符一致，包含首尾空格和内部空行  |
| `mixed-language-batch`       | 6/6 非空；应原样返回的 2/2 条逐字符一致 |
| `traditional-chinese-target` | 5/5 非空，身份与结构有效                |

以上是现有自动化断言的结果，不代表对任意模型或翻译语义质量的保证；用例耗时不作为模型推理性能指标。

## 网络路径与交付边界

Claude 首次连接测试以 `LIVE_TRANSPORT_NETWORK` 失败；无凭据检查进一步得到 `UND_ERR_CONNECT_TIMEOUT`。启用现有环境代理后，同一服务的无凭据检查返回 HTTP 200，完整测试使用 `NODE_USE_ENV_PROXY=1` 重跑通过。该设置仅作用于测试进程，不改变插件代理行为；未修改生产代码、测试样本、断言、重试或超时。

本轮只更新验证记录和任务状态，无代码或构建产物变更。已复核[最终包记录](023-local-ollama.md)的 SHA-256 与现有安装包一致。T039 完成；T040 的 IINA 正式包单人验收仍待按验证指南执行，自动化结果不替代宿主验收。
