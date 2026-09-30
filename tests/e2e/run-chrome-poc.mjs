import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceExtensionPath = path.join(root, "extension");
const demoPath = path.join(root, "demo");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error("Chrome executable not found. Set CHROME_PATH.");

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer(async (request, response) => {
  const relative = request.url === "/" ? "index.html" : request.url.slice(1);
  const resolved = path.resolve(demoPath, relative);
  if (!resolved.startsWith(demoPath + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
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
const testExtension = await prepareTestExtension(sourceExtensionPath, ["http://127.0.0.1/*"]);
const extensionPath = testExtension.extensionPath;
const profilePath = await mkdtemp(path.join(os.tmpdir(), "zui-macro-poc-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--window-size=1400,1000",
  "--remote-debugging-port=0",
  `--user-data-dir=${profilePath}`,
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error("Timed out waiting for condition.");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  return result.result.value;
}

let browser;
let worker;
let page;
let popup;
let blankTargetId;
let popupTargetId;
try {
  const activePort = await waitFor(async () => {
    const file = path.join(profilePath, "DevToolsActivePort");
    if (!existsSync(file)) return null;
    return (await readFile(file, "utf8")).trim().split(/\r?\n/);
  });
  browser = await new Cdp(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`).connect();
  const demoUrl = `http://127.0.0.1:${port}/`;
  const created = await browser.call("Target.createTarget", { url: demoUrl });
  const targets = await waitFor(async () => {
    const result = await browser.call("Target.getTargets");
    const demo = result.targetInfos.find((item) => item.type === "page" && item.url === demoUrl);
    const serviceWorker = result.targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js"));
    return demo && serviceWorker ? { demo, serviceWorker } : null;
  });
  const pages = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
  const pageDescriptor = pages.find((item) => item.id === targets.demo.targetId);
  const workerDescriptor = pages.find((item) => item.id === targets.serviceWorker.targetId);
  assert.ok(pageDescriptor?.webSocketDebuggerUrl, "Demo CDP endpoint missing");
  assert.ok(workerDescriptor?.webSocketDebuggerUrl, "Extension worker CDP endpoint missing");
  page = await new Cdp(pageDescriptor.webSocketDebuggerUrl).connect();
  worker = await new Cdp(workerDescriptor.webSocketDebuggerUrl).connect();
  const extensionId = new URL(targets.serviceWorker.url).host;
  popupTargetId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` })).targetId;
  const popupDescriptor = await waitFor(async () => {
    const rows = await (await fetch(`http://127.0.0.1:${activePort[0]}/json/list`)).json();
    return rows.find((item) => item.id === popupTargetId && item.webSocketDebuggerUrl);
  });
  popup = await new Cdp(popupDescriptor.webSocketDebuggerUrl).connect();
  await page.call("Runtime.enable");
  await worker.call("Runtime.enable");
  await popup.call("Runtime.enable");
  await waitFor(async () => value(await page.call("Runtime.evaluate", { expression: "document.readyState === 'complete'" })));

  const pinned = value(await popup.call("Runtime.evaluate", {
    expression: `(async () => {
      const tab = (await chrome.tabs.query({})).find((item) => item.url === ${JSON.stringify(demoUrl)});
      if (!tab) throw new Error('DEMO_TAB_NOT_FOUND');
      const response = await chrome.runtime.sendMessage({ type: 'PIN_TAB_BY_ID', tabId: tab.id });
      if (!response?.ok) throw new Error(response?.error || 'PIN_FAILED');
      return response;
    })()`, awaitPromise: true, returnByValue: true
  }));
  assert.equal(pinned.ok, true);

  const setup = value(await worker.call("Runtime.evaluate", {
    expression: `(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === ${JSON.stringify(demoUrl)});
      if (!tab) throw new Error('DEMO_TAB_NOT_FOUND');
      const surface = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SURFACE' });
      return { tabId: tab.id, surface };
    })()`,
    awaitPromise: true,
    returnByValue: true
  }));
  assert.equal(setup.surface.ok, true);
  assert.equal(setup.surface.rect.width, 640, `Unexpected initial surface geometry: ${JSON.stringify(setup.surface)}`);
  assert.equal(setup.surface.rect.height, 360, `Unexpected initial surface geometry: ${JSON.stringify(setup.surface)}`);

  async function dispatchPair() {
    return value(await worker.call("Runtime.evaluate", {
      expression: `(async () => {
        const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
        const down = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_EVENT', event: { type: 'mouseDown', button: 'left', position: { x: 0.25, y: 0.75 } } });
        const up = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_EVENT', event: { type: 'mouseUp', button: 'left', position: { x: 0.25, y: 0.75 } } });
        return { down, up };
      })()`,
      awaitPromise: true,
      returnByValue: true
    }));
  }

  const small = await dispatchPair();
  assert.equal(small.up.ok, true);
  assert.equal(small.up.rect.width, 640);
  assert.equal(small.up.point.x, 0.25);
  assert.equal(small.up.point.y, 0.75);
  await page.call("Runtime.evaluate", { expression: "__zuiDemo.resize(960, 540)" });
  const large = await dispatchPair();
  assert.equal(large.up.rect.width, 960);
  assert.equal(large.up.rect.height, 540);
  assert.equal(large.up.point.x, 0.25);
  assert.equal(large.up.point.y, 0.75);

  const observed = value(await page.call("Runtime.evaluate", {
    expression: "({ evidence: __zuiDemo.evidence, last: JSON.parse(document.querySelector('#demo-surface').dataset.lastEvent) })",
    returnByValue: true
  }));
  assert.ok(observed.evidence.length >= 10);
  assert.ok(Math.abs(observed.last.xNormalized - 0.25) <= 0.002, `x drift too large: ${observed.last.xNormalized}`);
  assert.ok(Math.abs(observed.last.yNormalized - 0.75) <= 0.002, `y drift too large: ${observed.last.yNormalized}`);
  assert.equal(observed.last.isTrusted, false);

  const keyboard = value(await worker.call("Runtime.evaluate", {
    expression: `(async () => {
      const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
      const down = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_KEY_EVENT', event: { type: 'keyDown', key: 'a', code: 'KeyA', targetSelector: '#keyboard-target' } });
      const up = await chrome.tabs.sendMessage(target.tabId, { type: 'DISPATCH_KEY_EVENT', event: { type: 'keyUp', key: 'a', code: 'KeyA', targetSelector: '#keyboard-target' } });
      return { down, up };
    })()`,
    awaitPromise: true,
    returnByValue: true
  }));
  assert.equal(keyboard.down.ok, true);
  assert.equal(keyboard.up.ok, true);
  const keyboardEvidence = value(await page.call("Runtime.evaluate", {
    expression: "__zuiDemo.evidence.filter((item) => item.type === 'keydown' || item.type === 'keyup')",
    returnByValue: true
  }));
  assert.deepEqual(keyboardEvidence.map((item) => item.type), ["keydown", "keyup"]);
  assert.ok(keyboardEvidence.every((item) => item.isTrusted === false));

  const timerPromise = worker.call("Runtime.evaluate", {
    expression: `(async () => {
      const target = (await chrome.storage.session.get('pinnedTarget')).pinnedTarget;
      return chrome.tabs.sendMessage(target.tabId, { type: 'MEASURE_TIMERS', options: { samples: 12, intervalMs: 100 } });
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  await delay(150);
  const blank = await browser.call("Target.createTarget", { url: "about:blank" });
  blankTargetId = blank.targetId;
  const timers = value(await timerPromise);
  assert.equal(timers.ok, true);
  assert.equal(timers.rows.length, 12);
  assert.ok(timers.hiddenSamples > 0, "Background-tab measurement did not observe a hidden sample.");

  await browser.call("Target.closeTarget", { targetId: created.targetId });
  const targetCleared = await waitFor(async () => value(await worker.call("Runtime.evaluate", {
    expression: "chrome.storage.session.get('pinnedTarget').then((result) => !result.pinnedTarget)",
    awaitPromise: true,
    returnByValue: true
  })));
  assert.equal(targetCleared, true);

  const report = {
    chromePath,
    backend: "DOM_SYNTHETIC",
    surface: { initial: small.up.rect, resized: large.up.rect },
    normalizedPoint: { x: observed.last.xNormalized, y: observed.last.yNormalized },
    pageAcceptedEvents: observed.evidence.length,
    keyboardEventsAccepted: keyboardEvidence.length,
    syntheticIsTrusted: observed.last.isTrusted,
    targetClosedFailSafe: targetCleared,
    timerMeasurement: { hiddenSamples: timers.hiddenSamples, maxDriftMs: Number(timers.maxDriftMs.toFixed(3)) }
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (blankTargetId && browser) await browser.call("Target.closeTarget", { targetId: blankTargetId }).catch(() => {});
  if (popupTargetId && browser) await browser.call("Target.closeTarget", { targetId: popupTargetId }).catch(() => {});
  page?.close();
  popup?.close();
  worker?.close();
  browser?.close();
  chrome.kill();
  server.close();
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(3000)
  ]);
  await rm(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error) => {
    console.warn(`Temporary Chrome profile cleanup deferred: ${error.code}`);
  });
  await testExtension.cleanup().catch(() => {});
}
