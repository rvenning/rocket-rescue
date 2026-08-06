// Sound — gamekit's synth core plus Rocket Rescue's own jingles, and the same
// lookahead music scheduler the other family games use.
//
// One setInterval per note drifts and, in a hidden tab, gets throttled to ~1Hz
// and then machine-guns everything on return. Instead a ~110ms pump schedules
// every note up to LOOKAHEAD seconds ahead on the WebAudio clock.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  // A rescue: a little "boop-bip" that climbs with the streak, so a clean sweep
  // through a chamber audibly builds. This is the game's signature sound.
  rescue(streak = 1) {
    const step = Math.min(streak, 8) - 1;
    this.tone({ freq: 520 + step * 40, type: "sine", dur: 0.09, vol: 0.15, slide: 90 });
    this.tone({ freq: 780 + step * 60, type: "triangle", dur: 0.12, vol: 0.11, when: 0.06, slide: 140 });
  },
  glimmer() {
    [880, 1175, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.16, vol: 0.13, when: i * 0.05 }));
  },
  orb() {
    [523, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.1, vol: 0.12, when: i * 0.045 }));
  },
  // Scraping rock. Blunt and low — never a buzzer, but you know it happened.
  crunch() {
    this.noise({ dur: 0.24, vol: 0.26 });
    this.tone({ freq: 150, type: "sawtooth", dur: 0.26, vol: 0.2, slide: -70 });
  },
  shieldPop() {
    this.tone({ freq: 940, type: "sine", dur: 0.18, vol: 0.16, slide: -540 });
    this.noise({ dur: 0.12, vol: 0.1 });
  },
  slowOn() { this.tone({ freq: 700, type: "sine", dur: 0.5, vol: 0.13, slide: -420 }); },
  slowOff() { this.tone({ freq: 280, type: "sine", dur: 0.35, vol: 0.11, slide: 420 }); },
  magnetOn() {
    this.tone({ freq: 220, type: "sawtooth", dur: 0.3, vol: 0.1, slide: 240 });
    this.tone({ freq: 660, type: "sine", dur: 0.25, vol: 0.08, when: 0.08, slide: 160 });
  },
  mend() {
    [392, 523, 659].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.2, vol: 0.14, when: i * 0.08 }));
  },
  daylight() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.24, vol: 0.16, when: i * 0.11 }));
  },
  star(n = 1) { this.tone({ freq: 660 + n * 180, type: "square", dur: 0.22, vol: 0.16, slide: 120 }); },
  wreck() {
    [330, 262, 208, 165].forEach((f, i) =>
      this.tone({ freq: f, type: "sawtooth", dur: 0.36, vol: 0.2, when: i * 0.16 }));
    this.noise({ dur: 0.7, vol: 0.12, when: 0.3 });
  },
  newBest() {
    [659, 784, 988, 1319, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.2, vol: 0.16, when: i * 0.11 }));
  },
});

/* ------------------------------------------------------------------ music */
// Semitone offsets from the root; null = a rest. One step is an eighth note.
// Bass loops every 16 steps and lead every 32, so the pair drifts through
// combinations a 16-step score would never reach.
const TRACKS = {
  cruise: {
    root: 50, bpm: 118,
    bass: [0, null, 0, 7, 0, null, 5, null, 3, null, 3, 10, 5, null, 7, null],
    lead: [12, 15, 19, 24, 19, 15, 12, null, 14, 17, 21, 17, 14, null, 10, null,
           12, 15, 19, 22, 19, null, 17, null, 15, 12, 10, 12, 15, null, null, null],
  },
  deep: {
    root: 46, bpm: 138,
    bass: [0, 0, 7, 0, 5, null, 12, 5, 3, 3, 10, 3, 8, null, 7, 7],
    lead: [24, 22, 19, 22, 24, 27, 24, null, 22, 19, 17, 19, 22, 26, 22, null,
           21, 19, 17, 14, 17, 21, 24, 21, 19, 17, 12, 17, 19, null, null, null],
  },
};

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

const Music = {
  enabled: true,
  track: null,
  step: 0,
  nextT: 0,
  timer: null,
  LOOKAHEAD: 0.6,

  start(name) {
    const t = TRACKS[name];
    if (!t || !Sfx.ctx) return;
    if (this.track === t && this.timer) return;
    this.track = t;
    this.step = 0;
    this.nextT = Sfx.ctx.currentTime + 0.12;
    if (!this.timer) this.timer = setInterval(() => this.pump(), 110);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.track = null;
  },

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  },

  pump() {
    const t = this.track;
    if (!t || !this.enabled || !Sfx.enabled || !Sfx.ctx) return;
    const now = Sfx.ctx.currentTime;
    const spb = 60 / t.bpm / 2;
    // After a hitch (hidden tab, GC pause) skip the missed steps silently
    // rather than firing them all at once.
    if (this.nextT < now - 0.25) this.nextT = now + 0.05;
    while (this.nextT < now + this.LOOKAHEAD) {
      const when = this.nextT - now;
      const b = t.bass[this.step % t.bass.length];
      if (b !== null && b !== undefined)
        Sfx.tone({ freq: midiHz(t.root + b), type: "triangle", dur: spb * 0.9, vol: 0.07, when });
      const l = t.lead[this.step % t.lead.length];
      if (l !== null && l !== undefined)
        Sfx.tone({ freq: midiHz(t.root + l), type: "sine", dur: spb * 0.6, vol: 0.05, when });
      if (this.step % 4 === 0) Sfx.noise({ dur: 0.03, vol: 0.03, when });
      this.step++;
      this.nextT += spb;
    }
  },

  // Pausing pushes the clock forward instead of stopping it, so the pump never
  // wakes up thousands of steps in arrears.
  hold(seconds) { this.nextT += seconds; },
};
