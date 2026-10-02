import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ URL, Set, Object, Number, Error });
context.globalThis = context;
vm.runInContext(await readFile(new URL("../extension/site-permissions-core.js", import.meta.url), "utf8"), context);
const Site = context.ZuiSitePermissions;

function permissions({ granted = false, requestResult = true } = {}) {
  const calls = [];
  return {
    calls,
    async contains(value) { calls.push(["contains", value]); return granted; },
    async request(value) { calls.push(["request", value]); granted = requestResult; return requestResult; }
  };
}

test("arbitrary HTTPS and HTTP targets produce site-scoped optional patterns", () => {
  assert.deepEqual({ ...Site.targetPermission("https://play.billionaire-casino.com/path?q=1") }, { valid: true, origin: "https://play.billionaire-casino.com", pattern: "https://play.billionaire-casino.com/*", protocol: "https:", hostname: "play.billionaire-casino.com" });
  assert.equal(Site.targetPermission("http://127.0.0.1:4173/test").pattern, "http://127.0.0.1/*");
  assert.equal(Site.targetPermission("http://example.test:8080/a").pattern, "http://example.test/*");
});

test("already granted access does not request permission again", async () => {
  const api = permissions({ granted: true });
  const result = await Site.requestSiteAccess("https://example.com/a", api);
  assert.equal(result.requested, false);
  assert.deepEqual(api.calls.map(([name]) => name), ["contains"]);
});

test("missing access is requested and grant is reported", async () => {
  const api = permissions();
  const result = await Site.requestSiteAccess("https://example.com/a", api);
  assert.equal(result.requested, true);
  assert.deepEqual(api.calls.map(([name]) => name), ["contains", "request"]);
  assert.equal(api.calls[1][1].origins[0], "https://example.com/*");
});

test("permission denial never grants or pins implicitly", async () => {
  const api = permissions({ requestResult: false });
  await assert.rejects(Site.requestSiteAccess("https://example.com", api), /SITE_PERMISSION_DENIED/);
});

test("removed permission fails the next required access check", async () => {
  const api = permissions({ granted: false });
  await assert.rejects(Site.requireSiteAccess("https://example.com", api), /SITE_PERMISSION_REQUIRED/);
});

test("browser, extension, local-file and executable schemes fail closed", () => {
  for (const value of ["chrome://settings", "chrome-extension://abc/page.html", "edge://extensions", "about:blank", "devtools://devtools", "view-source:https://example.com", "javascript:alert(1)", "data:text/plain,x", "file:///C:/test.html"]) {
    assert.deepEqual({ ...Site.targetPermission(value) }, { valid: false, code: "UNSUPPORTED_TARGET_SCHEME" });
  }
});

test("same-origin reload/navigation frames are injectable but cross-origin frames are excluded", () => {
  const frames = [{ frameId: 0, url: "https://example.com/page1" }, { frameId: 2, url: "https://example.com/page2" }, { frameId: 3, url: "https://other.example/frame" }];
  assert.deepEqual([...Site.sameOriginFrameIds(frames, "https://example.com")], [0, 2]);
});

test("settings lists only exact granted HTTP(S) site patterns", () => {
  const rows = Site.grantedSiteEntries(["https://example.com/*", "http://127.0.0.1/*", "https://*/*", "file:///*"]);
  assert.deepEqual(Array.from(rows, (row) => row.origin), ["http://127.0.0.1", "https://example.com"]);
});

test("runtime injection is target-only and guarded against duplicate listeners", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const content = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  assert.equal("content_scripts" in manifest, false);
  assert.match(worker, /chrome\.scripting\.executeScript/);
  assert.match(worker, /ZUI_RUNTIME_PING/);
  assert.match(worker, /SCRIPT_INJECTION_FAILED/);
  assert.match(content, /if \(global\.__ZUI_CONTENT_RUNTIME__\) return/);
  assert.match(content, /ZUI_CONTENT_RUNTIME/);
});

test("site permissions remain runtime/profile state and are absent from portable serialization", async () => {
  const product = await readFile(new URL("../extension/product-core.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(product.slice(product.indexOf("function createLibraryBackup"), product.indexOf("function validateLibraryBackup")), /permissions|getAll|origins/);
  assert.match(worker, /GET_SITE_ACCESS/);
  assert.match(worker, /SITE_ACCESS_REMOVE_BLOCKED/);
});

test("site access removal is blocked during active work and clears the matching pin and playback preference", async () => {
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const start = worker.indexOf("async function removeSiteAccess");
  const end = worker.indexOf("async function dispatchMacroEvent", start);
  const body = worker.slice(start, end);
  const clearStart = worker.indexOf("async function clearTargetState");
  const clearEnd = worker.indexOf("async function pingTargetRuntime", clearStart);
  const clearBody = worker.slice(clearStart, clearEnd);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /operationIsActive\(\).*SITE_ACCESS_REMOVE_BLOCKED/s);
  assert.match(body, /chrome\.permissions\.remove\(\{ origins: \[pattern\] \}\)/);
  assert.match(body, /clearTargetState\(\)/);
  assert.match(clearBody, /chrome\.storage\.session\.remove\(TARGET_KEY\)/);
  assert.match(clearBody, /chrome\.storage\.local\.remove\(LAST_PLAYED_KEY\)/);
});

test("permission removal and cross-origin navigation fail closed", async () => {
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /chrome\.permissions\.onRemoved\.addListener/);
  assert.match(worker, /controlOffscreenPlayback\("STOP", "SITE_PERMISSION_REQUIRED"\)/);
  assert.match(worker, /detachAllDebuggers\(\)/);
  assert.match(worker, /controlOffscreenPlayback\("STOP", "TARGET_NAVIGATED"\)/);
  assert.match(worker, /changeInfo\.status === "complete"[\s\S]*ensureTargetRuntime\(tab\)/);
});
