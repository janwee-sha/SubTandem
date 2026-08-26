# Quickstart Validation Guide

## Prerequisites

- macOS 12+, Node.js 24/npm 11 and Swift 6
- IINA 1.4+ for host validation
- External SRT/ASS fixtures
- OpenAI-compatible and local Ollama test Profiles where live validation is authorized

## Automated validation

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:native
npm run build:native
npm run build
npm run verify:package
npm run pack
```

Expected: all default tests and build/package checks pass. Live-provider tests remain opt-in and must not print or persist test credentials.

## Formal installation

Remove any development link before acceptance:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
open build/package/SubTandem-0.1.0.iinaplgz
```

Restart IINA, enable SubTandem, and confirm the installed entry exposes an Uninstall action. Formal acceptance must not use an `.iinaplugin-dev` link.

## Core playback

1. Open a video with an external non-native SRT, confirm source and target languages, select a Profile and enable translation.
2. Verify the original subtitle remains primary and translated cues appear as a synchronized second subtitle without pausing playback.
3. Repeat with ASS and UTF-16 SRT samples; verify multiline text, timing, ordering and control-tag stripping.
4. Delay or fail the service; verify original playback continues and no placeholder, wrong cue or technical error appears as subtitle text.
5. Disable during an active request; verify late output is ignored and only the plugin-owned second track is removed.

## Bounded work and cache

1. Use a same-language subtitle and seek repeatedly; provider call count remains zero.
2. Watch part of a long fixture; selected work never exceeds 120 seconds or 40 cues and each logical sub-batch remains within 25 cues/5,000 code points.
3. Seek backward in the same session; completed cues reuse cache without repeat calls.
4. Seek rapidly to a distant position; old work is cancelled or invalidated and cannot enter the new track.
5. Close and reopen the video; the previous session cache and temporary track are gone and a new session is created.

## Profiles and credentials

1. Create, Test and Select one OpenAI-compatible and one Ollama Profile; translate the same fixture with both.
2. Confirm the OpenAI-compatible API root is stored literally and the composed request address is previewed before selection.
3. Edit a Profile repeatedly; one row advances revision without duplicates. Endpoint changes require reselection.
4. Cancel one native Delete confirmation, then confirm deletion; only the selected Profile, its credential, related work and affected-window selections disappear.
5. Verify every action reports busy and request-correlated success, cancellation or error independently of Session status.
6. Save an OpenAI-compatible key and relaunch IINA. The UI reports only configured state; the full value never appears in UI, preferences, logs or diagnostics.
7. Confirm the plugin data directory is `0700`, `credentials.json` is `0600`, replacement is atomic, and Ollama creates no credential entry.

## Retry, transport and recovery

1. Verify transient failures receive at most three retries after the initial attempt with increasing delay.
2. Verify a valid `Retry-After` delays the next attempt and permanent configuration/authentication/model/quota errors are not retried.
3. Disable, seek, switch Profile and close the video during backoff; pending timers and exact helper jobs are cancelled.
4. Verify wrong loopback token, remote plaintext HTTP, URL credentials and unsafe redirects are rejected.
5. Leave the helper idle for at least 310 seconds, then Test and translate again; one replacement session starts before sensitive work and no dispatched provider request is replayed.
6. Test an allowed endpoint in `system` and `direct` modes; system follows macOS proxy policy and direct bypasses configured proxies.

## Multi-window isolation

1. Open two players, use different Profile revisions or languages, and independently play, seek, fail, disable and close them.
2. Verify request IDs, epochs, caches, timers, states, temporary paths and generated track IDs never cross windows.
3. Edit a Profile in one window; another active window may finish its leased revision without being silently switched.
4. Fail or close one window while the other translates; the other video's playback, retries and second subtitle remain available.

## Outstanding validation

These rows remain incomplete and are the only open work in `tasks.md`:

| Environment | Scenario | Status |
| --- | --- | --- |
| IINA 1.4.4 | Real UTF-16 SRT and ASS playback | NOT RUN |
| IINA 1.4.4 | Confirmed destructive Profile deletion and credential removal | NOT RUN |
| IINA 1.4.4 | Live Retry-After, seek cancellation and two-window isolation | NOT RUN |
| IINA 1.4.0 | Complete formal-package quickstart matrix | NOT RUN |
| Target users | 10-person primary-task usability test | NOT RUN |

Record completed host evidence in `docs/validation/iina-matrix.md` and usability evidence in `docs/validation/usability.md`. Do not mark a row complete from automated coverage alone.
