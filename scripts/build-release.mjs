import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const distRoot = path.join(root, "dist");
const dist = path.join(distRoot, "extension");
const release = path.join(root, "release");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
const files = (await readdir(source)).filter((name) => !name.startsWith("phase1") && !name.endsWith(".map"));
const forbidden = /(secret|cookie|token|profile|\.log$|\.zui-macro\.json$)/i;
if (files.some((name) => forbidden.test(name))) throw new Error("FORBIDDEN_RELEASE_CONTENT");
await rm(distRoot, { recursive: true, force: true });
await rm(release, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(release, { recursive: true });
for (const name of files) await cp(path.join(source, name), path.join(dist, name), { recursive: true });
const audit = [];
async function auditDirectory(directory, prefix = "") {
  for (const name of await readdir(directory)) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const info = await stat(absolute);
    if (info.isDirectory()) await auditDirectory(absolute, relative);
    else audit.push({ name: relative, bytes: info.size });
  }
}
await auditDirectory(dist);
const forbiddenPath = /(^|\/)(tests?|docs?|storage|diagnostics?|profiles?|node_modules|\.git)(\/|$)|(?:secret|cookie|token)|\.log$|\.zui-macro\.json$/i;
if (audit.some((item) => forbiddenPath.test(item.name))) throw new Error("FORBIDDEN_RELEASE_CONTENT");
audit.sort((left, right) => left.name.localeCompare(right.name));
await writeFile(path.join(distRoot, "package-audit.json"), `${JSON.stringify({ version: manifest.version, files: audit, excluded: ["tests", "docs", "node_modules", ".git", "phase1*", "user macros", "storage", "diagnostics", "browser profiles", "logs"] }, null, 2)}\n`);
if (process.argv.includes("--zip")) {
  const zip = path.join(release, `zui-macro-recorder-for-chrome-${manifest.version}.zip`);
  const command = `Compress-Archive -Path '${dist.replaceAll("'", "''")}\\*' -DestinationPath '${zip.replaceAll("'", "''")}' -Force`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("RELEASE_ZIP_FAILED");
  console.log(JSON.stringify({ dist, zip, files: audit.length }));
} else console.log(JSON.stringify({ dist, files: audit.length }));
