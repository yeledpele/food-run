// pico.js - a tiny PICO-8-style screen: 128x128, 16 colours, indexed buffer.
// Drawing calls mirror PICO-8 (pal, camera, spr/sspr, circfill, print...) so the
// game code ports almost line for line.

export const PALETTE = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f',
  '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c',
  '#ff77a8', '#ffccaa'];

// 3x5 font, one number per row (bit 2 = left column)
const FONT = {
  a: [7, 5, 7, 5, 5], b: [6, 5, 6, 5, 6], c: [7, 4, 4, 4, 7], d: [6, 5, 5, 5, 6],
  e: [7, 4, 6, 4, 7], f: [7, 4, 6, 4, 4], g: [7, 4, 5, 5, 7], h: [5, 5, 7, 5, 5],
  i: [7, 2, 2, 2, 7], j: [7, 1, 1, 5, 7], k: [5, 5, 6, 5, 5], l: [4, 4, 4, 4, 7],
  m: [7, 7, 5, 5, 5], n: [6, 5, 5, 5, 5], o: [7, 5, 5, 5, 7], p: [7, 5, 7, 4, 4],
  q: [7, 5, 5, 6, 3], r: [7, 5, 6, 5, 5], s: [7, 4, 7, 1, 7], t: [7, 2, 2, 2, 2],
  u: [5, 5, 5, 5, 7], v: [5, 5, 5, 5, 2], w: [5, 5, 5, 7, 7], x: [5, 5, 2, 5, 5],
  y: [5, 5, 7, 2, 2], z: [7, 1, 2, 4, 7],
  0: [7, 5, 5, 5, 7], 1: [6, 2, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 3, 1, 7],
  4: [5, 5, 7, 1, 1], 5: [7, 4, 7, 1, 7], 6: [4, 4, 7, 5, 7], 7: [7, 1, 1, 1, 1],
  8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 1],
  ' ': [0, 0, 0, 0, 0], '!': [2, 2, 2, 0, 2], '?': [7, 1, 3, 0, 2], '.': [0, 0, 0, 0, 2],
  ',': [0, 0, 0, 2, 4], ':': [0, 2, 0, 2, 0], '+': [0, 2, 7, 2, 0], '-': [0, 0, 7, 0, 0],
  '/': [1, 1, 2, 4, 4], '~': [0, 3, 6, 0, 0], '(': [2, 4, 4, 4, 2], ')': [2, 1, 1, 1, 2],
  '<': [1, 2, 4, 2, 1], '>': [4, 2, 1, 2, 4], "'": [2, 2, 0, 0, 0], '=': [0, 7, 0, 7, 0],
  '%': [5, 1, 2, 4, 5], '*': [5, 2, 5, 0, 0], '_': [0, 0, 0, 0, 7], '#': [5, 7, 5, 7, 5],
};

export class Pico {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(128, 128);
    this.buf = new Uint8Array(128 * 128);
    this.rgb = PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
    this.sheet = new Uint8Array(128 * 64); // 16x8 sprites of 8x8
    this.flags = new Uint8Array(128);
    this.pal();
    this.camx = this.camy = 0;
    this.fp = 0;
  }

  // sprites: {pixels: [128 x 64 hex chars], flags: [128]}
  loadSprites(s) {
    s.pixels.forEach((hex, n) => {
      const ox = (n % 16) * 8, oy = (n >> 4) * 8;
      for (let i = 0; i < 64; i++) this.sheet[(oy + (i >> 3)) * 128 + ox + (i & 7)] = parseInt(hex[i], 16);
    });
    this.flags.set(s.flags);
  }

  sget(x, y) { return x < 0 || y < 0 || x > 127 || y > 63 ? 0 : this.sheet[y * 128 + x]; }
  fget(n, f) { return ((this.flags[n] || 0) >> f & 1) === 1; }

  // pal() resets; pal(a,b) remaps a->b; pal(arr) maps 1..arr.length
  pal(a, b) {
    if (a === undefined) {
      this.dp = [...Array(16).keys()];
      this.tr = Array(16).fill(false);
      this.tr[0] = true;
    } else if (Array.isArray(a)) a.forEach((c, i) => { this.dp[i + 1] = c; });
    else this.dp[a & 15] = b & 15;
  }

  camera(x = 0, y = 0) { this.camx = x; this.camy = y; }
  fillp(p = 0) { this.fp = p; }
  cls(c = 0) { this.buf.fill(c); this.camera(); }

  pset(x, y, c) {
    x = Math.floor(x - this.camx); y = Math.floor(y - this.camy);
    if (x < 0 || y < 0 || x > 127 || y > 127) return;
    if (this.fp) c = (this.fp >> (15 - ((y & 3) * 4 + (x & 3))) & 1) ? c >> 4 : c;
    this.buf[y * 128 + x] = this.dp[c & 15];
  }

  rectfill(x0, y0, x1, y1, c) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    for (let y = Math.floor(y0); y <= y1; y++)
      for (let x = Math.floor(x0); x <= x1; x++) this.pset(x, y, c);
  }

  rect(x0, y0, x1, y1, c) {
    this.line(x0, y0, x1, y0, c); this.line(x0, y1, x1, y1, c);
    this.line(x0, y0, x0, y1, c); this.line(x1, y0, x1, y1, c);
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 400; i++) {
      this.pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  circfill(cx, cy, r, c) {
    cx = Math.floor(cx); cy = Math.floor(cy); r = Math.floor(r);
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
      for (let x = -w; x <= w; x++) this.pset(cx + x, cy + y, c);
    }
  }

  circ(cx, cy, r, c) {
    cx = Math.floor(cx); cy = Math.floor(cy); r = Math.floor(r);
    let x = r, y = 0, d = 1 - r;
    while (y <= x) {
      for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]])
        this.pset(cx + a, cy + b, c);
      y++;
      if (d < 0) d += 2 * y + 1; else { x--; d += 2 * (y - x) + 1; }
    }
  }

  // sprite sheet blit with scaling and flips (colour 0 transparent)
  sspr(sx, sy, sw, sh, dx, dy, dw = sw, dh = sh, fx = false, fy = false) {
    dx = Math.floor(dx); dy = Math.floor(dy);
    dw = Math.round(dw); dh = Math.round(dh);
    for (let j = 0; j < dh; j++) {
      const ty = sy + Math.floor((fy ? dh - 1 - j : j) * sh / dh);
      for (let i = 0; i < dw; i++) {
        const c = this.sget(sx + Math.floor((fx ? dw - 1 - i : i) * sw / dw), ty);
        if (!this.tr[c]) this.pset(dx + i, dy + j, c);
      }
    }
  }

  spr(n, x, y, w = 1, h = 1, fx = false, fy = false) {
    this.sspr((n % 16) * 8, (n >> 4) * 8, w * 8, h * 8, x, y, w * 8, h * 8, fx, fy);
  }

  // text: 4px per char, scale 2 = PICO-8 "\^w\^t" wide+tall
  print(s, x, y, c, scale = 1) {
    s = String(s).toLowerCase();
    for (const ch of s) {
      const g = FONT[ch] || FONT['?'];
      for (let r = 0; r < 5; r++)
        for (let b = 0; b < 3; b++)
          if (g[r] >> (2 - b) & 1)
            for (let a = 0; a < scale; a++)
              for (let d = 0; d < scale; d++) this.pset(x + b * scale + a, y + r * scale + d, c);
      x += 4 * scale;
    }
    return x;
  }

  flip() {
    const d = this.img.data;
    for (let i = 0; i < 16384; i++) {
      const [r, g, b] = this.rgb[this.buf[i]];
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// PICO-8 maths
export const rnd = n => Array.isArray(n) ? n[Math.floor(Math.random() * n.length)]
  : Math.random() * (n === undefined ? 1 : n);
export const flr = Math.floor;
export const mid = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
export const sgn = v => v < 0 ? -1 : 1;
export const sin = a => -Math.sin(a * Math.PI * 2);
export const cos = a => Math.cos(a * Math.PI * 2);
export const atan2 = (dx, dy) => ((Math.atan2(-dy, dx) / (Math.PI * 2)) % 1 + 1) % 1;
