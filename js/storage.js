// Persistence — gamekit storage configured for Rocket Rescue.
// rkt_* localStorage keys, "rocketrescue" Firestore collection.
//
// Stardust is SPENT in the shop, so a plain max() merge would resurrect spent
// coins the next time two devices met. Both sides of the ledger are monotonic
// counters instead — dustEarned and dustSpent only ever grow — and the balance
// is derived, which makes max() safe again.
//
// blank/merge are declared as a named object before being handed to
// createStorage, because createStorage keeps them in a closure and never
// exposes them — and mergeProgress is the one function in the game that can
// permanently destroy a save, so tests/storage.test.js has to be able to call it.

const PROGRESS = {
  blank: () => ({
    dustEarned: 0, dustSpent: 0,
    caves: {},          // { [caveIdx]: { score, stars } } — best result per cave
    upgrades: {},       // { [upgradeId]: level }
    best: 0,            // best Deep Rescue score — the leaderboard headline
    bestDepth: 0,       // furthest Deep Rescue metres
    rescued: 0,         // LIFETIME creatures rescued
    runs: 0,
    updated: 0,
  }),

  merge: (a, b) => {
    const caves = { ...(a.caves || {}) };
    for (const [idx, c] of Object.entries(b.caves || {})) {
      const cur = caves[idx];
      if (!cur) { caves[idx] = c; continue; }
      caves[idx] = {
        score: Math.max(cur.score || 0, c.score || 0),
        stars: Math.max(cur.stars || 0, c.stars || 0),
      };
    }
    const upgrades = { ...(a.upgrades || {}) };
    for (const [id, lvl] of Object.entries(b.upgrades || {}))
      upgrades[id] = Math.max(upgrades[id] || 0, lvl);
    return {
      // Spread first so a field a newer client added survives an older client's
      // merge, then pin the fields we know how to reconcile.
      ...a, ...b,
      dustEarned: Math.max(a.dustEarned || 0, b.dustEarned || 0),
      dustSpent: Math.max(a.dustSpent || 0, b.dustSpent || 0),
      best: Math.max(a.best || 0, b.best || 0),
      bestDepth: Math.max(a.bestDepth || 0, b.bestDepth || 0),
      rescued: Math.max(a.rescued || 0, b.rescued || 0),
      runs: Math.max(a.runs || 0, b.runs || 0),
      caves, upgrades,
    };
  },
};

const Storage = GK.createStorage({
  prefix: "rkt",
  collection: "rocketrescue",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});

Object.assign(Storage, {
  dust(progress) { return Math.max(0, (progress.dustEarned || 0) - (progress.dustSpent || 0)); },

  totalStars(progress) {
    return Object.values(progress.caves || {}).reduce((s, c) => s + (c.stars || 0), 0);
  },

  // Caves unlock in order: the one after the furthest cleared.
  unlockedCave(progress) {
    let max = -1;
    for (const k of Object.keys(progress.caves || {})) max = Math.max(max, Number(k));
    return Math.min(max + 1, CAVES.length - 1);
  },

  campaignDone(progress) {
    return Object.keys(progress.caves || {}).length >= CAVES.length;
  },

  // Fold one finished cave into the profile. Only a WIN records the cave —
  // recording a loss would unlock the next one — but the stardust and the
  // lifetime rescue count are banked either way, so a failed attempt still
  // moves the player forward.
  recordCave(profileId, caveIdx, { win, score, stars, dust, rescued }) {
    const prog = this.getProgress(profileId);
    if (win) {
      const cur = prog.caves[caveIdx];
      if (!cur) prog.caves[caveIdx] = { score, stars };
      else {
        cur.score = Math.max(cur.score || 0, score);
        cur.stars = Math.max(cur.stars || 0, stars);
      }
    }
    prog.dustEarned = (prog.dustEarned || 0) + (dust || 0);
    prog.rescued = (prog.rescued || 0) + (rescued || 0);
    prog.runs = (prog.runs || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  recordEndless(profileId, res) {
    const prog = this.getProgress(profileId);
    prog.best = Math.max(prog.best || 0, res.score || 0);
    prog.bestDepth = Math.max(prog.bestDepth || 0, res.metres || 0);
    prog.dustEarned = (prog.dustEarned || 0) + (res.dust || 0);
    prog.rescued = (prog.rescued || 0) + (res.rescued || 0);
    prog.runs = (prog.runs || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  buyUpgrade(profileId, upgradeId) {
    const prog = this.getProgress(profileId);
    const def = UPGRADES.find((u) => u.id === upgradeId);
    const lvl = (prog.upgrades && prog.upgrades[upgradeId]) || 0;
    if (!def || lvl >= def.costs.length) return { ok: false, reason: "maxed" };
    const cost = def.costs[lvl];
    if (this.dust(prog) < cost) return { ok: false, reason: "dust" };
    prog.dustSpent = (prog.dustSpent || 0) + cost;
    prog.upgrades = prog.upgrades || {};
    prog.upgrades[upgradeId] = lvl + 1;
    this.saveProgress(profileId, prog);
    return { ok: true, progress: prog };
  },
});
