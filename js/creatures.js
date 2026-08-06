// The cute space creatures you are actually here for.
//
// Like hazards, a creature's position is a pure function of the scroll — it
// drifts as you approach rather than on a clock of its own, so a cave is the
// same puzzle every time you fly it and the balance bot measures design.
//
//   points  score for a rescue
//   bob     how far it wanders, as a fraction of the tunnel gap
//   wave    scroll distance for one full wander
//   r       body radius (drawing + the pickup test)

const CREATURES = {
  blip: {
    id: "blip", name: "Blip", points: 100, bob: 0.05, wave: 220, r: 7,
    body: "#7ef0c8", belly: "#d8fff2", eye: "#0d2b3a", blush: "#ff9ec8", ears: 2,
  },
  hopper: {
    id: "hopper", name: "Hopper", points: 160, bob: 0.28, wave: 300, r: 7.5,
    body: "#ffd166", belly: "#fff0c2", eye: "#3a2a08", blush: "#ff8f6b", ears: 1,
  },
  glimmer: {
    id: "glimmer", name: "Glimmer", points: 280, bob: 0.17, wave: 170, r: 8,
    body: "#c58bff", belly: "#f0dcff", eye: "#231044", blush: "#ffd1f0", ears: 3,
  },
};

const CREATURE_LIST = Object.values(CREATURES);

// Stable per-creature phase, from x alone — two Blips side by side still bob
// out of step, and they do it identically on every device.
function creaturePhase(c) { return ((c.x * 0.382) % 1) * TAU; }

function creaturePos(c, camX, path) {
  const spec = CREATURES[c.type];
  const s = Cave.sample(path, c.x);
  const base = Cave.place(path, c.x, c.t);
  const amp = spec.bob * s.g;
  const ceil = s.c - s.g / 2 + spec.r + 1;
  const floor = s.c + s.g / 2 - spec.r - 1;
  let y = base + amp * Math.sin((TAU * camX) / spec.wave + creaturePhase(c));
  if (floor > ceil) y = Math.max(ceil, Math.min(floor, y));
  else y = s.c;
  return { x: c.x, y, r: spec.r };
}

if (typeof window === "undefined") {
  Object.assign(globalThis, { CREATURES, CREATURE_LIST, creaturePhase, creaturePos });
}
