// Hazards — the things in a cave that are not the cave.
//
// The one rule that makes this whole game testable: EVERYTHING a hazard does is
// a pure function of the scroll position `camX`. Nothing integrates, nothing
// remembers, nothing reads a clock. So:
//
//   * the engine, the renderer and the level linter all call the same
//     `hazardShapes()` and can never disagree about where a rock is;
//   * `tests/caves.test.js` can prove that a clear lane exists through every
//     hazard at every moment the ship could possibly meet it;
//   * slow-motion is a real power rather than a cosmetic one — slowing the
//     scroll slows the hazards too, because they ARE the scroll.
//
// Shapes come back as circles {x, y, r} or rectangles {x, y, w, h} in world
// coordinates. `blockedAt()` turns them into y-intervals at a given world x,
// which is what "is there a lane through this?" actually means.

const HAZARD_KINDS = {
  rock:     { label: "Asteroid",  hurt: 1 },
  pillar:   { label: "Spike",     hurt: 1 },
  laser:    { label: "Ion gate",  hurt: 1 },
  comet:    { label: "Comet",     hurt: 1 },
  guardian: { label: "Guardian",  hurt: 1 },
};

// How far ahead of the camera a comet is released. Also the cull distance for
// everything else, so a hazard can never pop into existence on top of the ship.
const COMET_LEAD = 480;

// The narrowest passage any hazard is ever allowed to leave, in logical px.
// The ship's collision circle is 11.2px across, so this is a shade under two
// ship-widths — tight, but never a coin flip.
//
// It is enforced by CONSTRUCTION rather than checked afterwards: an asteroid
// shrinks to fit the tunnel it sits in, an ion gate widens its slot, a spike
// stops short. Authored sizes are therefore MAXIMUMS, which is what lets the
// same hazard table be reused as a cave narrows through a world.
// tests/caves.test.js re-measures the result anyway — see freeLane().
const LANE_MIN = 22;

// Largest radius a round hazard may have in a tunnel of height g and still
// leave LANE_MIN on both sides of itself.
function fitRadius(r, g) { return Math.max(4, Math.min(r, (g - 2 * LANE_MIN) / 2)); }

// A stable per-hazard phase so two rocks on the same wave length don't bob in
// lockstep. Derived from x alone, so it is identical everywhere and forever.
function hazPhase(h) { return ((h.x * 0.618) % 1) * TAU; }

// Where the moving parts of a hazard are when the camera sits at camX.
function hazardShapes(h, camX, path) {
  const out = [];
  const s = Cave.sample(path, h.x);
  const ceil = s.c - s.g / 2, floor = s.c + s.g / 2;
  const ph = hazPhase(h);

  if (h.type === "rock" || h.type === "guardian") {
    const r = fitRadius(h.r, s.g);
    const base = Cave.place(path, h.x, h.t);
    const amp = (h.amp || 0) * s.g;
    let y = base + amp * Math.sin((TAU * camX) / (h.wave || 400) + ph);
    y = Math.max(ceil + r, Math.min(floor - r, y));
    out.push({ x: h.x, y, r, kind: h.type, spin: camX / 260 + ph });
    return out;
  }

  if (h.type === "pillar") {
    const w = h.w;
    const osc = 0.5 + 0.5 * Math.sin((TAU * camX) / (h.wave || 500) + ph);
    let d = (h.d0 + (h.d1 - h.d0) * osc) * s.g;
    d = Math.max(0, Math.min(d, s.g - LANE_MIN));
    const y = h.t === 0 ? ceil : floor - d;
    out.push({ x: h.x - w / 2, y, w, h: d, kind: "pillar", from: h.t === 0 ? "top" : "bot" });
    return out;
  }

  if (h.type === "laser") {
    const slotH = Math.min(s.g, Math.max(LANE_MIN, h.slot * s.g));
    const swing = (h.sweep || 0) * s.g;
    let sc = s.c + swing * Math.sin((TAU * camX) / (h.wave || 600) + ph);
    sc = Math.max(ceil + slotH / 2, Math.min(floor - slotH / 2, sc));
    const w = 6;
    const top = sc - slotH / 2, bot = sc + slotH / 2;
    if (top > ceil) out.push({ x: h.x - w / 2, y: ceil, w, h: top - ceil, kind: "laser", side: "top" });
    if (floor > bot) out.push({ x: h.x - w / 2, y: bot, w, h: floor - bot, kind: "laser", side: "bot" });
    return out;
  }

  if (h.type === "comet") {
    const born = h.x - COMET_LEAD;
    if (camX < born) return out;
    const cx = h.x - (camX - born) * h.k;
    if (cx < camX - 80) return out;                 // gone past, off the left edge
    const cs = Cave.sample(path, cx);
    const y = Cave.place(path, cx, h.t);
    out.push({ x: cx, y, r: fitRadius(h.r, cs.g), kind: "comet", tail: h.k });
    return out;
  }

  return out;
}

// The y-intervals a hazard seals off at one world x. This is the only thing the
// "is this cave survivable?" linter needs to know.
function blockedAt(h, camX, path, worldX) {
  const spans = [];
  for (const sh of hazardShapes(h, camX, path)) {
    if (sh.r !== undefined) {
      const dx = worldX - sh.x;
      if (Math.abs(dx) >= sh.r) continue;
      const half = Math.sqrt(sh.r * sh.r - dx * dx);
      spans.push([sh.y - half, sh.y + half]);
    } else {
      if (worldX < sh.x || worldX > sh.x + sh.w) continue;
      spans.push([sh.y, sh.y + sh.h]);
    }
  }
  return spans;
}

// Circle-vs-shape overlap, used for the ship and for the magnet's reach.
function hitsShape(sh, cx, cy, r) {
  if (sh.r !== undefined) {
    const dx = cx - sh.x, dy = cy - sh.y;
    return dx * dx + dy * dy < (sh.r + r) * (sh.r + r);
  }
  const nx = Math.max(sh.x, Math.min(sh.x + sh.w, cx));
  const ny = Math.max(sh.y, Math.min(sh.y + sh.h, cy));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Every open [top, bottom] interval inside the tunnel at (camX, worldX), given
// every hazard in the cave. This is the primitive the level linter and the
// balance bots both steer by: "which corridors exist here?"
function freeLanes(cave, camX, worldX) {
  const s = Cave.sample(cave.path, worldX);
  const lo = s.c - s.g / 2, hi = s.c + s.g / 2;
  const spans = [];
  for (const h of cave.hazards) {
    if (h.type !== "comet" && Math.abs(h.x - worldX) > 900) continue;
    for (const sp of blockedAt(h, camX, cave.path, worldX)) spans.push(sp);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = lo;
  for (const [a, b] of spans) {
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([a, b]) => b > a);
}

// The widest of those corridors — the "is this cave survivable at all?" number.
function freeLane(cave, camX, worldX) {
  let best = 0, bestMid = Cave.centreAt(cave.path, worldX);
  for (const [a, b] of freeLanes(cave, camX, worldX)) {
    if (b - a > best) { best = b - a; bestMid = (a + b) / 2; }
  }
  return { width: best, mid: bestMid };
}

// A comet closes on the ship at (1 + k) times the scroll speed, so probing a
// corridor at scroll intervals misses it entirely: over one probe step a comet
// travels several times its own width. Solve for the scroll position at which
// each comet crosses the ship's x instead, and block the band it arrives in.
//
//   comet world x at scroll c :  h.x - (c - born) * k        (born = h.x - LEAD)
//   crosses the ship when      :  that equals c + shipX
//
// Without this a pilot flies straight through one and it reads as "the cave is
// too hard" rather than "the pilot cannot see it".
function cometThreats(cave, camX, shipX, look) {
  const out = [];
  for (const h of cave.hazards) {
    if (h.type !== "comet") continue;
    const born = h.x - COMET_LEAD;
    const c = (h.x + h.k * born - shipX) / (1 + h.k);
    if (c < camX - 20 || c > camX + look) continue;
    const cx = c + shipX;
    const s = Cave.sample(cave.path, cx);
    const r = fitRadius(h.r, s.g) + 3;
    const y = Cave.place(cave.path, cx, h.t);
    out.push([y - r, y + r]);
  }
  return out;
}

// Corridors that stay open across the next `look` px of flying, not just at one
// point. Without this a pilot reads the gap beside a rock, threads it, and then
// steers straight back into the rock's shoulder, because by then the single
// probe point is past it.
//
// The tunnel is SAMPLED (it changes smoothly, so probes catch it), but every
// hazard is solved for EXACTLY: each one is evaluated at the scroll position
// where the ship actually meets it. Sampling hazards instead is a trap that
// caught this twice — an ion gate is 6px wide and the probes are ~33px apart,
// so a sampled corridor steps clean over one and reports open space. Every
// scrape a perfect pilot took turned out to be a gate it could not see.
function corridorAhead(cave, camX, shipX, look, samples = 6) {
  let acc = null;
  for (let i = 0; i < samples; i++) {
    const d = (look * i) / (samples - 1);
    const s = Cave.sample(cave.path, camX + d + shipX);
    const iv = [[s.c - s.g / 2, s.c + s.g / 2]];
    acc = acc === null ? iv : intersectIntervals(acc, iv);
    if (!acc.length) return [];
  }
  for (const h of cave.hazards) {
    if (h.type === "comet") continue;                  // handled below, it moves
    const cAt = h.x - shipX;                           // scroll when the ship arrives
    if (cAt < camX - 60 || cAt > camX + look) continue;
    // Widest point of the hazard is its own x, so subtracting the band there is
    // both exact and conservative.
    for (const [a, b] of blockedAt(h, cAt, cave.path, h.x)) {
      acc = subtractInterval(acc, a - 1, b + 1);
      if (!acc.length) return [];
    }
  }
  for (const [a, b] of cometThreats(cave, camX, shipX, look)) {
    acc = subtractInterval(acc, a, b);
    if (!acc.length) return [];
  }
  return acc;
}

function intersectIntervals(A, B) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i][0], B[j][0]);
    const hi = Math.min(A[i][1], B[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
}

function subtractInterval(A, a, b) {
  const out = [];
  for (const [lo, hi] of A) {
    if (b <= lo || a >= hi) { out.push([lo, hi]); continue; }
    if (a > lo) out.push([lo, a]);
    if (b < hi) out.push([b, hi]);
  }
  return out.filter(([lo, hi]) => hi > lo);
}

if (typeof window === "undefined") {
  Object.assign(globalThis, { HAZARD_KINDS, COMET_LEAD, LANE_MIN, fitRadius, hazPhase, hazardShapes,
    blockedAt, hitsShape, freeLanes, freeLane, cometThreats, corridorAhead, intersectIntervals, subtractInterval });
}
