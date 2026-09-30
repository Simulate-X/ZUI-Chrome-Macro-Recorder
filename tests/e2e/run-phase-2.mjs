import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";
import { closeBrowserProcess, removeDirectoryBestEffort } from "./process-cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testExtension = await prepareTestExtension(path.join(root, "extension"), [
  "https://www.selenium.dev/*",
  "https://szimek.github.io/*",
  "https://mui.com/*"
]);
const extensionPath = testExtension.extensionPath;
const resultPath = path.join(root, "test-results", "phase-2.json");
const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
const chromePath = candidates.find(existsSync);
if (!chromePath) throw new Error("Chromium executable not found");
const profilePath = await mkdtemp(path.join(os.tmpdir(), "zui-phase2-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profilePath}`,
  `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"
], { stdio: "ignore", windowsHide: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let cause;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { cause = error; }
    await delay(100);
  }
  throw cause || new Error("Timed out");
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    return this;
  }
  call(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.socket?.close(); }
}

function value(result) {
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

let browser;
let worker;
let controller;
let controllerTargetId;
const openPages = [];
try {
  const activePort = await waitFor(async () => {
    const file = path.join(profilePath, "DevToolsActivePort");
    if (!existsSync(file)) return null;
    return (await readFile(file, "utf8")).trim().split(/\r?\n/);
  });
  browser = await new Cdp(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`).connect();
  const targets = await waitFor(async () => {
    const rows = (await browser.call("Target.getTargets")).targetInfos;
    const serviceWorker = rows.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js"));
    return serviceWorker || null;
  });
  const descriptor = (await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json()).find((item) => item.id === targets.targetId);
  worker = await new Cdp(descriptor.webSocketDebuggerUrl).connect();
  await worker.call("Runtime.enable");
  const workerEval = async (expression) => value(await worker.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
  const extensionId = new URL(targets.url).host;
  const controllerTarget = await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` });
  controllerTargetId = controllerTarget.targetId;
  const controllerDescriptor = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json()).find((item) => item.id === controllerTargetId));
  controller = await new Cdp(controllerDescriptor.webSocketDebuggerUrl).connect();
  await controller.call("Runtime.enable");
  const controllerEval = async (expression, userGesture = false) => value(await controller.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture }));
  const runtime = async (message) => {
    const response = await controllerEval(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    if (!response?.ok) throw new Error(response?.error || "RUNTIME_FAILED");
    return response;
  };
  const targetCommand = async (command) => {
    const response = await runtime({ type: "TARGET_COMMAND", command: { type: "GENERIC_ACTION", action: command } });
    if (!response.result?.ok) throw new Error(response.result?.error || "TARGET_FAILED");
    return response.result;
  };
  async function openPage(url) {
    const created = await browser.call("Target.createTarget", { url });
    openPages.push(created.targetId);
    const info = await waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.targetId === created.targetId && item.url === url));
    const list = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
    const page = await new Cdp(list.find((item) => item.id === info.targetId).webSocketDebuggerUrl).connect();
    await page.call("Runtime.enable");
    await waitFor(async () => value(await page.call("Runtime.evaluate", { expression: "document.readyState === 'complete'" })));
    const tab = await waitFor(async () => (await controllerEval("chrome.tabs.query({})")).find((item) => item.url === url));
    await runtime({ type: "PIN_TAB_BY_ID", tabId: tab.id });
    await waitFor(async () => {
      try { return (await controllerEval(`chrome.tabs.sendMessage(${tab.id}, {type:'GET_SURFACE'})`))?.ok; } catch { return false; }
    });
    return { page, tab, targetId: created.targetId };
  }
  async function rect(selector) {
    const inspected = await targetCommand({ kind: "inspect", selector });
    return inspected.state.rect;
  }
  async function click(page, box) {
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    await page.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await delay(70);
    await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }
  async function key(page, keyValue, code, text = "") {
    const vk = keyValue.length === 1 ? keyValue.toUpperCase().charCodeAt(0) : 0;
    await page.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyValue, code, windowsVirtualKeyCode: vk });
    if (text) await page.call("Input.dispatchKeyEvent", { type: "char", key: keyValue, code, text, unmodifiedText: text, windowsVirtualKeyCode: vk });
    await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, windowsVirtualKeyCode: vk });
  }
  async function start(name, settings = { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true }) {
    return runtime({ type: "START_RECORDING", name, settings });
  }
  async function stop() { return (await runtime({ type: "STOP_RECORDING" })).status.result; }

  const standardTarget = await openPage("https://www.selenium.dev/selenium/web/web-form.html");
  await start("Phase2 Standard DOM");
  await click(standardTarget.page, await rect("#my-check-2"));
  await click(standardTarget.page, await rect("#my-text-id"));
  await key(standardTarget.page, "z", "KeyZ", "z");
  const wheelRect = await rect("#my-text-id");
  await standardTarget.page.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: wheelRect.left + 10, y: wheelRect.top + 10, deltaX: 0, deltaY: 160 });
  await delay(80);
  const standard = await stop();
  assert.equal(standard.valid, true);
  assert.ok(standard.macro.events.some((event) => event.type === "keyDown"));
  assert.ok(standard.macro.events.some((event) => event.type === "mouseWheel"));
  await standardTarget.page.call("Runtime.evaluate", { expression: "document.querySelector('#my-check-2').checked=false; document.querySelector('#my-text-id').value=''; scrollTo(0,0)" });
  standardTarget.page.close();
  const standardReplay = (await runtime({ type: "PLAY_MACRO", macro: standard.macro })).result;
  const standardObserved = await targetCommand({ kind: "inspect", selector: "#my-text-id" });
  assert.equal(standardObserved.state.value, "z");

  const canvasTarget = await openPage("https://szimek.github.io/signature_pad/");
  const canvasRect = await rect("canvas");
  await start("Phase2 Canvas", { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false });
  const points = [0.2, 0.35, 0.5, 0.65, 0.8].map((x, index) => ({ x: canvasRect.left + canvasRect.width * x, y: canvasRect.top + canvasRect.height * (0.4 + index * 0.03) }));
  await canvasTarget.page.call("Input.dispatchMouseEvent", { type: "mousePressed", ...points[0], button: "left", buttons: 1, clickCount: 1 });
  for (const point of points.slice(1)) { await delay(30); await canvasTarget.page.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1 }); }
  await canvasTarget.page.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.at(-1), button: "left", buttons: 0, clickCount: 1 });
  const canvas = await stop();
  assert.equal(canvas.valid, true);
  assert.ok(canvas.macro.events.some((event) => event.type === "mouseMove"), "drag movement was not preserved");
  const canvasBeforeClear = await targetCommand({ kind: "inspect", selector: "canvas" });
  await canvasTarget.page.call("Runtime.evaluate", { expression: "document.querySelector('[data-action=clear]').click()" });
  const canvasCleared = await targetCommand({ kind: "inspect", selector: "canvas" });
  const canvasReplay = (await runtime({ type: "PLAY_MACRO", macro: canvas.macro })).result;
  const canvasAfter = await targetCommand({ kind: "inspect", selector: "canvas" });
  assert.notEqual(canvasAfter.state.canvas.snapshotHash, canvasCleared.state.canvas.snapshotHash);

  const frameworkTarget = await openPage("https://mui.com/material-ui/react-accordion/");
  await frameworkTarget.page.call("Runtime.evaluate", { expression: "document.querySelector('#panel1d-header').scrollIntoView({block:'center'})" });
  await delay(150);
  await start("Phase2 Modern Framework");
  await click(frameworkTarget.page, await rect("#panel1d-header"));
  const framework = await stop();
  assert.equal(framework.valid, true);
  await frameworkTarget.page.call("Runtime.evaluate", { expression: "document.querySelector('#panel1d-header').click()" });
  const frameworkReset = await targetCommand({ kind: "inspect", selector: "#panel1d-header" });
  const frameworkReplay = (await runtime({ type: "PLAY_MACRO", macro: framework.macro })).result;
  const frameworkObserved = await targetCommand({ kind: "inspect", selector: "#panel1d-header" });
  assert.notEqual(frameworkObserved.state.ariaExpanded, frameworkReset.state.ariaExpanded);

  await runtime({ type: "PIN_TAB_BY_ID", tabId: canvasTarget.tab.id });
  await browser.call("Target.createTarget", { url: "about:blank", newWindow: false, background: false });
  await delay(300);
  const hiddenReplay = (await runtime({ type: "PLAY_MACRO", macro: canvas.macro })).result;
  assert.ok(hiddenReplay.rows.some((row) => row.result?.hidden === true || row.result?.visibilityState === "hidden"));

  const pauseTarget = standardTarget;
  await runtime({ type: "PIN_TAB_BY_ID", tabId: pauseTarget.tab.id });
  const pageList = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
  const pausePage = await new Cdp(pageList.find((item) => item.id === pauseTarget.targetId).webSocketDebuggerUrl).connect();
  await pausePage.call("Runtime.enable");
  await start("Pause timing", { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false });
  await click(pausePage, await rect("#my-check-2"));
  await runtime({ type: "PAUSE_RECORDING" });
  await delay(650);
  await runtime({ type: "RESUME_RECORDING" });
  await delay(120);
  await click(pausePage, await rect("#my-check-2"));
  const paused = await stop();
  const delays = paused.macro.events.filter((event) => event.type === "delay").map((event) => event.durationMs);
  assert.ok(Math.max(...delays) < 500, `pause leaked into macro delay: ${Math.max(...delays)}`);

  await start("Sensitive field", { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: false });
  await click(pausePage, await rect("input[type=password]"));
  await key(pausePage, "q", "KeyQ", "q");
  await delay(80);
  const sensitive = await stop();
  const sensitiveStatus = (await runtime({ type: "GET_RECORDER_STATUS" })).status;
  assert.ok(sensitiveStatus.warnings.includes("SENSITIVE_INPUT_BLOCKED"));
  assert.equal(sensitive.macro.events.some((event) => event.type === "keyDown" || event.type === "keyUp"), false);

  await start("Navigation fail closed", { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false });
  await pausePage.call("Page.enable");
  await pausePage.call("Page.navigate", { url: "https://szimek.github.io/signature_pad/" });
  const navigatedStatus = await waitFor(async () => {
    const status = (await runtime({ type: "GET_RECORDER_STATUS" })).status;
    return status.state === "STOPPED" ? status : null;
  });
  assert.equal(navigatedStatus.reason, "target_navigated");
  pausePage.close();

  await runtime({ type: "PIN_TAB_BY_ID", tabId: frameworkTarget.tab.id });
  await start("Close fail closed", { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false });
  await browser.call("Target.closeTarget", { targetId: frameworkTarget.targetId });
  const closedStatus = await waitFor(async () => {
    const status = (await runtime({ type: "GET_RECORDER_STATUS" })).status;
    return status.state === "STOPPED" ? status : null;
  });
  assert.equal(closedStatus.reason, "target_closed");
  const stored = await runtime({ type: "GET_MACROS" });
  assert.ok(stored.macros.length >= 3);
  assert.equal(stored.macros.some((macro) => /\"(?:tabId|windowId|sessionToken|backend)\"/.test(JSON.stringify(macro))), false);

  const report = {
    testedAt: new Date().toISOString(), chromePath,
    standard: { valid: standard.valid, eventCount: standard.eventCount, replayRows: standardReplay.rows.length, value: standardObserved.state.value },
    canvas: { valid: canvas.valid, eventCount: canvas.eventCount, dragMoves: canvas.macro.events.filter((event) => event.type === "mouseMove").length, replayRows: canvasReplay.rows.length, beforeHash: canvasBeforeClear.state.canvas.snapshotHash, afterHash: canvasAfter.state.canvas.snapshotHash },
    framework: { valid: framework.valid, eventCount: framework.eventCount, replayRows: frameworkReplay.rows.length, ariaExpanded: frameworkObserved.state.ariaExpanded },
    hidden: { scheduler: hiddenReplay.scheduler, hiddenRows: hiddenReplay.rows.filter((row) => row.result?.hidden === true || row.result?.visibilityState === "hidden").length },
    pause: { delays, pauseExcluded: true },
    sensitive: { warning: sensitiveStatus.warnings[0], recordedKeyboardEvents: sensitive.macro.events.filter((event) => event.type === "keyDown" || event.type === "keyUp").length },
    lifecycle: { navigation: navigatedStatus.reason, close: closedStatus.reason },
    storage: { macroCount: stored.macros.length, runtimeIdentityFields: false },
    windowsInputInjection: false,
    backendsStoredInMacro: [standard, canvas, framework].some((result) => JSON.stringify(result.macro).includes('"backend"'))
  };
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  controller?.close(); worker?.close();
  await closeBrowserProcess(browser, chrome);
  await removeDirectoryBestEffort(profilePath);
  await testExtension.cleanup().catch(() => {});
}
process.exit(0);
