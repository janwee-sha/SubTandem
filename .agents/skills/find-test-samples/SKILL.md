---
name: find-test-samples
description: 为 SubTandem 从 FFmpeg 样本库、IETF CELLAR Matroska 测试套件及其他可信网络资源检索、下载并验证测试媒体，固定保存到仓库的 docs/local/samples。用于为单元测试、集成测试、端到端测试、回归测试、兼容性测试或人工测试补充与更新 MKV、MP4、MOV、MPEG-TS、本地或远程媒体样本，以及 SubRip、ASS、SSA、mov_text、PGS、VobSub、DVB 等内嵌字幕覆盖；也用于根据测试需求或测试代码建立媒体覆盖矩阵、核对已有样本编码或替换失效资源。
---

# SubTandem 测试样本

把检索到的媒体固定放入仓库根目录的 `docs/local/samples/`，无论调用方是自动化测试还是人工测试。先验证真实容器、字幕轨和时长，再把候选安装为正式样本；不要根据文件名或网页描述直接判定编码。

## 边界

- 从 `git rev-parse --show-toplevel` 确定仓库根，并确认根目录存在 `AGENTS.md`、`package.json` 和 `docs/local/`。先读取 `AGENTS.md`、项目宪法和初始 `git status --short`。
- 只把媒体、远程播放列表及用户明确要求的样本清单写入 `docs/local/samples/`。
- `docs/local/` 已被 Git 忽略。不要强制添加媒体到版本控制，不要把样本打入插件包或发布资产。
- 自动化测试在 CI 中需要样本时，先确认其下载、缓存或跳过策略。不要静默引入在线依赖，也不要因为 CI 需要就绕过忽略规则；未获用户授权时，把样本明确标记为仅供本地测试使用。
- 保留已有文件。目标名称已存在时，只有摘要完全一致才可复用；替换或删除已有样本必须获得用户明确授权。
- 优先使用公开测试语料和来源明确的官方资源。不要使用盗版站点、需要绕过登录或访问控制的资源，也不要把来源许可不明的样本重新分发。
- 不读取、输出或保存字幕正文、译文、Provider 请求、凭据或 native 原始错误。验证只记录容器、轨道编码、时长、大小、摘要和来源。

## 工作流

1. 读取用户指定的测试文档、测试代码、Issue、复现步骤或需求，建立覆盖矩阵。指定路径失效时，先用 `rg --files docs/local tests test src docs` 按文件名、规格编号或测试名称查找迁移后的内容，并明确报告实际读取路径；不要因仓库内文件移动而退回猜测需求。列出测试层次、场景与断言、容器、字幕编码、支持状态、本地或远程、最低时长和大小约束；用户要求“所有类型”时，必须同时覆盖每个容器和每个字幕类型，允许一个文件覆盖多个格子。
2. 读取 [references/source-catalog.md](references/source-catalog.md)，再联网核对候选当前可访问性、文件大小、来源说明和许可。优先级依次为 IETF CELLAR/Matroska、FFmpeg 官方样本库、格式或项目官方测试仓库、其他可公开验证来源。
3. 按测试目的分配稳定名称。盲测使用不暴露字幕类型的编号，例如 `008-A-01.mkv`、`008-B-02.ts`；其他场景优先沿用需求编号或仓库既有样本命名约定。保留真实扩展名，不要使用影视标题；不要在盲测名称中写入 `pgs`、`vobsub` 或语言名。
4. 用内置下载脚本把候选下载到同一文件系统的临时文件，完成摘要和媒体检查后原子安装：

   ```bash
   python3 <skill-dir>/scripts/download_sample.py \
     --repo-root <repo-root> \
     --url <https-url> \
     --name <opaque-name.ext> \
     --sha256 <known-sha256> \
     --expect-container <matroska|mp4|mov|mpegts> \
     --expect-subtitle <subrip|ass|ssa|mov_text|pgs|vobsub|dvb_subtitle> \
     --min-duration <seconds> \
     --require-video
   ```

   已知摘要不存在时可省略 `--sha256`，但必须在交付中记录脚本返回的新摘要。网络被沙箱阻止时，请求网络权限后原样重试；不要关闭 TLS 校验。只有用户明确批准替换时使用 `--replace`。
5. 对已有文件或额外检查直接运行：

   ```bash
   python3 <skill-dir>/scripts/inspect_sample.py \
     <repo-root>/docs/local/samples/<file> \
     --expect-container <container> \
     --expect-subtitle <codec> \
     --min-duration <seconds> \
     --require-video
   ```

   检查器不依赖系统 `ffmpeg` 或 `ffprobe`。它识别 Matroska Codec ID、MP4/MOV 文本样本项和 MPEG-TS PMT 字幕描述符。检查失败时保留原文件，丢弃未安装候选并继续寻找；不要弱化预期值来迁就错误样本。
6. 只有测试目标本身是远程媒体行为时，才在 `docs/local/samples/` 创建 `.m3u` 引用；不要让默认单元测试、集成测试或回归测试依赖实时网络。播放列表使用 `#EXTM3U`、不透明 `#EXTINF` 名称和一个无凭据 HTTPS URL。先用 HEAD 或小范围请求确认 URL 可访问，再确认远程资源含目标内嵌字幕；不要把签名 URL、Cookie 或令牌写入播放列表。
7. 按测试方式检查适用性。自动化测试优先选择能稳定触发断言的最小样本，并以测试代码中的超时、时长和轨道要求为准；人工实时操作中的 30 秒计时样本应至少约 40 秒并在前段有字幕；只用于触发“不支持”状态的短样本必须明确标注时长。不要为了缩小文件而裁剪或转码需要验证原始兼容性的样本。
8. 完成后逐项报告仓库相对路径、对应测试场景、覆盖类型、实际时长、字节数、SHA-256 和来源 URL。说明资源是否适合离线或 CI 使用，以及复用、替换或删除了哪些文件。盲测场景不要把文件名、路径或字幕内容写入 `docs/validation/` 的结果。

## 编码判定

| 目标类型 | 可接受的容器标识 |
|---|---|
| SubRip | Matroska `S_TEXT/UTF8` |
| ASS | Matroska `S_TEXT/ASS` 或 `S_ASS` |
| SSA | Matroska `S_TEXT/SSA` 或 `S_SSA` |
| mov_text | MP4/MOV `tx3g` 或 QuickTime `text` 样本项 |
| PGS | Matroska `S_HDMV/PGS` 或 MPEG-TS stream type `0x90` |
| VobSub | Matroska `S_VOBSUB` |
| DVB | MPEG-TS subtitle descriptor `0x59` |

把容器和字幕编码当作独立维度。扩展名正确但没有目标字幕轨、只有外挂字幕、视频轨为空、时长不足或下载被截断时，不得计入覆盖。
