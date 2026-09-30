import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("rapid sequential pause/resume remains idempotent across offscreen acknowledgement races", async () => {
  let listener;
  const statuses = [];
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage(message) {
        if (message.type === "PLAYBACK_STATUS_UPDATE") {
          statuses.push(structuredClone(message.status));
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { ok: true };
        }
        if (message.type === "OFFSCREEN_CLEANUP_INPUTS") return { ok: true, rows: [] };
        if (message.type === "OFFSCREEN_PLAY_EVENT") return { ok: true, result: { ok: true } };
        return { ok: true };
      }
    }
  };
  const context = vm.createContext({ console, chrome, crypto: globalThis.crypto, performance, setTimeout, clearTimeout, structuredClone });
  vm.runInContext(await readFile(new URL("../extension/playback-core.js", import.meta.url), "utf8"), context);
  vm.runInContext(await readFile(new URL("../extension/offscreen.js", import.meta.url), "utf8"), context);
  const send = (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });
  const point = { space: "target-normalized", x: .5, y: .5 };
  const macro = {
    id: "pause-race",
    name: "Pause race",
    target: { surface: { locator: { value: "#target" } } },
    playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true },
    events: [
      { id: "delay", type: "delay", enabled: true, durationMs: 5_000 },
      { id: "down", type: "mouseDown", enabled: true, position: point, button: "left", buttons: 1, modifiers: [] },
      { id: "up", type: "mouseUp", enabled: true, position: point, button: "left", buttons: 0, modifiers: [] }
    ]
  };
  const started = await send({ type: "OFFSCREEN_START_PLAYBACK", request: { macro, settings: macro.playbackDefaults } });
  assert.equal(started.ok, true);
  for (let index = 0; index < 50; index++) {
    const paused = await send({ type: "OFFSCREEN_CONTROL_PLAYBACK", action: "PAUSE" });
    assert.equal(paused.ok, true, paused.error);
    const resumed = await send({ type: "OFFSCREEN_CONTROL_PLAYBACK", action: "RESUME" });
    assert.equal(resumed.ok, true, resumed.error);
  }
  const stopped = await send({ type: "OFFSCREEN_CONTROL_PLAYBACK", action: "STOP", reason: "test_complete" });
  assert.equal(stopped.ok, true, stopped.error);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(statuses.some((status) => String(status.errorCode || "").includes("INVALID_PLAYBACK_TRANSITION")), false);
  assert.equal(statuses.at(-1).state, "STOPPED");
});
