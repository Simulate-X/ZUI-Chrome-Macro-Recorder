"use strict";

const DEMO_URL = "http://127.0.0.1:4173/";
const RESULT_URL = "http://127.0.0.1:4173/__phase1c_result";
const INTERVALS = [100, 200, 500];
const EVENTS = 31;
const runButton = document.querySelector("#run");
const status = document.querySelector("#status");
const output = document.querySelector("#result");
let benchmarkTargetTabId = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryTabEdit(operation) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!String(error?.message || error).includes("Tabs cannot be edited right now")) throw error;
      await delay(250);
    }
  }
  throw lastError;
}

function percentile(sorted, p) {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(scheduler, state, intervalMs, rows) {
  if (rows.length !== EVENTS) throw new Error(`${scheduler}/${state}/${intervalMs}: EXPECTED_${EVENTS}_EVENTS_GOT_${rows.length}`);
  const intervals = rows.slice(1).map((row, index) => row.arrivedAt - rows[index].arrivedAt);
  const sorted = [...intervals].sort((a, b) => a - b);
  const cumulativeDrift = rows.at(-1).arrivedAt - rows[0].arrivedAt - intervalMs * intervals.length;
  const visibilityStates = [...new Set(rows.map((row) => row.visibilityState))];
  const hiddenValues = [...new Set(rows.map((row) => row.hidden))];
  const result = {
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
    visibilityStates,
    hiddenValues
  };
  result.passed = visibilityStates.every((value) => value === (state === "foreground" ? "visible" : "hidden"))
    && hiddenValues.every((value) => value === (state === "hidden"))
    && result.p95Ms <= intervalMs * 1.25
    && result.maximumDriftMs <= Math.max(50, intervalMs * 0.5);
  return result;
}

async function runtimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "RUNTIME_MESSAGE_FAILED");
  return response.result ?? response;
}

async function targetCommand(command) {
  if (benchmarkTargetTabId !== null) {
    const response = await chrome.tabs.sendMessage(benchmarkTargetTabId, command);
    if (!response?.ok) throw new Error(response?.error || "TARGET_COMMAND_FAILED");
    return response;
  }
  const response = await runtimeMessage({ type: "TARGET_COMMAND", command });
  if (!response?.ok) throw new Error(response?.error || "TARGET_COMMAND_FAILED");
  return response;
}

async function waitForSurface(expectedState) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const surface = await targetCommand({ type: "GET_SURFACE" });
      if (surface.visibilityState === expectedState && surface.hidden === (expectedState === "hidden")) return surface;
      lastError = new Error(`EXPECTED_${expectedState.toUpperCase()}_GOT_${surface.visibilityState.toUpperCase()}_HIDDEN_${surface.hidden}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error("TARGET_SURFACE_NOT_READY");
}

async function activateAndWait(tabId, expectedState) {
  await retryTabEdit(() => chrome.tabs.update(tabId, { active: true }));
  return waitForSurface(expectedState);
}

async function runBenchmark() {
  const runnerTab = await chrome.tabs.getCurrent();
  if (!runnerTab?.id || !runnerTab.windowId) throw new Error("RUNNER_TAB_NOT_FOUND");
  const targetWindow = await retryTabEdit(() => chrome.windows.create({ url: DEMO_URL, focused: true, type: "normal" }));
  const targetTab = targetWindow.tabs?.[0];
  if (!targetWindow.id || !targetTab?.id) throw new Error("TARGET_WINDOW_NOT_FOUND");
  const results = [];
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await chrome.tabs.get(targetTab.id);
      if (current.status === "complete") break;
      await delay(100);
    }
    const loadedTarget = await chrome.tabs.get(targetTab.id);
    await chrome.storage.session.set({ pinnedTarget: {
      tabId: loadedTarget.id,
      windowId: loadedTarget.windowId,
      url: loadedTarget.url,
      title: loadedTarget.title || ""
    } });
    benchmarkTargetTabId = loadedTarget.id;
    const foregroundSurface = await waitForSurface("visible");
    for (const intervalMs of INTERVALS) {
      status.textContent = `CONTENT_SCRIPT foreground ${intervalMs} ms…`;
      await waitForSurface("visible");
      const response = await targetCommand({ type: "RUN_CONTENT_BENCHMARK", options: { events: EVENTS, intervalMs } });
      results.push(summarize("CONTENT_SCRIPT", "foreground", intervalMs, response.rows));
    }

    await retryTabEdit(() => chrome.tabs.create({ windowId: targetWindow.id, url: chrome.runtime.getURL("phase1c-idle.html"), active: true }));
    await retryTabEdit(() => chrome.windows.update(runnerTab.windowId, { focused: true }));
    const hiddenSurface = await waitForSurface("hidden");
    for (const intervalMs of INTERVALS) {
      status.textContent = `OFFSCREEN_DOCUMENT hidden ${intervalMs} ms…`;
      await waitForSurface("hidden");
      const response = await runtimeMessage({ type: "RUN_OFFSCREEN_BENCHMARK", options: { events: EVENTS, intervalMs } });
      if (!response?.ok) throw new Error(response?.error || "OFFSCREEN_BENCHMARK_FAILED");
      results.push(summarize("OFFSCREEN_DOCUMENT", "hidden", intervalMs, response.rows));
    }
    for (const intervalMs of INTERVALS) {
      status.textContent = `CONTENT_SCRIPT hidden ${intervalMs} ms…`;
      await waitForSurface("hidden");
      const response = await targetCommand({ type: "RUN_CONTENT_BENCHMARK", options: { events: EVENTS, intervalMs } });
      results.push(summarize("CONTENT_SCRIPT", "hidden", intervalMs, response.rows));
    }

    const contentHiddenPassed = results.filter((item) => item.scheduler === "CONTENT_SCRIPT" && item.state === "hidden").every((item) => item.passed);
    const offscreenHiddenPassed = results.filter((item) => item.scheduler === "OFFSCREEN_DOCUMENT" && item.state === "hidden").every((item) => item.passed);
    const lifecycleMatches = (item) => item.visibilityStates.length === 1
      && item.visibilityStates[0] === (item.state === "foreground" ? "visible" : "hidden")
      && item.hiddenValues.length === 1
      && item.hiddenValues[0] === (item.state === "hidden");
    const lifecycleValid = results.every(lifecycleMatches);
    const foregroundLifecycleValid = results.filter((item) => item.state === "foreground").every(lifecycleMatches);
    const contentHiddenLifecycleValid = results.filter((item) => item.scheduler === "CONTENT_SCRIPT" && item.state === "hidden").every(lifecycleMatches);
    const offscreenHiddenLifecycleValid = results.filter((item) => item.scheduler === "OFFSCREEN_DOCUMENT" && item.state === "hidden").every(lifecycleMatches);
    const architectureOutcome = !foregroundLifecycleValid
      ? "INVALID"
      : contentHiddenLifecycleValid && contentHiddenPassed
        ? "A"
        : offscreenHiddenLifecycleValid && offscreenHiddenPassed
          ? "B"
          : "C";
    return {
      testedAt: new Date().toISOString(),
      browserUserAgent: navigator.userAgent,
      headless: false,
      dailyProfile: true,
      extension: { id: chrome.runtime.id, name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version },
      demoUrl: DEMO_URL,
      targetTabId: targetTab.id,
      targetWindowId: targetWindow.id,
      runnerTabId: runnerTab.id,
      backgroundMode: "inactive target tab in a dedicated normal Chrome window; harmless extension tab active; runner window focused",
      backend: "DOM_SYNTHETIC",
      sample: { playbackEvents: EVENTS, measuredIntervals: EVENTS - 1 },
      acceptanceThreshold: "p95 <= requested * 1.25 and maximum drift <= max(50 ms, requested * 0.5)",
      visibilityProof: { foreground: foregroundSurface, hidden: hiddenSurface },
      lifecycleValid,
      foregroundLifecycleValid,
      contentHiddenLifecycleValid,
      offscreenHiddenLifecycleValid,
      contentHiddenPassed,
      offscreenHiddenPassed,
      architectureOutcome,
      results
    };
  } finally {
    benchmarkTargetTabId = null;
    await chrome.windows.remove(targetWindow.id).catch(() => {});
  }
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  status.dataset.state = "running";
  status.textContent = "Starting…";
  try {
    const report = await runBenchmark();
    output.textContent = JSON.stringify(report, null, 2);
    const saveResponse = await fetch(RESULT_URL, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(report) });
    if (!saveResponse.ok) throw new Error(`RESULT_SAVE_HTTP_${saveResponse.status}`);
    status.dataset.state = "complete";
    status.textContent = `Complete — architecture outcome ${report.architectureOutcome}.`;
  } catch (error) {
    const failure = { testedAt: new Date().toISOString(), error: error?.message || String(error), stack: error?.stack || null };
    output.textContent = JSON.stringify(failure, null, 2);
    status.dataset.state = "failed";
    status.textContent = `Failed: ${failure.error}`;
  } finally {
    runButton.disabled = false;
  }
});
