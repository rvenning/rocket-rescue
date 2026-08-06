// The Rocket Rescue engine.
//
// You fly a tiny ship down a scrolling cave, scoop up the creatures stranded in
// it, and reach daylight with some hull left. The cave itself is the enemy;
// the hazards inside it are the punctuation.
//
// This file is simulation ONLY — no canvas, no DOM, no Math.random. Everything
// in the world is a pure function of the scroll position `camX` (see
// hazards.js), so the headless bots in tests/ drive the real engine, and a
// replayed cave is the same cave every time. Drawing and the HUD live in
// render.js.

/* ---------------------------------------------------------------- feel -- */
// A damped spring, not a constant-velocity chase. A chase moves a 5px
// correction and a 200px sweep at the same speed, which feels sluggish up close
// and laggy far away; a spring is proportional, so it snaps for small
// corrections and still crosses the cave quickly. MAX_V is a sanity limit, NOT
// a difficulty knob — a deliberate swipe must never meet it.
const SHIP = {
  ACC: 80,        // spring constant, pull toward the target
  // Damping ratio ~0.84: enough bounce to feel like a ship rather than a
  // cursor, little enough that reaching for something beside a wall doesn't
  // sail you into it. At 0.67 a perfect pilot still scraped once a cave.
  DAMP: 15,
  MAX_V: 900,
  KEY_V: 300,     // how fast the keyboard walks the target around
};

const RULES = {
  // Four, not three. An ordinary pilot scrapes two or three times crossing a
  // late cave; at three hull that is the difference between a hard cave and a
  // wall, and the rule that outranks difficulty is that being stuck is not
  // allowed. Stars still demand a clean flight, so the top grade is untouched.
  HULL: 4,
  // Reaching daylight is not a clear on its own — this is a RESCUE. Without a
  // quota, a ship nobody was flying drifted the length of five caves, picked up
  // whatever floated into it and unlocked the campaign by being left alone.
  // Set low enough that an ordinary flight (which brings home ~all of them)
  // never meets it, and high enough that nobody clears a cave by accident.
  RESCUE_QUOTA: 0.6,
  IFRAMES: 1.35,
  // Scoop radius beyond the ship's own body. Deliberately small: at 9 the
  // combined reach covered most of a tunnel's width, so creatures fell into a
  // ship flying straight and a stick nobody touched cleared four caves. Keeping
  // it tight is also what gives Wide Beam something to sell.
  PICKUP: 7,
  MAGNET_RANGE: 56,      // the tractor beam simply widens the scoop
  SLOW_MUL: 0.5,
  PX_PER_M: 16,
  DUST_RESCUE: 12,
  DUST_STAR: 30,
  DUST_ENDLESS_RESCUE: 8,
  DUST_ENDLESS_PER_M: 0.05,
  HULL_BONUS: 250,       // score per hull point still attached at daylight
  CLEAN_BONUS: 500,      // score for reaching daylight without a scrape
};

const Game = {
  canvas: null, ctx: null, DPR: 1, scale: 1, viewLW: LW, viewLH: LH, offX: 0, offY: 0,
  active: false, running: false, paused: false,
  mode: "cave",
  input: { tx: 120, ty: LH / 2, dragging: false, lastX: 0, lastY: 0, keys: {} },
  _last: 0,

  /* ============================ boot / canvas ============================ */
  boot() {
    this.canvas = document.getElementById("cv");
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    const re = () => this.resize();
    window.addEventListener("resize", re);
    // iOS settles its viewport lazily (toolbars, rotation, standalone launch),
    // so measure again well after the event as well as on it.
    window.addEventListener("orientationchange", () => setTimeout(re, 350));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", re);
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.running) this.pause(); });
    this.bindInput();
    this._last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // The game screen is display:none until it is shown, which measures 0x0 —
    // retry rather than caching a broken layout.
    if (!w || !h) { setTimeout(() => this.resize(), 200); return; }
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    // A canvas is a replaced element: the width/height ATTRIBUTES are the
    // backing store. css/style.css pins the DISPLAY size to 100%/100% so it can
    // never disagree with the stage — setting an inline pixel size here would
    // be a snapshot that goes stale the moment anything reflows.
    this.canvas.width = Math.round(w * this.DPR);
    this.canvas.height = Math.round(h * this.DPR);
    this.scale = Math.min(w / LW, h / LH);
    this.viewLW = w / this.scale;
    this.viewLH = h / this.scale;
    this.offX = (this.viewLW - LW) / 2;
    this.offY = (this.viewLH - LH) / 2;
  },

  /* ================================ input ================================ */
  // Touch steers RELATIVELY: the ship follows your finger's movement rather
  // than jumping to it, so a thumb never sits on top of the thing it is flying.
  // A mouse steers absolutely, which is what a mouse is for. Arrow keys walk
  // the same target, so all three paths end in one place.
  bindInput() {
    const I = this.input;
    const stage = document.querySelector(".game-stage");

    const local = (clientX, clientY) => {
      const r = stage.getBoundingClientRect();
      return {
        x: (clientX - r.left) / (r.width / this.viewLW) - this.offX,
        y: (clientY - r.top) / (r.height / this.viewLH) - this.offY,
      };
    };
    const setAbs = (p) => { I.tx = p.x; I.ty = p.y; };
    const moveRel = (p) => {
      I.tx += p.x - I.lastX;
      I.ty += p.y - I.lastY;
      I.lastX = p.x; I.lastY = p.y;
    };

    stage.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      GK.Sfx.init();
      const p = local(e.clientX, e.clientY);
      I.dragging = true; I.lastX = p.x; I.lastY = p.y;
      // Capture, or a drag that strays over the pause button loses the pointer.
      if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
    }, { passive: false });

    // PointerEvent.pressure is ZERO for ordinary touch on iOS, so a
    // `if (e.pressure > 0)` guard silently drops every move of a swipe. Ask
    // what KIND of pointer it is instead.
    stage.addEventListener("pointermove", (e) => {
      const p = local(e.clientX, e.clientY);
      if (e.pointerType === "touch") { if (I.dragging) { e.preventDefault(); moveRel(p); } }
      else setAbs(p);
    }, { passive: false });

    // Some iOS builds are stingy with pointermove during a fast flick, so take
    // the raw touch stream too. Both paths end in the same call, which makes
    // the duplicate harmless.
    stage.addEventListener("touchmove", (e) => {
      if (!I.dragging || !e.touches.length) return;
      e.preventDefault();
      moveRel(local(e.touches[0].clientX, e.touches[0].clientY));
    }, { passive: false });

    const end = () => { I.dragging = false; };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.code === "Escape" || e.code === "KeyP") { e.preventDefault(); this.togglePause(); return; }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
        e.preventDefault();
        I.keys[e.code] = true;
      }
    });
    window.addEventListener("keyup", (e) => { I.keys[e.code] = false; });

    // iOS ignores user-scalable=no for pinch; block the gesture at the source.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
  },

  /* ============================== lifecycle ============================== */
  startCave(profile, caveIdx) {
    this.profile = profile;
    this.progress = profile ? Storage.getProgress(profile.id) : { upgrades: {} };
    this.reset("cave", CAVES[caveIdx], caveIdx);
    this.begin("cruise");
  },

  startEndless(profile, seedStr) {
    this.profile = profile;
    this.progress = profile ? Storage.getProgress(profile.id) : { upgrades: {} };
    this.reset("endless", Endless.create(seedStr), -1);
    this.begin("deep");
  },

  begin(track) {
    this.running = true; this.paused = false;
    GK.UI.showScreen("game");
    this.resize();                     // the stage only has a size once visible
    if (Music.enabled) Music.start(track);
  },

  // Full simulation reset. Deliberately free of profile, canvas and DOM so a
  // headless bot can drive a whole campaign with none of them.
  reset(mode, cave, caveIdx) {
    const up = (this.progress && this.progress.upgrades) || {};
    this.mode = mode;
    this.cave = cave;
    this.caveIdx = caveIdx;
    this.world = WORLDS[cave.world] || WORLDS[0];

    this.acc = SHIP.ACC * upgradeValue(up, "thrust", 1);
    this.scoop = SHIP_R + RULES.PICKUP + upgradeValue(up, "beam", 0);
    this.magnetMul = upgradeValue(up, "magnet", 1);
    this.chronoMul = upgradeValue(up, "chrono", 1);

    this.hullMax = RULES.HULL + upgradeValue(up, "hull", 0);
    this.hull = this.hullMax;
    this.shield = upgradeValue(up, "launch", 0) > 0;

    this.quota = mode === "endless" ? 0 : Math.ceil(cave.creatures.length * RULES.RESCUE_QUOTA);
    this.camX = 0;
    const s = Cave.sample(cave.path, 120);
    this.ship = { x: 120, y: s.c, vx: 0, vy: 0 };
    this.input.tx = 120; this.input.ty = s.c;

    this.iframes = 0;
    this.magnetT = 0;
    this.slowT = 0;
    this.rescued = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.points = 0;
    this.crashes = 0;
    this.elapsed = 0;
    this.hintT = 5;
    this.shapes = [];
    this.flying = [];        // creatures in flight to the hold (visual only)
    this.trail = [];
    this.result = null;
    for (const c of cave.creatures) c.got = false;
    for (const o of cave.orbs) o.got = false;
    if (typeof Fx !== "undefined") { Fx.reset(); Tween.clear(); }
  },

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    Music.stop();
    GK.UI.openModal("modal-pause");
  },
  resume() {
    GK.UI.closeModal("modal-pause");
    this.paused = false;
    this._last = performance.now();       // don't bill the pause to the next frame
    if (Music.enabled) Music.start(this.mode === "endless" ? "deep" : "cruise");
    Sfx.click();
  },
  togglePause() { this.paused ? this.resume() : this.pause(); },

  quit() {
    GK.UI.closeModal("modal-pause");
    this.running = false;
    Music.stop();
    App.caveOver(this.buildResult(false), true);
  },

  /* ================================ loop ================================= */
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const real = Math.min(0.05, (t - this._last) / 1000 || 0);
    this._last = t;
    if (!this.active) return;
    if (this.running && !this.paused) this.update(real);
    if (typeof Fx !== "undefined") Fx.update(real);
    this.render();
  },

  /* =============================== update ================================ */
  // Speed at a scroll position. The campaign is flat (a cave IS its speed);
  // the endless cave ramps.
  speedAt(camX) {
    const r = this.cave.speedRamp;
    if (!r) return this.cave.speed;
    return Math.min(r.cap, r.base + (camX / r.per) * r.gain);
  },

  update(dt) {
    // The loop already gates on this, but the guard makes the engine safe to
    // step from a bot or the console — without it, driving update() past a
    // wreck keeps simulating a dead run.
    if (!this.running || this.paused) return;
    this.elapsed += dt;
    if (this.hintT > 0) this.hintT -= dt;

    const slow = this.slowT > 0;
    this.camX += this.speedAt(this.camX) * (slow ? RULES.SLOW_MUL : 1) * dt;

    if (this.cave.endless) {
      Endless.ensure(this.cave, this.camX + LW * 2.5);
      Endless.prune(this.cave, this.camX);
      this.world = WORLDS[Endless.worldAt(this.camX)];
    }

    this.steer(dt);
    this.shapes = this.collectShapes(this.camX);
    this.collide();
    this.scoopUp();

    if (this.iframes > 0) this.iframes -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) Sfx.slowOff(); }
    for (const f of this.flying) f.t += dt * 3.2;
    this.flying = this.flying.filter((f) => f.t < 1);

    // Losing is checked BEFORE winning: both can become true in the same step
    // (the last scrape as daylight arrives), and the wrong order ships a win
    // nobody earned.
    if (this.hull <= 0) return this.finish(false);
    if (!this.cave.endless && this.camX >= this.cave.len) return this.finish(true);
  },

  // Both halves of "did you clear it": you got out, AND you brought enough of
  // them with you.
  escapedWith() { return this.rescued >= this.quota; },

  // Keyboard walks the same target the pointer sets, then a damped spring
  // carries the ship to it.
  steer(dt) {
    const I = this.input, p = this.ship;
    const k = I.keys;
    const kx = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    const ky = (k.ArrowDown || k.KeyS ? 1 : 0) - (k.ArrowUp || k.KeyW ? 1 : 0);
    if (kx) I.tx += kx * SHIP.KEY_V * dt;
    if (ky) I.ty += ky * SHIP.KEY_V * dt;
    I.tx = Math.max(BAND.x0, Math.min(BAND.x1, I.tx));
    I.ty = Math.max(6, Math.min(LH - 6, I.ty));

    p.vx += (I.tx - p.x) * this.acc * dt;
    p.vy += (I.ty - p.y) * this.acc * dt;
    const damp = Math.exp(-SHIP.DAMP * dt);
    p.vx *= damp; p.vy *= damp;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > SHIP.MAX_V) { p.vx *= SHIP.MAX_V / sp; p.vy *= SHIP.MAX_V / sp; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(BAND.x0, Math.min(BAND.x1, p.x));
    p.y = Math.max(2, Math.min(LH - 2, p.y));
  },

  worldX() { return this.camX + this.ship.x; },

  // Every solid thing near the ship, in world coordinates. Computed once per
  // frame and reused by the renderer so the picture and the physics cannot
  // disagree about where a rock is.
  collectShapes(camX) {
    const out = [];
    const wx = camX + this.ship.x;
    for (const h of this.cave.hazards) {
      if (h.type === "comet") {
        if (camX < h.x - COMET_LEAD || camX > h.x + 600) continue;
      } else if (Math.abs(h.x - wx) > LW) continue;
      for (const sh of hazardShapes(h, camX, this.cave.path)) out.push(sh);
    }
    return out;
  },

  collide() {
    if (this.iframes > 0) return;
    const p = this.ship, wx = this.worldX();

    // Rock. Three probes along the hull rather than one at the centre, so a
    // steep passage catches the nose and the tail as well as the middle.
    for (const dx of [-6, 0, 7]) {
      const s = Cave.sample(this.cave.path, wx + dx);
      if (p.y - SHIP_R < s.c - s.g / 2 || p.y + SHIP_R > s.c + s.g / 2) return this.crash("rock");
    }
    for (const sh of this.shapes) {
      if (hitsShape(sh, wx, p.y, SHIP_R)) return this.crash(sh.kind);
    }
  },

  crash(kind) {
    this.crashes++;
    this.iframes = RULES.IFRAMES;
    this.streak = 0;
    // Bounce off the rock — the MINIMUM extraction that gets the hull out of
    // the solid, not a teleport to the middle of the passage. Anything more
    // generous flies the ship for the player: with a re-centring recovery, a
    // stick nobody touched was shepherded through four caves, because every
    // crash quietly put it back on the safe line and gave it another go.
    // The i-frames are the mercy; correcting the course is still your job.
    const lane = freeLane(this.cave, this.camX, this.worldX());
    const lo = lane.mid - lane.width / 2 + SHIP_R + 1;
    const hi = lane.mid + lane.width / 2 - SHIP_R - 1;
    const clamp = (v) => (hi > lo ? Math.max(lo, Math.min(hi, v)) : lane.mid);
    this.ship.y = clamp(this.ship.y);
    this.input.ty = clamp(this.input.ty);
    this.ship.vx = 0; this.ship.vy = 0;

    if (this.shield) {
      this.shield = false;
      Sfx.shieldPop();
      if (typeof Fx !== "undefined") {
        Fx.burst(this.ship.x, this.ship.y, POWERUPS.shield.color, 16, 150, 0.5, 2.4);
        Fx.addShake(6);
      }
      return;
    }
    this.hull--;
    Sfx.crunch();
    if (typeof Fx !== "undefined") {
      Fx.burst(this.ship.x, this.ship.y, "#ff8a5c", 20, 170, 0.6, 2.8);
      Fx.addShake(10);
      Fx.addFlash(0.45, "#ff5a3c");
    }
  },

  scoopUp() {
    const p = this.ship, wx = this.worldX();
    const reach = this.magnetT > 0 ? RULES.MAGNET_RANGE * this.magnetMul : this.scoop;

    for (const c of this.cave.creatures) {
      if (c.got || Math.abs(c.x - wx) > reach + 40) continue;
      const pos = creaturePos(c, this.camX, this.cave.path);
      const dx = pos.x - wx, dy = pos.y - p.y;
      const spec = CREATURES[c.type];
      if (dx * dx + dy * dy > (reach + spec.r) * (reach + spec.r)) continue;
      c.got = true;
      this.rescued++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.points += spec.points;
      this.flying.push({ x: pos.x - this.camX, y: pos.y, type: c.type, t: 0 });
      if (c.type === "glimmer") Sfx.glimmer(); else Sfx.rescue(this.streak);
      if (typeof Fx !== "undefined") {
        Fx.sparkle(pos.x - this.camX, pos.y, spec.body, 6);
        Fx.text(pos.x - this.camX, pos.y, `+${spec.points}`, { color: spec.body, size: 11 });
      }
    }

    for (const o of this.cave.orbs) {
      if (o.got || Math.abs(o.x - wx) > 90) continue;
      const oy = Cave.place(this.cave.path, o.x, o.t);
      const dx = o.x - wx, dy = oy - p.y;
      const r = this.scoop + ORB_R;
      if (dx * dx + dy * dy > r * r) continue;
      o.got = true;
      this.takeOrb(o.type, o.x - this.camX, oy);
    }
  },

  takeOrb(type, sx, sy) {
    const spec = POWERUPS[type];
    if (type === "magnet") { this.magnetT = spec.dur * this.magnetMul; Sfx.magnetOn(); }
    else if (type === "slowmo") { this.slowT = spec.dur * this.chronoMul; Sfx.slowOn(); }
    else if (type === "shield") { this.shield = true; Sfx.orb(); }
    else if (type === "mend") {
      if (this.hull < this.hullMax) this.hull++;
      else this.points += 150;
      Sfx.mend();
    }
    if (typeof Fx !== "undefined") {
      Fx.burst(sx, sy, spec.color, 14, 130, 0.5, 2.4);
      Fx.text(sx, sy - 10, spec.name, { color: spec.color, size: 10 });
    }
  },

  /* =============================== results =============================== */
  metres() { return Math.floor(this.camX / RULES.PX_PER_M); },

  stars() {
    if (this.mode === "endless") return 0;
    const total = this.cave.creatures.length;
    if (this.rescued >= total && this.crashes === 0) return 3;
    if (this.rescued >= total) return 2;
    return 1;
  },

  buildResult(win, escaped = win) {
    if (this.mode === "endless") {
      const m = this.metres();
      return {
        mode: "endless", win: false, rescued: this.rescued, metres: m,
        bestStreak: this.bestStreak,
        score: this.points + m,
        dust: Math.round(this.rescued * RULES.DUST_ENDLESS_RESCUE + m * RULES.DUST_ENDLESS_PER_M),
        seedStr: this.cave.seedStr,
      };
    }
    const stars = win ? this.stars() : 0;
    const score = win
      ? this.points + this.hull * RULES.HULL_BONUS + (this.crashes === 0 ? RULES.CLEAN_BONUS : 0)
      : this.points;
    return {
      mode: "cave", win, escaped, caveIdx: this.caveIdx, stars, score,
      rescued: this.rescued, total: this.cave.creatures.length, quota: this.quota,
      crashes: this.crashes, hull: Math.max(0, this.hull),
      time: this.elapsed,
      dust: Math.round(this.rescued * RULES.DUST_RESCUE + stars * RULES.DUST_STAR),
    };
  },

  finish(escaped) {
    this.running = false;
    Music.stop();
    const win = escaped && this.escapedWith();
    const res = this.buildResult(win, escaped);
    this.result = res;
    if (win) Sfx.daylight();
    else if (escaped) Sfx.lose();      // you got out — just not with enough of them
    else Sfx.wreck();
    if (typeof Fx !== "undefined" && win) Fx.confetti(LW, LH, ["#7ef0c8", "#ffd166", "#c58bff", "#5ad1ff"], 70);
    if (typeof App !== "undefined") App.caveOver(res, false);
    return res;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { SHIP, RULES, Game });
