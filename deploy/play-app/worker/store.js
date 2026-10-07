// store.js — one small key/value interface over whatever the host provides.
//
//   env.STORE      an object { get, set, del } supplied by the Node server
//                  (deploy/play-app/server.mjs: SQLite, or a JSON file as fallback)
//   env.EXHUME_KV  Cloudflare KV, when the worker runs on Workers
//   neither        an in-memory Map. Local dev only; it forgets on reload.
//
// Values are JSON. ttlSeconds is advisory: honoured by KV and SQLite, ignored by
// nothing that matters (the memory store honours it too).

export function getStore(env) {
  if (env.STORE) return env.STORE;
  if (env.EXHUME_KV) return kvStore(env.EXHUME_KV);
  if (!env.__memStore) env.__memStore = memStore();
  return env.__memStore;
}

function kvStore(kv) {
  return {
    async get(key) {
      const v = await kv.get(key);
      if (v == null) return null;
      try { return JSON.parse(v); } catch { return null; }
    },
    async set(key, value, ttlSeconds) {
      await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined);
    },
    async del(key) { await kv.delete(key); },
  };
}

function memStore() {
  const m = new Map();
  return {
    async get(key) {
      const e = m.get(key);
      if (!e) return null;
      if (e.exp && Date.now() > e.exp) { m.delete(key); return null; }
      return JSON.parse(e.v);
    },
    async set(key, value, ttlSeconds) {
      m.set(key, { v: JSON.stringify(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
    },
    async del(key) { m.delete(key); },
  };
}
