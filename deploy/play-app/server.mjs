// Dead Drop game server for cPanel "Setup Node.js App" (Passenger).
// Wraps the Cloudflare-style Worker in worker/ as a plain Node HTTP server.
// Needs Node 18 or newer. No npm packages.
//
// Environment variables (set them in the cPanel Node.js App panel):
//   SERVER_KEY          long random string; keys the secret words. REQUIRED for a real deployment.
//   ALLOWED_ORIGIN      the site that may call this API. Default: https://www.revenantsystems.net
//   PROVIDER            mock | groq | google   (default mock; the offline scripted guard)
//   GROQ_API_KEY / GOOGLE_API_KEY   only if PROVIDER is groq or google
//   DAILY_CANDLES       turns per player per day (default 60)
//   GLOBAL_DAILY_TURNS  turns per day across everyone (default 5000)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import worker from "./worker/index.js";

const port = Number(process.env.PORT || 4322);
// The app is mounted under this path on the main domain (cPanel "Application URL").
// Requests may arrive with or without the prefix depending on the host, so both work.
const basePath = (process.env.BASE_PATH || "/deaddrop").replace(/\/+$/, "");
const allowed = (process.env.ALLOWED_ORIGIN || "https://www.revenantsystems.net,https://revenantsystems.net")
  .split(",").map((s) => s.trim()).filter(Boolean);

// The secret key that derives every crypt's word. Never typed by a person:
// SERVER_KEY from the environment if set, otherwise a random key generated on
// first start and kept in the account's home folder, outside every web root.
function loadServerKey() {
  if (process.env.SERVER_KEY) return process.env.SERVER_KEY;
  const dir = path.join(os.homedir(), ".deaddrop");
  const file = path.join(dir, "server-key");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  const key = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, key, { mode: 0o600 });
  console.info("Generated a new server key at " + file);
  return key;
}

const env = {
  PROVIDER: process.env.PROVIDER || "mock",
  DAILY_CANDLES: process.env.DAILY_CANDLES || "60",
  GLOBAL_DAILY_TURNS: process.env.GLOBAL_DAILY_TURNS || "5000",
  SERVER_KEY: loadServerKey(),
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
};

function cors(origin) {
  const ok = origin && allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0],
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

const server = http.createServer(async (req, res) => {
  const headers = cors(req.headers.origin);
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    if (basePath && (url.pathname === basePath || url.pathname.startsWith(basePath + "/"))) {
      url.pathname = url.pathname.slice(basePath.length) || "/";
    }
    if (req.method === "OPTIONS") { res.writeHead(204, headers); res.end(); return; }
    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { ...headers, "content-type": "text/plain; charset=utf-8" });
      res.end("Dead Drop API is up. Provider: " + env.PROVIDER + "\n"); return;
    }
    if (!url.pathname.startsWith("/api/")) { res.writeHead(404, headers); res.end("Not found"); return; }
    if (!["GET", "POST"].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 131072) { res.writeHead(413, headers); res.end("Request too large"); return; } chunks.push(c); }
    const request = new Request(url, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
    });
    const result = await worker.fetch(request, env);
    res.writeHead(result.status, { ...headers, "content-type": result.headers.get("content-type") || "application/json" });
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "The crypt is unavailable. Try again." }));
  }
});
server.requestTimeout = 25000;
server.listen(port, () => console.info("Dead Drop API listening on " + port));
