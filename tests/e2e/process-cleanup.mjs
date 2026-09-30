import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(false), ms));

export async function terminateProcessTree(child, timeoutMs = 3000) {
  if (!child) return { exited: true, forced: false };
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.exitCode !== null || child.signalCode !== null) return { exited: true, forced: false };
  const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
  child.kill();
  if (await Promise.race([exited, wait(timeoutMs)])) return { exited: true, forced: false };
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGKILL");
  return { exited: Boolean(await Promise.race([exited, wait(timeoutMs)])), forced: true };
}

export async function closeBrowserProcess(browser, child, timeoutMs = 3000) {
  if (browser) await Promise.race([browser.call("Browser.close").catch(() => null), wait(1500)]);
  browser?.close();
  return terminateProcessTree(child, timeoutMs);
}

export async function removeDirectoryBestEffort(path, timeoutMs = 3000) {
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).then(() => true).catch(() => false),
      timedOut
    ]);
  } finally { clearTimeout(timer); }
}
