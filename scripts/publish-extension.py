#!/usr/bin/env python3
"""Sends a release's extension package to the Chrome Web Store and submits it for review.

Every release moves the extension's version, but most releases don't change the extension,
and each submission waits for the store's review. So a version goes to the store only when the
files that make the package changed since the store's version, and never while another
version waits for review.

Usage: publish-extension.py PACKAGE.zip TAG, with CWS_TOKEN (an access token with the
chromewebstore scope) and CWS_ITEM (publishers/PUBLISHER_ID/items/ITEM_ID) in the environment."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# What apps/extension/scripts/build.ts reads to make the package.
PACKAGE = [
    "apps/extension/src",
    "apps/extension/scripts/build.ts",
    "apps/extension/tsconfig.build.json",
    *(f"brand/png/tug-{size}.png" for size in (16, 32, 48, 128)),
]
WAITING = {"PENDING_REVIEW", "STAGED"}
UPLOAD_WAIT_S = 600


def parse(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def version_of(revision: dict) -> str | None:
    channels = revision.get("distributionChannels") or []
    return channels[0].get("crxVersion") if channels else None


def decide(status: dict, version: str, changed: Callable[[str], bool]) -> str | None:
    """Why this version stays out of the store, or None when it goes."""
    if status.get("takenDown"):
        return "the store took the item down; see the Developer Dashboard"
    submitted = status.get("submittedItemRevisionStatus") or {}
    if submitted.get("state") in WAITING:
        return (
            f"{version_of(submitted)} waits for review in the store, "
            "so a release after the review sends the newest version"
        )
    published = version_of(status.get("publishedItemRevisionStatus") or {})
    if published is None:
        return None
    if parse(published) >= parse(version):
        return f"the store has {published} already"
    if not changed(published):
        return f"the extension is the same as {published}, the version in the store"
    return None


def changed_since(root: Path, tag: str) -> Callable[[str], bool]:
    def changed(version: str) -> bool:
        old = f"refs/tags/v{version}"
        known = subprocess.run(["git", "rev-parse", "--verify", "--quiet", old], cwd=root, capture_output=True)
        if known.returncode != 0:
            return True
        same = subprocess.run(["git", "diff", "--quiet", old, f"refs/tags/{tag}", "--", *PACKAGE], cwd=root)
        if same.returncode > 1:
            raise SystemExit(f"git diff failed between {old} and {tag}")
        return same.returncode == 1

    return changed


class Store:
    def __init__(self, api: str, token: str, item: str) -> None:
        self.api = api.rstrip("/")
        self.token = token
        self.item = item

    def call(self, method: str, path: str, body: bytes | None = None, kind: str | None = None) -> dict:
        request = urllib.request.Request(self.api + path, data=body, method=method)
        request.add_header("Authorization", f"Bearer {self.token}")
        if kind is not None:
            request.add_header("Content-Type", kind)
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                text = response.read()
        except urllib.error.HTTPError as error:
            with error:
                detail = error.read().decode(errors="replace")
            raise SystemExit(f"{method} {path}: {error.code} {detail}") from None
        return json.loads(text or b"{}")

    def status(self) -> dict:
        return self.call("GET", f"/v2/{self.item}:fetchStatus")

    def upload(self, package: bytes) -> str | None:
        answer = self.call("POST", f"/upload/v2/{self.item}:upload?uploadType=media", package, "application/zip")
        return answer.get("uploadState")

    def publish(self) -> dict:
        return self.call("POST", f"/v2/{self.item}:publish", b"{}", "application/json")


def send(store: Store, package: Path, tag: str, changed: Callable[[str], bool], pause: float = 5) -> str:
    version = tag.removeprefix("v")
    with zipfile.ZipFile(package) as archive:
        packed = json.loads(archive.read("manifest.json"))
    if packed.get("version") != version or "key" in packed:
        raise SystemExit(f"{package} isn't the store's package for {tag}: version {packed.get('version')}")
    why = decide(store.status(), version, changed)
    if why is not None:
        return f"Skipped {version}: {why}."
    state = store.upload(package.read_bytes())
    deadline = time.monotonic() + UPLOAD_WAIT_S
    while state == "IN_PROGRESS" and time.monotonic() < deadline:
        time.sleep(pause)
        state = store.status().get("lastAsyncUploadState")
    if state != "SUCCEEDED":
        raise SystemExit(f"the store didn't take {package.name}: the upload is {state}")
    answer = store.publish()
    warnings = (answer.get("warningInfo") or {}).get("warnings") or []
    for warning in warnings:
        print(f"::warning::{json.dumps(warning)}")
    return f"Sent {version} to the store: {answer.get('state')}."


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    store = Store(
        os.environ.get("CWS_API", "https://chromewebstore.googleapis.com"),
        os.environ["CWS_TOKEN"],
        os.environ["CWS_ITEM"],
    )
    print(f"::notice::{send(store, Path(argv[1]), argv[2], changed_since(ROOT, argv[2]))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
