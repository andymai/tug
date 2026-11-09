#!/usr/bin/env python3
"""Tauri commands: each one is registered, and each one leaves the window's thread unless
its SYNC entry says why it can stay. A plain `#[tauri::command]` runs on the window's
thread, so a file check, a launcher, a D-Bus call or a wait on a lock there freezes the
window. `#[tauri::command(async)]` and `async fn` run on the async runtime instead."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/desktop/src-tauri/src"

# Plain commands, by path, each with why it can stay on the window's thread.
SYNC = {
    "bridge::get_settings": "reads the settings in memory",
}

COMMAND = re.compile(
    r"#\[tauri::command(?:\((?P<args>[^)]*)\))?\]\s*(?:#\[[^\]]*\]\s*)*"
    r"(?:pub(?:\([^)]*\))?\s+)?(?P<async>async\s+)?fn\s+(?P<name>\w+)",
    re.S,
)
HANDLER = re.compile(r"generate_handler!\[(?P<body>[^\]]*)\]", re.S)


def module_of(path: Path) -> str:
    parts = list(path.relative_to(SRC).with_suffix("").parts)
    if parts[-1] in ("mod", "main", "lib"):
        parts.pop()
    return "::".join(parts)


def main() -> int:
    problems = []
    commands: dict[str, bool] = {}
    for path in sorted(SRC.rglob("*.rs")):
        module = module_of(path)
        for match in COMMAND.finditer(path.read_text()):
            name = f"{module}::{match['name']}" if module else match["name"]
            args = {arg.strip() for arg in (match["args"] or "").split(",")}
            if name in commands:
                problems.append(f"{name}: two commands with this path")
            commands[name] = match["async"] is not None or "async" in args

    handlers = HANDLER.findall((SRC / "main.rs").read_text())
    if len(handlers) != 1:
        problems.append(f"main.rs: {len(handlers)} generate_handler! lists, not one")
    registered = {
        entry.strip()
        for body in handlers
        for entry in body.split(",")
        if entry.strip()
    }

    for name, off_window in sorted(commands.items()):
        if name not in registered:
            problems.append(f"{name}: a command that main.rs doesn't register")
        if not off_window and name not in SYNC:
            problems.append(
                f"{name}: a plain command runs on the window's thread; make it async or "
                "#[tauri::command(async)], or add it to SYNC with the reason it can stay"
            )
        if off_window and name in SYNC:
            problems.append(f"{name}: off the window's thread now, so take it out of SYNC")
    for name in sorted(registered - commands.keys()):
        problems.append(f"{name}: registered, but no #[tauri::command] has this path")
    for name in sorted(SYNC.keys() - commands.keys()):
        problems.append(f"{name}: in SYNC, but no command has this path")

    for problem in problems:
        print(f"check-commands: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"check-commands: ok ({len(commands)} commands, {len(SYNC)} plain)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
