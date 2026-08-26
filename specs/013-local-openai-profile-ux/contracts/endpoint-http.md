# 契约：Provider HTTP(S) endpoint

## 配置输入

Provider endpoint 必须是包含 `http://` 或 `https://` 的完整 URL。OpenAI-compatible 把保存值作为字面 API root 并继续在其后追加 `/chat/completions`；Ollama 保持现有 API root 规范化与路径拼接。

## 允许矩阵

| Service type | HTTPS | 回环 HTTP | 局域网或私网 HTTP | 公网域名/IP HTTP |
| --- | --- | --- | --- | --- |
| OpenAI-compatible | 允许 | 允许 | 允许 | 允许 |
| Ollama | 允许 | 允许 | 允许 | 允许 |

主机网络位置、域名或 IP 类型不得成为 Save、metadata 恢复、Provider 构造、Test、Select 或翻译的拒绝条件。`system` 与 `direct` 路线使用相同矩阵。HTTP 不触发额外警告、确认、HTTPS 要求、host allowlist 或自动路线变更。

## 通用拒绝规则

- 空、相对或无法完整解析的 URL；
- 非 HTTP(S) scheme；
- URL username、password 或其他 userinfo；
- Profile endpoint 中的 query 或 fragment；
- 空 host、空白 authority、非法 IPv6 bracket 或 bracket 后缀；
- 非数字、零、负数或超过 65535 的显式端口。

拒绝结果使用既有安全错误类别，不得回显 endpoint、凭据、Authorization、请求体、响应体、字幕或译文。允许远程 HTTP 不恢复已废弃的 host 限制错误，也不要求新增 HTTP 专用错误协议。

## 一致判定

1. Profile 保存和 metadata 恢复在产生可用 revision 前校验。
2. OpenAI-compatible 与 Ollama Provider 构造再次调用同一 TypeScript 生产校验。
3. Select 只接受已校验的不可变 revision 与 fingerprint，不联网。
4. Test 使用当前 Profile revision，但不自动 Select。
5. 翻译只使用当前窗口精确选择的 revision 与 fingerprint。
6. native helper 在 system/direct 分流前重新验证最终请求 URL。

任一层拒绝时不得发送上游请求、创建新 revision、清除既有选择或修改凭据。TypeScript 与 Foundation 对同一边界 corpus 必须保持安全等价；native 是最终防线。

## 代理、重定向与凭据

- `proxyMode` 继续进入 endpoint fingerprint；HTTP 不强制使用 system 或 direct。
- `system` 每个重定向目标必须先重新通过 scheme、host、userinfo 与 fragment 校验，再与初始 URL 比较 scheme、host 和有效端口；只允许前三次同源重定向。
- 同源服务重定向可沿用既有 query 行为；跨 scheme、host、有效端口、带 userinfo 或 fragment 的第二跳必须被阻止。
- `direct` 继续不跟随重定向。
- OpenAI-compatible 的可选 Authorization 只发送给用户选定的初始 origin；不得跨来源转发。Ollama 不新增凭据路径。

## 不变边界

IINA manifest 仍只允许 WebView/Main 访问本机 helper；helper 仍只监听 loopback。Profile metadata 与界面只暴露 `credentialConfigured`，不暴露凭据值。允许任意 HTTP(S) 上游不改变 Profile revision、Select/Test、多窗口、字幕范围、日志、诊断、重试、批次或会话清理语义。
