(function initializeContentRuntime(global) {
"use strict";

if (global.__ZUI_CONTENT_RUNTIME__) return;
global.__ZUI_CONTENT_RUNTIME__ = Object.freeze({ version: "0.6.0" });

const { denormalizePoint, hashText } = globalThis.ZuiPoc;
const { normalizeCapturedPoint, buttonName, modifiersOf, isSensitiveElement, shouldCaptureMove } = globalThis.ZuiRecorderCore;
const captureLog = [];
let recorderConfig = { enabled: false, settings: null, sessionId: null, surfaceSelector: null, surfaceLocked: false };
let lastMove = null;
let dragging = false;
let sensitiveWarningSent = false;
let captureSendQueue = Promise.resolve();

function sendCapture(capture) {
  captureSendQueue = captureSendQueue.then(() => chrome.runtime.sendMessage({
    type: "RECORDER_CAPTURE",
    sessionId: recorderConfig.sessionId,
    capture
  })).catch(() => {});
}

function findSurface(eventTarget = null) {
  const interacted = eventTarget?.closest?.("[data-zui-surface], canvas");
  if (interacted) return interacted;
  const explicitCanvas = document.querySelector("canvas[data-zui-surface]");
  if (explicitCanvas) return explicitCanvas;
  const explicit = document.querySelector("[data-zui-surface]");
  if (explicit) return explicit;
  return document.documentElement;
}

function stableSelector(element) {
  if (element === element.ownerDocument?.documentElement) return "html";
  const local = element.id && globalThis.CSS?.escape ? `#${CSS.escape(element.id)}` : element.hasAttribute("data-zui-surface") ? "[data-zui-surface]" : (() => {
    const tag = element.tagName.toLowerCase();
    const siblings = [...(element.parentElement?.children || [])].filter((candidate) => candidate.tagName === element.tagName);
    return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})` : tag;
  })();
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) return `${stableSelector(root.host)} >>> ${local}`;
  if (!local.startsWith("#") && element.parentElement?.id && globalThis.CSS?.escape) return `#${CSS.escape(element.parentElement.id)} > ${local}`;
  return local;
}

function portableSelector(element) {
  const frames = [];
  let current = element?.ownerDocument?.defaultView || window;
  while (current !== current.top) {
    const frame = current.frameElement;
    if (!frame) throw new Error("CROSS_ORIGIN_FRAME_UNSUPPORTED");
    frames.unshift(stableSelector(frame));
    current = current.parent;
  }
  return [...frames, stableSelector(element)].join(" ::frame:: ");
}

function resolutionError(code, reason, trace) {
  const error = new Error(code);
  error.reason = reason;
  if (trace) {
    trace.compatibility = "FAIL";
    trace.failureReason = reason;
  }
  return error;
}

function resolveElement(selector, trace = null) {
  if (typeof selector !== "string" || !selector) throw new Error("TARGET_SELECTOR_REQUIRED");
  const frameParts = selector.split(/\s*::frame::\s*/);
  if (window !== window.top && frameParts.length > 1) return resolveElement(frameParts.at(-1), trace);
  let root = document;
  for (const [index, frameSelector] of frameParts.slice(0, -1).entries()) {
    let frame = null;
    try { frame = root.querySelector(frameSelector); }
    catch (_) { throw resolutionError("TARGET_ELEMENT_NOT_FOUND", "LOCATOR_INVALID", trace); }
    if (!frame) throw resolutionError("TARGET_ELEMENT_NOT_FOUND", "FRAME_LOCATOR_FAILED", trace);
    const frameTag = frame.localName?.toLowerCase() || "unknown";
    if (frameTag !== "iframe") throw resolutionError("CROSS_ORIGIN_FRAME_UNSUPPORTED", "FRAME_ENTER_FAILED", trace);
    let nextRoot = null;
    try { nextRoot = frame.contentDocument; } catch (_) {}
    if (!nextRoot) throw resolutionError("CROSS_ORIGIN_FRAME_UNSUPPORTED", "FRAME_ENTER_FAILED", trace);
    trace?.steps.push({ segment: index + 1, selector: frameSelector, result: "FOUND", tag: frameTag, frameEnter: "SUCCESS" });
    root = nextRoot;
  }
  let element = null;
  for (const part of frameParts.at(-1).split(/\s*>>>\s*/)) {
    if (!root) { element = null; break; }
    try { element = root.querySelector(part); }
    catch (_) { throw resolutionError("TARGET_ELEMENT_NOT_FOUND", "LOCATOR_INVALID", trace); }
    if (!element) break;
    root = element.shadowRoot;
  }
  if (!element) throw resolutionError("TARGET_ELEMENT_NOT_FOUND", "LOCATOR_NOT_FOUND", trace);
  trace?.steps.push({ segment: frameParts.length, selector: frameParts.at(-1), result: "FOUND", tag: element.localName?.toLowerCase() || "unknown" });
  return element;
}

function canvasFingerprint(element) {
  if (!(element instanceof HTMLCanvasElement)) return null;
  const snapshot = element.toDataURL("image/png");
  return {
    width: element.width,
    height: element.height,
    snapshotBytes: snapshot.length,
    snapshotHash: hashText(snapshot)
  };
}

function elementState(element, countSelector) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const state = {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    active: document.activeElement === element,
    checked: "checked" in element ? Boolean(element.checked) : null,
    value: element instanceof HTMLInputElement && element.type === "password" ? "[REDACTED]" : ("value" in element ? String(element.value) : null),
    selectedIndex: "selectedIndex" in element ? element.selectedIndex : null,
    ariaExpanded: element.getAttribute("aria-expanded"),
    visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
    scroll: { elementTop: element.scrollTop || 0, documentTop: document.scrollingElement?.scrollTop || 0 },
    css: { transform: style.transform, zoom: style.zoom || "normal" },
    count: countSelector ? document.querySelectorAll(countSelector).length : null,
    canvas: canvasFingerprint(element)
  };
  return state;
}

function pointFields(element, position, button = 0, buttons = 0) {
  const rect = element.getBoundingClientRect();
  const point = denormalizePoint(position || { x: 0.5, y: 0.5 }, rect);
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: point.clientX,
    clientY: point.clientY,
    screenX: point.clientX,
    screenY: point.clientY,
    button,
    buttons,
    detail: 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    pressure: buttons ? 0.5 : 0
  };
}

async function withEventLog(names, operation) {
  const rows = [];
  const listeners = names.map((name) => {
    const listener = (event) => rows.push({ type: event.type, isTrusted: event.isTrusted, defaultPrevented: event.defaultPrevented });
    document.addEventListener(name, listener, true);
    return [name, listener];
  });
  try {
    await operation();
    await Promise.resolve();
    await Promise.resolve();
    return rows;
  } finally {
    for (const [name, listener] of listeners) document.removeEventListener(name, listener, true);
  }
}

async function genericClick(action) {
  const element = resolveElement(action.selector);
  const before = elementState(element, action.countSelector);
  const fieldsDown = pointFields(element, action.position, 0, 1);
  const fieldsUp = pointFields(element, action.position, 0, 0);
  const events = await withEventLog(["pointerdown", "mousedown", "pointerup", "mouseup", "click", "change"], async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", fieldsDown));
    element.dispatchEvent(new MouseEvent("mousedown", fieldsDown));
    element.dispatchEvent(new PointerEvent("pointerup", fieldsUp));
    element.dispatchEvent(new MouseEvent("mouseup", fieldsUp));
    element.dispatchEvent(new MouseEvent("click", fieldsUp));
  });
  return { kind: "click", before, after: elementState(element, action.countSelector), events };
}

async function genericWheel(action) {
  const element = resolveElement(action.selector);
  const before = elementState(element, action.countSelector);
  const fields = pointFields(element, action.position, 0, 0);
  const events = await withEventLog(["wheel", "scroll"], async () => {
    element.dispatchEvent(new WheelEvent("wheel", { ...fields, deltaX: action.deltaX || 0, deltaY: action.deltaY || 120, deltaMode: 0 }));
  });
  return { kind: "wheel", before, after: elementState(element, action.countSelector), events };
}

async function genericKeyboard(action) {
  const element = resolveElement(action.selector);
  if (element instanceof HTMLInputElement && element.type === "password") throw new Error("SENSITIVE_INPUT_BLOCKED");
  element.focus();
  if (action.clear && "value" in element) element.value = "";
  const before = elementState(element, action.countSelector);
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: action.key || "a",
    code: action.code || "KeyA",
    location: action.location || 0
  };
  const events = await withEventLog(["keydown", "beforeinput", "input", "keyup", "change"], async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", init));
    element.dispatchEvent(new KeyboardEvent("keyup", init));
  });
  return { kind: "keyboard", before, after: elementState(element, action.countSelector), events, selection: { start: element.selectionStart ?? null, end: element.selectionEnd ?? null } };
}

function genericFocus(action) {
  const element = resolveElement(action.selector);
  if (element instanceof HTMLInputElement && element.type === "password") throw new Error("SENSITIVE_INPUT_BLOCKED");
  element.focus();
  if (action.clear && "value" in element) {
    element.value = "";
    if (typeof element.setSelectionRange === "function") element.setSelectionRange(0, 0);
  }
  return { kind: "focus", state: elementState(element, action.countSelector) };
}

async function genericStroke(action) {
  const element = resolveElement(action.selector);
  const points = Array.isArray(action.points) && action.points.length >= 2 ? action.points : [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];
  const before = elementState(element, action.countSelector);
  const events = await withEventLog(["pointerdown", "mousedown", "pointermove", "mousemove", "pointerup", "mouseup", "click"], async () => {
    const first = pointFields(element, points[0], 0, 1);
    element.dispatchEvent(new PointerEvent("pointerdown", first));
    element.dispatchEvent(new MouseEvent("mousedown", first));
    for (const point of points.slice(1)) {
      const move = pointFields(element, point, 0, 1);
      element.dispatchEvent(new PointerEvent("pointermove", move));
      element.dispatchEvent(new MouseEvent("mousemove", move));
    }
    const last = pointFields(element, points.at(-1), 0, 0);
    element.dispatchEvent(new PointerEvent("pointerup", last));
    element.dispatchEvent(new MouseEvent("mouseup", last));
    element.dispatchEvent(new MouseEvent("click", last));
  });
  return { kind: "stroke", before, after: elementState(element, action.countSelector), requestedPoints: points, events };
}

async function runGenericAction(action) {
  if (!action || typeof action !== "object") throw new Error("INVALID_GENERIC_ACTION");
  if (action.kind === "inspect") {
    const element = resolveElement(action.selector);
    return { kind: "inspect", state: elementState(element, action.countSelector) };
  }
  if (action.kind === "click") return genericClick(action);
  if (action.kind === "wheel") return genericWheel(action);
  if (action.kind === "keyboard") return genericKeyboard(action);
  if (action.kind === "focus") return genericFocus(action);
  if (action.kind === "stroke") return genericStroke(action);
  throw new Error("UNKNOWN_GENERIC_ACTION");
}

function surfaceInfo(surface) {
  const viewport = surface === surface.ownerDocument?.documentElement;
  const rect = viewport ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : surface.getBoundingClientRect();
  return {
    selector: portableSelector(surface),
    kind: globalThis.ZuiHardening.surfaceKind(surface.localName, viewport),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    devicePixelRatio: window.devicePixelRatio
  };
}

function resolvePortableSurface(selector, trace = null) {
  const surface = selector === "html" ? document.documentElement : resolveElement(selector, trace);
  return { surface, descriptor: surfaceInfo(surface) };
}

function resolveRebindSurface(sourceSurface) {
  const selector = sourceSurface?.locator?.value;
  const expectedKind = sourceSurface?.kind;
  const trace = { event: "REBIND_RESOLVE_BEGIN", source: { kind: expectedKind || null, locator: selector || null }, destination: { topOrigin: location.origin }, steps: [] };
  const incompatible = (reason) => ({ compatible: false, error: "REBIND_SURFACE_INCOMPATIBLE", reason, trace: { ...trace, compatibility: "FAIL", failureReason: reason } });
  if (!selector || !["viewport", "canvas", "container"].includes(expectedKind)) return incompatible("INVALID_SOURCE_SURFACE");
  let surface;
  let resolved;
  try { ({ surface, descriptor: resolved } = resolvePortableSurface(selector, trace)); }
  catch (cause) { return incompatible(cause?.reason || "LOCATOR_NOT_FOUND"); }
  const style = surface === surface.ownerDocument?.documentElement ? null : surface.ownerDocument?.defaultView?.getComputedStyle(surface);
  const nonZeroRect = resolved.rect.width > 0 && resolved.rect.height > 0;
  const cssVisible = !style || (style.display !== "none" && style.visibility !== "hidden");
  trace.resolved = {
    tag: surface.localName?.toLowerCase() || "unknown",
    kind: resolved.kind,
    locator: resolved.selector,
    rect: resolved.rect,
    devicePixelRatio: resolved.devicePixelRatio,
    visibility: { display: style?.display || null, visibility: style?.visibility || null, documentVisibility: document.visibilityState, nonZeroRect, cssVisible }
  };
  const decision = globalThis.ZuiHardening.rebindSurfaceCompatibility({ expectedKind, resolvedKind: resolved.kind, rect: resolved.rect, display: style?.display || null, visibility: style?.visibility || null });
  if (!decision.compatible) return incompatible(decision.reason);
  trace.compatibility = "PASS";
  return { ...resolved, selector, compatible: true, compatibility: { expectedKind, locatorMatched: selector === resolved.selector, visible: true }, trace };
}

function resolvePlaybackSurface(selector) {
  return resolvePortableSurface(selector).surface;
}

function pointerFields(surface, position, button, buttons) {
  const rect = surface === document.documentElement
    ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
    : surface.getBoundingClientRect();
  const point = denormalizePoint(position, rect);
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: point.clientX,
    clientY: point.clientY,
    button,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true
  };
}

function dispatchMouse(surface, event) {
  const buttonMap = { left: 0, middle: 1, right: 2, none: -1 };
  const button = buttonMap[event.button || "left"] ?? 0;
  const buttons = event.type === "mouseUp" ? 0 : (event.buttons ?? (button === 0 ? 1 : 0));
  const fields = pointerFields(surface, event.position, button, buttons);
  const target = surface === document.documentElement
    ? (document.elementFromPoint(fields.clientX, fields.clientY) || document.body)
    : surface;
  const map = {
    mouseDown: ["pointerdown", "mousedown"],
    mouseUp: ["pointerup", "mouseup", "click"],
    mouseMove: ["pointermove", "mousemove"]
  };
  if (event.type === "mouseDown" && typeof target.focus === "function") target.focus({ preventScroll: true });
  if (event.type === "mouseWheel") {
    target.dispatchEvent(new WheelEvent("wheel", { ...fields, deltaX: event.deltaX || 0, deltaY: event.deltaY || 0, deltaMode: event.deltaMode || 0 }));
  } else {
    for (const name of map[event.type] || []) {
      const Constructor = name.startsWith("pointer") ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Constructor(name, fields));
    }
  }
  return { ...surfaceInfo(surface), target: target.id || target.tagName.toLowerCase(), point: { x: event.position.x, y: event.position.y, clientX: fields.clientX, clientY: fields.clientY } };
}

function dispatchKeyboard(event) {
  const target = (event.targetSelector && document.querySelector(event.targetSelector)) || document.activeElement || document.body;
  if (target instanceof HTMLInputElement && target.type === "password") throw new Error("SENSITIVE_INPUT_BLOCKED");
  if (typeof target.focus === "function") target.focus();
  const domType = event.type === "keyDown" ? "keydown" : "keyup";
  const accepted = target.dispatchEvent(new KeyboardEvent(domType, {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: event.key || "",
    code: event.code || "",
    location: event.location || 0,
    repeat: Boolean(event.repeat),
    ctrlKey: event.modifiers?.includes("Control"),
    altKey: event.modifiers?.includes("Alt"),
    shiftKey: event.modifiers?.includes("Shift"),
    metaKey: event.modifiers?.includes("Meta")
  }));
  return { eventType: domType, accepted, target: target.id || target.tagName.toLowerCase(), isTrustedExpected: false };
}

async function warnSensitiveInput() {
  if (sensitiveWarningSent) return;
  sensitiveWarningSent = true;
  await chrome.runtime.sendMessage({ type: "RECORDER_WARNING", sessionId: recorderConfig.sessionId, warning: "SENSITIVE_INPUT_BLOCKED" }).catch(() => {});
}

function handleCapture(event) {
  if (!recorderConfig.enabled || !event.isTrusted) return;
  const composedTarget = event.composedPath?.()[0] || event.target;
  if (isSensitiveElement(composedTarget)) {
    void warnSensitiveInput();
    return;
  }
  if (event.type === "keydown" || event.type === "keyup") {
    if (!recorderConfig.settings.keyboard) return;
    const capture = {
      type: event.type === "keydown" ? "keyDown" : "keyUp",
      at: performance.now(),
      key: event.key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      modifiers: modifiersOf(event)
    };
    if (!captureLog.some((item) => item.sessionId === recorderConfig.sessionId && item.surface)) {
      try { capture.surface = surfaceInfo(findSurface(composedTarget)); }
      catch (cause) {
        if (cause?.message === "CROSS_ORIGIN_FRAME_UNSUPPORTED") void chrome.runtime.sendMessage({ type: "RECORDER_WARNING", sessionId: recorderConfig.sessionId, warning: "CROSS_ORIGIN_FRAME_UNSUPPORTED" }).catch(() => {});
        return;
      }
    }
    capture.sessionId = recorderConfig.sessionId;
    captureLog.push(capture);
    sendCapture(capture);
    return;
  }
  if (event.type === "wheel" && !recorderConfig.settings.wheel) return;
  if (event.type !== "wheel" && !recorderConfig.settings.mouse) return;
  const surface = recorderConfig.surfaceLocked && recorderConfig.surfaceSelector ? resolvePlaybackSurface(recorderConfig.surfaceSelector) : findSurface(composedTarget);
  if (!surface) return;
  try {
    const rect = surface === document.documentElement
      ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
      : surface.getBoundingClientRect();
    const capture = {
      type: ({ pointerdown: "mouseDown", pointerup: "mouseUp", pointermove: "mouseMove", wheel: "mouseWheel" })[event.type],
      at: performance.now(),
      position: normalizeCapturedPoint(event.clientX, event.clientY, rect),
      button: event.type === "wheel" ? "none" : buttonName(event.button),
      buttons: event.buttons || 0,
      modifiers: modifiersOf(event)
    };
    if (!captureLog.some((item) => item.sessionId === recorderConfig.sessionId && item.surface)) capture.surface = surfaceInfo(surface);
    capture.sessionId = recorderConfig.sessionId;
    if (event.type === "pointerdown") dragging = true;
    if (event.type === "pointermove") {
      if (!shouldCaptureMove({ settings: recorderConfig.settings, dragging, previous: lastMove, current: capture })) return;
      lastMove = capture;
    }
    // An ignored hover must not choose the portable playback surface. In
    // clicks-only mode the popup closing can produce a pointermove over an
    // unrelated element before the user's first real click.
    if (!recorderConfig.surfaceLocked) {
      recorderConfig.surfaceSelector = portableSelector(surface);
      recorderConfig.surfaceLocked = true;
    }
    if (event.type === "pointerup") dragging = false;
    if (event.type === "wheel") {
      capture.deltaX = event.deltaX;
      capture.deltaY = event.deltaY;
      capture.deltaMode = event.deltaMode;
    }
    captureLog.push(capture);
    sendCapture(capture);
  } catch (cause) {
    // Fail closed: invalid geometry is not recorded.
    if (cause?.message === "CROSS_ORIGIN_FRAME_UNSUPPORTED") void chrome.runtime.sendMessage({ type: "RECORDER_WARNING", sessionId: recorderConfig.sessionId, warning: "CROSS_ORIGIN_FRAME_UNSUPPORTED" }).catch(() => {});
  }
}

for (const name of ["pointerdown", "pointerup", "pointermove", "wheel", "keydown", "keyup"]) {
  document.addEventListener(name, handleCapture, true);
}

async function measureTimers({ samples = 12, intervalMs = 100 } = {}) {
  const rows = [];
  let previous = performance.now();
  for (let index = 0; index < samples; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const now = performance.now();
    rows.push({ index, requestedMs: intervalMs, actualMs: now - previous, visibilityState: document.visibilityState });
    previous = now;
  }
  const maxDriftMs = Math.max(...rows.map((row) => row.actualMs - row.requestedMs));
  return { rows, maxDriftMs, hiddenSamples: rows.filter((row) => row.visibilityState === "hidden").length };
}

function dispatchBenchmarkEvent(index) {
  const surface = findSurface();
  if (!surface) throw new Error("TARGET_SURFACE_NOT_FOUND");
  const result = dispatchMouse(surface, {
    type: "mouseMove",
    button: "none",
    buttons: 0,
    position: { x: 0.25, y: 0.75 }
  });
  return {
    index,
    arrivedAt: performance.now(),
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    point: result.point
  };
}

async function runContentBenchmark({ events = 31, intervalMs = 100 } = {}) {
  if (!Number.isInteger(events) || events < 2) throw new Error("INVALID_EVENT_COUNT");
  const rows = [];
  const startedAt = performance.now();
  for (let index = 0; index < events; index += 1) {
    if (index > 0) {
      const dueAt = startedAt + index * intervalMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt - performance.now())));
    }
    rows.push(dispatchBenchmarkEvent(index));
  }
  return { scheduler: "CONTENT_SCRIPT", intervalMs, rows };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "ZUI_RUNTIME_PING") return { runtime: "ZUI_CONTENT_RUNTIME", version: global.__ZUI_CONTENT_RUNTIME__.version };
    if (message.type === "GET_RECORDER_STATE") {
      return {
        recorderEnabled: recorderConfig.enabled,
        sessionId: recorderConfig.sessionId,
        surfaceSelector: recorderConfig.surfaceSelector,
        surfaceLocked: recorderConfig.surfaceLocked
      };
    }
    if (message.type === "CHECK_PLAYBACK_TEXT_TARGET") {
      const declared = message.selector ? resolvePlaybackSurface(message.selector) : null;
      if (isSensitiveElement(document.activeElement) || isSensitiveElement(declared)) throw new Error("SENSITIVE_INPUT_BLOCKED");
      return { safe: true };
    }
    if (message.type === "GENERIC_ACTION") {
      const result = await runGenericAction(message.action);
      return { ...result, index: message.index ?? null, arrivedAt: performance.now(), visibilityState: document.visibilityState, hidden: document.hidden };
    }
    const surface = findSurface();
    if (!surface) throw new Error("TARGET_SURFACE_NOT_FOUND");
    if (message.type === "GET_SURFACE") return surfaceInfo(surface);
    if (message.type === "RESOLVE_REBIND_SURFACE") return resolveRebindSurface(message.sourceSurface);
    if (message.type === "SET_RECORDER") {
      if (!message.enabled) await captureSendQueue;
      let initialSelector = null;
      try { initialSelector = portableSelector(surface); } catch (_) {}
      recorderConfig = {
        enabled: Boolean(message.enabled),
        settings: message.settings || recorderConfig.settings,
        sessionId: message.sessionId || recorderConfig.sessionId,
        surfaceSelector: initialSelector,
        surfaceLocked: false
      };
      lastMove = null;
      dragging = false;
      sensitiveWarningSent = false;
      return { recorderEnabled: recorderConfig.enabled, now: performance.now(), surface: initialSelector ? surfaceInfo(surface) : null, crossOriginFrame: !initialSelector, captures: captureLog.slice() };
    }
    if (message.type === "GET_CAPTURES") return { captures: captureLog.slice() };
    if (message.type === "GET_PLAYBACK_GEOMETRY") return surfaceInfo(resolvePlaybackSurface(message.selector));
    if (message.type === "DISPATCH_EVENT") return dispatchMouse(resolvePlaybackSurface(message.selector || portableSelector(surface)), message.event);
    if (message.type === "DISPATCH_KEY_EVENT") return dispatchKeyboard(message.event);
    if (message.type === "MEASURE_TIMERS") return measureTimers(message.options);
    if (message.type === "RUN_CONTENT_BENCHMARK") return runContentBenchmark(message.options);
    if (message.type === "DISPATCH_BENCHMARK_EVENT") return dispatchBenchmarkEvent(message.index);
    throw new Error("UNKNOWN_TARGET_COMMAND");
  })().then((result) => sendResponse({ ok: true, ...result })).catch((cause) => sendResponse({ ok: false, error: cause.message }));
  return true;
});
})(globalThis);
