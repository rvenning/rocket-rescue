// Power-up orbs. Two of them (magnet, slow-mo) are the ones Robert asked for
// and they carry the game: the magnet turns a risky reach into a safe one, and
// slow-mo buys reaction time through the hazard everybody dies to.
//
// `dur` is in seconds and is the BASE value — the shop lengthens it. Shield and
// mend are instant, so their dur is 0.

const POWERUPS = {
  magnet: { id: "magnet", name: "Tractor Beam", icon: "🧲", color: "#5ad1ff", dur: 6,
            blurb: "Pulls nearby creatures into the hold" },
  slowmo: { id: "slowmo", name: "Slow Field",   icon: "⏳", color: "#c58bff", dur: 5,
            blurb: "Half speed — everything, hazards included" },
  shield: { id: "shield", name: "Bubble Shield", icon: "🛡️", color: "#ffd166", dur: 0,
            blurb: "Soaks up one crash" },
  mend:   { id: "mend",   name: "Repair Kit",    icon: "💗", color: "#ff8fc0", dur: 0,
            blurb: "Patches one point of hull" },
};

const POWERUP_LIST = Object.values(POWERUPS);
const ORB_R = 9;

if (typeof window === "undefined") {
  Object.assign(globalThis, { POWERUPS, POWERUP_LIST, ORB_R });
}
