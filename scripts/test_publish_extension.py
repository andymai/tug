import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

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
        skip = publish.decide(status, "1.2.0", never)
        self.assertIn("1.1.0 waits for review", skip.reason)
        self.assertTrue(skip.held)

    def test_a_staged_version_waits_for_a_person(self):
        status = {"submittedItemRevisionStatus": revision("STAGED", "1.1.0")}
        skip = publish.decide(status, "1.2.0", never)
        self.assertIn("1.1.0 waits for someone to publish it", skip.reason)
        self.assertTrue(skip.held)

    def test_a_rejected_submission_compares_with_the_published_version(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0"), "submittedItemRevisionStatus": revision("REJECTED", "1.1.0")}
        self.assertIsNone(publish.decide(status, "1.2.0", lambda version: version == "1.0.0"))

    def test_an_item_never_published_gets_the_version(self):
        self.assertIsNone(publish.decide({}, "1.0.0", never))

    def test_the_same_or_an_older_version_stays_out(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.10.0")}
        self.assertEqual(publish.decide(status, "1.10.0", never), publish.Skip("the store has 1.10.0 already"))
        self.assertEqual(publish.decide(status, "1.9.0", never), publish.Skip("the store has 1.10.0 already"))

    def test_an_unchanged_extension_stays_out_quietly(self):
        status = {"publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0")}
        skip = publish.decide(status, "1.1.0", lambda _: False)
        self.assertIn("the same as 1.0.0", skip.reason)
        self.assertFalse(skip.held)
        self.assertIsNone(publish.decide(status, "1.1.0", lambda _: True))

    def test_a_taken_down_item_gets_nothing(self):
        self.assertIn("took the item down", publish.decide({"takenDown": True}, "1.0.0", never).reason)


def package(folder: Path, manifest: dict, files: dict[str, str] | None = None, name: str = "store.zip") -> Path:
    path = folder / name
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for file, text in (files or {"main.js": ""}).items():
            archive.writestr(file, text)
    return path


class ChangedFrom(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.asked = []

    def tearDown(self):
        self.folder.cleanup()

    def changed(self, new: Path, old: Path | None) -> bool:
        def fetch(tag: str, path: Path) -> bool:
            self.asked.append(tag)
            if old is None:
                return False
            path.write_bytes(old.read_bytes())
            return True

        return publish.changed_from(new, fetch)("1.0.0")

    def test_only_the_version_moved(self):
        old = package(self.root, {"name": "Tug", "version": "1.0.0"}, {"main.js": "a", "icons/16.png": "i"}, "old.zip")
        new = package(self.root, {"version": "1.1.0", "name": "Tug"}, {"icons/16.png": "i", "main.js": "a"})
        self.assertFalse(self.changed(new, old))
        self.assertEqual(self.asked, ["v1.0.0"])

    def test_a_changed_file_or_manifest_counts(self):
        old = package(self.root, {"name": "Tug", "version": "1.0.0"}, {"main.js": "a"}, "old.zip")
        self.assertTrue(self.changed(package(self.root, {"name": "Tug", "version": "1.1.0"}, {"main.js": "b"}), old))
        self.assertTrue(self.changed(package(self.root, {"name": "Tug 2", "version": "1.1.0"}, {"main.js": "a"}), old))
        self.assertTrue(self.changed(package(self.root, {"name": "Tug", "version": "1.1.0"}, {"main.js": "a", "x.js": ""}), old))

    def test_a_release_without_the_package_counts_as_changed(self):
        self.assertTrue(self.changed(package(self.root, {"version": "1.1.0"}), None))


FAKE_GH = """#!/usr/bin/env python3
import os, sys
from pathlib import Path
mode = os.environ["FAKE_GH"]
args = sys.argv[1:]
if args[:2] == ["release", "view"]:
    if mode == "no release":
        sys.exit("release not found")
    if mode == "denied":
        sys.exit("HTTP 401: Bad credentials")
    print("tug-extension-chromium.zip")
    if mode != "no asset":
        print("tug-extension-chrome-web-store.zip")
elif args[:2] == ["release", "download"]:
    if mode == "broken download":
        sys.exit("connection reset")
    folder = Path(args[args.index("--dir") + 1])
    (folder / "tug-extension-chrome-web-store.zip").write_bytes(b"zip")
"""


class ReleaseAsset(unittest.TestCase):
    def fetch(self, mode: str) -> tuple[bool, Path]:
        with tempfile.TemporaryDirectory() as tools, tempfile.TemporaryDirectory() as folder:
            fake = Path(tools) / "gh"
            fake.write_text(FAKE_GH)
            fake.chmod(0o755)
            path = Path(folder) / publish.ASSET
            with mock.patch.dict(os.environ, {"PATH": f"{tools}{os.pathsep}{os.environ['PATH']}", "FAKE_GH": mode}):
                return publish.release_asset("v1.0.0", path), path.is_file()

    def test_the_release_package_comes_down(self):
        self.assertEqual(self.fetch("ok"), (True, True))

    def test_a_release_or_an_asset_that_isnt_there_is_no_package(self):
        self.assertEqual(self.fetch("no release"), (False, False))
        self.assertEqual(self.fetch("no asset"), (False, False))

    def test_any_other_error_stops_the_job(self):
        with self.assertRaisesRegex(SystemExit, "couldn't read the release v1.0.0: HTTP 401"):
            self.fetch("denied")
        with self.assertRaisesRegex(SystemExit, "couldn't download .* from v1.0.0: connection reset"):
            self.fetch("broken download")


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
        self.assertEqual(said, ("notice", "Sent 1.1.0 to the store: PENDING_REVIEW."))
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
        self.assertEqual(said, ("notice", "Skipped 1.1.0: the extension is the same as 1.0.0, the version in the store."))
        self.assertEqual(len(self.server.seen), 1)

    def test_a_held_version_is_a_warning(self):
        zip_path = package(Path(self.folder.name), {"version": "1.2.0"})
        self.server.replies = [(200, {"submittedItemRevisionStatus": revision("PENDING_REVIEW", "1.1.0")})]
        level, said = publish.send(self.store, zip_path, "v1.2.0", never, pause=0)
        self.assertEqual(level, "warning")
        self.assertIn("1.1.0 waits for review", said)
        self.assertEqual(len(self.server.seen), 1)

    def test_a_review_that_the_status_misses_is_a_warning(self):
        # The store's answer to an upload while its first version waited for review.
        zip_path = package(Path(self.folder.name), {"version": "0.42.0"})
        refused = {
            "error": {
                "code": 400,
                "message": "You may not edit or publish an item that is in review.",
                "status": "FAILED_PRECONDITION",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        "reason": "NOT_UPDATEABLE",
                        "domain": "chromewebstore.googleapis.com",
                    }
                ],
            }
        }
        self.server.replies = [(200, {}), (400, refused)]
        level, said = publish.send(self.store, zip_path, "v0.42.0", lambda _: True, pause=0)
        self.assertEqual(level, "warning")
        self.assertEqual(
            said,
            "Skipped 0.42.0: You may not edit or publish an item that is in review, "
            "so a release after it sends the newest version.",
        )
        self.assertEqual(len(self.server.seen), 2)

    def test_a_refusal_at_publish_stops_the_job_with_its_message(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        refused = {"error": {"code": 400, "message": "in review", "details": [{"reason": "NOT_UPDATEABLE"}]}}
        self.server.replies = [(200, {}), (200, {"uploadState": "SUCCEEDED"}), (400, refused)]
        with self.assertRaisesRegex(SystemExit, f"POST /v2/{ITEM}:publish: 400 .*NOT_UPDATEABLE"):
            publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)

    def test_an_error_body_of_any_shape_stops_the_job_with_its_message(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        for body in ({"error": "invalid_request"}, {"error": {"details": "x"}}, ["not", "an", "object"]):
            self.server.replies = [(200, {}), (400, body)]
            with self.assertRaisesRegex(SystemExit, "upload\\?uploadType=media: 400 "):
                publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)

    def test_another_refusal_still_stops_the_job(self):
        zip_path = package(Path(self.folder.name), {"version": "1.1.0"})
        refused = {"error": {"code": 400, "details": [{"reason": "INVALID_PACKAGE"}]}}
        self.server.replies = [(200, {}), (400, refused)]
        with self.assertRaisesRegex(SystemExit, "400 .*INVALID_PACKAGE"):
            publish.send(self.store, zip_path, "v1.1.0", lambda _: True, pause=0)

    def test_the_log_shows_the_store_state(self):
        zip_path = package(Path(self.folder.name), {"version": "1.2.0"})
        self.server.replies = [
            (
                200,
                {
                    "submittedItemRevisionStatus": revision("PENDING_REVIEW", "1.1.0"),
                    "publishedItemRevisionStatus": revision("PUBLISHED", "1.0.0"),
                },
            )
        ]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            publish.send(self.store, zip_path, "v1.2.0", never, pause=0)
        self.assertIn("The store's item: submitted PENDING_REVIEW 1.1.0, published PUBLISHED 1.0.0", out.getvalue())

    def test_the_log_leaves_out_a_version_that_the_store_doesnt_give(self):
        said = publish.describe({"submittedItemRevisionStatus": {"state": "PENDING_REVIEW"}})
        self.assertEqual(said, "submitted PENDING_REVIEW, published none")

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
        with self.assertRaisesRegex(SystemExit, "has version 1.0.0, not the version of v1.1.0"):
            publish.send(self.store, package(folder, {"version": "1.0.0"}), "v1.1.0", never, pause=0)
        with self.assertRaisesRegex(SystemExit, "carries a key"):
            publish.send(self.store, package(folder, {"version": "1.1.0", "key": "k"}), "v1.1.0", never, pause=0)
        self.assertEqual(self.server.seen, [])


if __name__ == "__main__":
    unittest.main()
