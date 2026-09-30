# Phase 4 acceptance results

Date: 2026-09-24. Runtime: Microsoft Edge Chromium headless with an isolated profile and the unpacked MV3 extension.

## Automated evidence

- Unit suite: 61/61 passed. Twenty Phase 4 tests cover state transitions, canonical playback-default dirty/undo behavior, unsupported settings rejection, speed, repeat/infinite defaults, remaining delay, held mouse/key/drag tracking, boundaries, safe click/keyboard/drag/wheel/delay units, unmatched rejection, play-from-here, compensating releases, snapshot isolation and 1000 zero-delay analysis.
- Speed for a canonical 200 ms delay: 0.5x `401.1 ms`, 1x `201.3 ms`, 2x `101.4 ms`, 5x `40.6 ms`. The source `durationMs` remained 200.
- Repeat 1/3/10 executed 2/6/20 click input events. Repeat 3 also exercised 100 ms loop delay.
- Delay pause retained about `336.0 ms`; mouse-held pause stopped after mouseUp at index 2; keyboard pause and drag pause reached zero held inputs. Loop-delay pause retained about `458.8 ms`.
- Stop during held mouse, held keyboard and drag produced `STOPPED` with zero held inputs; loop-delay Stop also completed as `STOPPED`. Target close produced `TARGET_CLOSED`. A sensitive-field CDP text rejection produced `ERROR/SENSITIVE_INPUT_BLOCKED`, emitted cleanup and left zero held inputs.
- Safe click step expanded events 1–3. Unsafe Play From Here was rejected with previous/next safe boundaries; safe event 4 start completed.
- Infinite loop was manually stopped at iteration 10.
- Canvas drag paused safely, resumed and changed bitmap hash (`3f44a17c` → `7aa65272`). MUI accordion repeat 2 executed four inputs and returned to its initial expanded state.
- CDP text inserted `phase4`; CDP select moved index 0→1. No debugger session remained.
- Editor UI persisted 2x, repeat 3 and 100 ms loop delay, marked dirty/saved, preserved the defaults through JSON round-trip and exported no runtime fields. `STEP NEXT` advanced selection from event 1 to event 2. Headless Chrome truthfully reported both global shortcuts as unassigned.
- Hidden target reported `document.hidden=true` and `visibilityState=hidden`; 1x 100 ms delay measured `111.3 ms`, three 2x iterations executed six inputs, and hidden infinite playback stopped manually.
- 1000 zero-delay events completed in `7.1 ms` with cooperative yielding. A 100-iteration run executed 200 inputs with correct final counter and no CDP residue.
- Phase 2 recorder/backend regression and Phase 3 Record→Edit→Export→Import→Replay regression passed after the new engine was installed.

## Deliberate limits

`stopOnError=false` is stored for format compatibility but rejected at runtime because safe continue-on-error semantics are not implemented. Global Step is not advertised because Chrome commands cannot reliably carry the editor's selected row; F10 is editor-local. Same-origin navigation follows the existing target contract; cross-origin navigation stops. This phase does not add schedules, conditional logic, cloud/native helpers, multi-target playback or site-specific Huuge behavior.
