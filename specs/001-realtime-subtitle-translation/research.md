# Current Technical Decisions

## IINA runtime and subtitle access

**Decision**: Support IINA 1.4+ on macOS 12+. Read only the selected external track when it is accessible through `@sub/<trackId>` and validates as SRT or ASS.

**Rationale**: The host exposes external subtitle bytes and player-local events but does not expose a complete future-cue API for every embedded format. This boundary enables deterministic parsing and bounded lookahead.

**Alternatives considered**: Media scanning or audio transcription would expand format, process and privacy scope; current-text-only access cannot prepare future cues.

## Player-local ownership

**Decision**: Each main entry owns its `PlaybackSession`, epochs, scheduler, retry state, cache, status and generated track. Global owns only shared Profile metadata, credential access and one-attempt provider dispatch.

**Rationale**: IINA creates one main instance per player and one global instance. Keeping playback state local prevents window failures, seeks and configuration changes from crossing players.

**Alternatives considered**: Global playback state would create cross-window coupling; per-window writes to shared metadata would create races.

## Scheduling, batching and cache

**Decision**: Select at most 120 seconds or 40 cues ahead, refill below 30 seconds or 10 cues, split logical work at 25 cues or 5,000 Unicode code points, and allow one active logical batch per player. Cache only successful translations in the owning video session.

**Rationale**: The bounds balance first-result latency, continuous readiness, request cost and seek cancellation. Session ownership permits replay reuse without persistent or cross-video leakage.

**Alternatives considered**: Per-cue requests repeat protocol overhead; whole-video work violates the product boundary; persistent or global caches outlive the user's viewing session.

## Second subtitle lifecycle

**Decision**: Render a complete UTF-8 SRT revision to a player/session-specific temporary path, add it as a new track, select it as second subtitle, then remove only the previous plugin-owned track and file.

**Rationale**: Full revision swaps avoid partial file reads and preserve exact track ownership. Primary subtitles and user-selected unrelated second tracks remain untouched.

**Alternatives considered**: Overlay text is not a real second subtitle; accumulating per-batch tracks leaks resources; overwriting an active file risks partial reads.

## Provider and output contract

**Decision**: Support OpenAI-compatible Chat Completions and Ollama native chat. Both use short opaque wire IDs, structured JSON output, local exact-ID validation and ordered requests of at most two cues.

**Rationale**: Small wire groups improve model cardinality reliability. Local validation prevents unknown, duplicate, missing or empty results from corrupting cue mapping.

**Alternatives considered**: Real-batch response-format fallback may duplicate billing; accepting positional or free-form output weakens mapping safety; unbounded groups reduce reliability.

## Credential persistence

**Decision**: A token-authenticated helper atomically stores OpenAI-compatible keys in a fixed plugin-private `credentials.json` with directory mode `0700` and file mode `0600`. Sidebar receives only configured/not-configured state. Ollama stores no credential.

**Rationale**: A fixed, permission-restricted document avoids secrets in preferences, UI state, package contents, process arguments and diagnostics while surviving restarts. The product discloses that this is a local plaintext file and its protection boundary is the current user's file permissions.

**Alternatives considered**: Session-only credentials require re-entry after every restart; caller-selected paths expand the helper's authority; storing secrets in preferences or command arguments exposes them to unrelated surfaces.

## Transport, retry and helper supervision

**Decision**: Global calls a loopback-only Swift helper for credential operations and provider HTTP. The helper exposes health, bounded request, exact cancellation and shutdown. Main performs the initial attempt plus at most three retries with increasing delay and `Retry-After` support.

**Rationale**: IINA HTTP lacks response headers and an abort handle. A constrained helper provides real deadlines, cancellation and selected headers while leaving session policy in Main. Health-before-use permits recovery after the 300-second idle lease.

**Alternatives considered**: WebView fetch depends on provider CORS; command-line HTTP risks secret exposure; a general local proxy would exceed the required authority.

## Proxy routes

**Decision**: `system` uses URLSession and macOS proxy policy; `direct` uses in-process system libcurl with `CURLOPT_NOPROXY="*"` and no automatic redirect.

**Rationale**: The two modes have distinct user intent. An explicit no-proxy transport is required because clearing environment values alone does not reliably bypass system routing.

**Alternatives considered**: A single system route cannot guarantee direct behavior; a child command adds lifecycle and secret-handling risk.
