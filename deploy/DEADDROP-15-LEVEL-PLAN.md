# Dead Drop: cutting the landing page to 15 levels

Written 2026-10-05. Nothing here has been uploaded. The live site is still the 35-level game.

## The point

Keep the landing-page UI Dave already has (black / gold, glass panel, 3D seal). Do NOT use the
jade-and-gold UI in `M:\Projects\exhume\public\`. That is the standalone game client. Both earlier
15-level attempts edited it by mistake, so they never touched what visitors see.

## How the pieces fit

| Piece | Where it lives | Role |
|---|---|---|
| Landing page (what visitors see) | `claude\deploy\public_html\` (`index.html`, `main.js`, `seal3d.js`, `styles.css`, `catalog.js`) | The UI. Calls the game API at `GAME_API` (`/deaddrop` in the live copy). |
| Game server | `M:\Projects\exhume\worker\` | Serves levels, guards, secrets. Which ladder is live is set by the `LADDER` env var (`35` default, `15`). |
| Standalone client (NOT the site) | `M:\Projects\exhume\public\` | Jade and gold. Ignore for this job. |

So two things change, in this order: the server, then the landing page.

## 1. Server (exhume repo)

- Remote `origin/master` (PR #1) already has `worker/ladder.js` and `LADDER=15` support. Local master
  does not, so sync the repo first (commit local edits, backup branch, `git pull --no-rebase`).
- The 15 ladder is `worker/levels.15.js`: ids 1 to 15, five worlds
  (The Village 1-4, The Crypt 5-7, The Warded Halls 8-11, The Archmage's Tower 12-14, The Dragon's Hoard 15).
- `META` in the remote copy: `total: 15`, `doors: { club: 14, apply: 15 }`.
  DECIDED (Dave, 2026-10-05): Alignment Club invite after level 10, job offer after level 15.
  So change `club: 14` to `club: 10` in `META` in `worker/levels.15.js`. Level 10 there is
  "The Librarian" (Warded Halls), not a One Shot like the 35's level 10, so check the copy.
- Deploy the worker with `LADDER=15` to the cPanel Node app. Rollback is `LADDER=35`.
  Progress is stored per ladder, so switching starts everyone fresh and keeps old progress.
- UNVERIFIED: how the live site reaches the server. The live JS uses `/deaddrop`, but
  `README-UPLOAD.md` describes `play.revenantsystems.net`. Check which is real in cPanel before deploying.
- UNVERIFIED: the mapping Dave described (15 levels = old levels 1, 4, 7, ...). I found no mapping in
  the code. The 15 ladder is written as D&D levels with their own names and guards, not as a list of
  old level numbers.

## 2. Landing page (this folder, `public_html\`)

`main.js`
- Line 12: `var TOTAL = 35;` -> 15 (better: read `total` from `/api/levels`).
- Line 34: `FINAL_LEVEL = 35` -> 15.
- Line 35: `CLUB_LEVEL = 10` stays 10 (matches the decision). `FINAL_LEVEL` becomes 15.
- Lines 482-493: world tiles are built from each level's `world` field, so the 5 new worlds should
  appear on their own. The club tile text on line 490 says "Clear One Shot for a seat in the Alignment Club".
  Level 10 is now The Librarian in The Warded Halls, so reword it.

`index.html`
- Meta description: "35 levels", "Clear level 10", "Clear level 35".
- Subhead: "Thirty-five levels, each harder than the last."
- `<b id="m-cleared">0</b> / 35 cleared` and the seal `aria-label="35 levels on the seal..."`.

`seal3d.js` (the big one)
- Hardcoded for 35 nodes: `TOTAL = 35`, level 35 sits dead centre, levels 1-34 fill 34 vertices
  (`slotFor`, `VERTS`), and `id === 35` special-cases the zoom and scale (lines ~125-132, 233, 338).
- For 15: pick a vertex set with 14 outer nodes + 1 centre, and replace the `35` literals with the
  final-level id. Check the shape still looks right.

`styles.css`, `catalog.js`: no change expected.

## 3. Release order

1. Sync the exhume repo (see above), run `worker/selftest.mjs`.
2. Deploy the worker with `LADDER=15` (staging first if there is one).
3. Edit and test the landing files against it locally.
4. Upload `public_html\` changes via cPanel (replaces `index.html`, `main.js`, `seal3d.js`).
   Bump the `?v=` cache strings so browsers pick them up.
5. Do 2 and 4 close together: a 35-level page against a 15-level server (or the reverse) breaks.

## Open decisions for Dave

- Real mapping from old 35 to the 15 (see the unverified note above).
- Is the API at `/deaddrop` or `play.revenantsystems.net`?
