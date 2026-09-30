# Site permissions

ZUI Macro Recorder for Chrome needs DOM access to install its recorder/playback runtime in the tab the user selects. Version 0.6.0 does not receive broad site access at installation time: required `host_permissions` is empty and HTTP/HTTPS support is declared only as an optional capability.

## When access is requested

`Select current tab` validates the active URL and derives one Chrome match pattern for its site, for example `https://example.com/*`. The popup checks existing access and, only from that direct user gesture, calls `chrome.permissions.request()`. A denial returns `SITE_PERMISSION_DENIED`; the tab is not pinned and no runtime is injected.

Browser-internal, extension, devtools, `about:`, `view-source:`, `javascript:`, `data:` and `file:` URLs are rejected as `UNSUPPORTED_TARGET_SCHEME`. Pages where Chrome forbids injection return `SCRIPT_INJECTION_FAILED`.

## Runtime lifecycle

After a grant, the service worker injects the content runtime only into the selected tab's top frame and eligible same-origin frames. A runtime ping and bootstrap guard make this idempotent. Same-origin reload/navigation keeps the permission and pin, then restores the runtime. Cross-origin navigation stops active work and clears the pin; the new site requires a separate selection and grant. A top-level grant never silently authorizes a cross-origin iframe.

## Removing access

Settings lists exact granted HTTP/HTTPS sites using `chrome.permissions.getAll()`. `Remove access` calls `chrome.permissions.remove()`. Removal is blocked while recording/playback is active. If access is removed through Chrome while an operation is active, ZUI stops safely, detaches debugger sessions and clears the pin. The next operation requires access again.

## Privacy and portability

Site grants are Chrome profile-local. They are not written into macro JSON, full-library backups, diagnostics or telemetry, and ZUI has no remote permission broker. Profile B importing a macro from Profile A must independently select and authorize the target site. Existing password, OTP, token/secret blocking and redacted diagnostics remain unchanged.
