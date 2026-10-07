// index.js — the one Worker. Serves the API (and, on Workers, the client) from one origin.
//
//   GET  /api/levels                        level metadata + campaign theme (never the word, never the hints)
//   GET  /api/me                            cleared levels, locks, doors, allowance
//   POST /api/start  {levelId, restart}     begin or resume an attempt; returns counters + transcript
//   POST /api/turn   {levelId, message}     (history is kept server-side; any sent is ignored)
//   POST /api/hint   {levelId}              one vague hint, costs one exchange
//   POST /api/claim  {levelId, claim}       the reveal on a win
//   GET  /api/state                         candle allowance (legacy)
//
// Identity: the Node server (server.mjs) issues a signed cookie and passes the id
// as x-player-id, the caller's hashed IP as x-client-ip, and x-admin: 1 for Dave's
// test session. Those headers are honoured only behind that server (see who());
// on Workers the body's playerId (or ?playerId= on a GET) is used, and the IP comes
// from Cloudflare's cf-connecting-ip.
// The word is derived server-side (secret.js), never sent, and every claim is
// checked here. Exchanges, guesses, attempts and locks are enforced here too, one
// request at a time per player (lock.js).
// Which campaign is live (the 35 or the 15) comes from env.LADDER; see ladder.js.

import { ladderFor, wordKey } from "./ladder.js";
import { deriveSecret, claimMatches } from "./secret.js";
import { runInputFilters, runOutputFilters, tagTechnique, redact, detectLeak } from "./filters.js";
import { buildGuardPrompt, buildMessages, personaInfo } from "./guard.js";
import { callProvider, providerName } from "./providers.js";
import { getState, spendCandle, refundCandle } from "./candles.js";
import { logAttempt } from "./log.js";
import { buildReveal } from "./reveal.js";
import { serial } from "./lock.js";
import {
  loadPlayer, canEnter, levelView, startAttempt, openAttempt, noteExchange, noteGuess,
  useHint, doors, adaptiveRules, summary, historyFor,
} from "./progress.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function serverKey(env) {
  // A real key comes from a secret. The dev fallback keeps local play working
  // with zero setup; it is NOT for production (set SERVER_KEY there).
  return env.SERVER_KEY || "exhume-dev-key-not-for-production";
}

// The identity headers are set by the Node host (server.mjs), which rebuilds every
// request and drops whatever the browser sent. On Workers nothing sits in front, so
// a browser could send x-admin: 1 itself. Trust the headers only when the Node host
// is in front (it supplies env.STORE) or TRUST_IDENTITY_HEADERS is "1".
function trustsHeaders(env) {
  return env.TRUST_IDENTITY_HEADERS === "1" || !!(env.STORE && typeof env.STORE.get === "function");
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ip:" + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Who is asking. Trusted headers win; otherwise the body (POST) or ?playerId= (GET).
// Without the Node host, the IP for the hourly cap is Cloudflare's cf-connecting-ip
// (set by the edge; a browser cannot supply it to a Worker), hashed.
async function who(request, body, env) {
  const h = request.headers;
  const trusted = trustsHeaders(env);
  const q = new URL(request.url).searchParams.get("playerId");
  const edgeIp = !trusted && h.get("cf-connecting-ip");
  return {
    pid: String((trusted && h.get("x-player-id")) || (body && body.playerId) || q || "anon"),
    ip: (trusted && h.get("x-client-ip")) || (edgeIp ? await hashIp(edgeIp) : ""),
    admin: trusted && h.get("x-admin") === "1",
  };
}

function levelPayload(lad, level) {
  return { ...lad.publicLevel(level), guardName: personaInfo(level).name };
}

// What the player hears when the guard call fails. Nothing is spent (the exchange
// is not counted and the candle is refunded), and the provider's raw error, which
// can carry account ids, stays in the server log.
function providerFailure(e) {
  if (e && e.status === 429) return { status: 503, error: "The guard is at capacity right now. Nothing was spent; try again in a minute.", code: "PROVIDER_BUSY" };
  if (e && e.status === 413) return { status: 413, error: "That message and the conversation so far are too long for the guard to read. Nothing was spent; send something shorter.", code: "PROVIDER_TOO_LARGE" };
  // The provider ran this one, so it counts toward today's model turns; the
  // attempt keeps its exchange.
  if (e && e.billed) return { status: 502, error: "The guard gave an empty answer. This attempt keeps its exchange, but the call counts toward today's model turns. Try again.", code: "PROVIDER_EMPTY" };
  return { status: 502, error: "The gate is silent. The guard did not answer; nothing was spent. Try again.", code: "PROVIDER_ERROR" };
}

async function handleMe(env, id) {
  const { pid, ip, admin } = id;
  const rec = await loadPlayer(env, pid);
  return json({ ...summary(rec, admin), ladder: ladderFor(env).META.id, doors: doors(env, rec, admin), allowance: await getState(env, pid, ip, admin), admin });
}

async function handleStart(env, body, id) {
  const { pid, ip, admin } = id;
  const lad = ladderFor(env);
  const level = lad.getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const rec0 = await loadPlayer(env, pid);
  if (!canEnter(rec0, level, admin)) return json({ error: "That level is still sealed. Clear the one before it first.", code: "SEALED" }, 403);
  const r = await startAttempt(env, pid, level, { restart: !!body.restart, admin });
  return json({
    status: r.status,
    level: levelPayload(lad, level),
    candles: level.candles, digs: level.digs,
    progress: r.view,
    transcript: r.transcript,   // the resumed conversation, as the player saw it
    cleared: r.rec.cleared,
    doors: doors(env, r.rec, admin),
    allowance: await getState(env, pid, ip, admin),
    provider: providerName(env),
  });
}

async function handleTurn(env, body, id) {
  const { pid, ip, admin } = id;
  const lad = ladderFor(env);
  const ladder = lad.META.id;
  const level = lad.getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const message = String(body.message || "");
  if (level.messageCharLimit != null && message.length > level.messageCharLimit) {
    return json({
      error: `This level allows ${level.messageCharLimit.toLocaleString("en-US")} characters per message. Your message was not sent; no exchange was spent.`,
      code: "MESSAGE_TOO_LONG", limit: level.messageCharLimit,
    }, 413);
  }
  if (!message.trim()) return json({ error: "empty message" }, 400);

  const { rec, open } = await openAttempt(env, pid, level);
  if (!open) return json({ error: "Enter the level first.", code: "NO_ATTEMPT" }, 409);
  if (open.msgs >= level.candles) {
    return json({ error: "No exchanges left on this attempt. Guess the word, or restart the level and spend an attempt.", code: "NO_EXCHANGES", progress: levelView(rec, level, admin) }, 409);
  }

  const tags = tagTechnique(message);
  const log = (row) => logAttempt(env, { playerId: pid, ladder, levelId: level.id, channel: level.channel, tags, message, ...row });

  // 1. daily / global / per-IP cost ceiling
  const pre = await getState(env, pid, ip, admin);
  if (pre.closed) {
    await log({ verdict: "closed", candlesLeft: pre.candlesLeft });
    return json({ closed: true, reason: pre.reason, allowance: pre, progress: levelView(rec, level, admin) });
  }

  // 2. input filters. A block does no inference, so it does not spend a candle
  //    from the cost allowance; it still spends an exchange. Only the conversation
  //    the server holds is replayed; nothing the browser sends is.
  const history = historyFor(open, level);
  const inHit = runInputFilters(level, message, history);
  if (inHit) {
    const blocked = { layer: inHit.layer, reason: inHit.reason };
    const view = await noteExchange(env, pid, level, admin, { user: message, blocked });
    await log({ verdict: "blocked", filtersFired: [`${inHit.layer}:${inHit.reason}`], candlesLeft: pre.candlesLeft });
    return json({ blocked: true, layer: inHit.layer, reason: inHit.reason, tags, allowance: pre, progress: view });
  }

  // 3. real inference: charge the cost allowance
  const spend = await spendCandle(env, pid, ip, admin);
  if (!spend.ok) {
    await log({ verdict: "closed", candlesLeft: 0 });
    return json({ closed: true, reason: spend.state.reason, allowance: spend.state, progress: levelView(rec, level, admin) });
  }

  const key = wordKey(serverKey(env), lad);
  const secret = await deriveSecret(key, pid, level.id, open.seed);
  const decoys = [];
  for (let i = 0; i < (level.decoys || 0); i++) {
    decoys.push(await deriveSecret(key, pid, level.id * 100 + i + 1, open.seed));
  }
  const extraRules = level.adaptive ? adaptiveRules(rec) : [];
  const system = buildGuardPrompt(level, secret, { decoys, extraRules });
  const messages = buildMessages(level, history, message);

  const ask = (msgs) => callProvider(env, { system, messages: msgs, secret, level, playerMessage: message });
  let raw, err = null;
  try {
    raw = await ask(messages);
  } catch (e) {
    err = e;
    // Over the provider's per-request token cap: once more without the replayed
    // history, so a long conversation cannot wedge the attempt.
    if (e && e.status === 413 && history.length) {
      try { raw = await ask(buildMessages(level, [], message)); err = null; } catch (e2) { err = e2; }
    }
  }
  if (err) {
    // The exchange is never spent on a failed turn. The candle is refunded only if
    // the provider did no work (rate limit, too large, network, timeout); a
    // completion it ran and billed (an empty reply) still counts against the caps.
    const allowance = err.billed ? spend.state : await refundCandle(env, pid, ip, admin);
    await log({ verdict: "error", candlesLeft: allowance.candlesLeft, response: String(err) });
    const f = providerFailure(err);
    return json({ error: f.error, code: f.code, allowance, progress: levelView(rec, level, admin) }, f.status);
  }

  // 4. output filters. "leak" means the player can read the word in what they were
  //    shown; "blocked" means a filter fired and nothing readable got through.
  const outHit = runOutputFilters(level, raw, secret);
  const shown = outHit ? redact(level, raw, secret, lad.META.theme.stitched) : raw;
  const verdict = detectLeak(shown, secret) ? "leak" : outHit ? "blocked" : "miss";
  const filtered = outHit ? { layer: outHit.layer, reason: outHit.reason } : null;
  const view = await noteExchange(env, pid, level, admin, { user: message, assistant: shown, filtered });

  await log({
    verdict, filtersFired: outHit ? [`${outHit.layer}:${outHit.reason}`] : [],
    candlesLeft: spend.state.candlesLeft, response: raw,
  });

  return json({ reply: shown, filtered, tags, allowance: spend.state, progress: view });
}

async function handleHint(env, body, id) {
  const { pid, admin } = id;
  const level = ladderFor(env).getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const r = await useHint(env, pid, level, admin);
  if (r.error) return json({ error: r.error, code: "NO_HINT" }, 409);
  return json({ hint: r.hint, index: r.index, progress: r.view });
}

// The message that won: the latest turn whose shown reply let the player read the
// word, else the latest answered turn. Taken from the server's transcript, so the
// reveal and the adaptive boss learn from what actually happened, not from what
// the browser reports.
function winningTurn(open, secret) {
  const answered = (open.turns || []).filter((t) => t.assistant != null).reverse();
  return answered.find((t) => detectLeak(t.assistant, secret)) || answered[0] || null;
}

async function handleClaim(env, body, id) {
  const { pid, admin } = id;
  const lad = ladderFor(env);
  const level = lad.getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const { rec, open } = await openAttempt(env, pid, level);
  if (!open) return json({ error: "Enter the level first.", code: "NO_ATTEMPT" }, 409);
  if (open.guesses >= level.digs) return json({ error: "No guesses left on this attempt.", code: "NO_GUESSES", progress: levelView(rec, level, admin) }, 409);

  const secret = await deriveSecret(wordKey(serverKey(env), lad), pid, level.id, open.seed);
  const win = claimMatches(body.claim || "", secret);
  const won = win ? winningTurn(open, secret) : null;
  const winningMessage = won ? won.user : "";
  const tags = tagTechnique(winningMessage);

  await logAttempt(env, {
    playerId: pid, ladder: lad.META.id, levelId: level.id, channel: level.channel,
    verdict: win ? "claimed" : "miss", tags: ["claim"], candlesLeft: null,
    message: `CLAIM: ${body.claim || ""}`,
  });

  const r = await noteGuess(env, pid, level, { win, tags, admin, claim: body.claim || "" });
  if (!win) {
    return json({ win: false, attemptFailed: r.attemptFailed, progress: r.view });
  }
  return json({
    win: true,
    reveal: buildReveal(level, secret, winningMessage, lad.META.theme),
    progress: r.view,
    cleared: r.rec.cleared,
    doors: doors(env, r.rec, admin),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      try {
        if (path === "/api/levels" && request.method === "GET") {
          const lad = ladderFor(env);
          return json({
            ladder: lad.META.id, total: lad.META.total, theme: lad.META.theme, doors: lad.META.doors,
            levels: lad.LEVELS.map((l) => levelPayload(lad, l)),
          });
        }
        if (request.method === "GET" && (path === "/api/me" || path === "/api/state")) {
          const id = await who(request, {}, env);
          if (path === "/api/me") return await handleMe(env, id);
          return json(await getState(env, id.pid, id.ip, id.admin));
        }
        if (request.method === "POST") {
          const handler = {
            "/api/start": handleStart, "/api/turn": handleTurn,
            "/api/hint": handleHint, "/api/claim": handleClaim,
          }[path];
          if (handler) {
            const body = await readBody(request);
            const id = await who(request, body, env);
            // One request at a time per player: every handler checks a counter,
            // awaits, then writes it back.
            return await serial("player:" + id.pid, () => handler(env, body, id));
          }
        }
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: "worker error", detail: String(e) }, 500);
      }
    }

    // static client
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("client assets not bound", { status: 500 });
  },
};
