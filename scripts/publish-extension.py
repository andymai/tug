#!/usr/bin/env python3
"""Sends a release's extension package to the Chrome Web Store and submits it for review.

Every release moves the extension's version, but most releases don't change the extension,
and each submission waits for the store's review. So a version goes to the store only when its
package differs from the package of the store's version, which that release keeps as an asset,
and never while the store holds another version back.

Usage: publish-extension.py PACKAGE.zip TAG, with CWS_TOKEN (an access token with the
chromewebstore scope) and CWS_ITEM (publishers/PUBLISHER_ID/items/ITEM_ID) in the environment.
`gh` downloads the older package, so GH_TOKEN and GH_REPO must be set too."""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

ASSET = "tug-extension-chrome-web-store.zip"
HELD = {"PENDING_REVIEW": "waits for review", "STAGED": "waits for someone to publish it in the Developer Dashboard"}
TIMEOUT_S = 60
UPLOAD_WAIT_S = 300


def parse(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def version_of(revision: dict) -> str | None:
    channels = revision.get("distributionChannels") or []
    return channels[0].get("crxVersion") if channels else None


class Skip(NamedTuple):
    reason: str
    # The store holds a version back, so this release's changes wait: worth a look in the run.
    held: bool = False


def decide(status: dict, version: str, changed: Callable[[str], bool]) -> Skip | None:
    if status.get("takenDown"):
        return Skip("the store took the item down; see the Developer Dashboard", held=True)
    submitted = status.get("submittedItemRevisionStatus") or {}
    held = HELD.get(submitted.get("state"))
    if held is not None:
        return Skip(f"{version_of(submitted)} {held}, so a release after it sends the newest version", held=True)
    published = version_of(status.get("publishedItemRevisionStatus") or {})
    if published is None:
        return None
    if parse(published) >= parse(version):
        return Skip(f"the store has {published} already")
    if not changed(published):
        return Skip(f"the extension is the same as {published}, the version in the store")
    return None


def contents(package: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(package) as archive:
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    manifest = json.loads(files.pop("manifest.json"))
    manifest.pop("version", None)
    files["manifest.json"] = json.dumps(manifest, sort_keys=True).encode()
    return files


def changed_from(package: Path, fetch: Callable[[str, Path], bool]) -> Callable[[str], bool]:
    def changed(version: str) -> bool:
        with tempfile.TemporaryDirectory() as folder:
            old = Path(folder) / ASSET
            if not fetch(f"v{version}", old):
                return True
            return contents(old) != contents(package)

    return changed


def gh(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=False)


# Only a release or an asset that doesn't exist means "no package": any other error stops the
# job, because a guess of "changed" would start a review for nothing.
def release_asset(tag: str, path: Path) -> bool:
    listed = gh("release", "view", tag, "--json", "assets", "--jq", ".assets[].name")
    if listed.returncode != 0:
        if "release not found" in listed.stderr:
            return False
        raise SystemExit(f"couldn't read the release {tag}: {listed.stderr.strip()}")
    if ASSET not in listed.stdout.split():
        return False
    fetched = gh("release", "download", tag, "--pattern", ASSET, "--dir", str(path.parent))
    if fetched.returncode != 0 or not path.is_file():
        raise SystemExit(f"couldn't download {ASSET} from {tag}: {fetched.stderr.strip()}")
    return True


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
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
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


def send(store: Store, package: Path, tag: str, changed: Callable[[str], bool], pause: float = 5) -> tuple[str, str]:
    version = tag.removeprefix("v")
    with zipfile.ZipFile(package) as archive:
        packed = json.loads(archive.read("manifest.json"))
    if "key" in packed:
        raise SystemExit(f"{package} carries a key, so it isn't the store's package")
    if packed.get("version") != version:
        raise SystemExit(f"{package} has version {packed.get('version')}, not the version of {tag}")
    skip = decide(store.status(), version, changed)
    if skip is not None:
        return ("warning" if skip.held else "notice"), f"Skipped {version}: {skip.reason}."
    state = store.upload(package.read_bytes())
    deadline = time.monotonic() + UPLOAD_WAIT_S
    while state == "IN_PROGRESS" and time.monotonic() < deadline:
        time.sleep(pause)
        state = store.status().get("lastAsyncUploadState")
    if state != "SUCCEEDED":
        raise SystemExit(f"the store didn't take {package.name}: the upload is {state}")
    answer = store.publish()
    for warning in (answer.get("warningInfo") or {}).get("warnings") or []:
        print(f"::warning::{json.dumps(warning)}")
    return "notice", f"Sent {version} to the store: {answer.get('state')}."


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    store = Store(
        os.environ.get("CWS_API", "https://chromewebstore.googleapis.com"),
        os.environ["CWS_TOKEN"],
        os.environ["CWS_ITEM"],
    )
    package = Path(argv[1])
    level, message = send(store, package, argv[2], changed_from(package, release_asset))
    print(f"::{level}::{message}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
