# 翻译 Provider 进度契约

## 接口

```ts
interface TranslationBatchProgress {
  translations: Array<{ id: string; text: string }>;
  providerRequestId?: string;
  usage?: { input?: number; output?: number; characters?: number };
}

type TranslationProgressHandler = (progress: TranslationBatchProgress) => void;

interface TranslationProvider {
  attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult>;
  cancel?(requestId: string): Promise<void> | void;
}
```

## 行为

1. 每个最多 2 cue 的 wire 请求收到成功响应后，provider 先执行既有 ID/文本验证并恢复原始 cue ID。
2. 若存在至少一个有效译文，provider 同步调用一次 `onProgress`，只传当前 wire 请求的有效增量。
3. 无效、未知、重复、空白或无法恢复 ID 的项不进入进度。
4. attempt 成功时仍返回所有 wire 请求的完整聚合与汇总 usage，调用方可不提供进度回调。
5. 任一 wire 请求失败时 attempt 以既有安全错误终结；之前已经发送的进度不会出现在错误对象中，也不被撤销。
6. cancel 或 attempt 终态之后不得再调用 `onProgress`。
7. provider 不重试；Main 继续拥有重试策略。

## 安全边界

进度只允许原始 cue ID、译文以及既有安全元数据。不得携带字幕原文、凭据、Authorization、endpoint、请求 body 或 provider 原始响应。
