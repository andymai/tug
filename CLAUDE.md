# Tug

A calm, exact download manager for Linux, Plasma first. Tauri 2 and React on the front; Mister Download Manager's (MDM's) download engine underneath as pinned Rust crates. GPL-3.0-or-later.

Plan and decisions: Obsidian vault `Projects/tug`. Design system (tokens, brand book, component guidelines): https://claude.ai/artifact/AJonHX5iRg63Z4wRx9yffA. Brand sources: `brand/`.

## Architecture

| Path | Role | May depend on |
|---|---|---|
| `crates/tug-core` | The app layer: transfers, the library, queues, settings, SQLite persistence | `mdm-*` crates, std, crates.io |
| `apps/desktop` (planned) | Tauri shell and React UI | `tug-core`, never `mdm-*` |
| `crates/tug-host` (planned) | Browser native messaging host | `tug-core` |
| `brand/` | Mark, icons, wordmark: `build.py` draws every SVG, `export.sh` renders PNGs | nothing |

## Rules

- Only `crates/tug-core` reaches MDM's crates. It maps the engine's types (`Snapshot`, `State`) into Tug's own (`Progress`, `Phase`) so engine changes stop at one module. `scripts/check-deps.py` enforces this.
- MDM's crates are declared once, in the root `[workspace.dependencies]`, at one git rev. Move the rev on purpose, in its own PR, after the engine tests pass; `check-deps.py` fails a split or stale pin.
- `unsafe_code` is forbidden. `unwrap`, `expect`, `panic`, `todo`, `dbg!` and printing are denied outside tests.
- No comments or docstrings unless the why is not obvious from the code.
- UI work follows the design system: orange never colors text, every download state shows an icon and a word, and every screen is checked in screenshots, light and dark, before it is done.

## Commands

Cargo runs in the `dev` distrobox (the host lacks the build libraries), and so do commits, because the pre-commit hook runs cargo:

```sh
distrobox enter dev -- bash -lc 'cd ~/Git/tug && PKG_CONFIG=/usr/bin/pkg-config CARGO_BUILD_JOBS=8 cargo nextest run --workspace'
```

- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo nextest run --workspace`
- `python3 scripts/check-deps.py`, `taplo fmt --check`, `cargo machete`, `cargo deny check`, `cargo audit`
- `brand/export.sh` after changing `brand/build.py`

CI (`.github/workflows/ci.yml`) runs all of these behind the `CI Pass` gate. Commits and PR titles are conventional commits; release-please cuts releases from them.

## Engine tests

`crates/tug-core/tests/engine.rs` drives the engine against MDM's `mdm-labserver`: generated files whose bytes `content::fill` reproduces, fault injection through query parameters (`rate`, `drop_after`, `drop_every`, `max_conns`, `no_range`), and a request log. They run offline. Add one for every engine behavior Tug relies on.
