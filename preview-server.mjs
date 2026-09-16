// Local design preview only. Serves this folder and proxies /api/* to the
// Dead Drop Worker in M:\Projects\Exhume with its offline mock provider.
// No external inference, no accounts, no production bindings. Do not deploy.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import worker from "../../Exhume/worker/index.js";

const root = new URL("./", import.meta.url);
const port = Number(process.env.PREVIEW_PORT || 4322);
const origin = "http://127.0.0.1:" + port;
const env = { PROVIDER: "mock", DAILY_CANDLES: "60", GLOBAL_DAILY_TURNS: "5000" };
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      const result = await worker.fetch(request, env);
      res.writeHead(result.status, { ...headers, "content-type": result.headers.get("content-type") || "application/json" });
      res.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path.includes("..")) { res.writeHead(400, headers); res.end(); return; }
    if (path.startsWith("/curriculum/")) {
      const body = await readFile(new URL("../../Exhume/public" + path, import.meta.url));
      res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" }); res.end(body); return;
    }
    const body = await readFile(new URL("." + path, root));
    res.writeHead(200, { ...headers, "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500, headers);
    res.end(e.code === "ENOENT" ? "Not found" : "Preview error");
  }
});
server.listen(port, "127.0.0.1", () => console.info("Dead Drop preview: " + origin));
