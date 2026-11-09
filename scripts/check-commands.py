#!/usr/bin/env python3
"""Tauri commands: each one is registered, and each one is async unless it only reads or
writes Tug's own store. A plain command runs on the window's thread, so a file check, a
launcher or a D-Bus call there freezes the window."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/desktop/src-tauri/src"

# Plain commands, each with why it can stay on the window's thread.
SYNC = {
    "list_downloads": "reads the store",
    "search_downloads": "reads the store",
    "download_events": "reads the store",
    "download_headers": "reads the store",
    "set_download_headers": "writes the store under one lock",
    "pending_captures": "reads memory",
    "place_download": "writes the store",
    "get_settings": "reads memory",
    "update_settings": "writes the store",
}

COMMAND = re.compile(
    r"#\[tauri::command\]\s*(?:#\[[^\]]*\]\s*)*pub\s+(async\s+)?fn\s+(\w+)", re.S
)


def main() -> int:
    commands: dict[str, bool] = {}
    for path in sorted(SRC.glob("*.rs")):
        for match in COMMAND.finditer(path.read_text()):
            commands[match.group(2)] = match.group(1) is not None
    handler = (SRC / "main.rs").read_text()
    registered = set(re.findall(r"bridge::(\w+),", handler))

    problems = []
    for name, is_async in sorted(commands.items()):
        if name not in registered:
            problems.append(f"{name}: a command that main.rs doesn't register")
        if not is_async and name not in SYNC:
            problems.append(
                f"{name}: a plain command runs on the window's thread; make it async, "
                "or add it to SYNC in scripts/check-commands.py with the reason it can stay"
            )
        if is_async and name in SYNC:
            problems.append(f"{name}: async now, so take it out of SYNC")
    for name in sorted(registered - commands.keys()):
        problems.append(f"{name}: registered, but no #[tauri::command] has that name")
    for name in sorted(SYNC.keys() - commands.keys()):
        problems.append(f"{name}: in SYNC, but no command has that name")

    for problem in problems:
        print(f"check-commands: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"check-commands: ok ({len(commands)} commands, {len(SYNC)} plain)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
