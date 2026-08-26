# 网络样本资源目录

## 来源优先级

1. [IETF CELLAR Matroska 测试套件](https://github.com/ietf-wg-cellar/matroska-test-files)：容器测试套件，`test5.mkv` 含多语言内嵌文本字幕；Big Buck Bunny 与 Elephant Dreams 样本按 CC BY 提供。
2. [FFmpeg 样本库](https://samples.ffmpeg.org/)：按容器、编码和问题类型组织的工程测试语料。服务器可能响应较慢，应使用连接超时和重试。
3. 格式规范组织、播放器或解码器项目维护的公开测试仓库。
4. 其他无需登录、来源和许可可核实的样本站点。

不要从影视下载站、网盘转载、需要账号的样本平台或许可无法判断的整片资源取样。FFmpeg 样本只用于本地工程验证；除非来源页面明确授权，不要随软件包、Release 或公共镜像重新分发。

## 已验证样本

| 覆盖 | 直接 URL | 时长 | SHA-256 | 注意事项 |
|---|---|---:|---|---|
| MKV + SubRip | `https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/master/test_files/test5.mkv` | 46.665 秒 | `92acdc33bb0b5d7a4d9b0d6ca792230a78c786a30179dc9999cee41c28642842` | H.264/AAC，8 条 SubRip；适合 30 秒计时 |
| MKV + ASS | `https://samples.ffmpeg.org/Matroska/subtitles/test_01.mkv` | 11.982 秒 | `c3f37e9dd4740f82019d2e58a9af58fa318bcc0b4c392fbd831a4fa40ee315a2` | `S_TEXT/ASS`；只适合编码覆盖 |
| MKV + SSA | `https://samples.ffmpeg.org/Matroska/subtitles/SSA_15subtitles.mkv` | 58.183 秒 | `cd233bed8ba0cfb0d5b7afbc9f49b6d4aee0f6c2e6d6da146e8ef43973d2accf` | `S_SSA`，多语言轨 |
| MP4 + mov_text | `https://samples.ffmpeg.org/MPEG-4/embedded_subs/1Video_2Audio_2SUBs_timed_text_streams_.mp4` | 46.534 秒 | `f0cb97b762712f3dc97b05fec721c0ab5fc2b4e3cf6380f1e6db415dffe70459` | 两条 `mov_text` |
| MOV + mov_text | `https://samples.ffmpeg.org/mov/subtitles-embedded/subtitlemovie.mov` | 17.072 秒 | `9df76bfab7f367efa9fb1c26fccdf41baa6cee210a13c95344874e89b8aa8c3c` | QuickTime `text`，只适合编码覆盖 |
| MKV + PGS | `https://samples.ffmpeg.org/sub/PGS/Girl_With_The_Dragon_Tattoo_2%3A23%3A56.mkv` | 2.002 秒 | `833c005bcf596fe2e89560d998edd3213943abe142dcb89bdd179bca95a10afd` | `S_HDMV/PGS`；过短，不作为首选人工操作样本 |
| MKV + VobSub | `https://samples.ffmpeg.org/archive/subtitles/dvdsub/matroska+h264+mp3+dvdsub+reddwarf-vobsub.mkv` | 60.248 秒 | `9e7bad1400a472e37b7e5b271d90ea0c5b4ad99aa19ad16ab7295c904b4042ed` | `S_VOBSUB`，含视频和音频 |
| MPEG-TS + DVB | `https://samples.ffmpeg.org/sub/dvbsub/dvbsubtest.ts` | 约 34.3 秒 | `344e29d35c4581942e85ba4061e2721eee78220eb7bbdb55e8bcb1d2f1b719e5` | PMT descriptor `0x59`，PID `0x19b1` |
| 远程内嵌字幕 | `https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/master/test_files/test5.mkv` | 46.665 秒 | 同首行 | 通过本地 `.m3u` 引用，保持远程 URL 语义 |

## FFmpeg 目录入口

- Matroska 文本字幕：`https://samples.ffmpeg.org/Matroska/subtitles/`
- MP4 内嵌字幕：`https://samples.ffmpeg.org/MPEG-4/embedded_subs/`
- MOV 内嵌字幕：`https://samples.ffmpeg.org/mov/subtitles-embedded/`
- PGS：`https://samples.ffmpeg.org/sub/PGS/`
- VobSub/DVD subtitle：`https://samples.ffmpeg.org/archive/subtitles/dvdsub/`
- DVB subtitle：`https://samples.ffmpeg.org/sub/dvbsub/`

目录页和伴随 `.txt` 只用于发现与理解样本。最终判定必须来自下载文件的实际容器轨道检查。
