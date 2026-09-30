# Contributing to ZUI Macro Recorder for Chrome

## Setup

Use Node.js 24 or a compatible Node.js 22+ release. Run `npm ci`, then load `dist/extension` from `chrome://extensions` only after running `npm run build`.

## Validation

Run `npm run check`, `npm test`, and `npm run build` before opening a change. Use the documented Phase 2–6B browser suites for changes that affect recording, playback, permissions, portability, or lifecycle behavior. Real-site compatibility and Chrome permission prompts remain manual gates.

## Expectations

- Keep the canonical macro schema portable and manually editable.
- Preserve target-relative coordinates and fail-closed safety behavior.
- Do not add hostname-specific production hacks. Fix a documented compatibility class and cover it with a synthetic regression.
- Keep changes small enough to review and include evidence for behavior changes.

## Bug reports and fixtures

Use synthetic pages, macros, and diagnostics. Never commit a real user macro, browser profile, cookies, tokens, account data, game balances, or unredacted diagnostic exports. Technical error codes and minimal sanitized reproduction steps are preferred.
