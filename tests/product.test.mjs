import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, WeakSet, structuredClone, crypto: { randomUUID: () => "new-id" } });
vm.runInContext(await readFile(new URL("../extension/product-core.js", import.meta.url), "utf8"), context);
const Product = context.ZuiProduct;
const valid = (macro) => ({ valid: Boolean(macro?.id && macro?.name && Array.isArray(macro?.events)), errors: [] });
const macro = (id, name = id, count = 1) => ({ id, name, createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z", events: Array.from({ length: count }, () => ({ type: "delay" })) });

test("friendly product errors expose recovery without hiding technical code", () => {
  const known = Product.friendlyError("CDP_TARGET_HIDDEN:details");
  assert.equal(known.code, "CDP_TARGET_HIDDEN"); assert.equal(known.actionId, "focus-target");
  assert.equal(Product.friendlyError("NEW_CODE").code, "NEW_CODE");
  for (const code of ["SITE_PERMISSION_REQUIRED", "SITE_PERMISSION_DENIED", "UNSUPPORTED_TARGET_SCHEME", "SCRIPT_INJECTION_FAILED", "SITE_ACCESS_REMOVE_BLOCKED", "PLAYBACK_STOP_TIMEOUT"]) assert.equal(Product.friendlyError(code).code, code);
});

test("settings normalize and session overrides win over macro and global defaults", () => {
  const settings = Product.normalizeSettings({ recording: { mouse: false }, playback: { speedMultiplier: 2 } });
  assert.equal(settings.recording.mouse, false); assert.equal(settings.recording.keyboard, true);
  assert.deepEqual({ ...Product.resolvePlaybackSettings(settings, { speedMultiplier: 3, repeatCount: 4 }, { repeatCount: 2 }) }, { speedMultiplier: 3, repeatCount: 2, loopDelayMs: 0, stopOnError: true });
});

test("settings reset resolves to defaults without a macro-library mutation", async () => {
  assert.deepEqual(Product.normalizeSettings({}), Product.normalizeSettings(Product.DEFAULT_SETTINGS));
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const resetBranch = worker.slice(worker.indexOf('message.type === "RESET_PRODUCT_SETTINGS"'), worker.indexOf('message.type === "GET_LIBRARY_BACKUP"'));
  assert.match(resetBranch, /PRODUCT_SETTINGS_KEY/);
  assert.doesNotMatch(resetBranch, /MACROS_KEY/);
});

test("onboarding state is first-run only and can be explicitly reopened", () => {
  assert.equal(Product.shouldShowOnboarding(undefined), true);
  assert.equal(Product.shouldShowOnboarding({ completed: true }), false);
});

test("recorder polling preserves a user's new macro-name draft after a stopped session", () => {
  const stopped = { state: "STOPPED", name: "Previous recording" };
  assert.equal(Product.shouldHydrateRecorderName(stopped, false), true);
  assert.equal(Product.shouldHydrateRecorderName(stopped, true), false);
  assert.equal(Product.shouldHydrateRecorderName({ state: "RECORDING", name: "New recording" }, true), true);
});

test("popup keeps Target first, moves Playback above Recording, and preserves trailing actions", async () => {
  const html = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  const target = html.indexOf("<span>Target</span>");
  const playback = html.indexOf("<span>Playback</span>");
  const recording = html.indexOf("<span>Recording</span>");
  const library = html.indexOf("Library &amp; Editor");
  const settings = html.indexOf(">Settings<");
  const guide = html.indexOf("Quick guide");
  assert.ok(target < playback && playback < recording);
  assert.ok(recording < library && library < settings && settings < guide);
});

test("popup selection hydrates only a valid last-played macro while a target exists", () => {
  const macros = [macro("first"), macro("last")];
  assert.equal(Product.resolvePopupMacroSelection(macros, "", "last", true, false), "last");
  assert.equal(Product.resolvePopupMacroSelection(macros, "", "missing", true, false), "");
  assert.equal(Product.resolvePopupMacroSelection(macros, "", "last", false, false), "");
  assert.equal(Product.resolvePopupMacroSelection(macros, "first", "last", true, true), "first");
  assert.equal(Product.resolvePopupMacroSelection(macros, "", "last", true, true), "");
});

test("popup close adapter covers successful starts and every recovery class", () => {
  const cases = [
    ["A Record acknowledged", "record", { ok: true, status: { state: "RECORDING" } }, true],
    ["B no target", "record", { ok: false, error: "NO_PINNED_TARGET" }, false],
    ["C Play acknowledged", "play", { ok: true, status: { state: "RUNNING" } }, true],
    ["D origin mismatch", "play", { ok: false, error: "MACRO_TARGET_ORIGIN_MISMATCH" }, false],
    ["E permission denied", "record", { ok: false, error: "SITE_PERMISSION_DENIED" }, false],
    ["F playback conflict", "play", { ok: false, error: "PLAYBACK_ALREADY_ACTIVE" }, false],
    ["G Last Recording Play acknowledged", "play", { ok: true, status: { state: "RUNNING" } }, true]
  ];

  for (const [label, action, response, expected] of cases) {
    let closeRequests = 0;
    assert.equal(Product.requestPopupCloseAfterStart(action, response, () => { closeRequests += 1; }), expected, label);
    assert.equal(closeRequests, expected ? 1 : 0, label);
  }

  assert.equal(Product.shouldClosePopupAfterStart("record", { ok: true, status: { state: "RUNNING" } }), false);
  assert.equal(Product.shouldClosePopupAfterStart("play", { ok: true, status: { state: "RECORDING" } }), false);
  assert.equal(Product.shouldClosePopupAfterStart("pause", { ok: true, status: { state: "PAUSED" } }), false);
});

test("settings exposes an explicit onboarding reopen route", async () => {
  const settings = await readFile(new URL("../extension/settings.js", import.meta.url), "utf8");
  assert.match(settings, /onboarding\.html\?reopen=1/);
});

test("library search sort and recent ordering are deterministic for 100 large macros", () => {
  const rows = Array.from({ length: 100 }, (_, index) => macro(`m${index}`, `Macro ${String(index).padStart(3,"0")}`, 1000));
  const started = performance.now();
  assert.equal(Product.searchMacros(rows, "Macro 09").length, 10);
  assert.equal(Product.sortMacros(rows, "name", "desc")[0].name, "Macro 099");
  assert.deepEqual([...Product.updateRecent(["m1","m2"], "m2")], ["m2","m1"]);
  assert.ok(performance.now() - started < 1000);
});

test("backup excludes runtime identity and restore policies are atomic", () => {
  const backup = Product.createLibraryBackup([macro("one", "Alpha")], "2026-09-24T00:00:00.000Z");
  assert.equal(Product.validateLibraryBackup(backup, valid).valid, true);
  assert.throws(() => Product.createLibraryBackup([{ ...macro("x"), tabId: 5 }]), /BACKUP_RUNTIME_FIELD/);
  const keep = Product.planLibraryRestore([macro("old", "Alpha")], backup, "keep-both", valid, { now: () => "now", makeId: () => "copy" });
  assert.equal(keep.ok, true); assert.equal(keep.macros[0].name, "Alpha (2)"); assert.equal(keep.macros[0].id, "copy");
  const replace = Product.planLibraryRestore([macro("old", "Alpha")], backup, "replace", valid, { now: () => "now" });
  assert.equal(replace.macros.length, 1); assert.equal(replace.macros[0].id, "one");
  const invalid = Product.planLibraryRestore([], { ...backup, backupSchemaVersion: "99" }, "replace", valid);
  assert.equal(invalid.ok, false); assert.equal(invalid.errorCode, "BACKUP_VERSION_UNSUPPORTED");
});

test("backup serialization carries an explicit version and timestamp", () => {
  const backup = Product.createLibraryBackup([macro("one")], "2026-09-24T01:02:03.000Z");
  assert.equal(backup.backupSchemaVersion, "1.0");
  assert.equal(backup.createdAt, "2026-09-24T01:02:03.000Z");
  assert.equal(backup.macros.length, 1);
});

test("backup validation reports a malformed macro without accepting it", () => {
  const backup = Product.createLibraryBackup([macro("one")]);
  backup.macros.push({ name: "Broken", events: [] });
  const result = Product.validateLibraryBackup(backup, valid);
  assert.equal(result.valid, false);
  assert.equal(result.rows[1].valid, false);
});

test("restore conflict skip policy never silently overwrites", () => {
  const backup = Product.createLibraryBackup([macro("one", "Alpha")]);
  const result = Product.planLibraryRestore([macro("old", "Alpha")], backup, "skip", valid);
  assert.equal(result.ok, true); assert.equal(result.restored, 0); assert.equal(result.skipped, 1);
  assert.equal(result.macros[0].id, "old");
});

test("macro names use trimmed case-insensitive identity with visible suggestions", () => {
  const macros = [macro("one", " Alpha "), macro("two", "alpha (2)")];
  assert.equal(Product.normalizeMacroName("  Alpha  "), "Alpha");
  assert.equal(Product.findMacroNameConflict(macros, "alpha")?.id, "one");
  assert.equal(Product.uniqueMacroName(" ALPHA ", macros), "ALPHA (3)");
  assert.equal(Product.findMacroNameConflict(macros, "alpha", "one"), null);
});

test("restore treats whitespace and case variants as the same macro name", () => {
  const backup = Product.createLibraryBackup([macro("new", " alpha ")]);
  const result = Product.planLibraryRestore([macro("old", "Alpha")], backup, "keep-both", valid, { now: () => "now", makeId: () => "copy" });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.macros[0].name, "alpha (2)");
});

test("restore rejects nested runtime identity fields", () => {
  const backup = Product.createLibraryBackup([macro("one")]);
  backup.macros[0].target = { runtime: { tabId: 9 } };
  const result = Product.validateLibraryBackup(backup, valid);
  assert.equal(result.valid, false); assert.equal(result.errors[0].code, "BACKUP_RUNTIME_FIELD");
});

test("release version is consistent and all product pages are packaged", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, manifest.version); assert.equal(manifest.version, "0.6.0");
  assert.equal(manifest.name, "ZUI Macro Recorder for Chrome");
  assert.equal(manifest.name.length <= 75, true);
  assert.equal(manifest.short_name, "ZUI Macro");
  assert.equal(manifest.short_name.length <= 12, true);
  for (const file of ["popup.html","editor.html","settings.html","onboarding.html","product-core.js","site-permissions-core.js","product.css"]) assert.ok((await readFile(new URL(`../extension/${file}`, import.meta.url))).length > 0);
});

test("manifest declares the complete shortcut command surface without invalid Ctrl+Alt defaults", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.commands), ["toggle-playback", "stop-playback", "step-playback", "toggle-recording", "abort-recording"]);
  assert.equal(manifest.commands["toggle-playback"].suggested_key.default, "Ctrl+Shift+P");
  assert.equal(manifest.commands["stop-playback"].suggested_key.default, "Ctrl+Q");
  assert.equal(manifest.commands["step-playback"].suggested_key, undefined);
  assert.equal(manifest.commands["toggle-recording"].suggested_key, undefined);
  assert.equal(manifest.commands["abort-recording"].suggested_key, undefined);
});

test("shortcut settings separate actual Chrome assignments from recommendations", () => {
  const rows = Product.shortcutRows([
    { name: "toggle-playback", shortcut: "" },
    { name: "stop-playback", shortcut: "Ctrl+Q" },
    { name: "step-playback", shortcut: "Alt+S" }
  ]);
  assert.deepEqual([...rows.map((row) => row.current)], ["Not assigned", "Ctrl+Q", "Alt+S", "Not assigned", "Not assigned"]);
  assert.deepEqual([...rows.map((row) => row.recommended)], ["Ctrl+Shift+P", "Ctrl+Q", "Ctrl+Alt+F10", "Ctrl+Alt+R", "Ctrl+Alt+Q"]);
  assert.equal(rows.find((row) => row.name === "stop-playback").matchesRecommended, true);
  assert.equal(rows.find((row) => row.name === "step-playback").matchesRecommended, false);
});

test("settings exposes site access listing and removal without portable permission fields", async () => {
  const html = await readFile(new URL("../extension/settings.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../extension/settings.js", import.meta.url), "utf8");
  assert.match(html, /Sites? access/i);
  assert.match(script, /GET_SITE_ACCESS/);
  assert.match(script, /REMOVE_SITE_ACCESS/);
  assert.match(script, /Remove access/);
});
