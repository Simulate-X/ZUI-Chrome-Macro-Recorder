"use strict";

importScripts("hardening-core.js", "shared.js", "recorder-core.js", "playback-core.js", "product-core.js", "site-permissions-core.js");

const TARGET_KEY = "pinnedTarget";
const RECORDER_KEY = "recorderSession";
const SETTINGS_KEY = "recorderSettings";
const MACROS_KEY = "zuiMacros";
const LAST_RESULT_KEY = "lastRecordingResult";
const PLAYBACK_KEY = "activePlayback";
const DIAGNOSTICS_KEY = "diagnostics";
const QUARANTINE_KEY = "macroQuarantine";
const PRODUCT_SETTINGS_KEY = "productSettings";
const RECENT_KEY = "recentMacroIds";
const CDP_COMMAND_TIMEOUT_MS = 5000;
const { validateMacroSchema, validateMacro } = globalThis.ZuiPoc;
const { STATES, normalizeSettings, nextState, appendCapture, createMacro } = globalThis.ZuiRecorderCore;
const CONTENT_RUNTIME_FILES = ["hardening-core.js", "shared.js", "recorder-core.js", "content-script.js"];
const debuggerSessions = new Set();
const debuggerDetachEvents = [];
let captureQueue = Promise.resolve();
let startupRecovery = Promise.resolve();
let offscreenCloseTimer = null;

async function recordDiagnostic(value) {
  const entry = ZuiHardening.diagnostic(value);
  const stored = await chrome.storage.session.get(DIAGNOSTICS_KEY);
  const rows = Array.isArray(stored[DIAGNOSTICS_KEY]) ? stored[DIAGNOSTICS_KEY] : [];
  await chrome.storage.session.set({ [DIAGNOSTICS_KEY]: [...rows, entry].slice(-100) });
  return entry;
}

async function loadMacroLibrary() {
  const stored = await chrome.storage.local.get(MACROS_KEY);
  const partition = ZuiHardening.partitionMacros(stored[MACROS_KEY] || [], validateMacro);
  await chrome.storage.local.set({ [QUARANTINE_KEY]: partition.quarantine });
  return partition;
}

async function safeLocalSet(value) {
  try { await chrome.storage.local.set(value); }
  catch (cause) { throw new Error(`STORAGE_WRITE_FAILED:${cause.message}`); }
}

async function getProductSettings() {
  const stored = await chrome.storage.local.get(PRODUCT_SETTINGS_KEY);
  return ZuiProduct.normalizeSettings(stored[PRODUCT_SETTINGS_KEY]);
}

async function markRecent(macroId) {
  if (!macroId) return [];
  const stored = await chrome.storage.local.get(RECENT_KEY);
  const recent = ZuiProduct.updateRecent(stored[RECENT_KEY], macroId);
  await safeLocalSet({ [RECENT_KEY]: recent });
  return recent;
}

function publicPlaybackStatus(status) {
  if (!status) return { state: "IDLE" };
  const value = structuredClone(status);
  delete value.ok;
  delete value.runtimeCleanup;
  delete value.surfaceSelector;
  return value;
}

async function getTarget() {
  const result = await chrome.storage.session.get(TARGET_KEY);
  return result[TARGET_KEY] || null;
}

async function pingTargetRuntime(tabId, frameId = 0) {
  return chrome.tabs.sendMessage(tabId, { type: "ZUI_RUNTIME_PING" }, { frameId }).catch(() => null);
}

async function ensureTargetRuntime(tab) {
  const permission = await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
  const current = await pingTargetRuntime(tab.id, 0);
  if (current?.runtime === "ZUI_CONTENT_RUNTIME") return { injected: false, frameIds: [0] };
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  const frameIds = ZuiSitePermissions.sameOriginFrameIds(frames, permission.origin);
  if (!frameIds.includes(0)) frameIds.unshift(0);
  try {
    for (const frameId of frameIds) {
      const existing = await pingTargetRuntime(tab.id, frameId);
      if (existing?.runtime === "ZUI_CONTENT_RUNTIME") continue;
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: CONTENT_RUNTIME_FILES });
    }
  } catch (_) {
    throw new Error("SCRIPT_INJECTION_FAILED");
  }
  const ready = await pingTargetRuntime(tab.id, 0);
  if (ready?.runtime !== "ZUI_CONTENT_RUNTIME") throw new Error("SCRIPT_INJECTION_FAILED");
  return { injected: true, frameIds };
}

async function pinTab(tab) {
  const session = await getRecorderSession();
  if ([STATES.RECORDING, STATES.PAUSED].includes(session.state)) {
    throw new Error("ACTIVE_RECORDING_TARGET_LOCKED");
  }
  const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) throw new Error("ACTIVE_PLAYBACK_TARGET_LOCKED");
  if (!tab?.id) throw new Error("TARGET_TAB_CLOSED");
  const policy = ZuiSitePermissions.targetPermission(tab.url || "");
  if (!policy.valid) throw new Error(policy.code);
  await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
  await ensureTargetRuntime(tab);
  const target = { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title || "" };
  await chrome.storage.session.set({ [TARGET_KEY]: target });
  return target;
}

async function getRecorderSession() {
  const result = await chrome.storage.session.get(RECORDER_KEY);
  return result[RECORDER_KEY] || { state: STATES.IDLE };
}

async function saveRecorderSession(session) {
  await chrome.storage.session.set({ [RECORDER_KEY]: session });
  return session;
}

function publicRecorderStatus(session) {
  const activeExtra = session.state === STATES.RECORDING && session.activeSinceWall ? Date.now() - session.activeSinceWall : 0;
  return {
    state: session.state,
    sessionId: session.sessionId || null,
    name: session.name || null,
    reason: session.reason || null,
    target: session.target ? { title: session.target.title, origin: session.target.origin } : null,
    settings: session.settings || null,
    durationMs: Math.max(0, (session.wallActiveDurationMs || 0) + activeExtra),
    eventCount: session.events?.length || 0,
    inputEventCount: session.events?.filter((event) => event.type !== "delay").length || 0,
    warnings: session.warnings || [],
    result: session.result || null
  };
}

async function startRecording({ name, settings } = {}) {
  const current = await getRecorderSession();
  if (current.state === STATES.RECORDING || current.state === STATES.PAUSED) throw new Error("RECORDING_ALREADY_ACTIVE");
  const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) throw new Error("RECORDING_BLOCKED_WHILE_PLAYING");
  const target = await getTarget();
  if (!target) throw new Error("NO_PINNED_TARGET");
  const normalizedSettings = normalizeSettings(settings || (await getProductSettings()).recording);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizedSettings });
  const sessionId = crypto.randomUUID();
  const response = await sendToTarget({ type: "SET_RECORDER", enabled: true, settings: normalizedSettings, sessionId });
  if (!response?.ok || !response.surface) throw new Error(response?.error || "RECORDER_TARGET_START_FAILED");
  const surface = {
    kind: response.surface.kind,
    locator: { strategy: "css", value: response.surface.selector },
    recordedGeometry: {
      widthCssPx: response.surface.rect.width,
      heightCssPx: response.surface.rect.height,
      devicePixelRatio: response.surface.devicePixelRatio
    }
  };
  const session = {
    state: nextState(current.state, "START"),
    sessionId,
    name: String(name || "Recorded macro").trim() || "Recorded macro",
    target: { tabId: target.tabId, title: target.title, origin: new URL(target.url).origin },
    surface,
    settings: normalizedSettings,
    events: [],
    warnings: [],
    nextEventNumber: 1,
    lastCaptureAt: response.now,
    activeDurationMs: 0,
    wallActiveDurationMs: 0,
    activeSinceWall: Date.now(),
    startedAt: new Date().toISOString()
  };
  return saveRecorderSession(session);
}

async function pauseRecording() {
  const session = await getRecorderSession();
  session.state = nextState(session.state, "PAUSE");
  const response = await sendToTarget({ type: "SET_RECORDER", enabled: false, settings: session.settings, sessionId: session.sessionId });
  if (!response?.ok) throw new Error(response?.error || "RECORDER_TARGET_PAUSE_FAILED");
  session.wallActiveDurationMs += Date.now() - session.activeSinceWall;
  session.activeSinceWall = null;
  session.lastCaptureAt = null;
  return saveRecorderSession(session);
}

async function resumeRecording() {
  const session = await getRecorderSession();
  session.state = nextState(session.state, "RESUME");
  const response = await sendToTarget({ type: "SET_RECORDER", enabled: true, settings: session.settings, sessionId: session.sessionId });
  if (!response?.ok) throw new Error(response?.error || "RECORDER_TARGET_RESUME_FAILED");
  session.lastCaptureAt = response.now;
  session.activeSinceWall = Date.now();
  return saveRecorderSession(session);
}

async function storeMacro(macro) {
  const { valid: macros } = await loadMacroLibrary();
  const next = [macro, ...macros.filter((item) => item.id !== macro.id)].slice(0, 100);
  await safeLocalSet({ [MACROS_KEY]: next });
  await markRecent(macro.id);
}

async function saveEditedMacro(macro, allowReplace = true) {
  const candidate = structuredClone(macro);
  candidate.name = String(candidate.name || "").trim();
  if (!candidate.name || candidate.name.length > 80) throw new Error("INVALID_MACRO_NAME");
  const validation = validateMacro(candidate);
  if (!validation.valid) throw new Error(`MACRO_VALIDATION_FAILED:${validation.errors[0]?.path || "$"}:${validation.errors[0]?.code || "INVALID"}`);
  const { valid: macros } = await loadMacroLibrary();
  const existing = macros.find((item) => item.id === candidate.id);
  if (existing && !allowReplace) throw new Error("MACRO_ID_CONFLICT");
  const nameConflict = ZuiProduct.findMacroNameConflict(macros, candidate.name, candidate.id);
  if (nameConflict) throw new Error(`MACRO_NAME_CONFLICT:${ZuiProduct.uniqueMacroName(candidate.name, macros, candidate.id)}`);
  candidate.createdAt = candidate.createdAt || new Date().toISOString();
  candidate.updatedAt = new Date().toISOString();
  await storeMacro(candidate);
  return candidate;
}

async function rebindMacro(macro, mode) {
  if (!macro || !["copy", "replace"].includes(mode)) throw new Error("INVALID_REBIND_REQUEST");
  const target = await getTarget();
  if (!target) throw new Error("NO_PINNED_TARGET");
  const tab = await chrome.tabs.get(target.tabId);
  await ensureTargetRuntime(tab);
  let surface;
  try {
    surface = await sendToTarget({ type: "RESOLVE_REBIND_SURFACE", sourceSurface: macro.target?.surface });
  } catch (cause) {
    const error = new Error(cause?.message || "REBIND_SURFACE_INCOMPATIBLE");
    error.diagnosticContext = { messageType: "REBIND_MACRO", reason: "RUNTIME_NOT_AVAILABLE" };
    throw error;
  }
  if (!surface?.ok || surface.compatible !== true) {
    const error = new Error(surface?.error || "REBIND_SURFACE_INCOMPATIBLE");
    error.diagnosticContext = { messageType: "REBIND_MACRO", reason: surface?.reason || "RUNTIME_NOT_AVAILABLE", trace: surface?.trace || null };
    throw error;
  }
  const candidate = structuredClone(macro);
  candidate.target = {
    origin: new URL(tab.url).origin,
    surface: {
      kind: surface.kind,
      locator: { strategy: "css", value: surface.selector },
      recordedGeometry: { widthCssPx: surface.rect.width, heightCssPx: surface.rect.height, devicePixelRatio: surface.devicePixelRatio }
    }
  };
  if (mode === "copy") {
    const { valid: macros } = await loadMacroLibrary();
    const host = new URL(tab.url).hostname.replace(/^www\./, "");
    candidate.id = `${String(candidate.id || "macro").slice(0, 48)}-rebind-${crypto.randomUUID().slice(0, 8)}`;
    candidate.name = ZuiProduct.uniqueMacroName(`${candidate.name} — ${host}`, macros);
    candidate.createdAt = new Date().toISOString();
  }
  return saveEditedMacro(candidate, mode === "replace");
}

async function deleteMacro(id) {
  const recorder = await getRecorderSession();
  if ([STATES.RECORDING, STATES.PAUSED].includes(recorder.state)) throw new Error("DELETE_BLOCKED_WHILE_RECORDING");
  const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) throw new Error("DELETE_BLOCKED_WHILE_PLAYING");
  const { valid: macros } = await loadMacroLibrary();
  const next = macros.filter((macro) => macro.id !== id);
  if (next.length === macros.length) throw new Error("MACRO_NOT_FOUND");
  await safeLocalSet({ [MACROS_KEY]: next });
  return { deletedId: id };
}

async function finalizeRecording(reason = "user_stop", targetAvailable = true) {
  let session = await getRecorderSession();
  if (![STATES.RECORDING, STATES.PAUSED].includes(session.state)) throw new Error("NO_ACTIVE_RECORDING");
  if (session.state === STATES.RECORDING) {
    if (session.activeSinceWall) session.wallActiveDurationMs += Date.now() - session.activeSinceWall;
    if (targetAvailable) await sendToTarget({ type: "SET_RECORDER", enabled: false, settings: session.settings, sessionId: session.sessionId }).catch(() => {});
  }
  await captureQueue.catch(() => {});
  session = await getRecorderSession();
  session.state = nextState(session.state, "STOP");
  session.reason = reason;
  session.activeSinceWall = null;
  const macro = createMacro(session, session.name);
  const { valid: existingMacros } = await loadMacroLibrary();
  macro.name = ZuiProduct.uniqueMacroName(macro.name, existingMacros, macro.id);
  const schemaValidation = validateMacroSchema(macro);
  const semanticValidation = validateMacro(macro);
  const result = {
    macro,
    validation: { schema: schemaValidation, semantic: semanticValidation },
    valid: schemaValidation.valid && semanticValidation.valid,
    durationMs: macro.events.filter((event) => event.type === "delay").reduce((sum, event) => sum + event.durationMs, 0),
    eventCount: macro.events.length,
    inputEventCount: macro.events.filter((event) => event.type !== "delay").length,
    reason
  };
  session.result = result;
  await saveRecorderSession(session);
  if (result.valid) await storeMacro(macro);
  else await chrome.storage.local.set({ recorderInvalidDebug: { recordedAt: new Date().toISOString(), result } });
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
  return session;
}

async function cancelRecording(reason = "user_cancel") {
  const session = await getRecorderSession();
  session.state = nextState(session.state, "CANCEL");
  await sendToTarget({ type: "SET_RECORDER", enabled: false, settings: session.settings, sessionId: session.sessionId }).catch(() => {});
  return saveRecorderSession({ state: STATES.IDLE, reason });
}

async function acceptCapture(message, sender) {
  captureQueue = captureQueue.then(async () => {
    const session = await getRecorderSession();
    if (session.state !== STATES.RECORDING || message.sessionId !== session.sessionId) return;
    if (sender.tab?.id !== session.target.tabId) return;
    if (Number.isInteger(sender.frameId)) {
      if (session.target.frameId === undefined) session.target.frameId = sender.frameId;
      if (session.target.frameId !== sender.frameId) throw new Error("CROSS_ORIGIN_FRAME_UNSUPPORTED");
    }
    const capture = structuredClone(message.capture);
    if (capture.surface && session.events.length === 0) {
      session.surface = {
        kind: capture.surface.kind,
        locator: { strategy: "css", value: capture.surface.selector },
        recordedGeometry: {
          widthCssPx: capture.surface.rect.width,
          heightCssPx: capture.surface.rect.height,
          devicePixelRatio: capture.surface.devicePixelRatio
        }
      };
    }
    delete capture.surface;
    delete capture.sessionId;
    appendCapture(session, capture);
    await saveRecorderSession(session);
  });
  await captureQueue;
}

async function acceptWarning(message, sender) {
  const session = await getRecorderSession();
  if (![STATES.RECORDING, STATES.PAUSED].includes(session.state) || message.sessionId !== session.sessionId || sender.tab?.id !== session.target.tabId) return;
  if (!session.warnings.includes(message.warning)) session.warnings.push(message.warning);
  await saveRecorderSession(session);
}

async function sendToTarget(message) {
  const target = await getTarget();
  if (!target) throw new Error("NO_PINNED_TARGET");
  const tab = await chrome.tabs.get(target.tabId).catch(() => null);
  if (!tab) {
    await chrome.storage.session.remove(TARGET_KEY);
    throw new Error("TARGET_TAB_CLOSED");
  }
  if (new URL(tab.url).origin !== new URL(target.url).origin) {
    await chrome.storage.session.remove(TARGET_KEY);
    throw new Error("TARGET_NAVIGATED");
  }
  await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
  await ensureTargetRuntime(tab);
  if (message.type === "SET_RECORDER") {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: target.tabId });
    const responses = await Promise.all(frames.map((frame) => chrome.tabs.sendMessage(target.tabId, message, { frameId: frame.frameId }).catch(() => null)));
    return responses[frames.findIndex((frame) => frame.frameId === 0)] || responses.find(Boolean);
  }
  return chrome.tabs.sendMessage(target.tabId, message, { frameId: 0 });
}

async function getPinnedTargetTab() {
  const target = await getTarget();
  if (!target) throw new Error("NO_PINNED_TARGET");
  const tab = await chrome.tabs.get(target.tabId).catch(() => null);
  if (!tab) {
    await chrome.storage.session.remove(TARGET_KEY);
    throw new Error("TARGET_TAB_CLOSED");
  }
  if (new URL(tab.url).origin !== new URL(target.url).origin) {
    await chrome.storage.session.remove(TARGET_KEY);
    throw new Error("TARGET_NAVIGATED");
  }
  await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
  return tab;
}

async function attachDebugger(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error("TARGET_TAB_CLOSED");
  await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, "1.3");
  debuggerSessions.add(tabId);
  return debuggee;
}

async function detachDebugger(debuggee) {
  try {
    await chrome.debugger.detach(debuggee);
  } finally {
    debuggerSessions.delete(debuggee.tabId);
  }
}

async function detachAllDebuggers() {
  const rows = [...debuggerSessions];
  await Promise.all(rows.map((tabId) => detachDebugger({ tabId }).catch(() => { debuggerSessions.delete(tabId); })));
}

async function withDebugger(tabId, operation) {
  const debuggee = await attachDebugger(tabId);
  try {
    return await ZuiHardening.withDeadline(operation(debuggee), CDP_COMMAND_TIMEOUT_MS, "CDP_COMMAND_TIMEOUT");
  } finally {
    await detachDebugger(debuggee).catch(() => {});
  }
}

async function dispatchCdpInput(action) {
  const tab = await getPinnedTargetTab();
  return withDebugger(tab.id, async (debuggee) => {
    if (action.kind === "keyboard") {
      const key = action.key || "";
      const code = action.code || "";
      const virtualKeyCode = action.virtualKeyCode || 0;
      const common = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
      if (action.text) {
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type: "char", ...common, text: action.text, unmodifiedText: action.text });
      }
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyUp", ...common });
      return { backend: "CDP_INPUT", kind: "keyboard", key, code, textLength: action.text?.length || 0 };
    }
    if (action.kind === "keyEvent") {
      const event = action.event;
      const modifierBits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      const modifiers = (event.modifiers || []).reduce((bits, item) => bits | (modifierBits[item] || 0), 0);
      const virtualKeyCode = event.key?.length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0;
      const common = {
        key: event.key || "",
        code: event.code || "",
        location: event.location || 0,
        autoRepeat: Boolean(event.repeat),
        modifiers,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode
      };
      const type = event.type === "keyDown" ? "rawKeyDown" : "keyUp";
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type, ...common });
      if (event.type === "keyDown" && event.key?.length === 1 && !(modifiers & (2 | 4))) {
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          type: "char", ...common, text: event.key, unmodifiedText: event.key
        });
      }
      return { backend: "CDP_INPUT", kind: "keyEvent", type: event.type, key: event.key, code: event.code };
    }
    if (action.kind === "text") {
      const preflight = await sendToTarget({ type: "CHECK_PLAYBACK_TEXT_TARGET", selector: action.selector });
      if (!preflight?.ok || !preflight.safe) throw new Error(preflight?.error || "SENSITIVE_INPUT_BLOCKED");
      await chrome.debugger.sendCommand(debuggee, "Input.insertText", { text: String(action.text || "") });
      return { backend: "CDP_INPUT", kind: "text", textLength: String(action.text || "").length };
    }
    if (action.kind === "wheel") {
      const geometry = await sendToTarget({ type: "GET_PLAYBACK_GEOMETRY", selector: action.selector });
      if (!geometry?.ok || !geometry.rect) throw new Error(geometry?.error || "TARGET_GEOMETRY_UNAVAILABLE");
      if (geometry.hidden) throw new Error("CDP_TARGET_HIDDEN");
      const position = action.position || { x: 0.5, y: 0.5 };
      const { rect } = geometry;
      const x = rect.left + rect.width * position.x;
      const y = rect.top + rect.height * position.y;
      if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > geometry.rect.width + geometry.rect.left || y > geometry.rect.height + geometry.rect.top) {
        throw new Error("CDP_POINT_OUTSIDE_VIEWPORT");
      }
      const deltaFactor = action.deltaMode === 1 ? 16 : (action.deltaMode === 2 ? geometry.rect.height : 1);
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: (action.deltaX || 0) * deltaFactor,
        deltaY: (action.deltaY || 0) * deltaFactor,
        modifiers: 0,
        pointerType: "mouse"
      });
      return { backend: "CDP_INPUT", kind: "wheel", point: { x, y }, deltaX: (action.deltaX || 0) * deltaFactor, deltaY: (action.deltaY || 0) * deltaFactor, sourceDeltaMode: action.deltaMode || 0, geometry };
    }
    throw new Error("UNKNOWN_CDP_INPUT_ACTION");
  });
}

const INPUT_BACKENDS = Object.freeze({
  DOM_SYNTHETIC: (action) => sendToTarget({ type: "GENERIC_ACTION", action }),
  CDP_INPUT: dispatchCdpInput
});

chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (!source.tabId) return;
  debuggerSessions.delete(source.tabId);
  debuggerDetachEvents.push({ tabId: source.tabId, reason, at: Date.now() });
  if (debuggerDetachEvents.length > 10) debuggerDetachEvents.shift();
});

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Measure extension-only playback scheduling while the target tab is backgrounded."
    });
  }
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
    ready = Boolean((await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" }).catch(() => null))?.ok);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!ready) throw new Error("OFFSCREEN_START_FAILED");
}

function scheduleOffscreenClose(sessionId) {
  clearTimeout(offscreenCloseTimer);
  offscreenCloseTimer = setTimeout(async () => {
    const current = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
    if (current?.sessionId !== sessionId || !["COMPLETED", "STOPPED", "ERROR"].includes(current.state)) return;
    await chrome.offscreen.closeDocument().catch(() => {});
  }, 100);
}

async function runOffscreenBenchmark(options) {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage({ type: "OFFSCREEN_RUN_BENCHMARK", options });
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function runOffscreenGeneric(options) {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage({ type: "OFFSCREEN_RUN_GENERIC", options });
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function startOffscreenPlayback(macro, options = {}) {
  clearTimeout(offscreenCloseTimer);
  offscreenCloseTimer = null;
  const recorder = await getRecorderSession();
  if ([STATES.RECORDING, STATES.PAUSED].includes(recorder.state)) throw new Error("PLAYBACK_BLOCKED_WHILE_RECORDING");
  const schema = validateMacroSchema(macro);
  const semantic = validateMacro(macro);
  if (!schema.valid || !semantic.valid) throw new Error("MACRO_VALIDATION_FAILED");
  const target = await getTarget();
  if (!target) throw new Error("NO_PINNED_TARGET");
  await getPinnedTargetTab();
  const active = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (active && ZuiPlaybackCore.ACTIVE_STATES.has(active.state)) throw new Error("PLAYBACK_ALREADY_ACTIVE");
  const snapshot = structuredClone(macro);
  if (snapshot.target?.origin && new URL(snapshot.target.origin).origin !== new URL(target.url).origin) throw new Error("MACRO_TARGET_ORIGIN_MISMATCH");
  const settings = ZuiPlaybackCore.normalizeDefaults(options.settings || snapshot.playbackDefaults);
  if (options.mode === "step" || options.mode === "selected") { settings.repeatCount = 1; settings.loopDelayMs = 0; }
  let range = { start: 0, end: snapshot.events.length };
  if (options.mode === "selected" || options.mode === "step") {
    const unit = ZuiPlaybackCore.safeUnitForIndex(snapshot.events, options.index);
    if (!unit.ok) throw new Error(unit.code);
    range = { start: unit.start, end: unit.end };
  }
  if (options.mode === "from") {
    const boundary = ZuiPlaybackCore.playFromBoundary(snapshot.events, options.index);
    if (!boundary.ok) throw new Error(`${boundary.code}:previous=${boundary.previousSafe}:next=${boundary.nextSafe}`);
    range = { start: boundary.start, end: boundary.end };
  }
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_START_PLAYBACK", request: { macro: snapshot, settings, range, mode: options.mode || "continuous", target: { tabId: target.tabId, title: target.title, origin: new URL(target.url).origin } } });
  if (!response?.ok) throw new Error(response?.error || "PLAYBACK_START_FAILED");
  await chrome.storage.local.set({ lastPlayedMacroId: snapshot.id });
  await markRecent(snapshot.id);
  return publicPlaybackStatus(response);
}

async function controlOffscreenPlayback(action, reason) {
  const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_CONTROL_PLAYBACK", action, reason });
  if (!response?.ok) throw new Error(response?.error || "PLAYBACK_CONTROL_FAILED");
  return publicPlaybackStatus(response);
}

async function waitForPlaybackStatus(sessionId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
    if (status?.sessionId === sessionId && !ZuiPlaybackCore.ACTIVE_STATES.has(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("PLAYBACK_STOP_TIMEOUT");
}

async function waitForPlayback(sessionId, timeoutMs = 120000) {
  try {
    return (await waitForPlaybackStatus(sessionId, timeoutMs)).result;
  } catch (cause) {
    if (cause.message !== "PLAYBACK_STOP_TIMEOUT") throw cause;
  }
  await controlOffscreenPlayback("STOP", "legacy_timeout").catch(() => {});
  throw new Error("PLAYBACK_WAIT_TIMEOUT");
}

async function operationIsActive() {
  const recorder = await getRecorderSession();
  const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  return [STATES.RECORDING, STATES.PAUSED].includes(recorder.state)
    || Boolean(playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state));
}

async function getGrantedSiteAccess() {
  const granted = await chrome.permissions.getAll();
  return ZuiSitePermissions.grantedSiteEntries(granted.origins);
}

async function removeSiteAccess(pattern) {
  if (await operationIsActive()) throw new Error("SITE_ACCESS_REMOVE_BLOCKED");
  const sites = await getGrantedSiteAccess();
  if (!sites.some((site) => site.pattern === pattern)) throw new Error("SITE_PERMISSION_REQUIRED");
  const removed = await chrome.permissions.remove({ origins: [pattern] });
  if (!removed) throw new Error("SITE_PERMISSION_REQUIRED");
  const target = await getTarget();
  if (target && ZuiSitePermissions.targetPermission(target.url).pattern === pattern) await chrome.storage.session.remove(TARGET_KEY);
  return { removed, sites: await getGrantedSiteAccess() };
}

async function dispatchMacroEvent(macro, event) {
  const selector = macro.target?.surface?.locator?.value;
  if (["mouseDown", "mouseUp", "mouseMove"].includes(event.type)) {
    const result = await sendToTarget({ type: "DISPATCH_EVENT", selector, event });
    if (!result?.ok) throw new Error(result?.error || "DOM_INPUT_REJECTED");
    return { backend: "DOM_SYNTHETIC", ...result };
  }
  if (["keyDown", "keyUp"].includes(event.type)) return dispatchCdpInput({ kind: "keyEvent", event });
  if (["text", "ime"].includes(event.type)) return dispatchCdpInput({ kind: "text", text: event.value, selector });
  if (event.type === "mouseWheel") {
    return dispatchCdpInput({
      kind: "wheel",
      selector,
      position: event.position,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode
    });
  }
  throw new Error("UNSUPPORTED_PLAYBACK_EVENT");
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const target = await getTarget();
  if (target?.tabId === tabId) {
    const session = await getRecorderSession();
    if ([STATES.RECORDING, STATES.PAUSED].includes(session.state)) await finalizeRecording("target_closed", false).catch(() => {});
    const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
    if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) await controlOffscreenPlayback("STOP", "TARGET_CLOSED").catch(() => {});
    await chrome.storage.session.remove(TARGET_KEY);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const target = await getTarget();
  if (target?.tabId !== tabId) return;
  if (changeInfo.url && ZuiSitePermissions.targetPermission(tab.url || "").origin !== new URL(target.url).origin) {
    const session = await getRecorderSession();
    if ([STATES.RECORDING, STATES.PAUSED].includes(session.state)) await finalizeRecording("target_navigated", false).catch(() => {});
    const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
    if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) await controlOffscreenPlayback("STOP", "TARGET_NAVIGATED").catch(() => {});
    await chrome.storage.session.remove(TARGET_KEY);
    return;
  }
  if (changeInfo.url) {
    target.url = tab.url;
    target.title = tab.title || target.title;
    await chrome.storage.session.set({ [TARGET_KEY]: target });
  }
  if (changeInfo.status === "complete") {
    try {
      await ensureTargetRuntime(tab);
      const session = await getRecorderSession();
      if ([STATES.RECORDING, STATES.PAUSED].includes(session.state)) {
        await sendToTarget({ type: "SET_RECORDER", enabled: session.state === STATES.RECORDING, settings: session.settings, sessionId: session.sessionId });
      }
    } catch (cause) {
      await recordDiagnostic({ code: ZuiHardening.codeFromError(cause), message: cause.message, targetOrigin: new URL(target.url).origin, context: { lifecycle: "tab_reload" } }).catch(() => {});
    }
  }
});

chrome.permissions.onRemoved.addListener(async () => {
  const target = await getTarget();
  if (!target) return;
  const access = await ZuiSitePermissions.hasSiteAccess(target.url, chrome.permissions).catch(() => ({ granted: false }));
  if (access.granted) return;
  const session = await getRecorderSession();
  if ([STATES.RECORDING, STATES.PAUSED].includes(session.state)) await finalizeRecording("site_permission_removed", false).catch(() => {});
  const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state)) await controlOffscreenPlayback("STOP", "SITE_PERMISSION_REQUIRED").catch(() => {});
  await detachAllDebuggers();
  await chrome.storage.session.remove(TARGET_KEY);
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await startupRecovery;
    if (message.type === "PIN_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { ok: true, target: await pinTab(tab) };
    }
    if (message.type === "PIN_TAB_BY_ID") return { ok: true, target: await pinTab(await chrome.tabs.get(message.tabId)) };
    if (message.type === "GET_TARGET") return { ok: true, target: await getTarget() };
    if (message.type === "CLEAR_TARGET") {
      const recorder = await getRecorderSession();
      const playback = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
      if ([STATES.RECORDING, STATES.PAUSED].includes(recorder.state) || (playback && ZuiPlaybackCore.ACTIVE_STATES.has(playback.state))) throw new Error("CONCURRENT_OPERATION_BLOCKED");
      await chrome.storage.session.remove(TARGET_KEY); return { ok: true, target: null };
    }
    if (message.type === "FOCUS_TARGET") {
      const target = await getTarget();
      if (!target) throw new Error("NO_PINNED_TARGET");
      await chrome.windows.update(target.windowId, { focused: true });
      await chrome.tabs.update(target.tabId, { active: true });
      return { ok: true };
    }
    if (message.type === "GET_PRODUCT_SETTINGS") return { ok: true, settings: await getProductSettings() };
    if (message.type === "SET_PRODUCT_SETTINGS") { const settings = ZuiProduct.normalizeSettings(message.settings); await safeLocalSet({ [PRODUCT_SETTINGS_KEY]: settings, [SETTINGS_KEY]: settings.recording }); return { ok: true, settings }; }
    if (message.type === "RESET_PRODUCT_SETTINGS") { const settings = ZuiProduct.normalizeSettings(ZuiProduct.DEFAULT_SETTINGS); await safeLocalSet({ [PRODUCT_SETTINGS_KEY]: settings, [SETTINGS_KEY]: settings.recording }); return { ok: true, settings }; }
    if (message.type === "GET_SITE_ACCESS") return { ok: true, sites: await getGrantedSiteAccess() };
    if (message.type === "REMOVE_SITE_ACCESS") return { ok: true, ...(await removeSiteAccess(message.pattern)) };
    if (message.type === "GET_RECORDER_STATUS") return { ok: true, status: publicRecorderStatus(await getRecorderSession()) };
    if (message.type === "GET_RECORDER_SETTINGS") {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      const product = await getProductSettings();
      return { ok: true, settings: normalizeSettings(stored[SETTINGS_KEY] || product.recording) };
    }
    if (message.type === "START_RECORDING") return { ok: true, status: publicRecorderStatus(await startRecording(message)) };
    if (message.type === "PAUSE_RECORDING") return { ok: true, status: publicRecorderStatus(await pauseRecording()) };
    if (message.type === "RESUME_RECORDING") return { ok: true, status: publicRecorderStatus(await resumeRecording()) };
    if (message.type === "STOP_RECORDING") return { ok: true, status: publicRecorderStatus(await finalizeRecording()) };
    if (message.type === "CANCEL_RECORDING") return { ok: true, status: publicRecorderStatus(await cancelRecording()) };
    if (message.type === "RECORDER_CAPTURE") {
      await acceptCapture(message, sender);
      return { ok: true };
    }
    if (message.type === "RECORDER_WARNING") {
      await acceptWarning(message, sender);
      return { ok: true };
    }
    if (message.type === "GET_MACROS") {
      const [{ valid: macros, quarantine }, stored] = await Promise.all([loadMacroLibrary(), chrome.storage.local.get([LAST_RESULT_KEY, RECENT_KEY])]);
      return { ok: true, macros, quarantine, recentMacroIds: stored[RECENT_KEY] || [], lastResult: stored[LAST_RESULT_KEY] || null };
    }
    if (message.type === "MARK_MACRO_RECENT") return { ok: true, recentMacroIds: await markRecent(message.id) };
    if (message.type === "GET_LIBRARY_BACKUP") { const { valid: macros } = await loadMacroLibrary(); return { ok: true, backup: ZuiProduct.createLibraryBackup(macros) }; }
    if (message.type === "RESTORE_LIBRARY_BACKUP") {
      const backup = structuredClone(message.backup);
      const validation = ZuiProduct.validateLibraryBackup(backup, validateMacro);
      const { valid: existing } = await loadMacroLibrary();
      const validRows = Array.isArray(backup?.macros) ? backup.macros.filter((_, index) => validation.rows[index]?.valid) : [];
      const conflicts = validRows.filter((macro) => existing.some((item) => item.id === macro.id || item.name.toLocaleLowerCase() === macro.name.toLocaleLowerCase())).map((macro) => ({ id: macro.id, name: macro.name }));
      if (message.preview) return { ok: true, validCount: validRows.length, invalidCount: validation.rows.filter((row) => !row.valid).length + validation.errors.length, conflicts, validation };
      const plan = ZuiProduct.planLibraryRestore(existing, backup, message.conflictPolicy, validateMacro);
      if (!plan.ok) throw new Error(plan.errorCode);
      await safeLocalSet({ [MACROS_KEY]: plan.macros });
      return { ok: true, restored: plan.restored, skipped: plan.skipped, rejected: plan.rejected, conflicts: plan.conflicts };
    }
    if (message.type === "GET_DIAGNOSTIC_REPORT") {
      const [session, local, platform] = await Promise.all([chrome.storage.session.get([DIAGNOSTICS_KEY, PLAYBACK_KEY]), chrome.storage.local.get(QUARANTINE_KEY), chrome.runtime.getPlatformInfo()]);
      return { ok: true, report: ZuiHardening.redact({ extensionVersion: chrome.runtime.getManifest().version, platform, generatedAt: new Date().toISOString(), playback: publicPlaybackStatus(session[PLAYBACK_KEY]), diagnostics: session[DIAGNOSTICS_KEY] || [], quarantine: local[QUARANTINE_KEY] || [] }) };
    }
    if (message.type === "CLEAR_DIAGNOSTICS") { await chrome.storage.session.remove(DIAGNOSTICS_KEY); return { ok: true }; }
    if (message.type === "SAVE_MACRO") return { ok: true, macro: await saveEditedMacro(message.macro, message.allowReplace !== false) };
    if (message.type === "REBIND_MACRO") return { ok: true, macro: await rebindMacro(message.macro, message.mode) };
    if (message.type === "DELETE_MACRO") return { ok: true, result: await deleteMacro(message.id) };
    if (message.type === "START_PLAYBACK") return { ok: true, status: await startOffscreenPlayback(message.macro, message.options) };
    if (message.type === "PLAY_MACRO") {
      const status = await startOffscreenPlayback(message.macro, message.options);
      return { ok: true, result: await waitForPlayback(status.sessionId) };
    }
    if (message.type === "GET_PLAYBACK_STATUS") {
      await reconcileStalePlayback(false);
      return { ok: true, status: publicPlaybackStatus((await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY]) };
    }
    if (message.type === "PAUSE_PLAYBACK") return { ok: true, status: await controlOffscreenPlayback("PAUSE") };
    if (message.type === "RESUME_PLAYBACK") return { ok: true, status: await controlOffscreenPlayback("RESUME") };
    if (message.type === "STOP_PLAYBACK") {
      const stopping = await controlOffscreenPlayback("STOP", message.reason || "user_stop");
      const status = await waitForPlaybackStatus(stopping.sessionId, 10000);
      await detachAllDebuggers();
      return { ok: true, status };
    }
    if (message.type === "PLAYBACK_STATUS_UPDATE") {
      const status = structuredClone(message.status);
      if (status?.state === "ERROR" && status.errorCode) {
        status.errorMessage = String(status.errorCode).slice(0, 240);
        status.errorCode = ZuiHardening.codeFromError(status.errorCode);
        if (status.result) status.result.errorCode = status.errorCode;
      }
      await chrome.storage.session.set({ [PLAYBACK_KEY]: status });
      if (["COMPLETED", "STOPPED", "ERROR"].includes(status?.state)) {
        if (status?.state === "ERROR") {
          await detachAllDebuggers();
          await recordDiagnostic({ code: status.errorCode, message: status.errorMessage || status.errorCode, macroId: status.macroId, eventIndex: status.eventIndex, iteration: status.iteration, targetOrigin: status.target?.origin, context: { reason: status.reason } });
        }
        scheduleOffscreenClose(status.sessionId);
      }
      return { ok: true };
    }
    if (message.type === "TARGET_COMMAND") return { ok: true, result: await sendToTarget(message.command) };
    if (message.type === "DISPATCH_INPUT") {
      const backend = INPUT_BACKENDS[message.backend];
      if (!backend) throw new Error("UNKNOWN_INPUT_BACKEND");
      return { ok: true, result: await backend(message.action) };
    }
    if (message.type === "CDP_ATTACH_FOR_CLOSE_TEST") {
      const tab = await chrome.tabs.get(message.tabId);
      await ZuiSitePermissions.requireSiteAccess(tab.url, chrome.permissions);
      await attachDebugger(tab.id);
      return { ok: true, tabId: tab.id };
    }
    if (message.type === "GET_CDP_STATE") return { ok: true, sessions: [...debuggerSessions], detachEvents: debuggerDetachEvents.slice() };
    if (message.type === "GET_RUNTIME_HEALTH") {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      return { ok: true, offscreenContexts: contexts.length, debuggerSessions: [...debuggerSessions], playback: publicPlaybackStatus((await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY]), recorder: publicRecorderStatus(await getRecorderSession()) };
    }
    if (message.type === "RUN_OFFSCREEN_BENCHMARK") return { ok: true, result: await runOffscreenBenchmark(message.options) };
    if (message.type === "RUN_OFFSCREEN_GENERIC") return { ok: true, result: await runOffscreenGeneric(message.options) };
    if (message.type === "OFFSCREEN_PLAY_EVENT") return { ok: true, result: await dispatchMacroEvent(message.macro, message.event) };
    if (message.type === "OFFSCREEN_CLEANUP_INPUTS") {
      const rows = [];
      for (const event of message.events || []) rows.push(await dispatchMacroEvent(message.macro, event));
      return { ok: true, rows };
    }
    if (message.type === "OFFSCREEN_DISPATCH_TICK") return { ok: true, result: await sendToTarget({ type: "DISPATCH_BENCHMARK_EVENT", index: message.index }) };
    if (message.type === "OFFSCREEN_GENERIC_TICK") return { ok: true, result: await sendToTarget({ type: "GENERIC_ACTION", action: message.action, index: message.index }) };
    throw new Error("UNKNOWN_MESSAGE");
  })().then(sendResponse).catch(async (cause) => {
    const target = await getTarget().catch(() => null);
    const code = ZuiHardening.codeFromError(cause);
    const diagnostic = await recordDiagnostic({ code, message: cause.message, macroId: message.macro?.id || null, eventIndex: message.index ?? null, iteration: null, targetOrigin: target ? new URL(target.url).origin : null, context: cause.diagnosticContext || { messageType: message.type } }).catch(() => null);
    sendResponse({ ok: false, error: cause.message, errorCode: code, diagnostic });
  });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const status = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
    if (command === "stop-playback" && status && ZuiPlaybackCore.ACTIVE_STATES.has(status.state)) return controlOffscreenPlayback("STOP", "hotkey_stop");
    const recorder = await getRecorderSession();
    if (command === "abort-recording" && [STATES.RECORDING, STATES.PAUSED].includes(recorder.state)) return cancelRecording();
    if (command === "toggle-recording") {
      if (recorder.state === STATES.RECORDING) return pauseRecording();
      if (recorder.state === STATES.PAUSED) return resumeRecording();
      return startRecording({ name: "Recorded macro" });
    }
    if (!["toggle-playback", "step-playback"].includes(command)) return;
    if (command === "toggle-playback" && (status?.state === "RUNNING" || status?.state === "PAUSE_PENDING")) return controlOffscreenPlayback("PAUSE");
    if (command === "toggle-playback" && status?.state === "PAUSED") return controlOffscreenPlayback("RESUME");
    if (status && ZuiPlaybackCore.ACTIVE_STATES.has(status.state)) return;
    const stored = await chrome.storage.local.get([MACROS_KEY, "lastPlayedMacroId"]);
    const macros = stored[MACROS_KEY] || [];
    const macro = macros.find((item) => item.id === stored.lastPlayedMacroId) || macros[0];
    if (!macro) return;
    if (command === "step-playback") {
      const previousEnd = status?.mode === "step" && status?.macroId === macro.id && status?.state === "COMPLETED" ? status.range?.end : 0;
      const index = Number.isInteger(previousEnd) && previousEnd < macro.events.length ? previousEnd : 0;
      return startOffscreenPlayback(macro, { mode: "step", index });
    }
    await startOffscreenPlayback(macro);
  } catch (_) {}
});

async function reconcileStalePlayback(workerRestart = false) {
  const status = (await chrome.storage.session.get(PLAYBACK_KEY))[PLAYBACK_KEY];
  if (!status || !ZuiPlaybackCore.ACTIVE_STATES.has(status.state)) return;
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length && !workerRestart) return;
  if (contexts.length && workerRestart) {
    chrome.runtime.sendMessage({ type: "OFFSCREEN_CONTROL_PLAYBACK", action: "STOP", reason: "service_worker_restarted" }).catch(() => {});
    await detachAllDebuggers();
    await recordDiagnostic({ code: "SERVICE_WORKER_RESTART", message: "Active playback was stopped after service-worker restart.", macroId: status.macroId, eventIndex: status.eventIndex, iteration: status.iteration, targetOrigin: status.target?.origin });
    return;
  }
  const macro = { target: { surface: { locator: { value: status.surfaceSelector } } } };
  for (const event of status.runtimeCleanup || []) await dispatchMacroEvent(macro, event).catch(() => {});
  const recovered = { ...status, state: "ERROR", reason: "offscreen_lost", errorCode: "OFFSCREEN_LOST", heldInputs: 0, runtimeCleanup: [], updatedAt: new Date().toISOString() };
  await chrome.storage.session.set({ [PLAYBACK_KEY]: recovered });
  await detachAllDebuggers();
  await recordDiagnostic({ code: "OFFSCREEN_LOST", message: "Active playback lost its offscreen scheduler and was stopped.", macroId: status.macroId, eventIndex: status.eventIndex, iteration: status.iteration, targetOrigin: status.target?.origin });
}
async function reconcileStaleRecorder() {
  const recorder = await getRecorderSession();
  if (![STATES.RECORDING, STATES.PAUSED].includes(recorder.state)) return;
  const targetState = await sendToTarget({ type: "GET_RECORDER_STATE" }).catch(() => null);
  const expectedEnabled = recorder.state === STATES.RECORDING;
  const recorderAlive = Boolean(
    targetState?.ok
    && targetState.sessionId === recorder.sessionId
    && targetState.recorderEnabled === expectedEnabled
  );
  const decision = ZuiHardening.recoveryDecision({ recorder, recorderAlive });
  if (!decision.cleanup) return;
  await sendToTarget({ type: "SET_RECORDER", enabled: false, settings: recorder.settings, sessionId: recorder.sessionId }).catch(() => {});
  await saveRecorderSession({ state: STATES.IDLE, reason: "service_worker_restarted", recoveredAt: new Date().toISOString() });
  await recordDiagnostic({ code: "SERVICE_WORKER_RESTART", message: "Stale recorder session was stopped after service-worker restart.", targetOrigin: recorder.target?.origin });
}
startupRecovery = Promise.all([reconcileStalePlayback(true), reconcileStaleRecorder()]).catch(() => {});
