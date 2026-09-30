# Diagnostics and privacy

## Error model

Diagnostics use stable codes including `TARGET_CLOSED`, `TARGET_NAVIGATED`, `ORIGIN_MISMATCH`, `SURFACE_NOT_FOUND`, `UNSAFE_START_BOUNDARY`, `SENSITIVE_INPUT_BLOCKED`, `CDP_ATTACH_FAILED`, `CDP_DETACHED`, `OFFSCREEN_LOST`, `SCHEMA_INVALID`, `STORAGE_WRITE_FAILED`, `CONCURRENT_OPERATION_BLOCKED`, `SITE_PERMISSION_REQUIRED`, `SITE_PERMISSION_DENIED`, `UNSUPPORTED_TARGET_SCHEME`, `SCRIPT_INJECTION_FAILED`, `SITE_ACCESS_REMOVE_BLOCKED`, `PLAYBACK_STOP_TIMEOUT` and `CROSS_ORIGIN_FRAME_UNSUPPORTED`.

An entry may contain code, bounded message, macro ID, event index, iteration, target origin, ISO timestamp and safe context. Recent session diagnostics are capped at 100 entries. Password/passcode/secret/token/cookie/authorization/account/Gmail/session keys, text/value bodies and runtime cleanup payloads are redacted. Long non-secret strings are bounded. Diagnostic export never includes full typed text.

The editor's **Diagnostics** action and **Settings > Diagnostics** controls expose debug logging, a redacted report export, recent error details and history clearing. Reports contain extension version, platform metadata, redacted playback state, recent diagnostics and quarantine summaries. Export does not mutate or save a macro; if browser download is blocked the action remains available for retry.

## Debugger permission

`debugger` is required only for keyboard, text, select and wheel routes that need native browser behavior. It attaches to the explicitly pinned tab for one command and detaches in `finally`. Error recovery detaches every tracked session. It does not control the Windows mouse or keyboard. Pointer/canvas events never silently switch to CDP.

## Permission audit

| Permission | Reason |
|---|---|
| `storage` | canonical local macro library plus ephemeral session state |
| `tabs` | explicit target selection, origin checks and close/navigation lifecycle |
| `offscreen` | the single hidden-tab-capable timing owner |
| `debugger` | scoped CDP input for keyboard/text/select/wheel |
| `webNavigation` | enumerate frames so recorder enable/disable is deterministic; exported macros still contain no frame ID |
| `scripting` | install the idempotent content runtime only in the explicitly selected, permitted target tab |

No `downloads`, `clipboardRead`, `clipboardWrite`, `activeTab` or broad required `<all_urls>` permission is requested. Required `host_permissions` is empty. HTTP/HTTPS broad match patterns are declared only under `optional_host_permissions`; an exact site grant is requested from the popup's explicit selection gesture.

Default logging is minimal. Phase 5 does not add an unbounded verbose log. State/error evidence is kept in capped, redacted diagnostics and the test report.
