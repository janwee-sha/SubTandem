# 研究结论：字幕语言自动识别与目标语言偏好

## 离线识别依赖与运行位置

**决策**：使用精确版本 `franc-min@6.2.0`，在逐窗口 Main 内对已解析的 `SubtitleCue[]` 执行离线识别。外挂与内嵌字幕共用同一入口；识别发生在得到 `contentHash` 后、任何 Provider 请求前。轨道语言元数据只保留为非权威展示信息，不覆盖正文结果。

**理由**：该依赖是纯 ESM/JavaScript，可由当前 ES2020/Parcel 配置静态打入 `dist/main.js`，无需 Node addon、WASM、Worker、额外模型文件、权限或网络。82 个常用语种足以覆盖 SC-001 的至少 20 种文字或语系；不能安全覆盖的输入按未知或不受支持失败关闭。

**考虑过的替代方案**：完整 `franc` 增加 profile 和包体，也提高相近语种误候选面；CLD3/WASM 与 native addon 扩大宿主、架构和打包风险；自建模型引入训练数据、许可和校准负担；调用 Provider 判别语言违反 FR-012。若冻结语料证明 `franc-min` 无法达标，只能在相同 adapter 契约下重新评估完整 `franc`，不得放宽安全门禁。

## 有界采样与可靠性门禁

**决策**：从 `normalizedText` 删除空白、仅符号、仅数字、明显 URL 和精确重复行，按时间轴四等分确定性取样；每层最多 16 条不同 cue，总计最多 64 条和 4,000 个 Unicode 文字。少于 12 条有效 cue 或 200 个文字直接判为未知。四个窗口和总样本分别分类；只有总样本第一名与至少 3/4 窗口第一名一致、加权支持率不低于 80%，且第一与第二候选分差不低于 0.12 时才接受可靠结果。

共享文字不直接映射为单一语言。中文只有在正文包含足够简繁区分证据时输出 `zh-Hans` 或 `zh-Hant`；否则输出裸 `zh`，且不与任一显式书写系统目标视为等价。明显属于分类器不覆盖的文字系统且文字量充足时为“不受支持”；样本不足、混合或低置信时为“无法识别”。阈值由隔离的校准集固定，不在运行时自适应。

**理由**：分层采样避免片头、专名、重复对白或单一时间段支配结果；固定上限使 20,000 cue/16 MiB 的源仍保持常量工作量。多窗口一致性和候选差值比把分类器相对分数当概率更安全，能对双语与相近语言失败关闭。

**考虑过的替代方案**：全量拼接让耗时随文件增长；只取开头容易受片头影响；逐 cue 识别不符合整条字幕源主要语言语义；单次 top-1 无法满足误可靠率门禁；单靠 Unicode script 无法区分共用文字的语言。

## 调度、生命周期与性能

**决策**：识别协调器使用逐窗口 attempt，绑定 `playerId + mediaEpoch + track identity + contentHash + attemptId`。四个样本窗口分片执行并在分片间让出事件循环，每次继续和最终提交前均核验 attempt。500 ms 未完成、异常、换轨、换片、正文 hash 变化、禁用或关窗均使结果失效；seek 不改变字幕源，不重跑识别。

性能门禁为最大样本首次 p95 ≤100 ms、热识别 p95 ≤50 ms、单个同步分片 p99 ≤16 ms。识别状态不会暂停视频或原字幕；只缓存当前源的最终结果，不保留样本文本或候选明细。

**理由**：该模式与现有字幕准备的 attempt/迟到拒绝一致，能覆盖无法真正取消的同步分类工作，同时避免把字幕正文送入 Global、helper 或新线程边界。

**考虑过的替代方案**：同步处理整源可能阻塞 JavaScriptCore；Global 或 helper 会扩大正文流转；只依赖取消无法防止迟到提交；每次 seek 重跑没有正确性收益。

## 目标语言目录与稳定身份

**决策**：建立单一只读目录项 `{id, displayName, providerLabel}`，顺序与规格附录 A 完全一致。`id` 使用规范 BCP 47，是 preferences、消息、缓存和 Provider 请求的唯一身份；英文名称仅用于 Sidebar 与 Provider prompt。`Kri` 固定为 `Krio / kri`，`加族语` 固定为 `Ga / gaa`；现代身份使用 `fil`、`he`、`id`、`yi`。

**理由**：稳定 ID 不受界面文案和 Provider 变化影响，且当前语言规范化器可接受 2–3 字母主标签及 script/region。目录成员校验能阻止任意字符串进入偏好和 prompt。

**考虑过的替代方案**：保存英文名称会随文案漂移；Provider 专属 code 违反全局偏好；自增数字仍需二次映射；旧别名会形成第二身份。

## 语言等价与 Provider 表达

**决策**：通用目标按基础语言等价，例如 `en-US → en`、`pt-PT → pt` 跳过翻译；显式 script/region 目标要求精确等价，例如 `zh-Hans` 与 `zh-Hant` 互相翻译，`pt-BR → pt-PT` 需要翻译。`zh-CN/zh-SG` 归一为 `zh-Hans`，`zh-TW/zh-HK/zh-MO` 归一为 `zh-Hant`。Provider 请求继续携带稳定 ID，OpenAI-compatible 与 Ollama adapter 从目录派生 `English Name [id]` 的固定 prompt 表达。

**理由**：当前仅按 base language 比较会错误合并中文书写系统与葡萄牙地区变体；将策略放在目录元数据中可避免调用方漏传布尔开关。Provider 是自由文本 LLM 接口，英文名称加 ID 比稀有三字母 code 单独出现更明确。

**考虑过的替代方案**：所有语言精确比较会把 `en-US → en` 等无须翻译的场景外发；永远按基础语言比较违反 FR-009；把请求字段改成对象会扩大现有跨运行时契约。

## 偏好所有权与保存提交点

**决策**：Global 是 `targetLanguage` 的唯一持久化写入者；Main 持有各窗口当前已提交语言，Sidebar 持有 committed 值和单一 pending 候选。选择器在首次权威水合后，对不同于 committed 的选择立即建立请求，并在 pending 期间禁用。Sidebar→Main→Global 的 `defaults:save` envelope 仅允许 `{targetLanguage}`。Global 校验目录成员，保存前记录旧值，执行 `set + sync`；抛错时回滚旧值并返回带原 `requestId` 的固定错误。只有 `defaults:saved` 回执能使发起窗口调用 `setTargetLanguage`、更新 Sidebar authoritative state 并报告成功。

初始化时 Main 同步读取并校验偏好后创建 Controller；有效值原样恢复，缺失或非法值只在内存回退 `zh-Hans`。首次 `state:update` 携带提交值和 revision；pending 期间的周期 poll 不覆盖候选值。保存失败保持原会话与偏好不变，Sidebar 恢复 committed 值；Global 按 JavaScript 事件循环提交顺序串行处理多窗口保存，只向发起窗口立即应用会话切换。

**理由**：当前 Main 在 Global 确认前已经双写、切换 Controller 并报告成功，而 Main 未监听 `defaults:saved`。单写者和明确 commit point 才能满足保存失败回退、重启恢复和最近一次成功保存语义。

**考虑过的替代方案**：Main/Global 双写无法定义原子成功；Sidebar 写 preferences 破坏运行时边界；乐观切换再回滚会产生两次取消与短暂错误方向；每次 poll 强制 hydrate 会覆盖 pending 候选；保留显式保存控件会留下被替代的提交路径。

## 会话失效与旧状态移除

**决策**：Controller 将 `setLanguages(target, source)` 收窄为 `setTargetLanguage(target)`。成功提交新目标后复用 `PlaybackSession` 代次：取消 Provider 与退避计时、递增 session epoch、清 translations、terminal failures、provider error、会话缓存和 overlay，但保留当前字幕源并从新目标重新门控。旧 progress/result 继续由 player/session/window/profile 指纹拒绝。

彻底移除 `sourceLanguage`、`sourceLanguageMode`、手动输入、manual origin、确认动作和相关消息字段。Global 在有界迁移中用 property-list 安全的空字符串墓碑覆盖旧键，避免 JavaScript `null` 使 IINA 整份 preferences 无法写盘；Main 永远不读取它们。状态明确区分 detecting、unrecognized、unsupported 和 no-translation-needed，只向 UI 公开固定文案和安全语言 ID。

**理由**：缓存键虽已包含目标语言，但只换 key 不会取消请求、释放旧缓存或清除已显示译文；旧源语言路径仍会覆盖正文结果。完整切换和清除才能满足 FR-004/008/010/011。

**考虑过的替代方案**：仅依赖缓存键会保留旧工作与内存；重建整个 Controller 会扰动 Profile 和多窗口租约；隐藏 UI 但继续读旧偏好仍会影响升级用户。

## 构建、许可与验证

**决策**：依赖使用精确版本并提交 lock；`THIRD_PARTY_NOTICES.txt` 记录 `franc-min` 及其传递依赖。只允许模型静态进入 `dist/main.js`，不新增动态 chunk、模型资产、WASM、`.node` 或权限。记录变更前后 bundle 与 `.iinaplgz` 大小；`dist/main.js` 增量超过 1 MiB 或包增量超过 500 KiB 时停止并重新评估。

冻结的非私密语料分开用于校准和验收，覆盖至少 20 种文字或语系、错误元数据、简繁中文、相关语言、符号/专名、重复行和混合语言。自动化证明准确率、误可靠率、Provider 零调用、保存原子性、迟到拒绝、偏好隐私和目录一致性；正式包人工验收恢复、完整重启、多窗口和 IINA 宿主行为。

**理由**：当前正式包静态 bundling 与禁止路径审计可直接约束依赖交付；分离校准和验收语料可防止阈值过拟合。IINA 重启和宿主 UI 行为不能只由 Vitest 证明。

**考虑过的替代方案**：运行时携带 `node_modules` 或远程模型违反包与网络边界；只测库自带长段落会高估字幕准确率；只做人工测试无法稳定覆盖竞态与隐私。
