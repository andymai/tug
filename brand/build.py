import pathlib
import sys

C = {
    "harbor800": "#142645", "signal800": "#A9420F", "signal600": "#E35F1C", "signal500": "#FF7A33",
    "white": "#FFFFFF", "paper": "#F6F8FC",
}

# Units of the 128 px icon. The face and its darker lower edge fill 12 to 116, the square of
# Flathub's icon grid to the outer edge of its line, so a store shows Tug at the size of its
# other apps.
FACE = (12, 12, 116, 108)
EDGE = 8
RADIUS = 24
HANDLE = (34, 24, 94, 40)
COLUMN = (58, 70)
PARTS = ((44, 54), (58, 68))
STEM = (72, 86)
HEAD = ((44, 70), (64, 90), (84, 70))
STROKE = 12
GLYPH_BOX = (34, 24, 94, 96)

# Drawn again for each small size on whole pixels: the master would put the parts and the
# arrow's edges between pixels. head is the arrow's left edge, its top and right edges, and
# its thickness; its 45° edges meet the corners of pixels.
HINTED = {
    32: dict(face=(3, 3, 29, 27), edge=2, radius=6, handle=(9, 6, 23, 10), column=(15, 17), parts=((11, 13), (14, 16)), stem=(17, 22), head=(11, 17, 21, 3)),
    24: dict(face=(2, 2, 22, 20), edge=2, radius=5, handle=(6, 4, 18, 7), column=(11, 13), parts=((8, 10),), stem=(11, 15), head=(8, 11, 16, 3)),
    22: dict(face=(1, 1, 21, 19), edge=2, radius=5, handle=(5, 3, 17, 6), column=(10, 12), parts=((7, 9),), stem=(10, 14), head=(7, 10, 15, 3)),
    16: dict(face=(1, 1, 15, 14), edge=1, radius=3.5, handle=(4, 3, 12, 5), column=(7, 9), parts=((6, 7),), stem=(8, 11), head=(5, 8, 11, 2)),
}

KDE = '<style id="current-color-scheme">.ColorScheme-Text{color:#232629;}</style>'
LINE = 'fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"'
CUT = 'fill="none" stroke="currentColor" stroke-width="1"'
# One-pixel lines on half-pixel coordinates, as Breeze draws the panel's other icons. The parts
# have flat ends, so each one fills whole pixels and the gaps between them stay clear.
SYMBOLIC = {
    16: f'<rect x="2.5" y="2.5" width="10" height="2" rx="1" {LINE}/><path d="M7.5 6V8" {CUT}/>'
    f'<path d="M7.5 9.5V12.5M4.5 9.5L7.5 12.5L10.5 9.5" {LINE}/>',
    22: f'<rect x="4.5" y="3.5" width="12" height="2" rx="1" {LINE}/><path d="M10.5 7V9M10.5 10V12" {CUT}/>'
    f'<path d="M10.5 13.5V17.5M6.5 13.5L10.5 17.5L14.5 13.5" {LINE}/>',
}
# The glyph inside the tray's progress ring: smaller than the 22 px symbolic icon, so it fits
# in the ring, and drawn at this size, so its lines stay one pixel wide on column 10, the ring's.
RING = f'<path d="M7.5 6.5H13.5M10.5 10.5V15.5M7.5 12.5L10.5 15.5L13.5 12.5" {LINE}/><path d="M10.5 8V9" {CUT}/>'
RING_CENTER = (10.5, 11)
RING_RADIUS = 9

# "Tug" in Geist SemiBold (SIL Open Font License), kerned, in font units: cap height 710 above
# the baseline. Outlines, so GitHub and other pages draw the name without the font.
NAME = "M227 0V-597H11V-710H572V-597H357V0ZM772 12Q691 12 643.5 -41.5Q596 -95 596 -190V-534H724V-222Q724 -155 746.5 -123.5Q769 -92 815 -92Q867 -92 895.5 -126.5Q924 -161 924 -227V-534H1052V0H935L932 -147L948 -142Q936 -66 891 -27Q846 12 772 12ZM1411 162Q1341 162 1291 143Q1241 124 1210.5 89.5Q1180 55 1168 10L1300 1Q1310 31 1334.5 48Q1359 65 1411 65Q1470 65 1502 38.5Q1534 12 1534 -44V-112Q1515 -73 1473 -49.5Q1431 -26 1379 -26Q1313 -26 1261.5 -58.5Q1210 -91 1181 -149.5Q1152 -208 1152 -285Q1152 -362 1180.5 -420.5Q1209 -479 1260 -512.5Q1311 -546 1377 -546Q1435 -546 1477 -520Q1519 -494 1538 -451V-534H1663V-47Q1663 21 1631.5 68Q1600 115 1543.5 138.5Q1487 162 1411 162ZM1409 -126Q1466 -126 1500 -168.5Q1534 -211 1535 -286Q1536 -336 1520.5 -371.5Q1505 -407 1476.5 -426.5Q1448 -446 1409 -446Q1350 -446 1317.5 -402.5Q1285 -359 1285 -286Q1285 -213 1318.5 -169.5Q1352 -126 1409 -126Z"
NAME_BOX = (11, -710, 1663, 162)
CAP = 710


def svg(view, body, w=None, h=None, label=None):
    size = f' width="{w}" height="{h}"' if w else ""
    role = f' role="img" aria-label="{label}"' if label else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{size}{role}>{body}</svg>\n'


def rect(x0, y0, x1, y1, fill, rx=0):
    r = f' rx="{rx:g}"' if rx else ""
    return f'<rect x="{x0:g}" y="{y0:g}" width="{x1 - x0:g}" height="{y1 - y0:g}"{r} fill="{fill}"/>'


def glyph(arrow, handle):
    c0, c1 = COLUMN
    (lx, ly), (tx, ty), (rx, ry) = HEAD
    return (
        "".join(rect(c0, a, c1, b, arrow, 3) for a, b in PARTS)
        + rect(c0, STEM[0], c1, STEM[1], arrow)
        + f'<path d="M{lx} {ly}L{tx} {ty}L{rx} {ry}" fill="none" stroke="{arrow}" stroke-width="{STROKE}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        + rect(*HANDLE, handle, (HANDLE[3] - HANDLE[1]) / 2)
    )


def face(x0, y0, x1, y1, edge, radius, uid):
    return (
        f'<defs><linearGradient id="{uid}" x1="0" y1="{y0:g}" x2="0" y2="{y1:g}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{C["signal500"]}"/><stop offset="1" stop-color="{C["signal600"]}"/></linearGradient></defs>'
        + rect(x0, y0 + edge, x1, y1 + edge, C["signal800"], radius)
        + rect(x0, y0, x1, y1, f"url(#{uid})", radius)
    )


def icon(uid="tug-face"):
    return face(*FACE, EDGE, RADIUS, uid) + glyph(C["white"], C["harbor800"])


def chevron(left, top, right, thick, cx):
    d = cx - left
    points = [(left, top), (cx, top + d), (right, top), (right, top + thick), (cx, top + d + thick), (left, top + thick)]
    return "M" + "L".join(f"{x:g} {y:g}" for x, y in points) + "Z"


def hinted(spec):
    c0, c1 = spec["column"]
    hx0, hy0, hx1, hy1 = spec["handle"]
    left, top, right, thick = spec["head"]
    return (
        face(*spec["face"], spec["edge"], spec["radius"], "tug-face")
        + "".join(rect(c0, a, c1, b, C["white"]) for a, b in (*spec["parts"], spec["stem"]))
        + f'<path d="{chevron(left, top, right, thick, (c0 + c1) / 2)}" fill="{C["white"]}"/>'
        + rect(hx0, hy0, hx1, hy1, C["harbor800"], (hy1 - hy0) / 2)
    )


def name(color, x, baseline, cap):
    k = cap / CAP
    return f'<path transform="translate({x - NAME_BOX[0] * k:g} {baseline:g}) scale({k:g})" fill="{color}" d="{NAME}"/>'


def lockup(body, box, color):
    left, top, right, bottom = box
    cap = (FACE[3] + EDGE - FACE[1]) * 0.52
    baseline = (FACE[1] + FACE[3]) / 2 + cap / 2
    k = cap / CAP
    x = right + 18
    top, bottom = min(top, baseline + NAME_BOX[1] * k), max(bottom, baseline + NAME_BOX[3] * k)
    width = x + (NAME_BOX[2] - NAME_BOX[0]) * k
    return svg(f"{left:g} {top:g} {width - left:g} {bottom - top:g}", body + name(color, x, baseline, cap), label="Tug")


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    files = {"icon.svg": svg("0 0 128 128", icon(), 128, 128)}
    pad = (FACE[2] - FACE[0]) * 16 / 96
    view = f"{FACE[0] - pad:.2f} {FACE[1] - pad:.2f} {FACE[2] - FACE[0] + 2 * pad:.2f} {FACE[2] - FACE[0] + 2 * pad:.2f}"
    files["icon-store.svg"] = svg(view, icon(), 128, 128)
    for px, spec in HINTED.items():
        files[f"icon-{px}.svg"] = svg(f"0 0 {px} {px}", hinted(spec), px, px)
    for px, body in SYMBOLIC.items():
        files["symbolic.svg" if px == 16 else f"symbolic-{px}.svg"] = svg(f"0 0 {px} {px}", KDE + f'<g class="ColorScheme-Text">{body}</g>', px, px)
    files["ring-glyph.svg"] = svg("0 0 22 22", KDE + f'<g class="ColorScheme-Text">{RING}</g>', 22, 22)
    x0, y0, x1, y1 = GLYPH_BOX
    for stem, arrow, handle in (
        ("mark", C["harbor800"], C["signal600"]),
        ("mark-dark", C["paper"], C["signal500"]),
        ("mark-mono", "currentColor", "currentColor"),
    ):
        files[f"{stem}.svg"] = svg(f"{x0} {y0} {x1 - x0} {y1 - y0}", glyph(arrow, handle), label="Tug")
    n0, n1, n2, n3 = NAME_BOX
    for stem, color in (("wordmark", "currentColor"), ("wordmark-light", C["harbor800"]), ("wordmark-dark", C["paper"])):
        files[f"{stem}.svg"] = svg(f"{n0} {n1} {n2 - n0} {n3 - n1}", f'<path fill="{color}" d="{NAME}"/>', label="Tug")
    plate = (FACE[0], FACE[1], FACE[2], FACE[3] + EDGE)
    files["lockup.svg"] = lockup(icon(), plate, C["harbor800"])
    files["lockup-dark.svg"] = lockup(icon(), plate, C["paper"])
    files["lockup-mono.svg"] = lockup(glyph("currentColor", "currentColor"), GLYPH_BOX, "currentColor")
    for file, text in files.items():
        (out / file).write_text(text)
    return files


if __name__ == "__main__":
    print("wrote", len(build(pathlib.Path(sys.argv[1]))), "files")
