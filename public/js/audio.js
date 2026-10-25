// audio.js - plays PICO-8 sfx/music data with WebAudio.
// sfx: {speed, notes:[[pitch, wave, vol, fx] x32]}; music: [{flags, channels:[id|null x4]}]
// waves: 0 tri 1 tilted saw 2 saw 3 square 4 pulse 5 organ 6 noise 7 phaser
// fx: 1 slide 2 vibrato 3 drop 4 fade in 5 fade out (6/7 arpeggio play as plain notes)

const NOTE_SEC = 183 / 22050;     // one "speed" unit
const VOL = 0.09;                 // per-channel loudness at volume 7

export class Synth {
  constructor(data) {
    this.data = data;
    this.ctx = null;
    this.pat = -1;
  }

  // browsers only allow audio after a user gesture: call on first key press
  wake() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.8;
      this.out.connect(this.ctx.destination);
      this.buildWaves();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  buildWaves() {
    const ctx = this.ctx;
    const fromFn = fn => {
      const N = 32, S = 1024, re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++)
        for (let s = 0; s < S; s++) {
          const v = fn(s / S), a = 2 * Math.PI * k * s / S;
          re[k] += v * Math.cos(a) * 2 / S; im[k] += v * Math.sin(a) * 2 / S;
        }
      return ctx.createPeriodicWave(re, im);
    };
    const tri = t => (t < 0.5 ? 4 * t - 1 : 3 - 4 * t);
    this.waves = [
      'triangle',
      fromFn(t => (t < 0.875 ? t / 0.875 * 2 - 1 : 1 - (t - 0.875) / 0.125 * 2)),
      'sawtooth', 'square',
      fromFn(t => (t < 0.25 ? 1 : -1)),
      fromFn(t => (tri(t) + tri(t * 2 % 1)) / 2),
      null,
      fromFn(t => (tri(t) + tri(t * 1.98 % 1)) / 2),
    ];
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : 0.8;
  }

  freq(p) { return 65.406 * Math.pow(2, p / 12); }

  // schedule sfx n at time t into node dest; returns its length in seconds
  play(n, t, dest) {
    const s = this.data.sfx[n];
    if (!s || !this.ctx) return 0;
    const ctx = this.ctx, dur = Math.max(1, s.speed) * NOTE_SEC;
    let prev = null;
    s.notes.forEach(([p, w, v, fx], i) => {
      const t0 = t + i * dur, t1 = t0 + dur;
      if (v === 0) { prev = null; return; }
      const f = this.freq(p);
      let src;
      if (w === 6) {
        src = ctx.createBufferSource();
        src.buffer = this.noiseBuf; src.loop = true;
        src.playbackRate.value = Math.min(4, Math.max(0.05, f / 520));
      } else {
        src = ctx.createOscillator();
        const wave = this.waves[w] || 'triangle';
        if (typeof wave === 'string') src.type = wave; else src.setPeriodicWave(wave);
        src.frequency.setValueAtTime(fx === 1 && prev ? prev : f, t0);
        if (fx === 1 && prev) src.frequency.linearRampToValueAtTime(f, t1);
        if (fx === 3) src.frequency.exponentialRampToValueAtTime(Math.max(20, f * 0.08), t1);
        if (fx === 2) {
          const lfo = ctx.createOscillator(), lg = ctx.createGain();
          lfo.frequency.value = 7; lg.gain.value = f * 0.025;
          lfo.connect(lg); lg.connect(src.frequency);
          lfo.start(t0); lfo.stop(t1 + 0.02);
        }
      }
      const g = ctx.createGain(), vol = v / 7 * VOL;
      g.gain.setValueAtTime(fx === 4 ? 0.0001 : 0, t0);
      if (fx === 4) g.gain.linearRampToValueAtTime(vol, t1);
      else g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
      if (fx === 5) g.gain.linearRampToValueAtTime(0, t1);
      else g.gain.setValueAtTime(vol, t1 - 0.004);
      g.gain.linearRampToValueAtTime(0, t1);
      src.connect(g); g.connect(dest);
      src.start(t0); src.stop(t1 + 0.01);
      prev = f;
    });
    let last = 31;
    while (last > 0 && s.notes[last][2] === 0) last--;
    return (last + 1) * dur;
  }

  sfx(n) {
    this.wake();
    if (this.ctx) this.play(n, this.ctx.currentTime + 0.005, this.out);
  }

  // music(n[,fadeMs]) starts pattern n; music(-1[,fadeMs]) stops
  music(n, fade = 0) {
    this.wake();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.mg) {
      const old = this.mg;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fade / 1000));
      setTimeout(() => old.disconnect(), fade + 2500);
    }
    clearInterval(this.timer);
    this.pat = -1; this.mg = null;
    if (n < 0 || !this.data.music[n]) return;
    this.mg = this.ctx.createGain();
    this.mg.connect(this.out);
    this.mg.gain.setValueAtTime(fade ? 0 : 1, now);
    if (fade) this.mg.gain.linearRampToValueAtTime(1, now + fade / 1000);
    this.pat = n; this.next = now + 0.05;
    const tick = () => {
      while (this.pat >= 0 && this.next < this.ctx.currentTime + 0.4) this.schedulePattern();
    };
    tick();
    this.timer = setInterval(tick, 100);
  }

  schedulePattern() {
    const m = this.data.music[this.pat];
    if (!m) { this.pat = -1; return; }
    let len = 0;
    // a pattern lasts as long as its sfx (32 notes, or `len` - e.g. 24 for 3/4 time)
    m.channels.forEach(id => {
      if (id === null) return;
      const s = this.data.sfx[id];
      this.play(id, this.next, this.mg);
      len = Math.max(len, s.speed * (s.len || 32) * NOTE_SEC);
    });
    this.next += len || 1;
    if (m.flags & 2) {          // loop end: back to the nearest loop start
      let p = this.pat;
      while (p > 0 && !(this.data.music[p].flags & 1)) p--;
      this.pat = p;
    } else if (m.flags & 4) this.pat = -1;
    else this.pat++;
  }
}
