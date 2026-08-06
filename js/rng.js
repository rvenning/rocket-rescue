// Deterministic randomness for the endless Deep Rescue.
//
// The rule, borrowed from Ricochet Spire and worth repeating: never draw from a
// running stream. Derive a fresh generator from COORDINATES — RNG.sub(seed,
// "seg", n) — so what segment 12 contains depends only on that it is segment 12
// of that seed, never on how far the player got or what was generated first.
//
// Two things fall out for free. A cave can be built lazily, in pieces, as the
// ship reaches it, and still be identical to one built all at once (which is
// what lets tests/caves.test.js lint 200 segments of it offline). And the daily
// Deep Rescue is genuinely the same cave for everyone in the family.

const RNG = {
  // FNV-1a: any string -> a 32-bit seed. "2026-08-06" -> today's cave.
  seedFrom(str) {
    const s = String(str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  make(seed = 0) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    return next;
  },

  sub(seed, ...parts) {
    return RNG.make((seed ^ RNG.seedFrom(parts.join("|"))) >>> 0);
  },

  // Today's date in the player's own timezone — the date on their calendar is
  // the cave they fly.
  today(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { RNG });
