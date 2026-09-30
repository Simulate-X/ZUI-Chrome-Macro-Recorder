# Phase 6B Daily-Use Validation

Date: 2026-09-25

Round 1 baseline: `81b8e4c docs: record phase 1 regression coverage`

Round 2 baseline: `3445743 docs: refresh phase 6b final evidence`

Version: `0.6.0` internal beta

`PASS` yalnız ölçülmüş kanıtı, `PARTIAL` matrisin bir kısmını, `NOT TESTED` ise henüz kanıt olmadığını gösterir. USER DAILY-USE ACCEPTANCE ayrı final kapısıdır.

| Validation | Result | Evidence / limit |
|---|---|---|
| Core Record → Pause → popup reopen → Resume → Stop → Save → Replay | **PASS** | Phase 6B clean-profile E2E; 4 canonical rows. |
| Real sites: Billionaire Casino | **PASS (manual)** | User reported recorder/playback normal after site-scoped permission. |
| Real sites: YouTube | **PASS (manual)** | User reported recorder/playback normal; no destructive/account action. |
| Real sites: Google Translate | **PASS (manual)** | User reported recorder/playback normal, including general web targeting. |
| Target switching | **PASS** | 21 cycles across three distinct origins; dispatch distribution 7/7/7. |
| Popup lifecycle | **PASS after DUI-001 fix** | 25 reopen + 5 rapid Pause/Resume cycles. |
| Popup auto-close | **PASS (unit + browser E2E)** | Record closes only after `RECORDING`; selected and Last Recording Play close only after `RUNNING`. No target, origin mismatch, permission denial, and playback conflict stay open with recovery; editor is unchanged. |
| Service-worker lifecycle | **PASS/PARTIAL** | Phase 5 playback fail-closed restart and live recorder reconstruction PASS; every possible paused-state suspension was not separately forced. |
| Extension reload | **PASS** | Phase 5 active playback/recording fail-closed; library preserved; next playback PASS. |
| Same-origin reload/redirect | **PASS** | Phase 5 E2E. |
| SPA navigation | **PASS** | Phase 5 `pushState` lifecycle E2E; visible YouTube smoke also passed. |
| Multiple windows | **NOT TESTED** | Exact-tab routing is proven; separate-window foreground workflow still needs manual evidence. |
| Multiple similar tabs | **PASS** | Same-origin Tab A replay changed only pinned Tab A; Tab B unchanged. |
| Hidden/background target | **PASS/PARTIAL** | DOM mouse playback ran in background; CDP wheel deterministically failed `CDP_TARGET_HIDDEN`; every CDP event subtype was not separately repeated. |
| Accelerated long-run playback | **PASS** | Final run: 5,000 iterations, 100,000 inputs, 209,655 ms; 1,000 retained rows, 99,000 bounded drops. |
| Real-time 30-minute soak | **PASS (manual, 1h07m)** | Three macros ran concurrently in three separate Chrome sessions for 1 hour 7 minutes real wall-clock time. All three were still running when the user returned. This is distinct from the automated accelerated soak. |
| Long recording stress | **PASS** | 1,000 trusted mouse inputs → 2,000 ordered canonical rows with explicit delays. |
| Realistic 5–15 minute mixed macro | **PASS (manual)** | Covered inside the reported >1 hour real-site session; recorder/playback remained usable during normal foreground work. |
| Large macro | **PASS** | 10,000-row playback; unit validator also covers 50,000 zero-delay rows. |
| Bulk Delay | **PASS** | 10,000 events / 5,000 delays; set 100 ms, undo, redo, export round-trip; non-delay rows unchanged. |
| Rename → Save | **PASS after DUI-002 fix** | Renamed value survived direct Save, Delay edit + Save, Raw JSON apply + Save, Undo/Redo + Save, export JSON and editor close/reopen. |
| Normalized unique macro names | **PASS after DUI-003 fix** | Trim + case-insensitive conflicts are blocked for direct save/rename; recorder, duplicate, import and Keep Both produce visible safe unique names; legacy duplicates are not destructively migrated. |
| Chrome commands | **PASS with platform constraints** | All five commands reach real state-machine actions. Settings reads Current from `chrome.commands.getAll()` and separately shows Recommended manual mappings. Clean automated Chromium reported Stop=`Ctrl+Q`; the remaining commands were `Not assigned`. |
| Cross-origin rebind | **PASS (automated + real Chrome manual)** | Destination canvas is resolved from the source portable locator and produces an observable fixture effect; incompatible surfaces fail before save with `REBIND_SURFACE_INCOMPATIBLE`. In real Google Chrome, a Billionaire source macro was explicitly rebound to Huuge and Play produced an observable gameplay effect. Copy preserves the original, Replace shares the same generic pipeline, and no hostname-specific production code exists. |
| Persistent editor errors | **PASS after DUI-006 fix** | Origin mismatch remained visible after 5.1 seconds with recovery actions; Diagnostics retained `ORIGIN_MISMATCH`. |
| Responsive resize playback | **PASS / NOT REPRODUCED** | Surface width changed 640→400 px; the current rect was remeasured and the visible normalized click completed. No error/root cause was produced, so no speculative engine change was made. |
| Rapid Play/Stop | **PASS** | 10 cycles. |
| Rapid Record/Cancel/Stop | **PASS** | 10 cycles; alternating IDLE/STOPPED terminal states. |
| Infinite loop + UI Stop | **PASS** | Stopped after iteration 10; no orphan debugger/offscreen state. Global shortcut stop remains manual. |
| Repeat / loop delay | **PASS** | Repeat 1/2/10/100 × loop delay 0/100/1000 ms; iterations and dispatch counts matched. |
| Playback speed | **PASS** | 0.5×/1×/2×/4×/5× runtime ordering; canonical 500 ms delay unchanged. |
| Edit during playback | **PASS** | Active immutable snapshot completed after source macro mutation. |
| Backup/restore stress | **PASS** | 40-macro synthetic backup; Keep Both/Skip/Replace counts consistent and portable. |
| Import/export round-trip | **PASS** | 10 JSON cycles; no semantic drift or runtime identity. |
| Profile portability | **PASS (manual + regression)** | Clean Profile B restored library, requested site permissions independently and replayed. |
| Permission removal/regrant | **PARTIAL** | Unit policy removal/regrant/fail-closed PASS; visible Settings remove then regrant has not been repeated in Phase 6B. |
| Settings persistence/reset | **PASS** | Reopen preserved changes; reset did not change library count. |
| Onboarding | **PASS (prior regression)** | Fresh/existing/manual reopen covered by unit and Phase 6A visible Chrome evidence. |
| Error recovery | **PASS/PARTIAL** | TARGET_NAVIGATED, OFFSCREEN_LOST, CDP attach/hidden, schema/privacy and retry paths passed; all listed errors were not re-induced in one Phase 6B run. |
| Privacy | **PASS** | Unicode text exact; password playback blocked; diagnostics contained no secret text. |
| Windows input independence | **PASS by architecture / manual observation** | Extension uses DOM/CDP only; user reported working in browser normally. No native input API exists. |
| Storage growth | **PASS** | 100,000-input playback changed local storage serialized size by -4 bytes (no growth). |
| Offscreen / CDP cleanup | **PASS** | Post-soak health: one reusable offscreen scheduler context (bounded by the single-context invariant), debugger sessions 0. |
| CPU / process memory | **NOT MEASURED** | Headless target returned no Performance metrics; no unsupported numeric claim. |

## Final gate

- Open P0: `0`
- Open P1: `0`
- Automated Phase 6B and real-site rebind acceptance: **PASS**; remaining `NOT TESTED/PARTIAL` rows are explicit non-blocking/manual evidence gaps.
- Final visible Chrome popup success/failure smoke: **PASS**.
- Overall status: **USER DAILY-USE ACCEPTANCE PASS**.
- Phase 6B COMPLETE: **YES**
