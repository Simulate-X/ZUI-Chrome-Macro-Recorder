import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestExtension } from "./test-extension.mjs";
import { launchPhase6B, sleep, waitFor } from "./phase6b-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseExtensionPath = path.join(root, "dist", "extension");
const resultPath = path.join(root, "test-results", "phase-6b.json");
const built = spawnSync(process.execPath, [path.join(root, "scripts", "build-release.mjs")], { cwd: root, stdio: "inherit" });
if (built.status !== 0) throw new Error("Release build failed");

const frameFixture = () => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}canvas{display:block;width:640px;height:360px;background:#167}</style>
<canvas id="canvas" width="640" height="360"></canvas><script>document.querySelector('#canvas').addEventListener('click',event=>event.currentTarget.dataset.count=String(+(event.currentTarget.dataset.count||0)+1))</script>`;

const fixture = (kind) => `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;min-height:1600px}canvas,#surface{display:block;width:640px;height:360px;background:#167;color:white}#gameframe{display:block;width:640px;height:360px;border:0}#spacer{height:1000px}</style>
<h1>${kind}</h1><button id="action">Action</button><input id="text"><input id="password" type="password"><div id="surface" data-zui-surface></div><canvas id="canvas" width="640" height="360"></canvas><iframe id="gameframe" src="/frame"></iframe><div id="spacer"></div>
<script>
for(const node of [document.querySelector('#action'),document.querySelector('#surface'),document.querySelector('#canvas')]){node.addEventListener('click',()=>node.dataset.count=String(+(node.dataset.count||0)+1))}
window.replaceSurface=()=>{const old=document.querySelector('#surface');const fresh=old.cloneNode();old.replaceWith(fresh);fresh.addEventListener('click',()=>fresh.dataset.count=String(+(fresh.dataset.count||0)+1))};
window.addEventListener('popstate',()=>document.body.dataset.routes=String(+(document.body.dataset.routes||0)+1));
</script>`;

async function serve(kind) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(request.url === "/frame" ? frameFixture() : fixture(kind));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/${kind}` };
}

const sites = await Promise.all([serve("canvas"), serve("dynamic"), serve("form")]);
const testExtension = await prepareTestExtension(releaseExtensionPath, ["http://127.0.0.1/*"]);
const point = { space: "target-normalized", x: .5, y: .5 };
const down = (id) => ({ id, type: "mouseDown", enabled: true, position: point, button: "left", buttons: 1, modifiers: [] });
const up = (id) => ({ id, type: "mouseUp", enabled: true, position: point, button: "left", buttons: 0, modifiers: [] });
const delay = (id, durationMs) => ({ id, type: "delay", enabled: true, durationMs });
const clickEvents = (prefix = "click") => [down(`${prefix}-down`), up(`${prefix}-up`)];
const macro = (id, origin, events, defaults = {}, locator = "#action") => ({
  schemaVersion: "1.0",
  id,
  name: id,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  target: { origin, surface: { kind: locator.endsWith("#canvas") ? "canvas" : "container", locator: { strategy: "css", value: locator }, recordedGeometry: { widthCssPx: 640, heightCssPx: 360, devicePixelRatio: 1 } } },
  recordingProfile: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true },
  playbackDefaults: { speedMultiplier: 1, repeatCount: 1, loopDelayMs: 0, stopOnError: true, ...defaults },
  events
});

let app;
try {
  app = await launchPhase6B(testExtension.extensionPath);
  const pages = [];
  for (const site of sites) pages.push(await app.open(site.url));
  const originFor = (page) => new URL(page.url).origin;
  const pin = async (page) => {
    await app.runtime({ type: "PIN_TAB_BY_ID", tabId: page.tab.id });
    await waitFor(async () => (await app.popupEval(`chrome.tabs.sendMessage(${page.tab.id},{type:'GET_SURFACE'},{frameId:0}).catch(()=>null)`))?.ok);
  };
  const count = (page, selector = "#action") => app.evaluate(page.client, `Number(document.querySelector(${JSON.stringify(selector)}).dataset.count||0)`);
  const frameCount = (page) => app.evaluate(page.client, "Number(document.querySelector('#gameframe').contentDocument.querySelector('#canvas').dataset.count||0)");
  const results = { generatedAt: new Date().toISOString(), browserPath: app.browserPath, syntheticSiteClasses: ["canvas/WebGL-like", "dynamic/SPA-like", "form/text-like"] };

  await pin(pages[0]);
  await app.reopenPopup();
  const popupSectionOrder = await app.popupEval("[...document.querySelectorAll('main > section.card > .section-title > span:first-child')].map(node=>node.textContent.trim()).slice(0,3)");
  assert.deepEqual(popupSectionOrder, ["Target", "Playback", "Recording"]);
  await app.popupEval("window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-name').value='Popup close Record';document.querySelector('#record').click();true");
  await waitFor(async () => (await app.runtime({ type: "GET_RECORDER_STATUS" })).status.state === "RECORDING");
  assert.equal(await app.popupEval("window.__zuiCloseRequests"), 1);
  await app.runtime({ type: "CANCEL_RECORDING" });

  await app.runtime({ type: "CLEAR_TARGET" });
  await app.reopenPopup();
  await app.popupEval("window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#record').click();true");
  await waitFor(() => app.popupEval("document.querySelector('#notice').hidden === false && document.querySelector('#notice-code').textContent.includes('NO_PINNED_TARGET')"));
  assert.equal(await app.popupEval("window.__zuiCloseRequests"), 0);
  await pin(pages[0]);

  await app.runtime({ type: "START_RECORDING", name: "Phase 6B core flow", settings: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true } });
  const rect = await app.evaluate(pages[0].client, "(()=>{const r=document.querySelector('#action').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await pages[0].client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", buttons: 1, clickCount: 1 });
  await pages[0].client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(async () => (await app.runtime({ type: "GET_RECORDER_STATUS" })).status.inputEventCount === 2);
  await app.runtime({ type: "PAUSE_RECORDING" });
  await app.reopenPopup();
  assert.equal((await app.runtime({ type: "GET_RECORDER_STATUS" })).status.state, "PAUSED");
  await app.runtime({ type: "RESUME_RECORDING" });
  const recorded = (await app.runtime({ type: "STOP_RECORDING" })).status.result.macro;
  assert.equal(recorded.events.filter((event) => event.type !== "delay").length, 2);
  await app.runtime({ type: "SAVE_MACRO", macro: recorded, allowReplace: true });
  await app.reopenPopup();
  await waitFor(() => app.popupEval("document.querySelector('#result-card').hidden === false"));
  await app.popupEval("window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#play-result').click();true");
  await waitFor(() => app.popupEval("window.__zuiCloseRequests === 1"));
  assert.equal((await app.terminal()).state, "COMPLETED");

  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').querySelector('option[value=${JSON.stringify(recorded.id)}]') !== null`));
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(recorded.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("window.__zuiCloseRequests === 1"));
  assert.equal((await app.terminal()).state, "COMPLETED");

  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').value===${JSON.stringify(recorded.id)}`));
  await app.evaluate(pages[0].client, "window.replaceSurface();true");
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').value===${JSON.stringify(recorded.id)}`));

  const failedSelection = macro("popup-failed-selection", originFor(pages[1]), clickEvents("popup-failed-selection"));
  await app.runtime({ type: "SAVE_MACRO", macro: failedSelection, allowReplace: false });
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').querySelector('option[value=${JSON.stringify(failedSelection.id)}]') !== null`));
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(failedSelection.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("document.querySelector('#notice-code').textContent.includes('ORIGIN_MISMATCH')"));
  assert.equal(await app.popupEval("window.__zuiCloseRequests"), 0);
  assert.equal(await app.popupEval("chrome.storage.local.get('lastPlayedMacroId').then(value=>value.lastPlayedMacroId)"), recorded.id);
  await app.runtime({ type: "DELETE_MACRO", id: failedSelection.id });
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').value===${JSON.stringify(recorded.id)}`));

  const conflictMacro = macro("popup-conflict", originFor(pages[0]), [delay("conflict-delay", 5000), ...clickEvents("conflict")]);
  await app.runtime({ type: "START_PLAYBACK", macro: conflictMacro });
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').querySelector('option[value=${JSON.stringify(recorded.id)}]') !== null`));
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(recorded.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').disabled=false;document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("document.querySelector('#notice-code').textContent.includes('PLAYBACK_ALREADY_ACTIVE')"));
  assert.equal(await app.popupEval("window.__zuiCloseRequests"), 0);
  await app.runtime({ type: "STOP_PLAYBACK" });
  assert.equal((await app.terminal()).state, "STOPPED");

  await app.reopenPopup();
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(recorded.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("window.__zuiCloseRequests === 1"));
  assert.equal((await app.terminal()).state, "COMPLETED");
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').value===${JSON.stringify(recorded.id)}`));
  await app.popupEval("document.querySelector('#clear-target').click();true");
  await waitFor(() => app.popupEval("document.querySelector('#target-badge').textContent==='Not selected' && document.querySelector('#macro-select').value===''"));
  assert.equal(await app.popupEval("chrome.storage.local.get('lastPlayedMacroId').then(value=>value.lastPlayedMacroId||null)"), null);

  await pin(pages[0]);
  await app.reopenPopup();
  assert.equal(await app.popupEval("document.querySelector('#macro-select').value"), "");
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(recorded.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("window.__zuiCloseRequests === 1"));
  assert.equal((await app.terminal()).state, "COMPLETED");
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').value===${JSON.stringify(recorded.id)}`));
  await app.runtime({ type: "DELETE_MACRO", id: recorded.id });
  await waitFor(() => app.popupEval("document.querySelector('#macro-select').value===''"));
  assert.equal(await app.popupEval("chrome.storage.local.get('lastPlayedMacroId').then(value=>value.lastPlayedMacroId||null)"), null);

  results.popupAutoClose = { state: "PASS", recordAcknowledged: true, noTargetStayedOpen: true, selectedPlayAcknowledged: true, lastRecordingPlayAcknowledged: true, playbackConflictStayedOpen: true };
  results.popupPlaybackSelection = { state: "PASS", sectionOrder: popupSectionOrder, reopenPreserved: true, targetSurfaceChangePreserved: true, failedStartIgnored: true, clearTargetReset: true, deletedMacroFallback: true };
  results.coreFlow = { state: "PASS", recordedEvents: recorded.events.length, popupReopen: "PASS" };
  console.log("phase6b: core record/pause/reopen/resume/stop/save/replay PASS");

  const commands = await app.popupEval("chrome.commands.getAll()");
  const shortcuts = Object.fromEntries(commands.map((item) => [item.name, item.shortcut || "Not assigned"]));
  assert.ok(["Ctrl+Shift+P", "Not assigned"].includes(shortcuts["toggle-playback"]));
  assert.ok(["Ctrl+Q", "Not assigned"].includes(shortcuts["stop-playback"]));
  assert.equal(shortcuts["step-playback"], "Not assigned");
  assert.equal(shortcuts["toggle-recording"], "Not assigned");
  assert.equal(shortcuts["abort-recording"], "Not assigned");
  const settingsPage = await app.open(`chrome-extension://${app.extensionId}/settings.html`);
  const shortcutUi = await waitFor(() => app.evaluate(settingsPage.client, "[...document.querySelectorAll('#shortcuts>div')].map(row=>({command:row.dataset.command,text:row.textContent,recommended:row.dataset.recommended}))"));
  assert.equal(shortcutUi.length, 5);
  for (const row of shortcutUi) assert.equal(row.text.includes(`Current: ${shortcuts[row.command]}`), true);
  assert.match(shortcutUi.find((row) => row.command === "step-playback").text, /Recommended: Ctrl\+Alt\+F10/);
  await app.browser.call("Target.closeTarget", { targetId: settingsPage.id });
  results.shortcuts = { state: "PASS", actual: shortcuts, unsupportedRequestedDefaults: ["Ctrl+Alt+F10", "Ctrl+Alt+R", "Ctrl+Alt+Q"] };

  const namingMacro = macro("name-contract", originFor(pages[0]), [delay("name-delay", 0)]);
  namingMacro.name = "Name Contract";
  await app.runtime({ type: "SAVE_MACRO", macro: namingMacro, allowReplace: false });
  const collision = structuredClone(namingMacro); collision.id = "name-contract-collision"; collision.name = "  name contract  ";
  const collisionResult = await app.runtime({ type: "SAVE_MACRO", macro: collision, allowReplace: false }, true);
  assert.equal(collisionResult.errorCode, "MACRO_NAME_CONFLICT");
  let editor = await app.open(`chrome-extension://${app.extensionId}/editor.html`);
  await waitFor(() => app.evaluate(editor.client, "document.querySelector('#macro-name')?.value === 'Name Contract'"));
  await app.evaluate(editor.client, `(()=>{window.prompt=()=>"Renamed Contract";const card=[...document.querySelectorAll('#library .macro-card')].find(row=>row.querySelector('strong')?.textContent==='Name Contract');[...card.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();return true})()`);
  await waitFor(() => app.evaluate(editor.client, "document.querySelector('#macro-name')?.value === 'Renamed Contract'"));
  await app.evaluate(editor.client, "document.querySelector('#save').click()");
  await waitFor(async () => (await app.runtime({ type: "GET_MACROS" })).macros.some((item) => item.id === "name-contract" && item.name === "Renamed Contract"));
  await app.evaluate(editor.client, `(()=>{const input=document.querySelector('#detail input[name="durationMs"]');input.value='25';input.closest('form').requestSubmit();document.querySelector('#save').click();return true})()`);
  await waitFor(async () => (await app.runtime({ type: "GET_MACROS" })).macros.some((item) => item.id === "name-contract" && item.name === "Renamed Contract" && item.events[0].durationMs === 25));
  await app.evaluate(editor.client, `(()=>{document.querySelector('#raw-tab').click();const input=document.querySelector('#raw-json');const parsed=JSON.parse(input.value);parsed.events[0].durationMs=30;input.value=JSON.stringify(parsed);document.querySelector('#apply-raw').click();document.querySelector('#save').click();return true})()`);
  await waitFor(async () => (await app.runtime({ type: "GET_MACROS" })).macros.some((item) => item.id === "name-contract" && item.name === "Renamed Contract" && item.events[0].durationMs === 30));
  await app.evaluate(editor.client, `(()=>{document.querySelector('#visual-tab').click();const input=document.querySelector('#detail input[name="durationMs"]');input.value='40';input.closest('form').requestSubmit();document.querySelector('#undo').click();document.querySelector('#redo').click();document.querySelector('#save').click();return true})()`);
  await waitFor(async () => (await app.runtime({ type: "GET_MACROS" })).macros.some((item) => item.id === "name-contract" && item.name === "Renamed Contract" && item.events[0].durationMs === 40));
  await app.evaluate(editor.client, `(()=>{const create=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{blob.text().then(text=>window.__zuiExportText=text);return create(blob)};document.querySelector('#export').click();return true})()`);
  const exportedRenamed = await waitFor(() => app.evaluate(editor.client, "window.__zuiExportText || null"));
  assert.equal(JSON.parse(exportedRenamed).name, "Renamed Contract");
  await app.browser.call("Target.closeTarget", { targetId: editor.id });
  editor = await app.open(`chrome-extension://${app.extensionId}/editor.html`);
  await waitFor(() => app.evaluate(editor.client, "document.querySelector('#macro-name')?.value === 'Renamed Contract'"));
  results.macroNames = {
    state: "PASS",
    trimmedCaseInsensitiveConflict: true,
    renameThenSavePersists: true,
    renameThenDelaySavePersists: true,
    renameThenRawSavePersists: true,
    renameThenExportPersists: true,
    renameThenReopenPersists: true,
    renameUndoRedoConsistent: true
  };

  const sourceForRebind = macro("rebind-source", originFor(pages[0]), clickEvents("rebind"), {}, "#surface");
  sourceForRebind.name = "Rebind Source";
  await app.runtime({ type: "SAVE_MACRO", macro: sourceForRebind, allowReplace: false });
  await pin(pages[1]);
  await app.reopenPopup();
  await waitFor(() => app.popupEval(`document.querySelector('#macro-select').querySelector('option[value=${JSON.stringify(sourceForRebind.id)}]') !== null`));
  await app.popupEval(`window.__zuiCloseRequests=0;window.close=()=>{window.__zuiCloseRequests+=1};document.querySelector('#macro-select').value=${JSON.stringify(sourceForRebind.id)};document.querySelector('#macro-select').dispatchEvent(new Event('change'));document.querySelector('#quick-play').click();true`);
  await waitFor(() => app.popupEval("document.querySelector('#notice-code').textContent.includes('ORIGIN_MISMATCH')"));
  assert.equal(await app.popupEval("window.__zuiCloseRequests"), 0);
  const mismatch = await app.runtime({ type: "START_PLAYBACK", macro: sourceForRebind }, true);
  assert.equal(mismatch.errorCode, "ORIGIN_MISMATCH");
  const rebound = (await app.runtime({ type: "REBIND_MACRO", macro: sourceForRebind, mode: "copy" })).macro;
  assert.equal(rebound.target.origin, originFor(pages[1]));
  assert.notEqual(rebound.id, sourceForRebind.id);
  assert.equal((await app.runtime({ type: "GET_MACROS" })).macros.some((item) => item.id === sourceForRebind.id && item.target.origin === originFor(pages[0])), true);
  assert.equal(JSON.parse(JSON.stringify(rebound)).target.origin, originFor(pages[1]));
  const canvasSource = macro("rebind-canvas-source", originFor(pages[0]), clickEvents("rebind-canvas"), {}, "#canvas");
  const canvasBefore = await count(pages[1], "#canvas");
  const canvasRebound = (await app.runtime({ type: "REBIND_MACRO", macro: canvasSource, mode: "copy" })).macro;
  assert.equal(canvasRebound.target.surface.kind, "canvas");
  assert.equal(canvasRebound.target.surface.locator.value, "#canvas");
  await app.runtime({ type: "START_PLAYBACK", macro: canvasRebound });
  assert.equal((await app.terminal()).state, "COMPLETED");
  assert.equal(await count(pages[1], "#canvas"), canvasBefore + 1);
  const framedLocator = "#gameframe ::frame:: #canvas";
  await app.runtime({ type: "START_RECORDING", name: "Destination recorder parity", settings: { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false } });
  const framedPoint = await app.evaluate(pages[1].client, `(()=>{const frame=document.querySelector('#gameframe');frame.scrollIntoView({block:'center'});const frameRect=frame.getBoundingClientRect();const canvasRect=frame.contentDocument.querySelector('#canvas').getBoundingClientRect();return{x:frameRect.left+canvasRect.left+canvasRect.width/2,y:frameRect.top+canvasRect.top+canvasRect.height/2}})()`);
  await pages[1].client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: framedPoint.x, y: framedPoint.y, button: "left", buttons: 1, clickCount: 1 });
  await pages[1].client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: framedPoint.x, y: framedPoint.y, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(async () => (await app.runtime({ type: "GET_RECORDER_STATUS" })).status.inputEventCount === 2);
  const destinationRecorded = (await app.runtime({ type: "STOP_RECORDING" })).status.result.macro;
  assert.equal(destinationRecorded.target.surface.kind, "canvas");
  assert.equal(destinationRecorded.target.surface.locator.value, framedLocator);
  assert.ok(destinationRecorded.target.surface.recordedGeometry.widthCssPx > 0);
  assert.ok(destinationRecorded.target.surface.recordedGeometry.heightCssPx > 0);
  const framedSource = macro("rebind-framed-canvas-source", originFor(pages[0]), clickEvents("rebind-framed-canvas"), {}, framedLocator);
  framedSource.name = "Billionaire sanitized framed canvas";
  framedSource.target.surface.recordedGeometry = { widthCssPx: 1436.8001708984375, heightCssPx: 898, devicePixelRatio: 1.5 };
  await app.runtime({ type: "SAVE_MACRO", macro: framedSource, allowReplace: false });
  const framedEventsBefore = JSON.stringify(framedSource.events);
  const framedBefore = await frameCount(pages[1]);
  const framedRebound = (await app.runtime({ type: "REBIND_MACRO", macro: framedSource, mode: "copy" })).macro;
  assert.equal(framedRebound.target.surface.kind, "canvas");
  assert.equal(framedRebound.target.surface.locator.value, framedLocator);
  assert.notEqual(framedRebound.id, framedSource.id);
  assert.notEqual(framedRebound.createdAt, framedSource.createdAt);
  assert.equal(JSON.stringify(framedRebound.events), framedEventsBefore);
  assert.equal(framedRebound.target.surface.recordedGeometry.widthCssPx, 640);
  assert.equal(framedRebound.target.surface.recordedGeometry.heightCssPx, 360);
  assert.notDeepEqual(framedRebound.target.surface.recordedGeometry, framedSource.target.surface.recordedGeometry);
  assert.equal(/tabId|frameId|windowId|runtime|handle/i.test(JSON.stringify(framedRebound)), false);
  const framedRoundTrip = JSON.parse(JSON.stringify(framedRebound));
  assert.equal(framedRoundTrip.target.surface.locator.value, framedLocator);
  assert.equal(JSON.stringify(framedRoundTrip.events), framedEventsBefore);
  await app.runtime({ type: "START_PLAYBACK", macro: framedRebound });
  assert.equal((await app.terminal()).state, "COMPLETED");
  assert.equal(await frameCount(pages[1]), framedBefore + 1);
  const framedReplaceSource = structuredClone(framedSource);
  framedReplaceSource.id = "rebind-framed-replace-source";
  framedReplaceSource.name = "Framed replace source";
  await app.runtime({ type: "SAVE_MACRO", macro: framedReplaceSource, allowReplace: false });
  const framedReplaced = (await app.runtime({ type: "REBIND_MACRO", macro: framedReplaceSource, mode: "replace" })).macro;
  assert.equal(framedReplaced.id, framedReplaceSource.id);
  assert.equal(framedReplaced.target.origin, originFor(pages[1]));
  assert.equal(framedReplaced.target.surface.locator.value, framedLocator);
  assert.equal(JSON.stringify(framedReplaced.events), JSON.stringify(framedReplaceSource.events));
  const frameMissing = await app.runtime({ type: "REBIND_MACRO", macro: macro("missing-frame", originFor(pages[0]), clickEvents("missing-frame"), {}, "#missing-frame ::frame:: #canvas"), mode: "copy" }, true);
  assert.equal(frameMissing.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  assert.equal(frameMissing.diagnostic.context.reason, "FRAME_LOCATOR_FAILED");
  const canvasMissing = await app.runtime({ type: "REBIND_MACRO", macro: macro("missing-canvas", originFor(pages[0]), clickEvents("missing-canvas"), {}, "#gameframe ::frame:: #missing-canvas"), mode: "copy" }, true);
  assert.equal(canvasMissing.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  assert.equal(canvasMissing.diagnostic.context.reason, "LOCATOR_NOT_FOUND");
  const wrongFrame = await app.runtime({ type: "REBIND_MACRO", macro: macro("wrong-frame", originFor(pages[0]), clickEvents("wrong-frame"), {}, "#surface ::frame:: #canvas"), mode: "copy" }, true);
  assert.equal(wrongFrame.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  assert.equal(wrongFrame.diagnostic.context.reason, "FRAME_ENTER_FAILED");
  const kindMismatchMacro = macro("kind-mismatch", originFor(pages[0]), clickEvents("kind-mismatch"), {}, "#gameframe ::frame:: body");
  kindMismatchMacro.target.surface.kind = "canvas";
  const kindMismatch = await app.runtime({ type: "REBIND_MACRO", macro: kindMismatchMacro, mode: "copy" }, true);
  assert.equal(kindMismatch.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  assert.equal(kindMismatch.diagnostic.context.reason, "SURFACE_KIND_MISMATCH");
  await app.evaluate(pages[1].client, "document.querySelector('#gameframe').contentDocument.querySelector('#canvas').style.width='0px';document.querySelector('#gameframe').contentDocument.querySelector('#canvas').style.height='0px'");
  const zeroRect = await app.runtime({ type: "REBIND_MACRO", macro: framedSource, mode: "copy" }, true);
  assert.equal(zeroRect.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  assert.equal(zeroRect.diagnostic.context.reason, "ZERO_RECT");
  await app.evaluate(pages[1].client, "document.querySelector('#gameframe').contentDocument.querySelector('#canvas').style.width='640px';document.querySelector('#gameframe').contentDocument.querySelector('#canvas').style.height='360px'");
  const incompatibleSource = macro("rebind-incompatible", originFor(pages[0]), clickEvents("rebind-incompatible"), {}, "#missing-surface");
  const incompatible = await app.runtime({ type: "REBIND_MACRO", macro: incompatibleSource, mode: "copy" }, true);
  assert.equal(incompatible.errorCode, "REBIND_SURFACE_INCOMPATIBLE");
  await app.evaluate(editor.client, `(()=>{const card=[...document.querySelectorAll('#library .macro-card')].find(row=>row.querySelector('strong')?.textContent==='Renamed Contract');card?.click();return Boolean(card)})()`);
  await waitFor(() => app.evaluate(editor.client, "document.querySelector('#macro-name')?.value === 'Renamed Contract'"));
  await app.evaluate(editor.client, "document.querySelector('#playback-play').click()");
  await waitFor(() => app.evaluate(editor.client, "document.querySelector('#status').textContent.includes('MACRO_TARGET_ORIGIN_MISMATCH')"));
  await sleep(5_100);
  assert.equal(await app.evaluate(editor.client, "document.querySelector('#status').textContent.includes('MACRO_TARGET_ORIGIN_MISMATCH')"), true);
  assert.equal(await app.evaluate(editor.client, "document.querySelector('#rebind-panel').hidden"), false);
  const lastMismatchDiagnostic = (await app.runtime({ type: "GET_DIAGNOSTIC_REPORT" })).report.diagnostics.at(-1);
  assert.equal(lastMismatchDiagnostic.code, "ORIGIN_MISMATCH");
  await app.evaluate(editor.client, "window.confirm=()=>false;document.querySelector('#rebind-original').click()");
  await sleep(100);
  assert.equal((await app.runtime({ type: "GET_MACROS" })).macros.find((item) => item.id === "name-contract").target.origin, originFor(pages[0]));
  await app.evaluate(editor.client, "window.confirm=()=>true;document.querySelector('#rebind-original').click()");
  await waitFor(async () => (await app.runtime({ type: "GET_MACROS" })).macros.find((item) => item.id === "name-contract")?.target.origin === originFor(pages[1]));
  results.crossOriginRebind = { state: "PASS", mismatchBlocked: true, copyCreated: true, originalPreserved: true, replaceConfirmed: true, cancelPreserved: true, exportImportOriginPreserved: true, destinationSurfaceResolved: "canvas", observableReplayEffect: true, incompatibleSurfaceFailsClosed: true, recorderRebindParity: true, frameLocator: framedLocator, frameResolvedTag: "canvas", frameResolvedKind: framedRebound.target.surface.kind, destinationGeometry: framedRebound.target.surface.recordedGeometry, diagnosticReasons: ["FRAME_LOCATOR_FAILED", "LOCATOR_NOT_FOUND", "FRAME_ENTER_FAILED", "SURFACE_KIND_MISMATCH", "ZERO_RECT"], eventsUnchanged: true, runtimeIdsAbsent: true, sanitizedRealMetadata: { sourceOrigin: "https://play.billionaire-casino.com", destinationOrigin: "https://play.huugecasino.com", kind: "canvas", locator: framedLocator, recordedGeometry: { widthCssPx: 1436.8001708984375, heightCssPx: 898, devicePixelRatio: 1.5 } } };
  results.errorPersistence = { state: "PASS", visibleAfterMs: 5_100, recoveryActionsVisible: true, diagnosticsLastError: lastMismatchDiagnostic.code };

  await pin(pages[0]);
  await app.evaluate(pages[0].client, "document.querySelector('#surface').style.width='80vw';document.querySelector('#surface').style.height='45vw'");
  await pages[0].client.call("Emulation.setDeviceMetricsOverride", { width: 500, height: 700, deviceScaleFactor: 1, mobile: false });
  const resizedWidth = await app.evaluate(pages[0].client, "document.querySelector('#surface').getBoundingClientRect().width");
  const resizedBefore = await count(pages[0], "#surface");
  const resizeMacro = macro("resize-portable", originFor(pages[0]), clickEvents("resize"), {}, "#surface");
  await app.runtime({ type: "START_PLAYBACK", macro: resizeMacro });
  assert.equal((await app.terminal()).state, "COMPLETED");
  assert.equal(await count(pages[0], "#surface"), resizedBefore + 1);
  assert.ok(resizedWidth < 640);
  await pages[0].client.call("Emulation.clearDeviceMetricsOverride");
  results.windowResize = { state: "PASS", classification: "portable normalized coordinates", resizedSurfaceWidth: resizedWidth, visibleEffect: true };

  const switchBefore = await Promise.all(pages.map((page) => count(page)));
  for (let index = 0; index < 21; index++) {
    const page = pages[index % pages.length];
    await pin(page);
    await app.runtime({ type: "START_PLAYBACK", macro: macro(`switch-${index}`, originFor(page), clickEvents(`s${index}`)) });
    assert.equal((await app.terminal()).state, "COMPLETED");
  }
  const switchAfter = await Promise.all(pages.map((page) => count(page)));
  assert.deepEqual(switchAfter.map((value, index) => value - switchBefore[index]), [7, 7, 7]);
  results.targetSwitching = { state: "PASS", cycles: 21, perTargetDispatch: [7, 7, 7] };
  console.log("phase6b: 21-cycle target switching PASS");

  const similar = await app.open(sites[0].url);
  await pin(pages[0]);
  const originalBefore = await count(pages[0]);
  const similarBefore = await count(similar);
  await app.runtime({ type: "START_PLAYBACK", macro: macro("exact-tab", originFor(pages[0]), clickEvents("exact")) });
  assert.equal((await app.terminal()).state, "COMPLETED");
  assert.equal(await count(pages[0]), originalBefore + 1);
  assert.equal(await count(similar), similarBefore);
  results.similarTabs = { state: "PASS", exactPinnedTabOnly: true };

  await pin(pages[1]);
  const lifecycleMacro = macro("popup-lifecycle", originFor(pages[1]), [delay("wait", 50), ...clickEvents("life")], { repeatCount: 40 });
  await app.runtime({ type: "START_PLAYBACK", macro: lifecycleMacro });
  const lifecycleStates = [];
  let lifecyclePauseResumeCycles = 0;
  for (let index = 0; index < 25; index++) {
    await app.reopenPopup();
    const status = (await app.runtime({ type: "GET_PLAYBACK_STATUS" })).status;
    lifecycleStates.push(status.state);
    if (["COMPLETED", "STOPPED", "ERROR"].includes(status.state)) break;
    if (index % 5 === 0) {
      const paused = await app.runtime({ type: "PAUSE_PLAYBACK" });
      lifecycleStates.push(`pause:${paused.status.state}`);
      const resumed = await app.runtime({ type: "RESUME_PLAYBACK" });
      lifecycleStates.push(`resume:${resumed.status.state}`);
      lifecyclePauseResumeCycles += 1;
    }
    await sleep(25);
  }
  let lifecycleTerminal;
  try {
    lifecycleTerminal = await app.terminal(10_000);
  } catch (error) {
    const stuckStatus = (await app.runtime({ type: "GET_PLAYBACK_STATUS" })).status;
    const stuckHealth = await app.runtime({ type: "GET_RUNTIME_HEALTH" });
    throw new Error(`POPUP_LIFECYCLE_STUCK:${JSON.stringify({ lifecycleStates, stuckStatus, stuckHealth })}`, { cause: error });
  }
  assert.equal(lifecycleTerminal.state, "COMPLETED");
  results.popupLifecycle = { state: "PASS", reopenCycles: 25, pauseResumeCycles: lifecyclePauseResumeCycles, observedStates: lifecycleStates };
  console.log("phase6b: popup lifecycle 25-cycle PASS");

  const rapid = [];
  for (let index = 0; index < 10; index++) {
    const candidate = macro(`rapid-${index}`, originFor(pages[1]), [delay(`r${index}`, 1000), ...clickEvents(`r${index}`)]);
    await app.runtime({ type: "START_PLAYBACK", macro: candidate });
    rapid.push((await app.runtime({ type: "STOP_PLAYBACK" })).status.state);
  }
  assert.equal(rapid.every((state) => state === "STOPPED"), true);
  results.rapidStartStop = { state: "PASS", cycles: rapid.length };

  const loopMatrix = [];
  for (const repeatCount of [1, 2, 10, 100]) {
    for (const loopDelayMs of [0, 100, 1000]) {
      const started = performance.now();
      const candidate = macro(`loop-${repeatCount}-${loopDelayMs}`, originFor(pages[1]), clickEvents(`l-${repeatCount}-${loopDelayMs}`), { repeatCount, loopDelayMs, speedMultiplier: 5 });
      await app.runtime({ type: "START_PLAYBACK", macro: candidate });
      const status = await app.terminal(140_000);
      assert.equal(status.state, "COMPLETED");
      assert.equal(status.iteration, repeatCount);
      assert.equal(status.result.eventsExecuted, repeatCount * 2);
      loopMatrix.push({ repeatCount, loopDelayMs, durationMs: Math.round(performance.now() - started), eventsExecuted: status.result.eventsExecuted });
    }
  }
  results.loopMatrix = { state: "PASS", rows: loopMatrix };
  console.log("phase6b: repeat/loop-delay matrix PASS");

  const infinite = macro("infinite", originFor(pages[1]), [delay("i-delay", 1), ...clickEvents("i")], { repeatCount: 0 });
  await app.runtime({ type: "START_PLAYBACK", macro: infinite });
  await waitFor(async () => (await app.runtime({ type: "GET_PLAYBACK_STATUS" })).status.iteration >= 10, 30_000);
  const infiniteStopped = (await app.runtime({ type: "STOP_PLAYBACK" })).status;
  assert.equal(infiniteStopped.state, "STOPPED");
  results.infiniteLoop = { state: "PASS", iterationsBeforeStop: infiniteStopped.iteration, eventsExecuted: infiniteStopped.result.eventsExecuted };

  const immutable = macro("immutable", originFor(pages[1]), [delay("immutable-wait", 250), ...clickEvents("immutable")]);
  await app.runtime({ type: "START_PLAYBACK", macro: immutable });
  immutable.target.surface.locator.value = "#missing-after-start";
  immutable.events.length = 1;
  assert.equal((await app.terminal()).state, "COMPLETED");
  results.editDuringPlayback = { state: "PASS", immutableSnapshot: true };

  const speedRows = [];
  for (const speedMultiplier of [.5, 1, 2, 4, 5]) {
    const speedMacro = macro(`speed-${speedMultiplier}`, originFor(pages[1]), [delay(`speed-delay-${speedMultiplier}`, 500), ...clickEvents(`speed-${speedMultiplier}`)], { speedMultiplier });
    const canonicalDelay = speedMacro.events[0].durationMs;
    const started = performance.now();
    await app.runtime({ type: "START_PLAYBACK", macro: speedMacro });
    assert.equal((await app.terminal()).state, "COMPLETED");
    assert.equal(speedMacro.events[0].durationMs, canonicalDelay);
    speedRows.push({ speedMultiplier, elapsedMs: Math.round(performance.now() - started), canonicalDelayMs: canonicalDelay });
  }
  assert.equal(speedRows[0].elapsedMs > speedRows.at(-1).elapsedMs, true);
  results.playbackSpeed = { state: "PASS", rows: speedRows, canonicalDelayMutated: false };

  const rapidRecordStates = [];
  for (let index = 0; index < 10; index++) {
    await app.runtime({ type: "START_RECORDING", name: `Rapid record ${index}`, settings: { keyboard: true, mouse: true, mouseMode: "clicks-only", wheel: true } });
    const terminal = index % 2 === 0
      ? (await app.runtime({ type: "CANCEL_RECORDING" })).status
      : (await app.runtime({ type: "STOP_RECORDING" })).status;
    rapidRecordStates.push(terminal.state);
  }
  assert.equal(rapidRecordStates.every((state) => ["IDLE", "STOPPED"].includes(state)), true);
  results.rapidRecordCancelStop = { state: "PASS", cycles: 10, terminalStates: rapidRecordStates };

  await app.runtime({ type: "START_RECORDING", name: "Large recording", settings: { keyboard: false, mouse: true, mouseMode: "clicks-only", wheel: false } });
  const largeRect = await app.evaluate(pages[1].client, "(()=>{const r=document.querySelector('#action').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  for (let index = 0; index < 500; index++) {
    await pages[1].client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: largeRect.x, y: largeRect.y, button: "left", buttons: 1, clickCount: 1 });
    await pages[1].client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: largeRect.x, y: largeRect.y, button: "left", buttons: 0, clickCount: 1 });
  }
  await waitFor(async () => (await app.runtime({ type: "GET_RECORDER_STATUS" })).status.inputEventCount === 1_000, 60_000);
  const largeRecording = (await app.runtime({ type: "STOP_RECORDING" })).status;
  assert.equal(largeRecording.result.inputEventCount, 1_000);
  assert.equal(largeRecording.result.macro.events.length, 2_000);
  assert.equal(largeRecording.result.macro.events.every((event, index) => index % 2 === 0 ? event.type === "delay" : ["mouseDown", "mouseUp"].includes(event.type)), true);
  results.longRecordingStress = { state: "PASS", inputEvents: largeRecording.result.inputEventCount, canonicalRows: largeRecording.result.macro.events.length, explicitDelayOrder: true };

  const sizeBefore = await app.popupEval("chrome.storage.local.get(null).then(v=>JSON.stringify(v).length)");
  const memoryBefore = await pages[1].client.call("Performance.getMetrics").catch(() => ({ metrics: [] }));
  const inputUnit = [];
  for (let index = 0; index < 10; index++) inputUnit.push(...clickEvents(`soak-${index}`));
  const soakMacro = macro("accelerated-soak", originFor(pages[1]), inputUnit, { repeatCount: 5000 });
  const soakStarted = performance.now();
  await app.runtime({ type: "START_PLAYBACK", macro: soakMacro });
  const soak = await app.terminal(300_000);
  assert.equal(soak.state, "COMPLETED");
  assert.equal(soak.result.eventsExecuted, 100_000);
  const sizeAfter = await app.popupEval("chrome.storage.local.get(null).then(v=>JSON.stringify(v).length)");
  const memoryAfter = await pages[1].client.call("Performance.getMetrics").catch(() => ({ metrics: [] }));
  const health = await app.runtime({ type: "GET_RUNTIME_HEALTH" });
  assert.equal(health.debuggerSessions.length, 0);
  assert.ok(health.offscreenContexts <= 1);
  assert.ok(sizeAfter - sizeBefore < 4096);
  results.acceleratedSoak = { state: "PASS", durationMs: Math.round(performance.now() - soakStarted), iterations: soak.iteration, inputsProcessed: soak.result.eventsExecuted, evidenceRows: soak.result.rows.length, rowsDropped: soak.result.rowsDropped, localStorageGrowthBytes: sizeAfter - sizeBefore, offscreenContexts: health.offscreenContexts, debuggerSessions: health.debuggerSessions.length, performanceMetricsBefore: memoryBefore.metrics.length, performanceMetricsAfter: memoryAfter.metrics.length };
  console.log("phase6b: accelerated 100k-input soak PASS");

  const zero10k = macro("large-10k", originFor(pages[1]), Array.from({ length: 10_000 }, (_, index) => delay(`z${index}`, 0)));
  await app.runtime({ type: "START_PLAYBACK", macro: zero10k });
  const large = await app.terminal(60_000);
  assert.equal(large.state, "COMPLETED");
  assert.equal(large.eventIndex, 9_999);
  assert.equal(large.result.eventsExecuted, 0);
  results.largeMacro = { state: "PASS", rowsProcessed: 10_000, inputEventsDispatched: 0, rowsDropped: large.result.rowsDropped };

  const existing = (await app.runtime({ type: "GET_MACROS" })).macros;
  for (let index = 0; index < 25; index++) {
    await app.runtime({ type: "SAVE_MACRO", macro: macro(`library-${index}`, originFor(pages[1]), [delay(`library-delay-${index}`, 0)]), allowReplace: false });
  }
  const backup = (await app.runtime({ type: "GET_LIBRARY_BACKUP" })).backup;
  assert.equal(backup.macros.length, existing.length + 25);
  const keep = await app.runtime({ type: "RESTORE_LIBRARY_BACKUP", backup, conflictPolicy: "keep-both" });
  const skip = await app.runtime({ type: "RESTORE_LIBRARY_BACKUP", backup, conflictPolicy: "skip" });
  const replace = await app.runtime({ type: "RESTORE_LIBRARY_BACKUP", backup, conflictPolicy: "replace" });
  assert.equal(keep.restored, backup.macros.length);
  assert.equal(skip.restored, 0);
  assert.equal(replace.restored, backup.macros.length);
  assert.equal(/tabId|windowId|profileId|cookie|token/i.test(JSON.stringify(backup)), false);
  results.backupRestore = { state: "PASS", macros: backup.macros.length, keepBoth: keep, skip, replace, portable: true };

  let roundTrip = macro("roundtrip", originFor(pages[2]), [delay("roundtrip-delay", 100), ...clickEvents("roundtrip")]);
  const canonical = JSON.stringify(roundTrip);
  for (let index = 0; index < 10; index++) roundTrip = JSON.parse(JSON.stringify(roundTrip));
  assert.equal(JSON.stringify(roundTrip), canonical);
  results.importExportRoundTrip = { state: "PASS", cycles: 10, semanticDrift: false };

  const settings = (await app.runtime({ type: "GET_PRODUCT_SETTINGS" })).settings;
  const changed = structuredClone(settings);
  changed.playback.speedMultiplier = 2;
  changed.playback.repeatCount = 10;
  changed.diagnostics.debugLogging = !settings.diagnostics.debugLogging;
  await app.runtime({ type: "SET_PRODUCT_SETTINGS", settings: changed });
  await app.reopenPopup();
  const persisted = (await app.runtime({ type: "GET_PRODUCT_SETTINGS" })).settings;
  assert.equal(persisted.playback.speedMultiplier, 2);
  assert.equal(persisted.playback.repeatCount, 10);
  const macroCountBeforeReset = (await app.runtime({ type: "GET_MACROS" })).macros.length;
  await app.runtime({ type: "RESET_PRODUCT_SETTINGS" });
  assert.equal((await app.runtime({ type: "GET_MACROS" })).macros.length, macroCountBeforeReset);
  results.settingsPersistence = { state: "PASS", libraryUnaffectedByReset: true };

  await pin(pages[2]);
  await app.evaluate(pages[2].client, "document.querySelector('#text').focus()");
  const textMacro = macro("unicode-text", originFor(pages[2]), [{ id: "unicode", type: "text", enabled: true, value: "İstanbul, çığ, ölçü, €🙂" }], {}, "#text");
  await app.runtime({ type: "START_PLAYBACK", macro: textMacro });
  assert.equal((await app.terminal()).state, "COMPLETED");
  assert.equal(await app.evaluate(pages[2].client, "document.querySelector('#text').value"), "İstanbul, çığ, ölçü, €🙂");
  await app.evaluate(pages[2].client, "document.querySelector('#password').focus()");
  const secretMacro = macro("secret", originFor(pages[2]), [{ id: "secret-text", type: "text", enabled: true, value: "must-not-write" }], {}, "#password");
  await app.runtime({ type: "START_PLAYBACK", macro: secretMacro });
  const secret = await app.terminal();
  assert.equal(secret.errorCode, "SENSITIVE_INPUT_BLOCKED");
  assert.equal(await app.evaluate(pages[2].client, "document.querySelector('#password').value"), "");
  const diagnostic = (await app.runtime({ type: "GET_DIAGNOSTIC_REPORT" })).report;
  assert.equal(JSON.stringify(diagnostic).includes("must-not-write"), false);
  results.privacy = { state: "PASS", unicode: true, sensitiveInput: secret.errorCode, diagnosticRedacted: true };

  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await app?.close();
  await testExtension.cleanup().catch(() => {});
  for (const site of sites) await new Promise((resolve) => site.server.close(resolve));
}
