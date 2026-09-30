# ZUI Macro Recorder for Chrome

ZUI Macro Recorder for Chrome is a local-first Manifest V3 extension for recording, editing, and replaying macros inside user-selected Chrome tabs. Playback does not move the real Windows mouse or type through Windows keyboard APIs.

> Current channel: **0.6.0 internal beta**. The final visible Chrome popup smoke and daily-use acceptance passed. There is no Chrome Web Store listing yet.

## Overview

ZUI records explicit delays and browser input events into a versioned, editable JSON macro. Mouse positions are stored as target-relative `[0,1]` coordinates, so macros do not depend on desktop coordinates. A destination profile must select its own target tab and grant its own site permission; profile, account, tab, window, cookie, and session state are not portable data.

## Features

- Tab-scoped recording and playback for standard DOM, canvas, and compatible frame surfaces.
- Visual and raw JSON editing with validation, undo/redo, event reordering, and bulk delay editing.
- Playback speed, repeat count, infinite loop, loop delay, Pause, Resume, Stop, and safe Step.
- Single-macro import/export and versioned full-library backup/restore.
- Cross-profile portability without serialized runtime identity or Chrome permissions.
- Explicit cross-site rebind with Copy and Replace choices; no silent automatic rebind.
- Per-site optional permissions, redacted diagnostics, and sensitive-input fail-closed behavior.

## How it works

The recorder captures browser events inside the selected tab. Pointer events use DOM/Pointer dispatch; specific keyboard, text, select, and wheel classes use the Chrome debugger/CDP input path. Playback uses the current target geometry to convert normalized coordinates back to CSS pixels. There is no native Windows mouse or keyboard injection.

## Installation

### Release ZIP

1. Download `zui-macro-recorder-for-chrome-0.6.0.zip` from the GitHub Release.
2. Extract the ZIP to a permanent local folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted extension folder.

This project is not currently distributed through the Chrome Web Store.

### Repository development install

1. Install Node.js 24 (Node.js 22+ is supported).
2. Run `npm install --ignore-scripts --package-lock=false`.
3. Run `npm run build`.
4. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/extension`.

## Quick start

1. Open the page you want to control.
2. Open the extension popup and select **Select current tab**.
3. Grant access only for that site if Chrome asks.
4. Enter a macro name and select **Record**. After Chrome acknowledges `RECORDING`, the popup closes.
5. Perform the harmless actions you want to capture, reopen the popup, and select **Stop**.
6. Review the macro in **Library & Editor**, then play it against the explicitly selected target. After Chrome acknowledges `RUNNING`, the popup closes.

Start failures keep the popup open and show a recovery message and technical code.

## Recording

Recording supports explicit delays, mouse down/up/wheel, optional mouse movement, key down/up, and supported text/IME events. Keyboard and mouse capture can be enabled independently. Password, OTP, token, and similar sensitive inputs fail closed.

## Editing

The visual editor and raw JSON editor operate on the same canonical macro. Events can be added, edited, moved, duplicated, or removed. Invalid fields, duplicate event IDs, runtime identity, or backend-coupled fields block save/export.

## Playback

Playback is limited to the pinned target tab. The macro origin and portable surface contract must match unless the user explicitly rebinds it. Hidden-tab CDP operations and incompatible targets fail closed instead of silently falling back.

The editor is a full Chrome tab and never auto-closes after Record or Play. Popup auto-close applies only to successful popup Record/Play starts.

## Loop / Pause / Step

- Speed: `0.5×` to `5×`.
- Repeat: finite counts or `0` for infinite looping.
- Loop delay: applied between iterations.
- Pause/Resume: preserves remaining delay and held-input safety.
- Stop: releases held inputs and ends the active run.
- Step: advances only across a safe input boundary.

## Import / Export

Single macros use validated JSON. Full-library backups use `backupSchemaVersion: "1.0"` and explicit Keep Both, Replace, or Skip conflict handling. Real user exports are private artifacts and must not be committed to the repository.

## Cross-profile portability

Portable macros exclude Chrome profile IDs, account data, `tabId`, `windowId`, cookies, tokens, debugger sessions, and held runtime input. Site permission and target selection remain local to each Chrome profile. After import or restore, select and authorize the destination tab again.

## Per-site permissions

The release manifest has zero required host permissions. HTTP/HTTPS access is optional and requested for the selected site from a direct user gesture. Settings shows grants owned by the current Chrome profile and lets the user remove them when no recording or playback is active.

## Cross-site explicit rebind

When a macro recorded for Site A is played against Site B, ZUI stops on origin mismatch. The user can choose:

- **Rebind a Copy to This Site** — recommended; preserves the original macro.
- **Rebind This Macro** — replaces the macro target contract.

There is no silent automatic rebind. The destination must expose a compatible visible surface; otherwise rebind fails with `REBIND_SURFACE_INCOMPATIBLE`. The generic frame-aware pipeline has been manually verified with a Billionaire source macro rebound to Huuge and an observable gameplay effect, without hostname-specific production code.

## Keyboard shortcuts

Recommended manual mappings:

- Play / Pause / Resume: `Ctrl+Shift+P`
- Stop Playback: `Ctrl+Q`
- Step: `Ctrl+Alt+F10`
- Start / Pause / Resume Recording: `Ctrl+Alt+R`
- Abort Recording: `Ctrl+Alt+Q`

Chrome may leave some commands unassigned or reject a suggested mapping because of platform conflicts. Configure them at `chrome://extensions/shortcuts`. Settings reports Chrome's actual current assignment separately from the recommendation.

## Privacy & security

- Local-first: no telemetry and no cloud sync.
- Required host permissions: zero; optional site access is requested per site.
- The debugger permission is used only for documented input classes.
- Sensitive input recording and playback fail closed.
- Portable macros do not include runtime tab/window IDs or Chrome-profile authority.
- Site grants remain Chrome-profile-local.
- No Windows mouse/keyboard automation APIs are used.

The extension interacts with page content to record and replay events, so it can access the selected page within the granted site scope. Review macros before sharing them. See [SECURITY.md](SECURITY.md) for safe reporting.

## Known limitations

- Closed Shadow DOM is not addressable.
- Cross-origin iframe boundaries can block portable surface resolution.
- Some CDP input classes fail closed when the target tab is hidden.
- Native IME composition and dead-key/layout edge cases require target-specific validation.
- Site `isTrusted` checks, anti-automation policies, or UI redesigns can reject otherwise valid events.
- Responsive resize is covered by normalized geometry tests; `DUI-007` remains monitoring-only unless a diagnostic-backed reproduction appears.
- Native desktop applications and browser chrome are out of scope.

## Troubleshooting

- `NO_PINNED_TARGET`: select the intended tab.
- `SITE_PERMISSION_REQUIRED` / `SITE_PERMISSION_DENIED`: grant access from a direct popup action.
- `MACRO_TARGET_ORIGIN_MISMATCH`: select the source site or use explicit Copy/Replace rebind.
- `SURFACE_NOT_FOUND` / `REBIND_SURFACE_INCOMPATIBLE`: verify that the destination exposes a compatible visible surface.
- `CDP_TARGET_HIDDEN`: bring the target tab to the foreground and retry.
- `PLAYBACK_ALREADY_ACTIVE` / `RECORDING_ALREADY_ACTIVE`: stop the current operation first.

Diagnostics are redacted by design, but review every exported report before sharing it.

## Development

Run `npm run check` for JavaScript syntax validation and `npm test` for unit/contract coverage. Browser suites are available as `test:phase2` through `test:phase6b`; they use isolated temporary profiles and synthetic fixtures. Real-site actions, visible Chrome permission prompts, and user acceptance remain manual release gates.

## Tests

- Phase 2: recorder, permissions, DOM/canvas and lifecycle.
- Phase 3: Record → Edit → Save → Export → Import → Replay.
- Phase 4: speed, repeat, loop, pause/stop, step, held-input cleanup.
- Phase 5: portability, recovery, geometry, Unicode, stress, corruption, upgrade.
- Phase 6A/6B: packaged UX, naming, shortcuts, rebind, diagnostics, soak, and teardown.

Detailed results are in [docs/PHASE_6B_RESULTS.md](docs/PHASE_6B_RESULTS.md) and the [daily-use checklist](docs/DAILY_USE_VALIDATION.md).

## Release/package verification

Run `npm run package`. The pipeline creates `dist/extension`, audits the complete runtime file list, rejects user/profile/diagnostic content, and writes `release/zui-macro-recorder-for-chrome-0.6.0.zip`.

The published repository starts from a sanitized snapshot history. The original development history and private local `storage/` content are not part of the public repository. Release evidence and publication metadata are tracked in [docs/GITHUB_RELEASE_PREP.md](docs/GITHUB_RELEASE_PREP.md).

## License

Copyright © 2026 Simulate-X. Released under the [MIT License](LICENSE).
