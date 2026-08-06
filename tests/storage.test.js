// Progress and cross-device reconciliation.
//
// mergeProgress is the one function in the game that can permanently destroy a
// save — it runs on every sync, on every device, and a bad merge is not a bug
// you notice, it is a child's campaign quietly rolling backwards. It lives in a
// closure inside createStorage, so js/storage.js declares it as a named PROGRESS
// object first purely so this file can reach it.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const noop = () => {};

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "lib/gk-util.js",
    "lib/gk-storage.js",
    "js/caves.js",
    "js/creatures.js",
    "js/hazards.js",
    "js/powerups.js",
    "js/rng.js",
    "js/endless.js",
    "js/upgrades.js",
    "js/storage.js",
  ],
  // browser:true, unlike tests/load.js — gk-storage needs window, localStorage
  // and a document. The `exports` list is what gets the bindings back out.
  exports: ["PROGRESS", "Storage", "CAVES", "UPGRADES"],
  browser: true,
});

const { PROGRESS, Storage, CAVES, UPGRADES } = S;
const blank = () => PROGRESS.blank();

/* -------------------------------------------------------- the coin ledger */
test("stardust is a two-sided ledger, so a sync cannot refund what was spent", () => {
  // Device A earns 500 and spends 400. Device B is a stale copy that only ever
  // saw the 500 earned. A max() merge of a plain BALANCE would hand back the
  // 400 — which is exactly why there is no balance field.
  const a = { ...blank(), dustEarned: 500, dustSpent: 400 };
  const b = { ...blank(), dustEarned: 500, dustSpent: 0 };
  const m = PROGRESS.merge(a, b);
  assert.equal(Storage.dust(m), 100);
  assert.equal(Storage.dust(PROGRESS.merge(b, a)), 100, "the merge has to be order-independent");
});

test("two devices that each bought something keep both purchases", () => {
  const a = { ...blank(), dustEarned: 1000, dustSpent: 150, upgrades: { beam: 1 } };
  const b = { ...blank(), dustEarned: 1000, dustSpent: 260, upgrades: { hull: 1 } };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.upgrades, { beam: 1, hull: 1 });
  // Both bills are paid: spending is max()-merged, so the cheaper purchase is
  // effectively forgiven rather than double-charged. Erring toward the player.
  assert.equal(m.dustSpent, 260);
});

/* ------------------------------------------------------------- cave results */
test("a cave keeps its best score and its best stars, from either device", () => {
  const a = { ...blank(), caves: { 0: { score: 900, stars: 1 }, 1: { score: 400, stars: 2 } } };
  const b = { ...blank(), caves: { 0: { score: 500, stars: 3 }, 2: { score: 700, stars: 1 } } };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.caves[0], { score: 900, stars: 3 }, "best of each field, not best row");
  assert.deepEqual(m.caves[1], { score: 400, stars: 2 });
  assert.deepEqual(m.caves[2], { score: 700, stars: 1 });
});

test("a merge never walks progress backwards", () => {
  const ahead = { ...blank(), best: 8000, bestDepth: 900, rescued: 300, runs: 40,
                  caves: { 0: { score: 1, stars: 3 }, 1: { score: 1, stars: 2 } } };
  const fresh = blank();
  for (const m of [PROGRESS.merge(ahead, fresh), PROGRESS.merge(fresh, ahead)]) {
    assert.equal(m.best, 8000);
    assert.equal(m.bestDepth, 900);
    assert.equal(m.rescued, 300);
    assert.equal(Storage.totalStars(m), 5);
  }
});

test("a field a newer build adds survives an older build's merge", () => {
  const newer = { ...blank(), shipSkin: "comet" };
  const older = blank();
  assert.equal(PROGRESS.merge(older, newer).shipSkin, "comet");
});

/* ------------------------------------------------------------ progression */
test("caves unlock strictly in order", () => {
  assert.equal(Storage.unlockedCave(blank()), 0);
  assert.equal(Storage.unlockedCave({ ...blank(), caves: { 0: { score: 1, stars: 1 } } }), 1);
  // A gap in the record must not unlock past it by accident, and the last cave
  // must not unlock a 21st.
  const all = {};
  for (let i = 0; i < CAVES.length; i++) all[i] = { score: 1, stars: 1 };
  assert.equal(Storage.unlockedCave({ ...blank(), caves: all }), CAVES.length - 1);
  assert.ok(Storage.campaignDone({ ...blank(), caves: all }));
});

test("only a clear unlocks the next cave, but a failed flight still pays", () => {
  const store = {};
  const stub = {
    ...Storage,
    getProgress: () => store.p || (store.p = blank()),
    saveProgress: (_id, p) => { store.p = p; },
  };
  stub.recordCave.call(stub, "p1", 0, { win: false, score: 400, stars: 0, dust: 60, rescued: 3 });
  assert.equal(Storage.unlockedCave(store.p), 0, "a loss unlocked the next cave");
  assert.equal(store.p.dustEarned, 60, "a loss paid nothing for the creatures actually saved");
  assert.equal(store.p.rescued, 3);

  stub.recordCave.call(stub, "p1", 0, { win: true, score: 900, stars: 2, dust: 120, rescued: 5 });
  assert.equal(Storage.unlockedCave(store.p), 1);
  assert.equal(store.p.dustEarned, 180);
});

/* ---------------------------------------------------------------- the shop */
test("the shop refuses what cannot be afforded and stops at the top level", () => {
  const store = { p: { ...blank(), dustEarned: 200 } };
  const stub = { ...Storage, getProgress: () => store.p, saveProgress: (_id, p) => { store.p = p; } };
  const beam = UPGRADES.find((u) => u.id === "beam");

  assert.equal(stub.buyUpgrade.call(stub, "p1", "hull").ok, false, "bought an upgrade it could not afford");
  assert.equal(stub.buyUpgrade.call(stub, "p1", "beam").ok, true);
  assert.equal(store.p.upgrades.beam, 1);
  assert.equal(store.p.dustSpent, beam.costs[0]);

  store.p.dustEarned = 999999;
  for (let i = 1; i < beam.costs.length; i++) assert.equal(stub.buyUpgrade.call(stub, "p1", "beam").ok, true);
  assert.equal(stub.buyUpgrade.call(stub, "p1", "beam").reason, "maxed");
  assert.equal(store.p.upgrades.beam, beam.costs.length);
});

test("every upgrade's cost and value tables line up", () => {
  const fails = [];
  for (const u of UPGRADES) {
    if (u.costs.length !== u.value.length) fails.push(`${u.id}: ${u.costs.length} costs, ${u.value.length} values`);
    for (let i = 1; i < u.costs.length; i++)
      if (u.costs[i] <= u.costs[i - 1]) fails.push(`${u.id}: level ${i + 1} is no dearer than level ${i}`);
  }
  assert.deepEqual(fails, []);
});
