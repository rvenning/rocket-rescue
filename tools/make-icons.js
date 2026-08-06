// Generate icons/ — a little rocket threading a crystal cave.
// Run: node tools/make-icons.js  (from the rocket-rescue folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;                 // 1 unit = 1% of the icon

  const VOID = "#080d22", DEEP = "#141a45";
  const ROCK = "#25406b", EDGE = "#5ad1ff";
  const HULL = "#f4f7ff", NOSE = "#e2556f", FLAME = "#ffb154";
  const MINT = "#7ef0c8";

  // deep space
  cv.fillRect(0, 0, big, big, VOID);
  cv.fillCircle(50 * u, 48 * u, 42 * u, DEEP);

  // maskable art keeps to the safe centre (~72%)
  const s = pad ? 0.76 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // cave walls: a band of rock top and bottom, with a lit lip facing the tunnel
  for (let x = 0; x < 100; x += 2) {
    const wob = Math.sin(x / 13) * 7;
    const ceil = 30 + wob, floor = 72 + wob;
    cv.fillRect(at(x), at(-10), sz(2.2), sz(ceil + 10), ROCK);
    cv.fillRect(at(x), at(floor), sz(2.2), sz(110 - floor), ROCK);
    cv.fillRect(at(x), at(ceil - 1.6), sz(2.2), sz(1.6), EDGE);
    cv.fillRect(at(x), at(floor), sz(2.2), sz(1.6), EDGE);
  }

  // a rescued creature trailing behind
  cv.fillCircle(at(26), at(56), sz(6), MINT);
  cv.fillCircle(at(24), at(54), sz(1.6), "#0d2b3a");
  cv.fillCircle(at(29), at(54), sz(1.6), "#0d2b3a");

  // the ship
  const cy = 50;
  cv.fillRect(at(40), at(cy - 4), sz(20), sz(8), HULL);
  cv.fillCircle(at(60), at(cy), sz(4), NOSE);
  cv.fillCircle(at(40), at(cy), sz(4), HULL);
  cv.fillRect(at(44), at(cy - 9), sz(6), sz(5), NOSE);      // top fin
  cv.fillRect(at(44), at(cy + 4), sz(6), sz(5), NOSE);      // bottom fin
  cv.fillCircle(at(50), at(cy - 0.5), sz(3), EDGE);         // canopy
  // exhaust
  cv.fillCircle(at(36), at(cy), sz(4), FLAME);
  cv.fillCircle(at(31), at(cy), sz(2.4), "#ffe37a");

  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);
