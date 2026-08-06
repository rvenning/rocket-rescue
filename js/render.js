// Drawing. Attached to Game so the simulation in game.js can stay canvas-free
// and the headless bots can skip this file entirely.
//
// The cave silhouette is traced from Cave.ceilAt/floorAt — the SAME functions
// the collision code samples — so the rock you can see is the rock you can hit.
// Hazards are drawn from the shape list game.js already computed this frame,
// for the same reason.
//
// Draw space is the fixed 400x225 logical stage. The real canvas is usually
// taller or wider, so rock is painted out past the stage edges: on a phone you
// simply get more cave above and below, never letterbox bars.

const STEP = 5;            // sampling step for the cave outline, logical px
const TRAIL_MAX = 96;

Object.assign(Game, {
  render() {
    const ctx = this.ctx;
    if (!ctx || !this.cave) return;
    const s = this.scale * this.DPR;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(this.offX, this.offY);

    const L = -this.offX, T = -this.offY;
    const R = LW + this.offX, B = LH + this.offY;
    const w = this.world;

    this.drawBack(ctx, w, L, T, R, B);

    const [shx, shy] = typeof Fx !== "undefined" ? Fx.shakeOffset() : [0, 0];
    ctx.save();
    ctx.translate(shx, shy);

    this.drawCave(ctx, w, L, T, R, B);
    this.drawOrbs(ctx);
    this.drawCreatures(ctx);
    this.drawHazards(ctx, w);
    this.drawTail(ctx);
    this.drawShip(ctx);

    if (typeof Fx !== "undefined") Fx.render(ctx);
    ctx.restore();

    if (typeof Fx !== "undefined" && Fx.flash > 0) {
      ctx.globalAlpha = Math.min(1, Fx.flash);
      ctx.fillStyle = Fx.flashColor;
      ctx.fillRect(L, T, R - L, B - T);
      ctx.globalAlpha = 1;
    }

    this.drawHints(ctx, L, R, B);
    this.syncHud();
  },

  /* ------------------------------ background ----------------------------- */
  drawBack(ctx, w, L, T, R, B) {
    const g = ctx.createLinearGradient(0, T, 0, B);
    g.addColorStop(0, w.back[0]);
    g.addColorStop(1, w.back[1]);
    ctx.fillStyle = g;
    ctx.fillRect(L, T, R - L, B - T);

    // Two parallax dust layers. hash2 returns a FLOAT 0-1, so it has to be
    // scaled before % or every mote lands in the same place.
    const cam = this.camX || 0;
    for (const [spd, alpha, size, seed] of [[0.12, 0.28, 1.2, 3], [0.3, 0.5, 1.7, 9]]) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = w.dust;
      const off = cam * spd;
      const first = Math.floor((off + L) / 34) - 1;
      const last = Math.ceil((off + R) / 34) + 1;
      for (let i = first; i <= last; i++) {
        const hy = (Math.floor(GK.util.hash2(i, seed) * 997) % 1000) / 1000;
        ctx.fillRect(i * 34 - off, T + hy * (B - T), size, size);
      }
      ctx.globalAlpha = 1;
    }
  },

  /* -------------------------------- cave --------------------------------- */
  drawCave(ctx, w, L, T, R, B) {
    const path = this.cave.path, cam = this.camX;

    const trace = (which) => {
      ctx.beginPath();
      ctx.moveTo(L - 4, which === "ceil" ? T - 4 : B + 4);
      for (let x = L - 4; x <= R + 4; x += STEP) {
        const y = which === "ceil" ? Cave.ceilAt(path, cam + x) : Cave.floorAt(path, cam + x);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(R + 4, which === "ceil" ? T - 4 : B + 4);
      ctx.closePath();
    };

    for (const side of ["ceil", "floor"]) {
      trace(side);
      const g = ctx.createLinearGradient(0, side === "ceil" ? T : B, 0, side === "ceil" ? LH * 0.6 : LH * 0.4);
      g.addColorStop(0, w.rock);
      g.addColorStop(1, w.rockLit);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = w.edge;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Crystals growing off the rock face. Stable per world-column, so they slide
    // past rather than shimmering.
    ctx.fillStyle = w.glow;
    const col = Math.floor((cam + L) / 26) - 1;
    for (let i = col; i <= Math.floor((cam + R) / 26) + 1; i++) {
      const h = Math.floor(GK.util.hash2(i, 5) * 997) % 100;
      if (h > 46) continue;
      const wx = i * 26 + (h % 9);
      const x = wx - cam;
      const up = h % 2 === 0;
      const y = up ? Cave.ceilAt(path, wx) : Cave.floorAt(path, wx);
      const len = 4 + (h % 7);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 2.4, y);
      ctx.lineTo(x + 2.4, y);
      ctx.lineTo(x, y + (up ? len : -len));
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Daylight at the end of a campaign cave — the thing you are flying toward.
    if (!this.cave.endless) {
      const ex = this.cave.len - cam;
      if (ex < R + 40) {
        const s = Cave.sample(path, this.cave.len);
        const gg = ctx.createLinearGradient(ex - 60, 0, ex + 20, 0);
        gg.addColorStop(0, "rgba(255,255,255,0)");
        gg.addColorStop(1, "rgba(255,255,240,0.85)");
        ctx.fillStyle = gg;
        ctx.fillRect(ex - 60, s.c - s.g / 2, 80 + Math.max(0, R - ex), s.g);
      }
    }
  },

  /* ------------------------------- hazards ------------------------------- */
  drawHazards(ctx, w) {
    const cam = this.camX;
    for (const sh of this.shapes) {
      const x = sh.x - cam;
      if (sh.kind === "laser") {
        ctx.fillStyle = "rgba(255,90,90,0.22)";
        ctx.fillRect(x - 3, sh.y, sh.w + 6, sh.h);
        ctx.fillStyle = "#ff5f5f";
        ctx.fillRect(x, sh.y, sh.w, sh.h);
        ctx.fillStyle = "#ffd9d9";
        ctx.fillRect(x + sh.w * 0.35, sh.y, sh.w * 0.3, sh.h);
        // emitter cap on the inner end, so the beam reads as machinery
        ctx.fillStyle = "#c9d3e8";
        const capY = sh.side === "top" ? sh.y + sh.h - 4 : sh.y - 1;
        ctx.fillRect(x - 3, capY, sh.w + 6, 5);
      } else if (sh.kind === "pillar") {
        ctx.fillStyle = w.rockLit;
        ctx.beginPath();
        if (sh.from === "top") {
          ctx.moveTo(x, sh.y); ctx.lineTo(x + sh.w, sh.y); ctx.lineTo(x + sh.w / 2, sh.y + sh.h);
        } else {
          ctx.moveTo(x, sh.y + sh.h); ctx.lineTo(x + sh.w, sh.y + sh.h); ctx.lineTo(x + sh.w / 2, sh.y);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = w.edge; ctx.lineWidth = 1.4; ctx.stroke();
      } else if (sh.kind === "comet") {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#ffd9a0";
        ctx.beginPath();
        ctx.moveTo(x + sh.r, sh.y - sh.r * 0.7);
        ctx.lineTo(x + sh.r + 34, sh.y);
        ctx.lineTo(x + sh.r, sh.y + sh.r * 0.7);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffb154";
        ctx.beginPath(); ctx.arc(x, sh.y, sh.r, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff0c9";
        ctx.beginPath(); ctx.arc(x - sh.r * 0.3, sh.y - sh.r * 0.3, sh.r * 0.4, 0, TAU); ctx.fill();
      } else {
        this.drawRock(ctx, w, x, sh);
      }
    }
  },

  drawRock(ctx, w, x, sh) {
    const guard = sh.kind === "guardian";
    ctx.fillStyle = guard ? w.rockLit : w.rock;
    ctx.strokeStyle = w.edge;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    // A stable jagged silhouette: the same rock is the same shape every frame.
    for (let i = 0; i <= 9; i++) {
      const a = (i / 9) * TAU + (sh.spin || 0) * (guard ? 0.15 : 0.6);
      const j = 0.8 + 0.22 * ((Math.floor(GK.util.hash2(Math.round(sh.x), i) * 997) % 100) / 100);
      const px = x + Math.cos(a) * sh.r * j;
      const py = sh.y + Math.sin(a) * sh.r * j;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    if (guard) {
      // Two big sleepy eyes: a Guardian is a creature, not scenery.
      const gaze = Math.sin(this.camX / 90) * sh.r * 0.1;
      for (const ex of [-0.32, 0.3]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x + ex * sh.r, sh.y - sh.r * 0.14, sh.r * 0.24, 0, TAU); ctx.fill();
        ctx.fillStyle = "#1a1030";
        ctx.beginPath(); ctx.arc(x + ex * sh.r + gaze, sh.y - sh.r * 0.14, sh.r * 0.12, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = w.glow;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, sh.y + sh.r * 0.3, sh.r * 0.34, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  },

  /* ------------------------------ creatures ------------------------------ */
  drawCreatures(ctx) {
    const cam = this.camX, R = LW + this.offX;
    for (const c of this.cave.creatures) {
      if (c.got) continue;
      const x = c.x - cam;
      if (x < -30 || x > R + 30) continue;
      const pos = creaturePos(c, cam, this.cave.path);
      this.drawCritter(ctx, CREATURES[c.type], x, pos.y, 1);
    }
    // Ones already scooped, flying home to the hold.
    for (const f of this.flying) {
      const t = f.t;
      const x = f.x + (this.ship.x - f.x) * t;
      const y = f.y + (this.ship.y - f.y) * t;
      ctx.globalAlpha = 1 - t * 0.7;
      this.drawCritter(ctx, CREATURES[f.type], x, y, 1 - t * 0.5);
      ctx.globalAlpha = 1;
    }
  },

  drawCritter(ctx, spec, x, y, k) {
    const r = spec.r * k;
    if (r < 0.6) return;
    // ears / antennae first, so the body overlaps their roots
    ctx.fillStyle = spec.body;
    for (let i = 0; i < spec.ears; i++) {
      const a = -Math.PI / 2 + (i - (spec.ears - 1) / 2) * 0.55;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 1.05, r * 0.26, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = spec.belly;
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.28, r * 0.55, r * 0.42, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = spec.blush;
    ctx.beginPath(); ctx.arc(x - r * 0.5, y + r * 0.12, r * 0.17, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.5, y + r * 0.12, r * 0.17, 0, TAU); ctx.fill();
    ctx.fillStyle = spec.eye;
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.12, r * 0.16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.28, y - r * 0.12, r * 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.2, r * 0.06, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.34, y - r * 0.2, r * 0.06, 0, TAU); ctx.fill();
  },

  /* --------------------------------- orbs -------------------------------- */
  drawOrbs(ctx) {
    const cam = this.camX, R = LW + this.offX;
    for (const o of this.cave.orbs) {
      if (o.got) continue;
      const x = o.x - cam;
      if (x < -30 || x > R + 30) continue;
      const spec = POWERUPS[o.type];
      const y = Cave.place(this.cave.path, o.x, o.t);
      const r = ORB_R + Math.sin(cam / 40 + o.x) * 0.9;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = spec.color;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = spec.color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, TAU); ctx.fill();
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(spec.icon, x, y + 0.5);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
  },

  /* --------------------------- ship and its tail ------------------------- */
  // The rescued creatures stream along behind you. Purely decorative, but it is
  // the running score a five-second glance can read.
  drawTail(ctx) {
    const t = this.trail;
    t.push({ x: this.ship.x, y: this.ship.y });
    if (t.length > TRAIL_MAX) t.shift();
    const n = Math.min(this.rescued, 8);
    for (let i = 0; i < n; i++) {
      const idx = t.length - 1 - (i + 1) * 10;
      if (idx < 0) break;
      const p = t[idx];
      const spec = CREATURE_LIST[i % CREATURE_LIST.length];
      ctx.globalAlpha = 0.9 - i * 0.07;
      this.drawCritter(ctx, spec, p.x, p.y, 0.62);
      ctx.globalAlpha = 1;
    }
  },

  drawShip(ctx) {
    const p = this.ship;
    ctx.save();
    if (this.iframes > 0 && Math.floor(this.iframes * 18) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.max(-0.5, Math.min(0.5, p.vy / 620)));

    // exhaust
    const flare = 5 + Math.sin(this.elapsed * 40) * 2.2;
    ctx.fillStyle = "#ff9c3c";
    ctx.beginPath();
    ctx.moveTo(-SHIP_W / 2, -3); ctx.lineTo(-SHIP_W / 2 - flare, 0); ctx.lineTo(-SHIP_W / 2, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffe37a";
    ctx.beginPath();
    ctx.moveTo(-SHIP_W / 2, -1.6); ctx.lineTo(-SHIP_W / 2 - flare * 0.55, 0); ctx.lineTo(-SHIP_W / 2, 1.6);
    ctx.closePath(); ctx.fill();

    // fins
    ctx.fillStyle = "#e2556f";
    ctx.beginPath();
    ctx.moveTo(-SHIP_W * 0.3, -SHIP_H / 2); ctx.lineTo(-SHIP_W * 0.46, -SHIP_H * 0.95); ctx.lineTo(-SHIP_W * 0.02, -SHIP_H / 2 + 1);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-SHIP_W * 0.3, SHIP_H / 2); ctx.lineTo(-SHIP_W * 0.46, SHIP_H * 0.95); ctx.lineTo(-SHIP_W * 0.02, SHIP_H / 2 - 1);
    ctx.closePath(); ctx.fill();

    // hull
    ctx.fillStyle = "#f4f7ff";
    ctx.beginPath();
    ctx.moveTo(SHIP_W / 2, 0);
    ctx.quadraticCurveTo(SHIP_W * 0.1, -SHIP_H / 2, -SHIP_W / 2, -SHIP_H * 0.36);
    ctx.lineTo(-SHIP_W / 2, SHIP_H * 0.36);
    ctx.quadraticCurveTo(SHIP_W * 0.1, SHIP_H / 2, SHIP_W / 2, 0);
    ctx.fill();
    ctx.fillStyle = "#e2556f";
    ctx.beginPath();
    ctx.moveTo(SHIP_W / 2, 0);
    ctx.quadraticCurveTo(SHIP_W * 0.28, -SHIP_H * 0.38, SHIP_W * 0.16, -SHIP_H * 0.3);
    ctx.lineTo(SHIP_W * 0.16, SHIP_H * 0.3);
    ctx.quadraticCurveTo(SHIP_W * 0.28, SHIP_H * 0.38, SHIP_W / 2, 0);
    ctx.fill();
    // canopy
    ctx.fillStyle = "#5ad1ff";
    ctx.beginPath(); ctx.ellipse(-SHIP_W * 0.06, -0.4, 3.4, 2.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.ellipse(-SHIP_W * 0.12, -1.3, 1.3, 0.9, 0, 0, TAU); ctx.fill();
    ctx.restore();

    if (this.shield) {
      ctx.strokeStyle = "rgba(255,209,102,0.9)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SHIP_R + 5 + Math.sin(this.elapsed * 6) * 0.8, 0, TAU);
      ctx.stroke();
    }
    if (this.magnetT > 0) {
      const rr = RULES.MAGNET_RANGE * this.magnetMul;
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = POWERUPS.magnet.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = POWERUPS.magnet.color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.slowT > 0) {
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = POWERUPS.slowmo.color;
      ctx.fillRect(-this.offX, -this.offY, this.viewLW, this.viewLH);
      ctx.globalAlpha = 1;
    }
  },

  /* -------------------------------- hints -------------------------------- */
  drawHints(ctx, L, R, B) {
    if (!this.hintT || this.hintT <= 0) return;
    ctx.globalAlpha = Math.min(1, this.hintT / 1.5) * 0.6;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.cave.endless
      ? "DRAG ANYWHERE TO FLY — GO AS DEEP AS YOU DARE"
      : `DRAG ANYWHERE TO FLY — BRING HOME AT LEAST ${this.quota}`, L + (R - L) / 2, B - 14);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  },

  /* --------------------------------- HUD --------------------------------- */
  syncHud() {
    if (!this._hud) this._hud = {};
    const el = (id) => (this._hud[id] || (this._hud[id] = document.getElementById(id)));
    const hull = el("hud-hull"), res = el("hud-res"), pw = el("hud-powers"),
          bar = el("hud-bar-fill"), dep = el("hud-depth");
    if (!hull) return;
    hull.textContent = "❤".repeat(Math.max(0, this.hull)) + "·".repeat(Math.max(0, this.hullMax - this.hull));
    if (this.cave.endless) {
      res.textContent = `🐣 ${this.rescued}`;
      dep.textContent = `${this.metres()}m`;
      bar.style.width = "100%";
      bar.parentElement.style.opacity = "0";
    } else {
      res.textContent = `🐣 ${this.rescued}/${this.cave.creatures.length}`;
      // Grey until the rescue quota is met, so "am I clearing this?" is
      // answerable at a glance without reading a number.
      res.classList.toggle("short", this.rescued < this.quota);
      dep.textContent = "";
      bar.parentElement.style.opacity = "1";
      bar.style.width = Math.min(100, (this.camX / this.cave.len) * 100).toFixed(1) + "%";
    }
    let icons = "";
    if (this.shield) icons += POWERUPS.shield.icon;
    if (this.magnetT > 0) icons += POWERUPS.magnet.icon;
    if (this.slowT > 0) icons += POWERUPS.slowmo.icon;
    pw.textContent = icons;
  },
});
