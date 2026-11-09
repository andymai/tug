# Tug

Fast, resumable downloads for Linux, Plasma first. Tauri 2 and React on the front; Mister Download Manager's (MDM's) download engine underneath as pinned Rust crates. GPL-3.0-or-later.

Design tokens: `design/tokens.json`. Brand sources: `brand/`.

## Architecture

| Path | Role | May depend on |
|---|---|---|
| `crates/tug-core` | The app layer: transfers, the library, queues, settings, SQLite persistence | `mdm-*` crates, std, crates.io |
| `apps/desktop` | React 19 UI (Vite, Tailwind 4, TypeScript) | the design tokens |
| `apps/desktop/src-tauri` | Tauri 2 shell, crate `tug-desktop`, binary `tug` | `tug-core`, never `mdm-*` |
| `crates/tug-ipc` | The local socket: one Tug per session, `tug add` and `tug list`, the browser host. JSON lines over a Unix socket in `$XDG_RUNTIME_DIR/app/io.github.andymai.Tug/` (`…Tug.Devel/` for debug builds) with a 0600 token; a lock file decides which Tug owns it | std, serde, thiserror, tokio |
| `apps/extension` | The browser extension, one TypeScript source for Chromium (MV3 service worker, fixed ID through its `key`) and Firefox (gecko ID): it hands each download to `tug-host` with its referrer, cookies and the browser's User-Agent, and adds **Download with Tug** to links and media. When Tug can't take a link, the browser keeps it | nothing (the browser APIs come in through `src/api.ts`) |
| `crates/tug-host` | The browser's native messaging host, binary `tug-host`: length-prefixed JSON on stdin and stdout, passed to Tug over the socket; starts Tug when it isn't running, the `tug` beside it first | `tug-ipc` |
| `design/tokens.json` | The design system's tokens; `scripts/gen-tokens.py` writes `apps/desktop/src/styles/tokens.css` (CSS variables, Tailwind `@theme`, `.text-*` type styles) | nothing |
| `brand/` | Mark, icons, wordmark: `build.py` draws every SVG, `export.sh` renders PNGs | nothing |

## Rules

- Only `crates/tug-core` reaches MDM's crates. It maps the engine's types (`Snapshot`, `State`) into Tug's own (`Progress`, `Phase`, `Inspection`) so engine changes stop at one place. `scripts/check-deps.py` enforces this.
- MDM's crates are declared once, in the root `[workspace.dependencies]`, at one git rev. Move the rev on purpose, in its own PR, after the engine tests pass; `check-deps.py` fails a split or stale pin.
- A browser's referrer, cookies and User-Agent (`tug_core::Origin`) go with every request of a download, on start and on resume. Only the `origins` table keeps them, and only until the download finishes. `tug.db` and its WAL files are 0600, and `Origin`'s `Debug` hides the cookies.
- `unsafe_code` is forbidden. `unwrap`, `expect`, `panic`, `todo`, `dbg!` and printing are denied outside tests.
- No comments or docstrings unless the why is not obvious from the code.
- The UI talks to Rust only through `apps/desktop/src/backend` (`Backend`: the Tauri commands and the `progress` event, or the in-memory mock in a plain browser and in tests). Its types are generated from `src-tauri/src/bridge.rs` by ts-rs into `src/backend/bindings` on every `cargo test`; never edit them by hand. Errors reach the UI as `BackendError` with a `kind`.
- Change tokens in `design/tokens.json` and regenerate; never edit `tokens.css`. Style with the token utilities (`bg-surface`, `text-ink-muted`, `rounded-md`) and the `.text-*` type styles, not raw colors or sizes.
- UI work follows the design system: orange never colors text, every download state shows an icon and a word, and every screen is checked in screenshots, light and dark, before it is done. Each screen gets a shot in a `*.visual.tsx` file, which CI compares with the committed references.

## Before a PR

Run `/code-review high` on the branch, and fix what it finds before you open the PR. It is Claude Code's own review of the branch's diff, at its high effort. Without Claude Code, read the diff yourself. Then check the change against each item below. Each one is a fault that review found more than once:

- **A late answer.** An answer that arrives after the person moved on must not overwrite newer state. Keep it only if its request is still the newest and its download is still the one on screen. A field keeps text typed after its save started.
- **Check, then act.** A check and the write that it allows happen under one lock. Between them, no `await` happens unless the run lock holds. A row that says `downloading` with no transfer in `running` still settles, so treat it as busy.
- **The mock.** The mock refuses what Rust refuses, before it inserts a row, and it cleans up values (trims, URL cleanup) as Rust does. Its sizes and types follow a change as Rust's do.
- **Lists.** A new variant reaches every list that names the variants: command groups, tabs, error kinds, the keyboard map.
- **Unmount.** State that a component owns (a menu, a drag, a draft) ends when the component goes.
- **The window's thread.** A plain Tauri command runs on the window's thread. A command that reads files, starts a process or waits on the network is `async`.
- **Bounds.** A value that the person sets stays in bounds after the window changes size, in whole pixels or bytes. Tug saves back a value that shows rounded only when the person changed it.
- **Tests.** A test for a fix fails without the fix: run it once with the fix stashed.

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
- The extension: `pnpm --filter @tug/extension typecheck | lint | test | build`; the build writes `apps/extension/dist/chromium` and `dist/firefox`, each with its own manifest from `src/manifest.ts`. Its tests drive the logic through fake browser APIs and keep the Chromium key, the IDs and the host name equal to `browsers.rs`.
- Visual tests: Vitest browser mode drives Playwright's Chromium in a `light` and a `dark` instance, and compares each shot with `src/__screenshots__`. Make or update references in the container, which matches CI's Ubuntu 24.04, then look at every changed PNG before you commit it: `distrobox enter dev -- bash -lc 'cd ~/Git/tug/apps/desktop && ./node_modules/.bin/vitest run --project visual --update'`. A failed comparison leaves the actual image and a diff in `.vitest/attachments` (CI uploads them as `visual-diffs`). Bump `playwright` by hand, with fresh references: a new version brings a new Chromium.

Screenshots of the real app, off the screen: run `pnpm --filter @tug/desktop dev` on the host, then in the container run `target/debug/tug` under `dbus-run-session -- xvfb-run` with `WAYLAND_DISPLAY` and `DBUS_SESSION_BUS_ADDRESS` unset, `GDK_BACKEND=x11` and `GSETTINGS_BACKEND=memory`, and capture with `import -window root`. Light needs an empty `XDG_CONFIG_HOME`; dark needs one whose `gtk-3.0/settings.ini` sets `gtk-application-prefer-dark-theme=1`. Without these the window opens on the real screen or inherits the desktop's theme.

The CLI, the browser host and single instance, off the screen: with the dev server running, run `scripts/ipc/check.sh` in the container. It checks `tug add` (which starts Tug), `tug list`, `tug-host` through framed messages (`scripts/host/talk.py`), an add with a referrer, cookies and a User-Agent that the test server must see on every request, `tug browsers` in a private home with a stand-in `flatpak` (then a ping through the manifest it wrote), the socket's permissions, a second `tug` handing off, two launches at once, and a stale socket after a crash.

The extension in a real browser, off the screen: with the dev server running and the extension built, run `scripts/extension/check.sh` in the container (once, `pnpm --filter @tug/extension exec playwright install chromium` on the host first; branded Chrome ignores `--load-extension`). It runs Chromium once so `tug browsers` registers its profile, loads the extension, and clicks two download links on a page from the test server with a cookie set. The first, in ask mode, must wait in Tug, paused, with no request from Tug. The check then stops Tug and turns asking off in its database, and the second must download at once: every request Tug sends (the ones without `Sec-Fetch-Mode`, which the browser sends) carries the referrer, the cookie and Chromium's User-Agent.

The tray, off the screen: with the dev server running, run `scripts/tray/check.sh` in the container. It starts the app on a private session bus with a stand-in StatusNotifierWatcher (`scripts/tray/watcher.py`), reads the item and its menu with `busctl`, closes the window with `WM_DELETE_WINDOW` (`scripts/tray/close.py`), and expects Tug to keep running, to show again on Activate, and to exit on **Quit Tug**. It also stops the stand-in host (the window must come back, and closing must quit), and seeds a queued download from a local server that paces every connection to 1 MB/s (`scripts/tray/slow_server.py`) to check the ring icon, the tooltip, and **Pause all** and **Resume all**.

Notifications, off the screen: with the dev server running, run `scripts/notify/check.sh` in the container. `src-tauri/src/notify.rs` sends `org.freedesktop.Notifications` calls when a download settles as Done (**Open**, **Show in folder**, and the file in `x-kde-urls` for a preview) or Failed (the reason); clicking either one shows Tug and selects the download (`focus-download` event). The check runs a stand-in notification server and file manager (`scripts/notify/server.py`, which can fire `ActionInvoked`), a stub `xdg-open`, and the tray's stand-in watcher, then checks each notification and each action, including that **Show in Tug** brings a hidden window back. `src-tauri/src/launcher.rs` emits `com.canonical.Unity.LauncherEntry.Update` for `application://io.github.andymai.Tug.desktop`, so Plasma's task manager shows the running downloads' progress and count; it sends only when a whole percent or the count changes. The same check listens for it (`scripts/notify/launcher.py`) through a paced download. The test server takes `?size=` and `?status=` for quick downloads and failures.

The AppImage: `.github/workflows/appimage.yml` builds it on ubuntu-22.04 for each release tag (release-please calls it) and on pull requests that touch packaging, then runs it off the screen before it uploads. Tauri's `beforeBundleCommand` builds `tug-host`, and the bundle carries it as `usr/bin/tug-host`; the workflow also checks `tug browsers` and a ping and a show through the moved host. To build one locally, run `pnpm --filter @tug/desktop build` on the host, then in the container run `./node_modules/.bin/tauri build --bundles appimage -c '{"build":{"beforeBuildCommand":""}}'` from `apps/desktop` (it compiles the release binary, then bundles it) with `PATH` limited to cargo, node and `/usr/bin`: linuxdeploy's GTK plugin takes linuxbrew's glib from `PATH` and fails.

The Flatpak: `packaging/flatpak/io.github.andymai.Tug.yml` builds from source on the GNOME 51 runtime, which still ships `webkit2gtk-4.1`, with the Rust and Node SDK extensions and network during the build. That suits our own release bundle, but Flathub needs vendored sources. `.github/workflows/flatpak.yml` builds it in Flathub's builder image for each release tag and on pull requests that touch packaging. In the sandbox the tray registers under its unique bus name, because a Flatpak can't own `org.kde.StatusNotifierItem-*`.

CI (`.github/workflows/ci.yml`) runs all of these behind the `CI Pass` gate. Commits and PR titles are conventional commits; release-please cuts releases from them.

## Browsers

`tug browsers` (and every start of a release build) writes the native messaging manifest `io.github.andymai.tug.json` for each browser that ran at least once: Chrome, Chromium, Brave, Vivaldi and Edge (`Local State` in the profile folder), and Firefox (`firefox/profiles.ini`; manifests always go to `~/.mozilla/native-messaging-hosts`). The manifest names the `tug-host` beside `tug`. An AppImage's files go away when it stops, so there Tug copies `tug-host` to `$XDG_DATA_HOME/io.github.andymai.Tug/host/`, beside a `tug` script that runs `$APPIMAGE`, and names the copy. A Flatpak browser gets a `flatpak-spawn --host` wrapper in `~/.var/app/<id>/data/io.github.andymai.Tug/` only when `flatpak info --show-permissions` already lists `org.freedesktop.Flatpak=talk`. Tug never grants that; it prints the `flatpak override` command. The code is `src-tauri/src/browsers.rs`; the extension IDs are its constants.

Settings → Browsers keeps the sites Tug leaves to the browser (`Settings::excluded_sites`, normalized hosts; `tug_core::site` in Rust and `lib/sites.ts` in the UI read a typed entry the same way). Only an add with `capture: true`, which the extension sends for downloads it caught on its own, checks the list: when the link or the page is on a listed site or below it, that link fails with the reason, and the browser keeps the download. **Download with Tug** and `tug add` never check it.

With **Ask before each browser download** on (`Settings::confirm_captures`, the default), such a capture is added paused (`Library::add_paused`), and Tug shows its window with the capture sheet: **Download** resumes it, **Cancel** removes it, and Escape leaves it paused in the list. `AppState` keeps the waiting ids in memory; the UI reads them with `pending_captures` and the `captures` event and answers with `answer_capture`.

## Engine tests

`crates/tug-core/tests/engine.rs` drives the engine against MDM's `mdm-labserver`: generated files whose bytes `content::fill` reproduces, fault injection through query parameters (`rate`, `drop_after`, `drop_every`, `max_conns`, `no_range`), and a request log. They run offline. Add one for every engine behavior Tug relies on.
