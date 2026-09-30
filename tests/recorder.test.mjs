import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/recorder-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date });
vm.runInContext(source, context);
const core = context.ZuiRecorderCore;

test("recorder state machine accepts only declared transitions", () => {
  assert.equal(core.nextState("IDLE", "START"), "RECORDING");
  assert.equal(core.nextState("RECORDING", "PAUSE"), "PAUSED");
  assert.equal(core.nextState("PAUSED", "RESUME"), "RECORDING");
  assert.equal(core.nextState("RECORDING", "STOP"), "STOPPED");
  assert.equal(core.nextState("PAUSED", "CANCEL"), "IDLE");
  assert.throws(() => core.nextState("IDLE", "PAUSE"), /INVALID_RECORDER_TRANSITION/);
});

test("capture creates explicit monotonic delays and mouse down/up rows", () => {
  const session = { state: "RECORDING", events: [], nextEventNumber: 1, lastCaptureAt: 100, activeDurationMs: 0 };
  core.appendCapture(session, { type: "mouseDown", at: 201.125, position: { space: "target-normalized", x: 0.2, y: 0.3 }, button: "left", buttons: 1 });
  core.appendCapture(session, { type: "mouseUp", at: 359.5, position: { space: "target-normalized", x: 0.2, y: 0.3 }, button: "left", buttons: 0 });
  assert.deepEqual(Array.from(session.events, (event) => event.type), ["delay", "mouseDown", "delay", "mouseUp"]);
  assert.deepEqual(Array.from(session.events.filter((event) => event.type === "delay"), (event) => event.durationMs), [101.125, 158.375]);
});

test("resume baseline excludes paused wall time from delay", () => {
  const session = { state: "RECORDING", events: [], nextEventNumber: 1, lastCaptureAt: 5000, activeDurationMs: 0 };
  core.appendCapture(session, { type: "keyDown", at: 5500, key: "a", code: "KeyA", location: 0, repeat: false, modifiers: [] });
  session.lastCaptureAt = 40000;
  core.appendCapture(session, { type: "keyUp", at: 40500, key: "a", code: "KeyA", location: 0, repeat: false, modifiers: [] });
  assert.deepEqual(Array.from(session.events.filter((event) => event.type === "delay"), (event) => event.durationMs), [500, 500]);
});

test("normalized capture clamps edge rounding but rejects invalid rects", () => {
  assert.deepEqual({ ...core.normalizeCapturedPoint(90.00001, 5, { left: 10, top: 5, width: 80, height: 20 }) }, { space: "target-normalized", x: 1, y: 0 });
  assert.throws(() => core.normalizeCapturedPoint(1, 1, { left: 0, top: 0, width: 0, height: 2 }), /INVALID_TARGET_RECT/);
});

test("mouse move sampling drops noise, supports opt-in and preserves drag samples", () => {
  const settings = core.normalizeSettings({ mouseMode: "clicks-and-movement" });
  const previous = { at: 100, position: { x: 0.2, y: 0.2 } };
  assert.equal(core.shouldCaptureMove({ settings, dragging: false, previous, current: { at: 110, position: { x: 0.201, y: 0.201 } } }), false);
  assert.equal(core.shouldCaptureMove({ settings, dragging: false, previous, current: { at: 130, position: { x: 0.21, y: 0.2 } } }), true);
  assert.equal(core.shouldCaptureMove({ settings: core.normalizeSettings({ mouseMode: "clicks-only" }), dragging: false, previous: null, current: { at: 130, position: { x: 0.2, y: 0.2 } } }), false);
  assert.equal(core.shouldCaptureMove({ settings, dragging: true, previous, current: { at: 101, position: { x: 0.201, y: 0.2 } } }), false);
  assert.equal(core.shouldCaptureMove({ settings, dragging: true, previous, current: { at: 112, position: { x: 0.202, y: 0.2 } } }), true);
});

test("keyboard and wheel metadata remain backend agnostic", () => {
  const session = { state: "RECORDING", events: [], nextEventNumber: 1, lastCaptureAt: 0, activeDurationMs: 0 };
  core.appendCapture(session, { type: "keyDown", at: 10, key: "A", code: "KeyA", location: 1, repeat: true, modifiers: ["Shift"] });
  core.appendCapture(session, { type: "mouseWheel", at: 20, position: { space: "target-normalized", x: 0.5, y: 0.5 }, button: "none", buttons: 0, modifiers: [], deltaX: 1, deltaY: 2, deltaMode: 1 });
  assert.equal(session.events.some((event) => Object.hasOwn(event, "backend")), false);
  assert.deepEqual({ ...session.events[1] }, { id: "e000002", type: "keyDown", enabled: true, key: "A", code: "KeyA", location: 1, repeat: true, modifiers: ["Shift"] });
  assert.equal(session.events[3].deltaMode, 1);
});

test("password, token and OTP fields fail closed", () => {
  const element = (attributes) => ({ nodeType: 1, getAttribute: (name) => attributes[name] || null });
  assert.equal(core.isSensitiveElement(element({ type: "password" })), true);
  assert.equal(core.isSensitiveElement(element({ autocomplete: "one-time-code" })), true);
  assert.equal(core.isSensitiveElement(element({ name: "api_token" })), true);
  assert.equal(core.isSensitiveElement(element({ name: "display_name" })), false);
});

test("macro creation strips runtime target identity and serializes settings", () => {
  const session = {
    target: { tabId: 99, windowId: 5, origin: "https://example.test" },
    surface: { kind: "viewport", locator: { strategy: "css", value: "html" }, recordedGeometry: { widthCssPx: 800, heightCssPx: 600 } },
    settings: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true },
    events: []
  };
  const macro = core.createMacro(session, "Test 01", "2026-09-24T00:00:00.000Z");
  assert.equal(JSON.stringify(macro).includes("tabId"), false);
  assert.equal(JSON.stringify(macro).includes("windowId"), false);
  assert.equal(macro.target.origin, "https://example.test");
});
