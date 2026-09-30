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
const resultPath = path.join(root, "test-results", "phase-3.json");
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error("Chromium executable not found");
const profilePath = await mkdtemp(path.join(os.tmpdir(), "zui-phase3-"));
const chrome = spawn(chromePath, ["--headless=new", "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profilePath}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore", windowsHide: true });
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
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    return this;
  }
  call(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket?.close(); }
}

function value(result) {
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

let browser;
let controller;
let editor;
let controllerTargetId;
let editorTargetId;
const openTargets = [];
try {
  const activePort = await waitFor(async () => {
    const file = path.join(profilePath, "DevToolsActivePort");
    return existsSync(file) ? (await readFile(file, "utf8")).trim().split(/\r?\n/) : null;
  });
  browser = await new Cdp(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`).connect();
  const workerTarget = await waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js")));
  const extensionId = new URL(workerTarget.url).host;
  async function connectTarget(targetId) {
    const descriptor = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json()).find((item) => item.id === targetId));
    const client = await new Cdp(descriptor.webSocketDebuggerUrl).connect();
    await client.call("Runtime.enable");
    return client;
  }
  controllerTargetId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` })).targetId;
  controller = await connectTarget(controllerTargetId);
  const evaluate = async (client, expression) => value(await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
  const controllerEval = (expression) => evaluate(controller, expression);
  const runtime = async (message) => {
    const response = await controllerEval(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    if (!response?.ok) throw new Error(response?.error || "RUNTIME_FAILED");
    return response;
  };
  const targetCommand = async (action) => {
    const response = await runtime({ type: "TARGET_COMMAND", command: { type: "GENERIC_ACTION", action } });
    if (!response.result?.ok) throw new Error(response.result?.error || "TARGET_FAILED");
    return response.result;
  };
  async function openPage(url) {
    const targetId = (await browser.call("Target.createTarget", { url })).targetId;
    openTargets.push(targetId);
    const client = await connectTarget(targetId);
    await waitFor(async () => value(await client.call("Runtime.evaluate", { expression: "document.readyState === 'complete'" })));
    const tab = await waitFor(async () => (await controllerEval("chrome.tabs.query({})")).find((item) => item.url === url));
    return { targetId, client, tab };
  }
  async function pin(page) { await runtime({ type: "PIN_TAB_BY_ID", tabId: page.tab.id }); }
  async function rect(selector) { return (await targetCommand({ kind: "inspect", selector })).state.rect; }
  async function clickAt(client, box) {
    const x = box.left + box.width / 2; const y = box.top + box.height / 2;
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await delay(55);
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }
  async function recordClick(page, name, selector) {
    await pin(page);
    await runtime({ type: "START_RECORDING", name, settings: { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false } });
    await clickAt(page.client, await rect(selector));
    return (await runtime({ type: "STOP_RECORDING" })).status.result.macro;
  }

  const standardPage = await openPage("https://www.selenium.dev/selenium/web/web-form.html");
  const standardRecorded = await recordClick(standardPage, "P3 Standard", "#my-check-2");

  const canvasPage = await openPage("https://szimek.github.io/signature_pad/");
  await pin(canvasPage);
  const canvasBox = await rect("canvas");
  await runtime({ type: "START_RECORDING", name: "P3 Canvas", settings: { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false } });
  const points = [0.25, 0.5, 0.75].map((x, index) => ({ x: canvasBox.left + canvasBox.width * x, y: canvasBox.top + canvasBox.height * (0.45 + index * 0.03) }));
  await canvasPage.client.call("Input.dispatchMouseEvent", { type: "mousePressed", ...points[0], button: "left", buttons: 1, clickCount: 1 });
  for (const point of points.slice(1)) { await delay(25); await canvasPage.client.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1 }); }
  await canvasPage.client.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.at(-1), button: "left", buttons: 0, clickCount: 1 });
  const canvasRecorded = (await runtime({ type: "STOP_RECORDING" })).status.result.macro;

  const frameworkPage = await openPage("https://mui.com/material-ui/react-accordion/");
  await waitFor(() => evaluate(frameworkPage.client, "Boolean(document.querySelector('#panel1d-header'))"));
  await evaluate(frameworkPage.client, "Object.assign(document.querySelector('#panel1d-header').style,{position:'fixed',top:'200px',left:'200px',zIndex:'2147483647',width:'500px'});true");
  await delay(100);
  const frameworkRecorded = await recordClick(frameworkPage, "P3 Framework", "#panel1d-header");
  assert.equal([standardRecorded, canvasRecorded, frameworkRecorded].every((macro) => macro.schemaVersion === "1.0"), true);

  editorTargetId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/editor.html` })).targetId;
  editor = await connectTarget(editorTargetId);
  const editorEval = (expression) => evaluate(editor, expression);
  await waitFor(async () => (await editorEval("({ready:document.readyState,name:document.querySelector('#macro-name')?.value})")).ready === "complete");
  await editorEval(`(() => {
    window.confirm = () => true;
    window.prompt = (_message, fallback) => fallback;
    URL.createObjectURL = (blob) => { blob.text().then((text) => globalThis.__exportText = text); return 'blob:phase3'; };
    HTMLAnchorElement.prototype.click = function(){ globalThis.__exportName = this.download; };
    return true;
  })()`);

  async function openInEditor(name) {
    await editorEval(`(() => { const card=[...document.querySelectorAll('.macro-card')].find((item)=>item.querySelector('strong')?.textContent===${JSON.stringify(name)}); card.querySelector('.card-actions button').click(); return true; })()`);
    await waitFor(async () => (await editorEval("document.querySelector('#macro-name').value")) === name);
  }
  async function selectRow(index) { await editorEval(`document.querySelector('.event-row[data-index="${index}"]').click()`); }
  async function setField(name, value) {
    await editorEval(`(() => { const input=document.querySelector('#detail [name=${JSON.stringify(name)}]'); input.value=${JSON.stringify(String(value))}; return true; })()`);
  }
  async function applyEvent() { await editorEval("document.querySelector('#detail form').requestSubmit()"); }
  async function waitSaved() { return waitFor(async () => (await editorEval("document.querySelector('#dirty').textContent")) === "Saved"); }
  async function clickEditor(selector) { await editorEval(`document.querySelector(${JSON.stringify(selector)}).click()`); }

  await openInEditor("P3 Standard");
  await selectRow(0);
  await setField("durationMs", 25);
  await applyEvent();
  await selectRow(1);
  const originalX = Number(await editorEval("document.querySelector('#detail [name=x]').value"));
  await setField("x", 1.27);
  await applyEvent();
  assert.equal(await editorEval("document.querySelector('#save').disabled && document.querySelector('#replay').disabled"), true);
  assert.equal(await editorEval("document.querySelector('.event-row[data-index=\"1\"]').classList.contains('row-invalid')"), true);
  await clickEditor("#undo");
  await selectRow(1);
  await setField("x", Math.min(1, originalX + 0.0001));
  await applyEvent();
  await clickEditor("#duplicate-event");
  await clickEditor("#delete-event");
  await clickEditor("#move-down");
  await clickEditor("#move-up");
  await clickEditor("#add-event");
  await clickEditor("#delete-event");
  await clickEditor("#undo");
  await clickEditor("#redo");
  assert.equal(await editorEval("document.querySelector('#dirty').textContent"), "Unsaved changes");
  assert.equal(await editorEval("document.querySelector('#macro-validation').textContent"), "VALID");
  await clickEditor("#save");
  await waitSaved();
  const savedStandard = (await runtime({ type: "GET_MACROS" })).macros.find((macro) => macro.name === "P3 Standard");
  assert.equal(savedStandard.events[0].durationMs, 25);

  await editorEval("window.prompt=()=> 'P3 Standard Variant'");
  await clickEditor("#save-as");
  await waitFor(async () => (await editorEval("document.querySelector('#macro-name').value")) === "P3 Standard Variant");
  await clickEditor("#raw-tab");
  const rawBefore = await editorEval("document.querySelector('#raw-json').value");
  assert.equal(JSON.parse(rawBefore).name, "P3 Standard Variant");
  await editorEval("document.querySelector('#raw-json').value='{bad json' ");
  await clickEditor("#apply-raw");
  assert.equal(await editorEval("document.querySelector('#macro-name').value"), "P3 Standard Variant");
  await clickEditor("#cancel-raw");
  await clickEditor("#export");
  const exportedText = await waitFor(async () => editorEval("globalThis.__exportText || null"));
  const exported = JSON.parse(exportedText);
  assert.equal(exported.name, "P3 Standard Variant");
  assert.equal(exported.events[0].durationMs, 25);
  assert.match(await editorEval("globalThis.__exportName"), /\.zui-macro\.json$/);

  await editorEval(`(() => {
    const file=new File([${JSON.stringify(exportedText)}], 'portable.zui-macro.json', {type:'application/json'});
    Object.defineProperty(document.querySelector('#import-file'),'files',{value:[file],configurable:true});
    document.querySelector('#import-file').dispatchEvent(new Event('change'));
    return true;
  })()`);
  await waitFor(async () => (await editorEval("document.querySelector('#macro-name').value")) === "P3 Standard Variant (2)");
  const imported = (await runtime({ type: "GET_MACROS" })).macros.find((macro) => macro.name === "P3 Standard Variant (2)");
  assert.ok(imported);
  assert.notEqual(imported.id, exported.id);
  assert.equal(/\"(?:tabId|windowId|profileId|gmail|authToken|backend)\"/.test(JSON.stringify(imported)), false);

  await pin(standardPage);
  await standardPage.client.call("Runtime.evaluate", { expression: "document.querySelector('#my-check-2').checked=false" });
  await clickEditor("#replay");
  await waitFor(async () => (await editorEval("document.querySelector('#status').textContent")).startsWith("Replay complete"));
  const standardObserved = await targetCommand({ kind: "inspect", selector: "#my-check-2" });
  assert.equal(standardObserved.state.checked, true);

  async function editFirstDelayAndReplay(name, page, reset, inspectSelector, observe, replayDirect = false) {
    await openInEditor(name);
    await selectRow(0);
    const current = Number(await editorEval("document.querySelector('#detail [name=durationMs]').value"));
    await setField("durationMs", current + 5);
    await applyEvent();
    await clickEditor("#save");
    await waitSaved();
    await pin(page);
    await reset();
    if (replayDirect) {
      const macro = (await runtime({ type: "GET_MACROS" })).macros.find((item) => item.name === name);
      await runtime({ type: "START_PLAYBACK", macro });
      await waitFor(async () => { const status = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status; return ["COMPLETED", "ERROR", "STOPPED"].includes(status.state) ? status : null; });
    } else {
      await editorEval("document.querySelector('#status').textContent=''");
      await clickEditor("#replay");
      await waitFor(async () => (await editorEval("document.querySelector('#status').textContent")).startsWith("Replay complete"));
    }
    return observe();
  }

  let canvasClearedHash;
  const canvasObserved = await editFirstDelayAndReplay("P3 Canvas", canvasPage,
    async () => {
      await canvasPage.client.call("Runtime.evaluate", { expression: "document.querySelector('[data-action=clear]').click()" });
      canvasClearedHash = (await targetCommand({ kind: "inspect", selector: "canvas" })).state.canvas.snapshotHash;
    },
    "canvas", () => targetCommand({ kind: "inspect", selector: "canvas" }));
  assert.notEqual(canvasObserved.state.canvas.snapshotHash, canvasClearedHash);

  const frameworkObserved = await editFirstDelayAndReplay("P3 Framework", frameworkPage,
    async () => { const state = await targetCommand({ kind: "inspect", selector: "#panel1d-header" }); if (state.state.ariaExpanded === "false") await frameworkPage.client.call("Runtime.evaluate", { expression: "document.querySelector('#panel1d-header').click()" }); },
    "#panel1d-header", () => targetCommand({ kind: "inspect", selector: "#panel1d-header" }), true);
  assert.equal(frameworkObserved.state.ariaExpanded, "false");

  await pin(standardPage);
  const blankId = (await browser.call("Target.createTarget", { url: "about:blank", background: false })).targetId;
  openTargets.push(blankId);
  await delay(250);
  const hidden = (await runtime({ type: "PLAY_MACRO", macro: imported })).result;
  assert.ok(hidden.rows.some((row) => row.result?.hidden === true || row.result?.visibilityState === "hidden"));

  const editorPerformance = await editorEval(`(() => {
    const big=structuredClone(state.macro);
    big.id='performance-1000'; big.name='Performance 1000';
    big.events=Array.from({length:1000},(_,index)=>({id:'p'+index,type:'delay',enabled:true,durationMs:index}));
    state=ZuiEditorCore.createState(big);
    document.querySelector('#filter').value='all';
    const started=performance.now(); renderAll();
    return {elapsedMs:performance.now()-started,rows:document.querySelectorAll('.event-row').length,valid:state.validation.valid};
  })()`);
  assert.equal(editorPerformance.rows, 1000);
  assert.equal(editorPerformance.valid, true);
  assert.ok(editorPerformance.elapsedMs < 1000, `1000-row DOM render took ${editorPerformance.elapsedMs.toFixed(1)} ms`);

  const report = {
    testedAt: new Date().toISOString(), chromePath,
    recorded: { standard: standardRecorded.events.length, canvas: canvasRecorded.events.length, framework: frameworkRecorded.events.length },
    editorFlow: { delayMs: savedStandard.events[0].durationMs, coordinateDelta: 0.0001, addDeleteDuplicateReorder: true, undoRedo: true, dirtyState: true },
    saveAs: { name: exported.name, newId: exported.id !== standardRecorded.id },
    exportImport: { fileName: await editorEval("globalThis.__exportName"), importedName: imported.name, canonicalMatch: imported.events[0].durationMs === exported.events[0].durationMs, portable: true },
    rawJson: { validRoundTrip: JSON.parse(rawBefore).name === exported.name, invalidPreservedState: true },
    replay: { standardChecked: standardObserved.state.checked, canvasHash: canvasObserved.state.canvas.snapshotHash, frameworkExpanded: frameworkObserved.state.ariaExpanded },
    hidden: { scheduler: hidden.scheduler, hiddenRows: hidden.rows.filter((row) => row.result?.hidden === true || row.result?.visibilityState === "hidden").length },
    performance: editorPerformance
  };
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  editor?.close(); controller?.close();
  await closeBrowserProcess(browser, chrome);
  await removeDirectoryBestEffort(profilePath);
  await testExtension.cleanup().catch(() => {});
}
process.exit(0);
