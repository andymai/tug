import re
import unittest
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METAINFO = ROOT / "packaging" / "io.github.andymai.Tug.metainfo.xml"


class ReleaseMetadata(unittest.TestCase):
    # release-please writes the changelog's heading and the MetaInfo's release line in one run,
    # so stores show the date of each release, not the date of the first one.
    def test_the_metainfo_names_the_newest_release_and_its_date(self):
        changelog = (ROOT / "CHANGELOG.md").read_text()
        newest = re.search(r"^## \[(\d+\.\d+\.\d+)\]\(.*?\) \((\d{4}-\d{2}-\d{2})\)$", changelog, re.MULTILINE)
        metainfo = METAINFO.read_text()
        release = re.search(r'<release version="([^"]+)" date="([^"]+)"/><!-- x-release-please-version-date -->', metainfo)
        self.assertIsNotNone(newest)
        self.assertIsNotNone(release, "the release line needs the x-release-please-version-date marker")
        self.assertEqual(release[1], newest[1])
        # The changelog's date is in UTC and the MetaInfo's in the clock of the run, so they can differ by a day.
        self.assertLessEqual(abs((date.fromisoformat(release[2]) - date.fromisoformat(newest[2])).days), 1)

    # appstreamcli compose downloads each screenshot during the Flatpak build, and drops one that it
    # can't get. Only the release's tag has the files before the build, and release-please writes
    # the tag into each line between its two markers. The Flatpak workflow reads each URL with grep.
    def test_each_screenshot_is_a_file_at_the_tag_of_the_release(self):
        metainfo = METAINFO.read_text()
        root = ET.fromstring(metainfo)
        version = root.find("releases/release").get("version")
        base = f"https://raw.githubusercontent.com/andymai/tug/v{version}/"
        urls = [image.text for image in root.iter("image")]
        self.assertTrue(urls, "the MetaInfo names no screenshot")
        for url in urls:
            self.assertTrue(url.startswith(base), f"{url} does not start with {base}")
            self.assertTrue((ROOT / url.removeprefix(base)).is_file(), f"{url} names no file in the repository")
        block = re.search(r"<!-- x-release-please-start-version -->\n(.*?)<!-- x-release-please-end -->", metainfo, re.DOTALL)
        self.assertIsNotNone(block, "the screenshots need the x-release-please-start-version and -end markers")
        self.assertEqual(re.findall(r"<image[^>]*>([^<\n]*)</image>", block[1]), urls)


if __name__ == "__main__":
    unittest.main()
