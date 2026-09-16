// index.js — the one Worker. Serves the client and the API from one origin.
//
//   GET  /api/levels                     list level metadata (never the word)
//   POST /api/start   {playerId, levelId} begin/reset a level; returns candle state
//   POST /api/turn    {playerId, levelId, message, history}
//   POST /api/claim   {playerId, levelId, claim}   returns the reveal on a win
//   GET  /api/state   ?playerId=          candle allowance + spend ledger
//
// The word is derived server-side (secret.js), never sent, and every claim is
// checked here. Per-level candles/digs are client-paced; the cost cap (daily
// allowance + global ceiling) and claim correctness are enforced server-side.

import { LEVELS, getLevel, publicLevel } from "./levels.js";
import { deriveSecret, claimMatches } from "./secret.js";
import { runInputFilters, runOutputFilters, tagTechnique } from "./filters.js";
import { buildGuardPrompt, buildMessages } from "./guard.js";
import { callProvider, providerName } from "./providers.js";
import { getState, spendCandle } from "./candles.js";
import { logAttempt } from "./log.js";
import { buildReveal } from "./reveal.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function serverKey(env) {
  // A real key comes from a Worker secret. The dev fallback keeps local play
  // working with zero setup; it is NOT for production (set SERVER_KEY there).
  return env.SERVER_KEY || "exhume-dev-key-not-for-production";
}

function maskLeak(reply, secret) {
  const marker = "▒▒▒▒"; // ▒▒▒▒
  let out = reply;
  const s = secret;
  const forms = [
    s, s.split("").reverse().join(""),
    s.replace(/a/gi, "4").replace(/e/gi, "3").replace(/i/gi, "1").replace(/o/gi, "0").replace(/s/gi, "5").replace(/t/gi, "7"),
  ];
  for (const f of forms) {
    if (f.length >= 3) out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), marker);
  }
  // If the word is still recoverable from the letters (scatter), stitch it shut.
  if (out.toLowerCase().replace(/[^a-z0-9]/g, "").includes(s.toLowerCase())) {
    return "The Gravekeeper starts to speak, but Sewn Lips draws the thread tight. The reply is stitched shut.";
  }
  return out;
}

async function handleStart(env, body) {
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const state = await getState(env, body.playerId || "anon");
  return json({
    level: publicLevel(level),
    candles: level.candles, digs: level.digs,
    allowance: state,
    provider: providerName(env),
  });
}

async function handleTurn(env, body) {
  const playerId = body.playerId || "anon";
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const message = String(body.message || "");
  if (level.messageCharLimit != null && message.length > level.messageCharLimit) {
    return json({
      error: `This crypt allows ${level.messageCharLimit.toLocaleString("en-US")} characters per message. Your message was not sent or shortened; no candle was spent.`,
      code: "MESSAGE_TOO_LONG", limit: level.messageCharLimit,
    }, 413);
  }
  if (!message.trim()) return json({ error: "empty message" }, 400);

  const tags = tagTechnique(message);

  // 1. daily / global cost ceiling
  const pre = await getState(env, playerId);
  if (pre.closed) {
    await logAttempt(env, { playerId, levelId: level.id, channel: level.channel, verdict: "closed", tags, candlesLeft: pre.candlesLeft, message });
    return json({ closed: true, reason: pre.reason, allowance: pre });
  }

  // 2. input filters (the Salt Line). A block does no inference, so it does not
  //    spend a candle from the cost allowance; it still costs a level candle
  //    (the client counts that down).
  const inHit = runInputFilters(level, message, Array.isArray(body.history) ? body.history : []);
  if (inHit) {
    await logAttempt(env, { playerId, levelId: level.id, channel: level.channel, verdict: "blocked", filtersFired: [`${inHit.layer}:${inHit.reason}`], tags, candlesLeft: pre.candlesLeft, message });
    return json({
      blocked: true, layer: inHit.layer, reason: inHit.reason,
      tags, allowance: pre,
    });
  }

  // 3. real inference: charge the cost allowance
  const spend = await spendCandle(env, playerId);
  if (!spend.ok) {
    await logAttempt(env, { playerId, levelId: level.id, channel: level.channel, verdict: "closed", tags, candlesLeft: 0, message });
    return json({ closed: true, reason: spend.state.reason, allowance: spend.state });
  }

  const secret = await deriveSecret(serverKey(env), playerId, level.id);
  const decoys = [];
  for (let i = 0; i < (level.decoys || 0); i++) {
    decoys.push(await deriveSecret(serverKey(env), playerId, level.id * 100 + i + 1));
  }
  const system = buildGuardPrompt(level, secret, { decoys });
  const messages = buildMessages(level, Array.isArray(body.history) ? body.history : [], message);

  let raw;
  try {
    raw = await callProvider(env, { system, messages, secret, level, playerMessage: message });
  } catch (e) {
    await logAttempt(env, { playerId, levelId: level.id, channel: level.channel, verdict: "error", tags, candlesLeft: spend.state.candlesLeft, message, response: String(e) });
    return json({ error: "the gate is silent (guard error)", detail: String(e), allowance: spend.state }, 502);
  }

  // 4. output filters (Sewn Lips)
  const outHit = runOutputFilters(level, raw, secret);
  const shown = outHit ? maskLeak(raw, secret) : raw;
  const verdict = outHit ? "blocked" : (raw.toLowerCase().replace(/[^a-z0-9]/g, "").includes(secret.toLowerCase()) ? "leak" : "miss");

  await logAttempt(env, {
    playerId, levelId: level.id, channel: level.channel, verdict,
    filtersFired: outHit ? [`${outHit.layer}:${outHit.reason}`] : [],
    tags, candlesLeft: spend.state.candlesLeft, message, response: raw,
  });

  return json({
    reply: shown,
    filtered: outHit ? { layer: outHit.layer, reason: outHit.reason } : null,
    tags,
    allowance: spend.state,
  });
}

async function handleClaim(env, body) {
  const playerId = body.playerId || "anon";
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const secret = await deriveSecret(serverKey(env), playerId, level.id);
  const win = claimMatches(body.claim || "", secret);

  await logAttempt(env, {
    playerId, levelId: level.id, channel: level.channel,
    verdict: win ? "claimed" : "miss", tags: ["claim"], candlesLeft: null,
    message: `CLAIM: ${body.claim || ""}`,
  });

  if (!win) return json({ win: false });
  return json({ win: true, reveal: buildReveal(level, secret, body.winningMessage || "") });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      try {
        if (path === "/api/levels" && request.method === "GET") {
          return json({ levels: LEVELS.map(publicLevel) });
        }
        if (path === "/api/state" && request.method === "GET") {
          return json(await getState(env, url.searchParams.get("playerId") || "anon"));
        }
        if (path === "/api/start" && request.method === "POST") return handleStart(env, await readBody(request));
        if (path === "/api/turn" && request.method === "POST") return handleTurn(env, await readBody(request));
        if (path === "/api/claim" && request.method === "POST") return handleClaim(env, await readBody(request));
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
