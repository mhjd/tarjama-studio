import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
import benchmarks

A = "cml-tts/fr/4193_3103_000004-0001_enhanced.wav"
B = "cml-tts/fr/4482_3103_000063-0001_enhanced.wav"


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "voices.sqlite3"
        server.initialize(self.path)
        with server.connect(self.path) as db:
            db.executemany("INSERT INTO voices(path) VALUES (?)", [(A,), (B,)])

    def choose(self, path, decision):
        return server.decide(self.path, {"path": path, "decision": decision,
                                        "revision": server.state(self.path)["revision"]})

    def test_choices_survive_reopening_and_initialization(self):
        self.choose(A, "keep")
        server.initialize(self.path)
        rows = server.state(self.path)["voices"]
        self.assertEqual(rows[0]["decision"], "keep")
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM decisions").fetchone()[0], 1)

    def test_stale_tab_cannot_overwrite_newer_choices(self):
        self.choose(A, "keep")
        with self.assertRaises(server.Conflict):
            server.decide(self.path, {"path": B, "decision": "pass", "revision": 0})
        self.assertIsNone(server.state(self.path)["voices"][1]["decision"])

    def test_undo_restores_prior_decision_without_deleting_history(self):
        self.choose(A, "keep")
        self.choose(A, "pass")
        data = server.decide(self.path, {"revision": 2}, undo=True)
        self.assertEqual(data["voices"][0]["decision"], "keep")
        data = server.decide(self.path, {"revision": 3}, undo=True)
        self.assertIsNone(data["voices"][0]["decision"])
        self.assertFalse(data["can_undo"])
        self.assertEqual(data["revision"], 4)

    def test_invalid_values_do_not_change_database(self):
        for path, decision in [(A, "favorite"), ("../file_enhanced.wav", "keep"),
                               ("cml-tts/fr/1_2_3-4_enhanced.wav", "keep")]:
            with self.assertRaises(ValueError):
                self.choose(path, decision)
        self.assertEqual(server.state(self.path)["revision"], 0)

    def test_catalog_filters_and_refresh_preserves_decisions(self):
        self.choose(A, "keep")
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self):
                return json.dumps([{"type": "file", "path": A}, {"type": "file", "path": B},
                    {"type": "file", "path": A.replace("_enhanced", "")},
                    {"type": "file", "path": A + ".safetensors"},
                    {"type": "file", "path": A.replace("/fr/", "/en/")}]).encode()
        with patch.object(server, "urlopen", return_value=Response()):
            self.assertEqual(server.sync_catalog(self.path), 2)
        data = server.state(self.path)
        self.assertEqual(len(data["voices"]), 2)
        self.assertEqual(data["voices"][0]["decision"], "keep")
        self.assertTrue(all(v["url"].endswith("_enhanced.wav") for v in data["voices"]))

    def test_empty_catalog_never_erases_choices(self):
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'[]'
        with patch.object(server, "urlopen", return_value=Response()):
            with self.assertRaises(ValueError): server.sync_catalog(self.path)
        self.assertEqual(len(server.state(self.path)["voices"]), 2)

    def test_ranking_and_notes_survive_reopen_and_do_not_affect_undo(self):
        self.choose(A,'keep'); self.choose(B,'keep')
        result=server.preferences(self.path,{'paths':[B,A],'revision':2,'order_revision':0},order=True)
        self.assertEqual(result['order_revision'],1)
        server.preferences(self.path,{'path':A,'kind':'clone','note':'Voix posée, très agréable.','note_revision':0})
        server.preferences(self.path,{'path':A,'kind':'reference','note':'Référence courte','note_revision':1})
        server.initialize(self.path)
        result=server.state(self.path)
        kept=sorted(result['voices'],key=lambda v:v['favorite_rank'])
        self.assertEqual([v['path'] for v in kept],[B,A])
        self.assertEqual(result['voices'][0]['clone_note'],'Voix posée, très agréable.')
        self.assertEqual(result['voices'][0]['reference_note'],'Référence courte')
        self.assertEqual(result['revision'],2)
        server.decide(self.path,{'revision':2},undo=True)
        self.assertIsNone(server.state(self.path)['voices'][1]['decision'])

    def test_bad_or_stale_preferences_are_rejected_atomically(self):
        self.choose(A,'keep'); self.choose(B,'keep')
        for paths in ([A,A],[A], [A,'unknown']):
            with self.assertRaises(ValueError):
                server.preferences(self.path,{'paths':paths,'revision':2,'order_revision':0},order=True)
        server.preferences(self.path,{'paths':[B,A],'revision':2,'order_revision':0},order=True)
        with self.assertRaises(server.Conflict):
            server.preferences(self.path,{'paths':[A,B],'revision':2,'order_revision':0},order=True)
        server.preferences(self.path,{'path':A,'kind':'clone','note':'premier','note_revision':0})
        with self.assertRaises(server.Conflict):
            server.preferences(self.path,{'path':A,'kind':'clone','note':'écrasement','note_revision':0})
        for kind,note in [('bad','test'),('clone','x'*2001),('clone',None)]:
            with self.assertRaises(ValueError):
                server.preferences(self.path,{'path':A,'kind':kind,'note':note,'note_revision':1})
        self.assertEqual(server.state(self.path)['voices'][0]['clone_note'],'premier')

    def test_old_schema_migration_preserves_choices(self):
        legacy=Path(self.directory.name)/'old.sqlite3'
        with sqlite3.connect(legacy) as db:
            db.execute('CREATE TABLE voices(path TEXT PRIMARY KEY,decision TEXT,updated_at TEXT,added_at TEXT)')
            db.execute("INSERT INTO voices VALUES (?,'keep',NULL,'old')",(A,))
        server.initialize(legacy); server.initialize(legacy)
        voice=server.state(legacy)['voices'][0]
        self.assertEqual(voice['decision'],'keep')
        self.assertEqual(voice['favorite_rank'],1)
        self.assertEqual(voice['clone_note'],'')


class HTTPTests(StoreTests):
    def setUp(self):
        super().setUp()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.handler(self.path))
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def request(self, route, payload=None, headers=None):
        headers = headers or {}
        if payload is not None:
            headers = {"Content-Type": "application/json", "X-Voice-Audition": "1", **headers}
        body = json.dumps(payload).encode() if payload is not None else None
        return urlopen(Request(self.base + route, data=body, headers=headers), timeout=5)

    def test_confirmed_http_choice_is_durable(self):
        with self.request("/api/decision", {"path": A, "decision": "keep", "revision": 0}) as response:
            self.assertEqual(json.load(response)["revision"], 1)
        self.assertEqual(server.state(self.path)["voices"][0]["decision"], "keep")

    def test_foreign_origin_and_dns_rebinding_are_rejected(self):
        with self.assertRaises(HTTPError) as exc:
            self.request("/api/decision", {"path": A, "decision": "keep", "revision": 0}, {"Origin": "https://evil.example"})
        self.assertEqual(exc.exception.code, 403)
        exc.exception.close()
        with self.assertRaises(HTTPError) as exc:
            self.request("/api/state", headers={"Host": "evil.example"})
        self.assertEqual(exc.exception.code, 403)
        exc.exception.close()
        self.assertEqual(server.state(self.path)["revision"], 0)

    def test_static_allowlist_does_not_expose_database(self):
        for route in ("/voices.sqlite3", "/../../AGENTS.md"):
            with self.assertRaises(HTTPError) as exc: self.request(route)
            self.assertEqual(exc.exception.code, 404)
            exc.exception.close()
        with self.request("/") as response:
            self.assertIn(b"SQLite", response.read())

    def benchmark(self,status="ready"):
        directory=benchmarks.voice_folder(self.path,A)
        directory.mkdir(parents=True)
        audio=directory/"benchmark.m4a"
        audio.write_bytes(b"0123456789abcdef")
        with server.connect(self.path) as db:
            db.execute("INSERT INTO benchmarks(benchmark_id,voice_path,status,total_parts,completed_parts,duration_seconds,audio_bytes) VALUES (?,?,?,10,10,300,16)",
                       (benchmarks.KEY,A,status))
        return "/api/benchmark-audio/" + Path(A).stem + ".m4a"

    def test_benchmarks_do_not_change_choices_or_revision(self):
        self.benchmark()
        with self.request("/api/benchmarks") as response:
            result=json.load(response)
        self.assertEqual(result["voices"][0]["status"],"ready")
        self.assertIsNotNone(result["voices"][0]["url"])
        self.assertEqual(server.state(self.path)["revision"],0)
        self.assertTrue(all(v["decision"] is None for v in server.state(self.path)["voices"]))

    def test_ready_audio_supports_seeking_and_suffix_ranges(self):
        route=self.benchmark()
        with self.request(route,headers={"Range":"bytes=3-7"}) as response:
            self.assertEqual(response.status,206)
            self.assertEqual(response.headers["Content-Range"],"bytes 3-7/16")
            self.assertEqual(response.read(),b"34567")
        with self.request(route,headers={"Range":"bytes=-3"}) as response:
            self.assertEqual(response.read(),b"def")
        with urlopen(Request(self.base+route,method="HEAD"),timeout=5) as response:
            self.assertEqual(response.headers["Content-Length"],"16")
            self.assertEqual(response.read(),b"")

    def test_unfinished_audio_private_files_and_invalid_ranges_are_refused(self):
        route=self.benchmark(status="running")
        with self.assertRaises(HTTPError) as exc: self.request(route)
        self.assertEqual(exc.exception.code,404)
        exc.exception.close()
        with server.connect(self.path) as db:
            db.execute("UPDATE benchmarks SET status='ready'")
        for value in ("bytes=900-","bytes=-0","bytes=7-2","bytes=0-2,5-7"):
            with self.assertRaises(HTTPError) as exc: self.request(route,headers={"Range":value})
            self.assertEqual(exc.exception.code,416)
            exc.exception.close()
        with self.assertRaises(HTTPError) as exc: self.request("/api/benchmark-audio/recipe.json")
        self.assertEqual(exc.exception.code,404)
        exc.exception.close()

    def test_missing_artifact_is_not_advertised_ready(self):
        self.benchmark()
        (benchmarks.voice_folder(self.path,A)/"benchmark.m4a").unlink()
        result=benchmarks.public_state(self.path,server.connect)
        self.assertEqual(result["voices"][0]["status"],"error")
        self.assertIsNone(result["voices"][0]["url"])

    def test_video_range_and_visibility_only_after_completion(self):
        self.benchmark()
        output=benchmarks.voice_folder(self.path,A)/'video-v1'
        output.mkdir(); (output/'audit.mp4').write_bytes(b'0123456789abcdef')
        with server.connect(self.path) as db:
            db.execute("INSERT INTO benchmark_videos(voice_path,status,video_bytes) VALUES (?,'running',16)",(A,))
        route='/api/benchmark-video/'+Path(A).stem+'.mp4'
        with self.assertRaises(HTTPError) as exc: self.request(route)
        self.assertEqual(exc.exception.code,404); exc.exception.close()
        with server.connect(self.path) as db: db.execute("UPDATE benchmark_videos SET status='ready'")
        with self.request(route,headers={'Range':'bytes=3-7'}) as response:
            self.assertEqual(response.headers['Content-Type'],'video/mp4')
            self.assertEqual(response.status,206); self.assertEqual(response.read(),b'34567')
        result=benchmarks.public_state(self.path,server.connect)
        self.assertEqual(result['voices'][0]['video_url'],route)

    def test_http_note_and_order(self):
        self.choose(A,'keep'); self.choose(B,'keep')
        with self.request('/api/order',{'paths':[B,A],'revision':2,'order_revision':0}) as response:
            self.assertEqual(json.load(response)['order_revision'],1)
        with self.request('/api/note',{'path':A,'kind':'clone','note':'Très bonne voix !','note_revision':0}) as response:
            self.assertEqual(json.load(response)['voices'][0]['clone_note'],'Très bonne voix !')
