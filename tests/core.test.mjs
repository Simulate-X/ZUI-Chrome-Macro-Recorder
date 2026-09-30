import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ console, URL, Date, WeakSet });
for (const file of ["hardening-core.js", "shared.js"]) vm.runInContext(await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
const { normalizePoint, denormalizePoint, hashText, validateMacroSchema, validateMacro } = context.ZuiPoc;

function macroWith(events, overrides = {}) {
  return {
    schemaVersion: "1.0",
    id: "macro-test",
    name: "Test macro",
    target: {
      origin: "http://127.0.0.1:8765",
      surface: {
        kind: "viewport",
        locator: { strategy: "css", value: "html" },
        recordedGeometry: { widthCssPx: 800, heightCssPx: 600, devicePixelRatio: 1 }
      }
    },
    recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true },
    playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true },
    events,
    ...overrides
  };
}

test("normalized coordinates round-trip after resize", () => {
  const point = normalizePoint(260, 220, { left: 100, top: 40, width: 640, height: 240 });
  assert.deepEqual({ ...point }, { x: 0.25, y: 0.75 });
  const resized = denormalizePoint(point, { left: 20, top: 10, width: 960, height: 540 });
  assert.deepEqual({ ...resized }, { clientX: 260, clientY: 415 });
});

test("invalid geometry and out-of-range coordinates fail closed", () => {
  assert.throws(() => normalizePoint(0, 0, { left: 0, top: 0, width: 0, height: 10 }), /INVALID_TARGET_RECT/);
  assert.throws(() => denormalizePoint({ x: 1.1, y: 0.5 }, { left: 0, top: 0, width: 10, height: 10 }), /INVALID_NORMALIZED_POINT/);
});

test("canvas snapshot hashing is deterministic and rejects non-text input", () => {
  assert.equal(hashText("data:image/png;base64,AAAA"), hashText("data:image/png;base64,AAAA"));
  assert.notEqual(hashText("data:image/png;base64,AAAA"), hashText("data:image/png;base64,AAAB"));
  assert.throws(() => hashText(new Uint8Array()), /HASH_TEXT_REQUIRED/);
});

test("generic canvas fingerprint avoids repeated pixel readback warnings", async () => {
  const contentSource = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  assert.doesNotMatch(contentSource, /getImageData|willReadFrequently/);
  assert.match(contentSource, /toDataURL\("image\/png"\)/);
});

test("generic runner keeps local completion independent from result receiver", async () => {
  const runnerSource = await readFile(new URL("../extension/phase1d-generic.js", import.meta.url), "utf8");
  const localSave = runnerSource.indexOf("chrome.storage.local.set({ phase1dGenericLastResult: report })");
  const upload = runnerSource.indexOf("await uploadReport(report)");
  assert.ok(localSave >= 0 && upload > localSave);
  assert.match(runnerSource, /Complete — DOM synthetic matrix saved locally; result receiver unavailable\./);
  assert.match(runnerSource, /chrome\.storage\.local\.get\("phase1dGenericLastResult"\)/);
});

test("CDP fallback is explicit, scoped and preserves DOM backend", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const workerSource = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  assert.equal(manifest.permissions.includes("debugger"), true);
  assert.match(workerSource, /DOM_SYNTHETIC: \(action\) => sendToTarget/);
  assert.match(workerSource, /CDP_INPUT: dispatchCdpInput/);
  assert.match(workerSource, /finally \{\s*await detachDebugger\(debuggee\)\.catch/);
  assert.match(workerSource, /CDP_POINT_OUTSIDE_VIEWPORT/);
});

test("macro validator accepts editable v1 events", () => {
  const macro = macroWith([
    { id: "d1", type: "delay", enabled: true, durationMs: 25 },
    { id: "m1", type: "mouseDown", enabled: true, position: { space: "target-normalized", x: 0.25, y: 0.75 }, button: "left", buttons: 1, modifiers: [] },
    { id: "m2", type: "mouseUp", enabled: true, position: { space: "target-normalized", x: 0.25, y: 0.75 }, button: "left", buttons: 0, modifiers: [] }
  ]);
  assert.equal(validateMacroSchema(macro).valid, true);
  assert.equal(validateMacro(macro).valid, true);
});

test("macro validator rejects duplicate ids, unknown events and invalid points", () => {
  const result = validateMacro(macroWith([
    { id: "x", type: "script", enabled: true, source: "alert(1)" },
    { id: "x", type: "mouseDown", enabled: true, position: { space: "target-normalized", x: 9, y: 0 }, button: "left", buttons: 1, modifiers: [] }
  ], { schemaVersion: "2.0" }));
  assert.equal(result.valid, false);
  for (const code of ["UNSUPPORTED_SCHEMA", "UNKNOWN_EVENT", "DUPLICATE_ID", "INVALID_POSITION"]) {
    assert.equal(result.errors.some((item) => item.code === code), true);
  }
});

test("macro validator rejects profile, tab and session identity data", () => {
  const result = validateMacro({ ...macroWith([]), target: { tabId: 42, accountId: "not-portable" }, sessionToken: "not-portable" });
  assert.equal(result.valid, false);
  assert.deepEqual(Array.from(result.errors.filter((item) => item.code === "FORBIDDEN_RUNTIME_DATA"), (item) => item.code), [
    "FORBIDDEN_RUNTIME_DATA",
    "FORBIDDEN_RUNTIME_DATA",
    "FORBIDDEN_RUNTIME_DATA"
  ]);
});

test("backend coupling is rejected from portable recorder events", () => {
  const result = validateMacro(macroWith([
    { id: "m1", type: "mouseDown", enabled: true, position: { space: "target-normalized", x: 0.5, y: 0.5 }, button: "left", buttons: 1, modifiers: [], backend: "DOM_SYNTHETIC" }
  ]));
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((item) => item.code === "BACKEND_COUPLING"), true);
});

test("wheel schema requires deltas and deltaMode metadata", () => {
  const wheel = { id: "w1", type: "mouseWheel", enabled: true, position: { space: "target-normalized", x: 0.5, y: 0.5 }, button: "none", buttons: 0, modifiers: [], deltaX: 0, deltaY: 120, deltaMode: 0 };
  assert.equal(validateMacroSchema(macroWith([wheel])).valid, true);
  assert.equal(validateMacroSchema(macroWith([{ ...wheel, deltaMode: 9 }])).valid, false);
});

test("machine-readable schema is valid JSON and forbids runtime identity fields", async () => {
  const schemaText = await readFile(new URL("../schemas/macro-v1.schema.json", import.meta.url), "utf8");
  const schema = JSON.parse(schemaText);
  assert.equal(schema.additionalProperties, false);
  for (const forbidden of ["profileId", "gmail", "tabId", "windowId", "cookie", "sessionToken"]) {
    assert.equal(Object.hasOwn(schema.properties, forbidden), false);
  }
});
