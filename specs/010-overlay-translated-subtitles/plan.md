# 实现计划：覆盖层译文渲染

**Git 分支**：`feat/overlay-translated-subtitles`

**日期**：2026-08-18

**规格**：[spec.md](./spec.md)

## 摘要

把 `PlaybackController` 的最终输出从完整 SRT 快照改为当前播放位置命中的纯文本译文帧，由每个 Main 窗口独立持有的覆盖层适配器通过 `osd-overlay` 显示。适配器固定使用 720p 逻辑高度、顶部居中、白色字号 40、透明背景和原生近似描边；controller 在 350 毫秒播放 tick、渐进结果到达和生命周期失效时同步显示或清理。旧字幕轨管理器、临时译文 SRT、`sub-add`/`sub-remove` 与 `secondary-sid` 路径全部移除。

## 技术上下文

- **语言与版本**：TypeScript 5.9 strict、ES2020；Node.js 24/npm 11 构建。
- **主要依赖**：IINA 1.4+ Plugin API、`iina-plugin-definition` 0.99.4、IINA 内嵌 mpv/libass、现有 `PlaybackController` 与 `PlaybackSession`；不新增运行时依赖。
- **存储**：仅使用逐窗口内存中的译文缓存与最后显示帧；移除 `@tmp` 译文 SRT，不新增持久化数据。
- **测试**：Vitest 单元、集成、契约与安全回归；TypeScript 类型检查、lint、构建和包审计；正式 `.iinaplgz` 的 IINA 人工验收。
- **目标平台**：当前开发环境中的 macOS 与 IINA 1.4.4；本功能不扩展跨 macOS 版本、IINA 版本或 CPU 架构的验收矩阵。
- **项目类型**：包含逐窗口 Main、单例 Global、Sidebar 与 native helper 的 IINA 桌面插件；本功能只修改 Main 内的译文呈现边界。
- **性能目标**：有效译文可用后 95% 在 500 毫秒内显示；离开有效时间或会话失效后 100% 在 500 毫秒内清除；持续播放 30 分钟/100 cue 时插件轨道操作与轨道通知为 0。
- **约束**：720p 高度下字号 40 并随窗口等比缩放；长文本自动换行，插件不主动截断、省略或额外缩字，超出窗口高度时允许裁切；生产代码不新增注释且自然语言使用英语；不拦截鼠标；不保留第二字幕轨兼容路径。
- **规模与范围**：外部与内嵌文本字幕、两个并发窗口、至少 20 次窗口尺寸变化，以及暂停、跳转、换轨、换片、禁用和关窗各 20 次。
- **宿主边界**：IINA 的 `mpv.command` 仅暴露位置字符串参数并返回 `void`；自动化验证命令构造与应用状态，正式包负责证明当前 IINA 1.4.4 的真实渲染、清理、时序、裁切和宿主日志安全。

## 宪法检查

*阶段 0 前与阶段 1 设计后均通过。宿主兼容与日志安全作为实现阶段阻断门保留，不能以 mock 替代。*

| 原则 | 阶段 0 | 阶段 1 | 落实方式 |
| --- | --- | --- | --- |
| 验证与产品安全 | 通过 | 通过 | 自动化直接覆盖生产 controller 与覆盖层适配器；正式包保留 IINA 轨道通知、窗口、多窗口和生命周期人工验收。 |
| 生产代码无注释且默认仅使用英语 | 通过 | 通过 | 新标识符、错误与产品文案使用英语，不新增生产注释；移除旧轨道适配器中的历史注释。 |
| 敏感数据与外部副作用最小化 | 通过 | 通过 | 译文只进入所属 Main 的内存覆盖层；不新增项目日志、外发、权限、持久化或跨会话缓存；宿主日志 sentinel 命中必须为 0。 |
| 可重建且最小的发布产物 | 通过 | 通过 | 不新增依赖或包文件；移除临时译文文件行为并同步正式 manifest 描述，沿用现有构建和包审计。 |
| 生产代码只实现当前功能需求 | 通过 | 通过 | 完全删除第二字幕轨发布、选择恢复和临时文件代码，不加入自定义样式、拖动或兼容开关。 |
| 完整 SDD 与精简中文产物 | 通过 | 通过 | 变更跨 controller、IINA 命令和正式包产品契约，使用完整 SDD；研究、模型、契约与验证各自单一职责。 |
| 控制人工验收成本 | 通过 | 通过 | 自动化覆盖可证明行为；宿主交互由开发者本人按正式包步骤单人验收。 |

## 架构与所有权

```text
selected subtitle -> existing source/parser -> PlaybackController
  -> existing bounded Provider pipeline -> verified translation cache
  -> current position + active translated cues
  -> per-window translation overlay sink
  -> IINA/mpv text overlay
```

- `PlaybackController` 继续拥有 source cue、译文缓存、当前播放位置和会话 fingerprint，并决定当前应显示的译文集合。
- `PlaybackController` 在 Provider 调度判断之前同步当前帧；渐进或最终结果到达后也按最新位置同步，确保请求执行期间仍能自然切换和清理。
- 新逐窗口覆盖层适配器只接收按源 cue 顺序排列的纯文本行，负责 ASS 安全编码、固定样式、同内容去重、显示和清理；不得读取 Profile、字幕源或播放状态。
- Main 继续用 350 毫秒 tick 更新 controller；seek、换轨、换片、禁用和关窗沿现有会话失效路径立即清理覆盖层。移除仅用于屏蔽译文轨发布事件的判断，保留真实源轨变动的 settle/reload。
- Global、Provider、subtitle extractor、Sidebar 状态与凭据边界保持不变。
- IINA API 不提供命令确认；位置参数兼容性、真实渲染和宿主日志安全由正式包阻断门验证，失败时回到规格与方案阶段，不回退第二字幕轨。

## 项目结构

### 本功能文档

```text
specs/010-overlay-translated-subtitles/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── translation-overlay.md
└── checklists/requirements.md
```

### 源码与验证

```text
src/
├── adapters/iina/
│   ├── subtitle-overlay.ts
│   └── subtitle-source.ts
├── app/
│   ├── controller.ts
│   └── playback-session.ts
├── subtitles/
│   ├── active-translations.ts
│   ├── srt.ts
│   └── types.ts
└── main.ts

tests/
├── contract/
│   ├── package-manifest.test.ts
│   └── sidebar-lifecycle.test.ts
├── integration/
│   ├── subtitle-overlay.test.ts
│   ├── progressive-translation.test.ts
│   ├── embedded-subtitle.test.ts
│   ├── performance.test.ts
│   └── us1-playback.test.ts
└── unit/
    ├── srt.test.ts
    └── translation-overlay.test.ts

Info.json
README.md
docs/readme/
```

**结构决策**：保持 source→controller→Provider 的现有边界，只替换 controller 的最终显示 port 和 IINA adapter。删除 `src/adapters/iina/subtitle-track.ts` 与对应测试，新增当前译文选择器和职责单一的 `subtitle-overlay.ts`；`srt.ts` 仅保留输入解析。README 及其翻译同步当前产品行为，历史 release notes 和既有验收证据不改写。

## 设计产物

- [research.md](./research.md)：`osd-overlay`、ASS 安全显示、播放同步、旧路径移除与验证决策。
- [data-model.md](./data-model.md)：当前可见译文集合、覆盖层帧、固定样式和显示状态转换。
- [contracts/translation-overlay.md](./contracts/translation-overlay.md)：controller、覆盖层 sink 与 IINA/mpv 的显示、清理、安全和错误契约。
- [quickstart.md](./quickstart.md)：聚焦自动化、完整门禁与 IINA 正式包验收。

## 复杂度跟踪

无宪法例外。新增覆盖层适配器取代更复杂的字幕轨与临时文件管理，不增加运行组件、权限、依赖或持久状态。
