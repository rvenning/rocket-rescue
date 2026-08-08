// Cave linter — the data check that keeps a hand-authored cave flyable.
//
// Because a cave is a PATH authored as waypoints (and everything inside it is
// positioned by a fraction ACROSS the tunnel rather than in absolute pixels),
// the mistakes available are a short, geometric, checkable list: a station that
// leaves the stage, a climb steeper than a ship can fly, a hazard that seals
// the passage, a creature stranded inside rock.
//
// The headline assertion is `freeLane`: at every point along the nominal flight
// line there is a gap wide enough to fly through, given where every moving
// hazard actually is at the moment the ship gets there. That is the difference
// between "the cave is hard" and "the cave is impossible", and it is checked
// for the generated endless cave too.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Cave, CAVES, LH, LANE_MIN, SHIP_R, BAND, freeLane, blockedAt, creaturePos,
        CREATURES, Endless, RNG, SEG, GK } = S;

const NOMINAL_X = 140;         // where the ship nominally sits on screen
const LANE_FLOOR = LANE_MIN - 2;   // hazards self-limit to LANE_MIN; allow float slop

// Everything a hazard seals at one point, as a list of [y0, y1].
function spansAt(cave, camX, worldX) {
  const out = [];
  for (const h of cave.hazards) {
    if (h.type !== "comet" && Math.abs(h.x - worldX) > 900) continue;
    for (const sp of blockedAt(h, camX, cave.path, worldX)) out.push(sp);
  }
  return out;
}

function sealedPoint(cave, camX, worldX, y, r) {
  for (const [a, b] of spansAt(cave, camX, worldX)) if (y + r > a && y - r < b) return true;
  const s = Cave.sample(cave.path, worldX);
  return y - r < s.c - s.g / 2 || y + r > s.c + s.g / 2;
}

/* ------------------------------------------------------------ path shape */
// The geometry checks are gamekit's — stations that advance, walls inside the
// stage, a width band, and a climb rate the player can actually make. Only the
// per-cave numbers are ours: `maxSlope` is expressed in px of climb per px of
// scroll, so dividing the ship's tolerable climb SPEED by the cave's scroll
// speed turns a game constant into the geometric bound the linter wants.
const CLIMB_LIMIT = 340;        // px/s of rise the ship can comfortably manage

test("every cave path is well formed, inside the stage, and flyable", () => {
  const fails = [];
  for (const c of CAVES) {
    fails.push(...GK.Corridor.lint(c.path.map((p) => ({ x: p.x, c: p.y, w: p.g })), {
      label: c.id,
      bounds: [0, LH], margin: 3,
      minWidth: 60, maxWidth: 130,
      maxSlope: CLIMB_LIMIT / c.speed,
      step: 10,
    }));
    if (c.path[c.path.length - 1].x < c.len)
      fails.push(`${c.id}: path ends at ${c.path[c.path.length - 1].x} before len ${c.len}`);
  }
  assert.deepEqual(fails, []);
});

test("every cave actually narrows somewhere — a uniform tunnel is no cave at all", () => {
  const fails = [];
  for (const c of CAVES) {
    const m = Cave.minGap(c.path);
    if (m > 118) fails.push(`${c.id}: never narrower than ${m.toFixed(1)}`);
  }
  assert.deepEqual(fails, []);
});

/* -------------------------------------------------------------- contents */
test("creatures and orbs sit in open space, never inside rock or a hazard", () => {
  const fails = [];
  for (const c of CAVES) {
    for (const cr of c.creatures) {
      const camX = cr.x - NOMINAL_X;
      const pos = creaturePos(cr, camX, c.path);
      if (sealedPoint(c, camX, cr.x, pos.y, SHIP_R))
        fails.push(`${c.id}: ${cr.type} at ${cr.x} is unreachable`);
      if (cr.t < 0.12 || cr.t > 0.88) fails.push(`${c.id}: ${cr.type} at ${cr.x} hugs a wall (t=${cr.t})`);
    }
    // Creatures spread ACROSS the tunnel are what make a rescue a decision.
    // Bunched near the centre line they all fall inside the scoop radius of a
    // ship flying straight, and the game rescues itself.
    const spread = c.creatures.reduce((s, cr) => s + Math.abs(cr.t - 0.5), 0) / c.creatures.length;
    if (spread < 0.2) fails.push(`${c.id}: creatures average only ${spread.toFixed(2)} off the centre line`);
    for (const o of c.orbs) {
      const camX = o.x - NOMINAL_X;
      const y = Cave.place(c.path, o.x, o.t);
      if (sealedPoint(c, camX, o.x, y, SHIP_R))
        fails.push(`${c.id}: ${o.type} orb at ${o.x} is unreachable`);
    }
  }
  assert.deepEqual(fails, []);
});

test("every cave is worth flying: enough creatures, and stars are earnable", () => {
  const fails = [];
  for (const c of CAVES) {
    if (c.creatures.length < 5) fails.push(`${c.id}: only ${c.creatures.length} creatures`);
    if (!c.orbs.length) fails.push(`${c.id}: no power-ups at all`);
    const secs = c.len / c.speed;
    if (secs < 35 || secs > 80) fails.push(`${c.id}: ${secs.toFixed(0)}s long`);
  }
  assert.deepEqual(fails, []);
});

// Two hazards overlapping in x could seal a tunnel between them even though
// each one is individually fine. Keeping them apart is what makes the lane
// guarantee compose.
test("static hazards never overlap each other in x", () => {
  const fails = [];
  for (const c of CAVES) {
    const stat = c.hazards.filter((h) => h.type !== "comet");
    for (let i = 1; i < stat.length; i++)
      if (stat[i].x - stat[i - 1].x < 300)
        fails.push(`${c.id}: ${stat[i - 1].type}@${stat[i - 1].x} and ${stat[i].type}@${stat[i].x} are ${stat[i].x - stat[i - 1].x} apart`);
  }
  assert.deepEqual(fails, []);
});

/* ------------------------------------------------- the headline guarantee */
test("every campaign cave leaves a flyable lane at every point", () => {
  const fails = [];
  for (const c of CAVES) {
    let worst = Infinity, worstAt = 0;
    // 4px steps, not 8: a comet closes at ~3x the scroll, so a coarser sweep
    // steps clean over one and the check silently proves nothing.
    for (let camX = 0; camX <= c.len; camX += 4) {
      const lane = freeLane(c, camX, camX + NOMINAL_X);
      if (lane.width < worst) { worst = lane.width; worstAt = camX; }
    }
    if (worst < LANE_FLOOR) fails.push(`${c.id}: lane narrows to ${worst.toFixed(1)} at camX ${worstAt}`);
  }
  assert.deepEqual(fails, []);
});

// The ship can hang back or push forward within BAND, and the lane has to hold
// across that whole window — otherwise a cave is only survivable from one exact
// screen position, which no player would find.
test("the lane holds right across the ship's fore-and-aft band", () => {
  const fails = [];
  for (const c of CAVES) {
    for (let camX = 0; camX <= c.len; camX += 40) {
      for (const sx of [BAND.x0 + 4, NOMINAL_X, BAND.x1 - 4]) {
        const lane = freeLane(c, camX, camX + sx);
        if (lane.width < LANE_FLOOR)
          fails.push(`${c.id}: lane ${lane.width.toFixed(1)} at camX ${camX}, ship x ${sx}`);
      }
    }
  }
  assert.deepEqual(fails, []);
});

/* --------------------------------------------------------- endless caves */
test("the generated endless cave obeys the same guarantees", () => {
  const fails = [];
  const seeds = ["2026-08-06", "2026-08-07", "2026-01-01", "2025-12-25",
                 "seed-a", "seed-b", "seed-c", "seed-d"];
  for (const seedStr of seeds) {
    const cave = Endless.create(seedStr);
    Endless.ensure(cave, SEG * 60);                 // ~54km, far past any real run
    const end = SEG * 58;
    for (let x = 0; x <= end; x += 20) {
      const s = Cave.sample(cave.path, x);
      if (s.c - s.g / 2 < 3 || s.c + s.g / 2 > LH - 3)
        fails.push(`${seedStr}@${x}: tunnel leaves the stage`);
    }
    // The lane guarantee is checked only while the tunnel is still wide enough
    // for it to MEAN anything. Past segment ~28 the passage itself closes below
    // two ship-widths, and that is the whole point of a dive: it ends because
    // it runs out of room, not because you made a mistake. The campaign, where
    // you have to be able to finish, is guaranteed end to end.
    const guaranteed = SEG * 28;
    for (let camX = 0; camX <= guaranteed; camX += 10) {
      const lane = freeLane(cave, camX, camX + NOMINAL_X);
      if (lane.width < LANE_FLOOR)
        fails.push(`${seedStr}: lane ${lane.width.toFixed(1)} at camX ${camX}`);
    }
    const stat = cave.hazards.filter((h) => h.type !== "comet");
    for (let i = 1; i < stat.length; i++)
      if (stat[i].x - stat[i - 1].x < 300)
        fails.push(`${seedStr}: hazards ${stat[i - 1].x}/${stat[i].x} too close`);
  }
  assert.deepEqual(fails.slice(0, 12), []);
});

// The whole point of coordinate-derived seeds: building the cave lazily as the
// ship arrives has to produce exactly the cave a test built all at once, or the
// daily challenge is not shared and the linter above proves nothing.
test("lazily grown endless caves match eagerly grown ones", () => {
  const eager = Endless.create("2026-08-06");
  Endless.ensure(eager, SEG * 30);
  const lazy = Endless.create("2026-08-06");
  for (let i = 2; i <= 30; i++) Endless.ensure(lazy, SEG * i);
  assert.deepEqual(lazy.path, eager.path);
  assert.deepEqual(lazy.hazards, eager.hazards);
  assert.deepEqual(lazy.creatures, eager.creatures);
  assert.deepEqual(lazy.orbs, eager.orbs);
});

test("the daily cave is the same cave for everyone, and different day to day", () => {
  const a = Endless.create(RNG.today(new Date(2026, 7, 6)));
  const b = Endless.create(RNG.today(new Date(2026, 7, 6)));
  const c = Endless.create(RNG.today(new Date(2026, 7, 7)));
  Endless.ensure(a, SEG * 12); Endless.ensure(b, SEG * 12); Endless.ensure(c, SEG * 12);
  assert.deepEqual(a.hazards, b.hazards);
  assert.notDeepEqual(a.hazards, c.hazards);
});

/* ------------------------------------------------------- hazard vocabulary */
// A hazard naming a type the engine never draws or collides with would look
// perfectly normal in the data and simply not exist in the game.
test("no cave invents a hazard, creature or power-up the engine does not know", () => {
  const fails = [];
  const kinds = Object.keys(S.HAZARD_KINDS);
  for (const c of CAVES) {
    for (const h of c.hazards) if (!kinds.includes(h.type)) fails.push(`${c.id}: hazard "${h.type}"`);
    for (const cr of c.creatures) if (!CREATURES[cr.type]) fails.push(`${c.id}: creature "${cr.type}"`);
    for (const o of c.orbs) if (!S.POWERUPS[o.type]) fails.push(`${c.id}: orb "${o.type}"`);
  }
  assert.deepEqual(fails, []);
});
