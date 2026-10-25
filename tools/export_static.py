"""Build a static copy of the game in _site/ (for GitHub Pages or any static host).

  python tools/export_static.py

Copies public/ and bundles sprites, audio and all levels into _site/data/bundle.json.
The game and editor load that bundle when server.py isn't there (the editor then
runs read-only).
"""
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, '_site')


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, 'public'), OUT)
    # mark the pages as static so they go straight to the bundle (no API probes)
    for page in ('index.html', 'editor.html'):
        p = os.path.join(OUT, page)
        html = open(p, encoding='utf-8').read()
        marker = '<script>window.FOODRUN_STATIC = true</script>\n<script type="module"'
        assert '<script type="module"' in html, page
        open(p, 'w', encoding='utf-8').write(html.replace('<script type="module"', marker, 1))
    lvdir = os.path.join(DATA, 'levels')
    levels = [json.load(open(os.path.join(lvdir, f))) for f in os.listdir(lvdir) if f.endswith('.json')]
    levels.sort(key=lambda l: (l['order'], l['id']))
    bundle = {
        'sprites': json.load(open(os.path.join(DATA, 'sprites.json'))),
        'audio': json.load(open(os.path.join(DATA, 'audio.json'))),
        'levels': levels,
    }
    os.makedirs(os.path.join(OUT, 'data'))
    with open(os.path.join(OUT, 'data', 'bundle.json'), 'w') as f:
        json.dump(bundle, f, separators=(',', ':'))
    open(os.path.join(OUT, '.nojekyll'), 'w').close()   # serve files as-is
    print('built _site/ with %d levels: %s' % (len(levels), ', '.join(l['name'] for l in levels)))


if __name__ == '__main__':
    main()
