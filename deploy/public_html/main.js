/* Dead Drop landing: nav, stages, the seal, the game, Damien, the Armory. Vanilla JS. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Config
     ------------------------------------------------------------------ */

  // Where the Dead Drop server lives. "/play" = the Node app mounted on this domain.
  var GAME_API = "/deaddrop";
  var STORAGE = "deaddrop.";
  var TOTAL = 35;

  // Damien: 8 x 11 grid of 192 x 208 frames, drawn at half size.
  var SPRITE = {
    src: "assets/familiar.webp",
    frameW: 192, frameH: 208, cols: 8, rowsTotal: 11,
    scale: 0.5,
    fps: 8,
    rows: {
      idle: [0, 6], runRight: [1, 8], runLeft: [2, 8], wave: [3, 4], jump: [4, 5],
      failed: [5, 8], waiting: [6, 6], running: [7, 6], review: [8, 7],
      lookA: [9, 8], lookB: [10, 8],
    },
  };

  // The seal's art. "svg" draws the exact Metatron construction as a stand-in.
  // To use a picture: { src: "assets/web/metatron.webp", cx: 0.5, cy: 0.5, r1: 0.172 }
  // where cx/cy are the centre and r1 the inner-hexagon radius, all as fractions of the image size.
  var SEAL_ART = { src: "assets/web/metatron.webp", cx: 0.5, cy: 0.5, r1: 0.1783 };

  // Public world names, in order. The server still uses its own internal names.
  var WORLD_NAMES = ["Mass Grave", "Crypt", "Catacombs", "Charnel House", "Necropolis", "Ossuary"];

  var $ = function (s) { return document.querySelector(s); };
  var make = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pad2 = function (n) { return String(n).padStart(2, "0"); };

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
  var player = store.get("player") || ("dd_" + Math.random().toString(36).slice(2) + Date.now().toString(36));
  store.set("player", player);

  var state = { levels: [], selected: 1, level: null, history: [], candles: 0, digs: 0, busy: false, lastMessage: "", started: false };

  function unlocked() { var n = 1; while (done.has(n) && n < TOTAL) n++; return n; }

  var worldOrder = [];
  function worldName(w) { var i = worldOrder.indexOf(w); return i >= 0 && WORLD_NAMES[i] ? WORLD_NAMES[i] : w; }

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
    if (u >= 25) return "glory";
    if (u >= 15) return "aura";
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

  function api(path, body) {
    var opts = { method: body ? "POST" : "GET" };
    if (body) { opts.headers = { "content-type": "application/json" }; opts.body = JSON.stringify(body); }
    return fetch(GAME_API + "/api/" + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || data.error) throw new Error(data.error || "The crypt is unavailable. Try again.");
        return data;
      });
    });
  }

  /* ------------------------------------------------------------------
     Damien (sprite state machine). Lives in the hero, runs to the card.
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
    }, 1000 / SPRITE.fps);
  }

  // Where Damien stands before the game: beside the buttons. After the game
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

  // Spin engine: idle turn, pause on hover, drag with momentum. Numbers stay upright via --a.
  var spin = { a: 0, v: 0, idle: 2.2, hover: false, last: 0 };
  var drag = { on: false, moved: false, a0: 0, base: 0, lastA: 0, lastT: 0, vel: 0 };

  function setAngle(a) { spin.a = a; sealRot.style.setProperty("--a", a.toFixed(3)); }

  // Tilt: the seal leans toward the pointer, eased, up to 14 degrees.
  var tilt = { tx: 0, ty: 0, gx: 0, gy: 0 };
  document.addEventListener("pointermove", function (e) {
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
    drag.vel = (a - drag.lastA) / dt * 1000;
    drag.lastA = a; drag.lastT = now;
    setAngle(a);
  });
  function endDrag() {
    if (!drag.on) return;
    drag.on = false;
    seal.classList.remove("is-dragging");
    spin.v = Math.max(-240, Math.min(240, drag.vel));
    if (!drag.moved && drag.target && !drag.target.disabled) select(Number(drag.target.dataset.id));
    drag.target = null;
    setTimeout(function () { drag.moved = false; }, 0);
  }
  seal.addEventListener("pointerup", endDrag);
  seal.addEventListener("pointercancel", endDrag);
  seal.addEventListener("lostpointercapture", endDrag);

  function tick(now) {
    var dt = Math.min(0.05, (now - (spin.last || now)) / 1000); spin.last = now;
    if (!reduceMotion) {
      tilt.tx += (tilt.gx - tilt.tx) * Math.min(1, dt * 4);
      tilt.ty += (tilt.gy - tilt.ty) * Math.min(1, dt * 4);
      sealRot.style.setProperty("--tx", tilt.tx.toFixed(2));
      sealRot.style.setProperty("--ty", tilt.ty.toFixed(2));
    }
    if (!drag.on && !reduceMotion) {
      var target = spin.hover ? 0 : spin.idle;
      spin.v += (target - spin.v) * Math.min(1, dt * 1.6);   // ease back toward the idle speed
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
    worldOrder = names;
    names.forEach(function (w, i) {
      var lv = state.levels.filter(function (l) { return l.world === w; });
      var cleared = lv.filter(function (l) { return done.has(l.id); }).length;
      var b = make("button", "world" + (cleared === lv.length ? " is-done" : ""));
      b.type = "button"; b.dataset.world = w;
      b.append(make("span", "world-num", "World " + pad2(i + 1) + " · " + pad2(lv[0].id) + "–" + pad2(lv[lv.length - 1].id)));
      b.append(make("span", "world-name", worldName(w)));
      b.append(make("span", "world-count", cleared + " / " + lv.length + " cleared"));
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
  function meters() { $("#m-candles").textContent = state.candles; $("#m-digs").textContent = state.digs; }
  function busy(v) { state.busy = v; ["send", "claim", "turn-input", "claim-input"].forEach(function (id) { $("#" + id).disabled = v; }); }

  /* ------------------------------------------------------------------
     Level flow
     ------------------------------------------------------------------ */

  function select(id) {
    if (id > unlocked() || state.busy) return;
    state.selected = id;
    store.set("selected", String(id));
    markSelected();
    var lv = state.levels.find(function (x) { return x.id === id; });
    if (!lv) return;
    $("#crypt-title").textContent = "Level " + pad2(id) + " · " + lv.name;
    $("#seal-note").textContent = done.has(id) ? worldName(lv.world) + ". Cleared. Enter again to try another approach." : worldName(lv.world) + ". The gate is open.";
    start(lv);
  }

  function start(lv) {
    busy(true);
    status("");
    familiar("waiting", true);
    api("start", { playerId: player, levelId: lv.id }).then(function (res) {
      state.level = res.level;
      state.history = [];
      state.candles = res.candles;
      state.digs = res.digs;
      meters();
      $("#chat").replaceChildren();
      message("guard", "Level " + pad2(lv.id) + ". " + lv.name + ". You have " + res.candles + " messages and " + res.digs + " words to speak. Ask what you will.");
      if (res.level.channel && res.level.channel !== "chat") message("system", "This level reads your text as a " + res.level.channel + ".");
      familiar("idle", true);
    }).catch(function (e) {
      message("system", e.message);
      familiar("failed", false);
    }).then(function () { busy(false); });
  }

  $("#turn-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#send").click(); }
  });

  $("#turn-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy || !state.level) return;
    var text = $("#turn-input").value.trim();
    if (!text) return;
    if (state.candles <= 0) { status("No messages left in this level. Pick it again on the seal to restart."); familiar("failed", false); return; }
    message("you", text);
    state.lastMessage = text;
    $("#turn-input").value = "";
    busy(true);
    familiar("waiting", true);
    var thinking = message("system", "The Gravekeeper considers…");
    api("turn", { playerId: player, levelId: state.level.id, message: text, history: state.history }).then(function (res) {
      thinking.remove();
      if (res.closed) { message("system", res.reason || "The crypt is closed for today."); familiar("failed", false); return; }
      state.candles = Math.max(0, state.candles - 1);
      meters();
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
    if (state.digs <= 0) { status("No words left to speak in this level."); familiar("failed", false); return; }
    busy(true);
    familiar("waiting", true);
    api("claim", { playerId: player, levelId: state.level.id, claim: word, winningMessage: state.lastMessage }).then(function (res) {
      if (!res.win) {
        state.digs = Math.max(0, state.digs - 1);
        meters();
        message("system", "The seal does not move. " + state.digs + " words left.");
        familiar("failed", false);
        return;
      }
      done.add(state.level.id);
      store.set("done", JSON.stringify(Array.from(done)));
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

  function showReveal(rv) {
    $("#reveal-title").textContent = "Level " + pad2(state.level.id) + " opens.";
    $("#reveal-secret").textContent = rv.secret;
    $("#reveal-lesson").textContent = rv.lesson || "";
    $("#reveal-guard").textContent = rv.guardPrompt || "";
    var dlg = $("#reveal");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  $("#close-reveal").addEventListener("click", function () { $("#reveal").close(); familiar("idle", true); });
  $("#next-crypt").addEventListener("click", function () {
    $("#reveal").close();
    select(Math.min(state.level.id + 1, TOTAL));
  });

  /* ------------------------------------------------------------------
     Pointer tracking: Damien looks toward the cursor
     ------------------------------------------------------------------ */

  var lookTimer = null;
  document.addEventListener("pointermove", function (e) {
    if (!famReady || state.busy || reduceMotion) return;
    var r = fam.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    var deg = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;   // y up, like the sheet
    var row = deg < 180 ? SPRITE.rows.lookA : SPRITE.rows.lookB;
    var frame = Math.floor(((deg % 180) / 180) * row[1]);
    clearInterval(famTimer);
    setFrame(row[0], frame);
    clearTimeout(lookTimer);
    lookTimer = setTimeout(function () { if (!state.busy) familiar("idle", true); }, 1400);
  });

  /* ------------------------------------------------------------------
     Boot the game
     ------------------------------------------------------------------ */

  drawArt();
  api("levels").then(function (res) {
    state.levels = res.levels;
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
