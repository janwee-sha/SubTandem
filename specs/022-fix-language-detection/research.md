# 技术研究：字幕语言检测修复与不中断翻译

**日期**：2026-09-10 | **规格**：[spec.md](spec.md) | **状态**：阶段 0 完成

## 1. 标准 franc 与采样边界

**决定**：锁定 `franc@6.2.0`，移除 `franc-min`；分类保留完整模型竞争集合，最终只接受可靠且可明确映射的结果。

**理由**：[6.2.0 包元数据](https://github.com/wooorm/franc/blob/6.2.0/packages/franc/package.json)指定 ESM 与 MIT。[检测源码](https://github.com/wooorm/franc/blob/6.2.0/packages/franc/index.js)将输入截为前 2048 个 UTF-16 码元，返回相对距离排名。实际 npm 包含 186 个模型条目、178 个不同输出代码，不能把多脚本条目数当独立语言数；当前四窗口拼接可能丢失后半段证据。

**备选**：仅降低 `MIN_CUES` 无法解决窗口波动及罗马字误判；旧 `detectorCode` 白名单会遗漏新增覆盖并强迫未支持语言落入已有候选。轨道标签兜底、`franc-all`、额外远程检测均不采用。

## 2. 固定源语言映射

**决定**：独立 `source-languages.ts` 固定下列 119 个模型代码 → 113 个产品源语言身份；依据 [固定包](https://registry.npmjs.org/franc/-/franc-6.2.0.tgz)、[ISO 语言表](https://www.loc.gov/standards/iso639-2/php/English_list.php)和 [IANA 语言注册表](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry)。

```text
afr→af als→sq amh→am arb→ar ayr→ay azj→az bel→be ben→bn
bho→bho bod→bo bos→bs bul→bg cat→ca ceb→ceb ces→cs ckb→ku
cmn→zh dan→da deu→de ekk→et ell→el eng→en epo→eo ewe→ee
fin→fi fra→fr gaa→gaa glg→gl guj→gu hat→ht hau→ha heb→he
hin→hi hms→hmn hnj→hmn hrv→hr hun→hu hye→hy ibo→ig ind→id
ita→it jav→jv jpn→ja kan→kn kat→ka kaz→kk khk→mn khm→km
kin→rw kir→ky kor→ko lao→lo lin→ln lit→lt lua→lua lug→lg
lvs→lv mal→ml mar→mr min→ms mkd→mk mya→my nld→nl nno→no
nob→no npi→ne nso→nso nya→ny pam→pam pan→pa pbu→ps pes→fa
plt→mg pol→pl por→pt prs→fa qug→qu quy→qu quz→qu ron→ro
run→rn rus→ru sag→sg sin→si slk→sk slv→sl sna→sn som→so
sot→st spa→es srp→sr ssw→ss sun→su swe→sv swh→sw tam→ta
tat→tt tel→te tgk→tg tgl→fil tha→th tir→ti tsn→tn tso→ts
tuk→tk tur→tr uig→ug ukr→uk urd→ur uzn→uz ven→ve vie→vi
war→war wol→wo xho→xh ydd→yi yor→yo zlm→ms zul→zu
```

**映射规则**：`cmn→zh`、`por→pt` 不推断中文书写系统或葡萄牙地区；`nob/nno→no` 及 `hms/hnj→hmn`、`min/zlm→ms`、`pes/prs→fa`、`qug/quy/quz→qu` 等采用明确宏语言归一化。同一宏语言成员可汇总支持证据，不据此确认地区变体。`tgl→fil` 沿用产品别名策略，不声称 ISO 等价。`sco` 不映射 `en`，`toi` 不映射 `to`；其余未列出的模型代码不产生可靠产品源语言。

**理由**：源语言识别与目标可选项职责不同；Armenian、Georgian、Khmer、Lao、Tibetan 已有模型，应移除旧硬编码拒绝。模型覆盖仅表示可提出候选，仍须通过可靠性规则；不保证任意输入都能识别。

## 3. 可靠性与执行预算

**决定**：短轨尽量使用全部有效正文，长轨覆盖时间轴采样；检测副本去重，同一正文最多贡献一次证据，不改变翻译条目。每次 franc 输入 ≤2048 码元且不切断代理对。完整样本用有界片段聚合，辅助片段仅在正文足够时提供证据，不要求固定 cue 数或匹配窗口数。

以有效文字量、去重后证据、候选分差、文字系统分布和可用片段冲突共同判断；单一脚本候选也不自动可靠。按文字系统及正文量分层，在独立校准集上固定规则和阈值，再评估冻结集。禁止根据样本 ID、文件名、轨道标签或指定短语添加特判。

**理由**：整体正文优先于局部短句投票，同时保留罗马字、混合正文和专名的未知出口。50 次幂不能把相对分数校准为正确率。

**执行约束**：Coordinator 执行实际有界采样/分类片段，在片段间让出事件循环；开始、片段前后及提交均检查 deadline 和身份。定时器无法抢占同步 franc，500 ms 兜底与小同步工作量必须同时验证。到期/异常只提交一次未知结果；失效后停止后续片段。当前“先空让出四次、再完整同步检测”的实现不足以证明预算。

**研究测量**：独立 Node 进程、20 次预热后 120 次调用，在 [计划环境](plan.md#技术上下文)中，200/1000 字符英文热态 p99 分别约 0.51/0.77 ms，随机拉丁高 trigram 输入约 5.45 ms，模块加载约 8.7–10.5 ms。大于 2048 的输入实际被截断；这些只是选型证据，不是 IINA 或 SC-005 验收。

**备选**：固定四分窗强制一致性会再次拒绝短轨；新增 worker/WebView 或 native 检测服务增加运行时和正文通路，当前不采用。

## 4. 未确定源语言与服务共同语义

**决定**：使用 `sourceLanguage: string | null`；可靠时传明确映射的源语言 ID，其余检测终态传 `null`。目标仍是有效产品目标 ID，完整保留变体。不把 `und`、`auto` 或错误标签当作正常产品语言 ID。

Main 只在检测进行中短暂等待，终态进入既有启用/配置/字幕条件检查和翻译流程。删除 `languageUnrecognized`、`languageUnsupported`、`noTranslationNeeded` 和 `shouldTranslate` 发送门禁。`source.detectedLanguage` 仍可为 `null`，未知信息不阻断准备、运行或服务失败状态。

**理由**：controller 的三类阻断之外，任务 builder 对未知 source 还会抛出 `INVALID_LANGUAGE_ID`，仅替换依赖无法恢复翻译。

**服务衔接**：OpenAI 三种能力模式和 Ollama schema/prompt 模式共用任务语义；DeepSeek 保留 JSON object 与严格 ID 校验；Claude 保留 Messages 结构与严格 ID 校验。各模式均逐条判断正文是否符合精确目标，符合则原样输出，否则翻译。禁止附加原文副本和复制上下文，移除与同语言正文冲突的绝对“不得输出 source text”要求。

**备选**：本地复制会跳过用户要求的服务调用；额外语言识别请求和逐 cue 语义审计均超出规格。

## 5. 逐字符结果与生命周期

**决定**：保留 `validation.ts`、controller 和 session cache 的判空检查，但传递和存储原字符串。Overlay 适配器传递完整 cue 正文，不拆分后删除空行。准备完成后的 `target.text` 为原样比较基准，条目身份及时间轴不变。

**理由**：三层 `trim()` 会改写合法结果；`WebViewTranslationOverlay.show()` 还删除内部空行。现有 Overlay 文本节点及 `pre-wrap` 能用于正确显示，无需更改布局或新增交互。

**生命周期决定**：attempt 绑定播放器、媒体、轨道、正文及有效配置所属会话。换轨、换片、正文变化、已生效目标/Profile revision 变化、禁用或关闭使旧 attempt 失效；普通 seek 不改变正文判断。超时或失败终态不得被晚到可靠结果覆盖，也不得重复启动同一次失败。Main 身份与 Global 的 IINA 发送方 ID 仍分别校验。

## 6. 验证与发布

**决定**：生产函数及实际四类 provider 适配器验证未知源语言、同语言和原字符串传递；受控 transport 验证分支、错误、身份及重试。真实服务固定语料验收独立记录，mock 回声不能证明服务遵从性。现有 live 的 `sourceEcho` 失败断言只适用于标注为需要翻译的条目。

**测量方法**：冷检测使用独立实例，热检测预热后重复，单独统计每个同步片段；覆盖最大样本、长轨预处理和不同脚本。Node 数字不能替代正式包 IINA 1.4.4/1.4.0 宿主验收及至少 30 分钟连续播放。

**交付**：每次代码变更后重新测试、编译、正式打包，保留 helper 架构、签名、权限和包内文件审计。README 及多语言说明移除手动源语言和“源目标必须不同”的提示，明确本地检测失败或同语言仍向当前已选服务发送必要正文。

## 7. 语料采集与冻结

**已知事实**：现有 `tests/fixtures/languages/{calibration,acceptance}.json` 是模板循环，指标测试每语言只有一次检测。指定罗马字日语等诊断样本未提供可提交的正文、许可及正文真值；cue 数和容器标签不足以重建回归样本。

**候选来源**：[Tears of Steel](https://mango.blender.org/about/) 标明 CC BY 3.0，[下载页](https://mango.blender.org/download/)提供字幕入口；[Elephants Dream 许可](https://orange.blender.org/blog/creative-commons-license-2/)允许再分发网站/DVD 内容；[Sintel 官方网站](https://durian.blender.org/)记载 40 种字幕。尚未核实各字幕的具体正文、选段容量、贡献者授权和真值，不能把目录覆盖当作 400 轨已经可用。

采集目标语言为 `en de hu it ru sv he fi es fr pt nl da cs pl el id ja zh fa`，仍须用实际清单证明数量与分层。[TED 使用规则](https://www.ted.com/about/our-organization/our-policies-terms/ted-talks-usage-policy)对转录、字幕及截取另有约束，不能只凭聚合库许可标签默认将独立正文收入仓库。

**决定**：按规格澄清，将逐条采集、许可/真值核验和清单冻结作为实施首个前置任务，完成后才能校准及验收。≥20 种语言、每种 ≥20 个独立自然字幕轨道及指定回归等全部数量、分层和质量门保留；公开替代语料不能自动替代 SC-002 的指定负样本。

**冻结原则**：每条记录包含来源、作者/字幕贡献者、许可、作品/同源分组、正文哈希、片段边界、语言真值及依据、cue 数、文字量和现象标签。按原作品及其翻译/重发布版本隔离校准和验收；可取不重叠片段，但重复或仅格式变化的正文不能再次计数。真值先于检测结果标注，统计单位是独立轨道。

**理由**：样本取得及逐条核验是明确的可执行工作；规划固定其来源池、记录结构、隔离方法及门禁，实施用已纳入版本控制的正文和许可证明完成。缺少许可、真值或指定样本时，该前置任务保持未验收，不能用合成模板、私人路径或降低指标补足。

**备选**：计划阶段直接收集完整语料不作为当前交付顺序；目录条数或合成正文不构成自然字幕验收证据。
