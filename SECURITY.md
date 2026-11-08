# Security Policy

## Reporting a Vulnerability

Use [GitHub Security Advisories](https://github.com/andymai/tug/security/advisories/new) for private disclosure.

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Expect an initial response within 48 hours.

## What Tug Does on Your Machine

Tug downloads files over HTTP(S) and FTP(S) into the folder you choose. Data is written to `<file>.mdm.part` next to the target and renamed into place only when the download is complete, so a file under its final name is always whole. Each unfinished download keeps its resume state in `<file>.mdm.json` beside it. HTTPS and FTPS certificates are checked against the system's certificate store.

The download engine is Mister Download Manager's, used as Rust crates pinned to one reviewed commit. A security fix upstream reaches Tug when that pin moves, which happens in its own pull request after the engine tests pass.

## Supply Chain

The build fails closed on the patterns the 2025-2026 npm and GitHub Actions supply-chain attacks exploited:

| Defense | Where | What it blocks |
|---|---|---|
| All GitHub Actions pinned to commit SHA | `.github/workflows/*.yml` | Tag-retag attacks. |
| OSV scan against `Cargo.lock` and `pnpm-lock.yaml` (PRs report-only, main blocking, weekly) | `.github/workflows/osv-scan.yml` | Known-CVE versions in either ecosystem. |
| cargo-deny license and source policy, cargo-audit advisories | `deny.toml`, `.github/workflows/ci.yml` | Unvetted licenses, unknown registries, git sources other than the engine's, RustSec advisories. |
| The engine pinned to one commit, checked against `Cargo.lock` | `scripts/check-deps.py` | A silently moved or split engine version. |
| Dependabot cooldown (7d default, 14d major) across cargo, npm, github-actions | `.github/dependabot.yml` | Fresh malicious uploads. |
| Workflow tokens default to no permissions; each job opts in | `.github/workflows/*.yml` | Credential reach from a compromised step. |
