# 实现计划：内嵌字幕翻译

**功能目录**：`008-embedded-subtitle-translation`

**Git 分支**：`feat/embedded-subtitle-translation`

**日期**：2026-08-16

**规格**：[spec.md](./spec.md)

## 摘要

在每个播放器 Main 内增加字幕源分类与准备协调器。外挂 SRT/ASS 继续使用现有读取路径；本地内嵌 `subrip`、`ass`/`ssa`、`mov_text` 轨通过随包、逐窗口隔离的 `subtandem-subtitle-extractor` 转成会话级 UTF-8 SRT，再进入现有 parser、有限前瞻、Provider、缓存和第二字幕发布流程。提取器静态链接裁剪后的 FFmpeg 8.1.2，只接受当前所选轨的精确容器流标识；远程媒体、图形字幕和无法证明身份的轨道失败关闭。

## 技术上下文

- **语言与版本**：TypeScript 5.9 strict、ES2020；Swift 6；FFmpeg 8.1.2 C API；Node.js 24/npm 11 构建。
- **主要依赖**：IINA 1.4+ Plugin API、`iina-plugin-definition` 0.99.4、现有字幕 parser/controller；新增静态裁剪的 `libavformat`、`libavcodec`、`libavutil`。
- **存储**：会话内存与 `@tmp/subtandem-extraction/<job-id>/output.srt`；目录 `0700`、文件 `0600`，不新增持久化或跨会话缓存。
- **测试**：Vitest 单元、契约、集成和安全测试；Swift/native extractor 测试；构建与归档审计；正式 `.iinaplgz` 的 IINA 人工验收；开发者单人可用性验收。
- **目标平台**：运行时声明支持 macOS 12+、IINA 1.4+ 和 arm64/x86_64 universal native 组件；正式宿主验收固定使用 IINA 1.4.0 基线与 IINA 1.4.4 发布版，并分别覆盖 Apple Silicon 与 Intel。
- **项目类型**：IINA 桌面插件，包含逐窗口 Main、单例 Global、Sidebar、Provider transport helper 与独立 subtitle extractor。
- **性能目标**：规格范围样本 95% 在 5 秒内可翻译；15 秒硬超时；单窗口最多一个准备任务；播放中断为 0。
- **约束**：首版容器矩阵为 Matroska 中的 SubRip/ASS/SSA 与 MOV/MP4 中的 `mov_text`；最多 20,000 cue、16 MiB 提取输出；只处理本地文件；不 OCR、不转写、不整片预翻译；生产代码无注释且自然语言为英语。
- **规模与范围**：至少 30 个本地媒体验收样本；换轨、换片、跳转、禁用、关窗和双窗口并发各 20 次；时长 4 小时/媒体 20 GB/字幕 20,000 条的上界验证；外挂 SRT/ASS 全量回归；开发者单人可用性验收。
- **集成边界**：选轨、字幕准备、会话隔离、失败处理和打包可独立实施。最终验收前产品必须具备同时适用于外挂与内嵌字幕的统一字幕语言决策；内嵌字幕进入既有翻译链后继续使用当前 Profile revision 门控，本功能不保留或新增手动源语言路径。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。*

| 原则 | 阶段 0 | 阶段 1 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 自动化覆盖选轨、超时、失效、清理和外挂回归；正式包保留 macOS/IINA/架构人工验收。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新标识符、错误码和界面文案使用英语，不新增生产代码注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 路径只进入逐窗口本机提取协议正文；Provider 只接收当前位置附近 cue，且请求与结果继续校验当前 Profile revision；正文、路径和译文不写日志或持久缓存。 |
| 可重建且最小的发布产物 | 通过 | 通过 | FFmpeg 版本、源码摘要和裁剪配置进入 lock；包内仅增加一个 universal extractor，对应源码作为独立 Release 资产。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | extractor 只启用两类容器与三类文本字幕，不加入 OCR、远程协议、通用转码或未来格式兼容层。 |
| 完整 SDD 与精简中文产物 | 通过 | 通过 | 本变更跨 JS/native/打包/权限边界，使用完整 SDD；设计细节分别引用本目录契约。 |
| 控制人工验收成本 | 通过 | 通过 | 可用性由开发者本人使用正式包单人完成，不招募多名目标用户。 |

## 架构与所有权

```text
IINA selected primary subtitle
  -> Main: source classifier + SubtitlePreparationCoordinator
       external -> existing reader/parser
       embedded -> per-window authenticated extractor client
         -> subtandem-subtitle-extractor -> session SRT in @tmp
       ready cues -> existing PlaybackController
         -> existing Global Provider broker -> selected Provider
         -> existing generated second subtitle track
```

- Main 拥有当前媒体 epoch、所选轨身份、准备 attempt、15 秒 timer、临时结果和 UI 状态。
- subtitle extractor 每个播放器窗口独立启动，只绑定 `127.0.0.1`，不接触 Profile、凭据或外网。
- Global 继续只拥有 Profile、凭据和 Provider；在请求入队和结果回传时校验当前 Profile revision，revision 失效时拒绝旧请求与结果。媒体路径、完整字幕轨和准备状态不得经过 Global。
- 准备完成的 cue 只依赖产品统一字幕语言决策，不依赖提供该能力的具体功能；该能力只阻塞最终集成验收。
- seek 只更新翻译窗口，不取消字幕准备；换轨、换片、停止、禁用、关窗和插件退出使准备与翻译同时失效。
- 任何迟到准备结果必须同时通过 media epoch、轨道身份和 attempt ID 校验，任何翻译请求与结果还必须通过当前 Profile revision 校验；失败时删除结果，不创建 source 或第二字幕轨。

## 项目结构

### 本功能文档

```text
specs/008-embedded-subtitle-translation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── package-extractor.md
│   ├── source-state.md
│   └── subtitle-preparation.md
└── checklists/requirements.md
```

### 源码、native 与验证

```text
src/
├── adapters/iina/
│   ├── subtitle-extractor.ts
│   ├── subtitle-source.ts
│   └── subtitle-track.ts
├── app/
│   └── subtitle-preparation.ts
├── domain/
│   ├── messages.ts
│   └── status.ts
├── subtitles/
│   ├── source.ts
│   └── types.ts
├── types/
│   └── iina-runtime.d.ts
└── main.ts

ui/
├── sidebar.css
├── sidebar.html
└── sidebar.ts

native/
├── ffmpeg.lock.json
├── subtitle-extractor/
│   ├── Package.swift
│   ├── Sources/
│   └── Tests/
└── transport/

scripts/
├── build-ffmpeg.sh
├── build-native.sh
├── test-native.sh
├── verify-package.sh
├── pack.sh
├── audit-release.mjs
├── release-metadata.mjs
└── publish-release.mjs

tests/
├── contract/
├── integration/
├── security/
├── unit/
└── fixtures/media/

Info.json
LICENSE
THIRD_PARTY_NOTICES.txt
README.md
docs/readme/
docs/engineering/development.md
docs/validation/
.github/workflows/release.yml
```

**结构决策**：保持现有 source→controller→Provider→第二字幕分层，只在 source 前增加逐窗口准备层。新增 extractor 使用独立进程和协议，避免让持有凭据及外网能力的 transport 同时读取完整媒体。

## 设计产物

- [research.md](./research.md)：轨道映射、提取器、生命周期、FFmpeg、打包与统一字幕语言决策集成边界。
- [data-model.md](./data-model.md)：字幕源身份、准备 attempt、提取 job、临时结果和 UI 状态转换。
- [contracts/subtitle-preparation.md](./contracts/subtitle-preparation.md)：Main、IINA adapter 与本机 extractor 的输入、输出、取消和安全契约。
- [contracts/source-state.md](./contracts/source-state.md)：Sidebar 状态优先级、用户动作与重试语义。
- [contracts/package-extractor.md](./contracts/package-extractor.md)：native 产物、FFmpeg lock、许可证和正式包审计契约。
- [quickstart.md](./quickstart.md)：聚焦自动化、完整门禁和 IINA 实机验收方法。

## 复杂度跟踪

无宪法例外。独立 extractor 是隔离本地媒体/字幕与现有凭据/外网进程所需的最小新增运行组件；逐窗口协调器是满足多窗口、取消和迟到结果隔离所需的最小状态。
