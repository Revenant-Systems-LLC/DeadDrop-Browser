// candles.js — the cost cap, in two layers.
//
//   Per player, per day: DAILY_CANDLES turns. When spent, the player waits for
//                        midnight (UTC). This is the "candle allowance."
//   Global, per day:     GLOBAL_DAILY_TURNS across everyone. When hit, the crypt
//                        closes for all until midnight and says so honestly.
//
// Backed by a KV namespace (binding EXHUME_KV) when present, else an in-memory
// Map so `wrangler dev` runs with zero setup. In-memory counts reset on reload;
// that is fine for local play and never ships as the production store.

import { COST_PER_TURN_USD } from "./providers.js";

const mem = new Map(); // dev fallback

async function kvGet(env, key) {
  if (env.EXHUME_KV) {
    const v = await env.EXHUME_KV.get(key);
    return v == null ? 0 : Number(v);
  }
  return mem.get(key) || 0;
}
async function kvSet(env, key, val, ttlSeconds) {
  if (env.EXHUME_KV) {
    await env.EXHUME_KV.put(key, String(val), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  } else {
    mem.set(key, val);
  }
}

function day() {
  return new Date().toISOString().slice(0, 10);
}
function limits(env) {
  return {
    daily: Number(env.DAILY_CANDLES || 60),
    global: Number(env.GLOBAL_DAILY_TURNS || 5000),
  };
}
// seconds until the next UTC midnight, for KV TTL
function ttlToMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60, Math.ceil((next - now) / 1000));
}

export async function getState(env, playerId) {
  const d = day();
  const { daily, global } = limits(env);
  const dailyUsed = await kvGet(env, `cand:${playerId}:${d}`);
  const globalUsed = await kvGet(env, `global:${d}`);
  const globalClosed = globalUsed >= global;
  const playerClosed = dailyUsed >= daily;
  return {
    dailyUsed, dailyLimit: daily, candlesLeft: Math.max(0, daily - dailyUsed),
    globalUsed, globalLimit: global,
    estSpendUsd: +(globalUsed * COST_PER_TURN_USD).toFixed(4),
    closed: globalClosed || playerClosed,
    reason: globalClosed
      ? "The crypt is sealed for the night. The global candle store is spent; it returns at midnight (UTC)."
      : playerClosed
        ? "Your candles are spent for the day. They return at midnight (UTC)."
        : null,
  };
}

// Try to spend one candle for a turn. Returns {ok, state}. On !ok, state.reason
// explains which ceiling closed the door.
export async function spendCandle(env, playerId) {
  const pre = await getState(env, playerId);
  if (pre.closed) return { ok: false, state: pre };

  const d = day();
  const ttl = ttlToMidnight();
  await kvSet(env, `cand:${playerId}:${d}`, pre.dailyUsed + 1, ttl);
  await kvSet(env, `global:${d}`, pre.globalUsed + 1, ttl);
  const post = await getState(env, playerId);
  return { ok: true, state: post };
}
