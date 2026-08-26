# 研究与技术决策：内嵌字幕翻译

## 复用统一 cue 与现有翻译链

**决策**：外挂字幕继续使用现有 `@sub/<id>` 读取；IINA 1.4.0–1.4.4 的实现只为外挂轨返回该伪路径，内嵌轨不得尝试读取。内嵌字幕准备后统一为 UTF-8 SRT，再经现有 `parseSrt` 生成 `SubtitleCue[]`。`PlaybackController`、有限前瞻、批量、Provider、会话缓存、当前 Profile revision 门控和第二字幕发布不区分来源；revision 变化使旧请求与结果失效。

**理由**：现有下游只依赖 cue、内容 hash 和语言，已经覆盖会话失效、渐进发布与播放安全。ASS/SSA 样式、定位和字体不是规格要求，规范化不会改变对白顺序与有效时间。

**考虑过的替代方案**：为每种内嵌格式建立独立翻译路径会重复调度和生命周期；按播放中的 `sub-text` 积累无法在跳转后获得附近未来 cue，也不能证明 99.9% 完整率。

## IINA 本地媒体与真实选轨身份

**决策**：IINA adapter 使用 `core.status.isNetworkResource` 与按 file URL 语义规范化的 `core.status.url` 判定本地文件；以 `core.subtitle.id` 锁定当前主字幕，并从 `mpv.getNative("track-list")` 要求唯一匹配 `type=sub`、同 ID、`selected=true`、`main-selection=0` 的节点，取得其 `external`、`codec`、`src-id` 与 `ff-index`。title/lang 只用于展示或语言识别，不参与选轨。

提取器必须验证：`ff-index` 指向 subtitle stream 且 codec 与请求一致。IINA 的 Matroska 内建 demuxer 将 TrackNumber 作为 `src-id`，而 libavformat 8.1.2 不把它暴露为可比较的 `AVStream.id`；因此 Main 保留该值用于提交前后会话身份核对，但向 Matroska 提取请求传 `null`。MOV/MP4 的 `src-id` 可比较时必须相等。字段缺失、冲突或容器无法证明映射时失败关闭，不按相似元数据替代。

**理由**：IINA 的 Track ID 只在同类型轨道内唯一，不等同容器 stream index。mpv 将 `ff-index` 定义为 FFmpeg stream index，同时明确其他 demuxer 下可能不可靠，因此必须结合 source ID、codec 和受支持 IINA 版本样本验证。

**考虑过的替代方案**：把 Track ID 当 stream index、按语言/title 匹配或选择第 N 条字幕都会在多轨媒体中误用其他轨，违反 FR-001。

**依据**：[IINA Plugin API](https://docs.iina.io/)、仓库锁定的 `iina-plugin-definition` 0.99.4、[mpv track-list](https://mpv.io/manual/stable/#track-list)。

## 独立逐窗口 subtitle extractor

**决策**：新增 `dist/native/subtandem-subtitle-extractor`。每个 Main 窗口通过 `utils.exec` 启动自己的认证 loopback 服务；媒体路径只放在带随机 token 的请求正文中。extractor 静态链接裁剪后的 libav，只开放健康检查、准备、取消、释放和关闭操作。

**理由**：逐窗口进程使 job、timer、临时目录和关窗清理天然隔离；独立于 `subtandem-transport` 可避免同一进程同时持有凭据、外网能力、完整媒体路径和完整字幕轨。

**考虑过的替代方案**：扩展 Global transport 会扩大跨窗口共享面；直接调用用户安装的 FFmpeg 违反无需外部依赖；调用 IINA 包内私有二进制没有公开兼容契约；AVFoundation 不能可靠覆盖 Matroska ASS/SSA。

## FFmpeg 版本与首版兼容矩阵

**决策**：固定 FFmpeg 8.1.2 源码，在 `native/ffmpeg.lock.json` 记录官方 tarball URL、精确 SHA-256、许可证和完整裁剪配置。关闭 network、autodetect，不启用 GPL/nonfree 可选组件，并关闭不相关程序/组件，只启用：

| 容器 | codec | 规范化输出 |
| --- | --- | --- |
| Matroska (`.mkv`) | `subrip`（接受 mpv 的 `srt` 别名并规范化） | UTF-8 SRT |
| Matroska (`.mkv`) | `ass`、`ssa` | 去除非必要样式后的 UTF-8 SRT |
| MOV/MP4 (`.mov`、`.mp4`、`.m4v`) | `mov_text` | UTF-8 SRT |

图形 codec `hdmv_pgs_subtitle`、`dvd_subtitle`、`dvb_subtitle` 在 Main 与 extractor 两端拒绝。输出限制为 20,000 cue 和 16 MiB。

**理由**：8.1.2 是已有修复版本的稳定分支点，具备所需 demux/文本字幕 API；固定、裁剪、无网络构建比动态选择最新版或通用 CLI 更可重建且更小。

**考虑过的替代方案**：刚发布的下一主版本会增加首版验证变量；启用所有 demuxer/codec 或通用 CLI 会扩大包体、攻击面和许可审计；只支持单一容器不足以覆盖规格样本。

**依据**：[FFmpeg 官方下载与签名](https://ffmpeg.org/download.html)、[FFmpeg 法律说明](https://ffmpeg.org/legal.html)。

## 准备 attempt、15 秒超时与显式重试

**决策**：每个 Main 使用 `SubtitlePreparationCoordinator`，attempt 绑定 media epoch、所选轨身份与不可复用 ID。15 秒到达时先使 attempt 失效，再请求 extractor 取消并进入 `timedOut`；所有迟到完成只触发结果释放。只有 Sidebar 的 `subtitle:retry-preparation` 用户动作可从失败或超时状态创建新 attempt。

**理由**：先失效再取消可覆盖无法同步停止的 native 工作；不可复用 ID 防止旧结果进入新轨道。明确重试符合已澄清的 FR-012。

**考虑过的替代方案**：轮询或 `track-list` 事件自动重试会违反显式重试；只依赖 native 取消存在完成竞态；复用 `PlaybackSession.windowEpoch` 会让 seek 错误取消整轨准备。

## 生命周期与 seek

**决策**：换轨、换片、停止、禁用、关窗和插件退出使准备 attempt、已准备 source、翻译请求、缓存和第二字幕同时失效。seek 不取消准备；成功后 controller 在下一次 tick 从最新播放位置选择有限窗口。

**理由**：准备属于媒体+字幕源生命周期，而非播放位置窗口；这同时满足跳转期间继续准备和迟到结果不跨会话。

**考虑过的替代方案**：把准备注册进现有 seek cancellation 会重复昂贵工作；允许换轨后继续接受结果会污染新 source。

## 临时数据与安全错误

**决策**：extractor 只在启动参数指定的 `@tmp/subtandem-extraction` 根目录下创建 UUID 子目录，权限分别为 `0700`/`0600`。Main 校验 hash、大小与 cue 数后读取并立即释放；取消、失败、超时、关闭和下次启动均按合法 UUID 精确清理。媒体路径、字幕正文、译文和 libav 错误文本不得进入日志、UI、异常或发布证据。

**理由**：受限目录与双端清理覆盖正常和异常生命周期；固定错误码能保留可操作性而不泄露数据。

**考虑过的替代方案**：将完整 SRT 放进 Global 消息会扩大窗口共享面；长期留在 `@data` 会变成持久缓存；扫描整个临时根会冒删其他功能文件。

## UI 状态与操作

**决策**：准备状态独立于现有翻译 `SessionStatus`，Sidebar 优先显示 `preparing`、`unsupportedType`、`remoteUnsupported`、`emptyOrUnreadable`、`timedOut`、`failed`。失败和超时提供 Retry；所有不可用状态说明可在 IINA 重新选择主字幕，但插件不新增轨道选择器。

**理由**：现有 `preparing` 表示 Provider 翻译，复用会混淆两个阶段；独立状态能证明 FR-012 的原因区分与用户下一步。

**考虑过的替代方案**：只显示统一“不可读”无法区分不支持、远程与超时；自动切换相似轨违反真实选轨要求。

## 发布、许可证与来源

**决策**：包内新增一个 arm64/x86_64、macOS 12、可执行且已签名的 extractor；`dist/native/` 使用精确双文件白名单。正式 `.iinaplgz` 必须包含仓库 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt`。FFmpeg 源码不进入 `.iinaplgz`，而由 Release 发布与 lock 一致的对应源码资产和校验文件；第三方声明记录版本、许可证、构建配置和源码位置并与 lock、源码资产一致。沿用现有 ad-hoc 签名策略，不在本功能引入 notarization 变更。

**理由**：这同时满足可重建、最小包和对应源码义务；独立源码资产不会把构建材料混进运行包。

**考虑过的替代方案**：只链接上游主页不能稳定证明对应源码；把源码、头文件或静态库装入插件违反最小包；分发多组 dylib 会增加 rpath、签名和架构审计。

## 统一字幕语言决策集成边界

**决策**：选轨、字幕准备、会话隔离、失败处理和打包独立实施。内嵌与外挂向同一个产品字幕语言决策入口提供 cue，不绑定该能力的来源，也不延续当前手动 source language；真实能力只在最终集成验收前必须可用。

**理由**：来源中立的集成边界既允许各切片独立推进，也避免为内嵌字幕形成不同的缓存键或 Provider 方向。

**考虑过的替代方案**：等待另一项完整功能会无必要地阻塞独立工作；复制轻量识别器或暂时保留手动字段会形成需移除的第二套路径。

## 验证策略

**决策**：自动化覆盖 source 分类、真实 stream 映射、native 提取、超时/取消/迟到、双窗口、当前 Profile revision、Provider 零调用、临时清理、包结构与外挂回归；正式包在 Apple Silicon 与 Intel、IINA 1.4.0 基线和 IINA 1.4.4 固定发布版组成的四个架构/宿主组合上执行人工验收并记录实际 macOS 版本与包 SHA-256。换轨、换片、跳转、禁用、关窗和双窗口并发各重复 20 次；另以同一正式包验证权限允许/拒绝、卸载和重新安装。30 个样本按 codec、容器、多轨和失败类型组成矩阵，4 小时/20 GB/20,000 cue 使用本地合成或合法样本，不提交大媒体；可用性由开发者本人单人验收。

**理由**：JS 测试不能证明 IINA 宿主、universal slice 或安装包行为；只做实机测试又不能稳定覆盖所有竞态和泄露门禁。

**考虑过的替代方案**：只验证 `lipo` 不能替代 Intel 运行；开发链接不能替代正式安装包；把私有媒体路径或字幕正文写入证据违反隐私要求。
