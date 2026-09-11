# 第二版语言检测语料

用途与清单摘要由上层 `versions.json` 指定。原始字幕及冻结真值保持不变；`calibration-result.json` 为当前算法的开发评估，`failed-search` 不代表已选择或冻结生产参数。

`holdout-scp-ja-01.ass` 是唯一格式对照：取代同一 SRT 选段，不增加样本数。解析后正文逐字符一致，增加斜体控制码；时间按 ASS 的厘秒精度向下取整，最大差异 9 ms。来源许可记录的正文、时间保留说明适用于 SRT 选段，此处明确 ASS 转换的精度差异。原始毫秒时间仍保留在 `raw/scp-096-ja.srt`。

校准中的 Sintel 保加利亚语使用 Windows-1251，Valkaama 英德字幕使用 Windows-1252，其余新增原始字幕为 UTF-8；原始字节由本目录上层 `.gitattributes` 保留，不能进行自动换行转换。

原字幕和冻结选段包含原有行尾空格及 CRLF；字幕文件关闭 Git 空白错误诊断以保留这些字节，其余文件继续检查。
