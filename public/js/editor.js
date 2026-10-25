// editor.js - sprite + level editor for Food Run. Talks to server.py's /api.
import { PALETTE } from './pico.js';

const $ = id => document.getElementById(id);
const RGB = PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));

// what the game does with special sprite ids
const ROLES = {
  1: 'hero start', 2: 'burger (hops)', 3: 'fries (throws, drops heart)', 4: 'chef (charges)',
  20: 'chef (alt)', 5: 'brick (solid)', 14: 'cracked block (beam breaks it)', 8: 'checkpoint',
  6: 'donut boss (2x2)', 38: 'pudding boss (2x2)', 35: 'maki (rolls)', 36: 'salmon nigiri (hops)',
  37: 'tuna nigiri (throws wasabi)', 13: 'heart (hud)', 17: 'hero firing', 33: 'hero firing 2',
  40: 'meatball (chases, may drop heart)', 42: 'pizza slice (stabs, can\'t be stomped)',
  44: 'gelato boss (2x2)',
};
const STAMP = { 6: [[6, 7], [22, 23]], 38: [[38, 39], [54, 55]], 44: [[44, 45], [60, 61]] };   // 2x2 bosses
const HIDDEN = [7, 22, 23, 39, 54, 55, 41, 43, 45, 60, 61];   // other halves / animation frames
// the in-game palette swap for each theme's bricks
const THEME_PAL = { sakura: { 8: 4, 14: 9 }, italy: { 8: 6, 14: 7, 2: 13 } };
const FLAG_NAMES = ['solid', 'breakable (charged beam)', 'flag 2', 'flag 3', 'flag 4', 'flag 5', 'flag 6', 'flag 7'];

let sprites, sel = 1, color = 7, clip = null;
let levelList = [], level = null, tile = 5, tool = 'paint';
let dirtyS = false, dirtyL = false;

// ------------------------------------------------------------ helpers
// BUNDLE is set when there's no server (online copy): browse only, no saving
let BUNDLE = null;
const READ_ONLY = 'read-only online copy - run server.py locally to edit and save';
async function api(method, url, body) {
  url = url.replace(/^\//, '');                     // relative, so it works under a subpath
  if (BUNDLE) {
    if (method !== 'GET') throw new Error(READ_ONLY);
    if (url === 'api/sprites') return structuredClone(BUNDLE.sprites);
    if (url === 'api/levels')
      return BUNDLE.levels.map(({ id, name, order, theme, width, height }) => ({ id, name, order, theme, width, height }));
    return structuredClone(BUNDLE.levels.find(l => l.id === decodeURIComponent(url.split('/').pop())));
  }
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function status(msg, bad) {
  const s = $('status');
  s.textContent = msg;
  s.className = bad || dirtyS || dirtyL ? 'dirty' : '';
}
const px = (n, i) => parseInt(sprites.pixels[n][i], 16);
function setPx(n, i, c) {
  const s = sprites.pixels[n];
  sprites.pixels[n] = s.slice(0, i) + c.toString(16) + s.slice(i + 1);
}

// sprite sheet as an image (optionally with a theme's brick palette swap)
function sheetCanvas(theme) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d'), img = g.createImageData(128, 64);
  const swap = THEME_PAL[theme] || {};
  for (let n = 0; n < 128; n++) for (let i = 0; i < 64; i++) {
    let v = px(n, i);
    if (n === 5 && swap[v] !== undefined) v = swap[v];
    const x = (n % 16) * 8 + (i & 7), y = (n >> 4) * 8 + (i >> 3), o = (y * 128 + x) * 4;
    const [r, gg, b] = RGB[v];
    img.data.set([r, gg, b, v === 0 ? 0 : 255], o);
  }
  g.putImageData(img, 0, 0);
  return c;
}
const used = n => /[^0]/.test(sprites.pixels[n]);

// ------------------------------------------------------------ sprites tab
function drawSheet() {
  const g = $('sheet').getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  g.drawImage(sheetCanvas(false), 0, 0, 512, 256);
  g.strokeStyle = '#ffffff14';
  for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke(); }
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(0, i * 32); g.lineTo(512, i * 32); g.stroke(); }
  g.strokeStyle = '#ff77a8'; g.lineWidth = 2;
  g.strokeRect((sel % 16) * 32 + 1, (sel >> 4) * 32 + 1, 30, 30);
  g.lineWidth = 1;
}

function drawPix() {
  const g = $('pix').getContext('2d');
  for (let i = 0; i < 64; i++) {
    const v = px(sel, i);
    g.fillStyle = v === 0 ? ((i + (i >> 3)) % 2 ? '#0d0d12' : '#16161d') : PALETTE[v];
    g.fillRect((i & 7) * 40, (i >> 3) * 40, 40, 40);
  }
  g.strokeStyle = '#ffffff10';
  for (let k = 0; k <= 8; k++) {
    g.beginPath(); g.moveTo(k * 40, 0); g.lineTo(k * 40, 320); g.stroke();
    g.beginPath(); g.moveTo(0, k * 40); g.lineTo(320, k * 40); g.stroke();
  }
  const pv = $('preview').getContext('2d');
  pv.imageSmoothingEnabled = false;
  pv.clearRect(0, 0, 64, 64);
  pv.drawImage(sheetCanvas(false), (sel % 16) * 8, (sel >> 4) * 8, 8, 8, 0, 0, 64, 64);
  $('sprno').textContent = sel + (ROLES[sel] ? ' (' + ROLES[sel] + ')' : '');
  $('flags').querySelectorAll('input').forEach((cb, f) => { cb.checked = (sprites.flags[sel] >> f & 1) === 1; });
}

function buildSpriteUi() {
  $('pal').innerHTML = '';
  PALETTE.forEach((c, i) => {
    const d = document.createElement('div');
    d.style.background = c; d.textContent = i;
    d.onclick = () => { color = i; buildSpriteUi(); };
    if (i === color) d.className = 'on';
    $('pal').appendChild(d);
  });
  if (!$('flags').childElementCount)
    FLAG_NAMES.forEach((name, f) => {
      const l = document.createElement('label');
      l.className = 'f';
      l.innerHTML = `<input type="checkbox"> ${f}: ${name}`;
      l.querySelector('input').onchange = e => {
        sprites.flags[sel] = e.target.checked ? sprites.flags[sel] | (1 << f) : sprites.flags[sel] & ~(1 << f);
        touchSprites();
      };
      $('flags').appendChild(l);
    });
  $('legend').innerHTML = Object.entries(ROLES).map(([n, r]) => `<div><b>${n}</b> ${r}</div>`).join('');
}

function touchSprites() { dirtyS = true; status('sprites changed - not saved'); drawSheet(); drawPix(); buildTiles(); drawMap(); }

function pixAt(e) {
  const r = $('pix').getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
  return x >= 0 && y >= 0 && x < 8 && y < 8 ? y * 8 + x : -1;
}
let painting = false;
$('pix').addEventListener('contextmenu', e => e.preventDefault());
$('pix').addEventListener('mousedown', e => {
  const i = pixAt(e);
  if (i < 0) return;
  if (e.button === 2) { color = px(sel, i); buildSpriteUi(); return; }
  painting = true; setPx(sel, i, color); touchSprites();
});
$('pix').addEventListener('mousemove', e => {
  if (!painting) return;
  const i = pixAt(e);
  if (i >= 0 && px(sel, i) !== color) { setPx(sel, i, color); touchSprites(); }
});
addEventListener('mouseup', () => { painting = false; mapPainting = 0; });
$('sheet').addEventListener('click', e => {
  const r = $('sheet').getBoundingClientRect();
  sel = Math.floor((e.clientY - r.top) / r.height * 8) * 16 + Math.floor((e.clientX - r.left) / r.width * 16);
  drawSheet(); drawPix();
});
$('copy').onclick = () => { clip = [sprites.pixels[sel], sprites.flags[sel]]; status('copied sprite ' + sel); };
$('paste').onclick = () => { if (clip) { [sprites.pixels[sel], sprites.flags[sel]] = clip; touchSprites(); } };
$('clear').onclick = () => { sprites.pixels[sel] = '0'.repeat(64); touchSprites(); };
$('fliph').onclick = () => {
  const s = sprites.pixels[sel];
  sprites.pixels[sel] = [...Array(8)].map((_, y) => [...s.slice(y * 8, y * 8 + 8)].reverse().join('')).join('');
  touchSprites();
};
$('flipv').onclick = () => {
  const s = sprites.pixels[sel];
  sprites.pixels[sel] = [...Array(8)].map((_, y) => s.slice((7 - y) * 8, (7 - y) * 8 + 8)).join('');
  touchSprites();
};
$('saveSprites').onclick = async () => {
  try { await api('PUT', '/api/sprites', sprites); dirtyS = false; status('sprites saved'); }
  catch (e) { status('save failed: ' + e.message, true); }
};

// ------------------------------------------------------------ levels tab
const cell = (x, y) => parseInt(level.tiles[y].substr(x * 2, 2), 16);
function setCell(x, y, v) {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return;
  const r = level.tiles[y];
  level.tiles[y] = r.slice(0, x * 2) + v.toString(16).padStart(2, '0') + r.slice(x * 2 + 2);
}

async function loadList(selectId) {
  levelList = await api('GET', '/api/levels');
  $('levels').innerHTML = '';
  levelList.forEach(l => {
    const li = document.createElement('li');
    li.textContent = `${l.order}. ${l.name}  (${l.width}x${l.height}, ${l.theme})`;
    li.onclick = () => openLevel(l.id);
    if (level && l.id === (selectId || level.id)) li.className = 'on';
    $('levels').appendChild(li);
  });
}

async function openLevel(id) {
  if (dirtyL && !confirm('Discard unsaved changes to this level?')) return;
  level = await api('GET', '/api/levels/' + id);
  dirtyL = false;
  fillForm(); buildTiles(); drawMap(); loadList();
  status('editing ' + level.name);
}

function fillForm() {
  const b = level.bossRoom;
  $('f-name').value = level.name; $('f-order').value = level.order; $('f-theme').value = level.theme;
  $('f-w').value = level.width; $('f-h').value = level.height;
  $('f-col').value = b.col; $('f-bname').value = b.name; $('f-hp').value = b.hp;
  $('f-scroll').checked = b.scrollDown;
  $('f-sx').value = level.start[0]; $('f-sy').value = level.start[1];
  $('f-rx').value = b.respawn[0]; $('f-ry').value = b.respawn[1];
}

function readForm() {
  const n = id => parseInt($(id).value, 10) || 0;
  level.name = $('f-name').value; level.order = n('f-order'); level.theme = $('f-theme').value;
  Object.assign(level.bossRoom, { col: n('f-col'), name: $('f-bname').value, hp: Math.max(1, n('f-hp')),
    scrollDown: $('f-scroll').checked, respawn: [n('f-rx'), n('f-ry')] });
  level.start = [n('f-sx'), n('f-sy')];
}
document.querySelectorAll('.form input, .form select').forEach(el =>
  el.addEventListener('change', () => { if (!level || el.id === 'f-w' || el.id === 'f-h') return; readForm(); dirtyL = true; status('level changed - not saved'); drawMap(); }));

$('resize').onclick = () => {
  const w = Math.max(16, Math.min(256, +$('f-w').value)), h = Math.max(16, Math.min(128, +$('f-h').value));
  const old = level.tiles;
  level.tiles = [...Array(h)].map((_, y) => [...Array(w)].map((_, x) =>
    y < old.length && x * 2 < old[0].length ? old[y].substr(x * 2, 2) : '00').join(''));
  level.width = w; level.height = h;
  dirtyL = true; fillForm(); drawMap(); status('resized - not saved');
};

function buildTiles() {
  if (!sprites) return;
  const box = $('tiles');
  box.innerHTML = '';
  const sheet = sheetCanvas(level && level.theme);
  const ids = [0];
  for (let n = 1; n < 128; n++) if (used(n) && !HIDDEN.includes(n)) ids.push(n);
  ids.forEach(n => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (n === 0) { g.strokeStyle = '#ff004d'; g.beginPath(); g.moveTo(6, 6); g.lineTo(26, 26); g.moveTo(26, 6); g.lineTo(6, 26); g.stroke(); }
    else if (STAMP[n]) g.drawImage(sheet, (n % 16) * 8, (n >> 4) * 8, 16, 16, 0, 0, 32, 32);
    else g.drawImage(sheet, (n % 16) * 8, (n >> 4) * 8, 8, 8, 0, 0, 32, 32);
    c.title = n === 0 ? 'eraser' : n + ': ' + (ROLES[n] || 'decoration' + (sprites.flags[n] & 1 ? ' (solid)' : ''));
    if (n === tile) c.className = 'on';
    c.onclick = () => { tile = n; setTool('paint'); buildTiles(); };
    box.appendChild(c);
  });
  $('tileinfo').textContent = tile === 0 ? 'eraser' : `tile ${tile}: ${ROLES[tile] || 'decoration'}`;
}

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
}
document.querySelectorAll('.tool').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });

function drawMap() {
  if (!level || !sprites) return;
  const z = +$('zoom').value * 8, c = $('map');
  c.width = level.width * z; c.height = level.height * z;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = { sakura: '#1a0d1e', italy: '#14183a' }[level.theme] || '#05050a';
  g.fillRect(0, 0, c.width, c.height);
  const sheet = sheetCanvas(level.theme);
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
    const v = cell(x, y);
    if (v) g.drawImage(sheet, (v % 16) * 8, (v >> 4) * 8, 8, 8, x * z, y * z, z, z);
  }
  if ($('grid').checked) {
    g.strokeStyle = '#ffffff12';
    for (let x = 0; x <= level.width; x++) { g.beginPath(); g.moveTo(x * z, 0); g.lineTo(x * z, c.height); g.stroke(); }
    for (let y = 0; y <= level.height; y++) { g.beginPath(); g.moveTo(0, y * z); g.lineTo(c.width, y * z); g.stroke(); }
  }
  // boss room (16 tiles wide), start and respawn markers
  const b = level.bossRoom;
  g.fillStyle = '#ff77a814'; g.fillRect(b.col * z, 0, 16 * z, c.height);
  g.strokeStyle = '#ff77a8'; g.setLineDash([6, 4]); g.strokeRect(b.col * z + 0.5, 0.5, 16 * z - 1, c.height - 1);
  g.setLineDash([]);
  const mark = ([x, y], col, label) => {
    g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x * z + 1, y * z + 1, z - 2, z - 2); g.lineWidth = 1;
    g.fillStyle = col; g.font = '10px sans-serif'; g.fillText(label, x * z, y * z - 2);
  };
  mark(level.start, '#29adff', 'start');
  mark(b.respawn, '#ffec27', 'respawn');
  runChecks();
}

function runChecks() {
  const out = [];
  let hero = 0, boss = 0;
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
    const v = cell(x, y);
    if (v === 1) hero++;
    if (v === 6 || v === 38) boss++;
  }
  const b = level.bossRoom;
  out.push([hero <= 1, hero ? 'hero start sprite placed' : 'no hero sprite: uses the "start" setting']);
  if (hero > 1) out.push([false, `${hero} hero start sprites - the last one wins`]);
  out.push([boss === 1, boss ? (boss > 1 ? 'more than one boss placed' : 'boss placed') : 'no boss: the level can\'t be finished']);
  out.push([b.col >= 0 && b.col + 16 <= level.width, 'boss room fits in the map (col ' + b.col + '-' + (b.col + 15) + ')']);
  out.push([b.respawn[0] >= b.col && b.respawn[0] < b.col + 16, 'respawn point is inside the boss room']);
  $('checks').innerHTML = out.map(([ok, m]) => `<li class="${ok ? 'okc' : 'badc'}">${ok ? '✓' : '✗'} ${m}</li>`).join('');
}

let mapPainting = 0;
function mapCell(e) {
  const r = $('map').getBoundingClientRect(), z = r.width / level.width;
  return [Math.floor((e.clientX - r.left) / z), Math.floor((e.clientY - r.top) / z)];
}
function paintAt(x, y, erase) {
  if (tool === 'start') { level.start = [x, y]; }
  else if (tool === 'respawn') { level.bossRoom.respawn = [x, y]; }
  else if (tool === 'room') { level.bossRoom.col = x; }
  else if (erase || tile === 0) setCell(x, y, 0);
  else if (STAMP[tile]) STAMP[tile].forEach((row, dy) => row.forEach((v, dx) => setCell(x + dx, y + dy, v)));
  else setCell(x, y, tile);
  dirtyL = true; fillForm(); drawMap(); status('level changed - not saved');
}
$('map').addEventListener('contextmenu', e => e.preventDefault());
$('map').addEventListener('mousedown', e => {
  const [x, y] = mapCell(e);
  mapPainting = e.button === 2 ? 2 : 1;
  paintAt(x, y, mapPainting === 2);
  if (tool !== 'paint') mapPainting = 0;
});
$('map').addEventListener('mousemove', e => {
  const [x, y] = mapCell(e);
  const v = level && x < level.width && y < level.height ? cell(x, y) : 0;
  $('hover').textContent = `col ${x}, row ${y}` + (v ? ` - tile ${v}${ROLES[v] ? ' (' + ROLES[v] + ')' : ''}` : '');
  if (mapPainting && (mapPainting === 2 ? cell(x, y) !== 0 : cell(x, y) !== tile)) paintAt(x, y, mapPainting === 2);
});
$('zoom').onchange = drawMap;
$('grid').onchange = drawMap;

async function saveLevel() {
  readForm();
  await api('PUT', '/api/levels/' + level.id, level);
  dirtyL = false; status('saved ' + level.name);
  await loadList();
}
$('saveLevel').onclick = () => saveLevel().catch(e => status('save failed: ' + e.message, true));
$('playLevel').onclick = async () => {
  try {
    if (dirtyS) { await api('PUT', '/api/sprites', sprites); dirtyS = false; }
    await saveLevel();
    window.open('./?level=' + encodeURIComponent(level.id), 'foodrun');
  } catch (e) { status('save failed: ' + e.message, true); }
};

function blankLevel(id, name) {
  const w = 64, h = 16, rows = [];
  for (let y = 0; y < h; y++) rows.push((y >= 13 ? '05' : '00').repeat(w));
  return { id, name, order: levelList.length + 1, theme: 'city', width: w, height: h, start: [2, 12],
    bossRoom: { col: w - 16, respawn: [w - 14, 12], scrollDown: false, hp: 40, name: 'the donut' }, tiles: rows };
}
function askId(def) {
  const id = (prompt('Level id (lowercase letters, digits, dashes):', def) || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) { if (id) alert('Invalid id'); return null; }
  if (levelList.some(l => l.id === id)) { alert('That id already exists'); return null; }
  return id;
}
$('newLevel').onclick = async () => {
  const id = askId('stage-' + (levelList.length + 1));
  if (!id) return;
  await api('PUT', '/api/levels/' + id, blankLevel(id, 'New Stage'));
  dirtyL = false; await loadList(id); await openLevel(id);
};
$('dupLevel').onclick = async () => {
  if (!level) return;
  const id = askId(level.id + '-copy');
  if (!id) return;
  readForm();
  await api('PUT', '/api/levels/' + id, { ...level, id, name: level.name + ' copy', order: levelList.length + 1 });
  dirtyL = false; await loadList(id); await openLevel(id);
};
$('delLevel').onclick = async () => {
  if (!level || !confirm(`Delete level "${level.name}"? (a backup is kept on the server)`)) return;
  await api('DELETE', '/api/levels/' + level.id);
  dirtyL = false; level = null;
  await loadList();
  if (levelList.length) openLevel(levelList[0].id);
};

// ------------------------------------------------------------ tabs + boot
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
    $('tab-sprites').classList.toggle('hidden', b.dataset.tab !== 'sprites');
    $('tab-levels').classList.toggle('hidden', b.dataset.tab !== 'levels');
    if (b.dataset.tab === 'levels') { buildTiles(); drawMap(); }
  };
});
addEventListener('beforeunload', e => { if (dirtyS || dirtyL) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try {
    try {
      if (window.FOODRUN_STATIC) throw new Error('static copy');
      sprites = await api('GET', '/api/sprites');
    } catch (e) {
      // no server: fall back to the static bundle (browse only)
      BUNDLE = await fetch('data/bundle.json').then(r => { if (!r.ok) throw e; return r.json(); });
      sprites = await api('GET', '/api/sprites');
    }
    buildSpriteUi(); drawSheet(); drawPix();
    await loadList();
    if (levelList.length) await openLevel(levelList[0].id);
    status(BUNDLE ? READ_ONLY : 'ready', !!BUNDLE);
  } catch (e) { status('could not reach the server: ' + e.message, true); }
})();
