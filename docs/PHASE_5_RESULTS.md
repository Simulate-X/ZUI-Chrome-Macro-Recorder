# Phase 5 acceptance results

Date: 2026-09-24. Version: `0.5.0`. Automated runtime: Microsoft Edge Chromium headless with isolated temporary profiles and release-built unpacked extension. Exact-browser acceptance runtime: visible Google Chrome with two separate user profiles and manually loaded release extension.

## Passed automated gates

- Real Profile A → downloaded `.zui-macro.json` → Profile B import/rebind/replay passed. Export contained no runtime identity. Duplicate import visibly became `(2)`.
- Service-worker termination stopped active playback with `service_worker_restarted`; offscreen termination produced `ERROR/OFFSCREEN_LOST`; injected debugger attach conflict produced `CDP_ATTACH_FAILED`, zero tracked sessions and successful immediate retry.
- Real extension reload during playback returned a safe runtime state, preserved both local macros and allowed the next playback after target-page reinjection. Recorder reload returned `IDLE` and preserved the library.
- Same-origin SPA route, reload and redirect completed. Cross-origin navigation stopped as `TARGET_NAVIGATED`. Phase 4 target-close regression remained green.
- 80/100/125/150/200 percent zoom and DPR 1/1.25/1.5/2 preserved normalized CSS-coordinate mapping. Transform, letterboxed actual canvas, scroll, two canvases, replaced canvas, open Shadow DOM and same-origin iframe passed. Cross-origin iframe rejected explicitly.
- Exact CDP text result passed for `çÇğĞıİöÖşŞüÜé€🙂`. Password, OTP and token targets all rejected text insertion.
- 50,000-event validation completed in the unit gate. A real 10,000 zero-delay playback completed with cooperative yield; 1,000 iterations executed 2,000 inputs with no debugger residue and at most one offscreen context.
- Corrupt storage isolated one bad row and retained valid macros. Forbidden imported origin was atomically rejected. Phase 4 storage from commit `476b119` survived an in-place path upgrade to `0.5.0`.
- `npm run build` produced `dist/extension`; `npm run package` produced `release/zui-macro-recorder-0.5.0.zip` plus a package audit. Tests, temp profiles, user macros, logs, node_modules and Git data are excluded.
- Popup close and an actual MV3 service-worker termination preserved a live recorder session only when the same content-script session answered the liveness probe. Reopened popup restored both `RECORDING` and the entered macro name; a real click was captured and the stopped result remained valid. Missing/mismatched content state still resets fail-closed.

## Passed exact Google Chrome manual gates

- Profile A recorded `Phase 5 DOM Portability`, retained that name after popup close/reopen, stopped with 8 rows / 4 input events / `VALID`, and exported `Phase_5_DOM_Portability.zui-macro.json`.
- Profile B used its separately reloaded extension/library, imported the file as the same 8-event macro, pinned `http://127.0.0.1:4173`, set `DOM toggle: OFF`, and replayed it. The editor reported `COMPLETED`, event `8 / 8`, iteration `1 / 1`, `00:00:06`, and `Replay complete: 4 input events`; the target visibly changed to `DOM toggle: ON`.
- Native Chrome zoom was checked at 80/100/125/150/200 percent. The measured DPR values were 1.2/1.5/1.875/2.25/3, while the requested normalized point remained `(0.25, 0.75)` within subpixel tolerance across the changing viewports.
- A hidden native-CDP wheel target failed closed as `CDP_TARGET_HIDDEN` at the five-second command deadline and detached cleanly. The earlier indefinite `RUNNING/STOPPING` behavior was not reproduced after the fix.

Machine-readable evidence is in `test-results/phase-5.json` and `dist/package-audit.json`.

## Explicitly limited or not automated

- Fullscreen/window maximize, real Windows sleep, wall-clock OS mutation and a full browser-process restart were not automated in headless mode. Timing uses monotonic clocks; missing offscreen state fails closed.
- Dead-key and physical Turkish-Q layout behavior were not claimed. Text intent uses CDP `Input.insertText`; key events preserve `key` and `code` separately.
- `ime` currently inserts its canonical value through CDP. Native OS IME compositionstart/update/end generation was not automated and is not claimed.
- Clipboard permission/paste was intentionally not added; CDP text insertion is sufficient and sensitive targets remain blocked.
- Closed Shadow DOM and cross-origin iframe traversal are unsupported. The latter returns `CROSS_ORIGIN_FRAME_UNSUPPORTED`.
- Real quota exhaustion/write-failure and browser-blocked-download injection were not reliably available through the release surface. Storage writes are single-key atomic and return `STORAGE_WRITE_FAILED`; export leaves editor state untouched and remains retryable.
- The accelerated stress suite replaces a 10–30 minute wall-time soak. Long recording is covered by sampling/unit behavior rather than a multi-minute interactive run. These remain pre-1.0 operational soak items.

## Decision

Phase 5 acceptance is green. The automated Edge Chromium generic/local matrix covers recovery, failure injection, navigation, Unicode, corruption, stress, upgrade and package integrity; the visible exact Google Chrome runs close the required two-profile portability and 80/100/125/150/200 native-zoom gates with observable target state. Version `0.5.0` is accepted for the Phase 5 scope. This does not claim production `1.0`, native OS IME composition, physical dead-key layouts, full Windows sleep/process-restart soak, closed Shadow DOM, cross-origin iframe traversal or site-specific Huuge compatibility.
