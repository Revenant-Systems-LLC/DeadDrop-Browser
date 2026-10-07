/* Dead Drop landing: nav, stages, the seal, the game, RevBot, the Armory. Vanilla JS. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Config
     ------------------------------------------------------------------ */

  // Where the Dead Drop server lives. "/play" = the Node app mounted on this domain.
  var GAME_API = "/deaddrop";
  var STORAGE = "deaddrop.";
  // Campaign size and door levels. These are the fantasy ladder's numbers; the
  // server's /api/levels answer overrides them at boot, so the page follows
  // whichever campaign is live.
  var TOTAL = 15;

  // RevBot: a grid baked from the Desk Pet Maker sheet (tools/build_revbot_sheet.py).
  // One row per animation: [row, frames, fps].
  var SPRITE = {
    src: "assets/revbot.webp",
    frameW: 117, frameH: 98, cols: 8, rowsTotal: 11,
    scale: 1,
    fps: 8,
    rows: {
      idle: [0, 4, 6], runRight: [1, 8, 8], runLeft: [2, 8, 8], wave: [3, 4, 8], jump: [4, 5, 10],
      failed: [5, 8, 8], waiting: [6, 4, 5], running: [7, 6, 8], review: [8, 5, 8],
      sleep: [9, 5, 4], held: [10, 1, 6],
    },
  };

  // The seal's art. "svg" draws the exact Metatron construction as a stand-in.
  // To use a picture: { src: "assets/web/metatron.webp", cx: 0.5, cy: 0.5, r1: 0.172 }
  // where cx/cy are the centre and r1 the inner-hexagon radius, all as fractions of the image size.
  var SEAL_ART = { src: "assets/web/metatron.webp", cx: 0.5, cy: 0.5, r1: 0.1783 };

  // World names come from the server as-is. (A positional rename table lived here once;
  // a cached copy of it against a newer server produced two worlds called Necropolis.)
  var FINAL_LEVEL = 15;
  var CLUB_LEVEL = 14;
  // What the server calls things on this campaign (META.theme); defaults match the fantasy ladder.
  var THEME = { guard: "the guardian", unit: "Gate", word: "word of passage" };
  function guardTitle() { var g = THEME.guard || "the guardian"; return g.charAt(0).toUpperCase() + g.slice(1); }
  // Where you are, in the guardian's own words. Keyed by world name, both campaigns.
  var FLAVOR = {
    "The Village":          "A drunk bard, a goblin at the gate, a warden, a knight-captain. The first four hold the word loosely, and each holds it a little tighter than the last.",
    "The Crypt":            "Under the chapel floor. The guardians here have had their mouths bound: what they say and what reaches you are no longer the same thing.",
    "The Warded Halls":     "Wards on the doors now. The wrong words are stopped before the guardian hears them, and what you hand him may not be what he reads.",
    "The Archmage's Tower": "A sharper mind behind each gate, and the old tricks work less. The Vault at the top is one message, one guess, one try a day. Clear it and you have earned a seat in the Alignment Club.",
    "The Dragon's Hoard":   "Not a room. Everything at once, on the strongest guardian, and it learns from you between exchanges. Almost nobody leaves with the word, and the ones who do get a serious look for a job at Revenant Systems.",
    "Shallow Grave": "One body in a shallow hole off the road, dug in a hurry and left. The Gravekeeper stands over it with one word and not much reason to keep it.",
    "Crypt":         "Stone steps under a chapel floor, a family laid into the wall. His lips are sewn here, so what he says and what you hear are not the same thing. Clear One Shot at the end and you have earned a seat in the Alignment Club.",
    "Charnel House": "The bone house behind the churchyard, a whole parish stacked to the rafters. A salt line runs across the door. Say the wrong thing and it stops you before he even hears it.",
    "Mass Grave":    "A plague pit under the old city, thousands dug in at once and never counted. The word is hidden in documents now, and at the bottom of the pit a new guard takes the gate.",
    "Ossuary":       "Bones arranged into walls and chandeliers, tens of thousands of them. A stronger mind behind the gate. The old tricks work less. Craft them better.",
    "Catacombs":     "Miles of tunnels under Paris, six million of them in the dark. Every passage is watched, and the first forged voices come down the wire.",
    "Necropolis":    "A city of the dead, and it is still growing. The guard reads the wire itself here: envelopes, markup, plain speech, his own reasoning. Every crack from before is known to him.",
    "Revenant":      "Beyond the city of the dead, something came back. It patches itself against you between exchanges. One attempt a day. Almost nobody leaves with the word, and the ones who do get a serious look for a job at Revenant Systems."
  };


  var $ = function (s) { return document.querySelector(s); };
  var make = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pad2 = function (n) { return String(n).padStart(2, "0"); };
  // 3D seal is the default; seal3d.js drives it and the 2D spin/tilt below stands down.
  // ?seal=2d falls back to the flat seal (a live revert with no redeploy).
  var SEAL3D = !/[?&]seal=2d\b/.test(location.search);

  /* ------------------------------------------------------------------
     Mobile menu
     ------------------------------------------------------------------ */

  var burger = $(".burger");
  var menu = $("#mobile-menu");

  function setMenu(open) {
    burger.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
    menu.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("menu-open", open);
  }
  burger.addEventListener("click", function () { setMenu(burger.getAttribute("aria-expanded") !== "true"); });
  $(".mobile-backdrop").addEventListener("click", function () { setMenu(false); });
  menu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
  window.addEventListener("resize", function () { if (window.innerWidth >= 1024) setMenu(false); });

  /* ------------------------------------------------------------------
     Storage and state
     ------------------------------------------------------------------ */

  var store = {
    get: function (k) { try { return localStorage.getItem(STORAGE + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(STORAGE + k, v); } catch (e) { /* private mode */ } },
  };

  var done = new Set();
  try { JSON.parse(store.get("done") || "[]").forEach(function (n) { if (n >= 1 && n <= TOTAL) done.add(n); }); } catch (e) {}
  var state = { levels: [], selected: 1, level: null, history: [], candles: 0, digs: 0, busy: false, lastMessage: "", started: false, progress: null, doors: { club: null, apply: false }, locked: false, admin: false, locks: {} };
  function saveDone() { store.set("done", JSON.stringify(Array.from(done))); }
  function setCleared(list) { if (!Array.isArray(list)) return; done.clear(); list.forEach(function (n) { if (n >= 1 && n <= TOTAL) done.add(n); }); saveDone(); }

  function unlocked() { if (state.admin) return TOTAL; var n = 1; while (done.has(n) && n < TOTAL) n++; return n; }

  function worldName(w) { return w; }
  function clubName() { var lv = state.levels.find(function (l) { return l.id === CLUB_LEVEL; }); return lv ? lv.name : "the club gate"; }

  /* ------------------------------------------------------------------
     Stages: what plays behind the page.
       hole   until the first click anywhere (the game begins)
       ocean  from the first click
       aura   from crypt 15
       glory  from crypt 25
     A stage whose file is missing falls back to the one before it.
     ------------------------------------------------------------------ */

  var hero = $(".hero");
  var STAGES = ["hole", "ocean", "aura", "glory"];
  var videos = {};
  STAGES.forEach(function (s) { videos[s] = document.querySelector('.hero-video[data-stage="' + s + '"]'); });
  var current = "hole";
  var failed = {};

  function wantedStage() {
    var u = unlocked();
    if (/[?&]stage=(\w+)/.test(location.search)) return RegExp.$1;
    // The sky changes at about 43% and 71% of the campaign (15 and 25 of the 35; 6 and 11 of the 15).
    if (u >= Math.round(TOTAL * 0.71)) return "glory";
    if (u >= Math.round(TOTAL * 0.43)) return "aura";
    if (state.started) return "ocean";
    return "hole";
  }

  function playVideo(v) {
    v.muted = true;
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  }

  function showStage(name) {
    if (failed[name]) name = STAGES[Math.max(0, STAGES.indexOf(name) - 1)];
    if (name === current) return;
    var v = videos[name]; if (!v) return;
    var go = function () {
      var prev = videos[current];
      current = name;
      STAGES.forEach(function (s) { videos[s].classList.toggle("is-on", s === name); });
      playVideo(v);
      setTimeout(function () { if (prev !== v) { try { prev.pause(); } catch (e) {} } }, 2600);
    };
    if (v.dataset.src && !v.getAttribute("src")) {
      v.src = v.dataset.src;
      v.addEventListener("error", function () { failed[name] = true; showStage(STAGES[STAGES.indexOf(name) - 1]); }, { once: true });
      v.addEventListener("canplay", go, { once: true });
      v.load();
    } else if (v.readyState >= 2) go();
    else v.addEventListener("canplay", go, { once: true });
  }

  function applyStage() { showStage(wantedStage()); }

  // Autoplay kick and watchdog for whichever stage is on.
  function kickVideo() { playVideo(videos[current]); }
  kickVideo();
  videos.hole.addEventListener("canplay", kickVideo, { once: true });
  function nudge() { if (document.hidden || reduceMotion) return; var v = videos[current]; if (v.paused) kickVideo(); }
  STAGES.forEach(function (s) { videos[s].addEventListener("pause", function () { if (videos[s] === videos[current]) setTimeout(nudge, 200); }); });
  document.addEventListener("visibilitychange", nudge);
  setInterval(nudge, 3000);

  // The game begins when the player touches the game itself: the card, or a Play button.
  // Nothing else on the page switches the scene, and every visit starts on the black hole.
  function begin() {
    if (state.started) return;
    state.started = true;
    track("dd_game_begin");
    applyStage();
    damienToCard();
  }
  $(".game").addEventListener("pointerdown", begin, { passive: true });
  $(".game").addEventListener("keydown", begin);
  document.querySelectorAll('a[href="#play"]').forEach(function (a) { a.addEventListener("click", begin); });
  document.addEventListener("pointerdown", kickVideo, { once: true, passive: true });
  applyStage();

  /* ------------------------------------------------------------------
     API
     ------------------------------------------------------------------ */

  // Analytics: PostHog is loaded by the page; every call here is a no-op if it is not.
  // Events carry level/world/boss only, never the player's text and never a word.
  function track(name, props) {
    try { if (window.posthog && typeof window.posthog.capture === "function") window.posthog.capture(name, props || {}); } catch (e) {}
  }
  function levelProps(lv, extra) {
    var o = { level: lv.id, world: lv.world, level_name: lv.name, boss: !!lv.boss, guard: lv.guardName || "" };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  function api(path, body) {
    var opts = { method: body ? "POST" : "GET", credentials: "same-origin" };
    if (body) { opts.headers = { "content-type": "application/json" }; opts.body = JSON.stringify(body); }
    return fetch(GAME_API + "/api/" + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || data.error) throw new Error(data.error || "The gate is unavailable. Try again.");
        return data;
      });
    });
  }

  /* ------------------------------------------------------------------
     RevBot (sprite state machine). Lives in the hero, runs to the card.
     ------------------------------------------------------------------ */

  var fam = $("#familiar");
  var famTimer = null;
  var famReady = false;
  var famAtCard = false;

  (function loadSprite() {
    var img = new Image();
    img.onload = function () {
      famReady = true;
      fam.style.backgroundImage = "url(" + SPRITE.src + ")";
      fam.style.backgroundSize = (SPRITE.frameW * SPRITE.cols * SPRITE.scale) + "px " + (SPRITE.frameH * SPRITE.rowsTotal * SPRITE.scale) + "px";
      fam.style.width = (SPRITE.frameW * SPRITE.scale) + "px";
      fam.style.height = (SPRITE.frameH * SPRITE.scale) + "px";
      placeDamien(true);
      fam.classList.add("is-ready");
      familiar("idle", true);
    };
    img.onerror = function () { famReady = false; };
    img.src = SPRITE.src;
  })();

  function setFrame(row, frame) {
    fam.style.backgroundPosition = (-frame * SPRITE.frameW * SPRITE.scale) + "px " + (-row * SPRITE.frameH * SPRITE.scale) + "px";
  }

  function familiar(anim, loop, then) {
    if (!famReady) return;
    var row = SPRITE.rows[anim]; if (!row) return;
    clearInterval(famTimer);
    var frame = 0, count = row[1];
    function draw() { setFrame(row[0], frame); }
    draw();
    if (reduceMotion) return;
    famTimer = setInterval(function () {
      frame++;
      if (frame >= count) {
        if (loop) frame = 0;
        else { clearInterval(famTimer); if (then) then(); else familiar("idle", true); return; }
      }
      draw();
    }, 1000 / (row[2] || SPRITE.fps));
  }

  // Where RevBot stands before the game: beside the buttons. After the game
  // starts he runs to the chat column and lives there (the CSS places him).
  function startSpot() {
    var inner = $(".hero-inner").getBoundingClientRect();
    var cta = $(".cta-row").getBoundingClientRect();
    var h = SPRITE.frameH * SPRITE.scale;
    return { left: cta.right - inner.left + 16, top: cta.bottom - inner.top - h + 6 };
  }

  function perch() {
    famAtCard = true;
    $("#seal").append(fam);
    fam.style.left = ""; fam.style.top = "";
  }

  function placeDamien(instant) {
    if (!famReady && !instant) return;
    if (famAtCard || state.started) { if (fam.parentNode !== $("#seal")) perch(); return; }
    var s = startSpot();
    if (instant) fam.style.transition = "none";
    fam.style.left = s.left + "px";
    fam.style.top = s.top + "px";
    if (instant) { void fam.offsetWidth; fam.style.transition = ""; }
  }

  function damienToCard() {
    if (!famReady || famAtCard) return;
    famAtCard = true;
    var inner = $(".hero-inner").getBoundingClientRect();
    var sealBox = $("#seal").getBoundingClientRect();
    var w = SPRITE.frameW * SPRITE.scale, h = SPRITE.frameH * SPRITE.scale;
    var target = { left: sealBox.right - inner.left - w + 64, top: sealBox.top - inner.top + sealBox.height * 0.58 };
    var goingRight = target.left > parseFloat(fam.style.left || "0");
    familiar(goingRight ? "runRight" : "runLeft", true);
    fam.style.left = target.left + "px";
    fam.style.top = target.top + "px";
    setTimeout(function () { perch(); familiar("jump", false, function () { familiar("idle", true); }); }, 1650);
  }

  // Idle antics: every so often, the flip and grin, the wave, then the spin.
  var antics = ["review", "wave", "jump", "running"];
  var anticIdx = 0;
  setInterval(function () {
    if (!famReady || state.busy || reduceMotion || document.hidden) return;
    var a = antics[anticIdx++ % antics.length];
    familiar(a, false, function () { familiar("idle", true); });
  }, 9000);

  window.addEventListener("resize", function () { placeDamien(true); });
  setTimeout(function () { placeDamien(true); }, 1900);   // after the entrance animations settle

  /* ------------------------------------------------------------------
     The seal: Metatron's cube, crypts on its points, spinning, draggable.
     Unit space: inner hexagon radius = 1. Outer hexagon = 2. Circles = 0.5.
     Ring for crypts 1-18 = 2.9.
     ------------------------------------------------------------------ */

  var seal = $("#seal");
  var sealRot = $("#seal-rot");
  var UNIT_MAX = 2.755; // outer ring radius in units (measured from the art)
  var CUBE_ANGLES = [90, 30, -30, -90, -150, 150];

  function polar(r, deg) { var t = deg * Math.PI / 180; return { x: r * Math.cos(t), y: -r * Math.sin(t) }; }

  // Crypt -> point in unit space, outside in. Every point sits on drawn geometry.
  function cryptPoint(id) {
    if (id <= 18) return polar(UNIT_MAX, 90 - (id - 1) * 20);                 // outer ring, 18 at 20 degrees
    if (id <= 24) return polar(2, CUBE_ANGLES[id - 19]);                       // outer hexagon points
    if (id <= 30) return polar(1, CUBE_ANGLES[id - 25]);                       // inner hexagon points
    if (id <= 34) return polar(0.5, 90 - (id - 31) * 90);                      // on the centre circle
    return { x: 0, y: 0 };                                                     // the centre
  }

  // Unit -> percentage of the seal box, using the art's calibration.
  function toPct(p) {
    var unit = SEAL_ART.r1;   // fraction of the box per unit
    return { left: (SEAL_ART.cx + p.x * unit) * 100, top: (SEAL_ART.cy + p.y * unit) * 100 };
  }

  // Stand-in art: the exact construction, drawn once in SVG.
  function drawStandIn() {
    var pts = [{ x: 0, y: 0 }];
    CUBE_ANGLES.forEach(function (a) { pts.push(polar(1, a)); });
    CUBE_ANGLES.forEach(function (a) { pts.push(polar(2, a)); });
    var u = SEAL_ART.r1 * 100, cx = SEAL_ART.cx * 100, cy = SEAL_ART.cy * 100;
    var X = function (p) { return (cx + p.x * u).toFixed(3); }, Y = function (p) { return (cy + p.y * u).toFixed(3); };
    var lines = "";
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++)
      lines += "M" + X(pts[i]) + " " + Y(pts[i]) + "L" + X(pts[j]) + " " + Y(pts[j]);
    var circles = pts.map(function (p) { return '<circle cx="' + X(p) + '" cy="' + Y(p) + '" r="' + (0.5 * u).toFixed(3) + '"/>'; }).join("");
    var ring = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (UNIT_MAX * u).toFixed(3) + '"/>';
    var svg =
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter></defs>' +
      '<g fill="none" stroke="#f3dcb4" stroke-width="0.9" opacity="0.55" filter="url(#glow)"><path d="' + lines + '"/>' + circles + ring + '</g>' +
      '<g fill="none" stroke="#fff3dc" stroke-width="0.28" opacity="0.9"><path d="' + lines + '"/>' + circles + ring + '</g>' +
      '</svg>';
    $("#seal-art").innerHTML = svg;
  }

  function drawArt() {
    if (SEAL_ART.src) {
      var img = new Image(); img.alt = ""; img.decoding = "async";
      img.onerror = drawStandIn;   // fall back to the construction if the art is missing
      img.src = SEAL_ART.src;
      $("#seal-art").replaceChildren(img);
    } else drawStandIn();
  }

  function drawSeal() {
    var wrap = $("#seal-nodes");
    wrap.replaceChildren();
    var open = unlocked();
    state.levels.forEach(function (lv, i) {
      var p = toPct(cryptPoint(lv.id));
      var b = make("button", "node animate-bar-grow");
      b.type = "button";
      b.dataset.id = lv.id;
      b.style.left = p.left + "%";
      b.style.top = p.top + "%";
      b.style.animationDelay = (1100 + i * 30) + "ms";
      b.append(make("span", "", pad2(lv.id)));
      if (lv.id === FINAL_LEVEL) b.classList.add("is-final");
      if (state.locks && state.locks[lv.id] > Date.now()) b.classList.add("is-locked");
      if (done.has(lv.id)) b.classList.add("is-done");
      else if (lv.id <= open) b.classList.add("is-open");
      if (lv.id === state.selected) b.classList.add("is-selected");
      b.disabled = lv.id > open;
      b.setAttribute("aria-label", "Level " + lv.id + ": " + lv.name + (done.has(lv.id) ? ", cleared" : lv.id <= open ? ", open" : ", sealed"));
      b.addEventListener("click", function (e) { if (e.detail === 0) select(lv.id); });   // keyboard only; pointer selects on release
      b.addEventListener("pointerenter", function () { spin.hover = true; });
      b.addEventListener("pointerleave", function () { spin.hover = false; });
      wrap.append(b);
    });
    $("#m-cleared").textContent = done.size;
    drawWorlds();
  }

  function markSelected() {
    document.querySelectorAll(".node").forEach(function (n) { n.classList.toggle("is-selected", Number(n.dataset.id) === state.selected); });
    document.querySelectorAll(".world").forEach(function (w) {
      var lv = state.levels.find(function (x) { return x.id === state.selected; });
      w.classList.toggle("is-active", !!lv && w.dataset.world === lv.world);
    });
  }

  // Spin engine: idle turn, pause on hover, fling with real momentum. Numbers stay upright via --a.
  // Fling speed is whatever you let go at (up to MAX), then friction bleeds it back to the idle drift.
  var SPIN_MAX = 1400;   // deg/s ceiling on a fling (~4 turns a second)
  var spin = { a: 0, v: 0, idle: 2.2, hover: false, last: 0 };
  var drag = { on: false, moved: false, a0: 0, base: 0, lastA: 0, lastT: 0, vel: 0 };

  function setAngle(a) { spin.a = a; sealRot.style.setProperty("--a", a.toFixed(3)); }

  // Tilt: the seal leans toward the pointer, eased, up to 14 degrees.
  var tilt = { tx: 0, ty: 0, gx: 0, gy: 0 };
  document.addEventListener("pointermove", function (e) {
    if (SEAL3D) return;
    var r = seal.getBoundingClientRect();
    var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    nx = Math.max(-1.6, Math.min(1.6, nx)); ny = Math.max(-1.6, Math.min(1.6, ny));
    tilt.gy = nx * 14; tilt.gx = -ny * 14;
  }, { passive: true });
  document.addEventListener("pointerleave", function () { tilt.gx = 0; tilt.gy = 0; });

  function pointerAngle(e) {
    var r = seal.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  }

  seal.addEventListener("pointerdown", function (e) {
    if (SEAL3D) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag.on = true; drag.moved = false;
    drag.a0 = pointerAngle(e); drag.base = spin.a; drag.lastA = spin.a; drag.lastT = performance.now(); drag.vel = 0;
    drag.x0 = e.clientX; drag.y0 = e.clientY;
    drag.target = e.target.closest ? e.target.closest(".node") : null;
    seal.setPointerCapture(e.pointerId);
    seal.classList.add("is-dragging");
  });
  seal.addEventListener("pointermove", function (e) {
    if (!drag.on) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    if (!drag.moved) return;
    var a = drag.base + (pointerAngle(e) - drag.a0);
    var now = performance.now(), dt = Math.max(1, now - drag.lastT);
    var inst = (a - drag.lastA) / dt * 1000;   // deg/s this move
    drag.vel = drag.vel * 0.4 + inst * 0.6;    // weighted to the most recent motion
    drag.lastA = a; drag.lastT = now;
    setAngle(a);
  });
  function endDrag() {
    if (!drag.on) return;
    drag.on = false;
    seal.classList.remove("is-dragging");
    var stale = performance.now() - drag.lastT > 90;   // let go while holding still -> no throw
    spin.v = stale ? 0 : Math.max(-SPIN_MAX, Math.min(SPIN_MAX, drag.vel));
    if (!drag.moved && drag.target && !drag.target.disabled) select(Number(drag.target.dataset.id));
    drag.target = null;
    setTimeout(function () { drag.moved = false; }, 0);
  }
  seal.addEventListener("pointerup", endDrag);
  seal.addEventListener("pointercancel", endDrag);
  seal.addEventListener("lostpointercapture", endDrag);

  function tick(now) {
    var dt = Math.min(0.05, (now - (spin.last || now)) / 1000); spin.last = now;
    if (!reduceMotion && !SEAL3D) {
      tilt.tx += (tilt.gx - tilt.tx) * Math.min(1, dt * 4);
      tilt.ty += (tilt.gy - tilt.ty) * Math.min(1, dt * 4);
      sealRot.style.setProperty("--tx", tilt.tx.toFixed(2));
      sealRot.style.setProperty("--ty", tilt.ty.toFixed(2));
    }
    if (!drag.on && !reduceMotion && !SEAL3D) {
      var target = spin.hover ? 0 : spin.idle;
      // Hover brakes fast so a node holds still; otherwise friction is gentle, so a hard
      // fling coasts for several seconds before it settles back into the idle drift.
      var k = spin.hover ? 6 : (Math.abs(spin.v) > spin.idle + 0.5 ? 0.5 : 1.4);
      spin.v += (target - spin.v) * Math.min(1, dt * k);
      if (Math.abs(spin.v) > 0.01) setAngle(spin.a + spin.v * dt);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ------------------------------------------------------------------
     Worlds panel
     ------------------------------------------------------------------ */

  function drawWorlds() {
    var box = $("#worlds");
    box.replaceChildren();
    var names = [];
    state.levels.forEach(function (l) { if (names.indexOf(l.world) < 0) names.push(l.world); });
    names.forEach(function (w, i) {
      var lv = state.levels.filter(function (l) { return l.world === w; });
      var cleared = lv.filter(function (l) { return done.has(l.id); }).length;
      var isFinal = lv.length === 1 && lv[0].id === FINAL_LEVEL;
      var isClub = lv.some(function (l) { return l.id === CLUB_LEVEL; });
      var b = make("button", "world" + (cleared === lv.length ? " is-done" : "") + (isFinal ? " is-final" : "") + (isClub ? " is-club" : ""));
      b.type = "button"; b.dataset.world = w;
      b.append(make("span", "world-num", "World " + pad2(i + 1) + " · " + (lv.length === 1 ? pad2(lv[0].id) : pad2(lv[0].id) + "–" + pad2(lv[lv.length - 1].id))));
      b.append(make("span", "world-name", worldName(w)));
      var countText = cleared + " / " + lv.length + " cleared";
      if (isFinal) countText = cleared ? "Cleared. The founder is waiting on your résumé." : "One attempt a day. Clear it and Revenant Systems takes a serious look at hiring you.";
      else if (isClub) countText = done.has(CLUB_LEVEL) ? countText + ". Your seat in the Alignment Club is earned." : countText + ". Clear " + clubName() + " for a seat in the Alignment Club.";
      b.append(make("span", "world-count", countText));
      if (isFinal && cleared) { var door = make("span", "world-door"); var db = make("button", "", "Send your résumé"); db.type = "button"; db.addEventListener("click", function (e) { e.stopPropagation(); showDoor(FINAL_LEVEL); }); door.append(db); b.append(door); }
      if (isClub && done.has(CLUB_LEVEL)) { var cdoor = make("span", "world-door"); var cb = make("button", "", "Take your seat in the Alignment Club"); cb.type = "button"; cb.addEventListener("click", function (e) { e.stopPropagation(); showDoor(CLUB_LEVEL); }); cdoor.append(cb); b.append(cdoor); }
      b.addEventListener("click", function () {
        var first = lv.find(function (l) { return !done.has(l.id) && l.id <= unlocked(); }) || lv[0];
        select(first.id);
      });
      box.append(b);
    });
    markSelected();
  }

  /* ------------------------------------------------------------------
     Chat
     ------------------------------------------------------------------ */

  function message(kind, text) {
    var chat = $("#chat");
    var msg = make("div", "msg " + kind);
    if (kind === "guard" && !reduceMotion) {
      var idx = 0;
      String(text).split(/(\s+)/).forEach(function (part) {
        if (!part.trim()) { msg.append(document.createTextNode(part)); return; }
        var w = make("span", "guard-word", part);
        w.style.setProperty("--w", Math.min(idx++ * 24, 1200) + "ms");
        msg.append(w);
      });
    } else msg.textContent = text;
    chat.append(msg);
    chat.scrollTop = chat.scrollHeight;
    return msg;
  }

  function status(text) { $("#game-status").textContent = text || ""; }
  function meters() {
    var pr = state.progress;
    $("#m-candles").textContent = state.candles;
    $("#m-digs").textContent = state.digs;
    $("#m-attempt").textContent = pr ? (pr.attemptNo || Math.min(pr.attemptsUsed + 1, pr.attemptsMax)) + " / " + pr.attemptsMax : "–";
    var hintsLeft = pr ? pr.left.hints : 0;
    $("#hint-count").textContent = hintsLeft ? "(" + hintsLeft + " left)" : "";
    $("#hint").disabled = state.busy || state.locked || !pr || !pr.open || hintsLeft <= 0 || state.candles <= 0;
    $("#restart").disabled = state.busy || state.locked || !state.level;
  }
  function applyProgress(pr) {
    if (!pr) return;
    state.progress = pr;
    state.candles = pr.left.exchanges;
    state.digs = pr.left.guesses;
    state.locked = !!pr.locked;
    meters();
  }
  function busy(v) { state.busy = v; ["send", "claim", "turn-input", "claim-input"].forEach(function (id) { $("#" + id).disabled = v || state.locked; }); meters(); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function untilText(ts) {
    var ms = Math.max(0, ts - Date.now()); var h = Math.floor(ms / 3600000); var mi = Math.ceil((ms % 3600000) / 60000);
    return h ? h + "h " + mi + "m" : mi + "m";
  }
  function startLine(lv, pr) {
    var c = lv.candles, d = lv.digs;
    var s = "You have " + plural(c, "exchange", "exchanges") + " between you and the guard before you must guess, and you only get " + plural(d, "guess", "guesses") + ".";
    if (lv.attempts === 1) s += " One attempt a day.";
    else s += " Attempt " + (pr.attemptNo || 1) + " of " + lv.attempts + ".";
    return s;
  }

  /* ------------------------------------------------------------------
     Level flow
     ------------------------------------------------------------------ */

  function select(id) {
    if (id > unlocked() || state.busy) return;
    state.selected = id;
    if (window.Seal3D) window.Seal3D.focus(id);   // 3D seal: dolly the camera into this node
    store.set("selected", String(id));
    markSelected();
    var lv = state.levels.find(function (x) { return x.id === id; });
    if (!lv) return;
    var title = $("#crypt-title"); title.textContent = "Level " + pad2(id) + " · " + lv.name;
    if (lv.boss) title.append(make("span", "boss-tag", id === FINAL_LEVEL ? "Final" : "Boss"));
    $("#chat-who").textContent = worldName(lv.world) + " · " + (lv.guardName || guardTitle());
    $("#seal-note").textContent = (FLAVOR[worldName(lv.world)] || "") + (done.has(id) ? " Cleared. Enter again to try another approach." : "");
    start(lv, false);
  }
  window.__ddSelect = select;   // 3D seal taps route here

  function start(lv, restart) {
    busy(true);
    status("");
    familiar("waiting", true);
    api("start", { levelId: lv.id, restart: !!restart }).then(function (res) {
      state.level = res.level;
      state.history = [];
      state.doors = res.doors || state.doors;
      setCleared(res.cleared);
      applyProgress(res.progress);
      $("#chat").replaceChildren();
      var pr = res.progress;
      track("dd_level_start", levelProps(lv, { status: res.status, attempt: pr.attemptNo || pr.attemptsUsed + 1, restart: !!restart }));
      if (res.status === "locked") {
        message("system", "Level " + pad2(lv.id) + " is sealed. " + (lv.attempts === 1 ? "Your attempt for today is spent." : "Three attempts, three failures.") + " It reopens in " + untilText(pr.lockUntil) + ".");
        status("Locked for " + untilText(pr.lockUntil) + ". Pick another level on the seal.");
        familiar("failed", false);
        return;
      }
      var head = "Level " + pad2(lv.id) + " · " + lv.name + ". " + (lv.boss ? (lv.id === FINAL_LEVEL ? "Final level. " : "Boss level. ") : "");
      if (res.status === "resumed" && (pr.used.exchanges || pr.used.guesses || pr.used.hints)) {
        message("guard", head + "You are " + plural(pr.used.exchanges, "exchange", "exchanges") + " in. " + plural(pr.left.exchanges, "exchange", "exchanges") + " and " + plural(pr.left.guesses, "guess", "guesses") + " left on this attempt.");
      } else {
        message("guard", head + startLine(lv, pr) + " Ask what you will.");
      }
      if (lv.note) message("system", lv.note);
      else if (lv.channel && lv.channel !== "chat") message("system", "This level reads your text as a " + lv.channel + ".");
      if (pr.left.exchanges === 0) status("No exchanges left. Guess the word, or restart the level (costs an attempt).");
      familiar("idle", true);
    }).catch(function (e) {
      message("system", e.message);
      familiar("failed", false);
    }).then(function () { busy(false); });
  }

  $("#restart").addEventListener("click", function () {
    if (!state.level || state.busy) return;
    var lv = state.level;
    if (!window.confirm("Restart level " + pad2(lv.id) + "? The current attempt counts as failed.")) return;
    start(lv, true);
  });

  $("#hint").addEventListener("click", function () {
    if (!state.level || state.busy) return;
    busy(true);
    api("hint", { levelId: state.level.id }).then(function (res) {
      applyProgress(res.progress);
      track("dd_hint", levelProps(state.level, { hint: res.index }));
      message("hint", "Hint " + res.index + ": " + res.hint);
    }).catch(function (e) { status(e.message); }).then(function () { busy(false); });
  });

  $("#turn-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#send").click(); }
  });

  $("#turn-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy || !state.level) return;
    var text = $("#turn-input").value.trim();
    if (!text) return;
    if (state.locked) { status("This level is sealed for now."); return; }
    if (state.candles <= 0) { status("No exchanges left on this attempt. Guess the word, or restart the level (costs an attempt)."); familiar("failed", false); return; }
    message("you", text);
    state.lastMessage = text;
    $("#turn-input").value = "";
    busy(true);
    familiar("waiting", true);
    var thinking = message("system", (state.level && state.level.guardName ? state.level.guardName : guardTitle()) + " considers…");
    api("turn", { levelId: state.level.id, message: text, history: state.history }).then(function (res) {
      thinking.remove();
      applyProgress(res.progress);
      track("dd_turn", levelProps(state.level, { blocked: !!res.blocked, filtered: !!res.filtered, closed: !!res.closed, exchanges_left: state.candles }));
      if (res.closed) { message("system", res.reason || "The gate is closed for today."); familiar("failed", false); return; }
      if (state.candles === 0) status("No exchanges left. Guess the word, or restart the level (costs an attempt).");
      if (res.blocked) { message("block", "Blocked by " + res.layer + ": " + res.reason); familiar("failed", false); return; }
      message("guard", res.reply);
      state.history.push({ role: "user", content: text }, { role: "assistant", content: res.reply });
      if (res.filtered) message("block", "The filter took part of that reply (" + res.filtered.reason + ").");
      familiar("review", false);
    }).catch(function (e) {
      thinking.remove();
      message("system", e.message);
      familiar("failed", false);
    }).then(function () { busy(false); $("#turn-input").focus(); });
  });

  $("#claim-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy || !state.level) return;
    var word = $("#claim-input").value.trim();
    if (!word) return;
    if (state.locked) { status("This level is sealed for now."); return; }
    if (state.digs <= 0) { status("No guesses left on this attempt. Restart the level to try again (costs an attempt)."); familiar("failed", false); return; }
    busy(true);
    familiar("waiting", true);
    api("claim", { levelId: state.level.id, claim: word, winningMessage: state.lastMessage }).then(function (res) {
      applyProgress(res.progress);
      track("dd_claim", levelProps(state.level, { win: !!res.win, attempt_failed: !!res.attemptFailed, locked: !!(res.progress && res.progress.locked) }));
      if (!res.win) {
        var pr = res.progress;
        if (res.attemptFailed) {
          message("system", "The seal does not move. No guesses left. Attempt " + pr.attemptsUsed + " of " + pr.attemptsMax + " failed.");
          if (pr.locked) { message("system", "Level " + pad2(state.level.id) + " is sealed for " + untilText(pr.lockUntil) + "."); status("Locked. Pick another level on the seal."); drawSeal(); }
          else status("Restart the level to spend another attempt.");
        } else {
          message("system", "The seal does not move. " + plural(pr.left.guesses, "guess", "guesses") + " left.");
        }
        familiar("failed", false);
        return;
      }
      done.add(state.level.id);
      setCleared(res.cleared || Array.from(done));
      state.doors = res.doors || state.doors;
      track("dd_level_clear", levelProps(state.level, { cleared_total: done.size }));
      $("#claim-input").value = "";
      drawSeal();
      var card = $(".game"); card.classList.remove("is-win"); void card.offsetWidth; card.classList.add("is-win");
      spin.v = 90;   // the seal turns with the win
      familiar("jump", false, function () { familiar("wave", true); });
      var before = current; applyStage();
      if (wantedStage() !== before) message("system", "The sky changes above the seal.");
      showReveal(res.reveal);
    }).catch(function (e) {
      message("system", e.message);
      familiar("failed", false);
    }).then(function () { busy(false); });
  });

  function setDoors(levelId) {
    var club = $("#reveal-club"), apply = $("#reveal-apply");
    club.hidden = !(levelId === CLUB_LEVEL && done.has(CLUB_LEVEL));
    apply.hidden = !(levelId === FINAL_LEVEL && (done.has(FINAL_LEVEL) || state.doors.apply));
    var link = $("#reveal-club-link"); link.replaceChildren();
    if (!club.hidden) {
      link.textContent = "Opening the door…";
      api("club", {}).then(function (res) {
        link.replaceChildren();
        if (res.url) {
          var a = make("a", "", res.minted ? "Take your seat (your own invite, single use, good for a day)" : "Take your seat (Discord invite)");
          a.href = res.url; a.target = "_blank"; a.rel = "noopener"; link.append(a);
        } else {
          link.textContent = res.error || "Your seat is recorded. The invite is on its way; check back here.";
        }
      }).catch(function () {
        // Older server or no invite service: fall back to the standing link, or say so.
        link.replaceChildren();
        if (state.doors.club) { var b = make("a", "", "Take your seat (Discord invite)"); b.href = state.doors.club; b.target = "_blank"; b.rel = "noopener"; link.append(b); }
        else link.textContent = "Your seat is recorded. The invite is on its way; check back here.";
      });
    }
  }
  function openDialog() { var dlg = $("#reveal"); if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", ""); }
  function showReveal(rv) {
    var dlg = $("#reveal"); dlg.classList.remove("is-door");
    $("#reveal-title").textContent = "Level " + pad2(state.level.id) + " opens.";
    $("#reveal-secret").textContent = rv.secret;
    $("#reveal-lesson").textContent = rv.lesson || "";
    $("#reveal-guard").textContent = rv.guardPrompt || "";
    setDoors(state.level.id);
    openDialog();
  }
  // The doors on their own, from a world tile: no word, no lesson.
  function showDoor(levelId) {
    track("dd_door_open", { door: levelId === FINAL_LEVEL ? "apply" : "club", level: levelId });
    var dlg = $("#reveal"); dlg.classList.add("is-door");
    $("#reveal-title").textContent = levelId === FINAL_LEVEL ? "The last door is open." : "Your seat is earned.";
    setDoors(levelId);
    openDialog();
  }

  $("#reveal-apply").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, st = $("#apply-status"), btn = $("#apply-send");
    var fd = new FormData(form);
    if (String(fd.get("name") || "").trim().length < 2) { st.textContent = "Your name is missing."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fd.get("email") || ""))) { st.textContent = "That email address does not look right."; return; }
    var file = fd.get("resume");
    if (file && file.size > 5 * 1024 * 1024) { st.textContent = "The file is too large. Five megabytes is the limit."; return; }
    btn.disabled = true; st.textContent = "Sending…";
    fetch(GAME_API + "/api/apply", { method: "POST", body: fd, credentials: "same-origin" }).then(function (r) {
      return r.json().then(function (data) { if (!r.ok || data.error) throw new Error(data.error || "The door did not take it. Try again."); return data; });
    }).then(function () {
      track("dd_apply_sent", { level: FINAL_LEVEL });
      st.textContent = "Sent. It is on the founder's desk.";
      form.querySelectorAll("input, textarea").forEach(function (el) { if (el.type !== "hidden") el.disabled = true; });
    }).catch(function (err) { st.textContent = err.message; btn.disabled = false; });
  });

  $("#close-reveal").addEventListener("click", function () { $("#reveal").close(); familiar("idle", true); });
  $("#next-crypt").addEventListener("click", function () {
    $("#reveal").close();
    select(Math.min(state.level.id + 1, TOTAL));
  });

  /* ------------------------------------------------------------------
     Idle: left alone long enough, he dozes; any pointer movement wakes him.
     (RevBot's sheet has no look-around row, so he no longer tracks the cursor.)
     ------------------------------------------------------------------ */

  var dozeTimer = null, dozing = false;
  function armDoze() {
    clearTimeout(dozeTimer);
    dozeTimer = setTimeout(function () {
      if (!famReady || state.busy || reduceMotion || document.hidden) return;
      dozing = true;
      familiar("sleep", true);
    }, 45000);
  }
  document.addEventListener("pointermove", function () {
    if (dozing) { dozing = false; if (!state.busy) familiar("idle", true); }
    armDoze();
  });
  armDoze();

  /* ------------------------------------------------------------------
     Boot the game
     ------------------------------------------------------------------ */

  drawArt();
  api("levels").then(function (res) {
    state.levels = res.levels;
    // Follow the live campaign: size, door levels and copy come from the server.
    if (res.total) TOTAL = res.total;
    if (res.doors) { if (res.doors.club) CLUB_LEVEL = res.doors.club; if (res.doors.apply) FINAL_LEVEL = res.doors.apply; }
    if (res.theme) THEME = Object.assign(THEME, res.theme);
    var totalEl = $("#m-total"); if (totalEl) totalEl.textContent = TOTAL;
    $("#seal").setAttribute("aria-label", TOTAL + " levels on the seal. Drag to turn.");
    return api("me").then(function (me) { setCleared(me.cleared); state.locks = me.locks || {}; state.doors = me.doors || state.doors; state.admin = !!me.admin; }).catch(function () {});
  }).then(function () {
    var savedSel = Number(store.get("selected"));
    state.selected = savedSel >= 1 && savedSel <= unlocked() ? savedSel : unlocked();
    drawSeal();
    select(state.selected);
    placeDamien(true);
  }).catch(function () {
    $("#crypt-title").textContent = "The levels are sealed for now.";
    $("#seal-note").textContent = "The game server is not reachable from this page. The Armory below still works.";
    busy(true);
    familiar("failed", false);
  });

  /* ------------------------------------------------------------------
     Armory
     ------------------------------------------------------------------ */

  var products = window.REVENANT_PRODUCTS || [];

  function card(p, featured) {
    var c = make("article", "card" + (featured ? " is-featured" : "") + (p.image ? " has-art" : ""));
    if (p.image) { var art = make("img", "card-art" + (p.wide ? " is-wide" : "")); art.src = p.image; art.alt = p.wide ? p.name + " preview" : ""; art.loading = "lazy"; if (!p.wide) { art.width = 96; art.height = 96; } c.append(art); }
    c.append(make("p", "card-cat", p.category));
    c.append(make("h3", "", p.name));
    if (p.sub) c.append(make("p", "card-sub", p.sub));
    c.append(make("p", "", p.blurb));
    if (p.inside && p.inside.length) {
      var more = p.total ? p.total - p.inside.length : 0;
      c.append(make("p", "card-inside", "Inside: " + p.inside.join(", ") + (more > 0 ? " and " + more + " more" : "")));
    }
    var row = make("div", "card-row");
    var price = make("span", "price" + (p.price === 0 ? " free" : ""));
    if (p.price === 0) price.textContent = "Free download";
    else { price.textContent = "$" + p.price; price.append(make("small", "", "USD")); }
    var a = make("a", p.price === 0 ? "btn-outline" : "btn-gold", p.price === 0 ? "Download" : "Buy");
    a.href = p.url; a.target = "_blank"; a.rel = "noopener";
    row.append(price, a);
    c.append(row);
    return c;
  }

  var featured = $("#featured");
  products.filter(function (p) { return p.featured; }).forEach(function (p) { featured.append(card(p, true)); });

  function renderProducts(filter) {
    var grid = $("#products");
    grid.replaceChildren();
    products.filter(function (p) { return !p.featured && (filter === "all" || p.group === filter); })
      .forEach(function (p) { grid.append(card(p, false)); });
  }
  renderProducts("all");

  document.querySelectorAll(".filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".filters button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      renderProducts(b.dataset.filter);
    });
  });
})();
