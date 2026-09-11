# Blender 开放字幕许可

本记录覆盖清单中 `tos-*` 和 `sintel-*` 来源。每轨的官方下载地址、原始文件 SHA-256、解码方式和署名保存在语料来源清单中。核查日期：2026-09-10。

| 作品           | 许可及适用依据                                                                                                                                                                                                                                                                   | 保留署名                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Tears of Steel | [官方许可页](https://mango.blender.org/sharing/)将网站及 DVD 发布内容置于 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，明确例外主要是标志、商标和非项目作品；字幕来自[官方字幕目录](https://download.blender.org/demo/movies/ToS/subtitles/)，不是第三方影片聚合库 | `(CC) Blender Foundation \| mango.blender.org`         |
| Sintel         | [官方许可页](https://durian.blender.org/sharing/)将发布的数据及网站/DVD 内容置于 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)；字幕来自[下载页](https://durian.blender.org/download/)和[官方字幕目录](https://download.blender.org/durian/subs/)                    | `© copyright Blender Foundation \| durian.blender.org` |

有明确字幕署名时另予保留：Sintel 捷克语为 Michal Breškovec，希伯来语为 Yaron Shahrabani（原文件内署名）。其余文件未列出个人译者时采用项目指定署名，不推定个人作者。

处理仅包含按记录解码为 UTF-8、修复明确的 SRT 分隔符错误、选取不重叠 cue 并重新编号。空 cue 不产生正文；不翻译、扩写或循环对白。ASS 用例为所选日语正文增加样式控制码，生产 parser 解析后的正文须与选段一致，格式转换不增加独立样本数。各文件的具体处理记录与原始摘要一起保留。

全部语料只用于测试，不随插件包分发；如另行分发字幕或衍生选段，必须保留本记录、来源、署名和相应许可。
