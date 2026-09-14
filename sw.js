// Rocket Rescue service worker — network-first, cache fallback.
// BUMP the cache name on ANY shell change or devices keep serving the old build.
const CACHE = "rocket-rescue-v7";
const SHELL = [
  ".",
  "index.html",
  "manifest.json",
  "css/style.css",
  "lib/gk-base.css",
  "lib/gk-util.js",
  "lib/gk-audio.js",
  "lib/gk-ui.js",
  "lib/gk-storage.js",
  "lib/gk-profiles.js",
  "lib/gk-pwa.js",
  "lib/gk-fx.js",
  "lib/gk-debug.js",
  "lib/gk-path.js",
  "js/firebase-config.js",
  "js/caves.js",
  "js/creatures.js",
  "js/hazards.js",
  "js/powerups.js",
  "js/rng.js",
  "js/endless.js",
  "js/upgrades.js",
  "js/storage.js",
  "js/audio.js",
  "js/game.js",
  "js/render.js",
  "js/main.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let Firebase/fonts hit the network
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
