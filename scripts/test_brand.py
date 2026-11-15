import importlib.util
import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"


def load():
    spec = importlib.util.spec_from_file_location("brand_build", BRAND / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tokens():
    return {t["name"]: t["value"] for t in json.loads((ROOT / "design" / "tokens.json").read_text())["color"]["tokens"]}


class Brand(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = load()

    def build(self):
        with tempfile.TemporaryDirectory() as tmp:
            return self.b.build(Path(tmp))

    # Flathub's icon grid has a square of 103 px in a 128 px canvas.
    def test_the_plate_fills_the_square_of_the_flathub_grid(self):
        x0, y0, x1, y1 = self.b.FACE
        bottom = y1 + self.b.EDGE
        self.assertEqual(x1 - x0, bottom - y0, "the face and its edge make a square")
        self.assertAlmostEqual(x1 - x0, 103, delta=1)
        self.assertEqual((x0 + x1) / 2, 64)
        self.assertEqual((y0 + bottom) / 2, 64)

    def test_the_glyph_sits_in_the_middle_of_the_face(self):
        gx0, gy0, gx1, gy1 = self.b.GLYPH_BOX
        x0, y0, x1, y1 = self.b.FACE
        self.assertEqual(gx0 + gx1, x0 + x1)
        self.assertEqual(gy0 + gy1, y0 + y1)

    def test_the_glyph_box_holds_the_handle_and_the_arrow(self):
        (lx, _), (tx, ty), (rx, _) = self.b.HEAD
        half = self.b.STROKE / 2
        hx0, hy0, hx1, _ = self.b.HANDLE
        self.assertEqual(self.b.GLYPH_BOX, (hx0, hy0, hx1, ty + half))
        self.assertGreaterEqual(lx - half, hx0)
        self.assertLessEqual(rx + half, hx1)
        self.assertEqual(tx, sum(self.b.COLUMN) / 2)

    def test_the_parts_leave_equal_gaps_from_the_handle_to_the_arrow(self):
        edges = [self.b.HANDLE[3], *[y for part in self.b.PARTS for y in part], self.b.STEM[0]]
        gaps = {edges[i + 1] - edges[i] for i in range(0, len(edges), 2)}
        self.assertEqual(len(gaps), 1, gaps)

    def test_each_small_icon_puts_its_edges_on_whole_pixels(self):
        for px, spec in self.b.HINTED.items():
            with self.subTest(px=px):
                parts = [y for part in spec["parts"] for y in part]
                values = [*spec["face"], spec["edge"], *spec["handle"], *spec["column"], *parts, *spec["stem"], *spec["head"]]
                self.assertTrue(all(float(v).is_integer() for v in values), values)
                x0, _, x1, y1 = spec["face"]
                self.assertLessEqual(y1 + spec["edge"], px)
                c0, c1 = spec["column"]
                hx0, _, hx1, _ = spec["handle"]
                left, top, right, thick = spec["head"]
                self.assertEqual(c0 + c1, x0 + x1, "the shaft is in the middle of the face")
                self.assertEqual(hx0 + hx1, x0 + x1, "the handle is in the middle of the face")
                self.assertEqual(left + right, x0 + x1, "the arrow is in the middle of the face")
                self.assertLessEqual(top + (c0 + c1) / 2 - left + thick, y1, "the arrow ends on the face")

    def test_the_symbolic_icons_keep_the_class_that_plasma_recolors(self):
        files = self.build()
        for name in ("symbolic.svg", "symbolic-22.svg"):
            with self.subTest(name=name):
                self.assertIn('class="ColorScheme-Text"', files[name])
                self.assertEqual(set(re.findall(r'stroke-width="([^"]+)"', files[name])), {"1"})

    # The Chrome Web Store asks for 96 px of artwork in a 128 px icon.
    def test_the_store_icon_shows_the_plate_at_96_of_128_px(self):
        files = self.build()
        width = float(re.search(r'viewBox="([^"]+)"', files["icon-store.svg"])[1].split()[2])
        self.assertAlmostEqual((self.b.FACE[2] - self.b.FACE[0]) * 128 / width, 96, delta=0.1)

    def test_the_colors_are_the_design_tokens(self):
        named = tokens()
        for key, value in self.b.C.items():
            name = re.sub(r"(\d+)$", r"-\1", key)
            if name in named:
                self.assertEqual(value.upper(), named[name].upper(), name)

    # Flathub and Bazaar paint the brand color behind the icon, so it must not be orange.
    def test_the_metainfo_brand_colors_are_harbor_tints(self):
        root = ET.parse(ROOT / "packaging" / "io.github.andymai.Tug.metainfo.xml").getroot()
        colors = {c.get("scheme_preference"): c.text for c in root.iter("color")}
        named = tokens()
        self.assertEqual(colors, {"light": named["harbor-200"], "dark": named["harbor-700"]})

    def test_the_committed_svgs_are_what_build_py_writes(self):
        files = self.build()
        self.assertEqual({p.name for p in (BRAND / "svg").glob("*.svg")}, set(files), "run brand/export.sh")
        for name, text in files.items():
            with self.subTest(name=name):
                self.assertEqual((BRAND / "svg" / name).read_text(), text, "run brand/export.sh")


if __name__ == "__main__":
    unittest.main()
