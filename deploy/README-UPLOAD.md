# Dead Drop landing: what to upload where

Two folders. Both go to the same Namecheap hosting account.

## 1. public_html  (the page)

Upload the contents of `public_html/` into your site's `public_html` in cPanel File Manager.
It replaces `index.html` and adds an `assets` folder. Every other page stays as it is.

## 2. play-app  (the game server)

The game talks to a small program. It runs on your hosting through cPanel's
"Setup Node.js App" (under Software).

1. cPanel > Domains > create the subdomain `play.revenantsystems.net`.
   Note the document root it creates (something like `play.revenantsystems.net` in your home folder).
2. cPanel > File Manager > upload the contents of `play-app/` into that folder
   (`server.mjs`, `package.json`, the `worker` folder).
3. cPanel > Setup Node.js App > Create Application:
   - Node.js version: the newest offered, 18 or higher
   - Application mode: Production
   - Application root: the folder from step 1
   - Application URL: play.revenantsystems.net
   - Application startup file: server.mjs
4. Same screen, Environment variables > Add:
   - `SERVER_KEY` = a long random string, 40 or more characters. Keep it private. Changing it later changes every word.
   - `ALLOWED_ORIGIN` = `https://www.revenantsystems.net,https://revenantsystems.net`
5. Click Create, then Start (or Restart).
6. Open https://play.revenantsystems.net in a browser. It should say "Dead Drop API is up. Provider: mock".

No `npm install` is needed. The app has no dependencies.

The guard is the offline scripted one (`mock`) until you set `PROVIDER` to `groq` or `google`
with the matching API key. Both have free tiers; see `worker/providers.js`.

## 3. Point the page at the server

`public_html/main.js`, near the top: `var GAME_API = "https://play.revenantsystems.net";`
It is already set to that. If you used a different subdomain, change that one line and re-upload `main.js`.
