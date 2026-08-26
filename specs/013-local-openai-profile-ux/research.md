# 研究：Provider HTTP 与 Profile 交互优化

## HTTP(S) endpoint 许可

- **决策**：OpenAI-compatible 与 Ollama 共用一套 JavaScriptCore 可执行的 endpoint 解析与规范化逻辑。输入必须是包含 `http://` 或 `https://` 的完整 URL；协议合法后不再根据回环、局域网、私网、公网、域名、IPv4 或 IPv6 分类主机。继续拒绝空或相对 URL、非 HTTP(S) scheme、userinfo、query、fragment、空 host、非法端口与残缺 authority。OpenAI-compatible 保持字面 API root 路径语义，Ollama 保持既有尾斜杠规范化；fingerprint 仍由 kind、规范化 endpoint 与 proxy mode 派生。
- **理由**：共享校验让保存、metadata 恢复和两个 Provider 构造器得到相同结论，直接满足所有 Service type 的任意 HTTP(S) 许可，同时不把“允许远程 HTTP”误解成放宽 URL 结构。项目生产 JavaScript 运行于 IINA JavaScriptCore，使用有界手写解析可避免引入依赖或假设 WHATWG `URL` 可用。
- **备选方案**：只删除 OpenAI 的 scheme 判断会让 Ollama 远程 HTTP 仍失败；只修改 native 会让 Profile 无法保存；DNS/IP 分类、host allowlist 或私网特例都会重新引入规格禁止的网络位置限制；继续接受 Ollama 无 scheme 简写不符合完整 HTTP(S) URL 契约。

## Native 最终出站与重定向

- **决策**：native `UpstreamPolicy` 对任意非空 host 的 HTTP(S) 初始目标放行，仍拒绝 URL 凭据、fragment、非 HTTP(S) 与不可解析 URL。`system` 路线的每个 redirect target 先重新通过该结构校验，再与初始 URL 比较 scheme、host 和有效端口；最多跟随三次同源重定向。`direct` 路线继续不跟随重定向。Profile endpoint 仍拒绝 query；服务返回的同源重定向可保留既有 query 行为。
- **理由**：TypeScript 决定用户可保存的配置，native 在 system/direct 分流前提供最终防线。远程 HTTP 初始 origin 是用户明确选择的目标；同源限制则防止该选择和 Authorization 被扩展到未选择的新 origin。重验 target 修复仅比较 origin 时可能遗漏 userinfo 或 fragment 的边界。
- **备选方案**：移除 native 验证会丢失跨运行时防线；允许跨来源 redirect 会扩大凭据与字幕目的地；强制 direct 或禁止 HTTP 请求携带 Authorization 会改变用户选定路线或使带凭据服务不可用；为 redirect 阻断新增固定错误协议不是当前需求，且会扩大消息契约。

## 用户选择、凭据与披露

- **决策**：HTTP 与 HTTPS 使用相同的 Save、Test、Select 和翻译流程，不新增警告、确认、主机限制或自动改路由。Profile metadata 继续不保存凭据值；Global 只在构造已选择的 OpenAI-compatible Provider 时从 helper 读取凭据，Sidebar/Main 只获得 `credentialConfigured`。IINA `allowedDomains: ["127.0.0.1"]` 和 helper loopback 监听保持不变，因为它们限制 IINA 到本机 helper 的 RPC，而不是上游 Provider。
- **理由**：宪法 3.0.0 已明确用户自行填写、保存并选择 endpoint 不属于产品逻辑主动扩大网络目的地，因此不触发单独披露。明确 Select、精确 revision/fingerprint、最小字幕外发和日志隔离仍限制实际副作用。
- **备选方案**：安全提示或强制确认违背已澄清规格；扩大 IINA allowed domains 会绕过既有本机 helper 边界；Test 自动 Select、Credential ready 视为选择或 HTTP 禁用凭据都会改变既有语义。

## 删除后的权威收敛

- **决策**：`profile:deleted` 仍是即时清理的唯一权威事件。Global 成功持久删除后才发送；Main 先从逐窗口 `sidebarState.profiles` 过滤目标并清除匹配选择，再发起带单调请求身份的新列表同步，且只接受当前最新 `profiles:result`。Sidebar 收到成功事件后记录 WebView 生命周期墓碑、从当前集合移除条目、清理匹配的编辑、选择、Test 与 pending 状态，并立即重绘；后续快照先过滤墓碑，重复事件幂等。
- **理由**：Global 列表会异步读取凭据，删除前发起的结果可能在删除后迟到。Main 请求代次阻止旧结果成为新的窗口快照，Sidebar 墓碑阻止已经排队的旧 `state:update` 恢复条目；两层均不新增持久化。
- **备选方案**：确认点击时乐观删除违反权威成功边界；只等待刷新无法满足即时更新；只做 Main 代次无法隔离已排队到当前 WebView 的旧快照；持久墓碑会增加无必要的数据状态。

## 全局操作消息与区域请求竞态

- **决策**：Sidebar 以 classic script 全局工厂加载无 DOM 的生产状态协调器。`translation-toggle`、`language-settings`、`profile-editor`、`profile-row:<profileId>` 与 `subtitle-retry` 各自保留 latest request 和 action identity，用于拒绝未知、重复或迟到结果；可见反馈则收敛为全局唯一消息。任一区域写入 busy 或被接受的终态时，先清空当前其他区域消息，再在所属控件正下方显示新消息。消息不设置自动清除计时，并保持可见直至下一条被接受的消息替换。Profile 行重绘从区域请求状态恢复 busy，并只在该行拥有全局当前消息时恢复文案，不保存失效 DOM 引用。
- **理由**：区域请求身份仍能保证跨运行时结果只作用于所属最新操作；把可见消息改成全局互斥则避免多个 Profile 或功能区域同时残留互相矛盾的提示。持续显示让用户有足够时间读取结果，也避免计时器与迟到结果产生额外竞态，无需给 Main/Global 增加 UI region 字段。
- **备选方案**：保留每个区域的终态直到下一次同区域操作会产生多条残留消息；按固定时间自动清除可能让用户错过结果，并引入不必要的计时竞态；清除消息时同时取消请求或解除 busy 会混淆界面反馈与权威操作状态；共用一个固定 DOM 状态节点会失去就近显示位置。

## 删除成功反馈位置

- **决策**：取消或失败时在仍存在的 Profile 行操作区显示终态。成功时立即移除 Profile 内容与操作按钮，并在原列表位置显示只含成功终态的可访问结果槽；结果槽参与全局消息竞态，并在任意区域写入下一条被接受的消息时移除。结果槽不是 Profile，不参与选择、编辑、Test、列表同步或持久化。
- **理由**：该状态同时满足“条目立即消失”“最终反馈仍位于发起操作位置正下方”和“全局最多一条操作消息”。
- **备选方案**：随条目一起删除消息会缺少最终反馈；永久保留结果槽会重新产生残留消息；把消息移动到编辑器或公共区域会破坏归属；保留禁用的旧 Profile 条目不满足删除收敛。

## Profile 默认名称来源

- **决策**：新建表单维护 `system | user | saved` 三态。`system` 值取当前 Service type `<option>` 的可见文本并随类型切换；任意用户 input 后进入 `user`，即使清空或重新输入相同文本也不再自动覆盖；载入既有 Profile 时进入 `saved`；New profile 重置为 `system`。保存时继续沿用既有空白名称处理，不把 placeholder 当成输入。
- **理由**：显式来源能表达“一旦手动编辑即自定义”，不会因字符串恰好相同而错误恢复自动跟随，也保护既有 Profile 名称。
- **备选方案**：比较输入值与默认文本无法识别用户输入相同文本；只改 placeholder 不会产生可保存的默认值；类型切换始终覆盖会破坏自定义和既有名称。

## 文案与选择语义

- **决策**：更新导致选择失效时显示 `Profile updated. Select it again for translation.`；Test 成功显示 `Connection test passed. Select this profile for translation.`；生产用户文案移除 `to authorize translation`。Test 仍只更新连接状态，Credential 仍只表示本地保存状态，Select 仍绑定逐窗口精确 revision/fingerprint。
- **理由**：统一措辞只修正用户理解，不改变凭据、选择或字幕外发边界。
- **备选方案**：Test 自动 Select 或把 Credential ready 视为翻译选择都会改变产品契约。

## 0.1.0 交付身份

- **决策**：SubTandem 首版为 `0.1.0`，仓库固定为 `janwee-sha/SubTandem`，按确定性映射使用 `ghVersion: 1000`。manifest、npm 根版本、pack 安全路径、生产接口测试与 `docs/releases/v0.1.0.md` 保持一致；开发文档中的未来归档名使用版本占位写法。
- **理由**：`release-metadata.mjs` 以 `Info.json` 为版本源，校验 npm 两处根版本、pack 路径和更新身份，并读取当前版本发布正文；最终审计再验证归档名、包内身份、白名单和 native helper。精确更新可避免篡改历史或通用测试 fixture。
- **备选方案**：只改 manifest 会被生产元数据接口拒绝；仅验证 staging 不能证明最终包身份和内容；保留继承的旧版本叙述会制造不存在的 SubTandem 发布历史。

## 验证分层

- **决策**：共享 endpoint 解析器和 Sidebar 瞬时状态由 Vitest 直接执行；反馈测试覆盖全局消息替换、持续显示、同 request 多次写入与迟到结果隔离。Provider、Main/Global 消息、native redirect、凭据/日志隔离和版本接口使用现有契约、集成、安全及 Swift 测试。全部实现收敛后串行执行八项发布门禁，并用 `audit-release.mjs` 审计最终 `SubTandem-0.1.0.iinaplgz`。开发者一人在 IINA 1.4.4 中对最终包完成安装、HTTP/HTTPS、删除、反馈、多窗口、播放与卸载验收。
- **理由**：纯状态转换可确定性证明请求归属、全局消息竞态、持续显示及迟到结果安全，跨语言边界需要等价恶意 URL corpus，最终归档与宿主行为分别由生产审计和实机覆盖。当前 0.1.0 发布接口基线测试已通过，说明重规划建立在可用发布链上。
- **备选方案**：只断言文档或 UI 文案无法证明生产竞态；开发链接不能替代正式包；默认运行真实公网 Provider 测试会引入凭据、网络稳定性和成本依赖。

## 已解决风险

- TypeScript 手写 URL 解析与 Foundation `URL` 的接受集合可能不同：使用同一边界 corpus 分别验证两层，TypeScript 不得持久化 native 必然拒绝的 Profile，native 始终保留最终防线。
- URLSession 拒绝 redirect 时可能返回原始 3xx 而非固定安全错误：契约只要求不发送跨来源第二跳，不新增错误协议。
- system proxy 可观察用户选择的明文 HTTP 流量属于 HTTP 与所选路线的固有结果：不新增披露，也不得在消息、日志或验收证据中暗示 SubTandem 提供传输保护。
