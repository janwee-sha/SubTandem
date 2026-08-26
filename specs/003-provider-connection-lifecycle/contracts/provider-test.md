# Profile 真实连接测试契约

## Provider 接口

```ts
interface ProviderConnectionTester {
  testConnection(testId: string): Promise<unknown>;
}

type ConfiguredProvider = TranslationProvider & ProviderConnectionTester;

interface TranslationProvider {
  attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult>;
  cancel?(requestId: string): Promise<void> | void;
}
```

`testConnection` 是每次用户 Test 的唯一入口。只有 Global 中由 Profile 构建的 Provider 运行时需要实现该接口；Main 侧翻译客户端和测试 fake 的基础 `TranslationProvider` 契约不变。`testId` 是 Global 内部身份，不进入用户可见结果或现有跨运行时消息。

## 每次真实联网

1. 每次 `testConnection(testId)` 至少发出一个针对当前 Profile endpoint、model、proxyMode 和 credential 状态的真实服务请求。
2. OpenAI-compatible 已缓存 capability 时，必须用该 capability 发送并验证一个固定最小检查；不得直接返回 capability。
3. OpenAI-compatible 未缓存 capability 时，按既有固定顺序发现兼容格式；认证、模型、配额、网络等非 capability 不兼容错误必须立即结束，不得被 fallback 掩盖。
4. Ollama 必须继续真实验证当前服务、目标模型和结构化翻译响应。
5. 测试内容只能使用固定非字幕探针，不得发送当前字幕、缓存译文或播放状态。
6. 同一 OpenAI-compatible Provider 实例的 Test 与翻译请求必须复用同一个 `X-Session-Id`；测试不得为每次操作创建新的网关会话身份。

## 错误契约

- Test 结果继续使用现有 `provider:test-result` 字段和安全错误分类。
- 401/403 继续归入认证问题，模型缺失归入模型问题，429 归入配额问题，超时与网络错误保持现有用户行动。
- 错误不得包含 credential、Authorization、请求体、字幕、provider 原始响应或不在 allowlist 中的 header。
- capability 缓存不得把本次任何错误转换为成功。

## 唯一身份与取消

- Global 为每条 `provider:test` 消息生成唯一 `testId`，并关联权威 player ID、外部 request ID、Profile ID/revision 和 Provider。
- 同一窗口重复 Test、不同窗口相同外部 request ID，以及同一 Provider 上并发 Test 均为不同任务。
- Provider 的全部测试子请求必须可由该 `testId` 精确识别；不得使用会取消其他 Test 的全局 `probe-*` 范围。
- Profile 删除只取消属于该 Profile 的活动测试；完成一个测试只删除自身记录。
- 全局清理可取消全部活动测试，但每个任务仍各自进入唯一终态。

## 消息与播放选择不变

请求继续使用：

```ts
postMessage("provider:test", {
  requestId,
  revision,
  payload: { profileId, revision }
});
```

结果继续使用现有 `provider:test-result` 成功或失败字段。内部 `testId` 不新增到消息。

Test 不调用 Profile Select、不创建播放 lease、不改变任一窗口的当前选择，也不授权字幕外发。只有用户独立执行 Select 后，Profile 才能用于播放翻译。
