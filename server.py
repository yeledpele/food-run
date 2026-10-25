"""Food Run web server: serves the game/editor and a small JSON API.

  python server.py            -> http://127.0.0.1:8080  (game)
                                 http://127.0.0.1:8080/editor.html

API
  GET    /api/sprites          sprite sheet {size, pixels[128], flags[128]}
  PUT    /api/sprites          replace it
  GET    /api/audio            sfx + music (read-only, imported from the cart)
  GET    /api/levels           [{id, name, order, theme, width, height}] sorted by order
  GET    /api/levels/<id>      one level
  PUT    /api/levels/<id>      create or replace a level
  DELETE /api/levels/<id>      delete a level

Every write keeps the previous file in backups/. Only listens on localhost.
"""
import json
import os
import re
import shutil
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, 'public')
DATA = os.path.join(ROOT, 'data')
LEVELS = os.path.join(DATA, 'levels')
BACKUPS = os.path.join(ROOT, 'backups')
MAX_BODY = 2 * 1024 * 1024
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,39}$')
HEX_RE = re.compile(r'^[0-9a-f]*$')
THEMES = ('city', 'sakura', 'italy', 'paris')


class BadRequest(Exception):
    pass


def backup(path):
    if os.path.exists(path):
        os.makedirs(BACKUPS, exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S')
        shutil.copy2(path, os.path.join(BACKUPS, '%s.%s' % (os.path.basename(path), stamp)))


def write_json(path, obj):
    backup(path)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def check_sprites(s):
    px, fl = s.get('pixels'), s.get('flags')
    if not (isinstance(px, list) and len(px) == 128 and all(
            isinstance(p, str) and len(p) == 64 and HEX_RE.match(p) for p in px)):
        raise BadRequest('pixels must be 128 strings of 64 hex digits')
    if not (isinstance(fl, list) and len(fl) == 128 and all(
            isinstance(f, int) and 0 <= f <= 255 for f in fl)):
        raise BadRequest('flags must be 128 integers 0-255')
    return {'size': 8, 'pixels': px, 'flags': fl}


def check_level(lid, lv):
    w, h = lv.get('width'), lv.get('height')
    if not (isinstance(w, int) and isinstance(h, int) and 16 <= w <= 256 and 16 <= h <= 128):
        raise BadRequest('width must be 16-256 and height 16-128')
    tiles = lv.get('tiles')
    if not (isinstance(tiles, list) and len(tiles) == h and all(
            isinstance(r, str) and len(r) == w * 2 and HEX_RE.match(r) for r in tiles)):
        raise BadRequest('tiles must be %d rows of %d hex chars' % (h, w * 2))
    br = lv.get('bossRoom') or {}

    def pair(v, name):
        if not (isinstance(v, list) and len(v) == 2 and all(isinstance(n, int) for n in v)):
            raise BadRequest(name + ' must be [col,row]')
        return v
    return {
        'id': lid,
        'name': str(lv.get('name') or lid)[:40],
        'order': int(lv.get('order') or 99),
        'theme': lv.get('theme') if lv.get('theme') in THEMES else 'city',
        'width': w, 'height': h,
        'start': pair(lv.get('start', [2, 2]), 'start'),
        'bossRoom': {
            'col': int(br.get('col', max(0, w - 16))),
            'respawn': pair(br.get('respawn', [w - 15, h - 3]), 'bossRoom.respawn'),
            'scrollDown': bool(br.get('scrollDown')),
            'hp': max(1, min(999, int(br.get('hp', 40)))),
            'name': str(br.get('name') or 'boss')[:20],
        },
        'tiles': tiles,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def log_message(self, fmt, *args):
        if '/api/' in self.path:
            sys.stderr.write('%s %s\n' % (self.command, self.path))

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            raise BadRequest('body must be 1 byte - 2 MB of JSON')
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            raise BadRequest('invalid JSON')

    def level_path(self, lid):
        if not ID_RE.match(lid):
            raise BadRequest('level id: lowercase letters, digits and dashes')
        return os.path.join(LEVELS, lid + '.json')

    def api(self):
        path = self.path.split('?')[0].rstrip('/')
        m = re.match(r'^/api/levels/([^/]+)$', path)
        if self.command == 'GET' and path == '/api/sprites':
            return self.send_json(200, json.load(open(os.path.join(DATA, 'sprites.json'))))
        if self.command == 'PUT' and path == '/api/sprites':
            write_json(os.path.join(DATA, 'sprites.json'), check_sprites(self.read_body()))
            return self.send_json(200, {'ok': True})
        if self.command == 'GET' and path == '/api/audio':
            return self.send_json(200, json.load(open(os.path.join(DATA, 'audio.json'))))
        if self.command == 'GET' and path == '/api/levels':
            out = []
            for f in os.listdir(LEVELS):
                if f.endswith('.json'):
                    lv = json.load(open(os.path.join(LEVELS, f)))
                    out.append({k: lv[k] for k in ('id', 'name', 'order', 'theme', 'width', 'height')})
            return self.send_json(200, sorted(out, key=lambda l: (l['order'], l['id'])))
        if m:
            p = self.level_path(m.group(1))
            if self.command == 'GET':
                if not os.path.exists(p):
                    return self.send_json(404, {'error': 'no such level'})
                return self.send_json(200, json.load(open(p)))
            if self.command == 'PUT':
                write_json(p, check_level(m.group(1), self.read_body()))
                return self.send_json(200, {'ok': True})
            if self.command == 'DELETE':
                if os.path.exists(p):
                    backup(p)
                    os.remove(p)
                return self.send_json(200, {'ok': True})
        return self.send_json(404, {'error': 'unknown endpoint'})

    def handle_api(self):
        try:
            self.api()
        except BadRequest as e:
            self.send_json(400, {'error': str(e)})
        except Exception as e:  # keep the server alive, report the problem
            self.send_json(500, {'error': '%s: %s' % (type(e).__name__, e)})

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.handle_api()
        super().do_GET()

    def do_PUT(self):
        self.handle_api()

    def do_DELETE(self):
        self.handle_api()

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    if not os.path.exists(os.path.join(DATA, 'sprites.json')):
        sys.exit('no data yet - run: python tools/import_p8.py ../donutdash.p8')
    os.makedirs(LEVELS, exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print('Food Run: http://127.0.0.1:%d  (editor: /editor.html)' % port)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
