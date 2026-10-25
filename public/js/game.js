// game.js - Food Run, ported from the PICO-8 cart (donutdash.p8).
// Levels, sprites and sounds come from the server, so anything made in the
// editor is playable here. Runs at 30 updates/second like PICO-8's _update.
import { Pico, rnd, flr, mid, sgn, sin, cos, atan2 } from './pico.js';
import { Synth } from './audio.js';

const P = new Pico(document.getElementById('screen'));
let SND = { sfx() {}, music() {}, wake() {}, setMuted() {} };
const sfx = n => SND.sfx(n);
const music = (n, f) => SND.music(n, f);
const palWhite = () => P.pal(Array(15).fill(7));
const SH_MAX = 60, SH_HOLD = 8;   // shield energy (2s of use), frames of holding down to raise it

// ------------------------------------------------------------ input
// btn 0 left 1 right 2 up 3 down 4 jump (z/c/n/space) 5 laser (x/v/m)
const KEYS = { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, ArrowUp: 2, KeyW: 2,
  ArrowDown: 3, KeyS: 3, KeyZ: 4, KeyC: 4, KeyN: 4, Space: 4, KeyX: 5, KeyV: 5, KeyM: 5 };
const held = Array(6).fill(false), was = Array(6).fill(false), tap = Array(6).fill(false);
addEventListener('keydown', e => {
  const b = KEYS[e.code];
  SND.wake();
  if (b === undefined) return;
  e.preventDefault();
  if (!held[b]) tap[b] = true;
  held[b] = true;
});
addEventListener('keyup', e => { const b = KEYS[e.code]; if (b !== undefined) held[b] = false; });
const btn = b => held[b] || tap[b];
const btnp = b => tap[b] || (held[b] && !was[b]);

// ------------------------------------------------------------ state
let state = 'title', t = 0, camx = 0, camy = 0, wait = 0, shk = 0, hs = 0;
let lv0 = 0, lv = 0, lives = 3, score = 0, wint = null, arena = false;
// title menu (0 start, 1 options) and options screen (0 stage, 1 sound, 2 back)
let menu = 0, osel = 0, sound = loadOpts().sound !== false;

function loadOpts() {
  try { return JSON.parse(localStorage.getItem('foodrun-options')) || {}; } catch (e) { return {}; }
}
function saveOpts() {
  try { localStorage.setItem('foodrun-options', JSON.stringify({ sound })); } catch (e) { /* private mode */ }
}

function updOptions() {
  if (btnp(2)) { osel = (osel + 2) % 3; sfx(6); }
  if (btnp(3)) { osel = (osel + 1) % 3; sfx(6); }
  const dir = btnp(1) ? 1 : btnp(0) ? -1 : 0;
  if (osel === 0 && dir) lv0 = mid(0, lv0 + dir, LEVELS.length - 1);
  if (osel === 1 && (dir || btnp(4))) { sound = !sound; SND.setMuted(!sound); saveOpts(); sfx(3); }
  if (osel === 2 && (btnp(4) || btnp(5))) { state = 'title'; menu = 0; }
}
let L, MAP, ents = [], parts = [], pops = [], bolts = [], ebul = [], boss = null, puds = [];
let p, cpx, cpy, hpfl = 0, hpup = 0;
let LEVELS = [];
const stars = [], petals = [];
for (let i = 0; i < 70; i++)
  stars.push({ x: rnd(128), y: rnd(110), c: rnd([1, 1, 5, 13, 6]), z: rnd(0.4) + 0.1, tw: rnd(1) });
for (let i = 0; i < 60; i++)
  petals.push({ x: rnd(128), y: rnd(128), s: rnd(1), ph: rnd(1), c: rnd([14, 14, 15, 7]) });

// enemy stats: explosion colours and score
const ecol = { 2: [15, 4, 11, 8], 3: [10, 9, 8], 4: [7, 8, 6], 35: [3, 7, 9, 14], 36: [9, 7, 3], 37: [8, 7, 3],
  40: [4, 2, 8, 9], 42: [10, 9, 8, 4], 48: [9, 4, 15, 10], 50: [14, 7, 11, 12] };
const epts = { 2: 150, 3: 100, 4: 200, 35: 150, 36: 100, 37: 120, 40: 150, 42: 200, 48: 150, 50: 120 };
// chance that a defeated enemy leaves a heart
const DROP = { 3: 1, 40: 0.3, 48: 0.3, 50: 0.2 };
// what each theme shows between stages: enemies + boss sprite
const PREVIEW = { city: [[2, 3, 4], 6], sakura: [[35, 36, 37], 38], italy: [[40, 42, 3], 44],
  paris: [[48, 50, 48], 46] };

// ------------------------------------------------------------ map
const mget = (x, y) => (x < 0 || y < 0 || x >= L.w || y >= L.h) ? 0 : MAP[y * L.w + x];
const mset = (x, y, v) => { if (x >= 0 && y >= 0 && x < L.w && y < L.h) MAP[y * L.w + x] = v; };
const fget = (s, f) => P.fget(s, f);
const solid = (x, y) => fget(mget(flr(x / 8), flr(y / 8)), 0);

function start() {
  lives = 3; score = 0; lv = lv0;
  music(-1);
  state = 'play';
  loadLevel();
}

function finish(s) {
  state = s; wait = 45;
  music(-1, 300);
  if (s !== 'over') sfx(4);
}

function loadLevel() {
  const d = LEVELS[lv];
  const br = d.bossRoom;
  L = {
    w: d.width, h: d.height, top: 0, bot: d.height * 8, ax: br.col * 8,
    acx: br.respawn[0] * 8, acy: br.respawn[1] * 8, sx: d.start[0] * 8, sy: d.start[1] * 8,
    bhp: br.hp, name: br.name, theme: d.theme, jp: d.theme === 'sakura', it: d.theme === 'italy',
    vert: br.scrollDown, title: d.name, bs: 6,
  };
  MAP = new Uint8Array(L.w * L.h);
  d.tiles.forEach((row, y) => { for (let x = 0; x < L.w; x++) MAP[y * L.w + x] = parseInt(row.substr(x * 2, 2), 16); });
  ents = []; parts = []; pops = []; boss = null; puds = []; arena = false; wint = null;
  cpx = L.sx; cpy = L.sy;
  for (let my = 0; my < L.h; my++) for (let mx = 0; mx < L.w; mx++) {
    const s = mget(mx, my), x = mx * 8, y = my * 8;
    if (s === 1) { cpx = x; cpy = y; }
    else if (s === 2) mk(x, y, 2, 2);
    else if (s === 3) mk(x, y, 3, 1);
    else if (s === 4 || s === 20) mk(x, y, 4, 3);
    else if (s === 35) mk(x, y, 35, 2);
    else if (s === 40) mk(x, y, 40, 2);          // meatball
    else if (s === 42) { const e = mk(x, y, 42, 2); e.oy = 0; e.h = 7; }  // pizza slice
    else if (s === 48) { const e = mk(x, y, 48, 1); e.fly = true; e.hx = x; e.hy = y; }  // croissant (flies)
    else if (s === 50) { const e = mk(x, y, 50, 2); e.oy = 1; e.h = 6; e.flav = rnd([14, 11, 12, 4]); } // macaron
    else if (s === 46) {
      // cake boss: drawn 24x24, three tiers; loses the top tier at half health
      L.bs = 46;
      boss = { cake: true, x, y: y - 8, s: 24, dx: 0, dy: 0, g: false, ox: 2, oy: 3, w: 19, h: 20, top: 0,
        hp: L.bhp, mhp: L.bhp, st: 'wait', t: 0, fl: 0, atk: 50, j: 0, jv: 0, tier: 3 };
    }
    else if (s === 44) {
      // gelato boss: drawn 24x24, walks, frost beam, throws scoops
      L.bs = 44;
      boss = { gel: true, x, y: y - 8, s: 24, dx: 0, dy: 0, g: false, ox: 2, oy: 3, w: 19, h: 20,
        hp: L.bhp, mhp: L.bhp, st: 'wait', t: 0, fl: 0, atk: 50, j: 0, jv: 0, frost: null, f: true };
    }
    else if (s === 36 || s === 37) { const e = mk(x, y, s, 1); e.oy = 3; e.h = 4; }
    else if (s === 8) ents.push({ k: 8, x, y, on: false });
    else if (s === 6) {
      L.bs = 6;
      boss = { x, y, hy: y, hp: L.bhp, mhp: L.bhp, st: 'wait', t: 0, fl: 0, atk: 60, sx: 1, sy: 1, dy: 0 };
    } else if (s === 38) {
      L.bs = 38;
      boss = { pud: true, st: 'wait', t: 0, hp: 0, mhp: 0 };
      puds = [newpud(x, y, 0)];
      boss.mhp = boss.hp = puds[0].hp * 3;
    }
    if (!fget(s, 0)) mset(mx, my, 0);
  }
  spawn(0);
  camx = 0; camy = L.top;
  const tune = { sakura: 2, italy: 4, paris: 6 }[L.theme];
  if (tune !== undefined) music(tune, 1000);
}

function mk(x, y, k, hp) {
  const e = { k, x, y, dx: 0, dy: 0, ox: 1, oy: 1, w: 5, h: 6, hp, fl: 0, t: flr(rnd(60)),
    dir: -1, f: true, g: false, sq: 0 };
  ents.push(e);
  return e;
}

function spawn(inv) {
  p = { x: cpx, y: cpy, dx: 0, dy: 0, f: false, ox: 2, oy: 2, w: 3, h: 5, g: false, dead: 0, inv,
    co: 0, jb: 0, cd: 0, st: 0, sq: 0, hp: 6, ch: 0, xh: true,
    // shield: sh = energy (0-SH_MAX), dn = frames down is held, brk = broken until recharged
    sh: SH_MAX, dn: 0, shOn: false, brk: false, bk: 0 };
  hpfl = 0; hpup = 0; ebul = []; bolts = [];
}

// ------------------------------------------------------------ collision
function hit(x, y, w, h) {
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++)
    if (solid(x + w * i / 2, y + h * j / 2)) return true;
  return false;
}

const touch = (x, y, w, h) => p.x + 5 > x && p.x + 2 < x + w && p.y + 7 > y && p.y + 2 < y + h;

function phys(o) {
  let nx = o.x + o.dx;
  if (hit(nx + o.ox, o.y + o.oy, o.w, o.h)) {
    nx = o.dx > 0 ? flr((nx + o.ox + o.w) / 8) * 8 - o.ox - o.w - 1 : flr((nx + o.ox) / 8) * 8 + 8 - o.ox;
    o.dx = 0;
  }
  o.x = nx;
  let ny = o.y + o.dy;
  const wasg = o.g;
  o.g = false;
  if (hit(o.x + o.ox, ny + o.oy, o.w, o.h)) {
    if (o.dy > 0) { ny = flr((ny + o.oy + o.h) / 8) * 8 - o.oy - o.h - 1; o.g = true; }
    else ny = flr((ny + o.oy) / 8) * 8 + 8 - o.oy;
    o.dy = 0;
  }
  o.y = ny;
  // standing: probe 1px below the feet
  if (!o.g && o.dy >= 0 && hit(o.x + o.ox, o.y + o.oy + 1, o.w, o.h)) {
    o.g = true; o.dy = 0;
    o.y = flr((o.y + o.oy + o.h + 1) / 8) * 8 - o.oy - o.h - 1;
  }
  o.land = o.g && !wasg;
}

// ------------------------------------------------------------ effects
const pt = (x, y, dx, dy, c, t, mt, r = 0, g = 0, ring = false) =>
  parts.push({ x, y, dx, dy, c, t, mt, r, g, ring });
const eb = (x, y, dx, dy, c, r, g, o) => { const b = { x, y, dx, dy, c, r, g }; if (o) b[o] = true; ebul.push(b); };
const pop = (x, y, s, c = 7) => pops.push({ x, y, s, t: 30, c });

function spark(x, y, cs, n) {
  for (let i = 0; i < n; i++) pt(x, y, rnd(3) - 1.5, rnd(3) - 2, rnd(cs), 6 + rnd(8), 14, 0, 0.15);
}
function dust(x, y, n) {
  for (let i = 0; i < n; i++) pt(x + rnd(4) - 2, y - 1, rnd(1) - 0.5, -rnd(0.4), rnd([5, 6, 13]), 10 + rnd(8), 18, 1 + rnd(1), -0.01);
}
function boom(x, y, cs, n = 14) {
  pt(x, y, 0, 0, 7, 4, 4, 7);
  pt(x, y, 0, 0, cs[0], 10, 10, 10, 0, true);
  for (let i = 0; i < n; i++) {
    const a = rnd(1), s = rnd(2) + 0.5;
    pt(x, y, cos(a) * s, sin(a) * s - 0.5, rnd(cs), 15 + rnd(15), 30, rnd(2), 0.08);
  }
}

// ------------------------------------------------------------ update
function update() {
  t++;
  shk *= 0.85;
  for (const q of petals) {
    q.x += sin(t / 70 + q.ph) * 0.35 - 0.3 - q.s * 0.4;
    q.y += 0.25 + q.s * 0.35;
    if (q.y > 130) { q.y = -3; q.x = rnd(160); }
    if (q.x < -3) q.x += 134;
  }
  if (state === 'title') {
    if (!LEVELS.length) return;
    if (btnp(2) || btnp(3)) { menu = 1 - menu; sfx(6); }
    if (btnp(4) || btnp(5)) {
      if (menu === 0) start();
      else { state = 'options'; osel = 0; sfx(3); }
    }
    return;
  }
  if (state === 'options') { updOptions(); return; }
  if (hs > 0) { hs--; return; }
  if (hpfl > 0) hpfl--;
  if (hpup > 0) hpup--;
  updParts();
  if (state === 'inter') {
    if (--wait < 0 && (btnp(4) || btnp(5))) { lv++; state = 'play'; loadLevel(); }
    return;
  }
  if (state !== 'play') {
    if (--wait < 0 && (btnp(4) || btnp(5))) state = 'title';
    return;
  }
  updPlayer(); updBolts(); updEnts(); updBoss(); updEbul();
  if (wint !== null && --wint <= 0) { wint = null; finish(lv < LEVELS.length - 1 ? 'inter' : 'win'); }
  const tx = arena ? L.ax : mid(0, p.x - 60, Math.max(0, L.ax));
  camx += (tx - camx) * 0.2;
  let ty = L.top;
  if (arena && L.vert) ty = mid(L.top, p.y - 64, L.bot - 128);
  camy += (ty - camy) * 0.2;
}

function kill() {
  if (p.dead > 0) return;
  p.dead = 45; lives--; p.hp = 0;
  sfx(5); shk = 6; hs = 4;
  boom(p.x + 4, Math.min(p.y + 5, camy + 124), [11, 12, 7], 20);
}

// lose one health segment (the shield blocks it)
function dmg(sx) {
  if (p.dead > 0 || p.inv > 0) return;
  if (p.shOn) {
    p.dx = sgn(p.x - sx) * 1.2;
    if (p.bk <= 0) {                              // at most one block every 8 frames
      p.sh = Math.max(0, p.sh - 6);               // each block costs a little energy
      sfx(33); p.bk = 8;
      pt(p.x + 4, p.y + 5, 0, 0, 7, 6, 6, 9, 0, true);
      spark(p.x + 4 - sgn(p.x - sx) * 6, p.y + 5, [12, 7], 5);
    }
    return;
  }
  p.hp--;
  if (p.hp <= 0) { kill(); return; }
  p.inv = 40; hpfl = 8; sfx(5); shk = 4; hs = 2;
  p.dx = sgn(p.x - sx) * 2; p.dy = -2;
  spark(p.x + 4, p.y + 4, [8, 7], 6);
}

function updPlayer() {
  if (p.dead > 0) {
    if (--p.dead === 0) { if (lives <= 0) finish('over'); else spawn(60); }
    return;
  }
  if (p.inv > 0) p.inv--;
  if (p.bk > 0) p.bk--;
  const ctl = !(boss && boss.st === 'intro');

  // shield: hold down ~0.25s; drains while up, recharges when down is released
  p.dn = ctl && btn(3) ? p.dn + 1 : 0;
  const wantSh = p.dn >= SH_HOLD && !p.brk && p.sh > 0;
  if (wantSh && !p.shOn) sfx(32);
  p.shOn = wantSh;
  if (p.shOn) {
    p.sh--;
    if (p.sh <= 0) { p.brk = true; p.shOn = false; sfx(5); spark(p.x + 4, p.y + 5, [12, 7], 10); }
  } else if (p.dn === 0) {
    p.sh = Math.min(SH_MAX, p.sh + 0.5);
    if (p.brk && p.sh >= SH_MAX / 2) p.brk = false;
  }

  let acc = 0;
  if (ctl && btn(0)) { acc = -0.3; p.f = true; }
  if (ctl && btn(1)) { acc = 0.3; p.f = false; }
  p.dx += acc;
  if (acc === 0) p.dx *= 0.7;
  const top = p.shOn ? 0.6 : 1.5;                  // shielded = slow
  p.dx = mid(-top, p.dx, top);

  // jump: coyote time + buffer
  const jh = ctl && (btn(4) || btn(2));
  if (p.g) p.co = 5; else p.co--;
  if (ctl && (btnp(4) || btnp(2))) p.jb = 5; else p.jb--;
  if (p.jb > 0 && p.co > 0) {
    p.dy = -3.5; p.jb = 0; p.co = 0; p.sq = -4;
    sfx(0); dust(p.x + 4, p.y + 8, 4);
  }
  if (p.dy < 0 && !jh) p.dy += 0.4;
  p.dy = Math.min(p.dy + 0.25, 4);

  // laser: tap = shot, hold = charge, release = beam
  if (p.cd > 0) p.cd--;
  if (p.st > 0) p.st--;
  const xb = ctl && btn(5) && !p.shOn;            // no shooting behind the shield
  if (xb) {
    if (!p.xh && p.cd === 0) fire(false);
    p.ch++;
    if (p.ch === 30) sfx(24);
    if (p.ch > 8) {
      const gx = p.f ? p.x + 1 : p.x + 6, a = rnd(1);
      pt(gx + cos(a) * 9, p.y + 5 + sin(a) * 9, -cos(a) * 1.1, -sin(a) * 1.1,
        p.ch >= 30 ? rnd([7, 11]) : 3, 7, 7);
    }
  } else {
    if (p.xh && p.ch >= 30) fire(true);
    p.ch = 0;
  }
  p.xh = xb;

  phys(p);
  p.x = Math.max(p.x, arena ? L.ax + 1 : -2);
  if (p.land) { p.sq = 4; dust(p.x + 4, p.y + 8, 5); }
  p.sq = mid(p.sq - 1, 0, p.sq + 1);
  if (p.y > (p.x >= L.ax ? L.bot + 8 : L.top + 130)) kill();
}

function fire(big) {
  const d = p.f ? -1 : 1, gx = p.f ? p.x + 1 : p.x + 6;
  p.cd = 7; p.st = 6;
  p.dx -= d * (big ? 1.5 : 0.4);
  bolts.push({ x: gx + d * 2, y: p.y + 5, d, l: 0, big, hits: new Set() });
  pt(gx + d, p.y + 5, 0, 0, 7, 3, 3, big ? 5 : 2);
  pt(gx + d, p.y + 5, 0, 0, 11, 5, 5, big ? 10 : 4, 0, true);
  if (big) { p.st = 8; shk = Math.max(shk, 3); sfx(25); } else sfx(1);
}

// break a cracked block (and cracked blocks stacked above it)
function crumble(tx, ty) {
  mset(tx, ty, 0);
  const x = tx * 8 + 4, y = ty * 8 + 4;
  for (let i = 0; i < 10; i++)
    pt(x + rnd(6) - 3, y + rnd(6) - 3, rnd(3) - 1.5, -rnd(2.5), rnd([5, 6, 13]), 20 + rnd(15), 35, rnd(1.5), 0.15);
  dust(x, y + 4, 3);
  score += 10; shk = Math.max(shk, 2); sfx(23);
  if (fget(mget(tx, ty - 1), 1)) crumble(tx, ty - 1);
}

function updBolts() {
  for (const b of [...bolts]) {
    const sp = b.big ? 4 : 5;
    b.x += b.d * sp; b.l += sp;
    let dead = b.l > (b.big ? 140 : 110);
    const hy = b.big ? 2 : 0;
    if (b.big) {
      for (let yy = b.y - 2; yy <= b.y + 2; yy += 2) {
        const tx = flr(b.x / 8), ty = flr(yy / 8), s = mget(tx, ty);
        if (fget(s, 1)) crumble(tx, ty); else if (fget(s, 0)) dead = true;
      }
      if (dead) spark(b.x, b.y, [11, 7, 3], 10);
      pt(b.x - b.d * 4, b.y + rnd(4) - 2, 0, rnd(0.4) - 0.2, 11, 5, 5);
    } else if (solid(b.x, b.y)) {
      dead = true; spark(b.x - b.d * 2, b.y, [11, 7, 3], 5);
    }
    for (const e of [...ents]) {
      if (!dead && e.hp !== undefined && !b.hits.has(e) && b.x >= e.x && b.x < e.x + 8
        && b.y + hy >= e.y && b.y - hy < e.y + 8) {
        if (b.big) { b.hits.add(e); hurt(e, 3, b.d); } else { dead = true; hurt(e, 1, b.d); }
      }
    }
    const o = boss;
    if (o && !dead && o.pud) {
      if (o.st === 'fight') for (const q of [...puds]) {
        if (!dead && b.x >= q.x && b.x < q.x + q.s && b.y + hy >= q.y && b.y - hy < q.y + q.s) {
          dead = true; hitpud(q, b.big ? 4 : 1, b);
        }
      }
    } else if (o && !dead && o.st !== 'wait' && o.st !== 'die' && o.st !== 'intro'
      && b.x >= o.x + 1 && b.x < o.x + (o.s || 16) - 1
      && b.y + hy >= o.y + 1 + (o.top || 0) && b.y - hy < o.y + (o.s || 16) - 1) {
      dead = true; hitboss(b, b.big ? 4 : 1);
    }
    if (dead) bolts.splice(bolts.indexOf(b), 1);
  }
}

function hurt(e, n, d) {
  e.hp -= n; e.fl = 4;
  if (d !== 0 && !solid(e.x + 4 + d * 6, e.y + 4)) e.x += d * 2;
  spark(e.x + 4, e.y + 4, [7, 11, 10], 6);
  if (e.hp > 0) { sfx(6); return; }
  boom(e.x + 4, e.y + 4, ecol[e.k]);
  score += epts[e.k]; pop(e.x, e.y - 2, '+' + epts[e.k], 10);
  ents.splice(ents.indexOf(e), 1);
  // fries always drop a heart, some others sometimes (see DROP)
  if (rnd(1) < (DROP[e.k] || 0)) ents.push({ k: 9, x: e.x, y: e.y, dx: 0, dy: -2.5, ox: 1, oy: 2, w: 5, h: 5, g: false, life: 240 });
  shk = Math.max(shk, 3); hs = 2; sfx(2);
}

function updEnts() {
  for (const e of [...ents]) {
    if (e.k === 8) {
      if (!e.on && touch(e.x, e.y, 8, 8)) {
        e.on = true; cpx = e.x; cpy = e.y; sfx(3);
        if (p.hp < 6) { p.hp = 6; hpup = 10; }        // checkpoints heal you to full
        spark(e.x + 3, e.y + 2, [11, 3, 7], 12);
        pop(e.x - 14, e.y - 8, 'checkpoint!', 11);
      }
    } else if (e.k === 9) {
      e.dy = Math.min(e.dy + 0.2, 3);
      phys(e);
      if (--e.life <= 0 || e.y > L.bot + 8) ents.splice(ents.indexOf(e), 1);
      else if (p.dead === 0 && touch(e.x, e.y, 8, 8)) {
        if (p.hp < 6) { p.hp++; hpup = 10; pop(e.x - 2, e.y - 6, '+1', 11); }
        else { score += 100; pop(e.x - 6, e.y - 6, '+100', 10); }
        sfx(17); spark(e.x + 4, e.y + 4, [8, 14, 7], 10);
        ents.splice(ents.indexOf(e), 1);
      }
    } else if (Math.abs(e.x - camx - 64) < 110 && Math.abs(e.y - camy - 64) < 110) updEnemy(e);
  }
}

// croissant: drifts around its home spot, swoops at you when you pass below
function updFlyer(e) {
  e.cool = (e.cool || 0) - 1;
  if (e.st === 'dive') {
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    if (d < 3 || --e.tm <= 0 || solid(e.x + 4, e.y + 4)) e.st = 'up';
    else { e.x += dx / d * 1.8; e.y += dy / d * 1.8; }
  } else if (e.st === 'up') {
    const dx = e.hx - e.x, dy = e.hy - e.y, d = Math.hypot(dx, dy);
    if (d < 2) { e.st = null; e.cool = 70; } else { e.x += dx / d; e.y += dy / d; }
  } else {
    e.x += (e.hx + sin(e.t / 90) * 20 - e.x) * 0.1;
    e.y += (e.hy + sin(e.t / 30) * 3 - e.y) * 0.1;
    if (e.cool <= 0 && p.dead === 0 && Math.abs(p.x - e.x) < 48 && p.y > e.y + 8 && p.y - e.y < 72) {
      e.st = 'dive'; e.tx = p.x; e.ty = p.y; e.tm = 60; sfx(10); pop(e.x + 2, e.y - 8, '!', 9);
    }
  }
  e.f = p.x < e.x;
  if (p.dead === 0 && touch(e.x + 1, e.y + 1, 6, 6)) {
    if (p.dy > 0 && p.y < e.y - 1) { p.dy = -3; p.sq = -3; e.hp = 0; hurt(e, 0, 0); }
    else if (p.inv === 0) dmg(e.x);
  }
}

function updEnemy(e) {
  e.t++;
  if (e.fl > 0) e.fl--;
  if (e.fly) { updFlyer(e); return; }
  const hop = e.k === 2 || e.k === 36 || e.k === 50;
  const ahead = () => { const ax = e.dir > 0 ? e.x + 8 : e.x - 1; return solid(ax, e.y + 4) || !solid(ax, e.y + 9); };
  const near = r => p.dead === 0 && Math.abs(p.y - e.y) < 12 && Math.abs(p.x - e.x) < r;
  if (e.k === 40) {
    // meatball: rolls after you on its level (stops at edges), bounces now and then
    let spd = 0.5;
    if (near(72)) { e.dir = sgn(p.x - e.x); spd = 1; }
    if (ahead()) { if (spd === 1) spd = 0; else e.dir = -e.dir; }
    e.dx = e.dir * spd; e.f = e.dir < 0;
    if (e.g && e.t % 50 === 0) { e.dy = -2; e.sq = -3; }
  } else if (e.k === 42) {
    // pizza slice: spots you -> shakes -> stabs tip-first
    e.cool = (e.cool || 0) - 1;
    if (e.st === 'stab') {
      e.dx = e.dir * 2.6;
      if (--e.tm <= 0 || ahead()) { e.st = null; e.cool = 40; e.dx = 0; }
    } else if (e.st === 'aim') {
      e.dx = 0;
      if (--e.tm <= 0) { e.st = 'stab'; e.tm = 24; sfx(10); dust(e.x + 4, e.y + 8, 3); }
    } else {
      if (ahead()) e.dir = -e.dir;
      e.dx = e.dir * 0.3;
      if (e.cool <= 0 && near(52)) {
        e.st = 'aim'; e.tm = 14; e.dir = sgn(p.x - e.x); pop(e.x + 3, e.y - 8, '!', 8);
      }
    }
    e.f = e.dir < 0;
  } else if (hop) {
    // burger / salmon nigiri / macaron: hop at you
    const [wt, hx, hy] = { 2: [40, 0.7, -2.6], 36: [22, 1, -2], 50: [30, 0.9, -3] }[e.k];
    if (e.g) {
      e.dx = 0;
      if (e.t > wt) {
        let d = sgn(p.x - e.x);
        if (!solid(e.x + 4 + d * 14, e.y + 12)) d = -d;
        e.dx = d * hx;
        e.dy = hy;
        e.t = 0; e.sq = -4; e.f = d < 0;
        dust(e.x + 4, e.y + 8, 2);
      } else if (e.t > wt - 12) e.sq = 2;
    }
  } else {
    // patrol the ledge (chef charges when it sees you)
    let spd = { 3: 0.35, 35: 1.1, 37: 0.5 }[e.k] || 0.35;
    if (e.k === 4) {
      spd = 0.5;
      if (e.ch) spd = 1.7;
      else if (p.dead === 0 && Math.abs(p.y - e.y) < 8 && Math.abs(p.x - e.x) < 56 && sgn(p.x - e.x) === e.dir) {
        e.ch = true; sfx(10); pop(e.x + 3, e.y - 8, '!', 8);
      }
    }
    const ax = e.dir > 0 ? e.x + 8 : e.x - 1;
    if (solid(ax, e.y + 4) || !solid(ax, e.y + 9)) { e.dir = -e.dir; e.ch = false; }
    e.dx = e.dir * spd; e.f = e.dir < 0;
    // fries throw fries, tuna throws wasabi
    const rate = e.k === 3 ? 80 : 70;
    if ((e.k === 3 || e.k === 37) && e.t % rate === 0 && Math.abs(p.x - e.x) < 72 && p.dead === 0) {
      eb(e.x + 4, e.y + 3, sgn(p.x - e.x) * 1.2, -2.2, e.k === 3 ? 10 : 11, undefined, 0.15, e.k === 3 ? 'fry' : null);
      sfx(10); e.sq = 3;
    }
  }
  e.dy = Math.min(e.dy + 0.25, 4);
  phys(e);
  if (e.land && hop) { e.sq = 4; dust(e.x + 4, e.y + 8, 3); }
  e.sq = mid(e.sq - 1, 0, e.sq + 1);
  if (e.y > L.bot + 8) { ents.splice(ents.indexOf(e), 1); return; }
  if (p.dead === 0 && touch(e.x + 1, e.y + e.oy + 1, 6, e.h)) {
    // stomp kills - except the spiky pizza
    if (e.k !== 42 && p.dy > 0 && p.y < e.y + e.oy - 1) { p.dy = -3; p.sq = -3; e.hp = 0; hurt(e, 0, 0); }
    else if (p.inv === 0) dmg(e.x);
  }
}

function updEbul() {
  for (const b of [...ebul]) {
    b.x += b.dx; b.y += b.dy;
    if (b.g) b.dy += b.g;
    // cake slices bounce once off the floor
    if (b.bounce && b.dy > 0 && solid(b.x, b.y + 2)) { b.y -= b.dy; b.dy *= -0.6; b.bounce = false; }
    let dead = b.x < camx - 8 || b.x > camx + 136 || b.y > camy + 136 || b.y < camy - 8
      || solid(b.x, b.y) || (b.wave && !solid(b.x, b.y + 4));
    if (!dead && p.dead === 0 && p.inv === 0 && b.x > p.x + 1 && b.x < p.x + 7 && b.y > p.y + 1 && b.y < p.y + 8) {
      dmg(b.x - b.dx); dead = true;
    }
    if (dead) { spark(b.x, b.y, [b.c, 7], 3); ebul.splice(ebul.indexOf(b), 1); }
  }
}

// ------------------------------------------------------------ bosses
const bx0 = () => L.ax + 10, bx1 = () => L.ax + 102;
const bossx = () => mid(bx0(), p.x - 4, bx1());
function backfloat() { boss.st = 'float'; boss.t = 0; boss.atk = boss.hp < boss.mhp / 2 ? 35 : 60; }

function updBoss() {
  const b = boss;
  if (!b) return;
  // hero walks in: lock the room, boss music
  if (b.st === 'wait' && p.x >= L.ax + 16 && p.dead === 0) {
    arena = true; b.st = 'intro'; b.t = 0;
    cpx = L.acx; cpy = L.acy;
    sfx(9); shk = 6; music(0, 500);
  }
  // every boss drops one heart when it reaches half health
  if (!b.halfDrop && b.mhp && b.hp > 0 && b.hp < b.mhp / 2 && b.st !== 'die') {
    b.halfDrop = true;
    const src = b.pud ? puds[0] : b;
    if (src) ents.push({ k: 9, x: src.x + (src.s || 16) / 2 - 4, y: src.y, dx: 0, dy: -3,
      ox: 1, oy: 2, w: 5, h: 5, g: false, life: 360 });
  }
  if (b.pud) { updPud(b); return; }
  if (b.gel) { updGelato(b); return; }
  if (b.cake) { updCake(b); return; }
  b.t++;
  if (b.fl > 0) b.fl--;
  b.sx += (1 - b.sx) * 0.2; b.sy += (1 - b.sy) * 0.2;
  const mad = b.hp < b.mhp / 2;
  if (b.st === 'wait') b.y = b.hy + sin(t / 50) * 3;
  else if (b.st === 'intro') {
    b.y = b.hy + sin(t / 50) * 3;
    if (b.t % 12 === 0) { shk = 4; b.sx = 1.2; b.sy = 0.85; }
    if (b.t > 75) backfloat();
  } else if (b.st === 'float') {
    // hover on the far side at the hero's height; fly up to switch
    const l = bx0(), r = bx1(), tx = p.x < (l + r) / 2 ? r : l;
    const ty = Math.abs(tx - b.x) > 12 ? p.y - 56 : p.y - 6;
    b.x += (tx - b.x) * 0.05;
    b.y += (mid(L.top + 8, ty + sin(t / 60) * 8, L.bot - 32) - b.y) * 0.08;
    if (--b.atk <= 0) { b.st = rnd(mad ? ['spray', 'slam', 'aim', 'slam'] : ['spray', 'slam', 'aim']); b.t = 0; }
  } else if (b.st === 'spray') {
    if (b.t === 15 || b.t === 35 || (mad && b.t === 55)) {
      for (let i = 0; i < 10; i++) {
        const a = i / 10 + b.t / 100;
        eb(b.x + 8, b.y + 8, cos(a) * 1.3, sin(a) * 1.3, rnd([8, 12, 10, 11, 7]));
      }
      sfx(10); b.sx = 1.3; b.sy = 0.8;
    }
    if (b.t > 70) backfloat();
  } else if (b.st === 'aim') {
    if (b.t % 12 === 0 && b.t <= (mad ? 48 : 36)) {
      const a = atan2(p.x + 4 - b.x - 8, p.y + 5 - b.y - 8);
      eb(b.x + 8, b.y + 8, cos(a) * 2, sin(a) * 2, 12, 2);
      sfx(10); b.sx = 0.8; b.sy = 1.2;
    }
    if (b.t > 60) backfloat();
  } else if (b.st === 'slam') {
    if (b.t < 25) {
      // telegraph: rise + shake
      b.x += (bossx() - b.x) * 0.1;
      b.y += (Math.max(L.top + 8, p.y - 48) - b.y) * 0.15;
    } else {
      b.dy += 0.6; b.y += b.dy;
      const fy = b.y + 16;
      if (solid(b.x + 4, fy) || solid(b.x + 12, fy) || fy >= L.bot - 8) {
        b.y = flr(fy / 8) * 8 - 16; b.dy = 0; shk = 9;
        b.sx = 1.5; b.sy = 0.6; sfx(11);
        for (const d of [-1, 1]) eb(b.x + 8 + d * 6, b.y + 14, d * 2, 0, 14, 2, undefined, 'wave');
        dust(b.x + 8, b.y + 16, 12);
        b.st = 'recover'; b.t = 0;
      }
    }
  } else if (b.st === 'recover') {
    if (b.t > 30) { b.y -= 2; if (b.t > 45) backfloat(); }
  } else if (b.st === 'die') {
    if (b.t % 4 === 0) { boom(b.x + rnd(16), b.y + rnd(16), [14, 15, 12, 10, 7], 6); shk = 4; sfx(8); }
    if (b.t > 80) {
      boom(b.x + 8, b.y + 8, [14, 15, 12, 10, 7, 11], 60);
      shk = 14; hs = 6; sfx(8); score += 5000;
      pop(b.x - 2, b.y, '+5000', 10);
      boss = null; wint = 50;
    }
    return;
  }
  if (b.st !== 'wait' && p.dead === 0 && p.inv === 0 && touch(b.x + 2, b.y + 2, 12, 12)) dmg(b.x + 8);
}

// gelato: a giant cone that walks the floor (no flying), breathes a frost
// beam at your height, lobs ice-cream scoops, hops across the room and
// splashes melted cream; angry = faster + a second frost beam
function updGelato(b) {
  b.t++;
  if (b.fl > 0) b.fl--;
  const mad = b.hp < b.mhp / 2, cx = b.x + 12;
  b.dy = Math.min(b.dy + 0.25, 5);
  const vy = b.dy;
  phys(b);
  b.x = mid(L.ax + 1, b.x, L.ax + 119 - b.s);
  b.jv += -b.j * 0.25; b.jv *= 0.85; b.j += b.jv;            // jelly wobble
  if (b.land) {
    b.jv += Math.min(vy, 5) * 0.05; dust(cx, b.y + 24, 8);
    if (b.st === 'fight') {
      shk = 7; sfx(11);
      for (const d of [-1, 1]) eb(cx + d * 10, b.y + 22, d * 2, 0, 7, 2, undefined, 'wave');  // melted cream
    }
  }
  if (b.g) b.dx *= 0.8;
  if (b.st === 'intro') {
    if (b.t % 12 === 0) { shk = 4; b.jv += 0.12; }
    if (b.t > 75) { b.st = 'fight'; b.t = 0; }
  } else if (b.st === 'die') {
    if (b.t % 4 === 0) { boom(b.x + rnd(24), b.y + rnd(24), [14, 7, 4, 15, 8], 6); shk = 4; sfx(8); }
    if (b.t > 80) {
      boom(cx, b.y + 12, [14, 7, 4, 15, 8, 12], 60);
      shk = 14; hs = 6; sfx(8); score += 5000;
      pop(b.x, b.y, '+5000', 10);
      boss = null; wint = 50;
    }
    return;
  } else if (b.st === 'fight') {
    const w = b.frost;
    if (w) {
      w.t++;
      if (w.t < 18) b.jv += rnd(0.04) - 0.02;                  // wind-up shake
      else if (w.ph === 0) {
        w.len += 7;
        if (w.len >= w.max || solid(w.ox + w.d * w.len, w.y)) { w.ph = 1; w.hold = 8; }
      } else if (w.ph === 1) { if (--w.hold <= 0) w.ph = 2; }
      else {
        w.len -= 6;
        if (w.len <= 0) { b.frost = null; if (mad && !w.combo) startFrost(b, true); }
      }
      if (w.len > 0 && p.dead === 0 && p.inv === 0) {
        const x1 = w.ox + w.d * w.len, lo = Math.min(w.ox, x1), hi = Math.max(w.ox, x1);
        if (p.x + 5 > lo && p.x + 2 < hi && Math.abs(p.y + 5 - w.y) < 4) dmg(cx);
      }
    } else if (b.g && --b.atk <= 0) {
      const r = rnd(1);
      if (r < 0.45 && Math.abs(p.x - cx) < 96) startFrost(b, false);
      else if (r < 0.75) {
        // lob ice-cream scoops (strawberry, vanilla, chocolate) in arcs
        for (let i = 0; i < (mad ? 4 : 3); i++)
          eb(cx, b.y + 4, sgn(p.x - cx) * (0.7 + i * 0.5), -3 - i * 0.25, [14, 7, 4, 14][i], 2, 0.15);
        sfx(10); b.jv -= 0.15;
      } else {
        // hop to the other side of the room
        b.dx = (p.x < L.ax + 64 ? 1 : -1) * 1.6; b.dy = -4; b.j = -0.3; b.jv = 0; sfx(26);
      }
      b.atk = mad ? 32 : 50;
    } else if (b.g) {
      b.dx = mid(-0.4, b.dx + sgn(p.x - cx) * 0.05, 0.4);      // shuffle toward you
    }
  }
  if (b.st !== 'wait' && p.dead === 0 && p.inv === 0 && touch(b.x + 3, b.y + 4, 18, 20)) {
    dmg(cx); bounceOff(b, cx);
  }
}

// cake: a three-tier cake with candles. Shoots candle fireballs, lobs cake
// slices that bounce, jumps onto you. At half health the top tier blows off:
// it gets shorter, faster and fires more.
function updCake(b) {
  b.t++;
  if (b.fl > 0) b.fl--;
  const cx = b.x + 12;
  b.dy = Math.min(b.dy + 0.3, 6);
  const vy = b.dy;
  phys(b);
  b.x = mid(L.ax + 1, b.x, L.ax + 119 - b.s);
  b.jv += -b.j * 0.25; b.jv *= 0.85; b.j += b.jv;            // spongy wobble
  if (b.land) {
    b.jv += Math.min(vy, 6) * 0.05; dust(cx, b.y + 24, 10);
    if (b.st === 'fight') {
      shk = 8; sfx(11);
      for (const d of [-1, 1]) eb(cx + d * 10, b.y + 22, d * 2.2, 0, 14, 2, undefined, 'wave');
    }
  }
  if (b.g) b.dx *= 0.75;
  if (b.st === 'intro') {
    if (b.t % 12 === 0) { shk = 4; b.jv += 0.12; }
    if (b.t > 75) { b.st = 'fight'; b.t = 0; }
  } else if (b.st === 'die') {
    if (b.t % 4 === 0) { boom(b.x + rnd(24), b.y + b.top + rnd(24 - b.top), [15, 14, 7, 4, 8], 6); shk = 4; sfx(8); }
    if (b.t > 80) {
      boom(cx, b.y + 14, [15, 14, 7, 4, 8, 10], 60);
      shk = 14; hs = 6; sfx(8); score += 5000;
      pop(b.x, b.y, '+5000', 10);
      boss = null; wint = 50;
    }
    return;
  } else if (b.st === 'fight') {
    if (b.tier === 3 && b.hp < b.mhp / 2) {
      // the top tier blows off
      b.tier = 2; b.top = 9; b.oy = 12; b.h = 11;
      boom(cx, b.y + 6, [7, 14, 15, 12], 30); shk = 10; hs = 4; sfx(8);
      pop(cx - 12, b.y - 4, 'angry!', 8);
      for (let i = 0; i < 6; i++) eb(cx, b.y + 4, rnd(3) - 1.5, -2 - rnd(2), rnd([7, 14, 15]), 1, 0.15);
    }
    const fast = b.tier < 3;
    if (b.g && --b.atk <= 0) {
      const r = rnd(1);
      if (r < 0.4) {
        // candle fireballs: an aimed spread from the top
        const n = fast ? 4 : 3, cy = b.y + b.top + 2, a = atan2(p.x + 4 - cx, p.y + 5 - cy);
        for (let i = 0; i < n; i++) {
          const k = i - (n - 1) / 2;
          eb(cx + k * 4, cy, cos(a + k * 0.05) * 1.5, sin(a + k * 0.05) * 1.5, rnd([8, 9, 10]), 2);
        }
        sfx(10);
      } else if (r < 0.7) {
        // cake slices: lobbed at you, bounce once on the floor
        for (const sp of fast ? [0.8, 1.4, 2] : [0.9, 1.6])
          eb(cx, b.y + b.top + 4, sgn(p.x - cx) * sp, -3.2, 15, 2, 0.18, 'bounce');
        sfx(10); b.jv -= 0.15;
      } else {
        // big jump: come down on the hero
        b.dx = mid(-2.2, (p.x - cx) / 28, 2.2); b.dy = -5; b.j = -0.3; b.jv = 0; sfx(26);
      }
      b.atk = fast ? 34 : 52;
    } else if (b.g && Math.abs(L.ax + 64 - cx) > 16) {
      b.dx = mid(-0.3, b.dx + sgn(L.ax + 64 - cx) * 0.04, 0.3);   // drift back to the middle
    }
  }
  if (b.st !== 'wait' && p.dead === 0 && p.inv === 0 && touch(b.x + 3, b.y + 4 + b.top, 18, 20 - b.top)) {
    dmg(cx); bounceOff(b, cx);
  }
}

// a ground boss that touches the hero hops back, so it can't pin you in a corner
function bounceOff(o, cx) {
  if (!o.g) return;
  o.dx = -sgn(p.x + 4 - cx) * 1.4; o.dy = -2.2; o.t = 0;
}

function startFrost(b, combo) {
  const d = sgn(p.x + 4 - b.x - 12);
  b.frost = { t: combo ? 10 : 0, d, y: mid(b.y + 4, p.y + 5, b.y + 20), ox: b.x + 12 + d * 8,
    len: 0, max: 96, ph: 0, combo };
  sfx(10);
}

function hitboss(bl, n) {
  const b = boss;
  b.hp -= n; b.fl = 3; sfx(7);
  if (b.gel) { b.jv += 0.06; if (b.hp <= 0) b.frost = null; }
  if (b.cake) b.jv += 0.06;
  b.sx = 1.1; b.sy = 0.92;
  spark(bl.x, bl.y, [7, 14, 15], 6);
  score += 10;
  if (b.hp <= 0) { b.st = 'die'; b.t = 0; ebul = []; sfx(9); hs = 8; shk = 8; music(-1, 1500); }
}

// pudding: big -> 2 medium -> 4 small, bounces, can't fly, head = trampoline.
// the level's boss hp is split over the generations (1/3, 1/6, 1/12 each)
const psz = [16, 12, 8];
function newpud(x, y, gen) {
  const s = psz[gen];
  return { x, y, dx: 0, dy: 0, g: false, gen, s, ox: 1, oy: 1, w: s - 3, h: s - 2,
    hp: Math.max(1, Math.round(L.bhp / (3 << gen))),
    t: 0, wt: 40, j: 0, jv: 0, fl: 0 };
}

function updPud(b) {
  b.t++;
  if (b.st === 'intro') {
    if (b.t % 12 === 0) { shk = 4; for (const q of puds) q.jv += 0.12; }
    if (b.t > 75) b.st = 'fight';
  }
  const mad = b.hp < b.mhp / 2;
  let hp = 0;
  for (const q of puds) {
    q.dy = Math.min(q.dy + 0.2, 5);
    const vy = q.dy;
    phys(q);
    q.x = mid(L.ax + 1, q.x, L.ax + 119 - q.s);
    if (q.land) {
      q.jv += Math.min(vy, 5) * 0.05; q.dx = 0;
      dust(q.x + q.s / 2, q.y + q.s, flr(q.s / 2));
      if (b.st !== 'wait') sfx(26);
      if (q.gen === 0 && b.st === 'fight') {
        shk = 7;
        for (const d of [-1, 1]) eb(q.x + 8 + d * 6, q.y + 14, d * 2, 0, 15, 2, undefined, 'wave');
      } else if (q.gen === 1 && b.st === 'fight' && mad && rnd(1) < 0.5) {   // caramel only when angry
        for (const i of [-1, 0, 1]) eb(q.x + 6, q.y + 2, i * 0.9, -2.4, 4, 1, 0.15);
      }
    }
    if (q.g) q.dx *= 0.8;
    q.jv += -q.j * 0.25; q.jv *= 0.86; q.j += q.jv;   // jelly wobble
    if (q.fl > 0) q.fl--;
    if (b.st === 'fight' && q.g) {
      q.t++;
      if (q.t > q.wt) {
        const d = sgn(p.x + 4 - q.x - q.s / 2);
        q.dx = d * (0.4 + rnd(0.7));
        q.dy = -(2.6 + rnd(1.6) + q.gen * 0.3);
        q.t = 0; q.j = -0.3; q.jv = 0;
        q.wt = ([62, 56, 48][q.gen] + rnd(16)) * (mad ? 0.75 : 1);
      } else if (q.t > q.wt - 14) q.j += (0.22 - q.j) * 0.2;   // wind up
    }
    if (p.dead === 0 && touch(q.x + 1, q.y + 1, q.s - 2, q.s - 1)) {
      if (p.dy > 0 && p.y + 7 < q.y + q.s * 0.5) {
        p.dy = -5; p.sq = -4; p.co = 0; q.jv += 0.15; sfx(26); dust(p.x + 4, p.y + 8, 3);
      } else if (p.inv === 0 && b.st !== 'wait') { dmg(q.x + q.s / 2); bounceOff(q, q.x + q.s / 2); }
    }
    hp += q.hp;
  }
  b.hp = hp;
}

function hitpud(q, n, bl) {
  q.hp -= n; q.fl = 3; q.jv += 0.05 * n; sfx(7);
  spark(bl.x, bl.y, [7, 15, 4], 6);
  score += 10;
  if (q.hp > 0) return;
  puds.splice(puds.indexOf(q), 1);
  const cx = q.x + q.s / 2, cy = q.y + q.s / 2;
  boom(cx, cy, [15, 4, 8, 7], q.gen === 2 ? 14 : 20);
  shk = Math.max(shk, 5); hs = 3; sfx(8);
  if (q.gen < 2) {
    const s2 = psz[q.gen + 1];
    for (const d of [-1, 1]) {
      const c = newpud(cx - s2 / 2 + d * 3, q.y + q.s - s2, q.gen + 1);
      c.dx = d * 1.3; c.dy = -3; c.j = -0.3;
      puds.push(c);
    }
    pop(cx - 8, q.y - 6, 'split!', 15);
  } else if (puds.length === 0) {
    boom(cx, cy, [14, 15, 12, 10, 7, 11], 60);
    shk = 14; hs = 6; ebul = [];
    score += 5000; pop(cx - 10, cy - 8, '+5000', 10);
    music(-1, 1500);
    boss = null; wint = 50;
  }
}

function updParts() {
  for (const q of [...parts]) {
    q.x += q.dx; q.y += q.dy; q.dy += q.g;
    if (--q.t < 0) parts.splice(parts.indexOf(q), 1);
  }
  for (const q of [...pops]) { q.y -= 0.5; if (--q.t < 0) pops.splice(pops.indexOf(q), 1); }
}

// ------------------------------------------------------------ draw
const cprint = (s, y, c) => P.print(s, 64 - String(s).length * 2, y, c);
function oprint(s, x, y, c, o, scale = 1) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) P.print(s, x + dx, y + dy, o, scale);
  P.print(s, x, y, c, scale);
}
const sprs = (s, x, y, w, h, f, fy) => P.sspr((s % 16) * 8, (s >> 4) * 8, 8, 8, x + 4 - w / 2, y + 8 - h, w, h, f, fy);
const sqwh = q => q > 0 ? [10, 6] : q < 0 ? [6, 10] : [8, 8];

function drawBg(cx, cy = 0) {
  const mx = 100 - cx * 0.05, my = 22 - cy * 0.1;
  P.circfill(mx, my, 8, 7); P.circfill(mx - 3, my - 2, 2, 6);
  for (const s of stars) P.pset(((s.x - cx * s.z) % 128 + 128) % 128, s.y, (t / 40 + s.tw) % 1 < 0.06 ? 7 : s.c);
  const o = cx * 0.3;
  for (let i = -1; i <= 17; i++) {
    const wx = i + flr(o / 8), h = 10 + ((wx * 13 % 7) + 7) % 7 * 5 + cy * 0.3, x = wx * 8 - o;
    P.rectfill(x, 128 - h, x + 7, 127, 5);
    if (((wx * 7) % 3 + 3) % 3 === 0) { P.pset(x + 2, 131 - h + ((wx % 3) + 3) % 3 * 3, 10); P.pset(x + 5, 136 - h, 9); }
  }
}

// sakura: dusk, red sun, mount fuji, houses, torii and lanterns
function drawBg2(cx) {
  P.fillp(0b1010010110100101); P.rectfill(0, 64, 127, 75, 0x20); P.fillp();
  P.rectfill(0, 76, 127, 127, 2);
  const sx = 96 - cx * 0.03;
  P.circfill(sx, 50, 17, 8); P.circ(sx, 50, 17, 14);
  const fx = 44 - cx * 0.06;
  for (let i = 0; i <= 48; i++) P.line(fx - i * 1.5, 58 + i, fx + i * 1.5, 58 + i, i < 9 ? 7 : 13);
  for (const s of stars) if (s.y < 60) P.pset(((s.x - cx * s.z) % 128 + 128) % 128, s.y, (t / 40 + s.tw) % 1 < 0.06 ? 7 : s.c);
  const o = cx * 0.3;
  for (let i = -1; i <= 17; i++) {
    const wx = i + flr(o / 8), h = 12 + ((wx * 13 % 5) + 5) % 5 * 4, x = wx * 8 - o;
    if (((wx % 7) + 7) % 7 === 3) {
      P.line(x - 2, 127 - h, x + 9, 127 - h, 8); P.line(x, 131 - h, x + 7, 131 - h, 8);
      P.line(x + 1, 128 - h, x + 1, 127, 8); P.line(x + 6, 128 - h, x + 6, 127, 8);
    } else {
      P.rectfill(x, 128 - h, x + 7, 127, 0);
      P.line(x - 2, 128 - h, x + 9, 128 - h, 0);
      if (((wx % 3) + 3) % 3 === 0) P.circfill(x + 3, 133 - h, 1, t % 20 < 18 ? 9 : 10);
    }
  }
}

// italy: roman evening - colosseum, leaning tower, tuscan hills with
// vineyards and cypress trees, and italian flag bunting overhead
const wrap = (v, n) => ((v % n) + n) % n;
function drawBg3(cx) {
  // evening sky: deep blue -> purple -> warm glow on the horizon
  P.rectfill(0, 0, 127, 30, 1);
  P.fillp(0b1010010110100101); P.rectfill(0, 31, 127, 44, 0x21); P.fillp();
  P.rectfill(0, 45, 127, 62, 2);
  P.fillp(0b1010010110100101); P.rectfill(0, 63, 127, 70, 0xe2); P.fillp();
  P.rectfill(0, 71, 127, 127, 14);
  for (const s of stars) if (s.y < 44) P.pset(wrap(s.x - cx * s.z, 128), s.y, (t / 40 + s.tw) % 1 < 0.06 ? 7 : 6);
  // crescent moon
  const mx = 26 - cx * 0.02;
  P.circfill(mx, 24, 6, 7); P.circfill(mx + 3, 22, 6, 1);

  // the colosseum: three tiers of arches, broken on the right
  const cl = wrap(70 - cx * 0.1, 300) - 60;
  P.rectfill(cl, 46, cl + 33, 72, 15);
  P.rectfill(cl + 34, 52, cl + 51, 72, 15);
  for (let tier = 0; tier < 3; tier++) {
    const ty = 49 + tier * 8;
    P.line(cl, ty - 2, cl + 51, ty - 2, 9);
    for (let c = 0; c < 7; c++) {
      if (tier === 0 && c > 4) continue;
      const ax = cl + 2 + c * 7;
      P.rectfill(ax, ty + 1, ax + 3, ty + 5, 4);
      P.line(ax + 1, ty, ax + 2, ty, 4);
    }
  }
  // leaning tower of pisa
  const tw = wrap(200 - cx * 0.1, 300) - 60;
  for (let k = 0; k < 7; k++) {
    P.rectfill(tw + k * 0.8, 72 - k * 5, tw + 6 + k * 0.8, 75 - k * 5, k % 2 ? 6 : 7);
    P.pset(tw + 2 + k * 0.8, 73 - k * 5, 13); P.pset(tw + 4 + k * 0.8, 73 - k * 5, 13);
  }

  // far hills (hazy) and green tuscan hills with vineyard rows
  const o1 = cx * 0.15, o2 = cx * 0.25;
  const hillA = x => 76 + sin((x + o1) / 70) * 5 + sin((x + o1) / 27) * 2;
  const hillB = x => 90 + sin((x + o2) / 56) * 6 + sin((x + o2) / 19) * 2;
  for (let x = 0; x < 128; x++) P.line(x, hillA(x), x, 127, 13);
  for (let x = 0; x < 128; x++) {
    const h = hillB(x);
    P.line(x, h, x, 127, 3);
    if (wrap(x + o2, 4) < 2) for (let r = 4; r < 30; r += 5) P.pset(x, h + r, 11);
  }
  // cypress trees: dark, tall flames standing on the green hills
  for (let i = -1; i < 9; i++) {
    const wx = i + flr(o2 / 16), x = wx * 16 - o2 + wrap(wx * 7, 5) * 2;
    if (wrap(wx * 13, 3) === 0) continue;
    const base = hillB(x) + 2;
    for (let k = 0; k < 17; k++) {
      const half = k < 2 ? 1 : k < 11 ? 2 : k < 15 ? 1 : 0;
      P.line(x - half, base - k, x + half, base - k, 1);
    }
  }
  // italian flag bunting strung across the top
  const bo = flr(cx * 0.5);   // whole pixels, so a flag lands every 6px
  for (let x = 0; x < 128; x++) {
    const u = wrap(x + bo, 64) - 32, y = 13 + u * u / 90;
    P.pset(x, y, 6);
    if (wrap(x + bo, 6) === 0) {
      const c = [11, 7, 8][wrap(flr((x + bo) / 6), 3)];
      for (let k = 0; k < 4; k++) P.line(x + k * 0.5, y + 1 + k, x + 4 - k * 0.5, y + 1 + k, c);
    }
  }
}

// paris at night: the eiffel tower lit up, mansard rooftops, warm windows
function drawBg4(cx) {
  P.rectfill(0, 0, 127, 59, 1);
  P.fillp(0b1010010110100101); P.rectfill(0, 60, 127, 79, 0xd1); P.fillp();
  P.rectfill(0, 80, 127, 127, 13);
  for (const s of stars) if (s.y < 58) P.pset(wrap(s.x - cx * s.z, 128), s.y, (t / 40 + s.tw) % 1 < 0.06 ? 7 : 6);
  const mx = 104 - cx * 0.04;
  P.circfill(mx, 24, 6, 7); P.pset(mx - 2, 22, 6); P.pset(mx + 1, 26, 6);
  // eiffel tower: tapering legs, two platforms, lights that sparkle now and then
  const ex = wrap(60 - cx * 0.08, 260) - 60, base = 100;
  for (let k = 0; k <= 62; k++) {
    const y = base - k;
    const half = k < 20 ? 15 - k * 0.5 : k < 46 ? 5 - (k - 20) * 0.12 : 1.9 - (k - 46) * 0.1;
    const c = flr(t / 90) % 4 === 0 && rnd(1) < 0.3 ? 7 : 9;
    P.pset(ex - half, y, c); P.pset(ex + half, y, c);
    if (k % 6 === 3 && k < 46) P.line(ex - half + 1, y, ex + half - 1, y, 4);
  }
  P.line(ex - 6, base - 20, ex + 6, base - 20, 10);
  P.line(ex - 3, base - 46, ex + 3, base - 46, 10);
  P.line(ex, base - 62, ex, base - 68, 9);
  P.pset(ex, base - 69, t % 30 < 15 ? 7 : 8);
  for (let a = 0; a <= 10; a++) P.pset(ex - 5 + a, base - 4 - Math.sqrt(25 - (a - 5) * (a - 5)) * 0.8, 9);
  // rooftops: dark buildings, zinc mansard roofs, chimneys, lit windows
  const o = cx * 0.3;
  for (let i = -1; i < 9; i++) {
    const wx = i + flr(o / 16), x = wx * 16 - o, h = 24 + wrap(wx * 7, 4) * 5, top = 128 - h;
    P.rectfill(x, top, x + 15, 127, 5);
    for (let k = 0; k < 6; k++) P.line(x + 3 - k * 0.5, top - 6 + k, x + 12 + k * 0.5, top - 6 + k, 13);
    P.rectfill(x + 4, top - 10, x + 5, top - 6, 4);
    P.rectfill(x + 10, top - 9, x + 11, top - 6, 4);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      P.rectfill(x + 2 + c * 5, top + 3 + r * 7, x + 3 + c * 5, top + 5 + r * 7, wrap(wx * 3 + r * 5 + c * 7, 4) === 0 ? 10 : 1);
  }
}

function themeBg(theme, cx, cy) {
  if (theme === 'sakura') drawBg2(cx);
  else if (theme === 'italy') drawBg3(cx);
  else if (theme === 'paris') drawBg4(cx);
  else drawBg(cx, cy);
}

function drawPetals() {
  // sakura petals: little two-tone flakes, bigger ones up front
  for (const q of petals) {
    P.pset(q.x, q.y, q.c); P.pset(q.x + 1, q.y, q.c);
    if (q.s > 0.45) { P.pset(q.x, q.y + 1, q.c === 7 ? 15 : 14); P.pset(q.x + 1, q.y + 1, 15); }
  }
}

function draw() {
  P.cls(0);
  if (state === 'title') return drawTitle();
  if (state === 'options') return drawOptions();
  if (state === 'inter') return drawInter();
  themeBg(L.theme, camx, camy - L.top);
  const sx = shk > 0.5 ? rnd(shk) - shk / 2 : 0, sy = shk > 0.5 ? rnd(shk) - shk / 2 : 0;
  P.camera(camx + sx, camy + sy);
  if (L.jp) { P.pal(8, 4); P.pal(14, 9); }      // sakura: bricks become wood
  if (L.it) { P.pal(8, 6); P.pal(14, 7); P.pal(2, 13); }   // italy: white marble
  if (L.theme === 'paris') { P.pal(8, 5); P.pal(14, 6); P.pal(2, 1); }   // paris: cobblestones
  const tx0 = flr(camx / 8) - 1, ty0 = flr(camy / 8) - 1;
  for (let ty = ty0; ty < ty0 + 19; ty++) for (let tx = tx0; tx < tx0 + 19; tx++) {
    const s = mget(tx, ty);
    if (s) P.spr(s, tx * 8, ty * 8);
  }
  P.pal();
  for (const e of ents) drawEnt(e);
  if (boss) drawBoss();
  drawPlayer();
  for (const b of bolts) {
    if (b.big) {
      const tx = b.x - b.d * 16;
      P.rectfill(tx, b.y - 2, b.x, b.y + 2, 3);
      P.rectfill(tx + b.d * 4, b.y - 1, b.x, b.y + 1, 11);
      P.line(tx + b.d * 8, b.y, b.x, b.y, 7);
      P.circfill(b.x, b.y, 2 + t % 2, 7);
    } else {
      P.line(b.x, b.y, b.x - b.d * 8, b.y, 3);
      P.line(b.x, b.y, b.x - b.d * 5, b.y, 11);
      P.pset(b.x, b.y, 7);
    }
  }
  for (const b of ebul) {
    if (b.fry) { P.line(b.x, b.y, b.x - b.dx * 2, b.y - b.dy * 2, 10); P.pset(b.x, b.y, 9); }
    else if (b.wave) { P.circfill(b.x, b.y, 2 + t % 2, b.c); P.circ(b.x, b.y, 3, 8); }
    else { const r = b.r || 1; P.circfill(b.x, b.y, r, b.c); if (r > 1) P.pset(b.x, b.y, 7); }
  }
  for (const q of parts) {
    if (q.ring) P.circ(q.x, q.y, q.r * (1 - q.t / q.mt) + 1, q.c);
    else if (q.r > 0) P.circfill(q.x, q.y, q.r * q.t / q.mt, q.c);
    else P.pset(q.x, q.y, q.c);
  }
  for (const q of pops) if (q.t > 8 || t % 2 === 0) oprint(q.s, q.x, q.y, q.c, 0);
  P.camera();
  if (L.jp) drawPetals();
  drawHud();
}

function drawPlayer() {
  if (p.dead > 0 || (p.inv > 0 && t % 4 < 2)) return;
  let s = 1;
  if (p.st > 0) s = p.st > 3 ? 17 : 33;
  else if (!p.g) s = p.dy < 0 ? 11 : 12;
  else if (Math.abs(p.dx) > 0.3) s = [1, 9, 1, 10][flr(t / 4) % 4];
  const [w, h] = sqwh(p.sq);
  if (flr(t / 6) % 5 === 0) P.pal(11, 3);            // belt light pulse
  if (p.ch >= 30 && t % 4 < 2) { P.pal(12, 7); P.pal(11, 7); }  // charged: flash white
  sprs(s, p.x, p.y, w, h, p.f);
  P.pal();
  if (p.shOn && (p.sh > 15 || t % 4 < 2)) {
    // shield bubble (flickers when almost empty)
    P.circ(p.x + 4, p.y + 5, 7, t % 6 < 3 ? 12 : 7);
    P.pset(p.x + 4 + cos(t / 20) * 6, p.y + 5 + sin(t / 20) * 6, 7);
  }
}

function drawEnt(e) {
  if (e.k === 8) {
    if (e.on) P.pal(8, 11);
    P.spr(flr(t / 8) % 2 === 0 ? 8 : 24, e.x, e.y);
    P.pal(); return;
  }
  if (e.k === 9) {
    if (e.life > 60 || t % 4 < 2) P.spr(13, e.x, e.y + (e.g ? sin(t / 20) : 0));
    return;
  }
  let s = e.k, fy = false, f = e.f;
  if (e.k === 35) { const r = flr(e.x / 3) % 4; f = r === 1 || r === 2; fy = r >= 2; }  // maki rolls
  else if (e.k === 40) s = flr(e.x / 4) % 2 === 0 ? 40 : 41;                          // meatball rolls
  else if (e.k === 42) s = e.st ? 43 : 42;                                              // pizza angry
  else if (e.k === 48) s = flr(t / 4) % 2 ? 49 : 48;                                    // croissant flaps
  else if (e.k === 50) { s = e.sq !== 0 ? 51 : 50; if (e.flav !== 14) P.pal(14, e.flav); } // macaron flavour
  else if (e.k === 3) s = flr(t / 6) % 2 === 0 ? 3 : 19;
  else if (e.k === 4) { s = flr(t / (e.ch ? 2 : 5)) % 2 === 0 ? 4 : 20; if (e.ch) P.pal(7, 15); }
  if (e.fl > 0) palWhite();
  const [w, h] = sqwh(e.sq);
  const shake = e.st === 'aim' ? rnd(2) - 1 : 0;
  sprs(s, e.x + shake, e.y, w, h, f, fy);
  P.pal();
}

function drawBoss() {
  const b = boss, bsx = (L.bs % 16) * 8, bsy = (L.bs >> 4) * 8;
  if (b.cake) {
    // sprite rows 0-5 are the top tier: crop them once it has blown off
    const crop = b.top ? 6 : 0;
    const j = mid(-0.5, b.j, 0.5), w = 24 * (1 + j), h = 24 * (1 - j) * (16 - crop) / 16;
    const ox = b.st === 'die' ? rnd(2) - 1 : 0;
    const x0 = b.x + 12 - w / 2 + ox, y0 = b.y + 24 - h;
    P.pal(Array(15).fill(2));
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
      P.sspr(bsx, bsy + crop, 16, 16 - crop, x0 + dx, y0 + dy, w, h);
    P.pal();
    if (b.fl > 0 || (b.st === 'die' && t % 4 < 2)) palWhite();
    else if (b.tier < 3 && t % 8 < 4) P.pal(14, 8);           // angry: pink goes red
    P.sspr(bsx, bsy + crop, 16, 16 - crop, x0, y0, w, h);
    P.pal();
    if (b.st === 'die') return;
    const flame = (x, y) => {
      P.pset(x, y, rnd([10, 9])); P.pset(x, y - 1, rnd([9, 8, 10]));
      if (t % 4 < 2) P.pset(x, y - 2, 8);
    };
    [4, 7, 10].forEach((c, i) => {
      const x = x0 + (c + 0.5) * w / 16;
      if (!crop) flame(x, y0 + h / 16 - 1);
      else { P.line(x, y0 - 3, x, y0 - 1, [12, 14, 12][i]); flame(x, y0 - 4); }
    });
    return;
  }
  if (b.gel) {
    const wv = b.frost;
    if (wv && wv.len > 0) {
      // frost beam: icy wavy stream with snowflakes, a frosty puff at the tip
      for (let x = 0; x <= wv.len; x += 1) {
        const xx = wv.ox + wv.d * x, yy = wv.y + sin(x / 12 + t / 6) * 1.5;
        P.pset(xx, yy, 7); P.pset(xx, yy + 1, 12);
        if ((x + t) % 9 === 0) P.pset(xx, yy - 2, 7);
      }
      P.circfill(wv.ox + wv.d * wv.len, wv.y, 2 + t % 2, 7);
      P.circ(wv.ox + wv.d * wv.len, wv.y, 3, 12);
    } else if (wv) {
      // wind-up: cold mist gathers at the mouth
      P.pset(b.x + 12 + wv.d * 6 + rnd(4) - 2, wv.y + rnd(4) - 2, rnd([7, 12]));
    }
    const j = mid(-0.5, b.j, 0.5), w = 24 * (1 + j), h = 24 * (1 - j);
    const ox = b.st === 'die' || (wv && wv.t < 18) ? rnd(2) - 1 : 0;
    // dark outline keeps the pastel cone readable on any background
    P.pal(Array(15).fill(2));
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
      P.sspr(bsx, bsy, 16, 16, b.x + 12 - w / 2 + ox + dx, b.y + 24 - h + dy, w, h);
    P.pal();
    if (b.fl > 0 || (b.st === 'die' && t % 4 < 2)) palWhite();
    else if (b.hp < b.mhp / 2 && t % 8 < 4) P.pal(14, 8);    // angry: strawberry goes red
    P.sspr(bsx, bsy, 16, 16, b.x + 12 - w / 2 + ox, b.y + 24 - h, w, h);
    P.pal();
    return;
  }
  if (b.pud) {
    // jelly: wide+short <-> thin+tall, feet stay on the floor
    const mad = b.hp < b.mhp / 2;
    for (const q of puds) {
      const j = mid(-0.6, q.j, 0.6), w = q.s * (1 + j), h = q.s * (1 - j);
      if (q.fl > 0) palWhite(); else if (mad && t % 8 < 4) P.pal(15, 14);
      P.sspr(bsx, bsy, 16, 16, q.x + q.s / 2 - w / 2, q.y + q.s - h, w, h, p.x > q.x + q.s / 2);
      P.pal();
    }
    return;
  }
  const ox = (b.st === 'slam' && b.t < 25) || b.st === 'intro' || b.st === 'die' ? rnd(2) - 1 : 0;
  if (b.hp < b.mhp / 2 && t % 8 < 4) P.pal(14, 8);
  if (b.fl > 0 || (b.st === 'die' && t % 4 < 2)) palWhite();
  const w = 16 * b.sx, h = 16 * b.sy, x0 = b.x + 8 - w / 2 + ox, y0 = b.y + 16 - h;
  P.sspr(bsx, bsy, 16, 16, x0, y0, w, h);
  P.pal();
  if (b.fl > 0) return;
  // angry face
  const cx = b.x + 8 + ox, cy = y0 + h * 0.45, ex = p.x > b.x + 4 ? 1 : -1;
  for (const d of [-1, 1]) {
    const x = cx + d * 5 * b.sx;
    P.rectfill(x - 1, cy - 1, x + 1, cy + 1, 7);
    P.pset(x + ex, cy, 0);
  }
  const ty = y0 + 5 * b.sy;
  P.pset(cx - 2, ty, 7); P.pset(cx + 1, ty, 7);
}

function drawHud() {
  P.rectfill(0, 0, 127, 9, 0);
  P.line(0, 9, 127, 9, 2);
  P.print('score ' + score, 2, 2, 7);
  for (let i = 1; i <= Math.min(lives, 5); i++) P.spr(1, 128 - i * 8, 0);
  P.spr(13, 51, 0);
  for (let i = 1; i <= 6; i++) {
    const x = 55 + i * 6;
    let c = 1;
    if (i <= p.hp) c = p.hp <= 2 && t % 10 < 5 ? 8 : 11;
    else if (i === p.hp + 1 && hpfl > 0) c = 7;
    if (i === p.hp && hpup > 0 && t % 4 < 2) c = 7;
    P.rectfill(x, 2, x + 4, 6, c);
    if (c === 11) P.line(x, 2, x + 4, 2, 7);
  }
  // shield energy under the health bar (red while broken / recharging)
  const sw = p.sh / SH_MAX * 34;
  if (sw > 0) P.line(61, 8, 61 + sw, 8, p.brk ? 8 : p.shOn ? 7 : 12);
  const b = boss;
  if (b && arena) {
    if (b.st === 'intro') {
      if (t % 10 < 7) oprint(L.name, 64 - L.name.length * 4, 52, 14, 2, 2);
      cprint('- boss -', 68, 8);
    } else {
      // slim bar on the side of the screen away from the hero
      const by = p.y - camy < 48 ? 122 : 11;
      P.rectfill(0, by - 1, 127, by + 5, 0);
      P.print('boss', 2, by, 14);
      P.rect(20, by, 125, by + 4, 2);
      const w = b.hp / b.mhp * 104;
      if (w > 0) {
        P.rectfill(21, by + 1, 20 + w, by + 3, b.hp < b.mhp / 2 ? 8 : 14);
        P.line(21, by + 1, 20 + w, by + 1, 15);
      }
    }
  }
  if (state === 'win') panel('you beat the game!', 14);
  else if (state === 'over') panel('game over', 8);
}

function panel(s, c) {
  P.rectfill(14, 46, 113, 82, 0); P.rect(14, 46, 113, 82, c);
  cprint(s, 52, c); cprint('score ' + score, 62, 7);
  if (wait < 0 && t % 30 < 20) cprint('press z', 73, 6);
}

function drawInter() {
  const next = LEVELS[lv + 1], [foes, bossSpr] = PREVIEW[next.theme] || PREVIEW.city;
  themeBg(next.theme, t * 0.5, 0);
  if (next.theme === 'sakura') drawPetals();
  P.rectfill(12, 14, 115, 114, 0); P.rect(12, 14, 115, 114, 14);
  cprint('stage ' + (lv + 1) + ' clear!', 20, 11);
  cprint('score ' + score, 30, 7);
  P.line(24, 40, 103, 40, 2);
  oprint('stage ' + (lv + 2), 36, 48, 14, 2, 2);
  cprint('~ ' + next.name + ' ~', 64, 15);
  foes.forEach((s, i) => P.spr(s, 36 + i * 14, 80 + sin(t / 30 + i / 3) * 2));
  P.spr(bossSpr, 82, 72 + sin(t / 40) * 2, 2, 2);
  if (wait < 0 && t % 30 < 20) cprint('press z', 102, 6);
}

function drawTitle() {
  drawBg(t);
  const y = sin(t / 60) * 3;
  const s = flr(t / 4) % 6 < 3 ? 17 : 33;
  P.sspr((s % 16) * 8, (s >> 4) * 8, 8, 8, 10, 36, 32, 32);
  P.sspr(48, 0, 16, 16, 72, 14 + y, 32, 32);
  P.sspr(48, 16, 16, 16, 96, 34 - y, 32, 32);
  oprint('food run', 32, 74, 14, 2, 2);
  cprint('z: jump   x: laser', 90, 6);
  cprint('hold x: beam   hold down: shield', 98, 11);
  if (!LEVELS.length) return;
  const items = ['start' + (lv0 > 0 ? ' (stage ' + (lv0 + 1) + ')' : ''), 'options'];
  items.forEach((s, i) => {
    const on = menu === i;
    cprint((on && t % 20 < 14 ? '> ' : '  ') + s + '  ', 108 + i * 8, on ? 10 : 6);
  });
}

function drawOptions() {
  drawBg(t);
  P.rectfill(10, 24, 117, 104, 0); P.rect(10, 24, 117, 104, 14);
  oprint('options', 36, 30, 14, 2, 2);
  const rows = [
    'start stage: < ' + (lv0 + 1) + ' >',
    'sound: < ' + (sound ? 'on' : 'off') + ' >',
    'back',
  ];
  const ry = [50, 68, 80];                       // row 0 has the stage name under it
  rows.forEach((s, i) => {
    const on = osel === i;
    cprint(s, ry[i], on ? 10 : 6);
    if (on && t % 20 < 14) P.print('>', 14, ry[i], 10);
  });
  cprint(LEVELS[lv0].name, 57, 13);
  cprint('up/down: choose', 90, 5);
  cprint('left/right: change  z: ok', 96, 5);
}

// ------------------------------------------------------------ boot
function loop() {
  let last = performance.now(), acc = 0;
  const step = 1000 / 30;
  const frame = now => {
    acc = Math.min(acc + now - last, step * 4);
    last = now;
    while (acc >= step) {
      update();
      for (let i = 0; i < 6; i++) { was[i] = held[i]; tap[i] = false; }
      acc -= step;
    }
    draw();
    P.flip();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// from server.py's API when it's running; otherwise (e.g. GitHub Pages)
// from the static bundle that tools/export_static.py writes
async function loadData(get) {
  if (window.FOODRUN_STATIC) return get('data/bundle.json');
  try {
    const [sprites, audio, list] = await Promise.all([get('api/sprites'), get('api/audio'), get('api/levels')]);
    return { sprites, audio, levels: await Promise.all(list.map(l => get('api/levels/' + l.id))) };
  } catch (e) {
    return get('data/bundle.json');
  }
}

async function boot() {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  try {
    const { sprites, audio, levels } = await loadData(get);
    P.loadSprites(sprites);
    SND = new Synth(audio);
    SND.setMuted(!sound);
    LEVELS = levels;
    // ?level=<id> (from the editor's play button): jump straight in
    const want = new URLSearchParams(location.search).get('level');
    const i = LEVELS.findIndex(l => l.id === want);
    if (i >= 0) { lv0 = i; start(); }
    // ?debug exposes live state in the console (for testing)
    if (new URLSearchParams(location.search).has('debug'))
      window.FR = {
        get boss() { return boss; }, get p() { return p; }, get state() { return state; },
        get ents() { return ents; }, get ebul() { return ebul; }, get puds() { return puds; },
        get L() { return L; }, get lives() { return lives; }, get lv() { return lv; },
        get score() { return score; }, get arena() { return arena; }, solid, mget,
        set lives(v) { lives = v; },
      };
  } catch (e) {
    document.getElementById('err').textContent = 'Could not load game data: ' + e.message +
      ' - is server.py running?';
    return;
  }
  loop();
}
boot();
