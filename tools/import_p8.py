"""Import sprites, flags, levels, sfx and music from a PICO-8 cart into data/*.json.

Usage:
  python tools/import_p8.py ../donutdash.p8           # refuses to overwrite existing data
  python tools/import_p8.py ../donutdash.p8 --force   # overwrite (backs up the old data first)

Levels come from the cart's `levels={...}` table (map area, boss room, respawn, start),
so the web version uses the same stage boundaries as the PICO-8 game.
"""
import json
import os
import re
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')


def sections(text):
    out, cur = {}, None
    for line in text.split('\n'):
        m = re.match(r'^__(\w+)__$', line)
        if m:
            cur = m.group(1)
            out[cur] = []
        elif cur:
            out[cur].append(line)
    return out


def read_sprites(gfx, gff):
    rows = [r.ljust(128, '0')[:128] for r in gfx if r] + ['0' * 128] * 128
    sprites = []
    for n in range(128):  # sprites 128+ share memory with map rows 32+
        ox, oy = (n % 16) * 8, (n // 16) * 8
        sprites.append(''.join(rows[oy + y][ox:ox + 8] for y in range(8)))
    ff = ''.join(gff).ljust(512, '0')
    flags = [int(ff[i * 2:i * 2 + 2], 16) for i in range(128)]
    return {'size': 8, 'pixels': sprites, 'flags': flags}


def read_map(mp, gfx):
    rows = [r.ljust(256, '0') for r in mp if r][:32]
    while len(rows) < 32:
        rows.append('0' * 256)
    cells = [[int(r[x * 2:x * 2 + 2], 16) for x in range(128)] for r in rows]
    g = [r.ljust(128, '0')[:128] for r in gfx if r] + ['0' * 128] * 128
    for my in range(32, 64):  # rows 32+ live in gfx rows 64+, low nibble first
        s = g[64 + (my - 32) * 2] + g[65 + (my - 32) * 2]
        cells.append([int(s[2 * x + 1], 16) * 16 + int(s[2 * x], 16) for x in range(128)])
    return cells


def read_levels(lua):
    body = re.search(r'levels=\{(.*?)\n\}', lua, re.S)
    if not body:
        raise SystemExit('could not find levels={...} in the cart code')
    levels = []
    for i, ent in enumerate(re.findall(r'\{(.*?)\}', body.group(1), re.S)):
        kv = dict(re.findall(r'(\w+)=("[^"]*"|[\w.]+)', ent))
        num = lambda k, d=0: int(kv[k]) if k in kv else d
        levels.append({
            'mx': num('mx'), 'my': num('my'), 'mw': num('mw'), 'mh': num('mh'),
            'ax': num('ax'), 'acx': num('acx'), 'acy': num('acy'),
            # the cart's pudding ignores bhp and always totals 24+2*12+4*6 = 72
            'bhp': 72 if kv.get('bs') == '38' else num('bhp', 40),
            'sx': num('sx', 16), 'sy': num('sy', 56),
            'boss': kv.get('name', '"boss"').strip('"'),
            'jp': kv.get('jp') == 'true', 'vert': kv.get('vert') == 'true',
        })
    return levels


def read_audio(sfx, music):
    out = {'sfx': [], 'music': []}
    for line in sfx:
        if not line:
            continue
        notes = []
        for i in range(32):
            n = line[8 + i * 5: 13 + i * 5].ljust(5, '0')
            notes.append([int(n[0:2], 16), int(n[2], 16), int(n[3], 16), int(n[4], 16)])
        out['sfx'].append({'speed': int(line[2:4], 16), 'loop': [int(line[4:6], 16), int(line[6:8], 16)],
                           'notes': notes})
    for line in music:
        if not line.strip():
            continue
        flags, ch = line.split()
        ids = [int(ch[i * 2:i * 2 + 2], 16) for i in range(4)]
        out['music'].append({'flags': int(flags, 16),
                             'channels': [None if v & 0x40 else v & 0x3f for v in ids]})
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cart, force = sys.argv[1], '--force' in sys.argv
    if os.path.exists(os.path.join(DATA, 'sprites.json')) and not force:
        sys.exit('data/ already has content - rerun with --force to overwrite (a backup is kept)')
    if os.path.exists(DATA) and force:
        bak = os.path.join(ROOT, 'backups', 'import-' + time.strftime('%Y%m%d-%H%M%S'))
        shutil.copytree(DATA, bak)
        print('backed up old data to', bak)

    s = sections(open(cart, encoding='utf-8').read())
    lua = '\n'.join(s.get('lua', []))
    os.makedirs(os.path.join(DATA, 'levels'), exist_ok=True)

    sprites = read_sprites(s.get('gfx', []), s.get('gff', []))
    json.dump(sprites, open(os.path.join(DATA, 'sprites.json'), 'w'), indent=1)

    cells = read_map(s.get('map', []), s.get('gfx', []))
    names = ['donut-city', 'sakura']
    titles = ['Donut City', 'Sakura']
    for i, lv in enumerate(read_levels(lua)):
        tiles = ['' .join('%02x' % cells[lv['my'] + y][lv['mx'] + x] for x in range(lv['mw']))
                 for y in range(lv['mh'])]
        top, left = lv['my'] * 8, lv['mx'] * 8
        lid = names[i] if i < len(names) else 'stage-%d' % (i + 1)
        level = {
            'id': lid, 'name': titles[i] if i < len(titles) else 'Stage %d' % (i + 1), 'order': i + 1,
            'theme': 'sakura' if lv['jp'] else 'city',
            'width': lv['mw'], 'height': lv['mh'],
            # positions are in tiles, relative to this level's top-left
            'start': [(lv['sx'] - left) // 8, (lv['sy'] - top) // 8],
            'bossRoom': {'col': (lv['ax'] - left) // 8,
                         'respawn': [(lv['acx'] - left) // 8, (lv['acy'] - top) // 8],
                         'scrollDown': lv['vert'], 'hp': lv['bhp'], 'name': lv['boss']},
            'tiles': tiles,
        }
        json.dump(level, open(os.path.join(DATA, 'levels', lid + '.json'), 'w'), indent=1)
        print('level %-12s %3dx%-3d boss room at col %d' % (lid, lv['mw'], lv['mh'], level['bossRoom']['col']))

    audio = read_audio(s.get('sfx', []), s.get('music', []))
    json.dump(audio, open(os.path.join(DATA, 'audio.json'), 'w'))
    print('sprites: %d, sfx: %d, music patterns: %d' % (
        sum(1 for p in sprites['pixels'] if set(p) != {'0'}), len(audio['sfx']), len(audio['music'])))


if __name__ == '__main__':
    main()
