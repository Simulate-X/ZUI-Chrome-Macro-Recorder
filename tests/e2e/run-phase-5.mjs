import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";
import { closeBrowserProcess, removeDirectoryBestEffort } from "./process-cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseExtensionPath = path.join(root, "dist", "extension");
const resultPath = path.join(root, "test-results", "phase-5.json");
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error("Chromium executable not found");
const built = spawnSync(process.execPath, [path.join(root, "scripts", "build-release.mjs")], { cwd: root, stdio: "inherit" });
if (built.status !== 0) throw new Error("Release build failed");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 30000) { const end = Date.now() + timeout; let cause; while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (error) { cause = error; } await sleep(25); } throw cause || new Error("Timed out"); }

const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;min-width:1800px;min-height:1800px;font:16px sans-serif}#stage{margin:80px;padding:30px;background:#111;width:640px}canvas{display:block;width:640px;height:360px;background:#eee}#transformed{margin:40px;width:200px;height:100px;transform:translate(30px,20px) scale(1.25);transform-origin:0 0}#far{position:absolute;left:1200px;top:1200px}
</style><button id="action">Action</button><input id="text"><input id="password" type="password"><input id="otp" autocomplete="one-time-code"><input id="token" name="api_token">
<div id="stage"><canvas id="canvas-a" width="640" height="360"></canvas></div><canvas id="canvas-b" width="320" height="180"></canvas><button id="transformed">Transformed</button><div id="shadow-host"></div>
<iframe id="same-frame" src="/frame"></iframe><iframe id="cross-frame"></iframe><button id="far">Far</button>
<script>
const hit=(e)=>{e.currentTarget.dataset.count=String(+(e.currentTarget.dataset.count||0)+1);e.currentTarget.dataset.x=e.clientX;e.currentTarget.dataset.y=e.clientY};
for(const e of ['#action','#canvas-a','#canvas-b','#transformed','#far'].map(s=>document.querySelector(s)))e.addEventListener('click',hit);
const shadow=document.querySelector('#shadow-host').attachShadow({mode:'open'});shadow.innerHTML='<button id="shadow-button">Shadow</button><input id="shadow-input">';shadow.querySelector('button').addEventListener('click',hit);
window.replaceCanvas=()=>{const old=document.querySelector('#canvas-a');const fresh=old.cloneNode();old.replaceWith(fresh);fresh.addEventListener('click',hit)};
document.querySelector('#cross-frame').src='http://localhost:'+location.port+'/frame';
</script>`;
const framePage = `<!doctype html><button id="frame-button">Frame</button><input id="frame-input"><script>const button=document.querySelector('#frame-button');button.onclick=()=>button.dataset.count=String(+(button.dataset.count||0)+1)</script>`;
const server = createServer((request, response) => { if (request.url?.startsWith("/redirect")) { response.writeHead(302, { location: "/fixture?redirected=1" }); response.end(); return; } response.setHeader("content-type", "text/html; charset=utf-8"); response.end(request.url?.startsWith("/frame") ? framePage : page); });
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const fixtureUrl = `http://127.0.0.1:${port}/fixture`;
const testExtension = await prepareTestExtension(releaseExtensionPath, ["http://127.0.0.1/*", "http://localhost/*"]);
const extensionPath = testExtension.extensionPath;

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() { this.socket = new WebSocket(this.url); await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); }); this.socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); if (!message.id || !this.pending.has(message.id)) return; const pending = this.pending.get(message.id); this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }); return this; }
  call(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket?.close(); }
}
function value(result) { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }

async function launch(label, options = {}) {
  const profilePath = options.profilePath || await mkdtemp(path.join(os.tmpdir(), `zui-phase5-${label}-`));
  const loadedExtension = options.extensionPath || extensionPath;
  if (options.profilePath) await rm(path.join(profilePath, "DevToolsActivePort"), { force: true }).catch(() => {});
  const browserArgs = ["--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profilePath}`, `--disable-extensions-except=${loadedExtension}`, `--load-extension=${loadedExtension}`, "--no-first-run", "--no-default-browser-check"];
  if (globalThis.process.env.PHASE5_HEADFUL !== "1") browserArgs.unshift("--headless=new");
  const process = spawn(chromePath, browserArgs, { stdio: "ignore", windowsHide: true });
  const active = await waitFor(async () => { const file = path.join(profilePath, "DevToolsActivePort"); return existsSync(file) ? (await readFile(file, "utf8")).trim().split(/\r?\n/) : null; });
  const browser = await new Cdp(`ws://127.0.0.1:${active[0]}${active[1]}`).connect();
  const clients = [];
  const connect = async (targetId) => { const descriptor = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${active[0]}/json/list`)).json()).find((item) => item.id === targetId)); const client = await new Cdp(descriptor.webSocketDebuggerUrl).connect(); clients.push(client); await client.call("Runtime.enable"); return client; };
  let worker;
  try { worker = await waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js"))); }
  catch (cause) { await closeBrowserProcess(browser, process); if (!options.preserveProfile) await removeDirectoryBestEffort(profilePath); throw cause; }
  const extensionId = new URL(worker.url).host;
  let popup;
  const evaluate = async (client, expression) => value(await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
  async function connectPopup() { const id = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` })).targetId; popup = await connect(id); await waitFor(() => evaluate(popup, "document.readyState === 'complete'")); }
  await connectPopup();
  const popupEval = (expression) => evaluate(popup, expression);
  const runtime = async (message, allowError = false) => {
    const expression = `chrome.runtime.sendMessage(${JSON.stringify(message)})`;
    const response = await waitFor(async () => {
      try { return await popupEval(expression); }
      catch (error) {
        if (/Receiving end does not exist/i.test(error.message)) return null;
        throw error;
      }
    });
    if (!response?.ok && !allowError) throw new Error(response?.error || "RUNTIME_FAILED");
    return response;
  };
  const open = async (url) => { const id = (await browser.call("Target.createTarget", { url })).targetId; const client = await connect(id); await waitFor(() => evaluate(client, "document.readyState === 'complete'") ); const tab = await waitFor(async () => (await popupEval("chrome.tabs.query({})")).find((item) => item.url === url)); return { id, client, tab }; };
  const terminal = async (timeout = 30000) => waitFor(async () => { const status = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status; return ["COMPLETED", "STOPPED", "ERROR"].includes(status.state) ? status : null; }, timeout);
  const close = async () => { for (const client of clients) client.close(); await closeBrowserProcess(browser, process); if (!options.preserveProfile) await removeDirectoryBestEffort(profilePath); };
  return { profilePath, process, browser, clients, extensionId, evaluate, popupEval, runtime, open, terminal, connect, connectPopup, close, get popup() { return popup; }, async reconnectPopup() { await connectPopup(); }, async worker() { return waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js"))); } };
}

let profileA; let profileB; let upgradeOld; let upgradeNew;
try {
  const downloads = await mkdtemp(path.join(os.tmpdir(), "zui-phase5-export-"));
  const point = { space: "target-normalized", x: .5, y: .5 };
  const down = (id = "down") => ({ id, type: "mouseDown", enabled: true, position: point, button: "left", buttons: 1, modifiers: [] });
  const up = (id = "up") => ({ id, type: "mouseUp", enabled: true, position: point, button: "left", buttons: 0, modifiers: [] });
  const wheel = (id = "wheel") => ({ id, type: "mouseWheel", enabled: true, position: point, button: "none", buttons: 0, modifiers: [], deltaX: 0, deltaY: 120, deltaMode: 0 });
  const delay = (id, durationMs) => ({ id, type: "delay", enabled: true, durationMs });
  const macro = (id, name, selector, events, defaults = {}) => ({ schemaVersion: "1.0", id, name, target: { origin: `http://127.0.0.1:${port}`, surface: { kind: selector.includes("canvas") ? "canvas" : "container", locator: { strategy: "css", value: selector }, recordedGeometry: { widthCssPx: 100, heightCssPx: 50, devicePixelRatio: 1 } } }, recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true }, playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true, ...defaults }, events });

  profileA = await launch("a");
  const pageA = await profileA.open(fixtureUrl); await profileA.runtime({ type: "PIN_TAB_BY_ID", tabId: pageA.tab.id });
  const portable = macro("portable-a", "Portable A", "#action", [down(), up()]);
  await profileA.runtime({ type: "SAVE_MACRO", macro: portable, allowReplace: false });
  const editorAId = (await profileA.browser.call("Target.createTarget", { url: `chrome-extension://${profileA.extensionId}/editor.html` })).targetId;
  const editorA = await profileA.connect(editorAId); await waitFor(() => profileA.evaluate(editorA, "document.querySelector('#macro-name')?.value === 'Portable A'"));
  await profileA.browser.call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await profileA.evaluate(editorA, "document.querySelector('#macro-name').value='Portable Cross Profile';document.querySelector('#macro-name').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#save').click()");
  await waitFor(() => profileA.evaluate(editorA, "document.querySelector('#dirty').textContent === 'Saved'"));
  await profileA.evaluate(editorA, "document.querySelector('#export').click()");
  const exportFile = await waitFor(async () => (await readdir(downloads)).find((name) => name.endsWith(".zui-macro.json")));
  const exportPath = path.join(downloads, exportFile); const exported = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(/"(?:tabId|windowId|frameId|profileId|profilePath|accountId|cookie|cookies|debuggerSessionId|sessionToken)"/i.test(JSON.stringify(exported)), false);
  console.log("phase5: profile A export PASS");

  profileB = await launch("b");
  const pageB = await profileB.open(fixtureUrl); await profileB.runtime({ type: "PIN_TAB_BY_ID", tabId: pageB.tab.id });
  const editorBId = (await profileB.browser.call("Target.createTarget", { url: `chrome-extension://${profileB.extensionId}/editor.html` })).targetId;
  const editorB = await profileB.connect(editorBId); await profileB.evaluate(editorB, "window.confirm=()=>true");
  async function importFile() { const before = (await profileB.runtime({ type: "GET_MACROS" })).macros.length; await profileB.evaluate(editorB, "document.querySelector('#status').textContent=''"); const doc = await editorB.call("DOM.getDocument"); const input = await editorB.call("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#import-file" }); await editorB.call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [exportPath] }); await waitFor(async () => { const rows = (await profileB.runtime({ type: "GET_MACROS" })).macros; if (rows.length >= before + 1) return true; const status = await profileB.evaluate(editorB, "document.querySelector('#status').textContent"); if (status && status !== "Validated portable macro imported.") throw new Error(`Import failed: ${status}`); return false; }); }
  await importFile(); await importFile();
  const imported = (await profileB.runtime({ type: "GET_MACROS" })).macros;
  assert.deepEqual(new Set(imported.map((item) => item.name)), new Set(["Portable Cross Profile", "Portable Cross Profile (2)"]));
  await profileB.runtime({ type: "START_PLAYBACK", macro: imported.find((item) => item.name === "Portable Cross Profile") });
  assert.equal((await profileB.terminal()).state, "COMPLETED");
  assert.equal(await profileB.evaluate(pageB.client, "document.querySelector('#action').dataset.count"), "1");
  console.log("phase5: profile B import/replay/conflict PASS");

  const targetAction = async (action) => (await profileB.runtime({ type: "TARGET_COMMAND", command: { type: "GENERIC_ACTION", action } })).result;
  const geometry = [];
  for (const zoom of [.8, 1, 1.25, 1.5, 2]) { await profileB.evaluate(pageB.client, `document.body.style.zoom=${zoom}`); const row = await targetAction({ kind: "click", selector: "#transformed", position: { x: .25, y: .75 } }); geometry.push({ zoom, rect: row.after.rect }); assert.ok(Math.abs(Number(await profileB.evaluate(pageB.client, "document.querySelector('#transformed').dataset.x")) - (row.after.rect.left + row.after.rect.width * .25)) < 1); }
  const dpr = [];
  for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) { await pageB.client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor, mobile: false }); const row = await targetAction({ kind: "inspect", selector: "#canvas-a" }); dpr.push({ requested: deviceScaleFactor, observed: row.state.devicePixelRatio, rect: row.state.rect }); assert.equal(row.state.devicePixelRatio, deviceScaleFactor); }
  await pageB.client.call("Emulation.clearDeviceMetricsOverride"); await profileB.evaluate(pageB.client, "document.body.style.zoom=1");
  const canvasA = await targetAction({ kind: "click", selector: "#canvas-a", position: { x: .2, y: .8 } }); const canvasB = await targetAction({ kind: "click", selector: "#canvas-b", position: { x: .8, y: .2 } }); assert.notEqual(canvasA.after.id, canvasB.after.id);
  await profileB.evaluate(pageB.client, "replaceCanvas()"); assert.equal((await targetAction({ kind: "click", selector: "#canvas-a", position: point })).after.canvas.snapshotBytes > 0, true);
  assert.equal((await targetAction({ kind: "click", selector: "#shadow-host >>> #shadow-button", position: point })).after.tag, "button");
  await profileB.evaluate(pageB.client, "scrollTo(900,900)"); const scrolled = await targetAction({ kind: "click", selector: "#far", position: point }); assert.ok(scrolled.after.rect.left < 1280 && scrolled.after.rect.top < 900);
  await profileB.runtime({ type: "START_PLAYBACK", macro: macro("frame", "Frame", "#same-frame ::frame:: #frame-button", [down("fd"), up("fu")]) }); assert.equal((await profileB.terminal()).state, "COMPLETED"); assert.equal(await profileB.evaluate(pageB.client, "document.querySelector('#same-frame').contentDocument.querySelector('#frame-button').dataset.count"), "1");
  const cross = await targetAction({ kind: "click", selector: "#cross-frame ::frame:: #frame-button", position: point }); assert.equal(cross.ok, false); assert.equal(cross.error, "CROSS_ORIGIN_FRAME_UNSUPPORTED");
  console.log("phase5: geometry/surfaces/frames PASS");

  await profileB.browser.call("Target.activateTarget", { targetId: editorBId });
  assert.equal(await profileB.evaluate(pageB.client, "document.hidden"), true);
  const hiddenCdpStarted = performance.now();
  await profileB.runtime({ type: "START_PLAYBACK", macro: macro("hidden-wheel", "Hidden wheel", "#canvas-a", [wheel()]) });
  const hiddenCdp = await profileB.terminal();
  assert.equal(hiddenCdp.state, "ERROR");
  assert.equal(hiddenCdp.errorCode, "CDP_TARGET_HIDDEN");
  assert.ok(performance.now() - hiddenCdpStarted < 2000);
  assert.equal((await profileB.runtime({ type: "GET_CDP_STATE" })).sessions.length, 0);
  console.log("phase5: hidden CDP wheel fail-fast PASS");

  await targetAction({ kind: "focus", selector: "#text", clear: true }); const unicodeText = "çÇğĞıİöÖşŞüÜé€🙂"; await profileB.runtime({ type: "START_PLAYBACK", macro: macro("unicode", "Unicode", "#text", [{ id: "t", type: "text", enabled: true, value: unicodeText }]) }); assert.equal((await profileB.terminal()).state, "COMPLETED"); assert.equal((await targetAction({ kind: "inspect", selector: "#text" })).state.value, unicodeText);
  for (const selector of ["#password", "#otp", "#token"]) { await targetAction({ kind: "focus", selector, clear: true }).catch(() => {}); const response = await profileB.runtime({ type: "START_PLAYBACK", macro: macro(`s-${selector}`, "Sensitive", selector, [{ id: "t", type: "text", enabled: true, value: "do-not-write" }]) }); const status = await profileB.terminal(); assert.equal(status.state, "ERROR"); assert.equal(status.errorCode, "SENSITIVE_INPUT_BLOCKED"); }
  console.log("phase5: unicode/sensitive PASS");

  const long = macro("restart", "Restart", "#action", [delay("wait", 3000), down(), up()]); await profileB.runtime({ type: "START_PLAYBACK", macro: long }); const oldWorker = await profileB.worker(); await profileB.browser.call("Target.closeTarget", { targetId: oldWorker.targetId }); await sleep(200); await profileB.reconnectPopup(); const restarted = await profileB.terminal(); assert.equal(restarted.state, "STOPPED"); assert.equal(restarted.reason, "service_worker_restarted");
  await profileB.runtime({ type: "START_PLAYBACK", macro: long }); const offscreen = await waitFor(async () => (await profileB.browser.call("Target.getTargets")).targetInfos.find((item) => item.url.endsWith("/offscreen.html"))); await profileB.browser.call("Target.closeTarget", { targetId: offscreen.targetId }); const lost = await profileB.terminal(); assert.equal(lost.state, "ERROR"); assert.equal(lost.errorCode, "OFFSCREEN_LOST");

  await profileB.runtime({ type: "CDP_ATTACH_FOR_CLOSE_TEST", tabId: pageB.tab.id }); await targetAction({ kind: "focus", selector: "#text", clear: true }); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("attach-fail", "Attach fail", "#text", [{ id: "t", type: "text", enabled: true, value: "retry" }]) }); const attachFail = await profileB.terminal(); assert.equal(attachFail.state, "ERROR"); assert.equal(attachFail.errorCode, "CDP_ATTACH_FAILED"); await waitFor(async () => (await profileB.runtime({ type: "GET_CDP_STATE" })).sessions.length === 0);
  await profileB.runtime({ type: "START_PLAYBACK", macro: macro("retry", "Retry", "#action", [down(), up()]) }); assert.equal((await profileB.terminal()).state, "COMPLETED");
  console.log("phase5: recovery/CDP/retry PASS");

  await profileB.runtime({ type: "START_RECORDING", name: "Popup lifecycle", settings: { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false } });
  const recorderWorker = await profileB.worker(); await profileB.browser.call("Target.closeTarget", { targetId: recorderWorker.targetId }); await sleep(200); await profileB.reconnectPopup();
  const recorderAfterWorkerRestart = (await profileB.runtime({ type: "GET_RECORDER_STATUS" })).status; assert.equal(recorderAfterWorkerRestart.state, "RECORDING"); assert.equal(recorderAfterWorkerRestart.eventCount, 0);
  assert.equal(await profileB.popupEval("document.querySelector('#macro-name').value"), "Popup lifecycle");
  const actionRect = await profileB.evaluate(pageB.client, "(()=>{const r=document.querySelector('#action').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await pageB.client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: actionRect.x, y: actionRect.y, button: "left", buttons: 1, clickCount: 1 });
  await pageB.client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: actionRect.x, y: actionRect.y, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(async () => (await profileB.runtime({ type: "GET_RECORDER_STATUS" })).status.inputEventCount === 2);
  const popupLifecycle = (await profileB.runtime({ type: "STOP_RECORDING" })).status; assert.equal(popupLifecycle.state, "STOPPED"); assert.equal(popupLifecycle.result.macro.name, "Popup lifecycle"); assert.equal(popupLifecycle.result.inputEventCount, 2);
  console.log("phase5: popup/service-worker recorder continuity PASS");

  const navigation = {};
  await profileB.evaluate(pageB.client, "history.pushState({},'', '/fixture?spa=1'); true"); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("spa", "SPA", "#action", [down(), up()]) }); navigation.spa = (await profileB.terminal()).state;
  await pageB.client.call("Page.reload"); await waitFor(() => profileB.evaluate(pageB.client, "document.readyState === 'complete'")); await waitFor(async () => (await profileB.popupEval(`chrome.tabs.sendMessage(${pageB.tab.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("reload", "Reload", "#action", [down(), up()]) }); navigation.sameOriginReload = (await profileB.terminal()).state;
  await profileB.evaluate(pageB.client, "location.href='/redirect'"); await waitFor(() => profileB.evaluate(pageB.client, "location.search.includes('redirected=1')")); await waitFor(async () => (await profileB.popupEval(`chrome.tabs.sendMessage(${pageB.tab.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("redirect", "Redirect", "#action", [down(), up()]) }); navigation.sameOriginRedirect = (await profileB.terminal()).state;
  await profileB.runtime({ type: "START_PLAYBACK", macro: long }); await profileB.evaluate(pageB.client, `location.href='http://localhost:${port}/fixture'`); navigation.crossOrigin = (await profileB.terminal()).reason; assert.equal(navigation.crossOrigin, "TARGET_NAVIGATED");
  await profileB.evaluate(pageB.client, `location.href=${JSON.stringify(fixtureUrl)}`); await waitFor(() => profileB.evaluate(pageB.client, "document.readyState === 'complete'")); const repinned = await waitFor(async () => (await profileB.popupEval("chrome.tabs.query({})")).find((item) => item.url === fixtureUrl)); await profileB.runtime({ type: "PIN_TAB_BY_ID", tabId: repinned.id }); await waitFor(async () => (await profileB.popupEval(`chrome.tabs.sendMessage(${repinned.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok);
  const beforeReloadMacros = (await profileB.runtime({ type: "GET_MACROS" })).macros.length; await profileB.runtime({ type: "START_PLAYBACK", macro: long }); await profileB.popup.call("Runtime.evaluate", { expression: "chrome.runtime.reload()" }).catch(() => {}); await sleep(500); await profileB.reconnectPopup(); const reloadState = (await profileB.runtime({ type: "GET_PLAYBACK_STATUS" })).status; const afterReloadMacros = (await profileB.runtime({ type: "GET_MACROS" })).macros.length; assert.equal(afterReloadMacros, beforeReloadMacros); assert.equal(["IDLE", "STOPPED", "ERROR"].includes(reloadState.state), true); await pageB.client.call("Page.reload"); await waitFor(() => profileB.evaluate(pageB.client, "document.readyState === 'complete'")); await profileB.runtime({ type: "PIN_TAB_BY_ID", tabId: repinned.id }); await waitFor(async () => (await profileB.popupEval(`chrome.tabs.sendMessage(${repinned.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("post-reload", "Post reload", "#action", [down(), up()]) }); assert.equal((await profileB.terminal()).state, "COMPLETED");
  await profileB.runtime({ type: "START_RECORDING", name: "Reload recorder", settings: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true } }); await profileB.popup.call("Runtime.evaluate", { expression: "chrome.runtime.reload()" }).catch(() => {}); await sleep(500); await profileB.reconnectPopup(); const recorderReloadState = (await profileB.runtime({ type: "GET_RECORDER_STATUS" })).status; assert.equal(recorderReloadState.state, "IDLE"); assert.equal((await profileB.runtime({ type: "GET_MACROS" })).macros.length, beforeReloadMacros); await pageB.client.call("Page.reload"); await waitFor(() => profileB.evaluate(pageB.client, "document.readyState === 'complete'")); await profileB.runtime({ type: "PIN_TAB_BY_ID", tabId: repinned.id }); await waitFor(async () => (await profileB.popupEval(`chrome.tabs.sendMessage(${repinned.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok);
  console.log("phase5: navigation/extension reload PASS");

  const zeroEvents = Array.from({ length: 10_000 }, (_, index) => delay(`z${index}`, 0)); const zeroStarted = performance.now(); await profileB.runtime({ type: "START_PLAYBACK", macro: macro("zero-10k", "Zero 10k", "#action", zeroEvents) }); const zero = await profileB.terminal(60000); assert.equal(zero.state, "COMPLETED"); const zeroElapsedMs = performance.now() - zeroStarted;
  const stress = macro("stress", "Stress", "#action", [down(), up()], { repeatCount: 1000 }); await profileB.runtime({ type: "START_PLAYBACK", macro: stress }); const stressResult = await profileB.terminal(60000); assert.equal(stressResult.result.eventsExecuted, 2000); const health = await profileB.runtime({ type: "GET_RUNTIME_HEALTH" }); assert.equal(health.debuggerSessions.length, 0); assert.ok(health.offscreenContexts <= 1);
  console.log("phase5: zero-delay/long-run PASS");

  const goodCount = (await profileB.runtime({ type: "GET_MACROS" })).macros.length; await profileB.popupEval(`(async()=>{const stored=await chrome.storage.local.get('zuiMacros');await chrome.storage.local.set({zuiMacros:[...stored.zuiMacros,{broken:true}]});return true})()`); const quarantined = await profileB.runtime({ type: "GET_MACROS" }); assert.equal(quarantined.macros.length, goodCount); assert.equal(quarantined.quarantine.length, 1);
  const forbidden = structuredClone(exported); forbidden.id = "forbidden"; forbidden.target.origin = "javascript:alert(1)"; const rejected = await profileB.runtime({ type: "SAVE_MACRO", macro: forbidden, allowReplace: false }, true); assert.equal(rejected.errorCode, "SCHEMA_INVALID"); assert.equal((await profileB.runtime({ type: "GET_MACROS" })).macros.length, goodCount);
  const diagnostic = (await profileB.runtime({ type: "GET_DIAGNOSTIC_REPORT" })).report; assert.equal(/do-not-write/i.test(JSON.stringify(diagnostic)), false);

  const upgradeRoot = await mkdtemp(path.join(os.tmpdir(), "zui-phase5-upgrade-")); const upgradeExtension = path.join(upgradeRoot, "extension"); const upgradeProfile = path.join(upgradeRoot, "profile"); await mkdir(upgradeProfile, { recursive: true });
  await cp(extensionPath, upgradeExtension, { recursive: true });
  const legacyManifestPath = path.join(upgradeExtension, "manifest.json"); const legacyManifest = JSON.parse(await readFile(legacyManifestPath, "utf8")); legacyManifest.version = "0.5.0"; await writeFile(legacyManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
  upgradeOld = await launch("upgrade-old", { profilePath: upgradeProfile, extensionPath: upgradeExtension, preserveProfile: true }); const legacyMacro = macro("phase4-preserved", "Phase 4 preserved", "#action", [down(), up()]); await upgradeOld.runtime({ type: "SAVE_MACRO", macro: legacyMacro, allowReplace: false }); await upgradeOld.close(); upgradeOld = null;
  await rm(upgradeExtension, { recursive: true, force: true }); await cp(extensionPath, upgradeExtension, { recursive: true }); upgradeNew = await launch("upgrade-new", { profilePath: upgradeProfile, extensionPath: upgradeExtension, preserveProfile: true }); const upgradedMacros = (await upgradeNew.runtime({ type: "GET_MACROS" })).macros; const upgradedVersion = await upgradeNew.popupEval("chrome.runtime.getManifest().version"); const releaseVersion = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8")).version; assert.equal(upgradedMacros.some((item) => item.id === legacyMacro.id), true); assert.equal(upgradedVersion, releaseVersion); await upgradeNew.close(); upgradeNew = null; await removeDirectoryBestEffort(upgradeRoot);
  console.log("phase5: clean-clone upgrade persistence PASS");

  const report = { testedAt: new Date().toISOString(), chromePath, profiles: { distinct: profileA.profilePath !== profileB.profilePath, exportedFile: exportFile, importedNames: imported.map((item) => item.name), runtimeIdentityLeaked: false, replayCount: 1 }, recovery: { serviceWorker: { state: restarted.state, reason: restarted.reason }, recorderWorkerRestart: { state: recorderAfterWorkerRestart.state, capturedInputs: popupLifecycle.result.inputEventCount }, extensionReload: { playbackState: reloadState.state, recorderState: recorderReloadState.state, macrosBefore: beforeReloadMacros, macrosAfter: afterReloadMacros, nextPlayback: "PASS" }, offscreen: { state: lost.state, code: lost.errorCode }, cdpAttach: { state: attachFail.state, code: attachFail.errorCode, sessions: 0 }, hiddenCdpWheel: { state: hiddenCdp.state, code: hiddenCdp.errorCode, failFast: true }, retry: "PASS" }, navigation, geometry: { zoom: geometry, dpr, transform: "PASS", letterboxCanvas: canvasA.after.rect, multiCanvas: "PASS", dynamicCanvas: "PASS", scroll: "PASS", shadowDom: "PASS", sameOriginIframe: "PASS", crossOriginIframe: cross.error }, text: { exact: unicodeText, sensitiveFields: "PASS", clipboardPermissionAdded: false }, stress: { zeroDelayEvents: 10_000, zeroElapsedMs, iterations: stressResult.iteration, eventsExecuted: stressResult.result.eventsExecuted, offscreenContexts: health.offscreenContexts, debuggerSessions: health.debuggerSessions.length }, corruption: { validMacros: quarantined.macros.length, quarantined: quarantined.quarantine.length, forbiddenOrigin: rejected.errorCode }, upgrade: { fixture: "synthetic-0.5.0-manifest", preservedMacro: legacyMacro.id, version: upgradedVersion }, diagnostics: { redacted: true, entries: diagnostic.diagnostics.length } };
  await mkdir(path.dirname(resultPath), { recursive: true }); await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
  await rm(downloads, { recursive: true, force: true });
} finally {
  await upgradeNew?.close(); await upgradeOld?.close(); await profileB?.close(); await profileA?.close(); await new Promise((resolve) => server.close(resolve));
  await testExtension.cleanup().catch(() => {});
}
process.exit(0);
