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

**[Install](#install)** · **[Status](#status)** · **[Highlights](#highlights)** · **[Scope](#scope)** · **[Architecture](#architecture)** · **[Build](#build-from-source)** · **[Contributing](CONTRIBUTING.md)**

https://github.com/user-attachments/assets/3fb2281b-990d-42c5-b1bc-299f19bef128

</div>

The video runs Tug's interface on simulated downloads, from a file's live connections to a download that the browser hands over.

Tug is a download manager made for KDE Plasma first, with a quiet, keyboard-first interface that shows exactly what every download is doing. Underneath, it runs [Mister Download Manager](https://github.com/anefzaoui/misterdownloadmanager)'s download engine.

## Install

Tug runs on 64-bit Linux. Each [release](https://github.com/andymai/tug/releases/latest) has an AppImage and a Flatpak bundle. To use the browser extension, install the AppImage: from inside its sandbox, the Flatpak can't connect a browser to Tug.

### AppImage

1. Download `Tug_<version>_amd64.AppImage` from the [newest release](https://github.com/andymai/tug/releases/latest).
2. Make it executable, and start it:

   ```sh
   chmod +x Tug_*_amd64.AppImage
   ./Tug_*_amd64.AppImage
   ```

### Flatpak

The bundle uses the GNOME 51 runtime from Flathub, which `flatpak install` gets for you.

```sh
curl -LO https://github.com/andymai/tug/releases/latest/download/io.github.andymai.Tug.flatpak
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./io.github.andymai.Tug.flatpak
flatpak run io.github.andymai.Tug
```

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

Tug is in early development. The engine layer, `tug-core`, works and is tested. The desktop app, built with Tauri 2 and React, is in progress.

## Highlights

- **Many connections per file.** Up to 128 (8 by default). When a connection finishes its part, the largest part still remaining is split in half and shared, so every connection stays busy to the end.
- **Resume after a stop or a crash.** Resume state is saved every 2 seconds next to the file, and data goes to a `.part` file that is renamed only when the download is complete.
- **Built for flaky servers.** A failed connection retries at once, then with a doubling delay up to 30 seconds, and the engine learns how many connections each server accepts.
- **HTTP(S) and FTP(S).** Certificates are checked against the system's certificate store.
- **Tested without the internet.** Engine tests run against a local server with injected faults: several connections, stop and resume, and dropped connections, in under 2 seconds.
- **A hardened build.** `unsafe` is forbidden; actions are pinned by SHA; cargo-deny, cargo-audit and OSV scans gate every change; the engine is pinned to one reviewed commit. Details in [SECURITY.md](SECURITY.md).

## Scope

Tug deliberately does not:

- **Copy another download manager's layout.** Its interface is its own, designed for a modern Linux desktop.
- **Target Windows or macOS first.** Linux and Plasma come first.
- **Maintain its own download engine.** The engine is Mister Download Manager's, used as Rust crates pinned to one commit; Tug owns everything above it.

## Architecture

```
desktop app (Tauri 2, React)  ──►  tug-core  ──►  mdm-engine (pinned)
```

| Path | Role |
|---|---|
| `crates/tug-core` | Tug's app layer. The only crate that reaches the engine; it maps the engine's types into Tug's own, so engine changes stop at one module. |
| `brand/` | The T-handle mark, app and tray icons, and the drawn wordmark. `build.py` draws every SVG from one geometry; `export.sh` renders the PNG sizes. |
| `scripts/check-deps.py` | Enforces the engine gate and the single engine pin, including `Cargo.lock`. |

## Build from source

```bash
git clone https://github.com/andymai/tug
cd tug
cargo nextest run --workspace    # or: cargo test --workspace
```

You need Rust (the version is pinned in `rust-toolchain.toml`) and a C compiler. See [CONTRIBUTING.md](CONTRIBUTING.md) for the commit hooks and the checks CI runs.

## License

[GPL-3.0-or-later](LICENSE). Tug's download engine is [Mister Download Manager](https://github.com/anefzaoui/misterdownloadmanager) by Ahmed Nefzaoui, also GPL-3.0-or-later. Tug is an independent project.
