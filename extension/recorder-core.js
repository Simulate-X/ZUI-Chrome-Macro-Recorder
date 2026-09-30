(function initializeRecorderCore(global) {
  "use strict";

  const STATES = Object.freeze({ IDLE: "IDLE", RECORDING: "RECORDING", PAUSED: "PAUSED", STOPPED: "STOPPED" });
  const DEFAULT_SETTINGS = Object.freeze({ keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true });
  const MOVE_MIN_INTERVAL_MS = 24;
  const MOVE_MIN_DISTANCE = 0.004;

  function normalizeSettings(value = {}) {
    return {
      keyboard: value.keyboard !== false,
      mouse: value.mouse !== false,
      mouseMode: value.mouseMode === "clicks-and-movement" ? "clicks-and-movement" : "clicks-only",
      wheel: value.wheel !== false
    };
  }

  function nextState(state, command) {
    const transitions = {
      IDLE: { START: STATES.RECORDING },
      RECORDING: { PAUSE: STATES.PAUSED, STOP: STATES.STOPPED, CANCEL: STATES.IDLE },
      PAUSED: { RESUME: STATES.RECORDING, STOP: STATES.STOPPED, CANCEL: STATES.IDLE },
      STOPPED: { START: STATES.RECORDING, CANCEL: STATES.IDLE }
    };
    const next = transitions[state]?.[command];
    if (!next) throw new Error(`INVALID_RECORDER_TRANSITION:${state}:${command}`);
    return next;
  }

  function clamp01(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("INVALID_NORMALIZED_COORDINATE");
    return Math.min(1, Math.max(0, value));
  }

  function normalizeCapturedPoint(clientX, clientY, rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      throw new Error("INVALID_TARGET_RECT");
    }
    return {
      space: "target-normalized",
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height)
    };
  }

  function buttonName(button) {
    return ({ 0: "left", 1: "middle", 2: "right", 3: "back", 4: "forward" })[button] || "none";
  }

  function modifiersOf(event) {
    return [event.altKey && "Alt", event.ctrlKey && "Control", event.metaKey && "Meta", event.shiftKey && "Shift"].filter(Boolean);
  }

  function isSensitiveElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const type = String(element.getAttribute?.("type") || "").toLowerCase();
    const autocomplete = String(element.getAttribute?.("autocomplete") || "").toLowerCase();
    const name = `${element.getAttribute?.("name") || ""} ${element.getAttribute?.("id") || ""}`.toLowerCase();
    return type === "password" || ["current-password", "new-password", "one-time-code"].includes(autocomplete) ||
      /(^|[^a-z])(password|passwd|passcode|secret|token|otp)([^a-z]|$)/.test(name);
  }

  function shouldCaptureMove({ settings, dragging, previous, current }) {
    if (dragging) {
      if (!previous) return true;
      const elapsed = current.at - previous.at;
      const distance = Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y);
      return elapsed >= 12 || distance >= 0.01;
    }
    if (settings.mouseMode !== "clicks-and-movement") return false;
    if (!previous) return true;
    const elapsed = current.at - previous.at;
    const distance = Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y);
    return elapsed >= MOVE_MIN_INTERVAL_MS && distance >= MOVE_MIN_DISTANCE;
  }

  function makeEventId(index) {
    return `e${String(index).padStart(6, "0")}`;
  }

  function canonicalEvent(capture, id) {
    const common = { id, type: capture.type, enabled: true };
    if (["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(capture.type)) {
      const event = {
        ...common,
        position: capture.position,
        button: capture.button || "none",
        buttons: capture.buttons || 0,
        modifiers: capture.modifiers || []
      };
      if (capture.type === "mouseWheel") {
        event.deltaX = capture.deltaX || 0;
        event.deltaY = capture.deltaY || 0;
        event.deltaMode = capture.deltaMode || 0;
      }
      return event;
    }
    if (capture.type === "keyDown" || capture.type === "keyUp") {
      return {
        ...common,
        key: capture.key || "",
        code: capture.code || "",
        location: capture.location || 0,
        repeat: Boolean(capture.repeat),
        modifiers: capture.modifiers || []
      };
    }
    throw new Error("UNSUPPORTED_CAPTURE_TYPE");
  }

  function appendCapture(session, capture) {
    if (session.state !== STATES.RECORDING) throw new Error("RECORDER_NOT_RECORDING");
    if (!Number.isFinite(capture.at)) throw new Error("INVALID_CAPTURE_TIME");
    const elapsed = Math.max(0, capture.at - session.lastCaptureAt);
    const delay = {
      id: makeEventId(session.nextEventNumber++),
      type: "delay",
      enabled: true,
      durationMs: Math.round(elapsed * 1000) / 1000
    };
    const event = canonicalEvent(capture, makeEventId(session.nextEventNumber++));
    session.events.push(delay, event);
    session.lastCaptureAt = capture.at;
    session.activeDurationMs += delay.durationMs;
    return { delay, event };
  }

  function createMacro(session, name, now = new Date().toISOString()) {
    const safeName = String(name || "Recorded macro").trim() || "Recorded macro";
    const slug = safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "recorded-macro";
    return {
      schemaVersion: "1.0",
      id: `${slug}-${now.replace(/\D/g, "").slice(0, 14)}`,
      name: safeName,
      createdAt: now,
      updatedAt: now,
      target: {
        origin: session.target.origin,
        surface: session.surface
      },
      recordingProfile: normalizeSettings(session.settings),
      playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true },
      events: session.events.slice()
    };
  }

  global.ZuiRecorderCore = Object.freeze({
    STATES,
    DEFAULT_SETTINGS,
    MOVE_MIN_INTERVAL_MS,
    MOVE_MIN_DISTANCE,
    normalizeSettings,
    nextState,
    normalizeCapturedPoint,
    buttonName,
    modifiersOf,
    isSensitiveElement,
    shouldCaptureMove,
    appendCapture,
    createMacro
  });
})(globalThis);
