import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, URL, WeakSet, structuredClone });
for (const file of ["hardening-core.js", "shared.js", "playback-core.js", "product-core.js", "editor-core.js"]) {
  vm.runInContext(await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
}
const Core = context.ZuiEditorCore;

function macro(events = []) {
  return {
    schemaVersion: "1.0",
    id: "phase2-macro",
    name: "Phase 2 Macro",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    target: { origin: "https://example.test", surface: { kind: "viewport", locator: { strategy: "css", value: "html" }, recordedGeometry: { widthCssPx: 800, heightCssPx: 600 } } },
    recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true },
    playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true },
    events
  };
}

const delayEvent = (id = "e1", durationMs = 100) => ({ id, type: "delay", enabled: true, durationMs });
const mouseEvent = (id = "e2", type = "mouseDown") => ({ id, type, enabled: true, position: { space: "target-normalized", x: 0.25, y: 0.75 }, button: type === "mouseMove" ? "none" : "left", buttons: type === "mouseDown" ? 1 : 0, modifiers: [] });
const keyEvent = (id = "e3", type = "keyDown") => ({ id, type, enabled: true, key: "a", code: "KeyA", location: 0, repeat: false, modifiers: [] });
const wheelEvent = (id = "e4") => ({ id, type: "mouseWheel", enabled: true, position: { space: "target-normalized", x: 0.5, y: 0.5 }, button: "none", buttons: 0, deltaX: 0, deltaY: 120, deltaMode: 0, modifiers: [] });

test("edits playback defaults through canonical dirty and undo flow", () => {
  const state = Core.createState(macro([delayEvent()]));
  Core.editPlaybackDefaults(state, { speedMultiplier: 2, repeatCount: 3, loopDelayMs: 100, stopOnError: true });
  assert.deepEqual({ ...state.macro.playbackDefaults }, { speedMultiplier: 2, repeatCount: 3, loopDelayMs: 100, stopOnError: true });
  assert.equal(state.dirty, true);
  Core.undo(state);
  assert.equal(state.macro.playbackDefaults.speedMultiplier, 1);
});

test("editor rejects unsupported speed range and continue-on-error", () => {
  const state = Core.createState(macro());
  assert.throws(() => Core.editPlaybackDefaults(state, { speedMultiplier: 10, repeatCount: 1, loopDelayMs: 0, stopOnError: true }), /PLAYBACK_SPEED_OUT_OF_UI_RANGE/);
  assert.throws(() => Core.editPlaybackDefaults(state, { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: false }), /CONTINUE_ON_ERROR_NOT_SUPPORTED/);
});

test("edits delay and marks the canonical macro dirty", () => {
  const state = Core.createState(macro([delayEvent()]));
  Core.editEvent(state, 0, delayEvent("e1", 250));
  assert.equal(state.macro.events[0].durationMs, 250);
  assert.equal(state.dirty, true);
});

test("sets every delay duration in one undoable transaction", () => {
  const state = Core.createState(macro([delayEvent("a", 12), mouseEvent(), delayEvent("b", 34)]));
  const result = Core.setAllDelayDurations(state, 100);
  assert.deepEqual(Array.from(state.macro.events, (event) => event.type === "delay" ? event.durationMs : event.type), [100, "mouseDown", 100]);
  assert.deepEqual({ matchedCount: result.matchedCount, changedCount: result.changedCount }, { matchedCount: 2, changedCount: 2 });
  assert.equal(state.undoStack.length, 1);
  assert.equal(state.dirty, true);
  Core.undo(state);
  assert.deepEqual(Array.from(state.macro.events.filter((event) => event.type === "delay"), (event) => event.durationMs), [12, 34]);
});

test("10k-event bulk delay survives undo, redo and canonical export round-trip", () => {
  const events = Array.from({ length: 10_000 }, (_, index) => index % 2 === 0
    ? delayEvent(`delay-${index}`, index % 997)
    : mouseEvent(`mouse-${index}`, index % 4 === 1 ? "mouseDown" : "mouseUp"));
  const state = Core.createState(macro(events));
  const beforeNonDelay = JSON.stringify(state.macro.events.filter((event) => event.type !== "delay"));
  const result = Core.setAllDelayDurations(state, 100);
  assert.deepEqual({ matchedCount: result.matchedCount, changedCount: result.changedCount }, { matchedCount: 5_000, changedCount: 4_995 });
  assert.equal(state.macro.events.filter((event) => event.type === "delay").every((event) => event.durationMs === 100), true);
  assert.equal(JSON.stringify(state.macro.events.filter((event) => event.type !== "delay")), beforeNonDelay);
  Core.undo(state);
  assert.equal(state.macro.events[2].durationMs, 2);
  Core.redo(state);
  assert.equal(state.macro.events[2].durationMs, 100);
  const roundTrip = JSON.parse(Core.exportText(state.macro));
  assert.deepEqual(roundTrip, state.macro);
});

test("bulk delay edit rejects invalid values without changing history", () => {
  const state = Core.createState(macro([delayEvent()]));
  assert.throws(() => Core.setAllDelayDurations(state, -1), /INVALID_DELAY_DURATION/);
  assert.throws(() => Core.setAllDelayDurations(state, Number.NaN), /INVALID_DELAY_DURATION/);
  assert.equal(state.undoStack.length, 0);
  assert.equal(state.dirty, false);
});

test("edits normalized mouse coordinates without percentage conversion loss", () => {
  const state = Core.createState(macro([mouseEvent()]));
  const edited = structuredClone(state.macro.events[0]);
  edited.position = { space: "target-normalized", x: 0.8173, y: 0.914 };
  Core.editEvent(state, 0, edited);
  assert.equal(state.macro.events[0].position.x, 0.8173);
  assert.match(Core.summary(state.macro.events[0]), /81\.73%/);
});

test("edits keyboard fields and modifiers", () => {
  const state = Core.createState(macro([keyEvent()]));
  Core.editEvent(state, 0, { ...keyEvent(), key: "A", code: "KeyA", location: 1, repeat: true, modifiers: ["Shift"] });
  assert.deepEqual({ ...state.macro.events[0] }, { id: "e3", type: "keyDown", enabled: true, key: "A", code: "KeyA", location: 1, repeat: true, modifiers: ["Shift"] });
});

test("edits existing text and IME events without a parallel model", () => {
  const state = Core.createState(macro([
    { id: "t1", type: "text", enabled: true, value: "hello" },
    { id: "i1", type: "ime", enabled: true, value: "merhaba" }
  ]));
  Core.editEvent(state, 1, { id: "i1", type: "ime", enabled: true, value: "dünya" });
  assert.equal(state.validation.valid, true);
  assert.equal(state.macro.events[1].value, "dünya");
});

test("edits wheel delta, mode and normalized point", () => {
  const state = Core.createState(macro([wheelEvent()]));
  Core.editEvent(state, 0, { ...wheelEvent(), deltaX: -2, deltaY: -300, deltaMode: 1, position: { space: "target-normalized", x: 0.2, y: 0.8 } });
  assert.equal(state.validation.valid, true);
  assert.equal(state.macro.events[0].deltaY, -300);
});

test("adds each supported event with safe defaults", () => {
  const state = Core.createState(macro([]));
  for (const type of Core.EDITABLE_TYPES) Core.addEvent(state, type);
  assert.deepEqual(Array.from(state.macro.events, (event) => event.type), Array.from(Core.EDITABLE_TYPES));
  assert.equal(state.validation.valid, true);
});

test("deletes selected event and renumbers through array order", () => {
  const state = Core.createState(macro([delayEvent("a"), delayEvent("b"), delayEvent("c")]));
  state.selectedIndex = 1;
  Core.deleteEvent(state);
  assert.deepEqual(Array.from(state.macro.events, (event) => event.id), ["a", "c"]);
  assert.equal(state.selectedIndex, 1);
});

test("duplicates by deep clone with a new event id", () => {
  const state = Core.createState(macro([mouseEvent()]));
  Core.duplicateEvent(state, 0);
  state.macro.events[1].position.x = 0.9;
  assert.notEqual(state.macro.events[0].id, state.macro.events[1].id);
  assert.equal(state.macro.events[0].position.x, 0.25);
});

test("moves events up and down while preserving identity", () => {
  const state = Core.createState(macro([delayEvent("a"), delayEvent("b"), delayEvent("c")]));
  Core.moveEvent(state, 2, 1);
  assert.deepEqual(Array.from(state.macro.events, (event) => event.id), ["a", "c", "b"]);
  Core.moveEvent(state, 1, 2);
  assert.deepEqual(Array.from(state.macro.events, (event) => event.id), ["a", "b", "c"]);
});

test("undo and redo restore macro, selection and dirty state", () => {
  const state = Core.createState(macro([delayEvent()]));
  Core.editEvent(state, 0, delayEvent("e1", 999));
  Core.undo(state);
  assert.equal(state.macro.events[0].durationMs, 100);
  assert.equal(state.dirty, false);
  Core.redo(state);
  assert.equal(state.macro.events[0].durationMs, 999);
  assert.equal(state.dirty, true);
});

test("history is bounded to 50 operations", () => {
  const state = Core.createState(macro([delayEvent()]));
  for (let index = 0; index < 70; index += 1) Core.editEvent(state, 0, delayEvent("e1", index));
  assert.equal(state.undoStack.length, 50);
});

test("markSaved clears dirty state and history", () => {
  const state = Core.createState(macro([delayEvent()]));
  Core.editName(state, "Renamed");
  Core.markSaved(state, state.macro);
  assert.equal(state.dirty, false);
  assert.equal(state.undoStack.length, 0);
});

test("save-as creates a new id, timestamps and deep-cloned events", () => {
  const original = macro([mouseEvent()]);
  const copy = Core.saveAsMacro(original, "Fast", "2026-09-24T01:02:03.000Z");
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, "Fast");
  copy.events[0].position.x = 1;
  assert.equal(original.events[0].position.x, 0.25);
});

test("invalid row blocks canonical export and replay validation", () => {
  const state = Core.createState(macro([mouseEvent()]));
  Core.editEvent(state, 0, { ...mouseEvent(), position: { space: "target-normalized", x: 1.27, y: 0.5 } });
  assert.equal(state.validation.valid, false);
  assert.equal(Core.errorsForRow(state.validation, 0).some((error) => error.code === "INVALID_POSITION"), true);
  assert.throws(() => Core.exportText(state.macro), /MACRO_VALIDATION_FAILED/);
});

test("valid JSON import preserves Phase 2 schema 1.0 macros", () => {
  const source = macro([delayEvent(), mouseEvent()]);
  const result = Core.parseImport(JSON.stringify(source));
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.macro.events, (event) => event.type), ["delay", "mouseDown"]);
});

test("malformed and semantically invalid imports are rejected", () => {
  assert.equal(Core.parseImport("{bad").error.code, "JSON_PARSE");
  const bad = macro([{ ...mouseEvent(), position: { space: "target-normalized", x: -1, y: 0 } }]);
  const result = Core.parseImport(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.validation.valid, false);
});

test("forbidden runtime identity and backend fields are rejected on import", () => {
  for (const extra of [{ tabId: 7 }, { authToken: "secret" }, { backend: "CDP_INPUT" }, { localPath: "C:/secret" }]) {
    const result = Core.parseImport(JSON.stringify({ ...macro([]), ...extra }));
    assert.equal(result.ok, false);
    assert.equal(result.validation.errors.some((error) => error.code === "FORBIDDEN_RUNTIME_DATA"), true);
  }
  const localPath = Core.parseImport(JSON.stringify({ ...macro([]), description: "C:\\Users\\Person\\secret.txt" }));
  assert.equal(localPath.ok, false);
  assert.equal(localPath.validation.errors.some((error) => error.code === "LOCAL_PATH_SECRET"), true);
});

test("raw JSON applies only after parse and full validation", () => {
  const state = Core.createState(macro([delayEvent()]));
  const before = JSON.stringify(state.macro);
  assert.equal(Core.applyRaw(state, "{bad").ok, false);
  assert.equal(JSON.stringify(state.macro), before);
  const replacement = macro([delayEvent("e1", 321)]);
  assert.equal(Core.applyRaw(state, JSON.stringify(replacement)).ok, true);
  assert.equal(state.macro.events[0].durationMs, 321);
});

test("export exactly matches current canonical editor state", () => {
  const state = Core.createState(macro([delayEvent()]));
  Core.editEvent(state, 0, delayEvent("e1", 456));
  assert.deepEqual(JSON.parse(Core.exportText(state.macro)), state.macro);
});

test("same-name imports get a visible unique name", () => {
  assert.equal(Core.uniqueName("Test", [{ name: "Test" }, { name: "Test (2)" }]), "Test (3)");
  assert.equal(Core.uniqueName(" test ", [{ name: "Test" }, { name: "test (2)" }]), "test (3)");
});

test("1000-event editor state and validation smoke stays responsive", () => {
  const events = Array.from({ length: 1000 }, (_, index) => delayEvent(`e${index}`, index));
  const started = performance.now();
  const state = Core.createState(macro(events));
  const elapsed = performance.now() - started;
  assert.equal(state.validation.valid, true);
  assert.ok(elapsed < 500, `1000-event editor initialization took ${elapsed.toFixed(1)} ms`);
});
