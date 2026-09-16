// log.js — structured record of every attempt, so the transcripts can become
// research data (Study 4). Writes to D1 (binding EXHUME_DB) when present, else
// emits one JSON line to the console, which `wrangler tail` / local dev shows.
//
// The player id is hashed before it is written. No raw handle is stored.

async function hashId(id) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(id)));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function logAttempt(env, row) {
  const rec = {
    ts: new Date().toISOString(),
    player: await hashId(row.playerId),
    level: row.levelId,
    channel: row.channel,
    verdict: row.verdict,            // "leak" | "blocked" | "claimed" | "miss" | "closed" | "error"
    filters: row.filtersFired || [], // e.g. ["I2:persona opener"]
    tags: row.tags || [],
    candles_left: row.candlesLeft,
    message: row.message || "",
    response: row.response || "",
  };

  if (env.EXHUME_DB) {
    try {
      await env.EXHUME_DB.prepare(
        `INSERT INTO attempts (ts, player, level, channel, verdict, filters, tags, candles_left, message, response)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        rec.ts, rec.player, rec.level, rec.channel, rec.verdict,
        JSON.stringify(rec.filters), JSON.stringify(rec.tags),
        rec.candles_left, rec.message, rec.response
      ).run();
      return;
    } catch (e) {
      console.log(JSON.stringify({ ...rec, _dberr: String(e) }));
      return;
    }
  }
  console.log(JSON.stringify(rec));
}
