// lock.js — run async work one at a time per key, inside this process.
//
// Every handler is a read-check-write over the store with awaits in between (the
// guard call takes seconds). Without this, parallel requests from one player all
// pass the "exchanges left?" check before any of them saves, and parallel turns
// from many players overwrite each other's cost counters.
//
// Scope: one process. That covers a Node host running a single process (the cPanel
// app runs under Passenger, which can start more; check its settings) and one
// Workers isolate. Across Workers isolates KV cannot compare-and-set;
// a Durable Object per player is the fix there if Workers ever becomes the host.

const tails = new Map();

export async function serial(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
