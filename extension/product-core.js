(function initializeProductCore(global) {
  "use strict";

  const BACKUP_SCHEMA_VERSION = "1.0";
  const DEFAULT_SETTINGS = Object.freeze({
    recording: Object.freeze({ keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true }),
    playback: Object.freeze({ speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true }),
    diagnostics: Object.freeze({ debugLogging: false })
  });
  const FORBIDDEN_PORTABLE_KEY = /^(profileId|profilePath|account|gmail|tabId|windowId|frameId|debugger|debuggerSession|cookie|cookies|token|tokens|authorization|session|runtimeState|runtimeCleanup)$/i;

  const ERROR_MESSAGES = Object.freeze({
    TARGET_CLOSED: { title: "Target tab was closed", explanation: "The selected tab is no longer available.", action: "Select another target", actionId: "select-target" },
    TARGET_NAVIGATED: { title: "Target tab changed page", explanation: "The selected tab moved to a different origin, so playback stopped safely.", action: "Select the target again", actionId: "select-target" },
    ORIGIN_MISMATCH: { title: "Macro and target do not match", explanation: "This macro belongs to another site. Rebind a copy to the selected site or select a matching target.", action: "Rebind a copy", actionId: "rebind-copy" },
    SURFACE_NOT_FOUND: { title: "Recorded surface was not found", explanation: "The page layout changed or the recorded control is not available.", action: "Re-select or re-record", actionId: "select-target" },
    REBIND_SURFACE_INCOMPATIBLE: { title: "Destination surface is incompatible", explanation: "The selected site does not expose the same visible interaction surface as the source macro.", action: "Record on this site", actionId: "select-target" },
    UNSAFE_START_BOUNDARY: { title: "Playback cannot start here", explanation: "Start from a complete input sequence so no key or mouse button is left held.", action: "Open in Editor", actionId: "open-editor" },
    SENSITIVE_INPUT_BLOCKED: { title: "Sensitive input was protected", explanation: "ZUI did not record or replay input in a password, OTP, token or secret field.", action: "Choose a non-sensitive field", actionId: null },
    CDP_ATTACH_FAILED: { title: "Chrome input connection is busy", explanation: "Another debugger or DevTools session may be attached to the target tab.", action: "Close the other debugger and retry", actionId: null },
    CDP_DETACHED: { title: "Chrome input connection ended", explanation: "Chrome detached the temporary input connection before the command completed.", action: "Retry playback", actionId: "retry-playback" },
    CDP_TARGET_HIDDEN: { title: "Target tab cannot receive this input", explanation: "The target tab is hidden, so Chrome cannot deliver this input safely.", action: "Bring the target tab to the foreground", actionId: "focus-target" },
    OFFSCREEN_LOST: { title: "Playback scheduler stopped", explanation: "The extension timing context was closed, so playback ended safely.", action: "Retry playback", actionId: "retry-playback" },
    SCHEMA_INVALID: { title: "Macro has validation problems", explanation: "Open the macro in Editor and fix the listed rows before using it.", action: "Open in Editor", actionId: "open-editor" },
    STORAGE_WRITE_FAILED: { title: "Changes could not be saved", explanation: "Chrome storage rejected the update. Check available storage and retry.", action: "Retry", actionId: "retry" },
    CROSS_ORIGIN_FRAME_UNSUPPORTED: { title: "Embedded content is not supported", explanation: "The target is inside a cross-origin frame that ZUI cannot address safely.", action: "Choose a top-level or same-origin target", actionId: "select-target" },
    CONCURRENT_OPERATION_BLOCKED: { title: "Another operation is active", explanation: "Stop the active recording or playback before starting this action.", action: "Stop active operation", actionId: "stop-active" },
    SITE_PERMISSION_REQUIRED: { title: "Site access is required", explanation: "ZUI needs permission for this site before it can record or replay actions in the selected tab.", action: "Grant site access", actionId: "select-target" },
    SITE_PERMISSION_DENIED: { title: "Site access wasn't granted", explanation: "ZUI needs permission for this site before it can record or replay actions here.", action: "Try again", actionId: "select-target" },
    UNSUPPORTED_TARGET_SCHEME: { title: "This page cannot be selected", explanation: "ZUI can target normal HTTP and HTTPS pages. Browser, extension, local-file and data URLs are not supported.", action: "Select another tab", actionId: "select-target" },
    SCRIPT_INJECTION_FAILED: { title: "ZUI could not start on this page", explanation: "Chrome blocked the recorder runtime on this page. Choose a normal web page or review the site's access setting.", action: "Try again", actionId: "select-target" },
    SITE_ACCESS_REMOVE_BLOCKED: { title: "Site access is in use", explanation: "Stop the active recording or playback before removing access for this site.", action: "Stop active operation", actionId: "stop-active" },
    PLAYBACK_STOP_TIMEOUT: { title: "Playback is still stopping", explanation: "ZUI could not confirm a safe terminal playback state yet. Wait a moment and try Stop again.", action: "Try Stop again", actionId: "stop-active" },
    NO_PINNED_TARGET: { title: "Select a target tab first", explanation: "Recording and playback are limited to the tab you explicitly select.", action: "Select current tab", actionId: "select-target" },
    MACRO_TARGET_ORIGIN_MISMATCH: { title: "Macro and target do not match", explanation: "This macro belongs to another site. Rebind a copy to the selected site or select a matching target.", action: "Rebind a copy", actionId: "rebind-copy" },
    MACRO_NAME_CONFLICT: { title: "That macro name is already in use", explanation: "Macro names must be unique after trimming spaces and ignoring letter case.", action: "Choose another name", actionId: "rename-macro" }
  });

  function clone(value) { return structuredClone(value); }
  function finite(value, fallback, minimum = 0) { const number = Number(value); return Number.isFinite(number) && number >= minimum ? number : fallback; }
  function normalizeSettings(value = {}) {
    return {
      recording: {
        keyboard: value.recording?.keyboard !== false,
        mouse: value.recording?.mouse !== false,
        mouseMode: value.recording?.mouseMode === "clicks-and-movement" ? "clicks-and-movement" : "clicks-only",
        wheel: value.recording?.wheel !== false
      },
      playback: {
        speedMultiplier: finite(value.playback?.speedMultiplier, 1, Number.EPSILON),
        repeatCount: Math.max(0, Math.trunc(finite(value.playback?.repeatCount, 1))),
        loopDelayMs: finite(value.playback?.loopDelayMs, 0),
        stopOnError: value.playback?.stopOnError !== false
      },
      diagnostics: { debugLogging: value.diagnostics?.debugLogging === true }
    };
  }

  function resolvePlaybackSettings(globalSettings, macroDefaults, sessionOverrides = {}) {
    const base = normalizeSettings(globalSettings).playback;
    return { ...base, ...(macroDefaults || {}), ...(sessionOverrides || {}), stopOnError: true };
  }

  function friendlyError(codeOrError) {
    const raw = String(codeOrError?.errorCode || codeOrError?.message || codeOrError || "UNKNOWN_ERROR");
    const code = raw.split(":")[0].replace(/^ERROR:\s*/i, "").trim();
    const known = ERROR_MESSAGES[code] || { title: "The action could not be completed", explanation: "Review the target and macro, then try again.", action: "Retry", actionId: "retry" };
    return { code, ...known };
  }

  function searchMacros(macros, query = "") {
    const needle = String(query).trim().toLocaleLowerCase();
    return needle ? macros.filter((macro) => String(macro.name || "").toLocaleLowerCase().includes(needle)) : [...macros];
  }

  function sortMacros(macros, key = "updatedAt", direction = "desc") {
    const sign = direction === "asc" ? 1 : -1;
    const get = (macro) => key === "name" ? String(macro.name || "").toLocaleLowerCase()
      : key === "eventCount" ? (macro.events?.length || 0)
        : Date.parse(macro[key] || 0) || 0;
    return [...macros].sort((a, b) => {
      const left = get(a); const right = get(b);
      if (typeof left === "string") return left.localeCompare(right) * sign;
      return (left - right) * sign;
    });
  }

  function updateRecent(ids, macroId, limit = 5) {
    return [macroId, ...(Array.isArray(ids) ? ids : []).filter((id) => id !== macroId)].filter(Boolean).slice(0, limit);
  }

  function normalizeMacroName(name) { return String(name || "").trim(); }
  function macroNameKey(name) { return normalizeMacroName(name).toLocaleLowerCase(); }
  function findMacroNameConflict(macros, name, exceptId = null) {
    const key = macroNameKey(name);
    return key ? (macros || []).find((macro) => macro.id !== exceptId && macroNameKey(macro.name) === key) || null : null;
  }
  function uniqueMacroName(name, macros, exceptId = null) {
    const base = normalizeMacroName(name);
    if (!findMacroNameConflict(macros, base, exceptId)) return base;
    let suffix = 2;
    while (findMacroNameConflict(macros, `${base} (${suffix})`, exceptId)) suffix += 1;
    return `${base} (${suffix})`;
  }

  function findForbiddenPortablePath(value, path = "$", seen = new WeakSet()) {
    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return `${path}.[circular]`;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PORTABLE_KEY.test(key)) return `${path}.${key}`;
      const nested = findForbiddenPortablePath(child, `${path}.${key}`, seen);
      if (nested) return nested;
    }
    return null;
  }

  function createLibraryBackup(macros, createdAt = new Date().toISOString()) {
    const rows = clone(macros || []);
    const forbidden = findForbiddenPortablePath(rows);
    if (forbidden) throw new Error(`BACKUP_RUNTIME_FIELD:${forbidden}`);
    return { backupSchemaVersion: BACKUP_SCHEMA_VERSION, createdAt, product: "ZUI Macro Recorder for Chrome", macros: rows };
  }

  function validateLibraryBackup(value, validateMacro) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) errors.push({ path: "$", code: "BACKUP_INVALID", message: "Backup must be a JSON object." });
    if (value?.backupSchemaVersion !== BACKUP_SCHEMA_VERSION) errors.push({ path: "$.backupSchemaVersion", code: "BACKUP_VERSION_UNSUPPORTED", message: `Supported backup version is ${BACKUP_SCHEMA_VERSION}.` });
    if (!Array.isArray(value?.macros)) errors.push({ path: "$.macros", code: "BACKUP_INVALID", message: "Backup macros must be an array." });
    const forbidden = findForbiddenPortablePath(value?.macros || []);
    if (forbidden) errors.push({ path: forbidden, code: "BACKUP_RUNTIME_FIELD", message: "Backup contains profile or runtime state." });
    const rows = Array.isArray(value?.macros) ? value.macros.map((macro, index) => {
      const result = validateMacro(macro);
      return { index, name: String(macro?.name || `Macro ${index + 1}`), valid: Boolean(result?.valid), errors: result?.errors || [] };
    }) : [];
    return { valid: errors.length === 0 && rows.every((row) => row.valid), errors, rows };
  }

  function planLibraryRestore(existingMacros, backup, conflictPolicy, validateMacro, options = {}) {
    const validation = validateLibraryBackup(backup, validateMacro);
    if (validation.errors.length) return { ok: false, validation, errorCode: validation.errors[0].code };
    if (!["keep-both", "replace", "skip"].includes(conflictPolicy)) return { ok: false, validation, errorCode: "BACKUP_CONFLICT_POLICY_REQUIRED" };
    const now = options.now || (() => new Date().toISOString());
    const makeId = options.makeId || (() => crypto.randomUUID());
    const validRows = backup.macros.filter((_, index) => validation.rows[index]?.valid);
    const conflicts = validRows.filter((macro) => existingMacros.some((item) => item.id === macro.id || macroNameKey(item.name) === macroNameKey(macro.name))).map((macro) => ({ id: macro.id, name: macro.name }));
    let next = clone(existingMacros); let restored = 0; let skipped = 0;
    for (const source of validRows) {
      const candidate = clone(source);
      candidate.name = normalizeMacroName(candidate.name);
      const matches = next.filter((item) => item.id === candidate.id || macroNameKey(item.name) === macroNameKey(candidate.name));
      if (matches.length && conflictPolicy === "skip") { skipped += 1; continue; }
      if (matches.length && conflictPolicy === "replace") next = next.filter((item) => !matches.some((match) => match.id === item.id));
      if (matches.length && conflictPolicy === "keep-both") {
        candidate.id = makeId(); candidate.name = uniqueMacroName(candidate.name, next); candidate.createdAt = now();
      }
      candidate.updatedAt = now(); next.unshift(candidate); restored += 1;
    }
    return { ok: true, validation, macros: next.slice(0, 100), restored, skipped, rejected: validation.rows.filter((row) => !row.valid).length, conflicts };
  }

  function shouldShowOnboarding(state) { return !state || state.completed !== true; }

  function shouldHydrateRecorderName(status, draftDirty = false) {
    const active = ["RECORDING", "PAUSED"].includes(status?.state);
    return Boolean(status?.name) && (active || !draftDirty);
  }

  function shouldClosePopupAfterStart(action, response) {
    if (response?.ok !== true) return false;
    if (action === "record") return response.status?.state === "RECORDING";
    if (action === "play") return response.status?.state === "RUNNING";
    return false;
  }

  function requestPopupCloseAfterStart(action, response, closePopup) {
    if (!shouldClosePopupAfterStart(action, response)) return false;
    closePopup();
    return true;
  }

  const RECOMMENDED_SHORTCUTS = Object.freeze([
    { name: "toggle-playback", label: "Play / Pause / Resume", recommended: "Ctrl+Shift+P" },
    { name: "stop-playback", label: "Stop playback", recommended: "Ctrl+Q" },
    { name: "step-playback", label: "Step next", recommended: "Ctrl+Alt+F10" },
    { name: "toggle-recording", label: "Recording toggle", recommended: "Ctrl+Alt+R" },
    { name: "abort-recording", label: "Abort recording", recommended: "Ctrl+Alt+Q" }
  ]);

  function shortcutRows(commands) {
    const current = new Map((Array.isArray(commands) ? commands : []).map((row) => [row.name, row.shortcut || "Not assigned"]));
    return RECOMMENDED_SHORTCUTS.map((row) => {
      const assigned = current.get(row.name) || "Not assigned";
      return { ...row, current: assigned, matchesRecommended: assigned === row.recommended };
    });
  }

  global.ZuiProduct = Object.freeze({
    BACKUP_SCHEMA_VERSION, DEFAULT_SETTINGS, ERROR_MESSAGES, normalizeSettings, resolvePlaybackSettings,
    friendlyError, searchMacros, sortMacros, updateRecent, normalizeMacroName, macroNameKey,
    findMacroNameConflict, uniqueMacroName, findForbiddenPortablePath,
    createLibraryBackup, validateLibraryBackup, planLibraryRestore, shouldShowOnboarding,
    shouldHydrateRecorderName, shouldClosePopupAfterStart, requestPopupCloseAfterStart, shortcutRows, clone
  });
})(globalThis);
