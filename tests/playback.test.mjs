import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ structuredClone });
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL("../extension/playback-core.js", import.meta.url), "utf8"), context);
const Core = context.ZuiPlaybackCore;
const delay = (durationMs) => ({ id: crypto.randomUUID(), type: "delay", enabled: true, durationMs });
const mouse = (type, button = "left") => ({ id: crypto.randomUUID(), type, enabled: true, button, buttons: type === "mouseDown" ? 1 : 0, position: { space: "target-normalized", x: .4, y: .6 }, modifiers: [] });
const key = (type, code = "ControlLeft", value = "Control") => ({ id: crypto.randomUUID(), type, enabled: true, key: value, code, location: 0, repeat: false, modifiers: [] });

test("playback state machine accepts only declared transitions", () => {
  assert.equal(Core.transition("IDLE", "RUNNING"), "RUNNING");
  assert.equal(Core.transition("RUNNING", "PAUSE_PENDING"), "PAUSE_PENDING");
  assert.equal(Core.transition("PAUSE_PENDING", "PAUSED"), "PAUSED");
  assert.equal(Core.transition("PAUSED", "RUNNING"), "RUNNING");
  assert.equal(Core.transition("RUNNING", "STOPPING"), "STOPPING");
  assert.equal(Core.transition("STOPPING", "STOPPED"), "STOPPED");
  assert.throws(() => Core.transition("PAUSED", "COMPLETED"), /INVALID_PLAYBACK_TRANSITION/);
});

test("speed scaling does not mutate canonical delay", () => {
  const event = delay(1000);
  assert.deepEqual([.5, 1, 2, 5].map((speed) => Core.effectiveDelay(event.durationMs, speed)), [2000, 1000, 500, 200]);
  assert.equal(event.durationMs, 1000);
});

test("playback defaults preserve repeat total-execution and infinite zero semantics", () => {
  assert.equal(Core.normalizeDefaults({ speedMultiplier: 2, repeatCount: 10, loopDelayMs: 500, stopOnError: true }).repeatCount, 10);
  assert.equal(Core.normalizeDefaults({ speedMultiplier: 1, repeatCount: 0, loopDelayMs: 0, stopOnError: true }).repeatCount, 0);
});

test("old macro defaults normalize without schema migration", () => {
  assert.deepEqual({ ...Core.normalizeDefaults() }, { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true });
});

test("pause remaining delay excludes paused wall time", () => {
  assert.equal(Core.remainingDelay(Core.effectiveDelay(1000, 1), 400), 600);
  assert.equal(Core.remainingDelay(Core.effectiveDelay(1000, 2), 200), 300);
});

test("mouse input tracker reaches safe boundary only after release", () => {
  const state = Core.createInputState();
  Core.applyInputEvent(state, mouse("mouseDown"));
  assert.equal(Core.isSafe(state), false);
  Core.applyInputEvent(state, mouse("mouseUp"));
  assert.equal(Core.isSafe(state), true);
});

test("keyboard input tracker reaches safe boundary only after matching release", () => {
  const state = Core.createInputState();
  Core.applyInputEvent(state, key("keyDown"));
  assert.equal(Core.isSafe(state), false);
  Core.applyInputEvent(state, key("keyUp"));
  assert.equal(Core.isSafe(state), true);
});

test("drag remains unsafe across moves", () => {
  const state = Core.createInputState();
  Core.applyInputEvent(state, mouse("mouseDown"));
  Core.applyInputEvent(state, mouse("mouseMove", "none"));
  assert.equal(Core.isSafe(state), false);
  Core.applyInputEvent(state, mouse("mouseUp"));
  assert.equal(Core.isSafe(state), true);
});

test("safe boundary analysis marks click and keyboard sequences", () => {
  const events = [delay(10), mouse("mouseDown"), delay(5), mouse("mouseUp"), key("keyDown"), key("keyUp")];
  assert.deepEqual([...Core.analyzeBoundaries(events).safe], [true, true, false, false, true, false, true]);
});

test("step click unit includes matching release", () => {
  const events = [mouse("mouseDown"), delay(5), mouse("mouseUp"), delay(10)];
  assert.deepEqual(Array.from(Core.safeUnitForIndex(events, 0).eventRange), [0, 2]);
});

test("step keyboard and modifier unit includes matching keyUp", () => {
  const events = [key("keyDown"), delay(5), key("keyUp")];
  const unit = Core.safeUnitForIndex(events, 1);
  assert.equal(unit.ok, true);
  assert.deepEqual([...unit.eventRange], [0, 2]);
});

test("step drag unit includes all moves and release", () => {
  const events = [mouse("mouseDown"), mouse("mouseMove", "none"), mouse("mouseUp")];
  assert.deepEqual([...Core.safeUnitForIndex(events, 1).eventRange], [0, 2]);
});

test("wheel and delay are independently safe step units", () => {
  const wheel = { ...mouse("mouseWheel", "none"), deltaX: 0, deltaY: 2, deltaMode: 0 };
  assert.deepEqual([...Core.safeUnitForIndex([wheel, delay(3)], 0).eventRange], [0, 0]);
  assert.deepEqual([...Core.safeUnitForIndex([wheel, delay(3)], 1).eventRange], [1, 1]);
});

test("unsafe unmatched mouse and keyboard step reject fail closed", () => {
  assert.equal(Core.safeUnitForIndex([mouse("mouseDown")], 0).code, "UNMATCHED_HELD_INPUT");
  assert.equal(Core.safeUnitForIndex([key("keyDown")], 0).code, "UNMATCHED_HELD_INPUT");
});

test("play from here accepts safe index and rejects held region", () => {
  const events = [delay(1), mouse("mouseDown"), delay(2), mouse("mouseUp"), delay(3)];
  assert.equal(Core.playFromBoundary(events, 1).ok, true);
  const unsafe = Core.playFromBoundary(events, 2);
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.code, "UNSAFE_START_BOUNDARY");
  assert.equal(unsafe.previousSafe, 1);
  assert.equal(unsafe.nextSafe, 4);
});

test("cleanup creates compensating held mouse and keyboard releases", () => {
  const state = Core.createInputState();
  Core.applyInputEvent(state, mouse("mouseDown"));
  Core.applyInputEvent(state, key("keyDown", "KeyA", "a"));
  const releases = Core.cleanupEvents(state);
  assert.deepEqual(Array.from(releases, (event) => event.type).sort(), ["keyUp", "mouseUp"]);
});

test("playback snapshot clone is isolated from editor mutation", () => {
  const macro = { playbackDefaults: { speedMultiplier: 1 }, events: [delay(100)] };
  const snapshot = Core.clone(macro);
  macro.events[0].durationMs = 999;
  macro.playbackDefaults.speedMultiplier = 5;
  assert.equal(snapshot.events[0].durationMs, 100);
  assert.equal(snapshot.playbackDefaults.speedMultiplier, 1);
});

test("zero delay and 1000 events remain analyzable without injected delay", () => {
  const events = Array.from({ length: 1000 }, () => delay(0));
  const started = performance.now();
  const analysis = Core.analyzeBoundaries(events);
  assert.equal(analysis.safe.length, 1001);
  assert.equal(analysis.valid, true);
  assert.ok(performance.now() - started < 500);
});
