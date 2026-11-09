# Tug

Fast, resumable downloads for Linux, Plasma first. Tauri 2 and React on the front; Mister Download Manager's (MDM's) download engine underneath as pinned Rust crates. GPL-3.0-or-later.

Design tokens: `design/tokens.json`. Brand sources: `brand/`.

## Architecture

| Path | Role | May depend on |
|---|---|---|
| `crates/tug-core` | The app layer: transfers, the library, queues, settings, SQLite persistence | `mdm-*` crates, std, crates.io |
| `apps/desktop` | React 19 UI (Vite, Tailwind 4, TypeScript) | the design tokens |
| `apps/desktop/src-tauri` | Tauri 2 shell, crate `tug-desktop`, binary `tug` | `tug-core`, never `mdm-*` |
| `crates/tug-host` (planned) | Browser native messaging host | `tug-core` |
| `design/tokens.json` | The design system's tokens; `scripts/gen-tokens.py` writes `apps/desktop/src/styles/tokens.css` (CSS variables, Tailwind `@theme`, `.text-*` type styles) | nothing |
| `brand/` | Mark, icons, wordmark: `build.py` draws every SVG, `export.sh` renders PNGs | nothing |

## Rules

- Only `crates/tug-core` reaches MDM's crates. It maps the engine's types (`Snapshot`, `State`) into Tug's own (`Progress`, `Phase`) so engine changes stop at one module. `scripts/check-deps.py` enforces this.
- MDM's crates are declared once, in the root `[workspace.dependencies]`, at one git rev. Move the rev on purpose, in its own PR, after the engine tests pass; `check-deps.py` fails a split or stale pin.
- `unsafe_code` is forbidden. `unwrap`, `expect`, `panic`, `todo`, `dbg!` and printing are denied outside tests.
- No comments or docstrings unless the why is not obvious from the code.
- The UI talks to Rust only through `apps/desktop/src/backend` (`Backend`: the Tauri commands and the `progress` event, or the in-memory mock in a plain browser and in tests). Its types are generated from `src-tauri/src/bridge.rs` by ts-rs into `src/backend/bindings` on every `cargo test`; never edit them by hand. Errors reach the UI as `BackendError` with a `kind`.
- Change tokens in `design/tokens.json` and regenerate; never edit `tokens.css`. Style with the token utilities (`bg-surface`, `text-ink-muted`, `rounded-md`) and the `.text-*` type styles, not raw colors or sizes.
- UI work follows the design system: orange never colors text, every download state shows an icon and a word, and every screen is checked in screenshots, light and dark, before it is done. Each screen gets a shot in a `*.visual.tsx` file, which CI compares with the committed references.

## Commands

Cargo runs in the `dev` distrobox (the host lacks the build libraries), and so do commits, because the pre-commit hook runs cargo. Always set `RUSTFLAGS=""` there: the global mold flags export the bundled SQLite's symbols to WebKitGTK, and the hook sets the same so the cache stays warm:

```sh
distrobox enter dev -- bash -lc 'cd ~/Git/tug && PKG_CONFIG=/usr/bin/pkg-config CARGO_BUILD_JOBS=8 RUSTFLAGS="" cargo nextest run --workspace'
```

- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo nextest run --workspace`
- `python3 scripts/check-deps.py`, `taplo fmt --check`, `cargo machete`, `cargo deny check`, `cargo audit`
- `brand/export.sh` after changing `brand/build.py`; `python3 scripts/gen-tokens.py` after changing `design/tokens.json`
- `scripts/install-data.sh <prefix>` installs the desktop file, the AppStream metainfo and the hicolor icons (`packaging/`, `brand/`); CI validates them with `desktop-file-validate` and `appstreamcli validate`
- Frontend, on the host with pnpm: `pnpm install`, then `pnpm --filter @tug/desktop dev | typecheck | lint | test | test:visual | build`
- Visual tests: Vitest browser mode drives Playwright's Chromium in a `light` and a `dark` instance, and compares each shot with `src/__screenshots__`. Make or update references in the container, which matches CI's Ubuntu 24.04, then look at every changed PNG before you commit it: `distrobox enter dev -- bash -lc 'cd ~/Git/tug/apps/desktop && ./node_modules/.bin/vitest run --project visual --update'`. A failed comparison leaves the actual image and a diff in `.vitest/attachments` (CI uploads them as `visual-diffs`). Bump `playwright` by hand, with fresh references: a new version brings a new Chromium.

Screenshots of the real app, off the screen: run `pnpm --filter @tug/desktop dev` on the host, then in the container run `target/debug/tug` under `dbus-run-session -- xvfb-run` with `WAYLAND_DISPLAY` and `DBUS_SESSION_BUS_ADDRESS` unset, `GDK_BACKEND=x11` and `GSETTINGS_BACKEND=memory`, and capture with `import -window root`. Light needs an empty `XDG_CONFIG_HOME`; dark needs one whose `gtk-3.0/settings.ini` sets `gtk-application-prefer-dark-theme=1`. Without these the window opens on the real screen or inherits the desktop's theme.

The tray, off the screen: with the dev server running, run `scripts/tray/check.sh` in the container. It starts the app on a private session bus with a stand-in StatusNotifierWatcher (`scripts/tray/watcher.py`), reads the item and its menu with `busctl`, closes the window with `WM_DELETE_WINDOW` (`scripts/tray/close.py`), and expects Tug to keep running, to show again on Activate, and to exit on **Quit Tug**. It also stops the stand-in host (the window must come back, and closing must quit), and seeds a queued download from a local server that paces every connection to 1 MB/s (`scripts/tray/slow_server.py`) to check the ring icon, the tooltip, and **Pause all** and **Resume all**.

The AppImage: `.github/workflows/appimage.yml` builds it on ubuntu-22.04 for each release tag (release-please calls it) and on pull requests that touch packaging, then runs it off the screen before it uploads. To build one locally, run `pnpm --filter @tug/desktop build` on the host, then in the container run `./node_modules/.bin/tauri build --bundles appimage -c '{"build":{"beforeBuildCommand":""}}'` from `apps/desktop` (it compiles the release binary, then bundles it) with `PATH` limited to cargo, node and `/usr/bin`: linuxdeploy's GTK plugin takes linuxbrew's glib from `PATH` and fails.

The Flatpak: `packaging/flatpak/io.github.andymai.Tug.yml` builds from source on the GNOME 51 runtime, which still ships `webkit2gtk-4.1`, with the Rust and Node SDK extensions and network during the build. That suits our own release bundle, but Flathub needs vendored sources. `.github/workflows/flatpak.yml` builds it in Flathub's builder image for each release tag and on pull requests that touch packaging. In the sandbox the tray registers under its unique bus name, because a Flatpak can't own `org.kde.StatusNotifierItem-*`.

CI (`.github/workflows/ci.yml`) runs all of these behind the `CI Pass` gate. Commits and PR titles are conventional commits; release-please cuts releases from them.

## Engine tests

`crates/tug-core/tests/engine.rs` drives the engine against MDM's `mdm-labserver`: generated files whose bytes `content::fill` reproduces, fault injection through query parameters (`rate`, `drop_after`, `drop_every`, `max_conns`, `no_range`), and a request log. They run offline. Add one for every engine behavior Tug relies on.
