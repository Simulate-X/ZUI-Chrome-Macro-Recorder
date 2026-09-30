"use strict";

async function runBenchmark({ events = 31, intervalMs = 100 } = {}) {
  if (!Number.isInteger(events) || events < 2) throw new Error("INVALID_EVENT_COUNT");
  const rows = [];
  const startedAt = performance.now();
  for (let index = 0; index < events; index += 1) {
    if (index > 0) {
      const dueAt = startedAt + index * intervalMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt - performance.now())));
    }
    const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_DISPATCH_TICK", index });
    if (!response?.ok || !response.result?.ok) {
      throw new Error(response?.error || response?.result?.error || "OFFSCREEN_DISPATCH_FAILED");
    }
    rows.push(response.result);
  }
  return { scheduler: "OFFSCREEN_DOCUMENT", intervalMs, rows };
}

async function runGeneric({ events = 3, intervalMs = 100, action } = {}) {
  if (!Number.isInteger(events) || events < 3) throw new Error("INVALID_EVENT_COUNT");
  if (!action || typeof action !== "object") throw new Error("INVALID_GENERIC_ACTION");
  const rows = [];
  const startedAt = performance.now();
  for (let index = 0; index < events; index += 1) {
    if (index > 0) {
      const dueAt = startedAt + index * intervalMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt - performance.now())));
    }
    const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_GENERIC_TICK", action, index });
    if (!response?.ok || !response.result?.ok) {
      throw new Error(response?.error || response?.result?.error || "OFFSCREEN_GENERIC_DISPATCH_FAILED");
    }
    rows.push(response.result);
  }
  return { scheduler: "OFFSCREEN_DOCUMENT", intervalMs, rows };
}

const Core = globalThis.ZuiPlaybackCore;
const PLAYBACK_RESULT_ROW_LIMIT = 1000;
let active = null;

async function publish(extra = {}) {
  if (!active) return;
  if (extra.state && !Core.canTransition(active.public.state, extra.state)) throw new Error(`INVALID_PLAYBACK_TRANSITION:${active.public.state}->${extra.state}`);
  Object.assign(active.public, extra, { updatedAt: new Date().toISOString() });
  await chrome.runtime.sendMessage({ type: "PLAYBACK_STATUS_UPDATE", status: active.public });
}

async function pauseGate() {
  if (!active) throw new Error("PLAYBACK_SESSION_LOST");
  if (active.stopRequested) throw new Error("STOP_SIGNAL");
  if (active.pauseRequested && Core.isSafe(active.input)) {
    await publish({ state: Core.STATES.PAUSED });
    if (!active.pauseRequested) {
      await publish({ state: Core.STATES.RUNNING });
      return;
    }
    await new Promise((resolve) => { active.resume = resolve; });
    active.resume = null;
    if (active.stopRequested) throw new Error("STOP_SIGNAL");
    active.pauseRequested = false;
    await publish({ state: Core.STATES.RUNNING });
  }
}

async function waitControlled(milliseconds, kind) {
  let remaining = Math.max(0, milliseconds);
  active.public.delayKind = kind;
  active.public.remainingDelayMs = remaining;
  if (remaining > 0 || kind === "loop") await publish();
  while (remaining > 0) {
    await pauseGate();
    const slice = Math.min(remaining, 20);
    const before = performance.now();
    await new Promise((resolve) => setTimeout(resolve, slice));
    remaining = Math.max(0, remaining - (performance.now() - before));
    active.public.remainingDelayMs = remaining;
  }
  active.public.remainingDelayMs = 0;
  active.public.delayKind = null;
  await pauseGate();
}

async function cleanupHeld() {
  if (!active || Core.isSafe(active.input)) return [];
  const releases = Core.cleanupEvents(active.input);
  const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_CLEANUP_INPUTS", macro: active.macro, events: releases });
  active.input = Core.createInputState();
  active.public.runtimeCleanup = [];
  if (!response?.ok && !["TARGET_CLOSED", "TARGET_NAVIGATED"].includes(active.stopReason)) throw new Error(response?.error || "INPUT_CLEANUP_FAILED");
  return response.rows || [];
}

async function runPlayback() {
  const session = active;
  const rows = [];
  const started = performance.now();
  const total = session.settings.repeatCount === 0 ? Infinity : session.settings.repeatCount;
  let terminal = Core.STATES.COMPLETED;
  let reason = "completed";
  let errorCode = null;
  try {
    for (let iteration = 1; iteration <= total; iteration += 1) {
      session.public.iteration = iteration;
      for (let index = session.range.start; index < session.range.end; index += 1) {
        await pauseGate();
        const event = session.macro.events[index];
        session.public.currentEvent = index + 1;
        session.public.eventIndex = index;
        if (index > session.range.start && (index & 63) === 0) { await publish(); await new Promise((resolve) => setTimeout(resolve, 0)); }
        if (!event.enabled) continue;
        if (event.type === "delay") {
          await waitControlled(Core.effectiveDelay(event.durationMs, session.settings.speedMultiplier), "macro");
          continue;
        }
        const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PLAY_EVENT", macro: session.macro, event, index });
        if (!response?.ok) throw new Error(response?.error || "PLAYBACK_DISPATCH_FAILED");
        Core.applyInputEvent(session.input, event);
        session.public.heldInputs = session.input.keys.size + session.input.buttons.size;
        session.public.runtimeCleanup = Core.cleanupEvents(session.input);
        if (rows.length < PLAYBACK_RESULT_ROW_LIMIT) rows.push({ index, eventType: event.type, iteration, result: response.result });
        else session.rowsDropped += 1;
        session.public.eventsExecuted += 1;
        if (session.pauseRequested && !Core.isSafe(session.input)) await publish({ state: Core.STATES.PAUSE_PENDING });
        if (["mouseDown", "mouseUp", "keyDown", "keyUp"].includes(event.type) || (session.public.eventsExecuted & 15) === 0 || session.pauseRequested) await publish();
        await pauseGate();
      }
      if (iteration < total) await waitControlled(session.settings.loopDelayMs, "loop");
    }
  } catch (cause) {
    if (session.stopRequested || cause.message === "STOP_SIGNAL") { terminal = Core.STATES.STOPPED; reason = session.stopReason || "user_stop"; }
    else { terminal = Core.STATES.ERROR; reason = "playback_error"; errorCode = cause.message; }
  }
  try { await cleanupHeld(); } catch (cause) { terminal = Core.STATES.ERROR; reason = "cleanup_error"; errorCode = cause.message; }
  session.public.durationMs = performance.now() - started;
  session.public.result = { state: terminal, reason, errorCode, iteration: session.public.iteration, eventIndex: session.public.eventIndex, eventsExecuted: session.public.eventsExecuted, durationMs: session.public.durationMs, rows, rowsDropped: session.rowsDropped };
  await publish({ state: terminal, reason, errorCode, result: session.public.result, heldInputs: 0 });
  active = null;
}

async function startPlayback(request) {
  if (active) throw new Error("PLAYBACK_ALREADY_ACTIVE");
  const macro = Core.clone(request.macro);
  const settings = Core.normalizeDefaults(request.settings || macro.playbackDefaults);
  if (!settings.stopOnError) throw new Error("CONTINUE_ON_ERROR_NOT_SUPPORTED");
  const range = request.range || { start: 0, end: macro.events.length };
  const sessionId = crypto.randomUUID();
  active = {
    macro, settings, range, input: Core.createInputState(), pauseRequested: false, stopRequested: false, resume: null, rowsDropped: 0,
    public: {
      sessionId, state: Core.STATES.RUNNING, macroId: macro.id, macroName: macro.name, target: request.target || null,
      currentEvent: range.start + 1, eventIndex: range.start, totalEvents: macro.events.length, iteration: 1,
      repeatCount: settings.repeatCount, speedMultiplier: settings.speedMultiplier, loopDelayMs: settings.loopDelayMs,
      eventsExecuted: 0, startedAt: new Date().toISOString(), durationMs: 0, mode: request.mode || "continuous",
      range, heldInputs: 0, runtimeCleanup: [], surfaceSelector: macro.target?.surface?.locator?.value || null, remainingDelayMs: 0, delayKind: null, reason: null, errorCode: null, result: null
    }
  };
  await publish();
  runPlayback();
  return active.public;
}

async function controlPlayback(action, reason) {
  if (!active) throw new Error("NO_ACTIVE_PLAYBACK");
  if (action === "PAUSE") {
    if ([Core.STATES.PAUSE_PENDING, Core.STATES.PAUSED].includes(active.public.state)) return active.public;
    active.pauseRequested = true;
    await publish({ state: Core.STATES.PAUSE_PENDING });
  } else if (action === "RESUME") {
    if (active.public.state === Core.STATES.RUNNING && !active.pauseRequested) return active.public;
    if (![Core.STATES.PAUSED, Core.STATES.PAUSE_PENDING].includes(active.public.state) && !active.pauseRequested) throw new Error("PLAYBACK_NOT_PAUSED");
    active.pauseRequested = false;
    if (active.public.state === Core.STATES.PAUSED) active.resume?.();
    else await publish({ state: Core.STATES.RUNNING });
  } else if (action === "STOP") {
    if (active.public.state === Core.STATES.STOPPING) return active.public;
    active.stopRequested = true;
    active.stopReason = reason || "user_stop";
    await publish({ state: Core.STATES.STOPPING });
    active.resume?.();
  } else throw new Error("UNKNOWN_PLAYBACK_CONTROL");
  return active?.public || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_PING") { sendResponse({ ok: true }); return false; }
  if (!["OFFSCREEN_RUN_BENCHMARK", "OFFSCREEN_RUN_GENERIC", "OFFSCREEN_START_PLAYBACK", "OFFSCREEN_CONTROL_PLAYBACK"].includes(message.type)) return false;
  const operation = message.type === "OFFSCREEN_RUN_GENERIC" ? runGeneric : message.type === "OFFSCREEN_RUN_BENCHMARK" ? runBenchmark : message.type === "OFFSCREEN_START_PLAYBACK" ? startPlayback : (() => controlPlayback(message.action, message.reason));
  operation(message.type === "OFFSCREEN_START_PLAYBACK" ? message.request : message.options)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((cause) => sendResponse({ ok: false, error: cause.message }));
  return true;
});
