# Phase 5 Hardening Contract

Phase 5 keeps the canonical macro and backend split unchanged. `OFFSCREEN_DOCUMENT` owns timing; pointer/mouse/canvas uses `DOM_SYNTHETIC`; keyboard/text/IME/wheel uses explicit `CDP_INPUT`. There is no content-script scheduler or backend fallback.

## Recovery matrix

| Trigger | Terminal behavior | Cleanup and recovery |
|---|---|---|
| Service-worker restart during playback | `STOPPED/service_worker_restarted` | Offscreen receives Stop without a startup-message deadlock; held inputs are released; debugger sessions are detached. |
| Extension reload during playback/recording | session storage becomes `IDLE` | Local macros remain. The target page must reload so the new content script is present, then it is pinned again. Next playback is accepted. This differs from an ordinary worker suspension/restart. |
| Offscreen loss | `ERROR/OFFSCREEN_LOST` | Runtime cleanup events are attempted, debugger sessions detached, no scheduler fallback is used. |
| Target tab close | `STOPPED/TARGET_CLOSED` | Active work stops and the pin is removed. |
| Cross-origin navigation | `STOPPED/TARGET_NAVIGATED` | Recorder/playback stops and the pin is removed. |
| Same-origin reload/path/redirect/SPA route | pin remains origin-scoped | Granted permission remains; the idempotent content runtime is re-injected if needed and every event resolves the current surface again. |
| Site permission removed | `SITE_PERMISSION_REQUIRED` on the next operation | Active removal from Settings is blocked; external removal stops active work, detaches CDP and clears the pin. |
| Long/infinite playback stopped | Stop waits for terminal `STOPPED`; retained result evidence is capped at 1,000 rows | Total `eventsExecuted` remains accurate and excess evidence is counted in `rowsDropped`. |
| CDP attach conflict or command failure | `ERROR` with normalized code | Held inputs are compensated; all tracked debugger sessions are detached; a corrected target can immediately retry. |
| Popup/editor close or ordinary worker restart during recording | live session continues | UI is only a client. Worker startup probes the pinned content script for the same active `sessionId`; reopening restores recorder state, elapsed time and macro name. |
| Missing or mismatched recorder on worker start | `IDLE/service_worker_restarted` | The persisted session is stale; capture is disabled in every known frame and a diagnostic is recorded. |

Terminal offscreen close is bound to the playback `sessionId`. An old session's delayed close callback must not close a newly created scheduler. This rule fixes the Phase 5 rapid-replay race found by the regression suite.

## Geometry and surface rules

Playback resolves the locator and calls `getBoundingClientRect()` for every input. CSS client coordinates—not screen/device pixels—are produced from the current normalized point. Tests cover 80/100/125/150/200 percent CSS zoom, DPR 1/1.25/1.5/2, transform, actual letterboxed canvas, horizontal/vertical scroll, multiple canvases and DOM replacement.

Stable surface selection prefers an element ID, then `[data-zui-surface]`, then a local `nth-of-type` qualified by a parent ID where available. Open Shadow DOM uses the explicit `host >>> descendant` locator. Same-origin iframe paths use `iframe-selector ::frame:: descendant`; runtime `frameId` is used only while recording and is never exported. Cross-origin traversal is rejected as `CROSS_ORIGIN_FRAME_UNSUPPORTED`.

Closed Shadow DOM and cross-origin iframe DOM traversal remain unsupported. Browser fullscreen was not automatable in the headless acceptance runtime; playback still re-resolves geometry after any layout change.

## Concurrency and fail-closed guarantees

Only one playback and one recorder may exist, and they cannot overlap. Target changes are rejected while either is active. Delete is rejected during active recording/playback. Imported files are fully validated before storage mutation. Corrupt stored rows are quarantined while valid rows remain available.

No fault path sends Windows input. Cleanup is limited to extension DOM events and CDP commands on the pinned tab.

The release manifest has no broad required host permission and no static content-script matches. Broad HTTP/HTTPS patterns exist only in `optional_host_permissions`; the popup requests an exact site pattern from a direct user gesture. Injection is target-only and guarded by `__ZUI_CONTENT_RUNTIME__`, preventing duplicate listeners.

## Timing, sleep and clocks

The scheduler uses `performance.now()` and controlled remaining-delay slices. Wall clock is metadata/UI only. A service-worker restart stops playback. Extension reload/browser shutdown clears runtime session state; local macros remain. Actual Windows sleep and a full browser-process restart were not automated; the defined wake policy is fail-closed on missing/stale scheduler rather than silent timing degradation.
