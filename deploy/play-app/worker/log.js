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
    ladder: row.ladder || "35",      // level ids mean different levels on each ladder
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
    const tail = [rec.level, rec.channel, rec.verdict, JSON.stringify(rec.filters), JSON.stringify(rec.tags), rec.candles_left, rec.message, rec.response];
    try {
      await env.EXHUME_DB.prepare(
        `INSERT INTO attempts (ts, player, ladder, level, channel, verdict, filters, tags, candles_left, message, response)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(rec.ts, rec.player, rec.ladder, ...tail).run();
      return;
    } catch (e) {
      // Only a table created before the ladder column falls back to the old row
      // shape (schema.sql has the one-line migration). Any other failure, such as
      // a dropped connection, must not write a row labelled with the wrong ladder.
      if (!/no (such )?column|has no column named/i.test(String(e))) {
        console.log(JSON.stringify({ ...rec, _dberr: String(e) }));
        return;
      }
      try {
        await env.EXHUME_DB.prepare(
          `INSERT INTO attempts (ts, player, level, channel, verdict, filters, tags, candles_left, message, response)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(rec.ts, rec.player, ...tail).run();
        console.log(JSON.stringify({ _note: "attempts table has no ladder column; see schema.sql", ts: rec.ts, ladder: rec.ladder, level: rec.level }));
        return;
      } catch (e2) {
        console.log(JSON.stringify({ ...rec, _dberr: String(e2) }));
        return;
      }
    }
  }
  console.log(JSON.stringify(rec));
}
