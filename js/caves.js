// Rocket Rescue — stage geometry, tunnel sampling, and the campaign caves.
//
// A cave is a PATH, so it is authored as a list of waypoint stations rather
// than as a tile map: [x, centreY, gapHeight]. The engine smoothsteps between
// stations to get a ceiling and a floor at any x, and both the renderer and the
// collision code read that ONE function — so the rock you can see is exactly
// the rock you can hit, by construction.
//
// Everything placed inside a cave (creatures, orbs, hazards) is positioned by a
// fraction `t` ACROSS the tunnel: 0 hugs the ceiling, 1 hugs the floor, 0.5 is
// dead centre. That makes a hand-authored cave impossible to place a creature
// inside solid rock, and it means widening a passage automatically moves its
// contents with it. tests/caves.test.js lints the rest.

/* ------------------------------------------------------------- geometry -- */
// One fixed logical stage for every device so a phone and a laptop see exactly
// the same amount of cave ahead — the family leaderboard depends on it. The
// renderer paints rock past the top and bottom edges so there are never bars.
const LW = 400;              // logical stage width
const LH = 225;              // logical stage height

const SHIP_R = 5.6;          // collision circle radius (forgiving: the nose pokes out)
const SHIP_W = 21;           // drawn size
const SHIP_H = 12;
// Nothing is ever placed closer than this to rock. It has to clear the ship's
// own radius with room to spare, or a creature tucked against a wall is one you
// can technically reach and never should.
// It has to clear the ship's radius PLUS the overshoot of the spring that flies
// it: reaching for a creature is a commitment, and a pilot who has to arrive
// within 6px of solid rock to make a rescue is being asked for precision the
// control scheme does not offer.
const WALL_CLEAR = SHIP_R + 10;

// Where on SCREEN the ship is allowed to sit. Pushing forward buys reaction
// time back later; hanging back gives you longer to read what is coming.
const BAND = { x0: 44, x1: 252 };

const TAU = Math.PI * 2;

const Cave = {
  // Normalise an authored cave (arrays -> objects) exactly once. Endless caves
  // are generated in this same shape, so the engine only ever sees one thing.
  prepare(def) {
    const c = {
      ...def,
      path: def.path.map(([x, y, g]) => ({ x, y, g })),
      creatures: (def.creatures || []).map(([x, t, type], i) => ({ id: i, x, t, type })),
      orbs: (def.orbs || []).map(([x, t, type], i) => ({ id: i, x, t, type })),
      hazards: (def.hazards || []).map(([type, x, t, opts], i) => ({ id: i, type, x, t, ...(opts || {}) })),
    };
    return c;
  },

  // Smoothstepped centre + gap at a world x. Outside the authored range the end
  // stations simply hold, so sampling past the mouth of a cave is safe.
  sample(path, x) {
    const n = path.length;
    if (x <= path[0].x) return { c: path[0].y, g: path[0].g };
    if (x >= path[n - 1].x) return { c: path[n - 1].y, g: path[n - 1].g };
    let i = 0;
    while (i < n - 2 && path[i + 1].x < x) i++;
    const a = path[i], b = path[i + 1];
    const u = (x - a.x) / (b.x - a.x);
    const s = u * u * (3 - 2 * u);          // smoothstep: no kinks at a station
    return { c: a.y + (b.y - a.y) * s, g: a.g + (b.g - a.g) * s };
  },

  centreAt(path, x) { return this.sample(path, x).c; },
  gapAt(path, x) { return this.sample(path, x).g; },
  ceilAt(path, x) { const s = this.sample(path, x); return s.c - s.g / 2; },
  floorAt(path, x) { const s = this.sample(path, x); return s.c + s.g / 2; },

  // Fraction across the tunnel -> absolute y, kept clear of both walls.
  place(path, x, t) {
    const s = this.sample(path, x);
    const top = s.c - s.g / 2 + WALL_CLEAR;
    const bot = s.c + s.g / 2 - WALL_CLEAR;
    if (bot <= top) return s.c;                       // pathologically tight: centre it
    return Math.max(top, Math.min(bot, s.c - s.g / 2 + t * s.g));
  },

  // Narrowest passage in a cave — the number the linter and the difficulty
  // curve both care about. Sampled, because the minimum can fall between two
  // stations when the gap is interpolating downward.
  minGap(path, step = 20) {
    let m = Infinity;
    const end = path[path.length - 1].x;
    for (let x = path[0].x; x <= end; x += step) m = Math.min(m, this.gapAt(path, x));
    return m;
  },
};

/* --------------------------------------------------------------- worlds -- */
// Palettes only — the difficulty lives in the cave data, not here.
const WORLDS = [
  { id: 0, name: "Crystal Hollows", icon: "💎",
    rock: "#25406b", rockLit: "#3a5e94", edge: "#7fd8ff", glow: "#6fe3ff",
    back: ["#0a1430", "#132a4d"], dust: "#9fe8ff" },
  { id: 1, name: "Coral Nebula", icon: "🪸",
    rock: "#5a2159", rockLit: "#83357c", edge: "#ff9ce8", glow: "#ff7ad9",
    back: ["#1a0a2e", "#3d1450"], dust: "#ffc2f0" },
  { id: 2, name: "Magma Vents", icon: "🌋",
    rock: "#4a2013", rockLit: "#7a3418", edge: "#ffab4a", glow: "#ff7a1a",
    back: ["#1c0805", "#43140a"], dust: "#ffd39a" },
  { id: 3, name: "The Void Core", icon: "🕳️",
    rock: "#241b3d", rockLit: "#3b2c63", edge: "#b98bff", glow: "#a06bff",
    back: ["#050310", "#150a2e"], dust: "#d9c2ff" },
];

/* ------------------------------------------------------------- campaign -- */
// 20 caves, five per world. Each world's fifth cave is a Guardian den: longer,
// tighter, and patrolled by something a lot bigger than an asteroid.
//
// Reading a cave entry:
//   speed     world px per second the tunnel scrolls past
//   len       how far you have to fly to reach daylight
//   path      [x, centreY, gapHeight] stations, smoothstepped between
//   creatures [x, t, type]      t = fraction across the tunnel
//   orbs      [x, t, powerupId]
//   hazards   [type, x, t, opts]

const CAVES_RAW = [
  /* ===================== World 1 — Crystal Hollows ====================== */
  { id: "w1c1", world: 0, name: "First Light", speed: 86, len: 3600,
    path: [[0, 112, 120], [800, 84, 112], [1600, 140, 110], [2400, 80, 112], [3100, 142, 116], [3700, 112, 120]],
    creatures: [[620, 0.22, "blip"], [1180, 0.78, "blip"], [1760, 0.22, "blip"], [2380, 0.78, "blip"], [3000, 0.22, "blip"]],
    orbs: [[2000, 0.24, "shield"]],
    hazards: [["rock", 1400, 0.5, { r: 13, amp: 0, wave: 400 }],
              ["rock", 2700, 0.42, { r: 13, amp: 0.16, wave: 520 }]] },

  { id: "w1c2", world: 0, name: "Glimmer Shelf", speed: 90, len: 4000,
    path: [[0, 112, 112], [700, 80, 106], [1400, 146, 102], [2100, 76, 100], [2800, 144, 102], [3500, 96, 106], [4100, 112, 112]],
    creatures: [[560, 0.14, "blip"], [1080, 0.86, "hopper"], [1620, 0.22, "blip"], [2240, 0.78, "blip"],
                [2860, 0.22, "hopper"], [3420, 0.78, "glimmer"]],
    orbs: [[1300, 0.76, "magnet"], [3000, 0.24, "mend"]],
    hazards: [["rock", 900, 0.55, { r: 14, amp: 0.2, wave: 480 }],
              ["rock", 1900, 0.4, { r: 13, amp: 0.24, wave: 420 }],
              ["pillar", 2500, 0, { w: 26, d0: 0.1, d1: 0.34, wave: 620 }],
              ["rock", 3200, 0.6, { r: 14, amp: 0.18, wave: 500 }]] },

  { id: "w1c3", world: 0, name: "The Narrows", speed: 94, len: 4200,
    path: [[0, 112, 108], [650, 98, 96], [1300, 128, 90], [1950, 94, 88], [2600, 124, 92], [3250, 100, 96], [3900, 116, 104], [4300, 112, 110]],
    creatures: [[520, 0.22, "blip"], [1020, 0.78, "blip"], [1520, 0.14, "hopper"], [2080, 0.78, "blip"],
                [2620, 0.22, "hopper"], [3160, 0.79, "blip"], [3660, 0.22, "glimmer"]],
    orbs: [[1700, 0.76, "slowmo"], [3400, 0.24, "shield"]],
    hazards: [["rock", 820, 0.45, { r: 14, amp: 0.22, wave: 460 }],
              ["pillar", 1450, 1, { w: 28, d0: 0.12, d1: 0.36, wave: 560 }],
              ["rock", 2200, 0.55, { r: 15, amp: 0.26, wave: 430 }],
              ["laser", 2900, 0.5, { slot: 0.44, sweep: 0.2, wave: 700 }],
              ["rock", 3550, 0.4, { r: 14, amp: 0.24, wave: 470 }]] },

  { id: "w1c4", world: 0, name: "Comet Run", speed: 98, len: 4400,
    path: [[0, 112, 106], [700, 122, 98], [1400, 92, 94], [2100, 126, 92], [2800, 98, 94], [3500, 120, 98], [4100, 106, 104], [4500, 112, 110]],
    creatures: [[600, 0.22, "blip"], [1120, 0.86, "hopper"], [1640, 0.18, "blip"], [2160, 0.78, "hopper"],
                [2680, 0.22, "blip"], [3200, 0.82, "blip"], [3720, 0.22, "glimmer"], [4080, 0.78, "blip"]],
    orbs: [[1300, 0.76, "magnet"], [2500, 0.76, "shield"], [3800, 0.24, "mend"]],
    hazards: [["comet", 900, 0.4, { r: 9, k: 1.5 }],
              ["rock", 1500, 0.55, { r: 15, amp: 0.24, wave: 440 }],
              ["comet", 2000, 0.62, { r: 9, k: 1.6 }],
              ["pillar", 2600, 0, { w: 30, d0: 0.12, d1: 0.38, wave: 540 }],
              ["comet", 3100, 0.45, { r: 9, k: 1.6 }],
              ["laser", 3600, 0.5, { slot: 0.42, sweep: 0.24, wave: 660 }]] },

  { id: "w1c5", world: 0, name: "Crystal Guardian", speed: 100, len: 5000, guardian: true,
    path: [[0, 112, 104], [650, 96, 96], [1300, 128, 92], [1950, 96, 90], [2600, 124, 94], [3250, 100, 100],
           [3900, 118, 110], [4550, 108, 116], [5100, 112, 118]],
    creatures: [[560, 0.22, "blip"], [1060, 0.79, "hopper"], [1560, 0.14, "blip"], [2100, 0.78, "hopper"],
                [2620, 0.22, "blip"], [3140, 0.82, "glimmer"], [3700, 0.22, "blip"], [4300, 0.78, "glimmer"]],
    orbs: [[1200, 0.24, "shield"], [2400, 0.24, "slowmo"], [3500, 0.76, "mend"], [4400, 0.24, "magnet"]],
    hazards: [["rock", 800, 0.5, { r: 15, amp: 0.24, wave: 450 }],
              ["laser", 1450, 0.5, { slot: 0.42, sweep: 0.22, wave: 640 }],
              ["comet", 2000, 0.5, { r: 9, k: 1.6 }],
              ["pillar", 2500, 1, { w: 30, d0: 0.12, d1: 0.36, wave: 520 }],
              ["comet", 2950, 0.4, { r: 9, k: 1.7 }],
              ["guardian", 4000, 0.5, { r: 30, amp: 0.3, wave: 620 }],
              ["guardian", 4700, 0.5, { r: 30, amp: 0.32, wave: 560 }]] },

  /* ====================== World 2 — Coral Nebula ======================== */
  { id: "w2c1", world: 1, name: "Reef Mouth", speed: 102, len: 4200,
    path: [[0, 112, 104], [700, 100, 98], [1400, 126, 94], [2100, 98, 92], [2800, 122, 96], [3500, 106, 100], [4300, 112, 106]],
    creatures: [[600, 0.22, "blip"], [1120, 0.79, "hopper"], [1660, 0.21, "blip"], [2200, 0.78, "hopper"],
                [2740, 0.22, "blip"], [3280, 0.78, "glimmer"]],
    orbs: [[1500, 0.76, "magnet"], [3000, 0.24, "shield"]],
    hazards: [["rock", 880, 0.5, { r: 15, amp: 0.24, wave: 440 }],
              ["pillar", 1750, 0, { w: 30, d0: 0.14, d1: 0.38, wave: 540 }],
              ["rock", 2450, 0.45, { r: 15, amp: 0.26, wave: 400 }],
              ["laser", 3100, 0.5, { slot: 0.4, sweep: 0.24, wave: 620 }],
              ["rock", 3700, 0.58, { r: 15, amp: 0.24, wave: 460 }]] },

  { id: "w2c2", world: 1, name: "Polyp Passage", speed: 104, len: 4400,
    path: [[0, 112, 102], [650, 124, 94], [1300, 94, 88], [1950, 128, 86], [2600, 96, 88], [3250, 122, 92], [3900, 104, 98], [4500, 112, 104]],
    creatures: [[560, 0.22, "hopper"], [1060, 0.79, "blip"], [1580, 0.14, "blip"], [2120, 0.78, "hopper"],
                [2640, 0.22, "blip"], [3180, 0.79, "hopper"], [3700, 0.22, "glimmer"]],
    orbs: [[1400, 0.24, "slowmo"], [2900, 0.76, "mend"], [4100, 0.76, "shield"]],
    hazards: [["rock", 820, 0.5, { r: 15, amp: 0.26, wave: 420 }],
              ["comet", 1500, 0.4, { r: 9, k: 1.6 }],
              ["pillar", 2000, 1, { w: 32, d0: 0.14, d1: 0.4, wave: 500 }],
              ["laser", 2550, 0.5, { slot: 0.4, sweep: 0.26, wave: 600 }],
              ["rock", 3100, 0.42, { r: 16, amp: 0.26, wave: 430 }],
              ["comet", 3600, 0.58, { r: 9, k: 1.7 }]] },

  { id: "w2c3", world: 1, name: "Bloom Chamber", speed: 106, len: 4600,
    path: [[0, 112, 100], [700, 96, 94], [1400, 128, 88], [2100, 92, 86], [2800, 130, 88], [3500, 98, 92], [4200, 118, 98], [4700, 112, 104]],
    creatures: [[620, 0.21, "blip"], [1140, 0.82, "hopper"], [1680, 0.14, "glimmer"], [2220, 0.79, "blip"],
                [2760, 0.21, "hopper"], [3300, 0.82, "blip"], [3840, 0.22, "hopper"], [4300, 0.78, "glimmer"]],
    orbs: [[1250, 0.24, "magnet"], [2500, 0.76, "shield"], [3700, 0.76, "slowmo"]],
    hazards: [["rock", 880, 0.48, { r: 16, amp: 0.26, wave: 410 }],
              ["laser", 1550, 0.5, { slot: 0.4, sweep: 0.26, wave: 580 }],
              ["pillar", 2100, 0, { w: 32, d0: 0.14, d1: 0.4, wave: 480 }],
              ["comet", 2650, 0.42, { r: 9, k: 1.7 }],
              ["rock", 3150, 0.56, { r: 16, amp: 0.28, wave: 420 }],
              ["pillar", 3600, 1, { w: 32, d0: 0.14, d1: 0.4, wave: 500 }],
              ["comet", 4100, 0.5, { r: 9, k: 1.8 }]] },

  { id: "w2c4", world: 1, name: "Spine Gallery", speed: 110, len: 4800,
    path: [[0, 112, 98], [650, 126, 92], [1300, 92, 86], [1950, 130, 84], [2600, 94, 84], [3250, 126, 88], [3900, 98, 94], [4550, 118, 100], [4900, 112, 106]],
    creatures: [[580, 0.22, "blip"], [1080, 0.78, "hopper"], [1600, 0.14, "blip"], [2140, 0.79, "hopper"],
                [2660, 0.18, "glimmer"], [3200, 0.79, "blip"], [3740, 0.22, "hopper"], [4260, 0.78, "glimmer"]],
    orbs: [[1200, 0.24, "shield"], [2400, 0.24, "mend"], [3500, 0.76, "magnet"], [4500, 0.76, "slowmo"]],
    hazards: [["pillar", 800, 0, { w: 32, d0: 0.14, d1: 0.4, wave: 470 }],
              ["rock", 1450, 0.5, { r: 16, amp: 0.28, wave: 400 }],
              ["comet", 1900, 0.4, { r: 9, k: 1.7 }],
              ["laser", 2350, 0.5, { slot: 0.38, sweep: 0.28, wave: 560 }],
              ["pillar", 2850, 1, { w: 34, d0: 0.14, d1: 0.42, wave: 460 }],
              ["comet", 3350, 0.6, { r: 9, k: 1.8 }],
              ["rock", 3850, 0.44, { r: 16, amp: 0.28, wave: 410 }],
              ["laser", 4350, 0.5, { slot: 0.38, sweep: 0.28, wave: 540 }]] },

  { id: "w2c5", world: 1, name: "Coral Guardian", speed: 112, len: 5400, guardian: true,
    path: [[0, 112, 98], [700, 96, 92], [1400, 128, 86], [2100, 94, 84], [2800, 128, 88], [3500, 100, 96],
           [4200, 118, 106], [4900, 106, 112], [5500, 112, 114]],
    creatures: [[620, 0.21, "blip"], [1160, 0.79, "hopper"], [1700, 0.14, "blip"], [2240, 0.79, "hopper"],
                [2780, 0.21, "glimmer"], [3320, 0.78, "blip"], [3900, 0.22, "hopper"], [4600, 0.78, "glimmer"]],
    orbs: [[1250, 0.24, "shield"], [2450, 0.24, "slowmo"], [3700, 0.76, "mend"], [4750, 0.76, "magnet"]],
    hazards: [["rock", 880, 0.48, { r: 16, amp: 0.28, wave: 400 }],
              ["laser", 1550, 0.5, { slot: 0.38, sweep: 0.28, wave: 560 }],
              ["comet", 2050, 0.42, { r: 9, k: 1.8 }],
              ["pillar", 2550, 0, { w: 34, d0: 0.14, d1: 0.42, wave: 450 }],
              ["comet", 3050, 0.58, { r: 9, k: 1.8 }],
              ["guardian", 4300, 0.5, { r: 32, amp: 0.32, wave: 580 }],
              ["guardian", 5000, 0.5, { r: 32, amp: 0.34, wave: 520 }]] },

  /* ======================= World 3 — Magma Vents ======================== */
  { id: "w3c1", world: 2, name: "Ember Shaft", speed: 114, len: 4600,
    path: [[0, 112, 96], [700, 100, 90], [1400, 126, 84], [2100, 96, 82], [2800, 126, 84], [3500, 102, 90], [4200, 118, 96], [4700, 112, 102]],
    creatures: [[620, 0.22, "blip"], [1140, 0.79, "hopper"], [1680, 0.14, "blip"], [2220, 0.79, "hopper"],
                [2760, 0.21, "blip"], [3300, 0.78, "glimmer"], [3840, 0.22, "hopper"]],
    orbs: [[1300, 0.76, "shield"], [2500, 0.76, "magnet"], [3700, 0.76, "slowmo"]],
    hazards: [["rock", 900, 0.5, { r: 16, amp: 0.28, wave: 390 }],
              ["pillar", 1550, 1, { w: 34, d0: 0.14, d1: 0.42, wave: 450 }],
              ["laser", 2100, 0.5, { slot: 0.38, sweep: 0.28, wave: 540 }],
              ["comet", 2650, 0.44, { r: 9, k: 1.8 }],
              ["rock", 3150, 0.56, { r: 17, amp: 0.28, wave: 400 }],
              ["pillar", 3700, 0, { w: 34, d0: 0.14, d1: 0.42, wave: 440 }],
              ["comet", 4200, 0.5, { r: 9, k: 1.9 }]] },

  { id: "w3c2", world: 2, name: "Basalt Weave", speed: 116, len: 4800,
    path: [[0, 112, 94], [650, 126, 88], [1300, 92, 82], [1950, 130, 80], [2600, 94, 80], [3250, 128, 84], [3900, 98, 90], [4550, 118, 96], [4900, 112, 102]],
    creatures: [[580, 0.21, "hopper"], [1100, 0.79, "blip"], [1620, 0.14, "glimmer"], [2160, 0.82, "hopper"],
                [2680, 0.18, "blip"], [3220, 0.79, "hopper"], [3760, 0.22, "blip"], [4280, 0.78, "glimmer"]],
    orbs: [[1200, 0.24, "magnet"], [2350, 0.3, "shield"], [3500, 0.76, "mend"], [4450, 0.24, "slowmo"]],
    hazards: [["pillar", 820, 0, { w: 34, d0: 0.16, d1: 0.42, wave: 430 }],
              ["comet", 1400, 0.4, { r: 9, k: 1.8 }],
              ["rock", 1850, 0.52, { r: 17, amp: 0.3, wave: 390 }],
              ["laser", 2350, 0.5, { slot: 0.36, sweep: 0.3, wave: 520 }],
              ["pillar", 2850, 1, { w: 36, d0: 0.16, d1: 0.44, wave: 420 }],
              ["comet", 3350, 0.58, { r: 9, k: 1.9 }],
              ["rock", 3850, 0.44, { r: 17, amp: 0.3, wave: 400 }],
              ["laser", 4350, 0.5, { slot: 0.36, sweep: 0.3, wave: 500 }]] },

  { id: "w3c3", world: 2, name: "The Bellows", speed: 118, len: 5000,
    path: [[0, 112, 92], [700, 96, 86], [1400, 130, 80], [2100, 92, 78], [2800, 132, 78], [3500, 96, 80], [4200, 124, 88], [4900, 108, 96], [5100, 112, 100]],
    creatures: [[620, 0.21, "blip"], [1160, 0.82, "hopper"], [1700, 0.14, "blip"], [2240, 0.82, "glimmer"],
                [2780, 0.18, "hopper"], [3320, 0.82, "blip"], [3860, 0.22, "hopper"], [4400, 0.78, "glimmer"]],
    orbs: [[1250, 0.24, "shield"], [2450, 0.24, "slowmo"], [3600, 0.24, "magnet"], [4600, 0.24, "mend"]],
    hazards: [["rock", 900, 0.5, { r: 17, amp: 0.3, wave: 380 }],
              ["laser", 1550, 0.5, { slot: 0.36, sweep: 0.3, wave: 500 }],
              ["comet", 2050, 0.42, { r: 10, k: 1.9 }],
              ["pillar", 2550, 0, { w: 36, d0: 0.16, d1: 0.44, wave: 410 }],
              ["comet", 3050, 0.58, { r: 10, k: 1.9 }],
              ["rock", 3550, 0.46, { r: 17, amp: 0.3, wave: 390 }],
              ["pillar", 4050, 1, { w: 36, d0: 0.16, d1: 0.44, wave: 420 }],
              ["laser", 4550, 0.5, { slot: 0.36, sweep: 0.3, wave: 490 }]] },

  { id: "w3c4", world: 2, name: "Slag Chute", speed: 122, len: 5200,
    path: [[0, 112, 92], [650, 128, 86], [1300, 90, 80], [1950, 132, 78], [2600, 92, 76], [3250, 130, 78], [3900, 96, 82], [4550, 124, 90], [5200, 110, 98]],
    creatures: [[580, 0.21, "hopper"], [1100, 0.79, "blip"], [1640, 0.14, "glimmer"], [2180, 0.86, "hopper"],
                [2720, 0.14, "blip"], [3260, 0.82, "hopper"], [3800, 0.22, "glimmer"], [4340, 0.78, "blip"],
                [4880, 0.22, "hopper"]],
    orbs: [[1150, 0.76, "shield"], [2250, 0.24, "magnet"], [3350, 0.76, "slowmo"], [4450, 0.24, "mend"]],
    hazards: [["pillar", 800, 0, { w: 36, d0: 0.16, d1: 0.44, wave: 400 }],
              ["comet", 1350, 0.4, { r: 10, k: 1.9 }],
              ["rock", 1800, 0.54, { r: 17, amp: 0.3, wave: 380 }],
              ["laser", 2300, 0.5, { slot: 0.36, sweep: 0.3, wave: 480 }],
              ["pillar", 2800, 1, { w: 36, d0: 0.16, d1: 0.44, wave: 400 }],
              ["comet", 3300, 0.6, { r: 10, k: 2 }],
              ["rock", 3750, 0.42, { r: 18, amp: 0.3, wave: 380 }],
              ["laser", 4250, 0.5, { slot: 0.36, sweep: 0.32, wave: 470 }],
              ["comet", 4750, 0.5, { r: 10, k: 2 }]] },

  { id: "w3c5", world: 2, name: "Magma Guardian", speed: 124, len: 5800, guardian: true,
    path: [[0, 112, 92], [700, 96, 86], [1400, 130, 80], [2100, 92, 78], [2800, 130, 80], [3500, 98, 86],
           [4200, 122, 96], [4900, 104, 108], [5600, 112, 112], [5900, 112, 114]],
    creatures: [[620, 0.21, "blip"], [1160, 0.82, "hopper"], [1700, 0.14, "glimmer"], [2240, 0.82, "hopper"],
                [2780, 0.18, "blip"], [3320, 0.79, "glimmer"], [3900, 0.22, "hopper"], [4700, 0.78, "glimmer"]],
    orbs: [[1250, 0.24, "shield"], [2450, 0.24, "slowmo"], [3700, 0.76, "mend"], [4850, 0.24, "magnet"]],
    hazards: [["rock", 900, 0.5, { r: 17, amp: 0.3, wave: 380 }],
              ["laser", 1550, 0.5, { slot: 0.36, sweep: 0.3, wave: 480 }],
              ["comet", 2050, 0.42, { r: 10, k: 2 }],
              ["pillar", 2550, 0, { w: 36, d0: 0.16, d1: 0.44, wave: 400 }],
              ["comet", 3050, 0.58, { r: 10, k: 2 }],
              ["guardian", 4350, 0.5, { r: 33, amp: 0.32, wave: 540 }],
              ["guardian", 5050, 0.5, { r: 33, amp: 0.34, wave: 490 }]] },

  /* ====================== World 4 — The Void Core ======================= */
  { id: "w4c1", world: 3, name: "Event Horizon", speed: 126, len: 5000,
    path: [[0, 112, 90], [700, 98, 84], [1400, 128, 80], [2100, 94, 76], [2800, 130, 76], [3500, 98, 80], [4200, 124, 86], [4900, 110, 94], [5100, 112, 98]],
    creatures: [[620, 0.21, "blip"], [1160, 0.82, "hopper"], [1700, 0.14, "glimmer"], [2240, 0.82, "hopper"],
                [2780, 0.18, "blip"], [3320, 0.82, "glimmer"], [3860, 0.22, "hopper"], [4400, 0.78, "blip"]],
    orbs: [[1250, 0.24, "shield"], [2400, 0.24, "magnet"], [3550, 0.76, "slowmo"], [4600, 0.24, "mend"]],
    hazards: [["rock", 900, 0.5, { r: 17, amp: 0.3, wave: 370 }],
              ["laser", 1500, 0.5, { slot: 0.35, sweep: 0.32, wave: 470 }],
              ["comet", 2000, 0.42, { r: 10, k: 2 }],
              ["pillar", 2500, 0, { w: 36, d0: 0.16, d1: 0.44, wave: 390 }],
              ["comet", 3000, 0.58, { r: 10, k: 2 }],
              ["rock", 3500, 0.46, { r: 18, amp: 0.32, wave: 370 }],
              ["pillar", 4000, 1, { w: 36, d0: 0.16, d1: 0.44, wave: 390 }],
              ["laser", 4500, 0.5, { slot: 0.35, sweep: 0.32, wave: 460 }]] },

  { id: "w4c2", world: 3, name: "Dark Matter Run", speed: 130, len: 5200,
    path: [[0, 112, 90], [650, 128, 84], [1300, 90, 78], [1950, 132, 76], [2600, 90, 74], [3250, 132, 76], [3900, 94, 80], [4550, 126, 86], [5200, 110, 94]],
    creatures: [[580, 0.21, "hopper"], [1100, 0.79, "blip"], [1640, 0.14, "glimmer"], [2180, 0.86, "hopper"],
                [2720, 0.14, "blip"], [3260, 0.86, "hopper"], [3800, 0.22, "glimmer"], [4340, 0.78, "blip"],
                [4880, 0.22, "hopper"]],
    orbs: [[1150, 0.76, "shield"], [2250, 0.24, "slowmo"], [3350, 0.76, "magnet"], [4450, 0.24, "mend"]],
    hazards: [["pillar", 800, 0, { w: 36, d0: 0.16, d1: 0.44, wave: 380 }],
              ["comet", 1350, 0.4, { r: 10, k: 2 }],
              ["rock", 1800, 0.54, { r: 18, amp: 0.32, wave: 360 }],
              ["laser", 2300, 0.5, { slot: 0.35, sweep: 0.32, wave: 460 }],
              ["pillar", 2800, 1, { w: 38, d0: 0.16, d1: 0.44, wave: 380 }],
              ["comet", 3300, 0.6, { r: 10, k: 2 }],
              ["rock", 3750, 0.42, { r: 18, amp: 0.32, wave: 360 }],
              ["laser", 4250, 0.5, { slot: 0.35, sweep: 0.34, wave: 450 }],
              ["comet", 4750, 0.5, { r: 10, k: 2 }]] },

  { id: "w4c3", world: 3, name: "Singularity Belt", speed: 134, len: 5400,
    path: [[0, 112, 88], [700, 94, 82], [1400, 132, 76], [2100, 90, 74], [2800, 134, 72], [3500, 92, 74], [4200, 128, 80], [4900, 104, 88], [5500, 112, 94]],
    creatures: [[620, 0.18, "blip"], [1160, 0.86, "hopper"], [1700, 0.14, "glimmer"], [2240, 0.86, "hopper"],
                [2780, 0.14, "blip"], [3320, 0.86, "glimmer"], [3860, 0.22, "hopper"], [4400, 0.78, "glimmer"],
                [4980, 0.22, "blip"]],
    orbs: [[1200, 0.24, "shield"], [2350, 0.76, "magnet"], [3450, 0.24, "slowmo"], [4550, 0.76, "mend"]],
    hazards: [["rock", 880, 0.5, { r: 18, amp: 0.32, wave: 360 }],
              ["laser", 1450, 0.5, { slot: 0.34, sweep: 0.34, wave: 450 }],
              ["comet", 1950, 0.42, { r: 10, k: 2 }],
              ["pillar", 2450, 0, { w: 38, d0: 0.16, d1: 0.44, wave: 370 }],
              ["comet", 2950, 0.58, { r: 10, k: 2 }],
              ["rock", 3450, 0.46, { r: 18, amp: 0.32, wave: 360 }],
              ["pillar", 3950, 1, { w: 38, d0: 0.16, d1: 0.44, wave: 370 }],
              ["laser", 4450, 0.5, { slot: 0.34, sweep: 0.34, wave: 440 }],
              ["comet", 4950, 0.5, { r: 10, k: 2 }]] },

  { id: "w4c4", world: 3, name: "Collapse", speed: 138, len: 5600,
    path: [[0, 112, 88], [650, 130, 80], [1300, 88, 76], [1950, 134, 74], [2600, 88, 72], [3250, 134, 74], [3900, 92, 78], [4550, 128, 84], [5200, 104, 90], [5700, 112, 94]],
    creatures: [[580, 0.18, "hopper"], [1100, 0.82, "glimmer"], [1640, 0.14, "blip"], [2180, 0.86, "hopper"],
                [2720, 0.14, "glimmer"], [3260, 0.86, "hopper"], [3800, 0.21, "blip"], [4340, 0.78, "glimmer"],
                [4880, 0.22, "hopper"], [5300, 0.78, "blip"]],
    orbs: [[1100, 0.76, "shield"], [2150, 0.76, "slowmo"], [3200, 0.24, "magnet"], [4250, 0.24, "mend"], [5100, 0.76, "shield"]],
    hazards: [["pillar", 780, 0, { w: 38, d0: 0.16, d1: 0.44, wave: 360 }],
              ["comet", 1300, 0.4, { r: 10, k: 2 }],
              ["rock", 1750, 0.54, { r: 18, amp: 0.34, wave: 350 }],
              ["laser", 2250, 0.5, { slot: 0.34, sweep: 0.34, wave: 440 }],
              ["pillar", 2900, 1, { w: 38, d0: 0.16, d1: 0.44, wave: 360 }],
              ["comet", 3450, 0.6, { r: 10, k: 2 }],
              ["laser", 4200, 0.5, { slot: 0.34, sweep: 0.34, wave: 430 }],
              ["comet", 4750, 0.5, { r: 10, k: 2 }]] },

  { id: "w4c5", world: 3, name: "The Void Guardian", speed: 142, len: 6200, guardian: true,
    path: [[0, 112, 88], [700, 94, 80], [1400, 132, 76], [2100, 88, 72], [2800, 132, 74], [3500, 96, 82],
           [4200, 124, 94], [4900, 102, 106], [5600, 116, 114], [6300, 112, 116]],
    creatures: [[620, 0.18, "blip"], [1160, 0.86, "hopper"], [1700, 0.14, "glimmer"], [2240, 0.86, "hopper"],
                [2780, 0.14, "glimmer"], [3320, 0.82, "blip"], [3900, 0.22, "hopper"], [4700, 0.78, "glimmer"],
                [5500, 0.22, "glimmer"]],
    orbs: [[1200, 0.24, "shield"], [2350, 0.76, "slowmo"], [3600, 0.24, "mend"], [4850, 0.24, "magnet"], [5700, 0.76, "shield"]],
    hazards: [["rock", 880, 0.5, { r: 18, amp: 0.34, wave: 350 }],
              ["laser", 1450, 0.5, { slot: 0.34, sweep: 0.34, wave: 430 }],
              ["comet", 1950, 0.42, { r: 10, k: 2 }],
              ["pillar", 2450, 0, { w: 38, d0: 0.16, d1: 0.44, wave: 360 }],
              ["comet", 2950, 0.58, { r: 10, k: 2 }],
              ["guardian", 4350, 0.5, { r: 34, amp: 0.34, wave: 500 }],
              ["guardian", 5050, 0.5, { r: 34, amp: 0.36, wave: 460 }],
              ["guardian", 5750, 0.5, { r: 34, amp: 0.3, wave: 420 }]] },
];

const CAVES = CAVES_RAW.map((c) => Cave.prepare(c));

// Caves grouped for the map screen.
function cavesOfWorld(w) { return CAVES.filter((c) => c.world === w); }

if (typeof window === "undefined") {
  Object.assign(globalThis, { LW, LH, SHIP_R, SHIP_W, SHIP_H, WALL_CLEAR, BAND, TAU, Cave, WORLDS, CAVES, CAVES_RAW, cavesOfWorld });
}
