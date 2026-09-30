import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function prepareTestExtension(sourcePath, hostPermissions) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zui-test-extension-"));
  const extensionPath = path.join(root, "extension");
  await cp(sourcePath, extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [...new Set(hostPermissions)];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    extensionPath,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  };
}
