(function initializePlaybackCore(global) {
  "use strict";

  const STATES = Object.freeze({ IDLE: "IDLE", RUNNING: "RUNNING", PAUSE_PENDING: "PAUSE_PENDING", PAUSED: "PAUSED", STOPPING: "STOPPING", COMPLETED: "COMPLETED", ERROR: "ERROR", STOPPED: "STOPPED" });
  const ACTIVE_STATES = new Set([STATES.RUNNING, STATES.PAUSE_PENDING, STATES.PAUSED, STATES.STOPPING]);
  const TRANSITIONS = Object.freeze({
    IDLE: [STATES.RUNNING], RUNNING: [STATES.PAUSE_PENDING, STATES.STOPPING, STATES.COMPLETED, STATES.ERROR],
    PAUSE_PENDING: [STATES.RUNNING, STATES.PAUSED, STATES.STOPPING, STATES.ERROR], PAUSED: [STATES.RUNNING, STATES.STOPPING, STATES.ERROR],
    STOPPING: [STATES.STOPPED, STATES.ERROR], COMPLETED: [], ERROR: [], STOPPED: []
  });
  function canTransition(from, to) { return from === to || Boolean(TRANSITIONS[from]?.includes(to)); }
  function transition(from, to) { if (!canTransition(from, to)) throw new Error(`INVALID_PLAYBACK_TRANSITION:${from}->${to}`); return to; }

  function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  function normalizeDefaults(value = {}) {
    const speedMultiplier = Number(value.speedMultiplier ?? 1);
    const repeatCount = Number(value.repeatCount ?? 1);
    const loopDelayMs = Number(value.loopDelayMs ?? 0);
    return {
      speedMultiplier: Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1,
      repeatCount: Number.isInteger(repeatCount) && repeatCount >= 0 ? repeatCount : 1,
      loopDelayMs: Number.isFinite(loopDelayMs) && loopDelayMs >= 0 ? loopDelayMs : 0,
      stopOnError: value.stopOnError !== false
    };
  }
  function effectiveDelay(durationMs, speedMultiplier) {
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("INVALID_DELAY");
    if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) throw new Error("INVALID_SPEED");
    return durationMs / speedMultiplier;
  }
  function remainingDelay(totalMs, elapsedMs) { return Math.max(0, Number(totalMs) - Math.max(0, Number(elapsedMs))); }
  function createInputState() { return { keys: new Map(), buttons: new Map(), dragging: false, lastPointer: null }; }
  function applyInputEvent(state, event) {
    if (!event?.enabled) return state;
    if (event.type === "keyDown") state.keys.set(event.code || event.key, clone(event));
    if (event.type === "keyUp") state.keys.delete(event.code || event.key);
    if (event.type === "mouseDown") {
      state.buttons.set(event.button || "left", clone(event));
      state.dragging = true;
      state.lastPointer = clone(event.position);
    }
    if (event.type === "mouseMove" && state.buttons.size) state.lastPointer = clone(event.position);
    if (event.type === "mouseUp") {
      state.buttons.delete(event.button || "left");
      state.dragging = state.buttons.size > 0;
      state.lastPointer = clone(event.position);
    }
    return state;
  }
  function isSafe(state) { return state.keys.size === 0 && state.buttons.size === 0 && !state.dragging; }
  function analyzeBoundaries(events) {
    const state = createInputState();
    const safe = [true];
    for (const event of events) { applyInputEvent(state, event); safe.push(isSafe(state)); }
    return { safe, finalState: state, valid: isSafe(state) };
  }
  function safeUnitForIndex(events, index) {
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return { ok: false, code: "EVENT_INDEX_OUT_OF_RANGE" };
    const analysis = analyzeBoundaries(events);
    let start = index;
    while (start > 0 && !analysis.safe[start]) start -= 1;
    if (!analysis.safe[start]) return { ok: false, code: "NO_SAFE_START" };
    let end = index + 1;
    while (end <= events.length && !analysis.safe[end]) end += 1;
    if (end > events.length) return { ok: false, code: "UNMATCHED_HELD_INPUT", nearestSafeStart: start };
    return { ok: true, start, end, label: summarizeUnit(events.slice(start, end)), eventRange: [start, end - 1] };
  }
  function playFromBoundary(events, index) {
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return { ok: false, code: "EVENT_INDEX_OUT_OF_RANGE" };
    const analysis = analyzeBoundaries(events);
    if (analysis.safe[index]) return { ok: true, start: index, end: events.length };
    let previous = index; while (previous > 0 && !analysis.safe[previous]) previous -= 1;
    let next = index + 1; while (next <= events.length && !analysis.safe[next]) next += 1;
    return { ok: false, code: "UNSAFE_START_BOUNDARY", previousSafe: analysis.safe[previous] ? previous : null, nextSafe: next < events.length ? next : null };
  }
  function summarizeUnit(events) {
    const types = events.filter((event) => event.enabled).map((event) => event.type);
    if (types.includes("mouseDown") && types.includes("mouseUp")) return types.includes("mouseMove") ? "MOUSE DRAG" : "MOUSE CLICK";
    if (types.includes("keyDown") && types.includes("keyUp")) return "KEYBOARD SEQUENCE";
    if (types.includes("mouseWheel")) return "MOUSE WHEEL";
    if (types.every((type) => type === "delay")) return "DELAY";
    return types.join(" + ").toUpperCase() || "EMPTY";
  }
  function cleanupEvents(state) {
    const events = [];
    for (const event of state.keys.values()) events.push({ ...clone(event), type: "keyUp", repeat: false });
    for (const [button, event] of state.buttons) events.push({ ...clone(event), type: "mouseUp", button, buttons: 0, position: clone(state.lastPointer || event.position) });
    return events;
  }

  global.ZuiPlaybackCore = Object.freeze({ STATES, ACTIVE_STATES, TRANSITIONS, canTransition, transition, clone, normalizeDefaults, effectiveDelay, remainingDelay, createInputState, applyInputEvent, isSafe, analyzeBoundaries, safeUnitForIndex, playFromBoundary, summarizeUnit, cleanupEvents });
})(globalThis);
