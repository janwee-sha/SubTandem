# Data Model: SubTandem 实时字幕翻译 MVP

## GlobalDefaults

Non-secret defaults for new windows:

- `enabledByDefault`
- target language
- source-language mode and optional manual source language
- optional last Profile ID as a convenience, never as active authorization

## ProviderProfile

- Stable UUID identity and positive immutable revision
- Kind: `openai` or `ollama`
- Display name, exact endpoint, model and proxy mode (`system | direct`)
- Semantic fingerprint covering fields that affect translation or destination
- Credential configured flag; the secret value is not part of this entity

**Rules**:

- Editing creates the next revision under the same identity.
- Endpoint changes invalidate selection until the new revision is disclosed and selected.
- Only the latest revision is durable; leased older revisions may remain in Global memory.
- Deletion removes every revision, its credential, related jobs and affected-window selections.

## WindowSelection

- Authoritative player ID
- Profile ID, revision and endpoint fingerprint
- Explicit user authorization for the exact disclosed destination

Selection, credential state and connection-test state are independent.

## SubtitleSource and Cue

`SubtitleSource` contains player/video/track identity, content hash, format, language and ordered cues.

Each `Cue` contains:

- stable source-local ID
- start and end time
- source order
- visible human-readable text

## PlaybackSession

- Player and session IDs
- Session epoch for video/source/language/Profile/enable changes
- Window epoch for seek changes
- Current source, language direction and selection
- Enabled flag and observable state
- One active logical batch, retry timers, session cache and owned second-track identity

**Lifecycle**:

```text
waiting -> preparing -> running
   |           |          |
   +-> no-translation     +-> partial-failure
   +-> unavailable        +-> unavailable

video end or replacement -> clear jobs/cache/track -> reusable controller
window close             -> permanent teardown
```

## TranslationBatch

- Batch, request, player, session and epoch identities
- Profile ID/revision/fingerprint and language direction
- Ordered cue items with optional minimal adjacent context
- Attempt number, lifecycle state and optional retry deadline

Only results matching the complete active identity may mutate cache or track state.

## SessionCacheEntry

- Cache key derived from source/cue identity, language direction and Profile semantic fingerprint
- Cue ID and non-empty translation
- Owning session ID

Entries are memory-only and are synchronously cleared when the video session ends or is replaced.

## CredentialDocument

- `formatVersion: 1`
- Map from Profile UUID to `{ apiKey }`

The helper owns the fixed path, validates the schema and file bounds, and performs atomic replacement. Main and Sidebar never receive stored values.

## GeneratedSubtitleTrack

- Owning player/session IDs
- Temporary file path, revision and exact IINA track ID

Only the exact owned track and file may be replaced or removed.
