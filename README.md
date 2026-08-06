# Rocket Rescue 🚀

Fly a tiny ship down twenty colourful obstacle caves, scoop up the cute space
creatures stranded inside, and reach daylight with your hull in one piece.

**[▶ Play it](https://rvenning.github.io/rocket-rescue/)**

## How it works

The cave scrolls past and you steer through it. The rock is the real enemy; the
asteroids, spikes, ion gates and comets inside it are the punctuation.

The creatures never sit on the line you were already flying — they alternate
above and below the centre, so every rescue is a deliberate detour off the safe
route and back again. That is the whole game: how much do you go off-line for,
with a scrape costing one of four hull points?

Reaching daylight is not enough on its own. This is a *rescue* — bring home at
least 60% of the creatures in a cave or you go back and try again. An ordinary
flight brings home nearly all of them, so it is a floor, not a hurdle.

**Controls** — drag anywhere on the screen and the ship follows your finger's
movement, so your thumb is never sitting on top of the thing you are flying. A
mouse steers directly; arrow keys and `WASD` work too, and `P` pauses.

## Features

- **Twenty caves across four worlds** — Crystal Hollows, Coral Nebula, Magma
  Vents and The Void Core — each with its own palette, and each ending in a
  Guardian den patrolled by something a lot bigger than an asteroid.
- **Three stars per cave**: reach daylight for one, bring everybody home for
  two, and fly the whole thing without a single scrape for three.
- **Power-ups** — Tractor Beam (a magnet that widens your scoop enormously),
  Slow Field (half speed, hazards included — they *are* the scroll), Bubble
  Shield and a Repair Kit.
- **A stardust shop**: permanent refits for the ship — extra hull, sharper
  thrusters, a wider rescue beam, longer tractor beams and slow fields, and a
  shield on every launch.
- **Deep Rescue**, an endless dive that unlocks after the third cave. The
  passage keeps closing and the scroll keeps climbing until it beats you. The
  seed is **today's date**, so everyone in the family flies the same cave on the
  same day — and it is the score the leaderboard ranks.
- **Family profiles + leaderboard**, synced across every device in the house.
- Installs to a home screen and plays offline.

## How a cave is built

A cave is a *path*, so it is authored as waypoint stations — `[x, centreY,
gapHeight]` — and the engine smoothsteps between them. Both the renderer and the
collision code read the same `Cave.ceilAt`/`floorAt`, so the rock you can see is
exactly the rock you can hit.

Everything placed inside a cave is positioned by a fraction *across* the tunnel
rather than in absolute pixels, which makes it impossible to author a creature
inside solid rock and means widening a passage moves its contents with it.

And every hazard is a pure function of the scroll position — nothing integrates,
nothing reads a clock. That is what lets `tests/caves.test.js` prove a flyable
lane exists at every point of every cave, and what makes Slow Field a real power
rather than a cosmetic one.

## Built on gamekit

Profiles with PINs, the leaderboard, family sync, the sound engine, the particle
layer and the install button all come from
[gamekit](https://github.com/rvenning/gamekit), vendored into `lib/`. To pull in
a newer kit:

```bash
node "../gamekit/tools/sync-to-game.js" "../rocket-rescue"
```

Then re-test and bump the cache version in `sw.js` — devices keep serving the
old build otherwise.

## Local development

No build step; it's plain scripts.

```bash
npx http-server . -p 8113 -c-1
```

Then open <http://localhost:8113>. `?debug=1` adds a dev panel (and suppresses
saving, so never check persistence on it).

## Tests

```bash
node --test
```

- `tests/caves.test.js` — the cave linter. Path geometry, climb rates, contents
  in open space, and the headline guarantee: a flyable lane at every point of
  every campaign cave, and of a generated endless cave over eight seeds.
- `tests/bot.test.js` — headless pilots flying the real engine. An **ace** that
  nothing may be unwinnable by, a **kid** with imprecise aim and moments of not
  looking that has to clear the campaign with the kit she would actually own by
  then, a **hunter** that proves three stars is attainable, and an **untouched
  stick** that must never earn a real result. `--report` prints the per-cave
  table.
- `tests/storage.test.js` — progress and cross-device reconciliation, including
  the two-sided stardust ledger that stops a sync refunding what was spent.

## PWA files

`manifest.json`, `sw.js` (network-first, cache-versioned) and `icons/`
(regenerate with `node tools/make-icons.js`).

## Storage

`localStorage` under the `rkt_` prefix, synced to the `rocketrescue` collection
in the shared family Firebase project. The API key in `js/firebase-config.js` is
a client config, not a secret — it's restricted to the Cloud Firestore API and
to the games' own origins.
