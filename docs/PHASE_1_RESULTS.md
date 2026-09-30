# Phase 1 Results

Date: 2026-09-23

Status: **CONTROLLED_DEMO_PASS / TARGET_BACKEND_OPEN**

## 1. Scope tested

The PoC uses a localhost-only Manifest V3 extension and a local canvas fixture with no account, purchase, bet, spin or irreversible action. Playback never calls Windows mouse/keyboard APIs. The browser runtime uses a temporary isolated profile that is removed after the test.

Implemented components:

- MV3 service worker with explicit target-tab pinning and origin binding;
- localhost-scoped content script;
- normalized coordinate conversion and fail-closed geometry checks;
- synthetic Pointer/Mouse and Keyboard dispatch adapter;
- recorder-side trusted coordinate capture hook;
- target-tab closed/navigation cleanup;
- safe canvas demo at two CSS sizes;
- background-tab timer measurement;
- JSON Schema plus semantic/privacy validation.

`chrome.debugger` is not requested by the manifest. The CDP input adapter was not implemented because DOM synthetic input succeeded on the controlled fixture; adding the stronger permission before a target proves it necessary would violate least privilege.

## 2. Automated evidence

Commands:

```text
npm test
npm run test:poc
```

Core result: **6 passed, 0 failed**.

Browser result (Microsoft Edge Chromium `153.0.4234.48`, isolated headless profile):

| Check | Result | Evidence |
|---|---|---|
| MV3 extension/content script | PASS | Service worker messaged the localhost target and received structured responses. |
| Synthetic pointer/mouse sequence | PASS on demo | Demo observed 10 pointer/mouse/click events. |
| Synthetic keyboard sequence | PASS on demo | Demo observed `keydown` and `keyup`. |
| Trusted-input status | EXPECTED LIMIT | `isTrusted === false`; target sites may reject these events. |
| Normalized resize mapping | PASS | Same requested point `(0.25, 0.75)` used at 640×360 and 960×540. |
| Observed resized point | PASS within 0.2% tolerance | `(0.249479, 0.748900)`; sub-pixel/client-coordinate quantization measured. |
| Target-tab closed fail-safe | PASS | Session target binding was removed after the tab closed. |
| Background timer | THROTTLED | 11 hidden samples; maximum extra delay approximately 912 ms in the recorded run. |

The first browser run also exposed that a 2 px CSS border makes `getBoundingClientRect()` report 644 px for a nominal 640 px canvas. The fixture now uses `outline`, which does not affect geometry. Production target resolution must explicitly decide whether the interactive surface is the border box, padding box or canvas content box.

## 3. Browser-runtime qualification

The installed branded Google Chrome accepted remote debugging but did not start the unpacked extension service worker when launched headlessly with `--load-extension`; that run timed out and is **not** counted as a product pass. The same extension and test completed in installed Microsoft Edge Chromium. This proves Chromium MV3 behavior in the controlled runtime, not exact target-site compatibility in the user's normal Chrome profile.

A manual unpacked-extension load in Chrome or a Chrome for Testing binary is still required for Chrome-specific qualification.

## 4. Playback approach decision

`DOM_SYNTHETIC` is the provisional adapter for ordinary DOM/local fixture support because it passed with lower permission cost. It is **not yet selected as the final game/canvas backend** because:

- all dispatched events are untrusted;
- the real target may use WebGL, framework-specific input, pointer capture or cross-origin frames;
- keyboard default actions such as native text insertion are not reproduced by `dispatchEvent`;
- the controlled demo explicitly listens for these events and therefore cannot prove a third-party target accepts them.

`CDP_INPUT` remains a gated fallback. It should be implemented only after a safe target-specific test demonstrates that DOM synthetic events are rejected or insufficient, and its `debugger` permission must be clearly explained to the user.

## 5. Background-tab finding

The content-script `setTimeout(100)` series experienced an approximately 912 ms maximum extra delay after the tab became hidden. This invalidates a naive playback design that assumes target-page timers retain foreground precision.

Before Phase 4, the scheduler owner needs a separate experiment (extension page/offscreen document/service-worker coordination, with measured drift). Input dispatch and scheduling are independent decisions: changing from DOM to CDP input does not automatically solve timer throttling.

## 6. Known limitations and risks

- CSS borders/padding/transforms can change the true interactive rectangle.
- Letterboxing requires an active-content rectangle, not necessarily the outer canvas rectangle.
- Responsive re-layout may move controls despite normalized coordinates.
- Browser zoom, `devicePixelRatio` and canvas backing-store dimensions remain unqualified.
- Same-origin and cross-origin iframe paths are untested.
- WebGL/canvas input acceptance on the intended target is untested.
- DOM keyboard events do not trigger all browser native default actions.
- Background timer precision is insufficient in the tested content-script context.
- Exact Chrome runtime qualification remains open.

## 7. Phase gate

The small vertical slice is successful for the controlled demo, but Phase 1's product gate is **not closed**. Do not claim Huuge/third-party canvas compatibility and do not make `DOM_SYNTHETIC` the sole production architecture yet.

Next safe work:

1. Manually load the unpacked extension in Chrome or run it in Chrome for Testing.
2. Inspect the intended target's frame/surface topology without triggering irreversible actions.
3. Test DOM synthetic input on a harmless control or non-transactional test account state.
4. If rejected, add the separately permissioned CDP adapter and repeat the same evidence matrix.
5. Only after that gate passes, begin Phase 2 recorder productization.

