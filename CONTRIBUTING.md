# Contributing

## Setup

1. Install Rust via [rustup](https://rustup.rs/). `rust-toolchain.toml` pins the version and pulls in rustfmt and clippy.
2. Install a C compiler (`gcc` or `clang`); the engine builds a small C library.
3. Install Node.js 24+ and [pnpm](https://pnpm.io/), then run `pnpm install` to enable the commit hooks.
4. Build and test:

   ```bash
   cargo build
   cargo nextest run --workspace   # cargo install cargo-nextest
   ```

## Workflow

1. Branch from `main` as `<type>/<kebab-description>`, for example `feat/download-queue`.
2. Make the change with tests alongside the code.
3. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message. The commit-msg hook runs commitlint; the pre-commit hook runs `cargo fmt`, `cargo clippy`, `scripts/check-deps.py`, `taplo fmt` and `cargo machete`.
4. Open a pull request. The title must also be a conventional commit subject, because squash merges use it and release-please reads it.

CI gates every PR on format, clippy, tests, MSRV, rustdoc, the dependency rules, cargo-deny, cargo-audit, unused dependencies, TOML format, and an OSV scan. The `CI Pass` check must be green to merge.

## Commit Messages

```
feat: resume paused downloads after a restart
fix: keep the speed limit when a download is resumed
perf: batch progress updates for all running downloads
docs: describe the engine gate
refactor: split the transfer into its own module
test: cover a server that drops every second connection
chore: move the engine pin to the latest MDM commit
```

`feat` and `fix` appear in the changelog and drive the version bump. Breaking changes carry a `!` after the type or a `BREAKING CHANGE:` footer.

## Code Style

- `rustfmt` defaults, enforced by CI.
- `unsafe` is forbidden. `unwrap()`, `expect()`, `panic!`, `todo!`, `dbg!` and printing are denied outside tests; propagate errors with `?`.
- Only `crates/tug-core` depends on the engine (`mdm-*` crates), and it maps the engine's types into Tug's own. `scripts/check-deps.py` enforces this.
- Comments explain a non-obvious why, never what the code already says.

## Testing

Engine behavior is tested offline in `crates/tug-core/tests/` against MDM's lab server, which serves generated files whose bytes the tests can rebuild and injects faults through the URL (`rate`, `drop_after`, `drop_every`, `max_conns`, `no_range`). Add a test for every engine behavior Tug relies on.

## Releases

release-please opens a release PR from the merged conventional commits and updates `CHANGELOG.md` and the version in `Cargo.toml`. Do not edit those by hand.

## License

Contributions are licensed under GPL-3.0-or-later.
