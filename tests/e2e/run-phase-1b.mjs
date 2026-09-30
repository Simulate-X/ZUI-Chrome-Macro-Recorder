import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceExtensionPath = path.join(root, "extension");
const demoPath = path.join(root, "demo");
const resultPath = path.join(root, "test-results", "phase-1b.json");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error("Installed Google Chrome was not found. Set CHROME_PATH.");

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer(async (request, response) => {
  const relative = request.url === "/" ? "index.html" : request.url.slice(1);
  const resolved = path.resolve(demoPath, relative);
  if (!resolved.startsWith(demoPath + path.sep)) return response.writeHead(403).end("Forbidden");
  try {
    const body = await readFile(resolved);
    response.writeHead(200, { "content-type": mime[path.extname(resolved)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const demoUrl = `http://127.0.0.1:${port}/`;
const testExtension = await prepareTestExtension(sourceExtensionPath, ["http://127.0.0.1/*"]);
const extensionPath = testExtension.extensionPath;
const profilePath = await mkdtemp(path.join(os.tmpdir(), "zui-phase-1b-"));
const chrome = spawn(chromePath, [
  "--window-size=1400,1000",
  "--remote-debugging-port=0",
  `--user-data-dir=${profilePath}`,
  "--enable-unsafe-extension-debugging",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: false });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error("Timed out waiting for condition.");
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed.");
  return result.result.value;
}

function percentile(sorted, p) {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(scheduler, state, intervalMs, rows) {
  assert.equal(rows.length, 31, `${scheduler}/${state}/${intervalMs}: expected 31 events`);
  const intervals = rows.slice(1).map((row, index) => row.arrivedAt - rows[index].arrivedAt);
  const sorted = [...intervals].sort((a, b) => a - b);
  const cumulativeDrift = (rows.at(-1).arrivedAt - rows[0].arrivedAt) - intervalMs * intervals.length;
  return {
    scheduler,
    state,
    requestedIntervalMs: intervalMs,
    playbackEvents: rows.length,
    measuredIntervals: intervals.length,
    actualMedianMs: Number(percentile(sorted, 50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 95).toFixed(3)),
    maximumIntervalMs: Number(Math.max(...intervals).toFixed(3)),
    maximumDriftMs: Number(Math.max(...intervals.map((actual) => Math.abs(actual - intervalMs))).toFixed(3)),
    cumulativeDriftMs: Number(cumulativeDrift.toFixed(3)),
    visibilityStates: [...new Set(rows.map((row) => row.visibilityState))]
  };
}

let browser;
let worker;
let page;
let popup;
let demoTargetId;
let popupTargetId;
let focusWindowId;
try {
  const activePort = await waitFor(async () => {
    const file = path.join(profilePath, "DevToolsActivePort");
    if (!existsSync(file)) return null;
    return (await readFile(file, "utf8")).trim().split(/\r?\n/);
  });
  browser = await new Cdp(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`).connect();
  const version = await browser.call("Browser.getVersion");
  assert.match(version.product, /^Chrome\//, `Expected Google Chrome, received ${version.product}`);
  const installed = await browser.call("Extensions.loadUnpacked", { path: extensionPath });
  assert.match(installed.id, /^[a-p]{32}$/, "Unpacked extension ID was not returned");
  const serviceWorkerTarget = await waitFor(async () => {
    const result = await browser.call("Target.getTargets");
    return result.targetInfos.find((item) => item.type === "service_worker" && item.url === `chrome-extension://${installed.id}/service-worker.js`);
  });
  let descriptors = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
  const workerDescriptor = descriptors.find((item) => item.id === serviceWorkerTarget.targetId);
  worker = await new Cdp(workerDescriptor.webSocketDebuggerUrl).connect();
  await worker.call("Runtime.enable");
  popupTargetId = (await browser.call("Target.createTarget", { url: `chrome-extension://${installed.id}/popup.html` })).targetId;
  const popupDescriptor = await waitFor(async () => {
    const rows = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
    return rows.find((item) => item.id === popupTargetId && item.webSocketDebuggerUrl);
  });
  popup = await new Cdp(popupDescriptor.webSocketDebuggerUrl).connect();
  await popup.call("Runtime.enable");
  const runtime = async (message) => value(await popup.call("Runtime.evaluate", {
    expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`, awaitPromise: true, returnByValue: true
  }));
  const createdTab = value(await worker.call("Runtime.evaluate", {
    expression: `chrome.tabs.create({ url: ${JSON.stringify(demoUrl)}, active: true })`,
    awaitPromise: true,
    returnByValue: true
  }));
  const demoTarget = await waitFor(async () => {
    const result = await browser.call("Target.getTargets");
    return result.targetInfos.find((item) => item.type === "page" && item.url === demoUrl);
  });
  demoTargetId = demoTarget.targetId;
  descriptors = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
  const pageDescriptor = descriptors.find((item) => item.id === demoTargetId);
  page = await new Cdp(pageDescriptor.webSocketDebuggerUrl).connect();
  await page.call("Runtime.enable");
  await waitFor(async () => value(await page.call("Runtime.evaluate", { expression: "document.readyState === 'complete'" })));

  const pinned = await runtime({ type: "PIN_TAB_BY_ID", tabId: createdTab.id });
  assert.equal(pinned.ok, true, pinned.error || "Initial target pin failed");

  let setup = value(await worker.call("Runtime.evaluate", {
    expression: `(async () => {
      const tab = await chrome.tabs.get(${createdTab.id});
      if (!tab) throw new Error('DEMO_TAB_NOT_FOUND');
      const surface = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SURFACE' });
      return { tabId: tab.id, windowId: tab.windowId, surface };
    })()`, awaitPromise: true, returnByValue: true
  }));
  assert.equal(setup.surface.ok, true);

  const dispatch = async (expression) => value(await worker.call("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true
  }));
  const pair = async () => dispatch(`(async () => {
    const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
    const down = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_EVENT', event: { type: 'mouseDown', button: 'left', position: { x: 0.25, y: 0.75 } } });
    const up = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_EVENT', event: { type: 'mouseUp', button: 'left', position: { x: 0.25, y: 0.75 } } });
    return { down, up };
  })()`);

  await browser.call("Target.activateTarget", { targetId: demoTargetId });
  const small = await pair();
  await page.call("Runtime.evaluate", { expression: "__zuiDemo.resize(960, 540)" });
  const large = await pair();
  const geometry = value(await page.call("Runtime.evaluate", {
    expression: `(() => {
      const surface = document.querySelector('[data-zui-surface]');
      const rect = surface.getBoundingClientRect();
      const style = getComputedStyle(surface);
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        devicePixelRatio,
        backingStore: { width: surface.width, height: surface.height },
        cssTransform: style.transform,
        border: { left: style.borderLeftWidth, top: style.borderTopWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth },
        padding: { left: style.paddingLeft, top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom },
        objectFit: style.objectFit
      };
    })()`, returnByValue: true
  }));
  assert.equal(small.up.ok, true);
  assert.equal(large.up.ok, true);
  assert.equal(large.up.point.x, 0.25);
  assert.equal(large.up.point.y, 0.75);

  const keyboard = await dispatch(`(async () => {
    const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
    return {
      down: await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_KEY_EVENT', event: { type: 'keyDown', key: 'a', code: 'KeyA', targetSelector: '#keyboard-target' } }),
      up: await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_KEY_EVENT', event: { type: 'keyUp', key: 'a', code: 'KeyA', targetSelector: '#keyboard-target' } })
    };
  })()`);
  assert.equal(keyboard.down.ok, true);
  assert.equal(keyboard.up.ok, true);

  // A page-level DevTools attachment can keep a background page in the visible
  // lifecycle state. Detach before timing so the observer does not change the system.
  page.close();
  page = null;

  await browser.call("Target.closeTarget", { targetId: demoTargetId });
  demoTargetId = null;
  await waitFor(async () => dispatch(`chrome.storage.session.get('pinnedTarget').then((result) => !result.pinnedTarget)`));
  const timingTab = await dispatch(`chrome.tabs.create({ url: ${JSON.stringify(demoUrl)}, active: true })`);
  const timingPinned = await runtime({ type: "PIN_TAB_BY_ID", tabId: timingTab.id });
  assert.equal(timingPinned.ok, true, timingPinned.error || "Timing target pin failed");
  setup = await dispatch(`(async () => {
    const tab = await chrome.tabs.get(${timingTab.id});
    const surface = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SURFACE' });
    return { tabId: tab.id, windowId: tab.windowId, surface };
  })()`);
  const timingTarget = await waitFor(async () => {
    const result = await browser.call("Target.getTargets");
    return result.targetInfos.find((item) => item.type === "page" && item.url === demoUrl);
  });
  demoTargetId = timingTarget.targetId;
  const setFocusState = async (state) => {
    if (state === "foreground") {
      if (focusWindowId) {
        await dispatch(`chrome.windows.remove(${focusWindowId})`).catch(() => {});
        focusWindowId = null;
      }
      await dispatch(`chrome.windows.update(${setup.windowId}, { focused: true })`);
    } else {
      const focusWindow = await dispatch(`chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal' })`);
      focusWindowId = focusWindow.id;
    }
    await delay(1000);
    return dispatch(`chrome.windows.get(${setup.windowId})`);
  };
  const results = [];
  for (const state of ["foreground", "background"]) {
    const targetWindowState = await setFocusState(state);
    assert.equal(targetWindowState.focused, state === "foreground", `${state} target window focus was ${targetWindowState.focused}`);
    const visibilityProbe = await dispatch(`(async () => {
      const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
      return chrome.tabs.sendMessage(target.tabId, { type: 'GET_SURFACE' });
    })()`);
    const visibilityState = visibilityProbe.visibilityState;
    assert.equal(visibilityState, "visible", `${state} tab visibility was ${visibilityState}`);
    for (const intervalMs of [100, 200, 500]) {
      console.error(`phase1b: CONTENT_SCRIPT ${state} ${intervalMs} ms`);
      const response = await dispatch(`(async () => {
        const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
        return chrome.tabs.sendMessage(target.tabId, { type: 'RUN_CONTENT_BENCHMARK', options: { events: 31, intervalMs: ${intervalMs} } });
      })()`);
      assert.equal(response.ok, true);
      results.push(summarize("CONTENT_SCRIPT", state, intervalMs, response.rows));
    }
  }

  const contentBackgroundPassed = results
    .filter((item) => item.scheduler === "CONTENT_SCRIPT" && item.state === "background")
    .every((item) => item.p95Ms <= item.requestedIntervalMs * 1.25 && item.maximumDriftMs <= Math.max(50, item.requestedIntervalMs * 0.5));
  if (!contentBackgroundPassed) {
    for (const state of ["foreground", "background"]) {
      const targetWindowState = await setFocusState(state);
      assert.equal(targetWindowState.focused, state === "foreground", `${state} target window focus was ${targetWindowState.focused}`);
      const visibilityProbe = await dispatch(`(async () => {
        const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
        return chrome.tabs.sendMessage(target.tabId, { type: 'GET_SURFACE' });
      })()`);
      const visibilityState = visibilityProbe.visibilityState;
      assert.equal(visibilityState, "visible", `${state} tab visibility was ${visibilityState}`);
      for (const intervalMs of [100, 200, 500]) {
        console.error(`phase1b: OFFSCREEN_DOCUMENT ${state} ${intervalMs} ms`);
        const response = await dispatch(`chrome.runtime.sendMessage({ type: 'RUN_OFFSCREEN_BENCHMARK', options: { events: 31, intervalMs: ${intervalMs} } })`);
        assert.equal(response.ok, true);
        assert.equal(response.result.ok, true);
        results.push(summarize("OFFSCREEN_DOCUMENT", state, intervalMs, response.result.rows));
      }
    }
  }

  await browser.call("Target.closeTarget", { targetId: demoTargetId });
  demoTargetId = null;
  const targetClosedFailSafe = await waitFor(async () => value(await worker.call("Runtime.evaluate", {
    expression: "chrome.storage.session.get('pinnedTarget').then((result) => !result.pinnedTarget)", awaitPromise: true, returnByValue: true
  })));

  const report = {
    testedAt: new Date().toISOString(),
    chromePath,
    browserProduct: version.product,
    userAgent: version.userAgent,
    headless: false,
    isolatedTemporaryProfile: true,
    backgroundMode: "unfocused target Chrome window while a separate normal Chrome window is foreground; chrome.windows focused=false asserted",
    extensionServiceWorker: true,
    extensionId: installed.id,
    contentScript: true,
    pinnedTargetTab: true,
    targetClosedFailSafe,
    backend: "DOM_SYNTHETIC",
    keyboard: { keyDown: keyboard.down.ok, keyUp: keyboard.up.ok, isTrusted: false },
    resize: {
      initial: small.up.rect,
      resized: large.up.rect,
      normalizedPoint: { x: large.up.point.x, y: large.up.point.y }
    },
    geometry,
    acceptanceThreshold: "p95 <= requested * 1.25 and maximum drift <= max(50 ms, requested * 0.5)",
    contentBackgroundPassed,
    results
  };
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (demoTargetId && browser) await browser.call("Target.closeTarget", { targetId: demoTargetId }).catch(() => {});
  if (popupTargetId && browser) await browser.call("Target.closeTarget", { targetId: popupTargetId }).catch(() => {});
  if (focusWindowId && worker) {
    await worker.call("Runtime.evaluate", { expression: `chrome.windows.remove(${focusWindowId})`, awaitPromise: true }).catch(() => {});
  }
  page?.close();
  popup?.close();
  worker?.close();
  browser?.close();
  chrome.kill();
  server.close();
  await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), delay(3000)]);
  await rm(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  await testExtension.cleanup().catch(() => {});
}
