# GitHub publication preparation

## Proposed repository metadata

- Repository: `ZUI-Chrome-Macro-Recorder`
- Description: `A local-first Chrome macro recorder, editor and playback extension that works inside selected tabs without taking over the Windows mouse or keyboard.`
- Topics: `chrome-extension`, `macro-recorder`, `browser-automation`, `manifest-v3`, `productivity`, `javascript`

The public repository is created from a new sanitized snapshot history. The original development repository and its historical commits remain local and unchanged.

## Publication gates

- `LICENSE`: MIT, copyright 2026 Simulate-X.
- `HISTORY_SANITIZATION`: satisfied by publishing a new one-commit snapshot instead of rewriting or pushing the development history. Local `storage/` content and its old history are absent.
- `USER DAILY-USE ACCEPTANCE`: passed after the final visible Chrome Record/Play success and failure-path popup smoke.
- Release channel remains `0.6.0` internal beta. This publication does not create a production-stable or `1.0.0-rc.1` tag.

## Reliable CI scope

CI runs installation, JavaScript syntax checks, unit/contract tests, and the deterministic extension build/package-content audit. Browser-heavy MV3 service-worker suites, Chrome permission prompts, visible UI checks, and real-site compatibility stay documented local/manual gates because hosted headless runners cannot represent them faithfully.

## Public assets

No real Billionaire/Huuge account screenshot or other user screenshot is included. If screenshots are added later, capture only clean onboarding, popup, editor, settings, or synthetic local fixtures and review every image for account, avatar, balance, URL, and personal data.

## Current package evidence

- Version: `0.6.0`
- ZIP: `zui-macro-recorder-for-chrome-0.6.0.zip`
- Size: `69,542` bytes
- SHA-256: `298BC12262FD12A0240FE34F87CC4CAEFA3C80A00E2A45A93F5ACF83B7D525F4`
- Audit: 29 runtime files; zero forbidden files; archive and build-audit lists match exactly.

## Final validation evidence

- Static syntax check: 40 JavaScript files PASS.
- Unit/contract suite: 113/113 PASS.
- Phase 2, 3, 4, 5, 6 Edge and 6B automated suites: PASS.
- Headless Google Chrome Phase 6 matrix branch: environment `TIMEOUT`; not counted as a product PASS. Final visible Google Chrome user smoke: PASS.
- Phase 6B accelerated soak: 5,000 iterations / 100,000 inputs, one bounded offscreen context, zero debugger sessions.
