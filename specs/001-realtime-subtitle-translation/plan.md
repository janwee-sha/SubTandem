# Implementation Plan: SubTandem 实时字幕翻译 MVP

**Feature**: [spec.md](./spec.md)
**Status**: Implemented; validation pending

## Summary

SubTandem 是 IINA 1.4+ 插件。每个播放器 main entry 独立读取外部 SRT/ASS、调度有限翻译批次、维护会话缓存并管理第二字幕；global entry 共享 Profile 元数据、凭据访问和单次 provider 调用；受限 Swift helper 提供可取消 HTTP、响应头读取、明确代理路由和固定用途凭据存储。

## Technical Context

- **Runtime**: TypeScript 5.9 strict、ES2020、Swift 6；Node.js 24/npm 11 构建。
- **Host**: macOS 12+，IINA 1.4+，arm64/x86_64 universal helper。
- **Providers**: OpenAI-compatible Chat Completions、Ollama native API。
- **Storage**: IINA preferences 保存非秘密默认值与 Profile 元数据；helper 管理插件私有 `credentials.json`；译文只在 `PlaybackSession` 内存中；生成字幕位于 `@tmp/`。
- **Testing**: Vitest 单元/契约/集成/安全测试，Swift contract tests，IINA 正式安装包手工验收。
- **Performance**: 约 250–500ms 评估播放位置；前瞻 120 秒/40 cue；单窗口最多一批在途，窗口间可并发；插件不暂停视频。

## Constitution Check

| Principle | Result | Application |
| --- | --- | --- |
| Lightweight Dual-Track Delivery | PASS | 跨 runtime、provider、凭据和播放器生命周期属于完整 SDD 范围。 |
| SDD Artifacts Describe Current Intent | PASS | 本目录只保留当前产品范围与真实未完成验证。 |
| Minimal, Single-Purpose Context | PASS | 规格、设计、协议、验证与任务各自单一职责。 |
| Explicit Parallel-Work Boundaries | PASS | main/global/UI 热点串行；独立测试和 native/TS 边界可隔离执行。 |
| Verification and Product Safety | PASS | 自动化覆盖映射、重试、隔离和秘密泄漏；host 行为保留手工验收。 |

## Architecture

```text
Sidebar WebView (per player)
  -> Main entry (per player)
       PlaybackSession / scheduler / retry / cache / second track
  -> Global entry (singleton)
       Profile revisions / credential broker / one-attempt providers
  -> Swift helper (local authenticated RPC)
       health / credential file / HTTP / cancel / shutdown
  -> OpenAI-compatible or Ollama
```

### Ownership

- Main owns every player-specific epoch, timer, request, cache, state and generated track.
- Global routes by IINA-provided player ID and never trusts a player ID in message payloads.
- Providers perform one attempt only; Main owns retries and stale-result rejection.
- Helper owns no player state, translation policy or retry policy.

### Critical invariants

- Every asynchronous completion is checked against player, session, seek window, Profile revision and batch identity before mutation.
- A Profile endpoint change creates a new immutable revision and removes that window's selection until explicit reselection.
- Credential values never cross Global back to Main or Sidebar and never enter diagnostics.
- Remote destinations require HTTPS; loopback Ollama may use HTTP.
- Helper replacement occurs before sensitive work and never replays an already-dispatched provider request.

## Project Structure

```text
src/
├── app/              # player-local controller, scheduler, retry and cache
├── domain/           # identities, messages, status and safe errors
├── subtitles/        # SRT/ASS decoding, parsing and rendering
├── providers/        # Profile model and OpenAI/Ollama adapters
├── credentials/      # Global credential facade
├── transport/        # helper client and supervisor
├── adapters/iina/    # IINA runtime, RPC, subtitle and process adapters
├── main.ts
└── global.ts
ui/                   # Sidebar
native/transport/     # constrained Swift helper
tests/                # unit, contract, integration and security suites
```

## Design Artifacts

- [research.md](./research.md): current technical decisions and rationale.
- [data-model.md](./data-model.md): current entities and state transitions.
- [contracts/](./contracts/): provider, transport, message and schema contracts.
- [quickstart.md](./quickstart.md): automated and manual validation procedure.
- [tasks.md](./tasks.md): only outstanding validation work.

## Complexity Justification

| Component | Why it remains necessary |
| --- | --- |
| Swift helper | IINA HTTP does not expose the response headers and cancellation needed for bounded retries and safe stale-work cancellation. |
| Global broker | Multiple main instances share saved Profile metadata and credentials without sharing player state. |
| Separate system/direct routes | Users need both macOS proxy policy and an explicit no-proxy path. |
| Immutable Profile revisions | Active windows must not silently inherit edited endpoints or credentials. |

No unresolved design clarification remains. Outstanding host/version validation is listed in `tasks.md`.
