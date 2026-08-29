# AI Provider 测试资料

本目录存放各 AI Provider 的 API 信息，仅供 live test 使用。应用的单元测试、集成测试和契约测试 MUST NOT 依赖这些信息。
AI Agent MUST NOT 主动将本目录中的任何文件纳入版本控制。

## 使用约束

如需执行 live test，AI Agent SHOULD 按以下优先级从高到低选择 Provider：

1. `ollama-local`
2. `ollama-official`
3. `deepseek`
4. `openai-local`

仅当优先级更高的 Provider 不可用、不适用，或用户明确指定其他 Provider 时，SHOULD 选择较低优先级的 Provider。
无论选择何种 Provider，AI Agent MUST 在使用相关 API 信息或发起请求前征得用户明确同意。
