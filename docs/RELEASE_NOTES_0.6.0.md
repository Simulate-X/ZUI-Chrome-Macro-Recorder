# ZUI Macro Recorder for Chrome 0.6.0 — Internal beta

This internal beta is the first public GitHub snapshot of ZUI Macro Recorder for Chrome. It is a local-first Manifest V3 extension for recording, editing and replaying macros inside an explicitly selected Chrome tab without taking over the Windows mouse or keyboard.

## Highlights

- Record, pause, resume and stop browser interactions from the popup.
- Edit canonical macro events visually or as validated JSON.
- Replay with speed, repeat, loop delay, pause, stop and safe-step controls.
- Import/export individual macros and versioned library backups.
- Move macros between Chrome profiles without carrying profile, account, tab, window, cookie, permission or session state.
- Rebind a copy or replace a macro explicitly when moving between compatible sites; incompatible surfaces fail closed.
- Request site access only for the selected HTTP(S) site; the release manifest has zero required host permissions.
- Keep successful popup Record/Play starts concise by closing after acknowledgement, while failures keep recovery UI visible.

## Privacy and safety

The public repository starts from a new sanitized snapshot history. The original development history, local `storage/` directory, real macro exports, diagnostics, temporary browser profiles and user screenshots are not included. Sensitive inputs fail closed, diagnostics are redacted, and the extension uses no native Windows input injection.

## Verification

- Static syntax checks: PASS (40 JavaScript files).
- Unit and contract tests: PASS (113/113).
- Automated Phase 2, 3, 4, 5, 6 Edge and 6B suites: PASS.
- Phase 6B accelerated soak: PASS (5,000 iterations, 100,000 inputs, zero debugger sessions at completion).
- Package audit: PASS (29 runtime files; no user/profile/diagnostic content).
- Final visible Google Chrome popup success and failure/recovery smoke: PASS by user.

Headless Google Chrome does not start the unpacked extension worker reliably in this environment, so the automated Chrome branch of the Phase 6 matrix remains an environment limitation rather than a product PASS. The corresponding visible Google Chrome user smoke passed.

## Package integrity

- ZIP: `zui-macro-recorder-for-chrome-0.6.0.zip`
- Size: `69,542` bytes
- SHA-256: `298BC12262FD12A0240FE34F87CC4CAEFA3C80A00E2A45A93F5ACF83B7D525F4`

## Install

Download `zui-macro-recorder-for-chrome-0.6.0.zip`, extract it to a permanent folder, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted extension folder.

This is an internal beta, not a production-stable or `1.0.0-rc.1` release. There is no Chrome Web Store listing yet.
