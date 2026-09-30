import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const demoPath = path.join(root, "demo");
const resultPath = path.join(root, "test-results", "phase-1c.json");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
let resultReceived = false;

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/__phase1c_result") {
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      const report = JSON.parse(body);
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      resultReceived = true;
      response.writeHead(204, { "access-control-allow-origin": "*" }).end();
      console.log(`Phase 1C result saved: ${resultPath}`);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain" }).end(error.message);
    }
    return;
  }
  const relative = request.url === "/" ? "index.html" : request.url.slice(1);
  const resolved = path.resolve(demoPath, relative);
  if (!resolved.startsWith(`${demoPath}${path.sep}`)) return response.writeHead(403).end("Forbidden");
  try {
    const body = await readFile(resolved);
    response.writeHead(200, { "content-type": mime[path.extname(resolved)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(4173, "127.0.0.1", () => console.log("Phase 1C fixture listening at http://127.0.0.1:4173/"));

const timeout = setTimeout(() => {
  console.error("Timed out waiting for the Phase 1C extension runner.");
  server.close(() => process.exitCode = 1);
}, 3_600_000);

const poll = setInterval(() => {
  if (!resultReceived) return;
  clearInterval(poll);
  clearTimeout(timeout);
  server.close();
}, 100);
