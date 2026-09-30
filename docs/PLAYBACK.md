# Playback control contract

Phase 4 uses one playback engine. The offscreen document owns delay, loop-delay and pause timing; the service worker owns target validation, runtime status persistence and backend routing. Popup and editor are clients of the same session.

## State machine

`IDLE → RUNNING → PAUSE_PENDING → PAUSED → RUNNING`, with terminal `COMPLETED`, `STOPPED` or `ERROR`; Stop passes through `STOPPING`. Only one session may be active. The public session is stored in `chrome.storage.session`, survives UI closure and never enters exported JSON.

Playback takes an immutable deep clone of the validated macro. Editor changes made after Play affect only a later session. Target origin must match the pinned runtime target. Target close/navigation, dispatch rejection and sensitive-text preflight fail closed.

## Settings semantics

- `speedMultiplier` affects only canonical `delay` at runtime: `effectiveDelay = durationMs / speedMultiplier`. The stored event is never mutated. Editor choices are 0.25x–5x; no hidden clamp is applied.
- `repeatCount` is total executions. `1` means once, `10` means ten executions and canonical `0` means infinite.
- `loopDelayMs` occurs only between iterations, never after the last, and is not speed-scaled.
- `stopOnError` is saved and defaults to `true`. Phase 4 deliberately rejects `false`; unsafe continue-on-error is not implemented.

## Pause, resume and cleanup

The runtime tracker records held keys, mouse buttons, pointer position and drag state. Pause at a safe boundary freezes immediately. A request while input is held becomes `PAUSE_PENDING`; execution proceeds only through the matching release and pauses at the first safe boundary. A delay is sliced by the offscreen scheduler; elapsed time is removed and the remaining effective delay resumes without counting paused wall time. Loop delay uses the same control path but is not speed-scaled.

Stop and dispatch errors cancel pending waits and emit compensating keyUp/mouseUp events for tracked input before the terminal result. Runtime cleanup data exists only in session storage so a restarted service worker can recover a stale session; it is rejected by canonical macro validation/export.

## Safe step and start boundaries

A boundary is safe only when no key/button is held and no drag is active. `STEP NEXT` and `PLAY SELECTED` expand the selected raw row to its complete safe semantic unit—for example down/delay/up or keyDown/.../keyUp—and run that unit once, independent of saved repeat defaults. Step completion advances the editor selection to the next candidate unit. An unmatched down is rejected. `PLAY FROM HERE` requires the selected index itself to be safe and reports nearest safe boundaries when it is not. No silent boundary adjustment occurs.

## Routing and timing

Pointer/mouse/canvas remains `DOM_SYNTHETIC`; keyboard/text/IME/wheel remains explicit `CDP_INPUT`. There is no fallback between them. Sensitive active fields reject CDP text insertion. `OFFSCREEN_DOCUMENT` remains the timer owner while the target is hidden. Runs containing many zero-delay/disabled events cooperatively yield every 64 rows; canonical delays are not changed.

## Controls and shortcuts

Editor exposes settings, Play, Pause, Resume, Stop, Step Selected, Play Selected, Play From Here and live state/event/iteration/elapsed progress. Popup exposes active-session Pause/Resume/Stop. UI closure does not stop playback.

Chrome global commands are `toggle-playback` and `stop-playback`; actual assignments are read with `chrome.commands.getAll()`. Users customize them at `chrome://extensions/shortcuts`. The extension does not pretend to dynamically register arbitrary global keys. Editor-local shortcuts are F8 or Space for play/pause/resume, Escape for stop and F10 for safe step; input, textarea, select and contenteditable focus suppresses them.

## Result

Terminal runtime diagnostics contain state/reason/error code, iteration, event index, executed input count and duration. Key/text contents are not added to diagnostics. Results and active indices are not canonical macro fields.

## Phase 5 recovery

Service-worker restart active offscreen runı `service_worker_restarted` ile durdurur. Offscreen context kaybı `ERROR/OFFSCREEN_LOST` üretir; content-script timing fallback yoktur. Extension reload runtime sessionı temizler fakat local library'yi korur. Target sayfası yeni content script için reload edilip tekrar pinlendikten sonra sonraki playback normal çalışır.

CDP attach/detach/command hataları standardize edilir, event index ve iteration ile redakte tanıya yazılır ve tracked debugger set'i terminal hatada boşaltılır. Same-origin navigation güncel locator'ı yeniden çözer; cross-origin navigation pin'i temizleyip playback'i durdurur.
