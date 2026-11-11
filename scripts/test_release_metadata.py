import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ReleaseMetadata(unittest.TestCase):
    # release-please writes the changelog's heading and the MetaInfo's release line in one run,
    # so stores show the date of each release, not the date of the first one.
    def test_the_metainfo_names_the_newest_release_and_its_date(self):
        changelog = (ROOT / "CHANGELOG.md").read_text()
        newest = re.search(r"^## \[(\d+\.\d+\.\d+)\]\(.*?\) \((\d{4}-\d{2}-\d{2})\)$", changelog, re.MULTILINE)
        metainfo = (ROOT / "packaging" / "io.github.andymai.Tug.metainfo.xml").read_text()
        release = re.search(r'<release version="([^"]+)" date="([^"]+)"/><!-- x-release-please-version-date -->', metainfo)
        self.assertIsNotNone(newest)
        self.assertIsNotNone(release, "the release line needs the x-release-please-version-date marker")
        self.assertEqual(release.groups(), newest.groups())


if __name__ == "__main__":
    unittest.main()
