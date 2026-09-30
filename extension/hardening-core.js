(function initializeHardeningCore(global) {
  "use strict";

  const ERROR_CODES = Object.freeze({
    TARGET_TAB_CLOSED: "TARGET_CLOSED", TARGET_CLOSED: "TARGET_CLOSED", TARGET_NAVIGATED: "TARGET_NAVIGATED",
    MACRO_TARGET_ORIGIN_MISMATCH: "ORIGIN_MISMATCH",
    TARGET_ELEMENT_NOT_FOUND: "SURFACE_NOT_FOUND", TARGET_SURFACE_NOT_FOUND: "SURFACE_NOT_FOUND", TARGET_GEOMETRY_UNAVAILABLE: "SURFACE_NOT_FOUND",
    UNSAFE_START_BOUNDARY: "UNSAFE_START_BOUNDARY", SENSITIVE_INPUT_BLOCKED: "SENSITIVE_INPUT_BLOCKED",
    PLAYBACK_ALREADY_ACTIVE: "CONCURRENT_OPERATION_BLOCKED", RECORDING_ALREADY_ACTIVE: "CONCURRENT_OPERATION_BLOCKED",
    PLAYBACK_BLOCKED_WHILE_RECORDING: "CONCURRENT_OPERATION_BLOCKED", RECORDING_BLOCKED_WHILE_PLAYING: "CONCURRENT_OPERATION_BLOCKED",
    ACTIVE_PLAYBACK_TARGET_LOCKED: "CONCURRENT_OPERATION_BLOCKED", ACTIVE_RECORDING_TARGET_LOCKED: "CONCURRENT_OPERATION_BLOCKED",
    MACRO_VALIDATION_FAILED: "SCHEMA_INVALID", STORAGE_WRITE_FAILED: "STORAGE_WRITE_FAILED", OFFSCREEN_LOST: "OFFSCREEN_LOST",
    CROSS_ORIGIN_FRAME_UNSUPPORTED: "CROSS_ORIGIN_FRAME_UNSUPPORTED",
    REBIND_SURFACE_INCOMPATIBLE: "REBIND_SURFACE_INCOMPATIBLE",
    SITE_PERMISSION_REQUIRED: "SITE_PERMISSION_REQUIRED", SITE_PERMISSION_DENIED: "SITE_PERMISSION_DENIED",
    UNSUPPORTED_TARGET_SCHEME: "UNSUPPORTED_TARGET_SCHEME", SCRIPT_INJECTION_FAILED: "SCRIPT_INJECTION_FAILED",
    SITE_ACCESS_REMOVE_BLOCKED: "SITE_ACCESS_REMOVE_BLOCKED"
  });
  const SECRET_KEY = /(password|passcode|secret|token|cookie|authorization|account|gmail|session|runtimeCleanup)/i;

  function isSecretKey(key) {
    return SECRET_KEY.test(key) || /^(text|value)$/i.test(key);
  }

  function codeFromError(value) {
    const raw = String(value?.message || value || "UNKNOWN_ERROR").split(":")[0];
    if (/detached|not attached/i.test(String(value?.message || value))) return "CDP_DETACHED";
    if (/debugger.+attach|Another debugger/i.test(String(value?.message || value))) return "CDP_ATTACH_FAILED";
    return ERROR_CODES[raw] || raw.replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80) || "UNKNOWN_ERROR";
  }

  function redact(value, key = "root", seen = new WeakSet()) {
    if (isSecretKey(key)) return "[REDACTED]";
    if (value === null || ["number", "boolean"].includes(typeof value)) return value;
    if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, key, seen));
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey, seen)]));
  }

  function diagnostic({ code, message, macroId = null, eventIndex = null, iteration = null, targetOrigin = null, context = null, timestamp = new Date().toISOString() }) {
    return redact({ code: codeFromError(code), message: String(message || code || "Unknown error").slice(0, 240), macroId, eventIndex, iteration, targetOrigin, timestamp, context });
  }

  function validatePortableOrigin(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        ? { valid: true, origin: url.origin }
        : { valid: false, code: "IMPORT_FORBIDDEN_ORIGIN" };
    } catch (_) { return { valid: false, code: "IMPORT_FORBIDDEN_ORIGIN" }; }
  }

  function withDeadline(promise, timeoutMs, code = "OPERATION_TIMEOUT") {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout])
      .finally(() => clearTimeout(timer));
  }

  function surfaceKind(tagName, isViewport = false) {
    if (isViewport) return "viewport";
    return String(tagName || "").toLowerCase() === "canvas" ? "canvas" : "container";
  }

  function rebindSurfaceCompatibility({ expectedKind, resolvedKind, rect, display = null, visibility = null } = {}) {
    if (!["viewport", "canvas", "container"].includes(expectedKind)) return { compatible: false, reason: "INVALID_SOURCE_SURFACE" };
    if (resolvedKind !== expectedKind) return { compatible: false, reason: "SURFACE_KIND_MISMATCH" };
    if (!(Number(rect?.width) > 0 && Number(rect?.height) > 0)) return { compatible: false, reason: "ZERO_RECT" };
    if (display === "none" || visibility === "hidden") return { compatible: false, reason: "VISIBILITY_REJECTED" };
    return { compatible: true, reason: null };
  }

  function partitionMacros(value, validate) {
    if (!Array.isArray(value)) return { valid: [], quarantine: [{ id: null, name: "Storage root", errors: [{ code: "STORAGE_CORRUPTION", path: "$", message: "zuiMacros must be an array." }] }] };
    const valid = []; const quarantine = [];
    value.forEach((macro, index) => {
      const result = validate(macro);
      if (result.valid) valid.push(macro);
      else quarantine.push({ id: typeof macro?.id === "string" ? macro.id : null, name: typeof macro?.name === "string" ? macro.name.slice(0, 80) : `Invalid macro ${index + 1}`, errors: result.errors.slice(0, 10).map(({ path, code, message }) => ({ path, code, message })) });
    });
    return { valid, quarantine };
  }

  function recoveryDecision({ playback, recorder, offscreenPresent, recorderAlive = false }) {
    if (playback && ["RUNNING", "PAUSE_PENDING", "PAUSED", "STOPPING"].includes(playback.state) && !offscreenPresent) return { playback: "ERROR", code: "OFFSCREEN_LOST", cleanup: true };
    if (recorder && ["RECORDING", "PAUSED"].includes(recorder.state)) {
      return recorderAlive
        ? { recorder: recorder.state, cleanup: false }
        : { recorder: "IDLE", code: "SERVICE_WORKER_RESTART", cleanup: true };
    }
    return { cleanup: false };
  }

  global.ZuiHardening = Object.freeze({ ERROR_CODES, codeFromError, redact, diagnostic, validatePortableOrigin, withDeadline, surfaceKind, rebindSurfaceCompatibility, partitionMacros, recoveryDecision });
})(globalThis);
