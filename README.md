<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/svg/lockup-dark.svg">
  <img alt="tug" src="brand/svg/lockup.svg" height="72">
</picture>

**Fast, resumable downloads for Linux.**<br>
Tug pulls every file over many connections and picks up exactly where it stopped, after a pause, a crash or a dropped connection.

[![CI](https://github.com/andymai/tug/actions/workflows/ci.yml/badge.svg)](https://github.com/andymai/tug/actions/workflows/ci.yml)
[![Commit activity](https://img.shields.io/github/commit-activity/m/andymai/tug?label=commits%2Fmonth)](https://github.com/andymai/tug/commits/main)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)
[![Rust 1.95+](https://img.shields.io/badge/rust-1.95%2B-orange.svg)](https://www.rust-lang.org/)
[![unsafe forbidden](https://img.shields.io/badge/unsafe-forbidden-success.svg)](#architecture)

**[Features](#features)** · **[Install](#install)** · **[Status](#status)** · **[Architecture](#architecture)** · **[Build](#build-from-source)** · **[Contributing](CONTRIBUTING.md)**

https://github.com/user-attachments/assets/3fb2281b-990d-42c5-b1bc-299f19bef128

</div>

The video runs Tug's interface on simulated downloads, from a file's live connections to a download that the browser hands over.

Tug is a download manager for Linux, made for KDE Plasma first. Its keyboard-first interface shows what each download does, down to each connection.

## Features

### Downloads that finish

- **Many connections per file.** Up to 128, and 8 by default. When a connection finishes its part, Tug splits the largest part that remains, so every connection stays busy to the end.
- **Resume after a stop or a crash.** Tug saves its place every 2 seconds, next to the file. The data goes to a `.part` file, and Tug renames it only when the download is complete.
- **Built for flaky servers.** A failed connection tries again at once, then after a delay that doubles up to 30 seconds. Tug learns how many connections each server accepts.

### Every source in one queue

- **Web links and torrents.** HTTP(S) and FTP(S), and magnet links and `.torrent` files. Tug checks certificates against the system's store. For a torrent, you choose the files and see each peer.
- **From the browser.** The extension hands each download to Tug with its referrer, cookies and User-Agent, so a signed-in download works. By default, Tug asks first, and it leaves the sites that you list to the browser.
- **From anywhere else.** Paste or drop links into the window, or run `tug add <link>` in a terminal. The system can open magnet links and `.torrent` files with Tug.

### You set the pace

- **A queue.** Set how many downloads run at once, and drag them into the order you want.
- **Speed and time.** Turn a speed limit on in one click. Set a lower limit for the hours you choose, or let downloads run only on a schedule.
- **Options for each download.** Give a download its own folder, connections, speed limit, name and headers when you add it.

### See everything

- **The inspector.** A map of the file's parts, each connection's speed, bytes and status, the server's address, round trip and CDN, and the engine's log.
- **A dense table.** Pick the columns, sort on any of them, and set their widths. Search, saved views and file types narrow the list.
- **Many downloads at once.** Select with Shift and Ctrl, then pause, resume, remove or move them in one action.
- **The keyboard.** Ctrl+K opens the command bar, and the keyboard shortcuts dialog lists the rest.

### At home on Plasma

- A tray icon with a progress ring. Close the window, and Tug stays in the tray.
- Notifications with **Open** and **Show in folder**, and download progress on the task manager.
- Light and dark themes that follow the system.

### A hardened build

- Rust with `unsafe` forbidden. CI pins each action by SHA, and cargo-deny, cargo-audit and OSV scans gate every change.
- Tug pins the engine to one reviewed commit, and the engine's tests run offline against a local server that injects faults.
- Details are in [SECURITY.md](SECURITY.md).

## Install

Tug runs on 64-bit Linux, as an AppImage or a Flatpak. Each [release](https://github.com/andymai/tug/releases/latest) has an AppImage and a Flatpak bundle, and Tug's Flatpak repository gets the same version. To use the browser extension, install the AppImage: from inside its sandbox, the Flatpak can't connect a browser to Tug.

### AppImage

1. Download `Tug_<version>_amd64.AppImage` from the [newest release](https://github.com/andymai/tug/releases/latest).
2. Make it executable, and start it:

   ```sh
   chmod +x Tug_*_amd64.AppImage
   ./Tug_*_amd64.AppImage
   ```

### Flatpak

Tug has its own signed Flatpak repository, and each release adds its version there. Add the repository once, then install Tug. It uses the GNOME 51 runtime from Flathub.

```sh
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak remote-add --if-not-exists tug https://andymai.github.io/tug/tug.flatpakrepo
flatpak install tug io.github.andymai.Tug
```

After that, Bazaar and other Flatpak stores list Tug, and `flatpak update` keeps it current. A store can also install it from [`io.github.andymai.Tug.flatpakref`](https://andymai.github.io/tug/io.github.andymai.Tug.flatpakref).

Each release also has the bundle `io.github.andymai.Tug.flatpak`, for an install without the repository. A bundle doesn't update.

### Browser extension

The extension hands your browser's downloads to Tug, with the cookies that a signed-in download needs. It also adds **Download with Tug** to the menu of each link.

For Chrome, Chromium, Brave, Vivaldi or Edge (version 120 or later):

1. Download [`tug-extension-chromium.zip`](https://github.com/andymai/tug/releases/latest/download/tug-extension-chromium.zip), and unzip it into a folder that you keep.
2. Open the browser's extensions page, for example `chrome://extensions`, and turn on **Developer mode**.
3. Click **Load unpacked**, and choose the folder.
4. Run `./Tug_*_amd64.AppImage browsers` once. It connects Tug to each browser that ran at least once, and Tug does the same at each start.

To update the extension, unzip the new release into the same folder. Then click the reload button on the extension's card. A browser from Flatpak also needs permission to reach Tug outside its sandbox: the `browsers` command prints the `flatpak override` command that gives it.

Firefox (version 128 or later) keeps an add-on after a restart only when Mozilla signed it. To try the extension until the next restart:

1. Download [`tug-extension-firefox.zip`](https://github.com/andymai/tug/releases/latest/download/tug-extension-firefox.zip).
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose the zip.

By default, Tug asks before it takes a download from the browser. To change that, use **Ask before each browser download** in **Settings → Browsers**. The extension leaves downloads from private windows, and files under 1 MiB, to the browser.

## Status

Tug is before 1.0. Each merged feature or fix cuts a release, so releases come often.

## Architecture

```
browser extension ──► tug-host ──► local socket ──┐
                                                  ▼
               desktop app (Tauri 2, React) ──► tug-core ──► download engine (pinned)
```

| Path | Role |
|---|---|
| `crates/tug-core` | Transfers, the library, the queue, settings and the SQLite store. It is the only crate that reaches the engine, and it maps the engine's types into Tug's own. |
| `apps/desktop` | The React interface and the Tauri shell, which builds the `tug` binary. |
| `crates/tug-ipc` | The local socket. It keeps one Tug for each session, and it serves `tug add` and `tug list`. |
| `crates/tug-host` | The browser's native messaging host. It passes the extension's downloads to Tug over the socket. |
| `apps/extension` | The browser extension, from one source for Chromium browsers and Firefox. |
| `design/`, `brand/` | The design system's tokens, and the mark, icons and wordmark. |

## Build from source

You need Rust (`rust-toolchain.toml` pins the version), a C compiler, and Node.js 24 or later with pnpm. You also need the development packages for WebKitGTK and GTK. On Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
```

Then build and start Tug:

```sh
git clone https://github.com/andymai/tug
cd tug
pnpm install
pnpm --filter @tug/desktop exec tauri build --no-bundle
cargo build --release --locked -p tug-host
./target/release/tug
```

`tug-host` connects the browser extension to Tug, and Tug looks for it next to `tug`.

To build the browser extension, run `pnpm --filter @tug/extension build`. It writes `apps/extension/dist/chromium` and `apps/extension/dist/firefox`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the tests, the commit hooks and the checks that CI runs.

## License

[GPL-3.0-or-later](LICENSE). Tug's download engine is [Mister Download Manager](https://github.com/anefzaoui/misterdownloadmanager) by Ahmed Nefzaoui, also GPL-3.0-or-later. Tug is an independent project.
