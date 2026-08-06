// Permanent ship upgrades, bought with stardust. Pure data: the shop screen,
// the price curve and the in-game effect all read this table, so adding one is
// a single entry plus a `upgradeValue(upgrades, id, fallback)` lookup wherever
// it applies.
//
//   costs  stardust price per level (length = max level)
//   value  effect per level (value[level - 1])

const UPGRADES = [
  { id: "hull", name: "Reinforced Hull", icon: "🛠️",
    desc: "Launch every cave with extra hull",
    costs: [260, 780], value: [1, 2], fmt: (v) => `+${v} hull` },

  { id: "thrust", name: "Ion Thrusters", icon: "🔥",
    desc: "The ship answers the controls faster",
    costs: [150, 380, 820], value: [1.14, 1.28, 1.44], fmt: (v) => `×${v} response` },

  { id: "beam", name: "Wide Beam", icon: "📡",
    desc: "Scoop creatures up from further away",
    costs: [140, 360, 800], value: [5, 10, 16], fmt: (v) => `+${v} reach` },

  { id: "magnet", name: "Magnet Coils", icon: "🧲",
    desc: "Tractor beams last longer and pull harder",
    costs: [220, 560], value: [1.4, 1.9], fmt: (v) => `×${v} tractor` },

  { id: "chrono", name: "Chrono Cells", icon: "⏳",
    desc: "Slow fields last longer",
    costs: [220, 560], value: [1.5, 2], fmt: (v) => `×${v} slow field` },

  { id: "launch", name: "Launch Shield", icon: "🛡️",
    desc: "Begin every cave inside a bubble shield",
    costs: [700], value: [1], fmt: () => "shield on launch" },
];

function upgradeValue(upgrades, id, fallback) {
  const def = UPGRADES.find((u) => u.id === id);
  const lvl = (upgrades && upgrades[id]) || 0;
  if (!def || lvl <= 0) return fallback;
  return def.value[Math.min(lvl, def.value.length) - 1];
}

if (typeof window === "undefined") Object.assign(globalThis, { UPGRADES, upgradeValue });
