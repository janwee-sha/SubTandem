# 指定本地回归契约

七个 FFmpeg 指定回归只作为用户显式提供的本地验收输入。正文不入库、不随包发布、不参与校准或 SC-001 的三个分母，也不以其正文或再分发许可入库作为 T001 前置条件；SC-002 的原始缺陷及标签不变性断言仍须全部通过。

## 身份与加载

`tests/fixtures/languages/local-regressions.json` 只保存回归 ID、公开来源 URL、媒体 SHA-256、`ffIndex`、codec、完整原轨 cue 范围、提取 SRT SHA-256、语言预期及计数。不得保存正文、私有路径或凭据。固定身份见[验证记录](../verification.md#指定回归材料定位)。

| 回归 ID                | 来源媒体                                      | `ffIndex`（从 0 起） | cue 数 | 预期                                |
| ---------------------- | --------------------------------------------- | -------------------- | ------ | ----------------------------------- |
| `regression-en-38`     | `honey.mkv`                                   | 2                    | 38     | `reliable/en`                       |
| `regression-de-11`     | `1Video_2Audio_2SUBs_timed_text_streams_.mp4` | 3                    | 11     | `reliable/de`                       |
| `regression-hu-19`     | `SSA_15subtitles.mkv`                         | 9                    | 19     | `reliable/hu`                       |
| `regression-it-19`     | `SSA_15subtitles.mkv`                         | 10                   | 19     | `reliable/it`                       |
| `regression-ru-19`     | `SSA_15subtitles.mkv`                         | 15                   | 19     | `reliable/ru`                       |
| `regression-sv-19`     | `SSA_15subtitles.mkv`                         | 17                   | 19     | `reliable/sv`                       |
| `regression-romaji-29` | `SSA_15subtitles.mkv`                         | 11                   | 29     | `unknown`，不得可靠输出任一无关语言 |

本地入口为 `tests/integration/local-language-regressions.test.ts`，默认关闭，不下载媒体、不依赖固定私有路径。显式启用后先验证媒体摘要，再用生产 native helper 提取完整原轨，核对 SRT 摘要及生产 parser 结果，最后调用生产检测器。不得用同 cue 数的其他正文替代；元数据标签只作为不变性测试输入，不作为语言真值。

## 执行与验收

在仓库根目录完成 native helper 构建后，按提示输入已取得的三个本地文件绝对路径，再启用测试；输入只保留于本次 shell 环境，不写入仓库：

```sh
read -r 'SUBTANDEM_LANGUAGE_MEDIA_A?38-cue 英语媒体绝对路径：'
read -r 'SUBTANDEM_LANGUAGE_MEDIA_B?11-cue 德语媒体绝对路径：'
read -r 'SUBTANDEM_LANGUAGE_MEDIA_C?多语言 ASS/SSA 媒体绝对路径：'
export SUBTANDEM_LANGUAGE_MEDIA_A SUBTANDEM_LANGUAGE_MEDIA_B SUBTANDEM_LANGUAGE_MEDIA_C
SUBTANDEM_LOCAL_LANGUAGE_REGRESSIONS=1 npm test -- tests/integration/local-language-regressions.test.ts
unset SUBTANDEM_LANGUAGE_MEDIA_A SUBTANDEM_LANGUAGE_MEDIA_B SUBTANDEM_LANGUAGE_MEDIA_C
```

临时提取正文随测试清理。正常输出及失败信息仅含回归 ID、计数、枚举和通过/失败，不输出私有路径、正文、helper token 或原始错误。正确、缺失、错误标签的结果必须一致；每个回归仅作为一个独立本地验收项记录。

未启用时记为未运行，不能记为通过；已启用但缺少输入、摘要不符、提取失败或预期不符时失败。T014 和最终交付分别记录七项本地结果及对应源码/包身份，不能用冻结集或其他通过结果替代。
