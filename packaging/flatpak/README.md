# Tug's Flatpak repository

With each release, the `repo` and `pages` jobs in `.github/workflows/flatpak.yml` publish Tug's own Flatpak repository at <https://andymai.github.io/tug/>. Users add it through `tug.flatpakrepo`, and Bazaar and other Flatpak stores list Tug from it.

## The signing key

The `FLATPAK_SIGNING_KEY` secret signs the repository. It is an armored GPG secret key without a passphrase. Its public half is `tug-repo.asc` in this folder, with this fingerprint:

```text
AFDF 3610 F032 4747 2F2C  DB1C CA33 408B 0430 EFD1
```

A release stops when the secret is empty or when it holds another key.

Keep a copy of the secret key outside GitHub, for example in a password manager, because GitHub never shows a secret again.

## Setup

1. Make a key, and give it an empty passphrase:

   ```sh
   gpg --quick-gen-key "Tug Flatpak repository" rsa4096 sign never
   ```

2. Put its public half in this folder, with the fingerprint that gpg printed:

   ```sh
   gpg --armor --export FINGERPRINT > packaging/flatpak/tug-repo.asc
   ```

3. Store its secret half in the repository:

   ```sh
   gpg --armor --export-secret-keys FINGERPRINT | gh secret set FLATPAK_SIGNING_KEY
   ```

4. Turn on GitHub Pages, with GitHub Actions as its source. The `github-pages` environment must let `main` deploy.

   ```sh
   gh api -X POST repos/andymai/tug/pages -f build_type=workflow
   ```

## A new key

A client that added the remote trusts only the key in the `tug.flatpakrepo` that it read, and it refuses a commit that another key signed. So a new key needs these steps:

1. Do the setup steps with the new key, and merge the new `tug-repo.asc`.
2. Turn GitHub Pages off and on again. The next release checks the published commits with the new key and stops on the old ones. Without a published site, it starts a new repository.
3. Tell users to add the remote again: `flatpak remote-delete tug`, then the `remote-add` from the README.
