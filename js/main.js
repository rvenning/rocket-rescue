// App shell — splash, the profile roster, the cave map, the stardust shop,
// results and the family leaderboard. Profiles, PINs, sync and install all come
// from gamekit; this file only decides what goes on each screen.

const AVATARS = ["🚀", "🛸", "👩‍🚀", "🐣", "🦄", "🌟", "🪐", "🐙", "🦊", "🐼", "🐸", "🦉"];

const App = {
  profile: null,

  el(id) { return document.getElementById(id); },

  init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound !== false;
    Music.enabled = settings.music !== false;

    GK.UI.onScreenChange = (name) => {
      Game.active = name === "game";
      if (name !== "game") Music.stop();
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);
    // Every menu button clicks; buttons that make their own sound keep it.
    GK.UI.bindMenuClicks();

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) =>
        `⭐ ${Storage.totalStars(prog)}/${CAVES.length * 3} · 🐣 ${prog.rescued || 0} · 🏆 ${(prog.best || 0).toLocaleString()}`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Pilot",
    });

    GK.initPWA({ appName: "Rocket Rescue" });
    Game.boot();

    GK.Debug.init({ storage: Storage, title: "ROCKET RESCUE" })
      .jump("cave", CAVES.length, (n) => this.startCave(n - 1))
      .action("daylight", () => { if (Game.running) Game.camX = Game.cave.len - 20; })
      .action("+1 hull", () => { Game.hull = Math.min(Game.hullMax, Game.hull + 1); });

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "map") this.showMap();
      if (ok && GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
  },

  showScreen(name) { GK.UI.showScreen(name); },

  toggleMusic() {
    const on = Music.toggle();
    this.el("btn-music").textContent = on ? "🎵 Music: On" : "🔇 Music: Off";
    const s = Storage.getSettings();
    s.music = on;
    Storage.saveSettings(s);
    if (on && Game.running && !Game.paused) Music.start(Game.mode === "endless" ? "deep" : "cruise");
    Sfx.click();
  },

  /* ------------------------------- splash -------------------------------- */
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `🚀 Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch Pilot";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "🚀 Start Flying";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  /* --------------------------------- map --------------------------------- */
  showMap() {
    if (!this.profile) return this.play();
    const prog = Storage.getProgress(this.profile.id);
    const unlocked = Storage.unlockedCave(prog);

    this.el("map-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("map-stars").textContent = `⭐ ${Storage.totalStars(prog)}`;
    this.el("map-dust").textContent = `✨ ${Storage.dust(prog)}`;

    const cont = this.el("btn-continue");
    cont.textContent = `▶️ ${CAVES[unlocked].name}`;
    cont.onclick = () => this.startCave(unlocked);

    const deep = this.el("btn-deep");
    if (prog.caves && prog.caves[2] !== undefined) {
      deep.style.display = "";
      deep.textContent = `🌌 Deep Rescue — best ${(prog.best || 0).toLocaleString()}`;
    } else {
      deep.style.display = "none";
    }

    this.el("world-list").innerHTML = WORLDS.map((w) => {
      const caves = CAVES.map((c, i) => ({ c, i })).filter((e) => e.c.world === w.id);
      const cells = caves.map(({ c, i }) => {
        const done = prog.caves && prog.caves[i];
        const open = i <= unlocked;
        const stars = done ? done.stars : 0;
        return `<button class="cave${open ? "" : " locked"}${i === unlocked ? " next" : ""}"
          ${open ? `onclick="App.startCave(${i})"` : "disabled"}
          aria-label="${open ? `Cave ${i + 1}, ${GK.util.esc(c.name)}, ${stars} stars` : `Cave ${i + 1}, locked`}">
          <span class="cave-n">${open ? i + 1 : "🔒"}</span>
          <span class="cave-name">${open ? GK.util.esc(c.name) : "???"}</span>
          <span class="cave-stars">${open ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</span>
        </button>`;
      }).join("");
      return `<section class="world" style="--wc:${w.edge}">
        <h3>${w.icon} ${GK.util.esc(w.name)}</h3>
        <div class="cave-grid">${cells}</div>
      </section>`;
    }).join("");

    this.showScreen("map");
  },

  startCave(idx) {
    Sfx.init(); Sfx.click();
    Game.startCave(this.profile, idx);
  },

  startDeep() {
    Sfx.init(); Sfx.click();
    Game.startEndless(this.profile, RNG.today());
  },

  /* -------------------------------- shop --------------------------------- */
  showShop() {
    Sfx.click();
    const prog = Storage.getProgress(this.profile.id);
    this.el("shop-dust").textContent = `✨ ${Storage.dust(prog)}`;
    this.el("shop-list").innerHTML = UPGRADES.map((u) => {
      const lvl = (prog.upgrades && prog.upgrades[u.id]) || 0;
      const maxed = lvl >= u.costs.length;
      const cost = maxed ? 0 : u.costs[lvl];
      const afford = Storage.dust(prog) >= cost;
      const pips = "●".repeat(lvl) + "○".repeat(u.costs.length - lvl);
      return `<div class="shop-card${maxed ? " maxed" : ""}">
        <span class="shop-icon">${u.icon}</span>
        <span class="shop-info">
          <span class="shop-name">${GK.util.esc(u.name)} <span class="shop-pips">${pips}</span></span>
          <span class="shop-desc">${GK.util.esc(u.desc)}${lvl ? ` — now ${GK.util.esc(String(u.fmt(u.value[lvl - 1])))}` : ""}</span>
        </span>
        ${maxed
          ? `<span class="shop-max">MAX</span>`
          : `<button class="btn small${afford ? " green" : " grey"}" ${afford ? "" : "disabled"}
               onclick="App.buy('${u.id}')">✨ ${cost}</button>`}
      </div>`;
    }).join("");
    this.showScreen("shop");
  },

  buy(id) {
    const r = Storage.buyUpgrade(this.profile.id, id);
    if (!r.ok) { GK.UI.toast(r.reason === "dust" ? "Not enough stardust" : "Already maxed"); Sfx.wrong(); return; }
    Sfx.orb();
    GK.UI.toast("Upgraded!");
    this.showShop();
  },

  /* ------------------------------- results ------------------------------- */
  caveOver(res, quit) {
    if (quit) { this.showMap(); return; }
    const prog = res.mode === "endless"
      ? Storage.recordEndless(this.profile.id, res)
      : Storage.recordCave(this.profile.id, res.caveIdx, res);

    const emoji = this.el("res-emoji"), title = this.el("res-title");
    const stars = this.el("res-stars"), stats = this.el("res-stats");
    const next = this.el("res-next"), retry = this.el("res-retry");

    if (res.mode === "endless") {
      const best = res.score >= (prog.best || 0) && res.score > 0;
      emoji.textContent = best ? "🏆" : "💥";
      title.textContent = best ? "NEW BEST!" : "Out of hull";
      stars.textContent = "";
      this.el("res-score").textContent = res.score.toLocaleString();
      stats.innerHTML = [`🐣 ${res.rescued} rescued`, `📏 ${res.metres}m deep`,
                         `🔥 best streak ${res.bestStreak}`, `✨ ${res.dust} stardust`]
        .map((b) => `<div>${b}</div>`).join("");
      next.style.display = "none";
      retry.style.display = "";
      retry.textContent = "↻ Dive Again";
      retry.onclick = () => this.startDeep();
      if (best) setTimeout(() => Sfx.newBest(), 300);
      this.showScreen("results");
      return;
    }

    emoji.textContent = res.win ? "🌅" : res.escaped ? "🐣" : "💥";
    title.textContent = res.win ? "Daylight!" : res.escaped ? "Too many left behind" : "Hull breached";
    stars.textContent = res.win ? "★".repeat(res.stars) + "☆".repeat(3 - res.stars) : "";
    this.el("res-score").textContent = res.score.toLocaleString();
    stats.innerHTML = [
      `🐣 ${res.rescued}/${res.total} rescued`,
      `❤ ${res.hull} hull left`,
      `💥 ${res.crashes} scrapes`,
      `✨ ${res.dust} stardust`,
    ].map((b) => `<div>${b}</div>`).join("");

    const nudge = this.el("res-note");
    // Win cases first: `escaped` is true on a win as well, so testing it before
    // the win branch told a perfect flight it had left everybody behind.
    if (res.win) {
      nudge.textContent = res.stars === 3 ? "Perfect flight. 🌟"
        : res.rescued < res.total ? `Rescue all ${res.total} for 2 stars — and fly it clean for 3.`
        : "Fly it without a single scrape for 3 stars.";
    } else if (res.escaped) {
      nudge.textContent = `You made it out, but a rescue needs at least ${res.quota} of the ${res.total}. You keep their stardust — go back for the rest!`;
    } else {
      nudge.textContent = "You keep the stardust from everyone you saved. Have another go!";
    }

    retry.style.display = "";
    retry.textContent = res.win ? "↻ Fly Again" : "↻ Retry";
    retry.onclick = () => this.startCave(res.caveIdx);

    const nextIdx = res.caveIdx + 1;
    if (res.win && nextIdx < CAVES.length) {
      next.style.display = "";
      next.textContent = `▶️ ${CAVES[nextIdx].name}`;
      next.onclick = () => this.startCave(nextIdx);
    } else {
      next.style.display = "none";
    }
    this.el("res-finished").style.display =
      res.win && nextIdx >= CAVES.length ? "" : "none";

    if (res.win) for (let i = 0; i < res.stars; i++) setTimeout(() => Sfx.star(i + 1), 400 + i * 260);
    this.showScreen("results");
  },

  /* ----------------------------- leaderboard ----------------------------- */
  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">⭐ ${Storage.totalStars(r.progress)}</span>
        <span class="lb-stat">🐣 ${r.progress.rescued || 0}</span>
        <span class="lb-stat">🏆 ${(r.progress.best || 0).toLocaleString()}</span>`,
      sort: (a, b) => (b.progress.best || 0) - (a.progress.best || 0)
        || Storage.totalStars(b.progress) - Storage.totalStars(a.progress),
      meId: this.profile?.id,
      empty: "No pilots yet — tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

// Run init on DOMContentLoaded, not inline at the bottom of <body>: rendering
// the first screen before layout settles resolves viewport-relative clamp()
// font sizes against the inherited value on that one render.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();
