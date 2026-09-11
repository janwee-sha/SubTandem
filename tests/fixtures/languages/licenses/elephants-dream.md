# Elephants Dream 字幕来源与许可

**状态**：两个原始短轨已完成来源、许可与正文审查，纳入冻结验收集；检测结果另行验收。

- 原始文件：[IETF CELLAR test5.mkv](https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/e6965e5ca666322ed93e2748a10a4f132309e005/test_files/test5.mkv)。
- 媒体 SHA-256：`92acdc33bb0b5d7a4d9b0d6ca792230a78c786a30179dc9999cee41c28642842`。
- 作品及同源组：`elephants-dream`；本作品的所有语言、片段和重发布版本必须归入同一校准或验收分组。
- 许可证据：[测试套件说明](https://github.com/ietf-wg-cellar/matroska-test-files/blob/e6965e5ca666322ed93e2748a10a4f132309e005/readme.md)第 5 项说明字幕及作品来源，许可章节注明 CC BY 和署名；[作品官方许可说明](https://orange.blender.org/blog/creative-commons-license-2/)链接 [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/)。核查日期为 2026-09-10。
- 按来源要求保留署名：`(c) copyright 2006, Blender Foundation / Netherlands Media Art Institute / www.elephantsdream.org`。[作品官方贡献者名单](https://orange.blender.org/theteam/)列出英语字幕作者 Tino Meinen、德语字幕译者 Roy Schulz。
- 提取方式：使用 SubTandem 修订 `d4200497e1c1624b4bfdbe16c06701b667cfdcc8` 的生产提取器读取完整字幕轨，输出 UTF-8 SRT；保留该提取结果的正文和时间，未平移、扩写或循环正文。德语轨原有的 `|` 字符也予以保留。

| 文件                                                       | `ffIndex`（从 0 起） | 原轨 cue 范围 | 字母数 | SRT SHA-256                                                        |
| ---------------------------------------------------------- | -------------------- | ------------- | ------ | ------------------------------------------------------------------ |
| [regression-short-5.srt](../tracks/regression-short-5.srt) | 2                    | 1–5           | 90     | `75246eb540b3a56a9272141d19cec97dce970239ea9f4b9016f02b0b4f16c8ae` |
| [regression-short-6.srt](../tracks/regression-short-6.srt) | 4                    | 1–6           | 130    | `0f59c5483c789d3df572ef50093d9cbe7d570edcdee97527ae38ac3b9300e79f` |

正文审查：第一轨为英语对白，第二轨为德语对白；语法、代词及句式支持对应语言，不依靠容器标签或检测结果判断。两轨虽含专名及短句，整体分别保留 90 和 130 个字母的自然句子，预标为对应语言的正样本。来源目录将其映射回完整作品字幕的保守范围，避免重发布选段重复计数。
