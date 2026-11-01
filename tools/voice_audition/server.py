"""Local-only French enhanced voice auditions. Python standard library + SQLite."""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
import benchmarks

ROOT = Path(__file__).resolve().parents[2]
STATIC = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "data/workspaces/voice-audition/voices.sqlite3"
CATALOG = "https://huggingface.co/api/models/kyutai/tts-voices/tree/main/cml-tts/fr?limit=1000"
VALID = re.compile(r"cml-tts/fr/[0-9]+_[0-9]+_[0-9]+-[0-9]+_enhanced\.wav\Z")


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS voices (
                path TEXT PRIMARY KEY, decision TEXT CHECK(decision IN ('keep','pass')),
                updated_at TEXT, added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY, path TEXT NOT NULL REFERENCES voices(path),
                previous_decision TEXT, decision TEXT,
                undo_of INTEGER UNIQUE REFERENCES decisions(id),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
        """)
        columns = {r[1] for r in db.execute('PRAGMA table_info(voices)')}
        for name, definition in [('favorite_rank', 'INTEGER'), ('reference_note', "TEXT NOT NULL DEFAULT ''"),
                                 ('clone_note', "TEXT NOT NULL DEFAULT ''"), ('note_revision', 'INTEGER NOT NULL DEFAULT 0')]:
            if name not in columns:
                db.execute(f'ALTER TABLE voices ADD COLUMN {name} {definition}')
        db.execute('CREATE TABLE IF NOT EXISTS selection_order (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)')
        db.execute('INSERT OR IGNORE INTO selection_order VALUES (1,0)')
        for row in db.execute("SELECT path FROM voices WHERE decision='keep' AND favorite_rank IS NULL ORDER BY path").fetchall():
            db.execute('UPDATE voices SET favorite_rank=(SELECT COALESCE(MAX(favorite_rank),0)+1 FROM voices) WHERE path=?', (row[0],))
        benchmarks.initialize(db)


def sync_catalog(path):
    url, paths = CATALOG, set()
    while url:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "huggingface.co" or parsed.path != urlsplit(CATALOG).path:
            raise ValueError("Pagination Hugging Face inattendue.")
        with urlopen(Request(url, headers={"User-Agent": "Tarjama-Voice-Audition/1"}), timeout=30) as response:
            for row in json.load(response):
                name = row.get("path", "")
                if row.get("type") == "file" and VALID.fullmatch(name):
                    paths.add(name)
            link = response.headers.get("Link", "")
            next_link = re.search(r'<([^>]+)>;\s*rel="next"', link)
            url = next_link.group(1) if next_link else None
    if not paths:
        raise ValueError("Aucune voix française enhanced : ancien catalogue conservé.")
    with connect(path) as db:
        db.executemany("INSERT OR IGNORE INTO voices(path) VALUES (?)", [(p,) for p in sorted(paths)])
    return len(paths)


def state(path):
    with connect(path) as db:
        db.execute("BEGIN")
        revision = db.execute("SELECT COALESCE(MAX(id),0) FROM decisions").fetchone()[0]
        voices = [dict(r) for r in db.execute("SELECT path,decision,updated_at,favorite_rank,reference_note,clone_note,note_revision FROM voices ORDER BY path")]
        order_revision = db.execute('SELECT revision FROM selection_order WHERE id=1').fetchone()[0]
        undo = db.execute("SELECT id FROM decisions d WHERE undo_of IS NULL AND NOT EXISTS "
                          "(SELECT 1 FROM decisions u WHERE u.undo_of=d.id) ORDER BY id DESC LIMIT 1").fetchone()
    for voice in voices:
        voice["name"] = Path(voice["path"]).name.removesuffix("_enhanced.wav")
        voice["speaker"] = voice["name"].split("_")[0]
        voice["url"] = "https://huggingface.co/kyutai/tts-voices/resolve/main/" + quote(voice["path"], safe="/")
    return {"voices": voices, "revision": revision, "order_revision": order_revision, "can_undo": bool(undo), "database": str(path)}


class Conflict(Exception):
    pass


def decide(path, payload, undo=False):
    with connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        revision = db.execute("SELECT COALESCE(MAX(id),0) FROM decisions").fetchone()[0]
        if type(payload.get("revision")) is not int or payload["revision"] != revision:
            raise Conflict("Un autre onglet a modifié les choix. La liste a été rechargée.")
        if undo:
            previous = db.execute("SELECT * FROM decisions d WHERE undo_of IS NULL AND NOT EXISTS "
                                  "(SELECT 1 FROM decisions u WHERE u.undo_of=d.id) ORDER BY id DESC LIMIT 1").fetchone()
            if previous is None:
                raise ValueError("Aucun choix à annuler.")
            name, decision, undo_of = previous["path"], previous["previous_decision"], previous["id"]
        else:
            name, decision, undo_of = payload.get("path"), payload.get("decision"), None
            if not isinstance(name, str) or not VALID.fullmatch(name) or decision not in ("keep", "pass"):
                raise ValueError("Choix invalide.")
        current = db.execute("SELECT decision FROM voices WHERE path=?", (name,)).fetchone()
        if current is None:
            raise ValueError("Voix inconnue.")
        if decision == 'keep' and current['decision'] != 'keep':
            db.execute('UPDATE voices SET favorite_rank=(SELECT COALESCE(MAX(favorite_rank),0)+1 FROM voices) WHERE path=?', (name,))
        db.execute("UPDATE voices SET decision=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path=?",
                   (decision, name))
        db.execute("INSERT INTO decisions(path,previous_decision,decision,undo_of) VALUES (?,?,?,?)",
                   (name, current["decision"], decision, undo_of))
    return state(path)


def preferences(path, payload, order=False):
    with connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        if order:
            revision = db.execute('SELECT revision FROM selection_order WHERE id=1').fetchone()[0]
            choices = db.execute('SELECT COALESCE(MAX(id),0) FROM decisions').fetchone()[0]
            if type(payload.get('order_revision')) is not int or payload['order_revision'] != revision or payload.get('revision') != choices:
                raise Conflict('Classement modifié dans un autre onglet. Recharge la page avant de réessayer.')
            paths = payload.get('paths')
            kept = {r[0] for r in db.execute("SELECT path FROM voices WHERE decision='keep'")}
            if not isinstance(paths, list) or not all(isinstance(p,str) for p in paths) or len(paths) != len(kept) or set(paths) != kept:
                raise ValueError('Le classement doit contenir exactement chaque voix sélectionnée une fois.')
            db.executemany('UPDATE voices SET favorite_rank=? WHERE path=?', [(i+1,p) for i,p in enumerate(paths)])
            db.execute('UPDATE selection_order SET revision=revision+1 WHERE id=1')
        else:
            name, kind, note = payload.get('path'), payload.get('kind'), payload.get('note')
            if kind not in ('reference','clone') or not isinstance(note,str) or len(note)>2000:
                raise ValueError('Note invalide (2000 caractères maximum).')
            row = db.execute('SELECT note_revision FROM voices WHERE path=?',(name,)).fetchone()
            if row is None: raise ValueError('Voix inconnue.')
            if type(payload.get('note_revision')) is not int or row[0] != payload['note_revision']:
                raise Conflict('Note modifiée dans un autre onglet. Ton brouillon est conservé ; copie-le avant de recharger.')
            db.execute(f'UPDATE voices SET {kind}_note=?,note_revision=note_revision+1 WHERE path=?',(note,name))
    return state(path)


def handler(database):
    class Handler(BaseHTTPRequestHandler):
        def allowed(self, write=False):
            expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            host = self.headers.get("Host", "")
            if host not in expected:
                self.reply(403, {"error": "Hôte local requis."})
                return False
            if write and (self.headers.get("X-Voice-Audition") != "1" or
                          self.headers.get("Origin", "http://" + host) != "http://" + host):
                self.reply(403, {"error": "Requête locale requise."})
                return False
            return True

        def reply(self, code, value, mime="application/json; charset=utf-8"):
            body = json.dumps(value, ensure_ascii=False).encode() if isinstance(value, dict) else value
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; "
                             "media-src 'self' https:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def audio(self, route, head=False):
            video = route.startswith('/api/benchmark-video/')
            name=route.removeprefix('/api/benchmark-video/' if video else "/api/benchmark-audio/")
            extension = '.mp4' if video else '.m4a'
            voice_path="cml-tts/fr/" + name.removesuffix(extension) + ".wav"
            if not name.endswith(extension) or not VALID.fullmatch(voice_path):
                self.reply(404,{"error":"Audio inconnu."})
                return
            with connect(database) as db:
                row = (db.execute('SELECT status,video_bytes AS audio_bytes FROM benchmark_videos WHERE voice_path=?',(voice_path,)) if video else
                       db.execute("SELECT status,audio_bytes FROM benchmarks WHERE benchmark_id=? AND voice_path=?", (benchmarks.KEY,voice_path))).fetchone()
            path=(benchmarks.voice_folder(database,voice_path)/('video-v1/audit.mp4' if video else "benchmark.m4a")).resolve()
            if not row or row["status"]!="ready" or not path.is_file() or not path.is_relative_to(benchmarks.folder(database).resolve()) or path.stat().st_size!=row["audio_bytes"]:
                self.reply(404,{"error":"Essai non disponible."})
                return
            size=path.stat().st_size
            start,end,code=0,size-1,200
            requested=self.headers.get("Range")
            if requested:
                match=re.fullmatch(r"bytes=(\d*)-(\d*)",requested)
                try:
                    if not match or not any(match.groups()): raise ValueError()
                    a,b=match.groups()
                    if not a:
                        length=int(b)
                        if length<=0: raise ValueError()
                        start=max(0,size-length)
                    else:
                        start=int(a)
                        if b: end=min(size-1,int(b))
                    if not 0<=start<=end<size: raise ValueError()
                except ValueError:
                    self.send_response(416)
                    self.send_header("Content-Range",f"bytes */{size}")
                    self.send_header("Content-Length","0")
                    self.end_headers()
                    return
                code=206
            self.send_response(code)
            self.send_header("Content-Type","video/mp4" if video else "audio/mp4")
            self.send_header("Content-Length",str(end-start+1))
            self.send_header("Accept-Ranges","bytes")
            self.send_header("Cache-Control","private, max-age=3600")
            self.send_header("X-Content-Type-Options","nosniff")
            if code==206: self.send_header("Content-Range",f"bytes {start}-{end}/{size}")
            self.end_headers()
            if not head:
                try:
                    with path.open("rb") as source:
                        source.seek(start)
                        remaining=end-start+1
                        while remaining:
                            chunk=source.read(min(65536,remaining))
                            if not chunk: break
                            self.wfile.write(chunk)
                            remaining-=len(chunk)
                except (BrokenPipeError,ConnectionResetError):
                    pass  # Normal when the listener pauses or seeks.

        def do_HEAD(self):
            if not self.allowed(): return
            route=urlsplit(self.path).path
            if route.startswith(("/api/benchmark-audio/",'/api/benchmark-video/')): self.audio(route,head=True)
            else: self.reply(404,b"")

        def do_GET(self):
            if not self.allowed():
                return
            route = urlsplit(self.path).path
            if route == "/api/state":
                self.reply(200, state(database))
            elif route == "/api/benchmarks":
                self.reply(200,benchmarks.public_state(database,connect))
            elif route.startswith(("/api/benchmark-audio/",'/api/benchmark-video/')):
                self.audio(route)
            elif route in ("/", "/app.js", "/style.css", "/benchmark.css"):
                filename, mime = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                                  "/style.css": ("style.css", "text/css"), "/benchmark.css": ("benchmark.css", "text/css")}[route]
                self.reply(200, (STATIC / filename).read_bytes(), mime + "; charset=utf-8")
            else:
                self.reply(404, {"error": "Page introuvable."})

        def do_POST(self):
            if not self.allowed(write=True):
                return
            try:
                route = urlsplit(self.path).path
                if route not in ("/api/decision", "/api/undo", '/api/order', '/api/note'):
                    self.reply(404, {"error": "Action inconnue."})
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384 or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("Corps JSON requis (16 Ko maximum).")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Objet JSON requis.")
                self.reply(200, preferences(database,payload,order=route=='/api/order') if route in ('/api/order','/api/note') else
                           decide(database, payload, undo=route == "/api/undo"))
            except Conflict as exc:
                self.reply(409, {"error": str(exc)})
            except (ValueError, TypeError, UnicodeError) as exc:
                self.reply(400, {"error": str(exc)})
            except sqlite3.Error:
                self.reply(503, {"error": "Écriture SQLite impossible. Choix non confirmé ; réessayez."})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--sync-only", action="store_true")
    args = parser.parse_args()
    initialize(args.database)
    if args.sync_only or not state(args.database)["voices"]:
        print(f"Catalogue : {sync_catalog(args.database)} voix enhanced.", flush=True)
    if args.sync_only:
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler(args.database))
    print(f"Voix françaises : http://127.0.0.1:{server.server_port}\nSQLite : {args.database}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
