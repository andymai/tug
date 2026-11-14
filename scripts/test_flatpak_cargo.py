import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("flatpak-cargo.sh")

# Stand-ins: cargo writes Tug's crates, one dependency and a registry file; rustc
# prints the version in RUSTC_VERSION; install only says what it would install.
CARGO = """\
#!/bin/sh
echo "ccache up to $CCACHE_MAXSIZE"
release="$CARGO_TARGET_DIR/release"
mkdir -p "$release/deps" "$release/.fingerprint/tug-core-1" "$release/.fingerprint/serde-1" "$CARGO_HOME/registry"
echo binary > "$release/tug"
: > "$release/deps/libtug_core-1.rlib"
: > "$release/deps/libserde-1.rlib"
: > "$CARGO_HOME/registry/serde-1.crate"
"""
RUSTC = '#!/bin/sh\necho "rustc $RUSTC_VERSION"\n'
INSTALL = '#!/bin/sh\necho "install $*"\n'


class FlatpakCargo(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.bin = root / "bin"
        self.bin.mkdir()
        for name, body in (("cargo", CARGO), ("rustc", RUSTC), ("install", INSTALL)):
            tool = self.bin / name
            tool.write_text(body)
            tool.chmod(0o755)
        self.cache = root / "ccache"
        self.cache.mkdir()
        self.release = self.cache / "target" / "release"

    def tearDown(self):
        self.folder.cleanup()

    def build(self, rustc: str = "1.95.0", limit_mb: int = 4096) -> str:
        env = os.environ | {
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FLATPAK_CARGO_CACHE": str(self.cache),
            "FLATPAK_CARGO_CACHE_MB": str(limit_mb),
            "RUSTC_VERSION": rustc,
        }
        done = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, check=True)
        return done.stdout

    def test_tugs_crates_leave_and_the_dependencies_stay(self):
        said = self.build()
        self.assertIn("ccache up to 500M", said)
        self.assertIn(f"install -Dm755 {self.release}/tug /app/bin/tug", said)
        self.assertTrue((self.release / "deps" / "libserde-1.rlib").exists())
        self.assertTrue((self.release / ".fingerprint" / "serde-1").exists())
        self.assertFalse((self.release / "tug").exists())
        self.assertFalse((self.release / "deps" / "libtug_core-1.rlib").exists())
        self.assertFalse((self.release / ".fingerprint" / "tug-core-1").exists())

    def test_the_same_rustc_keeps_the_builds(self):
        self.build()
        kept = self.release / "deps" / "kept.rlib"
        kept.touch()
        self.build()
        self.assertTrue(kept.exists())

    def test_a_new_rustc_starts_the_builds_again_and_keeps_the_registry(self):
        self.build()
        kept = self.release / "deps" / "kept.rlib"
        kept.touch()
        # The stand-in cargo writes its own crate again on each build, so the test keeps one of its own.
        crate = self.cache / "cargo" / "registry" / "kept.crate"
        crate.touch()
        said = self.build(rustc="1.96.0")
        self.assertIn("a new rustc", said)
        self.assertFalse(kept.exists())
        self.assertTrue(crate.exists())
        self.assertEqual((self.cache / "target" / "rustc-version").read_text(), "rustc 1.96.0\n")

    def test_a_cache_over_the_limit_starts_all_of_it_again(self):
        self.build()
        (self.cache / "cargo" / "registry" / "big.crate").write_bytes(b"\0" * (2 << 20))
        said = self.build(limit_mb=1)
        self.assertIn("starts again from nothing", said)
        self.assertFalse((self.cache / "cargo" / "registry" / "big.crate").exists())


if __name__ == "__main__":
    unittest.main()
