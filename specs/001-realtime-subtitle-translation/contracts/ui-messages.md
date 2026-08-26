# Sidebar / Main / Global Message Contract

Messages use request IDs, revisions and validated payloads. Global always routes by the authoritative player ID supplied by IINA; IDs inside message data are not trusted.

## Sidebar to Main

- `ui:ready`, `defaults:save`
- `profile:save`, `profile:select`, `profile:delete-request`
- `credential:set`, `provider:test`
- `translation:set-enabled`

Credential input is write-only. Profile deletion requires IINA native confirmation. Selection authorizes the exact disclosed Profile revision and destination; it does not assert that credentials or connectivity passed Test.

## Main to Sidebar

- `state:update`
- `operation:result`, `operation:error`
- `profile:deleted`
- `credential:state`

Views contain sanitized Profile metadata, selection, source summary, session state, cache counts and independent credential/Test states. Secret values are represented only as configured/not configured. Operation feedback is request-correlated and remains separate from periodic session state.

## Main to Global

- `profiles:list`, `profile:create-revision`, `profile:delete`, `profile:select`, `profile:release`
- `credential:set`
- `provider:test`, `provider:attempt`, `provider:cancel`

Provider messages include the complete session/Profile identity. Global keys jobs by authoritative player ID plus request ID and permits different players to run concurrently.

## Global to Main

- `profiles:result`, `profile:revision-created`, `profile:deleted`, `profile:selected`
- `credential:result`, `credential:state`
- `provider:test-result`, `provider:attempt-progress`, `provider:attempt-result`, `provider:attempt-error`, `provider:cancelled`

Main discards any reply that does not match its current request and complete player/session/window/Profile identity. Progress routing and terminal cleanup follow [002 progressive output](../../002-progressive-translation-output/contracts/progress-messages.md).

## Invariants

1. Editing creates a new immutable Profile revision; active snapshots are never mutated.
2. A new endpoint revision requires disclosure and explicit selection in each affected window.
3. Selection, credential configuration and Test result are independent states.
4. Window A operations never change window B's selection or playback session.
5. Deleting a Profile removes all revisions and its credential, cancels only related work, and invalidates only affected windows.
6. Credentials, helper token, authorization headers, subtitle text and provider bodies never cross Global to Main or Sidebar.
