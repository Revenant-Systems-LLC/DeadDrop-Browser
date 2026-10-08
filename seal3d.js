/* Dead Drop — 3D Metatron's cube seal. Opt-in via ?seal=3d.
   The flat SVG seal becomes five nested Platonic solids drawn as a glowing
   wireframe, tumbled on a quaternion trackball with real fling momentum.
   The level buttons stay HTML; each frame we project its vertex to a
   screen point and set left/top + depth. Grabbing brakes the spin. Selecting
   a level dollies the camera into that node.

   No WebGL, no dependency: this is a quaternion, a projection and six SVG
   paths. When the flag is absent this file does nothing and main.js runs the
   2D seal exactly as before. */
(function () {
  "use strict";
  // 3D is the default seal. ?seal=2d is an escape hatch back to the flat seal.
  if (/[?&]seal=2d\b/.test(location.search)) return;
  window.__SEAL3D__ = true;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- vec / quaternion */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function qMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }
  function qNorm(q) { var l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function qAxis(axis, ang) {
    var a = norm(axis), s = Math.sin(ang / 2);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)];
  }
  function qRot(q, v) {
    // t = 2 * cross(q.xyz, v); v' = v + q.w*t + cross(q.xyz, t)
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    var tx = 2 * (qy * v[2] - qz * v[1]);
    var ty = 2 * (qz * v[0] - qx * v[2]);
    var tz = 2 * (qx * v[1] - qy * v[0]);
    return [
      v[0] + qw * tx + (qy * tz - qz * ty),
      v[1] + qw * ty + (qz * tx - qx * tz),
      v[2] + qw * tz + (qx * ty - qy * tx),
    ];
  }
  // shortest-arc quaternion taking unit vector a onto unit vector b
  function qBetween(a, b) {
    var d = dot(a, b);
    if (d > 0.99999) return [0, 0, 0, 1];
    if (d < -0.99999) { var ax = cross([1, 0, 0], a); if (len(ax) < 1e-4) ax = cross([0, 1, 0], a); ax = norm(ax); return [ax[0], ax[1], ax[2], 0]; }
    var c = cross(a, b);
    return qNorm([c[0], c[1], c[2], 1 + d]);
  }
  function qSlerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
    if (d > 0.9995) return qNorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    var th0 = Math.acos(d), th = th0 * t, s0 = Math.sin(th0), s1 = Math.sin(th0 - th) / s0, s2 = Math.sin(th) / s0;
    return [a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2, a[3] * s1 + b[3] * s2];
  }

  /* ---------------------------------------------------------------- geometry: five solids */
  var PHI = (1 + Math.sqrt(5)) / 2, IPHI = 1 / PHI;

  function scaleToCircum(verts, R) {
    var cr = 0; verts.forEach(function (v) { cr = Math.max(cr, len(v)); });
    var k = R / (cr || 1);
    return verts.map(function (v) { return [v[0] * k, v[1] * k, v[2] * k]; });
  }
  // edges = every pair at the solid's minimum vertex distance (regular solids: all edges equal)
  function edgesOf(verts) {
    var min = Infinity, i, j, d;
    for (i = 0; i < verts.length; i++) for (j = i + 1; j < verts.length; j++) { d = len(sub(verts[i], verts[j])); if (d < min) min = d; }
    var e = [], tol = min * 1.02;
    for (i = 0; i < verts.length; i++) for (j = i + 1; j < verts.length; j++) if (len(sub(verts[i], verts[j])) <= tol) e.push([i, j]);
    return e;
  }

  var CUBE = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]];
  var OCTA = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  var TET1 = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
  var TET2 = [[-1, -1, -1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]];
  var ICO = [
    [0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI],
    [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0],
    [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1],
  ];
  var DODEC = CUBE.concat([
    [0, IPHI, PHI], [0, IPHI, -PHI], [0, -IPHI, PHI], [0, -IPHI, -PHI],
    [IPHI, PHI, 0], [IPHI, -PHI, 0], [-IPHI, PHI, 0], [-IPHI, -PHI, 0],
    [PHI, 0, IPHI], [PHI, 0, -IPHI], [-PHI, 0, IPHI], [-PHI, 0, -IPHI],
  ]);

  // Shells, outer to inner. Star tetrahedron rides the cube's corners (the Merkaba).
  var SOLIDS = [
    { name: "icosa", verts: scaleToCircum(ICO, 1.00), col: "#fff3dc" },
    { name: "dodec", verts: scaleToCircum(DODEC, 0.86), col: "#f3dcb4" },
    { name: "cube", verts: scaleToCircum(CUBE, 0.66), col: "#f3dcb4" },
    { name: "tet1", verts: scaleToCircum(TET1, 0.66), col: "#ffe6b0" },
    { name: "tet2", verts: scaleToCircum(TET2, 0.66), col: "#ffe6b0" },
    { name: "octa", verts: scaleToCircum(OCTA, 0.40), col: "#fff3dc" },
  ];
  SOLIDS.forEach(function (s) { s.edges = edgesOf(s.verts); });

  // Unique lattice vertices (round to dedupe shared points), sorted outer -> in.
  var VERTS = [];
  (function () {
    var seen = {};
    SOLIDS.forEach(function (s) {
      s.verts.forEach(function (v) {
        var key = v.map(function (n) { return n.toFixed(3); }).join(",");
        if (!seen[key]) { seen[key] = 1; VERTS.push(v); }
      });
    });
    VERTS.sort(function (a, b) { return len(b) - len(a); });
  })();

  // Level buttons -> a vertex. The final level sits dead centre; the rest spread
  // from the outermost vertex inward across the lattice. The count comes from
  // the buttons main.js draws (15 on the fantasy ladder, 35 on the crypt), so
  // the seal follows whichever campaign the server serves.
  var CENTER = [0, 0, 0];
  var slotFor = {}, FINAL = 0, slotted = 0;

  // The lattice's five-fold axis: through an icosahedron vertex. Around it the
  // icosahedron has a pentagonal ring of five vertices and the dodecahedron a
  // pentagonal face of five, both centred on the axis. Those two pentagons plus
  // the inner tetrahedron's four corners and the centre make 15 seats, one
  // world per shell, outside in. The camera opens looking down this axis.
  var AXIS = norm(ICO[0]);
  function azimuth(v) {                                   // angle around AXIS, for ordering a ring
    var u = norm(cross(AXIS, Math.abs(AXIS[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), w = cross(AXIS, u);
    return Math.atan2(dot(v, w), dot(v, u));
  }
  function ring(verts, pick) {
    var r = verts.map(function (v) { return { v: v, d: dot(norm(v), AXIS) }; }).filter(pick)
      .map(function (o) { return o.v; });
    r.sort(function (a, b) { return azimuth(a) - azimuth(b); });
    return r;
  }
  var RING_OUTER = ring(SOLIDS[0].verts, function (o) { return o.d > 0.3 && o.d < 0.6; });   // icosa upper pentagon (5)
  var RING_MID = ring(SOLIDS[1].verts, function (o) { return o.d > 0.7; });                   // dodeca top face (5)
  var RING_INNER = ring(SOLIDS[3].verts, function () { return true; });                       // tetrahedron (4)

  function slot(nodes) {
    if (nodes.length === slotted) return;
    slotted = nodes.length;
    slotFor = {}; FINAL = 0;
    var ids = [], tiers = {};
    for (var i = 0; i < nodes.length; i++) { ids.push(+nodes[i].dataset.id); tiers[+nodes[i].dataset.id] = +nodes[i].dataset.tier; }
    ids.sort(function (a, b) { return a - b; });
    if (!ids.length) return;
    FINAL = ids[ids.length - 1];
    slotFor[FINAL] = CENTER;
    var byTier = [[], [], []], tiered = ids.every(function (id) { return !isNaN(tiers[id]) && tiers[id] >= 0 && tiers[id] <= 2; });
    if (tiered && RING_OUTER.length === 5 && RING_MID.length === 5) {
      ids.forEach(function (id) { if (id !== FINAL) byTier[tiers[id]].push(id); });
      if (byTier[0].length <= 5 && byTier[1].length <= 5 && byTier[2].length <= 4) {
        byTier[0].forEach(function (id, k) { slotFor[id] = RING_OUTER[k]; });
        byTier[1].forEach(function (id, k) { slotFor[id] = RING_MID[k]; });
        byTier[2].forEach(function (id, k) { slotFor[id] = RING_INNER[k]; });
        return;
      }
    }
    // Any other campaign: fill from the outermost vertex inward.
    for (var k = 0; k < ids.length - 1; k++) slotFor[ids[k]] = VERTS[k];
  }

  /* ---------------------------------------------------------------- state */
  var seal, sealRot, wrap, svg, ePaths = [], vPaths = [];
  var BUCKETS = [
    { min: 0.34, w: 0.55, o: 0.95, dot: 0.9 },   // near
    { min: -0.34, w: 0.4, o: 0.6, dot: 0.5 },    // mid
    { min: -9, w: 0.3, o: 0.26, dot: 0.28 },     // far
  ];

  // Opening view: down the five-fold axis so the three rings read as nested
  // pentagons, with a small tilt so the lattice has depth from the first frame.
  var q = qMul(qAxis([1, 0.35, 0], 0.42), qBetween(AXIS, [0, 0, 1]));
  var vel = { axis: [0.3, 1, 0.15], mag: 0 };    // deg/s about axis
  var IDLE = reduceMotion ? 0 : 14, SPIN_MAX = 1400;
  var zoom = 1, zoomTarget = 1, pan = [0, 0], panTarget = [0, 0];
  var focusQ = null, focusT = 0;                 // active slerp to face a node
  var last = 0;
  // Don't dolly into a node on the boot auto-select; show the whole cube first,
  // then zoom on a real click. Ready after a beat, or the moment you grab it.
  var ready = false;
  setTimeout(function () { ready = true; }, 1600);

  var drag = { on: false, moved: false, tapId: 0, lx: 0, ly: 0, x0: 0, y0: 0, vx: 0, vy: 0, lastT: 0 };

  var S = 46, CAM = 3.4;                          // svg units per world unit; camera distance

  function project(v) {
    var r = qRot(q, v);
    var persp = CAM / (CAM - r[2]);
    return {
      x: 50 + (r[0] * persp * zoom + pan[0]) * S,
      y: 50 - (r[1] * persp * zoom + pan[1]) * S,
      z: r[2], persp: persp,
    };
  }

  /* ---------------------------------------------------------------- build DOM once */
  function build() {
    seal = document.getElementById("seal");
    sealRot = document.getElementById("seal-rot");
    wrap = document.getElementById("seal-nodes");
    if (!seal || !sealRot || !wrap) return false;
    seal.classList.add("seal-3d");

    var NS = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");   // map 1:1 to the node grid so a number can't drift off its vertex
    svg.setAttribute("id", "seal-3d-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<defs><filter id="glow3d" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.8"/></filter></defs>';
    // far -> near so nearer strokes paint on top
    for (var b = BUCKETS.length - 1; b >= 0; b--) {
      var g = document.createElementNS(NS, "g");
      if (b === 0) g.setAttribute("filter", "url(#glow3d)");
      var ep = document.createElementNS(NS, "path");
      ep.setAttribute("fill", "none");
      ep.setAttribute("stroke", BUCKETS[b].col || "#f3dcb4");
      ep.setAttribute("stroke-width", BUCKETS[b].w);
      ep.setAttribute("opacity", BUCKETS[b].o);
      ep.setAttribute("stroke-linecap", "round");
      var vp = document.createElementNS(NS, "path");
      vp.setAttribute("fill", "#fff3dc");
      vp.setAttribute("opacity", BUCKETS[b].dot);
      g.appendChild(ep); g.appendChild(vp);
      svg.appendChild(g);
      ePaths[b] = ep; vPaths[b] = vp;
    }
    sealRot.insertBefore(svg, wrap);
    wire();
    return true;
  }

  function bucketOf(z) { return z >= BUCKETS[0].min ? 0 : z >= BUCKETS[1].min ? 1 : 2; }
  function circlePath(x, y, r) {
    return "M" + (x - r).toFixed(2) + " " + y.toFixed(2) +
      "a" + r.toFixed(2) + " " + r.toFixed(2) + " 0 1 0 " + (2 * r).toFixed(2) + " 0" +
      "a" + r.toFixed(2) + " " + r.toFixed(2) + " 0 1 0 " + (-2 * r).toFixed(2) + " 0z";
  }

  /* ---------------------------------------------------------------- per-frame */
  function draw() {
    var eb = ["", "", ""], vb = ["", "", ""], i, s, e, p;
    // lattice edges
    for (i = 0; i < SOLIDS.length; i++) {
      s = SOLIDS[i];
      var pr = s.verts.map(project);
      for (e = 0; e < s.edges.length; e++) {
        var a = pr[s.edges[e][0]], c = pr[s.edges[e][1]];
        eb[bucketOf((a.z + c.z) / 2)] += "M" + a.x.toFixed(2) + " " + a.y.toFixed(2) + "L" + c.x.toFixed(2) + " " + c.y.toFixed(2);
      }
      for (e = 0; e < pr.length; e++) { p = pr[e]; vb[bucketOf(p.z)] += circlePath(p.x, p.y, (0.7 + 0.5 * p.persp) * (0.5 + 0.5 * zoom / 2)); }
    }
    for (i = 0; i < 3; i++) { ePaths[i].setAttribute("d", eb[i] || "M0 0"); vPaths[i].setAttribute("d", vb[i] || "M0 0"); }

    // level buttons
    var nodes = wrap.children;
    slot(nodes);
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i], id = +n.dataset.id, v = slotFor[id];
      if (!v) continue;
      p = project(v);
      var sc = (0.62 + 0.5 * p.persp) * (id === FINAL ? 1.15 : 1) * (1 + (zoom - 1) * 0.5);
      n.style.left = p.x + "%";
      n.style.top = p.y + "%";
      n.style.transform = "translate(-50%,-50%) scale(" + sc.toFixed(3) + ")";
      n.style.opacity = (p.z > 0 ? 0.9 + 0.1 * p.z : 0.4 + 0.35 * (1 + p.z)).toFixed(3);
      n.style.zIndex = String(1000 + Math.round(p.z * 400));
      n.style.pointerEvents = p.z < -0.15 ? "none" : "auto";
    }
  }

  /* ---------------------------------------------------------------- tick */
  function step(dt) {
    if (focusQ) {
      focusT = Math.min(1, focusT + dt / 0.55);
      q = qSlerp(q, focusQ, easeOut(focusT));
      if (focusT >= 1) focusQ = null;
      vel.mag = 0;
    } else if (drag.on) {
      vel.mag = 0;
    } else if (!reduceMotion) {
      // coast: a hard fling bleeds off slowly, then settles into the idle drift.
      // No hover-brake in 3D — nodes sweep under a resting cursor, which would
      // stutter the tumble; grabbing it is the way to stop it.
      var target = IDLE;
      var k = Math.abs(vel.mag) > IDLE + 0.5 ? 0.5 : 1.4;
      vel.mag += (target - vel.mag) * Math.min(1, dt * k);
      if (Math.abs(vel.mag) > 0.01) q = qMul(qAxis(vel.axis, vel.mag * Math.PI / 180 * dt), q);
      q = qNorm(q);
    }
    // camera easing
    zoom += (zoomTarget - zoom) * Math.min(1, dt * 6);
    pan[0] += (panTarget[0] - pan[0]) * Math.min(1, dt * 6);
    pan[1] += (panTarget[1] - pan[1]) * Math.min(1, dt * 6);
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function tick(now) {
    var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    step(dt);
    draw();
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------------- pointer: trackball + fling + brake */
  function wire() {
    seal.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      drag.on = true; drag.moved = false;
      drag.x0 = drag.lx = e.clientX; drag.y0 = drag.ly = e.clientY;
      drag.vx = drag.vy = 0; drag.lastT = performance.now();
      var t = e.target.closest ? e.target.closest(".node") : null;
      drag.tapId = t ? +t.dataset.id : 0;    // any node, even a sealed one (it still dollies)
      vel.mag = 0;                    // grab brakes the spin (catch it)
      focusQ = null; ready = true;
      try { seal.setPointerCapture(e.pointerId); } catch (x) {}
      seal.classList.add("is-dragging");
    });
    seal.addEventListener("pointermove", function (e) {
      // hover-brake: pointer resting on a node holds it still
      if (!drag.on) { hoverNode = !!(e.target.closest && e.target.closest(".node")); return; }
      var dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
      if (!drag.moved) return;
      var now = performance.now(), dt = Math.max(1, now - drag.lastT);
      var K = 0.42;                  // deg of turn per px dragged
      var ang = Math.hypot(dx, dy) * K;
      if (ang > 0.0001) {
        var axis = norm([dy, dx, 0]);
        q = qMul(qAxis(axis, ang * Math.PI / 180), q); q = qNorm(q);
      }
      // instantaneous angular speed for the fling (deg/s), EMA like the 2D seal
      var inst = Math.hypot(dx, dy) * K / dt * 1000;
      drag.vx = drag.vx * 0.4 + (dy) * 0.6; drag.vy = drag.vy * 0.4 + (dx) * 0.6;
      drag._mag = (drag._mag || 0) * 0.4 + inst * 0.6;
      drag.lx = e.clientX; drag.ly = e.clientY; drag.lastT = now;
    });
    function end(e) {
      if (!drag.on) return;
      drag.on = false;
      seal.classList.remove("is-dragging");
      var stale = performance.now() - drag.lastT > 90;
      if (!drag.moved && drag.tapId) {              // a tap: open it if unlocked, else just dolly to it
        var el = document.querySelector('#seal-nodes .node[data-id="' + drag.tapId + '"]');
        if (el && !el.disabled) { if (window.__ddSelect) window.__ddSelect(drag.tapId); }
        else focus(drag.tapId);
      } else if (!stale && (Math.abs(drag.vx) + Math.abs(drag.vy)) > 0.5) {
        vel.axis = norm([drag.vx, drag.vy, 0]);
        vel.mag = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, drag._mag || 0));
      } else {
        vel.mag = 0;
      }
      drag._mag = 0;
    }
    seal.addEventListener("pointerup", end);
    seal.addEventListener("pointercancel", end);
    seal.addEventListener("lostpointercapture", end);
    // click empty space -> zoom back out
    seal.addEventListener("dblclick", function () { zoomTarget = 1; panTarget = [0, 0]; });
  }

  /* ---------------------------------------------------------------- public: zoom to a node on select */
  function focus(id) {
    if (!ready) return;                          // skip the boot auto-select; overview first
    var v = slotFor[id];
    if (!v) return;
    if (id === FINAL) { zoomTarget = 2.4; panTarget = [0, 0]; focusQ = null; return; }
    focusQ = qMul(qBetween(norm(qRot(q, v)), [0, 0, 1]), q);  // bring this vertex to face the camera
    focusQ = qNorm(focusQ);
    focusT = 0;
    zoomTarget = 2.1;
    panTarget = [0, 0];
  }

  window.Seal3D = { onDraw: function () {}, focus: focus };
  window.Seal3D.debug = function () { return { zoom: zoom, zoomTarget: zoomTarget, ready: ready, focus: !!focusQ, mag: vel.mag }; };
  window.Seal3D.slotXY = function (id) { var v = slotFor[id]; if (!v) return null; var p = project(v); return { x: p.x, y: p.y, z: p.z }; };  // viewBox coords of a level's vertex

  /* ---------------------------------------------------------------- boot */
  function boot() {
    if (!build()) { setTimeout(boot, 60); return; }
    requestAnimationFrame(tick);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
