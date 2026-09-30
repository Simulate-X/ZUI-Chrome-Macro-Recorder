import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ URL, Date, WeakSet, setTimeout, clearTimeout });
context.globalThis = context;
for (const file of ["hardening-core.js", "shared.js"]) {
  vm.runInContext(await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
}
const Hardening = context.ZuiHardening;
const { validateMacro } = context.ZuiPoc;

function macro(overrides = {}) {
  return {
    schemaVersion: "1.0", id: "portable", name: "Portable",
    target: { origin: "http://127.0.0.1:8765", surface: { kind: "viewport", locator: { strategy: "css", value: "html" }, recordedGeometry: { widthCssPx: 800, heightCssPx: 600, devicePixelRatio: 1 } } },
    recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true },
    playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true },
    events: [], ...overrides
  };
}

test("diagnostics redact secrets and bound long values", () => {
  const report = Hardening.redact({ password: "never", token: "never", text: "never", safe: "x".repeat(500), nested: { cookie: "never" } });
  assert.equal(report.password, "[REDACTED]");
  assert.equal(report.token, "[REDACTED]");
  assert.equal(report.text, "[REDACTED]");
  assert.equal(report.nested.cookie, "[REDACTED]");
  assert.ok(report.safe.length < 250);
});

test("diagnostic model has stable safe metadata and error codes", () => {
  const row = Hardening.diagnostic({ code: "TARGET_TAB_CLOSED", message: "closed", macroId: "m", eventIndex: 9, iteration: 3, targetOrigin: "https://example.test", context: { value: "secret" }, timestamp: "2026-01-01T00:00:00.000Z" });
  assert.equal(row.code, "TARGET_CLOSED");
  assert.equal(row.eventIndex, 9);
  assert.equal(row.iteration, 3);
  assert.equal(row.context.value, "[REDACTED]");
  assert.equal(Hardening.codeFromError(new Error("Another debugger is already attached")), "CDP_ATTACH_FAILED");
  assert.equal(Hardening.codeFromError(new Error("Debugger is not attached")), "CDP_DETACHED");
});

test("portable origin policy permits credential-free http(s) only", () => {
  assert.equal(Hardening.validatePortableOrigin("https://example.test/path").valid, true);
  for (const value of ["javascript:alert(1)", "data:text/plain,x", "chrome://settings", "file:///tmp/x", "https://user:pass@example.test"]) {
    assert.deepEqual({ ...Hardening.validatePortableOrigin(value) }, { valid: false, code: "IMPORT_FORBIDDEN_ORIGIN" });
    assert.equal(validateMacro(macro({ target: { ...macro().target, origin: value } })).valid, false);
  }
});

test("external browser operations have a deterministic deadline", async () => {
  await assert.rejects(
    Hardening.withDeadline(new Promise(() => {}), 5, "CDP_COMMAND_TIMEOUT"),
    /CDP_COMMAND_TIMEOUT/
  );
  assert.equal(await Hardening.withDeadline(Promise.resolve("ok"), 50), "ok");
});

test("storage corruption is quarantined without hiding valid macros", () => {
  const good = macro();
  const bad = macro({ id: "bad", schemaVersion: "99.0" });
  const partition = Hardening.partitionMacros([good, bad, null], validateMacro);
  assert.equal(partition.valid.length, 1);
  assert.equal(partition.valid[0].id, "portable");
  assert.equal(partition.quarantine.length, 2);
  assert.equal(partition.quarantine[0].id, "bad");
  assert.equal(Hardening.partitionMacros({ broken: true }, validateMacro).quarantine[0].errors[0].code, "STORAGE_CORRUPTION");
});

test("stale playback and recorder recovery decisions preserve only a live recorder", () => {
  assert.deepEqual({ ...Hardening.recoveryDecision({ playback: { state: "RUNNING" }, offscreenPresent: false }) }, { playback: "ERROR", code: "OFFSCREEN_LOST", cleanup: true });
  assert.deepEqual({ ...Hardening.recoveryDecision({ recorder: { state: "PAUSED" }, offscreenPresent: true }) }, { recorder: "IDLE", code: "SERVICE_WORKER_RESTART", cleanup: true });
  assert.deepEqual({ ...Hardening.recoveryDecision({ recorder: { state: "RECORDING" }, recorderAlive: true }) }, { recorder: "RECORDING", cleanup: false });
  assert.deepEqual({ ...Hardening.recoveryDecision({ recorder: { state: "PAUSED" }, recorderAlive: true }) }, { recorder: "PAUSED", cleanup: false });
  assert.deepEqual({ ...Hardening.recoveryDecision({ playback: { state: "COMPLETED" }, offscreenPresent: false }) }, { cleanup: false });
});

test("large macro validation remains bounded for 50k zero-delay events", () => {
  const events = Array.from({ length: 50_000 }, (_, index) => ({ id: `d${index}`, type: "delay", enabled: true, durationMs: 0 }));
  const start = performance.now();
  const result = validateMacro(macro({ events }));
  assert.equal(result.valid, true);
  assert.ok(performance.now() - start < 5000);
});

test("service-worker recovery includes debugger and offscreen cleanup", async () => {
  const source = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  assert.match(source, /reconcileStalePlayback\(true\)/);
  assert.match(source, /OFFSCREEN_CONTROL_PLAYBACK", action: "STOP", reason: "service_worker_restarted"/);
  assert.match(source, /await detachAllDebuggers\(\)/);
  assert.match(source, /errorCode: "OFFSCREEN_LOST"/);
  assert.match(source, /withDeadline\(operation\(debuggee\), CDP_COMMAND_TIMEOUT_MS, "CDP_COMMAND_TIMEOUT"\)/);
  assert.match(source, /if \(geometry\.hidden\) throw new Error\("CDP_TARGET_HIDDEN"\)/);
  assert.match(source, /STOP_PLAYBACK[\s\S]*await detachAllDebuggers\(\)/);
  assert.match(source, /GET_RECORDER_STATE/);
  assert.match(source, /targetState\.sessionId === recorder\.sessionId/);
  assert.match(source, /name: session\.name \|\| null/);
  const offscreen = await readFile(new URL("../extension/offscreen.js", import.meta.url), "utf8");
  assert.match(offscreen, /session\.stopRequested \|\| cause\.message === "STOP_SIGNAL"/);
  const content = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  assert.match(content, /message\.type === "GET_RECORDER_STATE"/);
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(popup, /shouldHydrateRecorderName\(v,macroNameDirty\)/);
});

test("playback stop waits for a terminal state and bounds retained result evidence", async () => {
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const offscreen = await readFile(new URL("../extension/offscreen.js", import.meta.url), "utf8");
  assert.match(worker, /STOP_PLAYBACK[\s\S]*waitForPlaybackStatus\(stopping\.sessionId, 10000\)/);
  assert.match(offscreen, /PLAYBACK_RESULT_ROW_LIMIT = 1000/);
  assert.match(offscreen, /rowsDropped/);
});

test("corrupted import matrix rejects atomically invalid canonical values", () => {
  const cases = [
    macro({ schemaVersion: undefined }),
    macro({ schemaVersion: "99.0" }),
    macro({ events: [{ id: "x", type: "unknown", enabled: true }] }),
    macro({ events: [{ id: "x", type: "delay", enabled: true, durationMs: -1 }] }),
    macro({ events: [{ id: "x", type: "mouseDown", enabled: true, position: { space: "target-normalized", x: 1.01, y: 0 }, button: "left", buttons: 1, modifiers: [] }] }),
    macro({ events: [{ id: "x", type: "keyDown", enabled: true, key: "", code: "", location: 0, repeat: false, modifiers: [] }] }),
    macro({ tabId: 7 }),
    macro({ events: [{ id: "x", type: "text", enabled: true, value: "x".repeat(1_000_001) }] }),
    macro({ playbackDefaults: { speedMultiplier: 0, repeatCount: -1, loopDelayMs: -1, stopOnError: "yes" } })
  ];
  for (const candidate of cases) assert.equal(validateMacro(candidate).valid, false);
});

test("release permissions require no broad hosts and expose broad sites only as optional capability", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "offscreen", "debugger", "webNavigation", "scripting"]);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.equal(manifest.host_permissions.some((pattern) => ["http://*/*", "https://*/*"].includes(pattern)), false);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  for (const permission of ["downloads", "clipboardRead", "clipboardWrite", "activeTab"]) assert.equal(manifest.permissions.includes(permission), false);
});

test("surface routing supports open shadow and portable same-origin frames", async () => {
  const source = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  assert.match(source, /::frame::/);
  assert.match(source, /split\(\/\\s\*>>>\\s\*\//);
  assert.match(source, /CROSS_ORIGIN_FRAME_UNSUPPORTED/);
  assert.match(source, /getBoundingClientRect\(\)/);
});

test("rebind classifies iframe-realm canvas by portable tag semantics", () => {
  const foreignRealmCanvas = { localName: "canvas" };
  assert.equal(Hardening.surfaceKind(foreignRealmCanvas.localName, false), "canvas");
  assert.equal(Hardening.surfaceKind("div", false), "container");
  assert.equal(Hardening.surfaceKind("html", true), "viewport");
});

test("rebind compatibility ignores recorded pixel equality but fails closed on semantic mismatch", () => {
  assert.deepEqual({ ...Hardening.rebindSurfaceCompatibility({ expectedKind: "canvas", resolvedKind: "canvas", rect: { width: 640, height: 360 }, display: "block", visibility: "visible" }) }, { compatible: true, reason: null });
  assert.equal(Hardening.rebindSurfaceCompatibility({ expectedKind: "canvas", resolvedKind: "container", rect: { width: 640, height: 360 } }).reason, "SURFACE_KIND_MISMATCH");
  assert.equal(Hardening.rebindSurfaceCompatibility({ expectedKind: "canvas", resolvedKind: "canvas", rect: { width: 0, height: 360 } }).reason, "ZERO_RECT");
  assert.equal(Hardening.rebindSurfaceCompatibility({ expectedKind: "canvas", resolvedKind: "canvas", rect: { width: 640, height: 360 }, visibility: "hidden" }).reason, "VISIBILITY_REJECTED");
});

test("ignored hover cannot lock the recording surface before the first accepted click", async () => {
  const source = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const ignoredMove = source.indexOf("if (!shouldCaptureMove({ settings: recorderConfig.settings, dragging, previous: lastMove, current: capture })) return;");
  const surfaceLock = source.indexOf("recorderConfig.surfaceSelector = portableSelector(surface);", ignoredMove);
  assert.ok(ignoredMove >= 0, "pointermove filtering must remain explicit");
  assert.ok(surfaceLock > ignoredMove, "the surface must be locked only after an ignored pointermove can return");
});

test("concurrent operations and target changes are guarded", async () => {
  const source = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  for (const code of ["PLAYBACK_BLOCKED_WHILE_RECORDING", "RECORDING_BLOCKED_WHILE_PLAYING", "ACTIVE_PLAYBACK_TARGET_LOCKED", "ACTIVE_RECORDING_TARGET_LOCKED", "DELETE_BLOCKED_WHILE_PLAYING", "DELETE_BLOCKED_WHILE_RECORDING"]) assert.match(source, new RegExp(code));
});

test("export and storage failures preserve retryable editor state", async () => {
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const editor = await readFile(new URL("../extension/editor.js", import.meta.url), "utf8");
  assert.match(worker, /STORAGE_WRITE_FAILED/);
  assert.match(editor, /button\("Export", \(\) => downloadMacro\(macro\)\)/);
  assert.match(editor, /catch \(error\) \{ setStatus\(error\.message, true\); \}/);
});
