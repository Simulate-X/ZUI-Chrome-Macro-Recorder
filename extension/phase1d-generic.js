"use strict";

const TARGETS = {
  dynamic: "https://www.selenium.dev/selenium/web/dynamic.html",
  form: "https://www.selenium.dev/selenium/web/web-form.html",
  canvas: "https://szimek.github.io/signature_pad/",
  framework: "https://mui.com/material-ui/react-accordion/"
};
const RESULT_URL = "http://127.0.0.1:4174/__phase1d_generic_result";
const runButton = document.querySelector("#run");
const cdpButton = document.querySelector("#run-cdp");
const status = document.querySelector("#status");
const output = document.querySelector("#result");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: "GENERIC_ACTION", action: { kind: "inspect", selector: "body" } });
        if (response?.ok) return tab;
      } catch (_) {
        // Content script may still be starting.
      }
    }
    await delay(100);
  }
  throw new Error("TARGET_TAB_NOT_READY");
}

async function openTarget(url, width = 1200, height = 850) {
  const window = await chrome.windows.create({ url, focused: true, type: "normal", width, height });
  const tab = window.tabs?.[0];
  if (!window.id || !tab?.id) throw new Error("TARGET_WINDOW_NOT_CREATED");
  await waitForTab(tab.id);
  return { windowId: window.id, tabId: tab.id };
}

async function action(tabId, value) {
  const response = await chrome.tabs.sendMessage(tabId, { type: "GENERIC_ACTION", action: value });
  if (!response?.ok) throw new Error(response?.error || "GENERIC_ACTION_FAILED");
  return response;
}

async function runtime(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "RUNTIME_MESSAGE_FAILED");
  return response.result ?? response;
}

async function uploadReport(report) {
  const response = await fetch(RESULT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report)
  });
  if (!response.ok) throw new Error(`RESULT_SAVE_HTTP_${response.status}`);
}

async function closeTarget(target) {
  if (target?.windowId) await chrome.windows.remove(target.windowId).catch(() => {});
}

async function runStandard() {
  const dynamic = await openTarget(TARGETS.dynamic);
  const form = await openTarget(TARGETS.form);
  try {
    const buttonDispatch = await action(dynamic.tabId, { kind: "click", selector: "#reveal", position: { x: 0.5, y: 0.5 } });
    await delay(2500);
    const buttonObserved = await action(dynamic.tabId, { kind: "inspect", selector: "#revealed" });
    const checkbox = [];
    for (let index = 0; index < 3; index += 1) checkbox.push(await action(form.tabId, { kind: "click", selector: "#my-check-2", position: { x: 0.5, y: 0.5 } }));
    const text = await action(form.tabId, { kind: "keyboard", selector: "#my-text-id", key: "a", code: "KeyA", clear: true });
    const select = await action(form.tabId, { kind: "keyboard", selector: "select.form-select", key: "ArrowDown", code: "ArrowDown" });
    const wheel = await action(form.tabId, { kind: "wheel", selector: "body", deltaY: 240, position: { x: 0.5, y: 0.8 } });
    return { urls: [TARGETS.dynamic, TARGETS.form], button: { dispatch: buttonDispatch, observed: buttonObserved }, checkbox, text, select, wheel };
  } finally {
    await closeTarget(dynamic);
    await closeTarget(form);
  }
}

async function runCanvas() {
  const target = await openTarget(TARGETS.canvas, 1200, 850);
  try {
    const initial = await action(target.tabId, { kind: "inspect", selector: "canvas" });
    const strokes = [];
    for (let index = 0; index < 3; index += 1) {
      const y = 0.35 + index * 0.12;
      strokes.push(await action(target.tabId, { kind: "stroke", selector: "canvas", points: [{ x: 0.25, y }, { x: 0.4, y: y + 0.03 }, { x: 0.6, y: y - 0.02 }, { x: 0.75, y }] }));
    }
    await chrome.windows.update(target.windowId, { width: 900, height: 720 });
    await delay(750);
    const resized = await action(target.tabId, { kind: "inspect", selector: "canvas" });
    const resizeStroke = await action(target.tabId, { kind: "stroke", selector: "canvas", points: [{ x: 0.25, y: 0.8 }, { x: 0.5, y: 0.78 }, { x: 0.75, y: 0.8 }] });
    return { url: TARGETS.canvas, initial, strokes, resized, resizeStroke };
  } finally {
    await closeTarget(target);
  }
}

async function runFrameworkAndHidden() {
  const runner = await chrome.tabs.getCurrent();
  const target = await openTarget(TARGETS.framework, 1250, 900);
  try {
    const visible = [];
    for (let index = 0; index < 3; index += 1) visible.push(await action(target.tabId, { kind: "click", selector: "#panel1d-header", position: { x: 0.5, y: 0.5 } }));
    const wheel = await action(target.tabId, { kind: "wheel", selector: "body", deltaY: 240, position: { x: 0.5, y: 0.8 } });
    await runtime({ type: "PIN_TAB_BY_ID", tabId: target.tabId });
    await chrome.tabs.create({ windowId: target.windowId, url: chrome.runtime.getURL("phase1c-idle.html"), active: true });
    if (runner?.windowId) await chrome.windows.update(runner.windowId, { focused: true });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const proof = await action(target.tabId, { kind: "inspect", selector: "#panel1d-header" });
      if (proof.visibilityState === "hidden" && proof.hidden === true) break;
      await delay(50);
    }
    const hidden = await runtime({ type: "RUN_OFFSCREEN_GENERIC", options: { events: 3, intervalMs: 100, action: { kind: "click", selector: "#panel1d-header", position: { x: 0.5, y: 0.5 } } } });
    return { url: TARGETS.framework, visible, wheel, hidden };
  } finally {
    await closeTarget(target);
  }
}

async function runMatrix() {
  status.textContent = "Standard DOM…";
  const standard = await runStandard();
  status.textContent = "Canvas…";
  const canvas = await runCanvas();
  status.textContent = "React framework + hidden-tab…";
  const framework = await runFrameworkAndHidden();
  return {
    testedAt: new Date().toISOString(),
    browserUserAgent: navigator.userAgent,
    dailyProfile: true,
    headless: false,
    extension: { id: chrome.runtime.id, version: chrome.runtime.getManifest().version },
    scheduler: "OFFSCREEN_DOCUMENT",
    backend: "DOM_SYNTHETIC",
    standard,
    canvas,
    framework
  };
}

async function runCdpTextAndNavigation() {
  const target = await openTarget(TARGETS.form);
  try {
    await runtime({ type: "PIN_TAB_BY_ID", tabId: target.tabId });
    await action(target.tabId, { kind: "focus", selector: "#my-text-id", clear: true });
    const textRows = [];
    for (const [key, code, virtualKeyCode] of [["a", "KeyA", 65], ["b", "KeyB", 66], ["c", "KeyC", 67]]) {
      const dispatch = await runtime({ type: "DISPATCH_INPUT", backend: "CDP_INPUT", action: { kind: "keyboard", key, code, text: key, virtualKeyCode } });
      const observed = await action(target.tabId, { kind: "inspect", selector: "#my-text-id" });
      textRows.push({ dispatch, observed });
    }
    await action(target.tabId, { kind: "focus", selector: "select.form-select" });
    const navigationRows = [];
    for (let index = 0; index < 3; index += 1) {
      const dispatch = await runtime({ type: "DISPATCH_INPUT", backend: "CDP_INPUT", action: { kind: "keyboard", key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 } });
      const observed = await action(target.tabId, { kind: "inspect", selector: "select.form-select" });
      navigationRows.push({ dispatch, observed });
    }
    return { url: TARGETS.form, textRows, navigationRows };
  } finally {
    await closeTarget(target);
  }
}

async function runCdpWheel() {
  const target = await openTarget(TARGETS.framework, 1250, 900);
  try {
    await runtime({ type: "PIN_TAB_BY_ID", tabId: target.tabId });
    const rows = [];
    for (let index = 0; index < 3; index += 1) {
      const before = await action(target.tabId, { kind: "inspect", selector: "body" });
      const dispatch = await runtime({ type: "DISPATCH_INPUT", backend: "CDP_INPUT", action: { kind: "wheel", selector: "#mui-product-selector", position: { x: 0.5, y: 0.5 }, deltaY: 300 } });
      await delay(150);
      const after = await action(target.tabId, { kind: "inspect", selector: "body" });
      rows.push({ before, dispatch, after });
    }
    return { url: TARGETS.framework, rows };
  } finally {
    await closeTarget(target);
  }
}

async function runCdpCloseFailSafe() {
  const target = await openTarget(TARGETS.form);
  await runtime({ type: "PIN_TAB_BY_ID", tabId: target.tabId });
  await runtime({ type: "CDP_ATTACH_FOR_CLOSE_TEST", tabId: target.tabId });
  await closeTarget(target);
  await delay(250);
  const cdpState = await runtime({ type: "GET_CDP_STATE" });
  const pinned = await runtime({ type: "GET_TARGET" });
  return { closedTabId: target.tabId, cdpState, pinnedTarget: pinned.target || null };
}

async function runCdpMatrix() {
  status.textContent = "CDP text + navigation…";
  const textAndNavigation = await runCdpTextAndNavigation();
  status.textContent = "CDP wheel…";
  const wheel = await runCdpWheel();
  status.textContent = "CDP target-close fail-safe…";
  const closeFailSafe = await runCdpCloseFailSafe();
  return {
    testedAt: new Date().toISOString(),
    browserUserAgent: navigator.userAgent,
    dailyProfile: true,
    headless: false,
    extension: { id: chrome.runtime.id, version: chrome.runtime.getManifest().version },
    scheduler: "OFFSCREEN_DOCUMENT",
    backend: "CDP_INPUT",
    textAndNavigation,
    wheel,
    closeFailSafe
  };
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  status.dataset.state = "running";
  try {
    const report = await runMatrix();
    await chrome.storage.local.set({ phase1dGenericLastResult: report });
    output.textContent = JSON.stringify(report, null, 2);
    status.dataset.state = "complete";
    try {
      await uploadReport(report);
      status.textContent = "Complete — DOM synthetic matrix saved locally and exported.";
    } catch (_) {
      status.textContent = "Complete — DOM synthetic matrix saved locally; result receiver unavailable.";
    }
  } catch (error) {
    const failure = { testedAt: new Date().toISOString(), error: error?.message || String(error), stack: error?.stack || null };
    output.textContent = JSON.stringify(failure, null, 2);
    status.dataset.state = "failed";
    status.textContent = `Failed: ${failure.error}`;
  } finally {
    runButton.disabled = false;
  }
});

chrome.storage.local.get("phase1dGenericLastResult").then(async ({ phase1dGenericLastResult }) => {
  if (!phase1dGenericLastResult) return;
  output.textContent = JSON.stringify(phase1dGenericLastResult, null, 2);
  status.dataset.state = "complete";
  try {
    await uploadReport(phase1dGenericLastResult);
    status.textContent = "Complete — saved result restored and exported.";
  } catch (_) {
    status.textContent = "Complete — saved result restored; result receiver unavailable.";
  }
});

cdpButton.addEventListener("click", async () => {
  cdpButton.disabled = true;
  status.dataset.state = "running";
  try {
    const report = await runCdpMatrix();
    await chrome.storage.local.set({ phase1dGenericCdpLastResult: report });
    output.textContent = JSON.stringify(report, null, 2);
    status.dataset.state = "complete";
    try {
      await uploadReport({ kind: "CDP_FALLBACK", ...report });
      status.textContent = "Complete — CDP fallback matrix saved locally and exported.";
    } catch (_) {
      status.textContent = "Complete — CDP fallback matrix saved locally; result receiver unavailable.";
    }
  } catch (error) {
    const failure = { testedAt: new Date().toISOString(), error: error?.message || String(error), stack: error?.stack || null };
    output.textContent = JSON.stringify(failure, null, 2);
    status.dataset.state = "failed";
    status.textContent = `Failed: ${failure.error}`;
  } finally {
    cdpButton.disabled = false;
  }
});
