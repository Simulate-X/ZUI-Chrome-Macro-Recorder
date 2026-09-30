import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let cause;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      cause = error;
    }
    await sleep(25);
  }
  throw cause || new Error("Timed out");
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

  close() {
    this.socket?.close();
  }
}

function value(result) {
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

export function findChromium() {
  return [
    process.env.PHASE6B_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean).find(existsSync);
}

export async function launchPhase6B(extensionPath, label = "daily") {
  const browserPath = findChromium();
  if (!browserPath) throw new Error("Chromium executable not found");
  const profilePath = await mkdtemp(path.join(os.tmpdir(), `zui-phase6b-${label}-`));
  const args = [
    "--headless=new",
    "--window-size=1280,900",
    "--remote-debugging-port=0",
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];
  const child = spawn(browserPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const active = await waitFor(async () => {
    const file = path.join(profilePath, "DevToolsActivePort");
    return existsSync(file) ? (await readFile(file, "utf8")).trim().split(/\r?\n/) : null;
  });
  const browser = await new Cdp(`ws://127.0.0.1:${active[0]}${active[1]}`).connect();
  const clients = [];
  const evaluate = async (client, expression) => value(await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
  const connect = async (targetId) => {
    const descriptor = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${active[0]}/json/list`)).json()).find((item) => item.id === targetId));
    const client = await new Cdp(descriptor.webSocketDebuggerUrl).connect();
    clients.push(client);
    await client.call("Runtime.enable");
    await client.call("Page.enable").catch(() => {});
    return client;
  };
  const worker = await waitFor(async () => (await browser.call("Target.getTargets")).targetInfos.find((item) => item.type === "service_worker" && item.url.endsWith("/service-worker.js")));
  const extensionId = new URL(worker.url).host;
  let popup;
  let popupTargetId;

  async function openPopup() {
    popupTargetId = (await browser.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` })).targetId;
    popup = await connect(popupTargetId);
    await waitFor(() => evaluate(popup, "document.readyState === 'complete'"));
  }

  await openPopup();
  const popupEval = (expression) => evaluate(popup, expression);
  const runtime = async (message, allowError = false) => {
    const response = await waitFor(async () => {
      try {
        return await popupEval(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
      } catch (error) {
        if (/Receiving end does not exist/i.test(error.message)) return null;
        throw error;
      }
    });
    if (!response?.ok && !allowError) throw new Error(response?.error || "RUNTIME_FAILED");
    return response;
  };
  const open = async (url) => {
    const id = (await browser.call("Target.createTarget", { url })).targetId;
    const client = await connect(id);
    await waitFor(() => evaluate(client, "document.readyState === 'complete'"));
    const tab = await waitFor(async () => (await popupEval("chrome.tabs.query({})")).find((item) => item.url === url));
    return { id, client, tab, url };
  };
  const terminal = async (timeout = 30_000) => waitFor(async () => {
    const status = (await runtime({ type: "GET_PLAYBACK_STATUS" })).status;
    return ["COMPLETED", "STOPPED", "ERROR"].includes(status.state) ? status : null;
  }, timeout);
  const reopenPopup = async () => {
    if (popupTargetId) await browser.call("Target.closeTarget", { targetId: popupTargetId }).catch(() => {});
    await openPopup();
  };
  const close = async () => {
    for (const client of clients) client.close();
    browser.close();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
    await Promise.race([exited, sleep(3000)]);
    await rm(profilePath, { recursive: true, force: true }).catch(() => {});
  };

  return { browserPath, profilePath, browser, extensionId, evaluate, connect, popupEval, runtime, open, terminal, reopenPopup, close, get popup() { return popup; } };
}
