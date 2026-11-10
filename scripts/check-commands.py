#!/usr/bin/env python3
"""Tauri commands: each one is registered, and each one leaves the window's thread unless
its SYNC entry says why it can stay. A plain `#[tauri::command]` runs on the window's
thread, so a file check, a launcher, a D-Bus call or a wait on a lock there freezes the
window. `#[tauri::command(async)]` and `async fn` run on the async runtime instead.

It also keeps the list of commands that cargo-mutants leaves whole in .cargo/mutants.toml
equal to the registered ones: only driving the window notices a command replaced as a whole."""

import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/desktop/src-tauri/src"
MUTANTS = ROOT / ".cargo/mutants.toml"
COMMANDS_RE = "^apps/desktop/src-tauri/src/.*: replace ("

# Plain commands, by path, each with why it can stay on the window's thread.
SYNC = {
    "bridge::get_settings": "reads the settings in memory",
}

ATTRIBUTE = re.compile(r"#\[tauri::command(?:\((?P<args>[^)]*)\))?\]")
# What may sit between the attribute and its fn: other attributes, comments, space.
BETWEEN = re.compile(r"(?:\s+|//[^\n]*|/\*.*?\*/|#\[[^\]]*\])*", re.S)
FN = re.compile(r"(?:pub(?:\([^)]*\))?\s+)?(?P<async>async\s+)?fn\s+(?P<name>\w+)")


def commands_in(text: str):
    """Each #[tauri::command] with the fn it marks: (name, off the window's thread)."""
    for attribute in ATTRIBUTE.finditer(text):
        at = BETWEEN.match(text, attribute.end()).end()
        fn = FN.match(text, at)
        if fn is None:
            yield None, False
            continue
        args = {arg.strip() for arg in (attribute["args"] or "").split(",")}
        yield fn["name"], fn["async"] is not None or "async" in args


HANDLER = re.compile(r"generate_handler!\[(?P<body>[^\]]*)\]", re.S)


def module_of(path: Path, src: Path) -> str:
    parts = list(path.relative_to(src).with_suffix("").parts)
    if parts[-1] in ("mod", "main", "lib"):
        parts.pop()
    return "::".join(parts)


def commands_pattern(names) -> str:
    return COMMANDS_RE + "|".join(sorted(names)) + ")( -> .*)? with "


def mutants_problems(mutants: Path, names) -> list[str]:
    patterns = tomllib.loads(mutants.read_text()).get("exclude_re", [])
    listed = [p for p in patterns if p.startswith(COMMANDS_RE)]
    want = commands_pattern(names)
    if listed != [want]:
        return [f"{mutants.name}: exclude_re must list the registered commands as {want!r}"]
    return []


def problems_in(src: Path, mutants: Path | None = None) -> list[str]:
    problems = []
    commands: dict[str, bool] = {}
    for path in sorted(src.rglob("*.rs")):
        module = module_of(path, src)
        for fn, off_window in commands_in(path.read_text()):
            if fn is None:
                problems.append(f"{path.name}: a #[tauri::command] with no fn after it")
                continue
            name = f"{module}::{fn}" if module else fn
            if name in commands:
                problems.append(f"{name}: two commands with this path")
            commands[name] = off_window

    handlers = HANDLER.findall((src / "main.rs").read_text())
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
    if mutants is not None:
        problems += mutants_problems(mutants, {name.rsplit("::", 1)[-1] for name in commands})
    return problems


def main() -> int:
    problems = problems_in(SRC, MUTANTS)
    for problem in problems:
        print(f"check-commands: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"check-commands: ok ({len(SYNC)} plain)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
