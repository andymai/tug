import importlib.util
import json
import subprocess
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("publish_extension", Path(__file__).with_name("publish-extension.py"))
publish = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish)

ITEM = "publishers/me/items/abc"


def revision(state: str, version: str) -> dict:
    return {"state": state, "distributionChannels": [{"crxVersion": version, "deployPercentage": 100}]}


def never(_: str) -> bool:
    raise AssertionError("the decision needs no diff")


class Decide(unittest.TestCase):
    def test_a_version_in_review_holds_back_the_next(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0"), "submittedItemRevisionStatus": revision("PENDING_REVIEW", "1.1.0")}
        self.assertIn("1.1.0 waits for review", publish.decide(status, "1.2.0", never))

    def test_a_rejected_submission_compares_with_the_published_version(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0"), "submittedItemRevisionStatus": revision("REJECTED", "1.1.0")}
        self.assertIsNone(publish.decide(status, "1.2.0", lambda version: version == "1.0.0"))

    def test_an_item_never_published_gets_the_version(self):
        self.assertIsNone(publish.decide({}, "1.0.0", never))

    def test_the_same_or_an_older_version_stays_out(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.10.0")}
        self.assertIn("has 1.10.0 already", publish.decide(status, "1.10.0", never))
        self.assertIn("has 1.10.0 already", publish.decide(status, "1.9.0", never))

    def test_an_unchanged_extension_stays_out(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0")}
        self.assertIn("the same as 1.0.0", publish.decide(status, "1.1.0", lambda _: False))
        self.assertIsNone(publish.decide(status, "1.1.0", lambda _: True))

    def test_a_taken_down_item_gets_nothing(self):
        self.assertIn("took the item down", publish.decide({"takenDown": True}, "1.0.0", never))


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=root, check=True, capture_output=True)


def commit(root: Path, files: dict[str, str], tag: str) -> None:
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    git(root, "add", "-A")
    git(root, "commit", "-qm", tag)
    git(root, "tag", tag)


class ChangedSince(unittest.TestCase):
    def test_only_the_package_files_count(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            git(root, "init", "-q")
            commit(root, {"apps/extension/src/main.ts": "a", "apps/extension/package.json": "1.0.0", "README.md": "a"}, "v1.0.0")
            commit(root, {"apps/extension/package.json": "1.1.0", "README.md": "b"}, "v1.1.0")
            commit(root, {"brand/png/tug-128.png": "icon"}, "v1.2.0")
            commit(root, {"apps/extension/src/main.ts": "b"}, "v1.3.0")
            self.assertFalse(publish.changed_since(root, "v1.1.0")("1.0.0"))
            self.assertTrue(publish.changed_since(root, "v1.2.0")("1.1.0"))
            self.assertTrue(publish.changed_since(root, "v1.3.0")("1.2.0"))
            self.assertTrue(publish.changed_since(root, "v1.3.0")("0.9.0"))


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def answer(self):
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size) if size else b""
        self.server.seen.append((self.command, self.path, dict(self.headers), body))
        code, reply = self.server.replies.pop(0)
        data = json.dumps(reply).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = answer
    do_POST = answer


def package(folder: Path, manifest: dict) -> Path:
    path = folder / "store.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("main.js", "")
    return path


class Send(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        self.server.seen = []
        self.server.replies = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.store = publish.Store(f"http://127.0.0.1:{self.server.server_port}/", "token", ITEM)
        self.folder = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def test_a_changed_extension_goes_up_and_into_review(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        self.server.replies = [
            (200, {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0")}),
            (200, {"uploadState": "IN_PROGRESS"}),
            (200, {"lastAsyncUploadState": "SUCCEEDED"}),
            (200, {"state": "PENDING_REVIEW", "warningInfo": {"warnings": []}}),
        ]
        said = publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)
        self.assertEqual(said, "Sent 1.1.0 to the store: PENDING_REVIEW.")
        calls = [(method, path) for method, path, _, _ in self.server.seen]
        self.assertEqual(
            calls,
            [
                ("GET", f"/v2/{ITEM}:fetchStatus"),
                ("POST", f"/upload/v2/{ITEM}:upload?uploadType=media"),
                ("GET", f"/v2/{ITEM}:fetchStatus"),
                ("POST", f"/v2/{ITEM}:publish"),
            ],
        )
        _, _, headers, body = self.server.seen[1]
        self.assertEqual(headers["Authorization"], "Bearer token")
        self.assertEqual(headers["Content-Type"], "application/zip")
        self.assertEqual(body, zip_path.read_bytes())

    def test_a_skipped_version_sends_nothing(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        self.server.replies = [(200, {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0")})]
        said = publish.send(self.store, zip_path, "v1.1.0", lambda _: False, pause=0)
        self.assertEqual(said, "Skipped 1.1.0: the extension is the same as 1.0.0, the version in the store.")
        self.assertEqual(len(self.server.seen), 1)

    def test_a_failed_upload_stops_before_review(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        self.server.replies = [(200, {}), (200, {"uploadState": "FAILED"})]
        with self.assertRaisesRegex(SystemExit, "the upload is FAILED"):
            publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)
        self.assertEqual(len(self.server.seen), 2)

    def test_the_store_error_reaches_the_log(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        self.server.replies = [(403, {"error": {"message": "The caller does not have permission"}})]
        with self.assertRaisesRegex(SystemExit, "403 .*does not have permission"):
            publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)

    def test_only_the_store_package_for_the_tag_goes(self):
        folder = Path(self.folder.name)
        with self.assertRaisesRegex(SystemExit, "version 1.0.0"):
            publish.send(self.store, package(folder, {"version": "1.0.0"}), "v1.1.0", never, pause=0)
        with self.assertRaisesRegex(SystemExit, "isn't the store's package"):
            publish.send(self.store, package(folder, {"version": "1.1.0", "key": "k"}), "v1.1.0", never, pause=0)
        self.assertEqual(self.server.seen, [])


if __name__ == "__main__":
    unittest.main()
