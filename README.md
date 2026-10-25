# Food Run (web)

Browser version of the PICO-8 game `donutdash.p8`, plus an editor for sprites and levels.
No installs needed: plain HTML/JS in the browser, Python 3 standard library on the server.

**Play online:** https://yeledpele.github.io/food-run/

## Online version

Every push to `main` runs `.github/workflows/pages.yml`, which builds a static copy with
`python tools/export_static.py` (all sprites, sounds and levels in `_site/data/bundle.json`) and
publishes it to GitHub Pages. Without the server the editor opens read-only; to change things,
run it locally, save, then commit and push the `data/` folder.

## Run

```
python server.py
```

- Game: http://127.0.0.1:8080
- Editor: http://127.0.0.1:8080/editor.html

Controls: arrows move, Z (or C/N/Space) jump, X (or V/M) laser. Hold X to charge a beam that
pierces enemies and breaks cracked blocks. Hold DOWN (~0.25s) to raise a shield: it blocks all
hits while held, slows you and stops shooting, and drains the energy line under the health bar
(empty = broken until it recharges to half). The title screen has START and OPTIONS (up/down,
Z): OPTIONS picks the starting stage and turns sound on/off (sound is remembered).

Four stages: Donut City (donut), Sakura (pudding that splits), Bella Italia (gelato) and Paris
Patisserie (a three-tier cake that loses its top tier at half health). Checkpoints heal you to
full, and every boss drops one heart at half health.
Add `&debug` to the URL to get `window.FR` (boss, player, state) in the console.

## Layout

| Path | What |
|---|---|
| `server.py` | static files + JSON API (`/api/sprites`, `/api/levels[/<id>]`, `/api/audio`); localhost only; every save backs up the old file to `backups/` |
| `public/js/pico.js` | 128x128 PICO-8-style screen: palette, `pal`, `spr/sspr`, shapes, 3x5 font |
| `public/js/audio.js` | WebAudio player for the cart's sfx and music patterns |
| `public/js/game.js` | the game (port of the cart's Lua) |
| `public/js/editor.js` | sprite editor (pixels + flags) and level editor (paint, bosses, settings, checks, play-test) |
| `data/sprites.json` | 128 sprites as 64 hex digits each + flags (bit 0 solid, bit 1 breakable) |
| `data/levels/*.json` | one file per level; `tiles` = rows of 2 hex digits per cell |
| `data/audio.json` | sfx + music imported from the cart (read-only in the editor) |
| `tools/import_p8.py` | re-imports everything from a `.p8` cart |

## Level format

```json
{ "id": "donut-city", "name": "Donut City", "order": 1, "theme": "city|sakura|italy|paris",
  "width": 80, "height": 39, "start": [2, 7],
  "bossRoom": { "col": 64, "respawn": [65, 13], "scrollDown": true, "hp": 40, "name": "the donut" },
  "tiles": ["0000...", "..."] }
```

Special tiles become things when the level loads: 1 hero start, 2 burger, 3 fries, 4/20 chef,
35 maki, 36 salmon, 37 tuna, 40 meatball, 42 pizza slice (can't be stomped), 48 croissant
(flies, swoops), 50 macaron (hops), 8 checkpoint, 6 donut boss, 38 pudding boss, 44 gelato boss,
46 cake boss (the 2x2 bosses are stamped by the editor).
Themes: `city`, `sakura` (wood bricks, petals, music 2), `italy` (marble bricks, music 4),
`paris` (cobblestones, waltz music 6). An sfx may have `len` (e.g. 24 for 3/4 time). Any sprite with flag 0 is solid; flag 1 makes it breakable by the beam.
The boss room is 16 tiles wide starting at `bossRoom.col`; walking into it starts the fight.

## Re-importing from PICO-8

```
python tools/import_p8.py ../donutdash.p8 --force
```

This overwrites `data/` with the cart's current sprites, map and sounds (the old data is copied
to `backups/` first), so edits made in the web editor are replaced.
