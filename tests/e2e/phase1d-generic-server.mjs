import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const host = "127.0.0.1";
const port = 4174;
const resultPath = join(tmpdir(), "zui-phase1d-generic-result.json");

function corsHeaders(contentType = "text/plain; charset=utf-8") {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "content-type": contentType
  };
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, corsHeaders("application/json; charset=utf-8"));
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === "POST" && request.url === "/__phase1d_generic_result") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        process.stdout.write(`PHASE1D_GENERIC_RESULT_SAVED ${resultPath}\n`);
        response.writeHead(204, corsHeaders());
        response.end();
      } catch (error) {
        response.writeHead(400, corsHeaders("application/json; charset=utf-8"));
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }
  response.writeHead(404, corsHeaders());
  response.end("Not found");
});

server.listen(port, host, () => {
  process.stdout.write(`Phase 1D-G result receiver listening at http://${host}:${port}/; result file ${resultPath}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
