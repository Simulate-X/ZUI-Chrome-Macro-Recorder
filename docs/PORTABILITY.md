# Cross-profile portability

The `.zui-macro.json` document is the only portable source of truth. Phase 5 automation used two simultaneously separate Microsoft Edge Chromium user-data directories: Profile A edited, saved and downloaded a macro; Profile B imported the real file, rebound a local target and produced the expected click. A second import became `Portable Cross Profile (2)` instead of silently overwriting the first. The exact gate was then repeated in two separate visible Google Chrome profiles: Profile A exported `Phase_5_DOM_Portability.zui-macro.json`, Profile B imported and rebound its 8 events, replay completed `8 / 8` with 4 input events, and the visible target changed from `DOM toggle: OFF` to `DOM toggle: ON`.

## Export boundary

Exports may contain the schema version, human metadata, target origin, portable surface locator, recorded geometry, recording preferences, playback defaults and explicit events. They must not contain `profileId`, profile paths, account/Gmail data, `tabId`, `windowId`, `frameId`, debugger state, cookies, authorization values, tokens, local paths or runtime cleanup/session fields.

The `recordingProfile` object describes capture preferences and is not a Chrome profile identifier.

## Import and rebinding

Import is atomic: parse, structural validation, semantic/privacy validation, user confirmation, unique name/new ID, then storage write. The imported origin must be credential-free HTTP or HTTPS. `javascript:`, `data:`, `chrome:`, `file:` and credential-bearing URLs are rejected. Unsupported schema majors and unknown events are rejected rather than guessed.

An import does not carry a live target. The destination user explicitly pins a tab. Playback requires the pinned tab origin to match the macro target origin. Same-origin iframe paths are portable CSS/frame paths; numeric frame IDs stay in session state only.

Site permissions are not portable data. They remain in Chrome's source profile and are never serialized into a single-macro export or full-library backup. After Profile A export and Profile B import, Profile B must select the target site and grant that site's permission before replay. Granting Site A never grants Site B.

## Compatibility

Version `1.0` remains unchanged. Phase 4 storage from commit `476b119` was opened at the same unpacked-extension path by version `0.5.0`; the saved macro remained available without migration. There is no old-schema migration because no older ZUI schema exists. Future/unknown majors fail with `UNSUPPORTED_SCHEMA`.

Round-trip policy is A export → B import → B edit/export → A import using the same validation and unique-name rules. Phase 5 automates the A→B file gate and duplicate-name conflict; the reverse direction uses the identical path but is not a separately timed acceptance row.

## Full-library backup

Phase 6A adds `backupSchemaVersion: "1.0"` library backups containing only `createdAt`, product metadata and validated canonical macros. Restore validates the envelope, every macro and the privacy boundary before planning any write. The selected policy is validated partial restore: valid macros can be restored while invalid entries are reported; conflicts are explicit `Keep Both`, `Replace Existing` or `Skip`, and no runtime tab/profile/session data is accepted.

The full-library gate passed in two separate visible Google Chrome profiles on 2026-09-25. A private user-owned backup contained no profile/account, tab/window, debugger, cookie, token, held-input, or runtime-backend data. Profile B restored the validated macros, explicitly rebound a synthetic local target, and produced an observable DOM effect. Keep Both, Replace, and Skip behaved without silent overwrite. The private backup itself and its identifying metadata are excluded from the public-ready tree.
