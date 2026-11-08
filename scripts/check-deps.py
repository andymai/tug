"""Dependency rules cargo cannot express: the MDM engine gate and its single pinned rev."""

import pathlib
import re
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MDM_REPO = "https://github.com/anefzaoui/misterdownloadmanager"
ENGINE_GATE = "crates/tug-core"
SKIP = {"target", "node_modules", ".git"}


def is_mdm(name: str) -> bool:
    return name.startswith("mdm-")


def members() -> list[pathlib.Path]:
    found = []
    for manifest in ROOT.rglob("Cargo.toml"):
        rel = manifest.relative_to(ROOT)
        if rel == pathlib.Path("Cargo.toml") or SKIP.intersection(rel.parts):
            continue
        found.append(manifest)
    return sorted(found)


def main() -> int:
    problems = []
    root = tomllib.loads((ROOT / "Cargo.toml").read_text())
    pins = {
        name: spec
        for name, spec in root.get("workspace", {}).get("dependencies", {}).items()
        if is_mdm(name)
    }

    for name, spec in pins.items():
        if not isinstance(spec, dict) or spec.get("git") != MDM_REPO or "rev" not in spec:
            problems.append(f"Cargo.toml: {name} must be {{ git = \"{MDM_REPO}\", rev = \"<sha>\" }}")
    revs = {spec.get("rev") for spec in pins.values() if isinstance(spec, dict)}
    if len(revs) > 1:
        problems.append(f"Cargo.toml: mdm-* crates are pinned to more than one rev: {sorted(map(str, revs))}")
    rev = next(iter(revs), None)

    for manifest in members():
        crate = manifest.parent.relative_to(ROOT).as_posix()
        doc = tomllib.loads(manifest.read_text())
        for table in ("dependencies", "dev-dependencies", "build-dependencies"):
            for name, spec in doc.get(table, {}).items():
                if not is_mdm(name):
                    continue
                if not (isinstance(spec, dict) and spec.get("workspace") is True):
                    problems.append(f"{crate}: {name} must use `.workspace = true`, not its own source")
                if table == "dependencies" and crate != ENGINE_GATE:
                    problems.append(f"{crate}: depends on {name}; only {ENGINE_GATE} may reach MDM's crates")

    lock = ROOT / "Cargo.lock"
    if rev and lock.exists():
        for package in tomllib.loads(lock.read_text()).get("package", []):
            if not is_mdm(package["name"]):
                continue
            source = package.get("source", "")
            locked = re.search(r"#([0-9a-f]{40})$", source)
            if not locked or locked.group(1) != rev:
                problems.append(f"Cargo.lock: {package['name']} resolves to {source or 'no source'}, not rev {rev}")

    for problem in problems:
        print(f"check-deps: {problem}", file=sys.stderr)
    if not problems:
        print(f"check-deps: ok ({len(pins)} mdm-* crates at {rev}, gate {ENGINE_GATE})")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
