// Local stand-in for the host: serves the site files from this folder's parent
// and forwards /deaddrop/* to the game wrapper (deploy/play-app/server.mjs),
// which it starts itself with the offline mock guard. No keys, no network.
//
//   node tools/dev-site.mjs            then open http://127.0.0.1:4330
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4330);
const GAME_PORT = 4322;
const STATE = process.env.STATE_DIR || path.join(ROOT, "deploy", "_dev-state");

const game = spawn(process.execPath, ["server.mjs"], {
  cwd: path.join(ROOT, "deploy", "play-app"),
  env: { ...process.env, PORT: String(GAME_PORT), PROVIDER: "mock", INSECURE_COOKIES: "1", STATE_DIR: STATE,
         ALLOWED_ORIGIN: `http://127.0.0.1:${PORT}`, LADDER: process.env.LADDER || "15" },
  stdio: "inherit",
});
process.on("exit", () => { try { game.kill(); } catch {} });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp",
  ".png": "image/png", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/deaddrop" || url.pathname.startsWith("/deaddrop/")) {
    const up = http.request({ host: "127.0.0.1", port: GAME_PORT, path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${GAME_PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`site on http://127.0.0.1:${PORT}  (game on ${GAME_PORT}, state ${STATE})`));
