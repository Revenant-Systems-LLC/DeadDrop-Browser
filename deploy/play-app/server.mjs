// Dead Drop game server for cPanel "Setup Node.js App" (Passenger).
// Wraps the Cloudflare-style Worker in worker/ as a plain Node HTTP server.
// Needs Node 22 or newer (node:sqlite). No npm packages.
//
// Environment variables (set them in the cPanel Node.js App panel):
//   SERVER_KEY          long random string; keys the secret words and signs cookies.
//                       If unset, generated once into ~/.deaddrop/server-key.
//   ALLOWED_ORIGIN      the site(s) that may call this API, comma separated.
//   PROVIDER            mock | groq | google   (default mock; the offline scripted guard)
//   GROQ_API_KEY / GOOGLE_API_KEY   only if PROVIDER is groq or google
//   DAILY_CANDLES       model turns per player per day (default 300)
//   GLOBAL_DAILY_TURNS  model turns per day across everyone (default 5000)
//   IP_HOURLY_TURNS     model turns per IP per hour (default 120)
//   LOCK_HOURS          how long a level locks after the last failed attempt (default 24)
//   CLUB_INVITE_URL     a standing Discord invite for players who clear level 10 (fallback)
//   DISCORD_BOT_TOKEN   with DISCORD_CHANNEL_ID: mint a single-use, one-day invite per player
//                       instead of a shareable link. The bot only needs "Create Instant Invite".
//   APPLY_TO            where level-35 applications are mailed (default dave@revenantsystems.net)
//   APPLY_FROM          the From address on those mails (default deaddrop@<domain of APPLY_TO>)
//   SENDMAIL_PATH       sendmail binary (default /usr/sbin/sendmail); a .mjs path runs under node (tests)
//   LADDER              which campaign is live: 15 (default, the fantasy recut) or 35 (the crypt)
//   APPLY_URL           where the résumé door leads once earned (optional)
//   ADMIN_TOKEN         if set, GET /admin?token=<it> marks this browser as the tester:
//                       no locks, no caps, every door open. Never share it.
//   STATE_DIR           where state lives (default ~/.deaddrop)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import worker from "./worker/index.js";
import { loadPlayer, savePlayer, doors as playerDoors } from "./worker/progress.js";
import { getStore } from "./worker/store.js";
import { ladderFor } from "./worker/ladder.js";

const port = Number(process.env.PORT || 4322);
// The app is mounted under this path on the main domain (cPanel "Application URL").
// Requests may arrive with or without the prefix depending on the host, so both work.
const basePath = (process.env.BASE_PATH || "/deaddrop").replace(/\/+$/, "");
const allowed = (process.env.ALLOWED_ORIGIN || "https://www.revenantsystems.net,https://revenantsystems.net")
  .split(",").map((s) => s.trim()).filter(Boolean);
const stateDir = process.env.STATE_DIR || path.join(os.homedir(), ".deaddrop");
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

// ---------------------------------------------------------------- server key
// Never typed by a person: SERVER_KEY from the environment if set, otherwise a
// random key generated on first start and kept outside every web root.
function loadServerKey() {
  if (process.env.SERVER_KEY) return process.env.SERVER_KEY;
  const file = path.join(stateDir, "server-key");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, key, { mode: 0o600 });
  console.info("Generated a new server key at " + file);
  return key;
}
const serverKey = loadServerKey();

// ---------------------------------------------------------------- state store
// SQLite when node:sqlite is available (multi-process safe), else a JSON file.
async function openStore() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(stateDir, "state.sqlite"));
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, exp INTEGER)");
    const getQ = db.prepare("SELECT value, exp FROM kv WHERE key = ?");
    const setQ = db.prepare("INSERT INTO kv (key, value, exp) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, exp = excluded.exp");
    const delQ = db.prepare("DELETE FROM kv WHERE key = ?");
    const sweepQ = db.prepare("DELETE FROM kv WHERE exp IS NOT NULL AND exp < ?");
    setInterval(() => { try { sweepQ.run(Date.now()); } catch {} }, 600000).unref();
    return {
      kind: "sqlite",
      async get(key) {
        const row = getQ.get(key);
        if (!row) return null;
        if (row.exp && Date.now() > row.exp) { delQ.run(key); return null; }
        try { return JSON.parse(row.value); } catch { return null; }
      },
      async set(key, value, ttlSeconds) { setQ.run(key, JSON.stringify(value), ttlSeconds ? Date.now() + ttlSeconds * 1000 : null); },
      async del(key) { delQ.run(key); },
    };
  } catch (e) {
    console.warn("node:sqlite unavailable (" + String(e).slice(0, 80) + "); using a JSON file store");
    const file = path.join(stateDir, "state.json");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    let timer = null;
    const flush = () => {
      timer = null;
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, file);
    };
    const schedule = () => { if (!timer) timer = setTimeout(flush, 50); };
    return {
      kind: "json",
      async get(key) {
        const e = data[key];
        if (!e) return null;
        if (e.exp && Date.now() > e.exp) { delete data[key]; schedule(); return null; }
        return JSON.parse(e.v);
      },
      async set(key, value, ttlSeconds) { data[key] = { v: JSON.stringify(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 }; schedule(); },
      async del(key) { delete data[key]; schedule(); },
    };
  }
}
const STORE = await openStore();

const env = {
  // Which campaign is live: "15" (the fantasy recut) or "35" (the crypt). 15 by
  // Dave's direction, 2026-10-07; set LADDER=35 in the cPanel app to roll back.
  LADDER: process.env.LADDER || "15",
  APPLY_URL: process.env.APPLY_URL || "",
  PROVIDER: process.env.PROVIDER || "mock",
  DAILY_CANDLES: process.env.DAILY_CANDLES || "300",
  GLOBAL_DAILY_TURNS: process.env.GLOBAL_DAILY_TURNS || "5000",
  IP_HOURLY_TURNS: process.env.IP_HOURLY_TURNS || "120",
  LOCK_HOURS: process.env.LOCK_HOURS || "24",
  CLUB_INVITE_URL: process.env.CLUB_INVITE_URL || "",
  SERVER_KEY: serverKey,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  STORE,
};

const APPLY_TO = process.env.APPLY_TO || "dave@revenantsystems.net";
const APPLY_FROM = process.env.APPLY_FROM || ("deaddrop@" + APPLY_TO.split("@")[1]);
const SENDMAIL = process.env.SENDMAIL_PATH || "/usr/sbin/sendmail";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DISCORD = {
  token: process.env.DISCORD_BOT_TOKEN || "",
  channel: process.env.DISCORD_CHANNEL_ID || "",
  api: (process.env.DISCORD_API || "https://discord.com/api/v10").replace(/\/+$/, ""),
};
const insecureCookies = process.env.INSECURE_COOKIES === "1";   // local http tests only
// The level numbers the doors sit on come from the live ladder (worker/levels*.js META.doors).
const DOORS = ladderFor(env).META.doors;

// ---------------------------------------------------------------- identity
function sign(id) { return crypto.createHmac("sha256", serverKey).update("pid:" + id).digest("hex").slice(0, 32); }
function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function cookieAttrs(maxAge) {
  return `Path=${basePath || "/"}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (insecureCookies ? "" : "; Secure");
}
function identify(req) {
  const c = parseCookies(req.headers.cookie);
  let pid = null, setCookie = null;
  const raw = c.dd_pid || "";
  const dot = raw.indexOf(".");
  if (dot === 32 && /^[0-9a-f]{32}$/.test(raw.slice(0, 32))) {
    const id = raw.slice(0, 32), sig = raw.slice(33);
    const want = sign(id);
    if (sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) pid = id;
  }
  if (!pid) {
    pid = crypto.randomBytes(16).toString("hex");
    setCookie = `dd_pid=${pid}.${sign(pid)}; ${cookieAttrs(31536000)}`;
  }
  let admin = false;
  if (ADMIN_TOKEN && c.dd_admin) {
    const a = Buffer.from(c.dd_admin), b = Buffer.from(ADMIN_TOKEN);
    admin = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = xff || req.socket.remoteAddress || "";
  const ipKey = crypto.createHash("sha256").update(serverKey + "|" + ip).digest("hex").slice(0, 16);
  return { pid, setCookie, admin, ipKey, ip };
}

function cors(origin) {
  const ok = origin && allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0],
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

async function readAll(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) return null; chunks.push(c); }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- multipart
// A small, strict multipart/form-data reader. Returns {fields, files} or null.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return null;
  const boundary = Buffer.from("--" + (m[1] || m[2]).trim());
  const fields = {}, files = [];
  let pos = buf.indexOf(boundary);
  if (pos < 0) return null;
  pos += boundary.length;
  while (pos < buf.length) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;           // closing "--"
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
    const headEnd = buf.indexOf("\r\n\r\n", pos);
    if (headEnd < 0) return null;
    const head = buf.slice(pos, headEnd).toString("utf8");
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next < 0) return null;
    let body = buf.slice(headEnd + 4, next);
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.slice(0, -2);
    const name = /name="([^"]*)"/i.exec(head)?.[1] || "";
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() || "application/octet-stream";
    if (filename !== undefined) files.push({ name, filename, type, data: body });
    else fields[name] = body.toString("utf8");
    pos = next + boundary.length;
  }
  return { fields, files };
}

// ---------------------------------------------------------------- mail
function sendMail({ to, from, replyTo, subject, text, attachment }) {
  return new Promise((resolve, reject) => {
    const b = "=_dd_" + crypto.randomBytes(12).toString("hex");
    const lines = [
      `From: Dead Drop <${from}>`, `To: ${to}`,
      replyTo ? `Reply-To: ${replyTo}` : null,
      `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${b}"`,
      "", `--${b}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", text, "",
    ].filter((l) => l !== null);
    if (attachment) {
      lines.push(`--${b}`, `Content-Type: ${attachment.type}; name="${attachment.filename}"`, "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${attachment.filename}"`, "", attachment.data.toString("base64").replace(/(.{76})/g, "$1\r\n"), "");
    }
    lines.push(`--${b}--`, "");
    const msg = lines.join("\r\n");
    const isScript = /\.m?js$/i.test(SENDMAIL);
    const child = isScript ? spawn(process.execPath, [SENDMAIL, "-t", "-i"]) : spawn(SENDMAIL, ["-t", "-i"]);
    let err = "";
    child.on("error", reject);
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`sendmail exit ${code} ${err.slice(0, 200)}`))));
    child.stdin.end(msg);
  });
}

// ---------------------------------------------------------------- club (level 10)
// One invite per player, single use, valid a day. Re-minted after it expires.
async function mintInvite() {
  const r = await fetch(`${DISCORD.api}/channels/${DISCORD.channel}/invites`, {
    method: "POST",
    headers: { authorization: `Bot ${DISCORD.token}`, "content-type": "application/json", "user-agent": "DeadDrop (https://www.revenantsystems.net, 1.0)" },
    body: JSON.stringify({ max_uses: 1, max_age: 86400, unique: true }),
  });
  if (!r.ok) throw new Error(`discord ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!j.code) throw new Error("discord: no invite code in response");
  return "https://discord.gg/" + j.code;
}

async function handleClub(req, res, headers, id) {
  const rec = await loadPlayer(env, id.pid);
  if (playerDoors(env, rec, id.admin).club === null) return send(res, 403, headers, { error: `This door opens after level ${DOORS.club}.` });
  if (!DISCORD.token || !DISCORD.channel) {
    return send(res, 200, headers, { url: env.CLUB_INVITE_URL || null, minted: false });
  }
  const fresh = rec.clubInvite && Date.now() - Date.parse(rec.clubInvite.ts) < 23 * 3600 * 1000;
  if (fresh) return send(res, 200, headers, { url: rec.clubInvite.url, minted: true });
  try {
    const url = await mintInvite();
    rec.clubInvite = { url, ts: new Date().toISOString() };
    await savePlayer(env, id.pid, rec);
    return send(res, 200, headers, { url, minted: true });
  } catch (e) {
    console.error("club invite failed: " + String(e));
    return send(res, 200, headers, { url: env.CLUB_INVITE_URL || null, minted: false, error: "The invite could not be minted right now. Try again in a minute." });
  }
}

// ---------------------------------------------------------------- apply (level 35)
const RESUME_TYPES = { ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".md": "text/markdown", ".rtf": "application/rtf" };
const day = () => new Date().toISOString().slice(0, 10);

async function handleApply(req, res, headers, id) {
  const buf = await readAll(req, 6 * 1024 * 1024);
  if (!buf) return send(res, 413, headers, { error: "The file is too large. Five megabytes is the limit." });
  const form = parseMultipart(buf, req.headers["content-type"]);
  if (!form) return send(res, 400, headers, { error: "Could not read the form." });
  const f = form.fields;
  if ((f.website || "").trim()) return send(res, 200, headers, { ok: true });   // honeypot: pretend
  const name = String(f.name || "").trim().slice(0, 120);
  const email = String(f.email || "").trim().slice(0, 200);
  const note = String(f.note || "").trim().slice(0, 3000);
  if (name.length < 2) return send(res, 400, headers, { error: "Your name is missing." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, headers, { error: "That email address does not look right." });

  const rec = await loadPlayer(env, id.pid);
  if (!playerDoors(env, rec, id.admin).apply) return send(res, 403, headers, { error: `This door opens only after level ${DOORS.apply}.` });

  const perPlayer = Number((await STORE.get(`apply:${id.pid}:${day()}`)) || 0);
  const perIp = Number((await STORE.get(`applyip:${id.ipKey}:${day()}`)) || 0);
  if (perPlayer >= 3 || perIp >= 10) return send(res, 429, headers, { error: "Enough for today. The founder has what you sent." });

  let attachment = null;
  const file = form.files.find((x) => x.name === "resume" && x.data.length);
  if (file) {
    const ext = path.extname(file.filename || "").toLowerCase();
    if (!RESUME_TYPES[ext]) return send(res, 400, headers, { error: "Résumé must be a PDF, Word document, text or markdown file." });
    if (file.data.length > 5 * 1024 * 1024) return send(res, 413, headers, { error: "The file is too large. Five megabytes is the limit." });
    if (ext === ".pdf" && file.data.slice(0, 4).toString() !== "%PDF") return send(res, 400, headers, { error: "That file is not a PDF." });
    if (ext === ".docx" && file.data.slice(0, 2).toString() !== "PK") return send(res, 400, headers, { error: "That file is not a Word document." });
    const safe = (path.basename(file.filename).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "resume") ;
    attachment = { filename: safe.endsWith(ext) ? safe : safe + ext, type: RESUME_TYPES[ext], data: file.data };
  }

  // Save first, so nothing is lost if mail fails; then mail.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const dir = path.join(stateDir, "applications", `${stamp}-${id.pid.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = { ts: new Date().toISOString(), name, email, note, player: id.pid, cleared: rec.cleared, admin: id.admin, resume: attachment ? attachment.filename : null };
  fs.writeFileSync(path.join(dir, "application.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  if (attachment) fs.writeFileSync(path.join(dir, attachment.filename), attachment.data, { mode: 0o600 });

  await STORE.set(`apply:${id.pid}:${day()}`, perPlayer + 1, 90000);
  await STORE.set(`applyip:${id.ipKey}:${day()}`, perIp + 1, 90000);

  const text = [
    `Dead Drop: level ${DOORS.apply} cleared${id.admin ? " (ADMIN TEST SESSION)" : ""}.`, "",
    `Name:   ${name}`, `Email:  ${email}`, `Player: ${id.pid}`, `Cleared: ${rec.cleared.join(", ") || "(none recorded)"}`, "",
    "Note from the applicant:", note || "(none)", "",
    `Résumé: ${attachment ? attachment.filename + " (attached)" : "not attached"}`,
    `Saved copy on the server: ${dir}`,
  ].join("\n");
  let mailed = false;
  try {
    await sendMail({ to: APPLY_TO, from: APPLY_FROM, replyTo: email, subject: `[Dead Drop] Level ${DOORS.apply} cleared: application from ${name}`, text, attachment });
    mailed = true;
  } catch (e) {
    console.error("application mail failed: " + String(e));
    try { fs.writeFileSync(path.join(dir, "MAIL-FAILED.txt"), String(e)); } catch {}
  }
  return send(res, 200, headers, { ok: true, mailed });
}

function send(res, status, headers, obj) {
  res.writeHead(status, { ...headers, "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------- server
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
      res.end(`Dead Drop API is up. Ladder: ${ladderFor(env).META.id}. Provider: ${env.PROVIDER}. Store: ${STORE.kind}. Club invites: ${DISCORD.token && DISCORD.channel ? "minted" : env.CLUB_INVITE_URL ? "static link" : "not configured"}.
`); return;
    }
    if (url.pathname === "/admin" && req.method === "GET") {
      const t = url.searchParams.get("token") || "";
      const ok = ADMIN_TOKEN && t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
      if (!ok) { res.writeHead(404, headers); res.end("Not found"); return; }
      res.writeHead(302, { ...headers, "set-cookie": `dd_admin=${ADMIN_TOKEN}; ${cookieAttrs(2592000)}`, location: "/" });
      res.end(); return;
    }
    if (!url.pathname.startsWith("/api/")) { res.writeHead(404, headers); res.end("Not found"); return; }
    if (!["GET", "POST"].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }

    const id = identify(req);
    if (id.setCookie) headers["set-cookie"] = id.setCookie;

    if (url.pathname === "/api/apply" && req.method === "POST") return handleApply(req, res, headers, id);
    if (url.pathname === "/api/club" && req.method === "POST") return handleClub(req, res, headers, id);

    const body = req.method === "POST" ? await readAll(req, 131072) : undefined;
    if (body === null) { res.writeHead(413, headers); res.end("Request too large"); return; }
    const request = new Request(url, {
      method: req.method,
      headers: { "content-type": "application/json", "x-player-id": id.pid, "x-client-ip": id.ipKey, "x-admin": id.admin ? "1" : "0" },
      body,
    });
    const result = await worker.fetch(request, env);
    res.writeHead(result.status, { ...headers, "content-type": result.headers.get("content-type") || "application/json" });
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (e) {
    console.error(e);
    send(res, 500, headers, { error: "The crypt is unavailable. Try again." });
  }
});
server.requestTimeout = 25000;
server.listen(port, () => console.info(`Dead Drop API listening on ${port} (store: ${STORE.kind}, provider: ${env.PROVIDER})`));
