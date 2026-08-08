// Shared loader for the test suites.
//
// The game ships plain <script> files with top-level `const` and no bundler, so
// the suites run the real sources in a vm sandbox with just enough of a browser
// stubbed out. `browser: true`, because the tunnel geometry comes from
// gamekit's GK.Corridor and every gk-* module opens with
// `window.GK = window.GK || {}`. The `exports` list is what gets the game's own
// top-level bindings back out.
//
// A pre-seeded GK in `globals` survives that line, which is the hook for
// stubbing the UI layer.
//
// Order must match index.html's, or a file that reads another's top-level const
// crashes on load.

const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");

const noop = () => {};

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "lib/gk-util.js",
    "lib/gk-path.js",
    "js/caves.js",
    "js/creatures.js",
    "js/hazards.js",
    "js/powerups.js",
    "js/rng.js",
    "js/endless.js",
    "js/upgrades.js",
    "js/game.js",
  ],
  exports: [
    "GK",
    "LW", "LH", "SHIP_R", "SHIP_W", "SHIP_H", "WALL_CLEAR", "BAND", "TAU",
    "Cave", "WORLDS", "CAVES", "CAVES_RAW", "cavesOfWorld",
    "CREATURES", "CREATURE_LIST", "creaturePos",
    "HAZARD_KINDS", "COMET_LEAD", "LANE_MIN", "fitRadius", "hazardShapes", "blockedAt", "hitsShape",
    "freeLanes", "freeLane", "corridorAhead", "intersectIntervals",
    "POWERUPS", "POWERUP_LIST", "ORB_R",
    "RNG", "SEG", "ENDLESS_SPEED", "Endless",
    "UPGRADES", "upgradeValue",
    "SHIP", "RULES", "Game",
  ],
  browser: true,
  globals: {
    // Everything the engine pokes at outside its own simulation. gk-util.js
    // does `window.GK = window.GK || {}`, so this stub survives and GK.Corridor
    // is added to it.
    GK: { UI: { showScreen: noop, openModal: noop, closeModal: noop, toast: noop } },
    Sfx: new Proxy({}, { get: () => noop }),
    Music: { enabled: false, start: noop, stop: noop, hold: noop },
    App: { caveOver: noop },
    Storage: { getProgress: () => ({ upgrades: {} }) },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null },
    performance: { now: () => 0 },
    requestAnimationFrame: noop,
  },
});

module.exports = S;
