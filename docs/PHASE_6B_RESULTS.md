# Phase 6B results — daily-use validation and bug burn-down

Date: 2026-09-25

Round 1 starting HEAD: `81b8e4c docs: record phase 1 regression coverage`

Round 2 starting HEAD: `3445743 docs: refresh phase 6b final evidence`

Round 3 starting HEAD: `c214eeab277196193b6481af938a0ecf56a92daa`

Final UX/publication-prep starting HEAD: `59aaeca213664b520b87370930b2d0b505854183`

Starting working tree: user-owned deletion `storage/ZUI_Macro_Library_Backup.json`; preserved and excluded from commits.

Version: `0.6.0` internal beta

Status: **COMPLETE / USER DAILY-USE ACCEPTANCE PASS**

## Automated Validation

- Unit suite: **113/113 PASS**.
- Final Phase 1 PoC, visible-Chrome Phase 1B, Phase 2, Phase 3, Phase 4, Phase 5 and Edge Phase 6 regression: **PASS**.
- Historical Phase 1 runners now exercise the current exact-host test permission plus production `PIN_TAB_BY_ID` injection path; production permissions remain unchanged.
- Phase 5 lifecycle/portability regression: **PASS**.
- Phase 6B daily-use E2E: **PASS** after `DUI-001` through `DUI-006` fixes.
- Core flow: Record → Pause → popup reopen → Resume → Stop → Save → Replay.
- Target switching: 21 cycles over three distinct local origins; each received exactly seven replays.
- Popup lifecycle: 25 close/reopen cycles and five rapid Pause/Resume cycles.
- Exact-tab routing: two same-origin tabs; only the pinned tab changed.
- Repeat matrix: 1/2/10/100 repeats with 0/100/1000 ms loop delays; counters matched dispatch totals.
- Speed matrix: 0.5×, 1×, 2×, 4×, 5×; canonical delay remained 500 ms.
- Rapid controls: 10 Play/Stop cycles and 10 alternating Record/Cancel/Stop cycles.
- Infinite loop: stopped at iteration 10 without orphan state.
- Immutable playback snapshot: source edits during playback did not mutate the active run.
- Large macro: 10,000 delay rows completed; 50,000-row validation remains covered by unit tests.
- Bulk Delay: 10,000-event macro, 5,000 delay rows set to 100 ms, Undo/Redo/export round-trip PASS.
- Recording stress: 1,000 input events produced 2,000 ordered canonical rows.
- Backup/restore: 40 synthetic macros; Keep Both, Skip and Replace produced consistent counts.
- JSON round-trip: 10 cycles without semantic drift or runtime fields.
- Settings persistence/reset and sensitive-input redaction: PASS.
- Rename persistence across direct Save, Delay edit, Raw JSON apply, Undo/Redo, export and editor reopen; normalized name collision policy; actual command inventory; explicit cross-origin copy/replace/cancel rebind; 5.1-second sticky mismatch error plus Diagnostics; and responsive 640→400 px playback: PASS.
- Regression-runner teardown: Phase 2, Phase 3 and Phase 5 now request CDP `Browser.close`, use bounded process-tree fallback only when needed, release temporary profiles best-effort, exit `0`, and leave `0` scoped test-browser processes after PASS.
- Round 3 frame-aware parity: destination Recorder and Rebind both resolved `canvas / #gameframe ::frame:: #canvas`; Copy and Replace passed, destination geometry refreshed to `640×360 @ DPR 1`, normalized events stayed unchanged, export/import retained portable metadata, runtime IDs remained absent, and playback produced an observable iframe-canvas effect.
- Round 3 negative matrix: missing frame, missing canvas, non-iframe boundary, surface-kind mismatch and zero rect remained fail-closed with diagnostic subreasons.
- Popup auto-close regression: successful Record closes only after `RECORDING`; selected macro Play and Last Recording Play close only after `RUNNING`. No target, permission denied, origin mismatch, playback conflict, and any non-acknowledged state keep the popup open. Pause/Resume/Stop/Cancel and editor-tab behavior are unchanged.

## Manual User Validation

The user reported successful recorder and playback daily smoke on:

- Billionaire Casino — Canvas/WebGL-heavy application.
- YouTube — modern SPA/dynamic application.
- Google Translate — form/text-heavy application.

Clean Profile B independently requested permissions for the same sites and then replayed imported/restored macros. The later final visible Chrome popup success/failure smoke closed the separate USER DAILY-USE ACCEPTANCE gate.

The user also observed three macros running concurrently in three separate Chrome sessions for `1h07m` real wall-clock time. All three were still running when the user returned. This manual evidence is recorded separately from the accelerated automated soak.

In real Google Chrome, a Billionaire source macro was played against a Huuge target after explicit origin-mismatch rebind. The user observed an actual gameplay effect on Huuge, not only scheduler state or event counters. No hostname-specific production branch was added.

## Issues Found

| ID | Severity | Summary | Status |
|---|---|---|---|
| DUI-001 | P1 | Rapid popup lifecycle and Pause/Resume could race offscreen acknowledgement, producing `INVALID_PLAYBACK_TRANSITION`. | FIXED / VERIFIED |
| DUI-002 | P1 | Rename followed by Save could restore the stale editor name. | FIXED / VERIFIED |
| DUI-003 | P1 | Name collisions were inconsistent across macro creation entry points. | FIXED / VERIFIED |
| DUI-004 | P2 | Commands were not fully connected or transparently reported with Chrome constraints. | FIXED / VERIFIED; Current + Recommended UX |
| DUI-005 | P1 | Rebind first replaced the canvas contract with `viewport/html`; after Round 2 it could still misclassify an iframe-realm canvas as `container`. | FIXED / VERIFIED; REAL CHROME BILLIONAIRE→HUUGE OBSERVABLE EFFECT |
| DUI-006 | P2 | Editor polling replaced the actionable error before it could be read. | FIXED / VERIFIED |
| DUI-007 | Investigation | Reported free-resize stop candidate. Automated 640→400 px reproduction completed without error. | NOT REPRODUCED / MONITORING |

Confirmed issue counts: P0 found/open `0/0`; P1 found/open `4/0`; P2 found/open `3/0`; P3 found/open `1/0`. `DUI-007` is an investigation record, not a confirmed product issue.

## Issues Fixed

`761a542 fix: stabilize rapid playback pause resume`

The offscreen scheduler no longer mutates `PAUSED` before publishing the transition. Pause, Resume and Stop accept already-pending equivalent control states idempotently. A 50-cycle unit race regression and 25-popup E2E lifecycle regression cover the bug class.

`2efa6e5 fix: harden phase 6b daily use workflows`

Round 1 fixes editor/library rename synchronization, canonical normalized unique-name enforcement, real command handlers, explicit current-site rebind, sticky actionable errors plus Diagnostics retention, and their browser regressions. Existing duplicate records are preserved; no destructive startup migration was added.

`4ace7a1 fix: fail closed on incompatible rebind surfaces`

Round 2 preserves the source portable surface contract during cross-origin rebind, resolves the destination canvas/frame chain through the normal playback locator path, and rejects missing or incompatible surfaces before saving.

Round 3 fixes the remaining false negative: cross-realm `instanceof HTMLCanvasElement` classified a correctly resolved iframe canvas as `container`. Realm-neutral tag semantics and owner-document frame traversal now keep Recorder, Playback and Rebind on the same portable surface contract. Internal rebind diagnostics include a bounded step trace and stable failure subreason; normal UI retains `REBIND_SURFACE_INCOMPATIBLE`.

`edb1c6f fix: align rebind surface resolution with recorder`

`bd3a03d test: cover frame-aware cross-origin surface parity`

`ceb393a ui: show current and recommended shortcuts`

Settings now separates Chrome's actual command assignments from the recommended Jitbit-style mappings and keeps the Chrome shortcut settings entry point.

`aa30615 test: make browser runner teardown deterministic`

Phase 2, Phase 3 and Phase 5 runners now close through CDP first, use bounded fallback cleanup, release temporary profiles best-effort and leave no scoped browser processes after successful runs.

## Open Issues

Open confirmed P1: **none**. `DUI-005` is closed by the real Google Chrome Billionaire→Huuge explicit-rebind observable-effect acceptance.

Other remaining gaps are validation evidence or monitoring:

- Separate-window foreground-workflow manual evidence.
- Full visible permission remove/regrant repetition during Phase 6B.
- Resize candidate `DUI-007` remains monitoring until a diagnostic-backed reproduction exists; the automated responsive case passed.
- Direct CPU/process-memory sampling in an environment that exposes usable metrics.

## Compatibility Findings

- No site-specific hostname branch or production hack was added.
- Background DOM pointer playback remained operational.
- Hidden CDP wheel continued to fail deterministically with `CDP_TARGET_HIDDEN` instead of hanging.
- Same-origin reload/redirect and SPA `pushState` continuity remain PASS from Phase 5 regression.
- Cross-origin navigation remains fail-closed and clears the pinned target.
- Exact runtime tab routing does not jump to a similar same-origin tab.

## Performance/Soak

Automated accelerated soak:

- Final run duration: `209,655 ms` (~3m 29.7s)
- Iterations: `5,000`
- Inputs processed: `100,000`
- Retained evidence rows: `1,000`
- Bounded dropped evidence rows: `99,000`
- Local storage serialized-size delta: `-4 bytes`
- Post-soak offscreen contexts: `1` (the bounded reusable scheduler context)
- Terminal debugger sessions: `0`

No linear local-storage growth, debugger leak or duplicate offscreen instance leak was observed. CPU/process-memory metrics were unavailable from the headless target and are therefore `NOT MEASURED`. Separately, the manual >1-hour real-site observation passed without blocking or moving Windows input.

## Release Readiness

- P0 open: `0`
- P1 open: `0`
- Chrome primary real-site smoke: PASS by user on three site classes.
- Edge Chromium automated stress: PASS.
- Portability, permissions boundary and privacy: PASS with explicit partial rows in the checklist.
- Full final Phase 1–6B functional assertions: **PASS**; Phase 2/3/5 runners exit cleanly with no scoped browser orphan. Final package evidence is refreshed during GitHub preparation.
- Automated Phase 6B Round 3 ready: **YES** — remaining `NOT TESTED/PARTIAL` rows are explicit non-blocking/manual evidence gaps.
- Version remains `0.6.0`; `zui-macro-recorder-for-chrome-0.6.0.zip` was produced and its 29-file runtime-only package audit passed.
- Final visible Chrome popup Record/Play success and error/recovery smoke: **PASS**.
- Overall status: **USER DAILY-USE ACCEPTANCE PASS**.
- Release channel: **0.6.0 internal beta**; no stable or `1.0.0-rc.1` tag is created by this publication.
- Phase 6B COMPLETE: **YES**.
