# 研究结论：字幕正文语言检测

## 1. 离线模型与源语言范围

- **决策**：用完整 `franc-all@7.2.0` 替换 `franc-min`；新增独立的 67 种源语言映射，`cmn` 映射 `zh`，中文形式在选中中文后判定。完整模型的其他语言只提供范围外证据；须包含已核对范围外语料中的 `ina`，不能由缺失模型的受支持语言误判冒充范围外判断。
- **理由**：本地依赖实现有默认 10 字符门槛和 2,048 UTF-16 单元截断，归一化第一名不能表示概率或文字占比。受支持分类显式设置 `minLength: 0`，每次输入控制在模型截断范围内。完整模型能提供 `fin/nob/nno/heb` 等候选；实施时核对锁定数据中的全部源映射。
- **备选**：保留最小模型并只判断特殊文字，无法充分覆盖芬兰语、挪威语；直接使用完整模型的任意第一名会扩大源范围；native/在线识别增加运行时或隐私边界，均不采用。
- **查询实现**：按固定模型三元组建立倒排索引，等价累计距离并保持原归一化、候选及并列顺序；校准文本和 Unicode 边界逐项与 `francAll` 对照。索引仅保存静态模型，同正文查询只在当前 attempt 内复用。
- **依据**：[7.2.0 包元数据](https://registry.npmjs.org/franc-all/7.2.0)、[分类实现](https://github.com/wooorm/franc/tree/main/packages/franc-all)、[模型说明](https://github.com/wooorm/franc/tree/main/packages/franc-all)。模型与既有依赖使用 MIT 声明；打包时更新实际组件名称和许可。

## 2. 候选接受与范围外确认

- **决策**：受支持正文候选无需置信门槛；`reliable` 表示可进入翻译资格判断的候选。范围外确认单独作用于片段归属，证据不足则使用受支持最佳候选；范围外占优不能拒绝其他片段已有的范围内候选，仅在没有范围内候选且正文可确认仅属范围外时返回 `unsupported`。
- **理由**：当前 `src/subtitles/language-detection.ts` 的 12 cue、200 字母、50 次幂分差与窗口一致性会同时造成短轨漏检和错误语言被接受。当前规格接受候选误判，不能继续把低置信度当成拒绝理由。
- **备选**：只降低 cue 下限不能修复窗口漏检；按标签兜底违背正文边界；关闭豪萨语会缩减已承诺覆盖。
- **校准责任**：范围外证据阈值只决定是否足以确认范围外，不决定是否接受已有受支持候选；参数选择及冻结规则见 [检测契约](contracts/language-detection.md)。

## 3. 混合语言与内容采样

- **决策**：从规范正文建立位置索引，按内容形成片段，保留重复出现次数；每段归属语言后累计有效文字量，主语言仅在范围内候选中取最大值，范围内平票按语言 ID 的固定序确定。范围外文字保留在占比分母中，不转计给范围内候选。小轨全量，长轨按正文位置有界采样并保留代表区间权重。
- **理由**：cue 四等分、重复内容删除、显示时长及模型分数均不能表示语言文字量。模型内部的前缀截断也使一次整轨分类偏向开头。局部与整段证据用于选择片段语言，不能把整轨第一名直接当混合主语言。
- **备选**：逐 cue 投票受分段影响；单次整轨分类不能证明 40/35/25；无界逐字分类难以满足宿主预算。
- **限制**：预测文字量不等于人工真值；抽样不能数学保证任意正文的真实占比。词内拆分、跨 cue 换行、共享文字和超上限混合正文必须接受成对回归，不以“采样预期误差”为理由免除规格验收。

## 4. 真实分片与集成

- **决策**：检测器提供有界步骤，同步评估与异步协调器消费同一生产核心。正文扫描、分类和聚合均受步骤预算约束；每步前后检查 attempt 与 500 ms 期限。
- **理由**：当前 `src/app/language-detection.ts` 在同步检测前空让出四次，不能限制真正的检测阻塞。`src/main.ts` 已将外挂/内嵌正文汇入同一协调器；`src/app/controller.ts` 已按状态与 `shouldTranslate()` 门控，可保持消息和 UI 状态形状。
- **备选**：仅使用计时器与同步大任务竞速无法中止阻塞；新增 worker/helper 扩大运行时责任，当前不采用。
- **验证**：当前性能测试将同进程前 20 次调用视为首次，需改为真实新进程/新窗口与热调用分开测量；Node 指标不能替代 IINA 实机性能。

## 5. 自然语料来源与许可

采用逐件准入，不以“可以下载”作为再分发依据。下列是已找到的来源候选，具体字幕、署名、修订和许可记录仍须在实施时核验。

| 来源 | 已找到的依据 | 使用边界 |
| --- | --- | --- |
| Sintel | [官方许可](https://durian.blender.org/sharing/)、[字幕下载](https://durian.blender.org/download/) | 官方发布数据为 CC BY 3.0；所有语言、片段、镜像及变体归同一作品组；社区翻译另核验 |
| Elephants Dream | [官方许可](https://orange.blender.org/blog/creative-commons-license-2/)、[发布说明](https://orange.blender.org/press/) | 官方电影与制作数据为 CC BY 2.5；具体字幕仍核验；不套用到另有许可的独立 soundtrack |
| Wikitongues 豪萨语/英语 | [Sadam 具体页面](https://wikitongues.org/videos/sadam_20241210_hau-eng/) | 页面列 CC BY-SA 4.0；尚未确认现成字幕，不能把视频语言标签作为字幕真值 |
| Commons 罗马字歌词 | [Sakura 字幕](https://commons.wikimedia.org/wiki/TimedText:Sakura_Sakura.song.ogg.fr.srt)、[Kimigayo 字幕](https://commons.wikimedia.org/wiki/TimedText:Kimigayo_vocal_1930.ogg.zh-hant.srt)、[文本许可规则](https://commons.wikimedia.org/wiki/Commons:Licensing#Text_(structured_data,_descriptions,_etc.)) | 两个独立作品可分置两集合；核验具体修订、作者及文本权利；提取罗马字行和转 ASS 登记为派生 |

**备选**：TED/OPUS 不作为默认准入来源；[TED 官方政策](https://www.ted.com/about/our-organization/our-policies-terms/ted-talks-usage-policy)对片段、改编和字幕独立使用设有限制。FFmpeg 样本目录的可访问性同样不能证明字幕许可。

自然语料需要覆盖至少 20 种语言及三个各至少 20 个独立片段的正样本长度组。来源按作品及译本谱系分组，调参前完成许可、人工真值、集合与正样本归属冻结；全部要求见 [语料契约](contracts/corpus-evaluation.md)。指定私有样本仅按[缺陷评估](../../.specify/bugs/subtitle-language-detection/assessment.md)中的内容分布寻找合法替代，不成为仓库依赖。

## 研究结论的适用范围

技术路线和接口决策已明确，无待用户澄清项。自然语料收集、模型锁定数据核验、数值校准及宿主性能是后续可执行工作；本研究不宣称已经获得全部语料或达到 SC-001–SC-006。校准失败须调整本规格设计并重新验证，不能用冻结验收集反向调参或添加候选拒绝门槛。
