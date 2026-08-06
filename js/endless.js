// Deep Rescue — the endless cave.
//
// The campaign is hand-authored; this one is grown a segment at a time from a
// seed, and the seed is the DATE, so everybody in the family flies the same
// cave on the same day and the leaderboard compares like with like.
//
// Every segment is drawn from RNG.sub(seed, "seg", n), so building segment 40
// lazily as the ship arrives gives byte-identical results to building 200 of
// them up front in a test. That is the only reason tests/caves.test.js can lint
// a cave nobody has flown yet.

const SEG = 900;                       // world px per generated segment

// The dive has to END, including for someone who never makes a mistake — a
// mode bounded only by mistakes simply does not finish for a good pilot, and
// then there is no score to put on a leaderboard. So neither the tunnel nor the
// speed has a floor or a ceiling to settle at: the passage keeps closing
// geometrically and the scroll keeps climbing until reaction time runs out.
// Pleasant side effect: a slower pilot reaches fewer steps of the decay, so
// everyone's dive lasts a similar wall-clock time and only the score separates
// them.
const ENDLESS_SPEED = { base: 92, gain: 3.4, per: SEG, cap: 340 };

const Endless = {
  SEG,

  // A fresh endless cave with just enough built to start flying.
  create(seedStr) {
    const cave = Cave.prepare({
      id: "endless", world: 0, name: "Deep Rescue", endless: true,
      seed: RNG.seedFrom(seedStr), seedStr,
      speed: ENDLESS_SPEED.base, speedRamp: ENDLESS_SPEED, len: Infinity,
      path: [[0, 112, 120], [SEG, 112, 120]],
      creatures: [], orbs: [], hazards: [],
    });
    cave.builtSegs = 1;                // segment 0 is the calm run-up
    cave.nextId = 0;
    this.ensure(cave, SEG * 2);
    return cave;
  },

  // Which world palette a depth reads as — purely cosmetic, but it makes a long
  // run feel like a journey rather than a treadmill.
  worldAt(x) { return Math.min(WORLDS.length - 1, Math.floor(x / (SEG * 6))); },

  gapFor(n) { return 28 + 86 * Math.pow(0.962, n); },

  // Build forward until the cave is authored past `uptoX`.
  ensure(cave, uptoX) {
    while (cave.builtSegs * SEG < uptoX) this.addSegment(cave, cave.builtSegs++);
  },

  addSegment(cave, n) {
    const r = RNG.sub(cave.seed, "seg", n);
    const x0 = n * SEG, x1 = (n + 1) * SEG;
    const gap = this.gapFor(n);

    // Centre line: a bounded step from the previous station, so the tunnel can
    // never demand a climb the ship physically cannot make.
    const prev = cave.path[cave.path.length - 1];
    const lo = 8 + gap / 2, hi = LH - 8 - gap / 2;
    let y = prev.y + r.range(-64, 64);
    y = Math.max(lo, Math.min(hi, y));
    cave.path.push({ x: x1, y, g: gap });

    // --- creatures: the reason to steer off the safe line ---
    // Alternating above and below the centre line, never on it: a creature on
    // the line you were already flying is one you did not have to earn, and a
    // whole cave of them can be cleared by a ship nobody is steering.
    const count = 2 + (r.chance(0.45) ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const type = r.chance(0.12) ? "glimmer" : r.chance(0.4) ? "hopper" : "blip";
      const mag = r.range(0.28, 0.36);
      cave.creatures.push({
        id: cave.nextId++, type,
        x: x0 + 160 + i * (620 / count) + r.range(-40, 40),
        t: (n + i) % 2 === 0 ? 0.5 - mag : 0.5 + mag,
      });
    }

    // --- one orb every third segment, weighted toward staying alive ---
    if (n > 0 && n % 3 === 0) {
      const roll = r();
      const type = roll < 0.34 ? "shield" : roll < 0.6 ? "mend" : roll < 0.82 ? "slowmo" : "magnet";
      cave.orbs.push({ id: cave.nextId++, type, x: x0 + 460, t: r.range(0.3, 0.7) });
    }

    // --- hazards: introduced one kind at a time, then never fewer than two ---
    const pool = [];
    if (n >= 1) pool.push("rock");
    if (n >= 3) pool.push("pillar");
    if (n >= 6) pool.push("laser");
    if (n >= 9) pool.push("comet");
    if (!pool.length) return;
    const nHaz = n < 4 ? 1 : 2;
    // 420 and 760 into the segment: 340 apart, and 560 from the next segment's
    // first. Nothing is ever close enough to another hazard to overlap it in x,
    // which is what keeps a generated cave provably passable.
    const slots = [420, 760];
    for (let i = 0; i < nHaz; i++) {
      let type = r.pick(pool);
      if (n >= 15 && type === "rock" && r.chance(0.22)) type = "guardian";
      cave.hazards.push(this.makeHazard(cave, r, type, x0 + slots[i], n));
    }
  },

  makeHazard(cave, r, type, x, n) {
    const base = { id: cave.nextId++, type, x };
    if (type === "rock")
      return { ...base, t: r.range(0.25, 0.75), r: r.range(12, 19), amp: r.range(0.14, 0.32), wave: r.range(340, 520) };
    if (type === "guardian")
      return { ...base, t: 0.5, r: 30, amp: r.range(0.28, 0.36), wave: r.range(440, 620) };
    if (type === "pillar")
      return { ...base, t: r.chance(0.5) ? 0 : 1, w: r.range(26, 38), d0: 0.12, d1: r.range(0.34, 0.46), wave: r.range(360, 560) };
    if (type === "laser")
      return { ...base, t: 0.5, slot: r.range(0.34, 0.46), sweep: r.range(0.18, 0.32), wave: r.range(430, 640) };
    // comet
    return { ...base, t: r.range(0.25, 0.75), r: r.range(8, 11), k: r.range(1.5, 2.2) };
  },

  // Drop what is far enough behind that nothing can reach back to it. The path
  // keeps a generous tail because Cave.sample() needs the station BEFORE the
  // camera to interpolate from.
  prune(cave, camX) {
    const keepFrom = camX - 1600;
    while (cave.path.length > 2 && cave.path[1].x < keepFrom) cave.path.shift();
    cave.creatures = cave.creatures.filter((c) => c.x > keepFrom || c.got);
    cave.orbs = cave.orbs.filter((o) => o.x > keepFrom || o.got);
    cave.hazards = cave.hazards.filter((h) => h.x > keepFrom - COMET_LEAD);
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { SEG, ENDLESS_SPEED, Endless });
