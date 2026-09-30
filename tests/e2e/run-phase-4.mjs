import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testExtension = await prepareTestExtension(path.join(root, "extension"), [
  "https://www.selenium.dev/*",
  "https://szimek.github.io/*",
  "https://mui.com/*"
]);
const extensionPath = testExtension.extensionPath;
const resultPath = path.join(root, "test-results", "phase-4.json");
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error("Chromium executable not found");
const profilePath = await mkdtemp(path.join(os.tmpdir(), "zui-phase4-"));
const chrome = spawn(chromePath, ["--headless=new", "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profilePath}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 30000) { const end = Date.now() + timeout; let cause; while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (error) { cause = error; } await sleep(20); } throw cause || new Error("Timed out"); }
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() { this.socket = new WebSocket(this.url); await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); }); this.socket.addEventListener("message", ({ data }) => { const msg = JSON.parse(data); if (!msg.id || !this.pending.has(msg.id)) return; const pending = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result); }); return this; }
  call(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket?.close(); }
}
function value(result) { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
let browser; const clients = [];
try {
  const port = await waitFor(async () => { const file = path.join(profilePath, "DevToolsActivePort"); return existsSync(file) ? (await readFile(file, "utf8")).trim().split(/\r?\n/) : null; });
  browser = await new Cdp(`ws://127.0.0.1:${port[0]}${port[1]}`).connect();
  const worker = await waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js")));
  const extensionId = new URL(worker.url).host;
  async function connect(targetId) { const descriptor = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port[0]}/json/list`)).json()).find((item) => item.id === targetId)); const client = await new Cdp(descriptor.webSocketDebuggerUrl).connect(); clients.push(client); await client.call("Runtime.enable"); return client; }
  const popupId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` })).targetId;
  const popup = await connect(popupId);
  const evaluate = async (client, expression) => value(await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
  const popupEval = (expression) => evaluate(popup, expression);
  const runtime = async (message, allowError = false) => { const response = await popupEval(`chrome.runtime.sendMessage(${JSON.stringify(message)})`); if (!response?.ok && !allowError) throw new Error(response?.error || "RUNTIME_FAILED"); return response; };
  const targetCommand = async (action) => (await runtime({ type: "TARGET_COMMAND", command: { type: "GENERIC_ACTION", action } })).result;
  async function open(url) { const id = (await browser.call("Target.createTarget", { url })).targetId; const client = await connect(id); await waitFor(() => evaluate(client, "document.readyState === 'complete'")); const tab = await waitFor(async () => (await popupEval("chrome.tabs.query({})")).find((item) => item.url === url)); return { id, client, tab }; }
  const standard = await open("https://www.selenium.dev/selenium/web/web-form.html");
  await runtime({ type: "PIN_TAB_BY_ID", tabId: standard.tab.id });
  const base = (name, events, defaults = {}, surface = "body", origin = "https://www.selenium.dev") => ({ schemaVersion: "1.0", id: name.toLowerCase().replace(/\W/g, "-"), name, target: { origin, surface: { kind: surface === "canvas" ? "canvas" : "viewport", locator: { strategy: "css", value: surface } } }, recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true }, playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true, ...defaults }, events });
  let next = 0; const id = () => `p4-${++next}`; const delayEvent = (ms) => ({ id: id(), type: "delay", enabled: true, durationMs: ms });
  const point = { space: "target-normalized", x: .5, y: .5 };
  const down = () => ({ id: id(), type: "mouseDown", enabled: true, position: point, button: "left", buttons: 1, modifiers: [] });
  const up = () => ({ id: id(), type: "mouseUp", enabled: true, position: point, button: "left", buttons: 0, modifiers: [] });
  const key = (type, value = "a", code = "KeyA") => ({ id: id(), type, enabled: true, key: value, code, location: 0, repeat: false, modifiers: [] });
  async function status() { return (await runtime({ type: "GET_PLAYBACK_STATUS" })).status; }
  async function completed(timeout = 30000) { return waitFor(async () => { const item = await status(); return ["COMPLETED", "STOPPED", "ERROR"].includes(item.state) ? item : null; }, timeout); }
  async function play(macro, options) { await runtime({ type: "START_PLAYBACK", macro, options }); return completed(); }

  const uiMacro = base("Phase 4 UI", [delayEvent(300), down(), up()]);
  await runtime({ type: "SAVE_MACRO", macro: uiMacro, allowReplace: false });
  const editorId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/editor.html` })).targetId;
  const editor = await connect(editorId); const editorEval = (expression) => evaluate(editor, expression);
  await waitFor(async () => (await editorEval("document.querySelector('#macro-name')?.value")) === "Phase 4 UI");
  for (const [selector, valueToSet] of [["#playback-speed", "2"], ["#playback-repeat", "3"], ["#playback-loop-delay", "100"]]) {
    await editorEval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(valueToSet)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  }
  assert.equal(await editorEval("document.querySelector('#dirty').textContent"), "Unsaved changes");
  assert.equal(await editorEval("document.querySelector('#playback-play').disabled"), false);
  assert.equal(await editorEval("document.querySelector('#playback-pause').disabled"), true);
  await editorEval("document.querySelector('#save').click()");
  await waitFor(async () => (await editorEval("document.querySelector('#dirty').textContent")) === "Saved");
  const savedUi = (await runtime({ type: "GET_MACROS" })).macros.find((macro) => macro.id === uiMacro.id);
  assert.deepEqual(savedUi.playbackDefaults, { speedMultiplier: 2, repeatCount: 3, loopDelayMs: 100, stopOnError: true });
  const importedUi = structuredClone(savedUi); importedUi.id = "phase-4-ui-import"; importedUi.name = "Phase 4 UI Import";
  await runtime({ type: "SAVE_MACRO", macro: JSON.parse(JSON.stringify(importedUi)), allowReplace: false });
  const importedSaved = (await runtime({ type: "GET_MACROS" })).macros.find((macro) => macro.id === importedUi.id);
  assert.deepEqual(importedSaved.playbackDefaults, savedUi.playbackDefaults);
  assert.equal(/"(?:activePlayback|eventIndex|heldInputs|runtimeCleanup|tabId|windowId|backend)"/.test(JSON.stringify(importedSaved)), false);
  const shortcutText = await waitFor(async () => { const text = await editorEval("document.querySelector('#playback-shortcuts').textContent"); return text.includes("Play, pause or resume") ? text : null; });
  await editorEval("document.querySelector('#playback-step').click()");
  const stepAdvancedTo = await waitFor(async () => { const index = await editorEval("document.querySelector('.event-row.selected')?.dataset.index"); return index === "1" ? Number(index) : null; });

  const timing = {};
  for (const speed of [.5, 1, 2, 5]) {
    const result = await play(base(`Timing ${speed}`, [delayEvent(200)], { speedMultiplier: speed }));
    assert.ok(result.result, `timing playback did not complete: ${JSON.stringify(result)}`);
    timing[speed] = result.result.durationMs;
    assert.ok(result.result.durationMs >= 200 / speed - 25);
  }
  assert.equal(timing[.5] > timing[1] && timing[1] > timing[2] && timing[2] > timing[5], true);

  const repeats = {};
  for (const repeatCount of [1, 3, 10]) {
    const result = await play(base(`Repeat ${repeatCount}`, [down(), up()], { repeatCount, loopDelayMs: repeatCount === 3 ? 100 : 0 }));
    repeats[repeatCount] = result.result.eventsExecuted;
    assert.equal(result.result.eventsExecuted, repeatCount * 2);
  }

  const pauseMacro = base("Pause delay", [delayEvent(500), down(), up()]);
  await runtime({ type: "START_PLAYBACK", macro: pauseMacro }); await sleep(140); await runtime({ type: "PAUSE_PLAYBACK" });
  const paused = await waitFor(async () => (await status()).state === "PAUSED" ? status() : null);
  assert.ok(paused.remainingDelayMs > 250 && paused.remainingDelayMs < 430);
  await sleep(250); await runtime({ type: "RESUME_PLAYBACK" }); const resumed = await completed(); assert.equal(resumed.state, "COMPLETED");

  const heldMacro = base("Held pause", [down(), delayEvent(120), up(), delayEvent(200)]);
  await runtime({ type: "START_PLAYBACK", macro: heldMacro }); await sleep(25); await runtime({ type: "PAUSE_PLAYBACK" });
  const heldPaused = await waitFor(async () => { const item = await status(); return item.state === "PAUSED" ? item : null; });
  assert.equal(heldPaused.eventIndex, 2); assert.equal(heldPaused.heldInputs, 0);
  await runtime({ type: "RESUME_PLAYBACK" }); await completed();

  const keyboardMacro = base("Keyboard pause", [key("keyDown"), delayEvent(100), key("keyUp"), delayEvent(100)]);
  await runtime({ type: "START_PLAYBACK", macro: keyboardMacro }); await sleep(20); await runtime({ type: "PAUSE_PLAYBACK" });
  const keyboardPaused = await waitFor(async () => { const item = await status(); return item.state === "PAUSED" ? item : null; });
  assert.equal(keyboardPaused.heldInputs, 0); await runtime({ type: "RESUME_PLAYBACK" }); await completed();

  const dragMacro = base("Drag pause", [down(), { ...down(), id: id(), type: "mouseMove", button: "none", buttons: 1, position: { ...point, x: .6 } }, delayEvent(100), up(), delayEvent(80)]);
  await runtime({ type: "START_PLAYBACK", macro: dragMacro }); await sleep(20); await runtime({ type: "PAUSE_PLAYBACK" });
  const dragPaused = await waitFor(async () => { const item = await status(); return item.state === "PAUSED" ? item : null; });
  assert.equal(dragPaused.heldInputs, 0); assert.equal(dragPaused.eventIndex, 3); await runtime({ type: "RESUME_PLAYBACK" }); await completed();

  const loopMacro = base("Loop pause", [down(), up()], { repeatCount: 2, loopDelayMs: 500 });
  await runtime({ type: "START_PLAYBACK", macro: loopMacro });
  await waitFor(async () => (await status()).delayKind === "loop"); await runtime({ type: "PAUSE_PLAYBACK" });
  const loopPaused = await waitFor(async () => { const item = await status(); return item.state === "PAUSED" ? item : null; });
  assert.ok(loopPaused.remainingDelayMs > 250); await runtime({ type: "RESUME_PLAYBACK" }); await completed();
  await runtime({ type: "START_PLAYBACK", macro: loopMacro }); await waitFor(async () => (await status()).delayKind === "loop"); await runtime({ type: "STOP_PLAYBACK" }); const loopStopped = await completed(); assert.equal(loopStopped.state, "STOPPED");

  const heldStopMacro = base("Held stop", [down(), delayEvent(500), up()]);
  await runtime({ type: "START_PLAYBACK", macro: heldStopMacro }); await waitFor(async () => (await status()).heldInputs === 1); await runtime({ type: "STOP_PLAYBACK" });
  const heldStopped = await completed(); assert.equal(heldStopped.state, "STOPPED"); assert.equal(heldStopped.heldInputs, 0);
  const keyStopMacro = base("Key stop", [key("keyDown", "Control", "ControlLeft"), delayEvent(500), key("keyUp", "Control", "ControlLeft")]); await runtime({ type: "START_PLAYBACK", macro: keyStopMacro }); await waitFor(async () => (await status()).heldInputs === 1); await runtime({ type: "STOP_PLAYBACK" }); const keyStopped = await completed(); assert.equal(keyStopped.heldInputs, 0);
  const dragStopMacro = base("Drag stop", [down(), { ...down(), id: id(), type: "mouseMove", button: "none", buttons: 1, position: { ...point, x: .7 } }, delayEvent(500), up()]); await runtime({ type: "START_PLAYBACK", macro: dragStopMacro }); await waitFor(async () => (await status()).heldInputs === 1); await runtime({ type: "STOP_PLAYBACK" }); const dragStopped = await completed(); assert.equal(dragStopped.heldInputs, 0);

  await standard.client.call("Runtime.evaluate", { expression: "document.querySelector('input[type=password]').focus()" });
  const backendFailure = base("Sensitive failure", [key("keyDown", "Control", "ControlLeft"), { id: id(), type: "text", enabled: true, value: "secret" }]);
  const failed = await play(backendFailure); assert.equal(failed.state, "ERROR"); assert.match(failed.errorCode, /SENSITIVE_INPUT_BLOCKED/); assert.equal(failed.heldInputs, 0);
  await targetCommand({ kind: "focus", selector: "#my-text-id", clear: true });
  const textResult = await play(base("CDP text", [{ id: id(), type: "text", enabled: true, value: "phase4" }]));
  assert.equal(textResult.result.eventsExecuted, 1); assert.equal((await targetCommand({ kind: "inspect", selector: "#my-text-id" })).state.value, "phase4");
  await targetCommand({ kind: "focus", selector: "select.form-select" }); const selectBefore = (await targetCommand({ kind: "inspect", selector: "select.form-select" })).state.selectedIndex;
  await play(base("CDP select", [key("keyDown", "ArrowDown", "ArrowDown"), key("keyUp", "ArrowDown", "ArrowDown")])); const selectAfter = (await targetCommand({ kind: "inspect", selector: "select.form-select" })).state.selectedIndex; assert.notEqual(selectAfter, selectBefore);

  const stepMacro = base("Safe step", [down(), delayEvent(20), up(), delayEvent(10)]);
  const stepped = await play(stepMacro, { mode: "step", index: 0 }); assert.equal(stepped.result.eventsExecuted, 2); assert.deepEqual(stepped.range, { start: 0, end: 3 });
  const unsafeFrom = await runtime({ type: "START_PLAYBACK", macro: stepMacro, options: { mode: "from", index: 1 } }, true); assert.match(unsafeFrom.error, /UNSAFE_START_BOUNDARY/);
  const from = await play(stepMacro, { mode: "from", index: 3 }); assert.deepEqual(from.range, { start: 3, end: 4 });

  const infinite = base("Infinite", [delayEvent(10)], { repeatCount: 0 });
  await runtime({ type: "START_PLAYBACK", macro: infinite }); await sleep(120); await runtime({ type: "STOP_PLAYBACK" }); const stopped = await completed(); assert.equal(stopped.state, "STOPPED"); assert.ok(stopped.iteration > 2);

  const canvas = await open("https://szimek.github.io/signature_pad/"); await runtime({ type: "PIN_TAB_BY_ID", tabId: canvas.tab.id });
  const canvasBefore = (await targetCommand({ kind: "inspect", selector: "canvas" })).state.canvas.snapshotHash;
  const canvasMacro = base("Canvas drag", [{ ...down(), position: { ...point, x: .25 } }, delayEvent(20), { ...down(), id: id(), type: "mouseMove", button: "none", buttons: 1, position: { ...point, x: .7 } }, delayEvent(20), { ...up(), position: { ...point, x: .7 } }], { repeatCount: 2 }, "canvas", "https://szimek.github.io");
  await runtime({ type: "START_PLAYBACK", macro: canvasMacro }); await sleep(15); await runtime({ type: "PAUSE_PLAYBACK" }); const canvasPaused = await waitFor(async () => { const item = await status(); return item.state === "PAUSED" ? item : null; }); assert.equal(canvasPaused.heldInputs, 0); await runtime({ type: "RESUME_PLAYBACK" }); await completed();
  const canvasAfter = (await targetCommand({ kind: "inspect", selector: "canvas" })).state.canvas.snapshotHash; assert.notEqual(canvasAfter, canvasBefore);

  const framework = await open("https://mui.com/material-ui/react-accordion/"); await framework.client.call("Runtime.evaluate", { expression: "document.querySelector('#panel1d-header').scrollIntoView({block:'center'})" }); await runtime({ type: "PIN_TAB_BY_ID", tabId: framework.tab.id });
  const frameworkBefore = (await targetCommand({ kind: "inspect", selector: "#panel1d-header" })).state.ariaExpanded;
  const frameworkMacro = base("Framework repeat", [down(), up(), delayEvent(40)], { repeatCount: 2 }, "#panel1d-header", "https://mui.com"); const frameworkResult = await play(frameworkMacro); const frameworkAfter = (await targetCommand({ kind: "inspect", selector: "#panel1d-header" })).state.ariaExpanded; assert.equal(frameworkAfter, frameworkBefore); assert.equal(frameworkResult.result.eventsExecuted, 4);

  await runtime({ type: "PIN_TAB_BY_ID", tabId: standard.tab.id });
  const idle = await open("https://www.selenium.dev/selenium/web/blank.html"); await idle.client.call("Page.bringToFront");
  const hiddenOne = await play(base("Hidden 1x", [delayEvent(100), down(), up()], { speedMultiplier: 1, repeatCount: 1 }));
  const hiddenResult = await play(base("Hidden", [delayEvent(100), down(), up()], { speedMultiplier: 2, repeatCount: 3 }));
  await runtime({ type: "START_PLAYBACK", macro: base("Hidden infinite", [delayEvent(20)], { repeatCount: 0 }) }); await sleep(90); await runtime({ type: "STOP_PLAYBACK" }); const hiddenStopped = await completed(); assert.equal(hiddenStopped.state, "STOPPED");
  const hiddenState = await evaluate(standard.client, "({hidden:document.hidden,visibilityState:document.visibilityState})");
  assert.equal(hiddenState.hidden, true); assert.equal(hiddenResult.result.eventsExecuted, 6);

  const zeroEvents = Array.from({ length: 1000 }, () => delayEvent(0));
  const thousand = await play(base("1000 zero delays", zeroEvents), undefined); assert.equal(thousand.state, "COMPLETED"); assert.ok(thousand.result.durationMs < 5000);

  const longRun = await play(base("100 loops", [down(), up()], { repeatCount: 100 }), undefined); assert.equal(longRun.result.eventsExecuted, 200);
  const cdp = await runtime({ type: "GET_CDP_STATE" }); assert.deepEqual(cdp.sessions, []);
  const disposable = await open("https://www.selenium.dev/selenium/web/web-form.html?close-test"); await runtime({ type: "PIN_TAB_BY_ID", tabId: disposable.tab.id }); await runtime({ type: "START_PLAYBACK", macro: base("Target close", [delayEvent(1000)]) }); await browser.call("Target.closeTarget", { targetId: disposable.id }); const targetClosed = await completed(); assert.equal(targetClosed.reason, "TARGET_CLOSED");
  const report = { testedAt: new Date().toISOString(), chromePath, editorUi: { defaults: savedUi.playbackDefaults, importRoundTrip: importedSaved.playbackDefaults, runtimeFieldsExported: false, shortcuts: shortcutText, stepAdvancedTo }, timing, repeats, pause: { remainingDelayMs: paused.remainingDelayMs, heldMouseEventIndex: heldPaused.eventIndex, keyboardHeldInputs: keyboardPaused.heldInputs, dragEventIndex: dragPaused.eventIndex, loopRemainingMs: loopPaused.remainingDelayMs }, stop: { mouseHeldCleanup: heldStopped.heldInputs, keyboardHeldCleanup: keyStopped.heldInputs, dragHeldCleanup: dragStopped.heldInputs, loopDelayState: loopStopped.state, targetCloseReason: targetClosed.reason }, errorCleanup: { state: failed.state, code: failed.errorCode, heldInputs: failed.heldInputs }, step: { range: stepped.range, unsafeFrom: unsafeFrom.error, from: from.range }, infinite: { stoppedAtIteration: stopped.iteration }, canvas: { beforeHash: canvasBefore, afterHash: canvasAfter, pausedHeldInputs: canvasPaused.heldInputs }, framework: { before: frameworkBefore, after: frameworkAfter, eventsExecuted: frameworkResult.result.eventsExecuted }, keyboardCdp: { value: "phase4", textEvents: textResult.result.eventsExecuted, selectBefore, selectAfter }, hidden: { ...hiddenState, scheduler: "OFFSCREEN_DOCUMENT", oneXDurationMs: hiddenOne.result.durationMs, twoXEventsExecuted: hiddenResult.result.eventsExecuted, manualStop: hiddenStopped.state }, thousand: { durationMs: thousand.result.durationMs }, longRun: { iterations: longRun.iteration, eventsExecuted: longRun.result.eventsExecuted, cdpSessions: cdp.sessions.length } };
  await mkdir(path.dirname(resultPath), { recursive: true }); await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(JSON.stringify(report, null, 2));
} finally {
  for (const client of clients) client.close(); browser?.close(); chrome.kill(); await rm(profilePath, { recursive: true, force: true }).catch(() => {}); await testExtension.cleanup().catch(() => {});
}
