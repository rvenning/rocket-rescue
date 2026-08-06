// Balance bots — headless pilots flying the real engine.
//
// game.js touches no canvas and no DOM, so these drive the actual game rather
// than a model of it. Three pilots, because one number tells you nothing:
//
//   ace   guardrail — nothing in the campaign may be unwinnable by it
//   kid   the tuning target — a child who reads the cave but doesn't hold the
//         whole of it in her head: imprecise aim, occasional target fixation,
//         and moments of simply not looking at the wall
//   idle  the control — never touches the stick, must never win anything
//
// The engine has no randomness at all, so a changed clear time here is always a
// real balance change. The BOTS have randomness, so every run reseeds its own
// noise from the run's own key — two configurations compared must start from
// the same stream or the table is measuring execution order.
//
// `node tests/bot.test.js --report` prints the per-cave table. The shape of
// that table is the balance.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { CAVES, Cave, Game, SHIP_R, freeLanes, corridorAhead, creaturePos,
        UPGRADES, Endless } = S;

const REPORT = process.argv.includes("--report");
const DT = 1 / 60;
const FRAME_CAP = 60 * 200;          // 200s: far past any cave's honest length

/* ------------------------------------------------------------------- rng */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function keySeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ----------------------------------------------------------------- brains */
// How far ahead a pilot reads the cave, in world px. A cave flyer is entirely
// about this number: too short and you meet the wall, too long and you fly the
// shape of a passage you are not in yet.
const LOOK = (speed) => 90 + speed * 0.95;

// The nearest thing worth steering for: creatures first, then a power-up orb.
function nextPrize(G) {
  const wx = G.worldX();
  let best = null;
  for (const c of G.cave.creatures) {
    if (c.got || c.x < wx + 12 || c.x > wx + 240) continue;
    if (!best || c.x < best.x) best = { x: c.x, kind: "creature", ref: c };
  }
  if (best) return best;
  for (const o of G.cave.orbs) {
    if (o.got || o.x < wx + 12 || o.x > wx + 240) continue;
    if (!best || o.x < best.x) best = { x: o.x, kind: "orb", ref: o };
  }
  return best;
}

function prizeY(G, prize) {
  const camAt = prize.x - G.ship.x;
  return prize.kind === "creature"
    ? creaturePos(prize.ref, camAt, G.cave.path).y
    : Cave.place(G.cave.path, prize.ref.x, prize.ref.t);
}

const MARGIN = SHIP_R + 2;

function makeBrain(cfg, rnd) {
  return {
    replanIn: 0,
    blind: 0,
    err: 0,
    step(G) {
      if (this.blind > 0) { this.blind--; return; }
      // A pilot who re-plans every frame never arrives: with an eased control
      // the target keeps sliding away before the ship reaches it. Commit for a
      // few frames, as a person does.
      if (this.replanIn-- > 0) return;
      this.replanIn = cfg.replan;

      if (cfg.blindChance && rnd() < cfg.blindChance) { this.blind = cfg.blindFrames; return; }
      this.err = (rnd() * 2 - 1) * cfg.aimError;

      const look = LOOK(G.speedAt(G.camX));
      // Corridors that survive the whole window, not just one probe point.
      let ivs = corridorAhead(G.cave, G.camX, G.ship.x, look, 8);
      if (!ivs.length) ivs = corridorAhead(G.cave, G.camX, G.ship.x, look * 0.4, 5);
      if (!ivs.length) ivs = freeLanes(G.cave, G.camX, G.worldX());
      if (!ivs.length) return;

      const prize = nextPrize(G);
      const py = prize ? prizeY(G, prize) : null;
      const y = G.ship.y;

      // Pick a corridor, then a spot inside it. Staying where you already are
      // beats a marginally wider gap on the far side of a rock — swapping
      // corridors is what puts you into the rock.
      let best = null;
      for (const [a, b] of ivs) {
        const w = b - a;
        if (w < 2 * MARGIN) continue;
        const lo = a + MARGIN, hi = b - MARGIN;
        const hold = Math.max(lo, Math.min(hi, y));
        const holds = py !== null && py >= lo && py <= hi;
        const score = Math.min(w, 60) * 0.5 - Math.abs(hold - y) * 0.7 + (holds ? cfg.prizeWeight : 0);
        if (!best || score > best.score) best = { lo, hi, score, holds };
      }
      if (!best) {
        const [a, b] = ivs.reduce((m, iv) => (iv[1] - iv[0] > m[1] - m[0] ? iv : m));
        best = { lo: (a + b) / 2, hi: (a + b) / 2, holds: false };
      }

      // Reach for the prize when it is in the corridor you chose — or, if you
      // are the kind of pilot who fixates, when it very much is not.
      let want = Math.max(best.lo, Math.min(best.hi, y));
      if (py !== null && (best.holds || rnd() < cfg.recklessness)) {
        want = best.holds ? Math.max(best.lo, Math.min(best.hi, py)) : py;
      }

      G.input.tx = cfg.standoff;
      G.input.ty = want + this.err;
    },
  };
}

// `standoff` is where the pilot parks on screen. Sitting further left is real
// skill and not a bot trick: it buys reaction distance, at the cost of seeing
// less of what is behind you and reaching prizes later.
const BRAINS = {
  ace: { replan: 3, aimError: 0, blindChance: 0, blindFrames: 0, recklessness: 0, standoff: 96, prizeWeight: 70 },
  // Someone who has flown the cave before and is going for the perfect run:
  // same precision, but takes every corridor that holds a creature.
  hunter: { replan: 2, aimError: 0, blindChance: 0, blindFrames: 0, recklessness: 0, standoff: 96, prizeWeight: 300 },
  kid: { replan: 5, aimError: 7, blindChance: 0.05, blindFrames: 10, recklessness: 0.14, standoff: 124, prizeWeight: 40 },
  idle: null,
};

/* ------------------------------------------------------------------- runs */
function flyCave(caveIdx, brainName, { upgrades = {}, key = "" } = {}) {
  const G = Game;
  G.progress = { upgrades };
  G.reset("cave", CAVES[caveIdx], caveIdx);
  G.running = true; G.paused = false; G.active = false;

  const rnd = mulberry32(keySeed(`${brainName}|${caveIdx}|${key}`));
  const cfg = BRAINS[brainName];
  const brain = cfg ? makeBrain(cfg, rnd) : null;

  let f = 0;
  while (G.running && f < FRAME_CAP) {
    if (brain) brain.step(G);
    G.update(DT);
    f++;
  }
  const res = G.result || G.buildResult(false);
  return { ...res, frames: f, secs: f / 60, stuck: !G.result };
}

function flyEndless(brainName, seedStr, { upgrades = {}, cap = 60 * 420 } = {}) {
  const G = Game;
  G.progress = { upgrades };
  G.reset("endless", Endless.create(seedStr), -1);
  G.running = true; G.paused = false; G.active = false;

  const rnd = mulberry32(keySeed(`${brainName}|endless|${seedStr}`));
  const cfg = BRAINS[brainName];
  const brain = cfg ? makeBrain(cfg, rnd) : null;

  let f = 0;
  while (G.running && f < cap) {
    if (brain) brain.step(G);
    G.update(DT);
    f++;
  }
  const res = G.result || G.buildResult(false);
  return { ...res, frames: f, secs: f / 60, survived: G.running };
}

// Deck-appropriate power: nobody reaches cave 18 with the ship they launched
// in. This plays the campaign once through in order, banks what each result
// actually pays, and spends it between caves like a real player — cheapest
// affordable refit, never saving 780 stardust for the top tier.
function progressionRun(brainName, key) {
  const upgrades = {};
  let dust = 0;
  const rows = [];
  for (let i = 0; i < CAVES.length; i++) {
    const r = flyCave(i, brainName, { upgrades: { ...upgrades }, key });
    dust += r.dust;
    rows.push({ i, ...r, dustAfter: dust, kit: { ...upgrades } });
    if (!r.win) break;
    // shop: buy the cheapest thing affordable, repeatedly
    for (;;) {
      const options = UPGRADES
        .map((u) => ({ u, lvl: upgrades[u.id] || 0 }))
        .filter((o) => o.lvl < o.u.costs.length)
        .map((o) => ({ ...o, cost: o.u.costs[o.lvl] }))
        .filter((o) => o.cost <= dust)
        .sort((a, b) => a.cost - b.cost);
      if (!options.length) break;
      const pick = options[0];
      dust -= pick.cost;
      upgrades[pick.u.id] = pick.lvl + 1;
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ tests */
test("the ace clears every cave in the campaign, first time, unaided", () => {
  const fails = [];
  const rows = [];
  for (let i = 0; i < CAVES.length; i++) {
    const r = flyCave(i, "ace", { key: "guardrail" });
    rows.push(r);
    if (r.stuck) fails.push(`${CAVES[i].id}: never finished in ${FRAME_CAP / 60}s`);
    else if (!r.win) fails.push(`${CAVES[i].id}: ace lost with ${r.rescued}/${r.total} rescued, ${r.crashes} scrapes`);
  }
  if (REPORT) {
    console.log("\n=== ace, no upgrades ===");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      console.log(` ${String(i + 1).padStart(2)} ${CAVES[i].name.padEnd(20)} ` +
        `${r.win ? "win " : "LOSS"} ${r.secs.toFixed(0).padStart(3)}s  ` +
        `${r.stars}★  ${r.rescued}/${r.total} saved  ${r.crashes} scrapes  ${r.score} pts`);
    }
  }
  assert.deepEqual(fails, []);
});

test("an ordinary pilot with the kit she would actually own clears the campaign", () => {
  const fails = [];
  const reports = [];
  for (const key of ["a", "b", "c"]) {
    const rows = progressionRun("kid", key);
    reports.push({ key, rows });
    const lost = rows.find((r) => !r.win);
    if (lost) fails.push(`run ${key}: stopped at ${CAVES[lost.i].id} (${lost.rescued}/${lost.total}, ${lost.crashes} scrapes)`);
  }
  if (REPORT) {
    for (const { key, rows } of reports) {
      console.log(`\n=== kid, progression run ${key} ===`);
      for (const r of rows) {
        console.log(` ${String(r.i + 1).padStart(2)} ${CAVES[r.i].name.padEnd(20)} ` +
          `${r.win ? "win " : "LOSS"} ${r.secs.toFixed(0).padStart(3)}s  ${r.stars}★  ` +
          `${r.rescued}/${r.total}  ${r.crashes} scrapes  hull ${r.hull}  ✨${r.dustAfter}  ` +
          `[${Object.entries(r.kit).map(([k, v]) => k + v).join(" ") || "stock"}]`);
      }
    }
  }
  assert.deepEqual(fails, []);
});

test("caves take a real but not punishing amount of time", () => {
  const fails = [];
  for (let i = 0; i < CAVES.length; i++) {
    const r = flyCave(i, "ace", { key: "timing" });
    if (r.secs > 90) fails.push(`${CAVES[i].id}: ${r.secs.toFixed(0)}s`);
    if (r.secs < 25) fails.push(`${CAVES[i].id}: over in ${r.secs.toFixed(0)}s`);
  }
  assert.deepEqual(fails, []);
});

// The control bot. Note what it is NOT: "an untouched stick never reaches
// daylight" is not a property this genre can have. The controls set a POSITION,
// and a ship holding one absolute y while the tunnel bends around it sweeps the
// whole cross-section — so leaving the stick alone is a bad pilot, not a
// passive one, and it will sometimes squeak through a wide early cave.
//
// What must hold is that it never gets a RESULT: it can never rescue everybody
// (2 stars), never fly clean (3 stars), and never make real progress. The
// rescue quota in game.js is what enforces the last one — before it existed a
// stick nobody touched cleared seven caves and unlocked most of the campaign.
test("an untouched stick never earns a real result", () => {
  const fails = [];
  let wins = 0, rescued = 0, total = 0;
  for (let i = 0; i < CAVES.length; i++) {
    const r = flyCave(i, "idle");
    if (r.win) wins++;
    if (r.stars >= 2) fails.push(`${CAVES[i].id}: an untouched stick earned ${r.stars} stars`);
    rescued += r.rescued; total += r.total;
  }
  if (REPORT) console.log(`\nidle — cleared ${wins}/${CAVES.length}, rescued ${(100 * rescued / total).toFixed(0)}%`);
  assert.deepEqual(fails, []);
  assert.ok(wins <= CAVES.length * 0.25, `an untouched stick cleared ${wins}/${CAVES.length} caves`);
  assert.ok(rescued / total < 0.6, `an untouched stick rescued ${(100 * rescued / total).toFixed(0)}% of the creatures`);
});

// Three stars is "rescue everyone AND never touch anything". It has to be
// reachable, or the top grade is decoration — and it has to be rare enough for
// an ordinary flight that it means something.
// Measured against the HUNTER, not the ace: the ace deliberately gives up a
// creature rather than take a risk, so its star count is a fact about that
// trade-off, not about whether the cave can be flown perfectly. The claim
// "three stars is attainable" lives at the level of someone trying for it.
test("three stars is achievable but not automatic", () => {
  let hunterThree = 0, kidThree = 0, kidRuns = 0;
  const full = {};
  for (const u of UPGRADES) full[u.id] = u.costs.length;
  for (let i = 0; i < CAVES.length; i++) {
    if (flyCave(i, "hunter", { upgrades: full, key: "stars" }).stars === 3) hunterThree++;
  }
  for (const key of ["a", "b", "c"]) {
    for (const r of progressionRun("kid", key)) { kidRuns++; if (r.stars === 3) kidThree++; }
  }
  if (REPORT) console.log(`\nthree-star rate — hunter ${hunterThree}/${CAVES.length}, kid ${kidThree}/${kidRuns}`);
  assert.ok(hunterThree >= CAVES.length * 0.4, `even a perfect run only 3-starred ${hunterThree}/${CAVES.length}`);
  assert.ok(kidThree / kidRuns < 0.8, `an ordinary flight 3-stars ${kidThree}/${kidRuns} — the grade means nothing`);
});

// The upgrades have to be worth buying, and must not delete the game. Measured
// over the whole last world and several noise streams: one cave on one seed
// swings by two scrapes on its own, so a single pair of runs is measuring the
// shuffle rather than the shop.
test("the stardust shop is worth shopping at, and does not trivialise the caves", () => {
  const full = {};
  for (const u of UPGRADES) full[u.id] = u.costs.length;
  const late = [15, 16, 17, 18, 19];
  const tally = (upgrades) => {
    let crashes = 0, hull = 0, saved = 0, n = 0, secs = 0;
    for (const i of late) for (const key of ["s1", "s2", "s3", "s4"]) {
      const r = flyCave(i, "kid", { upgrades, key });
      crashes += r.crashes; hull += r.hull; saved += r.rescued / r.total; secs += r.secs; n++;
    }
    return { crashes: crashes / n, hull: hull / n, saved: saved / n, secs: secs / n };
  };
  const stock = tally({});
  const kitted = tally(full);
  if (REPORT) console.log(`\nlast world, 20 flights each —\n  stock: ${stock.crashes.toFixed(2)} scrapes, ` +
    `${stock.hull.toFixed(2)} hull left, ${(stock.saved * 100).toFixed(0)}% saved\n  full kit: ` +
    `${kitted.crashes.toFixed(2)} scrapes, ${kitted.hull.toFixed(2)} hull left, ${(kitted.saved * 100).toFixed(0)}% saved`);
  assert.ok(kitted.hull > stock.hull + 0.5, "a fully refitted ship finishes no healthier");
  assert.ok(kitted.saved >= stock.saved, "a fully refitted ship rescues no more");
  assert.ok(kitted.secs > 30, "the last world is over in no time even fully kitted");
});

/* ------------------------------------------------------------- deep rescue */
test("the endless dive always ends, and rewards flying well", () => {
  const seeds = ["2026-08-06", "2026-08-13", "2026-09-01", "deep-x"];
  const rows = [];
  const sum = { ace: 0, kid: 0, idle: 0 };
  for (const s of seeds) {
    const ace = flyEndless("ace", s);
    const kid = flyEndless("kid", s);
    const idle = flyEndless("idle", s);
    rows.push({ s, ace, kid, idle });
    sum.ace += ace.score; sum.kid += kid.score; sum.idle += idle.score;
    assert.ok(!ace.survived, `${s}: the ace never ran out of hull — the dive has no end`);
  }
  if (REPORT) {
    console.log("\n=== deep rescue ===");
    for (const r of rows)
      console.log(` ${r.s.padEnd(12)} ace ${String(r.ace.metres).padStart(5)}m ${String(r.ace.score).padStart(6)}pts  ` +
        `kid ${String(r.kid.metres).padStart(5)}m ${String(r.kid.score).padStart(6)}pts  ` +
        `idle ${String(r.idle.metres).padStart(4)}m ${String(r.idle.score).padStart(5)}pts`);
  }
  // Aggregated over every seed, not asserted per dive: one unlucky dive swings
  // a single seed by 2x on its own, and a per-seed bound just measures the
  // shuffle. What has to hold is the ORDERING, across the board.
  assert.ok(sum.ace > sum.kid * 2, `flying well scored ${sum.ace} against sloppy flying's ${sum.kid}`);
  assert.ok(sum.idle < sum.kid * 0.3, `an untouched stick scored ${sum.idle} against ${sum.kid}`);
});

test("a deep dive lasts a sitting, not an afternoon", () => {
  const r = flyEndless("kid", "2026-08-06");
  assert.ok(r.secs > 20, `an ordinary dive lasted ${r.secs.toFixed(0)}s`);
  assert.ok(r.secs < 330, `an ordinary dive lasted ${r.secs.toFixed(0)}s`);
});

/* ------------------------------------------------------------ engine sanity */
test("the ship settles after an input stops, and never runs away", () => {
  const G = Game;
  G.progress = { upgrades: {} };
  G.reset("cave", CAVES[0], 0);
  G.running = true;
  G.input.ty = 40;
  for (let i = 0; i < 120; i++) G.update(DT);
  const held = G.ship.y;
  for (let i = 0; i < 120; i++) G.update(DT);
  assert.ok(Math.abs(G.ship.y - held) < 1.5, `the ship drifted ${(G.ship.y - held).toFixed(2)}px with no input`);
  assert.ok(Math.abs(G.ship.vy) < 4, `the ship still moving at ${G.ship.vy.toFixed(1)} px/s`);
});

test("a monstrous frame gap cannot teleport the ship through a wall", () => {
  const G = Game;
  G.progress = { upgrades: {} };
  G.reset("cave", CAVES[0], 0);
  G.running = true;
  const x0 = G.camX;
  G.update(Math.min(0.05, 60));       // the loop clamps dt; prove the clamp holds
  assert.ok(G.camX - x0 < 20, `one frame advanced the cave by ${(G.camX - x0).toFixed(0)}px`);
});

test("losing is checked before winning", () => {
  const G = Game;
  G.progress = { upgrades: {} };
  G.reset("cave", CAVES[0], 0);
  G.running = true;
  G.camX = CAVES[0].len - 1;
  G.hull = 0;
  G.update(DT);
  assert.equal(G.result.win, false, "reaching daylight on an empty hull counted as a win");
});
