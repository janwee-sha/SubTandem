# Tasks: SubTandem 实时字幕翻译 MVP

**Status**: Implementation complete; validation incomplete
**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [quickstart.md](./quickstart.md)

Only genuine unfinished validation remains. Completed implementation is represented by the current code and Git history, not by checked-off tasks in this file.

## Phase 1: User Story 1 — Host subtitle and window validation

**Independent Test**: A formally installed package displays correct second subtitles from real SRT/ASS inputs and isolates simultaneous players.

- [ ] T001 [US1] Execute the IINA 1.4.4 formal-package UTF-16 SRT and ASS playback rows and record evidence in docs/validation/iina-matrix.md
- [ ] T002 [US1] Execute the IINA 1.4.4 two-window play/seek/fail/disable/close isolation row and record evidence in docs/validation/iina-matrix.md

## Phase 2: User Story 2 — Live cancellation and retry validation

**Independent Test**: Real host behavior respects retry timing and rejects stale work after seeks or lifecycle changes.

- [ ] T003 [US2] Execute live IINA 1.4.4 Retry-After plus seek/backoff cancellation scenarios and record evidence in docs/validation/iina-matrix.md

## Phase 3: User Story 3 — Destructive Profile validation

**Independent Test**: Confirmed deletion removes only the target Profile credential, authorization and work while cancellation preserves them.

- [ ] T004 [US3] Execute confirmed Profile deletion with credential removal and unaffected-window checks, then record evidence in docs/validation/iina-matrix.md

## Phase 4: Cross-cutting release validation

- [ ] T005 Execute the complete formal-package quickstart matrix on IINA 1.4.0 and record evidence in docs/validation/iina-matrix.md
- [ ] T006 [P] Run the 10-person primary-task usability test for SC-010 and record results in docs/validation/usability.md

## Dependencies and Parallel Work

- T001–T005 are operationally independent but update the same evidence file, so their document edits MUST be serialized.
- T006 uses a separate evidence file and MAY run in parallel.
- No source implementation task is implied unless a validation failure reveals a new defect; such a defect follows the constitution's lightweight/full-SDD track selection.

## Completion

The feature is fully validated when T001–T006 are complete and the evidence matches the current specification and package.
