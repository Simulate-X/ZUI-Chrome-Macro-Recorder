# Phase 6A results — productization and internal beta preparation

Date: 2026-09-25
Baseline: `6dfc561 feat: harden phase 5 portability and edge cases`
Version: `0.6.0` internal beta

## Acceptance gates

| Gate | Result | Evidence |
|---|---|---|
| Google Chrome Full Product UI | **PASS** | Installed Google Chrome `153.0.8010.53`; fresh-profile onboarding, popup, target selection, record/pause/resume/stop, library/editor save, replay/pause/resume/stop, single export, full backup, settings and diagnostics were exercised in the visible GUI. |
| Full Library Cross-Profile Restore | **PASS** | Profile A exported three macros; separate Profile B restored them, explicitly rebound `http://127.0.0.1:4173`, and replayed Standard DOM with the visible button changing `OFF` → `ON`. Keep Both produced six macros; Replace and Skip kept the total at six without silent duplication. |
| Chrome Manual Visual/Focus Smoke | **PASS** | Popup, onboarding, library, editor and settings were inspected in visible Chrome. No clipping, overlap or horizontal overflow was observed. Tab/Shift+Tab focus, keyboard activation and Escape dismissal passed. |

## Manual product evidence

- First-run onboarding opened automatically and presented the four-step workflow, Windows-input boundary, debugger explanation, Skip and Finish actions. Finish did not loop; Settings could reopen onboarding.
- The popup exposes Target, Recording, Playback and quick actions. The 520 px layout keeps the four recording controls on one row without horizontal scrolling.
- `Phase 6A Chrome Daily` recorded 64 rows, survived popup close/reopen, paused/resumed, saved an edited 500 ms delay and 4× speed, then completed 64/64 with 32 inputs in 20 seconds. Manual Stop also ended safely.
- Library card metadata, validation badges, Edit, Play, Rename, Duplicate, Export, Delete, case-insensitive search, Name sorting in both directions and Recent were exercised.
- `Phase 6A Standard DOM` replay produced the required visible DOM state change. Acceptance exposed and fixed two recorder defects: polling no longer overwrites an idle macro-name draft, and an ignored clicks-only hover no longer locks the wrong recording surface.
- Settings labels and controls, Save, backup/diagnostic exports, Chrome shortcut settings, `Not assigned`, security text, `0.6.0 / Internal beta`, and onboarding reopen were exercised.
- Clearing the selected target produced a friendly `Select a target tab first` message with technical code `NO_PINNED_TARGET` and a `Select current tab` recovery action.

## Full-library privacy evidence

A private user-owned backup was used for the historical acceptance run. Its filename, macro inventory, size, hash, and contents are intentionally omitted from the public tree. The validated backup schema was `1.0`, and the privacy check found no profile/account, tab/window identity, cookie, token, debugger session, held-input, or runtime-backend fields. No user backup is retained in the public-ready tree or release package.

## Automated regression

- Unit/product regression: 104/104 passed, including Phase 6A.1 permission policy, denial, removal, unsupported-scheme, injection-lifecycle, atomic bulk-Delay editing and terminal Stop handling.
- Phase 1 PoC and visible Google Chrome Phase 1B: passed; Chrome product `153.0.8010.53`, unpacked service worker/content script and fail-safe lifecycle confirmed.
- Phase 2 recorder, Phase 3 editor, Phase 4 playback and Phase 5 portability/hardening: passed.
- Phase 5 retained two-profile portability, native zoom/DPR, hidden-CDP fail-fast, recovery and 1,000-iteration cleanup coverage.
- Phase 6A packaged Edge product/layout smoke: passed at 1024, 1366 and 1920 widths with no horizontal overflow.
- `git diff --check`, manifest/version validation, deterministic build and package audit passed.

## Release decision

Phase 6A is accepted for the `0.6.0` internal-beta package. Phase 6B daily-use validation has not started in this acceptance run. Therefore no `1.0.0-rc.1` or stable version is assigned.

## Phase 6A.1 — general website targeting

Phase 6A.1 removes the production test-origin allowlist. The release manifest has no broad required host access and no static content-script match. HTTP/HTTPS access is declared only as an optional capability; `Select current tab` requests one site-scoped Chrome match pattern from the user's direct gesture, then injects the guarded runtime only into that selected target and its same-origin frames.

Automated acceptance covers arbitrary HTTP/HTTPS origins, grant reuse, denial, unsupported schemes, target-only idempotent injection, same-origin reload/reinjection, cross-origin fail-closed behavior, permission removal and portable-serialization boundaries. The existing Phase 2–5 suites use a temporary test-only manifest with exact localhost grants so headless Chrome can exercise recorder/editor/playback without bypassing the production permission prompt.

Visible Google Chrome acceptance passed on `https://play.billionaire-casino.com`: after the user explicitly selected the tab, Chrome displayed the site permission prompt, permission was granted, and the popup showed `Billionaire Casino / https://play.billionaire-casino.com` as Selected. No Billionaire-specific bypass, selector or compatibility code was added. The user's subsequent harmless record/replay smoke was reported as operating normally.

The user also completed recorder and playback smoke tests on YouTube and Google Translate in visible Chrome without errors. Together with the Billionaire result, this confirms that general website targeting is no longer limited to the former test fixtures.

Clean Profile B acceptance also passed: after importing/restoring the portable macro library, each previously used site requested permission again before it could be selected. This confirms that site grants remain profile-local runtime authority and are not serialized into macros or library backups.
