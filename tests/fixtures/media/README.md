# 内嵌字幕验收样本

清单只使用不透明 ID。全部内容由仓库短句合成或由开发者自制，不含受版权限制媒体；自动化小样本可由 `source/` 中的文本重建，大型与宿主样本不提交 Git。实机证据只记录 ID、类别、cue 数、耗时、状态与结论。

| ID   | 类别             | 变体           | 用途             |
| ---- | ---------------- | -------------- | ---------------- |
| S001 | Matroska SubRip  | 单轨           | 基础提取         |
| S002 | Matroska SubRip  | 多语言         | 精确选轨         |
| S003 | Matroska SubRip  | 同元数据双轨   | stream identity  |
| S004 | Matroska SubRip  | 空轨           | 安全失败         |
| S005 | Matroska SubRip  | 4 小时         | 时长上界         |
| S006 | Matroska SubRip  | 20 GB 稀疏媒体 | 媒体上界         |
| A001 | Matroska ASS/SSA | ASS 样式       | 文本规范化       |
| A002 | Matroska ASS/SSA | SSA 样式       | 文本规范化       |
| A003 | Matroska ASS/SSA | 多行对白       | 顺序与换行       |
| A004 | Matroska ASS/SSA | 附件           | 忽略附件         |
| A005 | Matroska ASS/SSA | 同 codec 双轨  | 精确选轨         |
| A006 | Matroska ASS/SSA | 多语言         | 语言决策         |
| A007 | Matroska ASS/SSA | 20,000 cue     | cue 上界         |
| A008 | Matroska ASS/SSA | 超限 cue       | 安全失败         |
| M001 | MOV/MP4 mov_text | MOV 单轨       | 基础提取         |
| M002 | MOV/MP4 mov_text | MP4 单轨       | 基础提取         |
| M003 | MOV/MP4 mov_text | M4V 单轨       | 容器别名         |
| M004 | MOV/MP4 mov_text | 多语言         | 精确选轨         |
| M005 | MOV/MP4 mov_text | 同元数据双轨   | stream identity  |
| M006 | MOV/MP4 mov_text | 时间重叠       | 稳定排序         |
| G001 | 图形/未知        | PGS            | 不支持状态       |
| G002 | 图形/未知        | VobSub         | 不支持状态       |
| G003 | 图形/未知        | DVB/未知       | 不支持状态       |
| F001 | 损坏/非法/超时   | 损坏容器       | 固定安全错误     |
| F002 | 损坏/非法/超时   | 身份不匹配     | 失败关闭         |
| F003 | 损坏/非法/超时   | 15 秒超时      | Retry 与迟到清理 |
| X001 | 外挂回归         | UTF-8 SRT      | 既有路径         |
| X002 | 外挂回归         | UTF-16 SRT     | 编码回归         |
| X003 | 外挂回归         | ASS            | parser 回归      |
| X004 | 外挂回归         | 内嵌↔外挂      | 无额外步骤       |

仓库内 `generated/` 只保存覆盖 SubRip、ASS、SSA 与 `mov_text` 的最小合成媒体；它们由 `source/` 中的短文本生成，且不依赖真实影片。其余 ID 用于正式包实机矩阵，未实际执行前不得标记通过。
