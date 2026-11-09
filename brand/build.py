import math
import pathlib
import sys

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

C = {
    "harbor950": "#0A1428", "harbor900": "#0E1B33", "harbor800": "#142645",
    "harbor700": "#1B3259", "harbor600": "#24406F", "harbor500": "#31558F",
    "harbor300": "#8FA9D6", "harbor100": "#E3EAF6",
    "signal600": "#E35F1C", "signal500": "#FF7A33", "signal400": "#FF9558", "signal100": "#FFE8DA",
    "white": "#F6F8FC",
}

MARK_W, MARK_H = 160, 170


def mark(handle, arrow, s=1.0, ox=0.0, oy=0.0):
    return (
        f'<g transform="translate({ox:g} {oy:g}) scale({s:g})">'
        f'<rect x="64" y="16" width="32" height="138" fill="{arrow}"/>'
        f'<path d="M36 110 L80 154 L124 110" fill="none" stroke="{arrow}" stroke-width="32" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<rect x="0" y="0" width="160" height="32" rx="16" fill="{handle}"/>'
        f'</g>'
    )


def pixel_mark(handle, arrow, hx, hy, hw, w, cx, vy, arm):
    return (
        f'<rect x="{cx - w / 2:g}" y="{hy + w / 2:g}" width="{w:g}" height="{vy - hy - w / 2:g}" fill="{arrow}"/>'
        f'<path d="M{cx - arm:g} {vy - arm:g} L{cx:g} {vy:g} L{cx + arm:g} {vy - arm:g}" fill="none" stroke="{arrow}" '
        f'stroke-width="{w:g}" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<rect x="{hx:g}" y="{hy:g}" width="{hw:g}" height="{w:g}" rx="{w / 2:g}" fill="{handle}"/>'
    )


def squircle(cx, cy, r, n=5.0, steps=360):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append(f"{cx + r * math.copysign(abs(c) ** (2 / n), c):.2f},{cy + r * math.copysign(abs(s) ** (2 / n), s):.2f}")
    return "M" + " L".join(pts) + " Z"


def svg(view, body, w=None, h=None):
    size = f' width="{w}" height="{h}"' if w else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{size}>{body}</svg>\n'


PLATE = squircle(128, 128, 120)
DEFS = f"""<defs>
<linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28497F"/><stop offset="1" stop-color="#101E3A"/></linearGradient>
<radialGradient id="sheen" cx="0.28" cy="0" r="0.95"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.16"/></linearGradient>
<linearGradient id="handle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9352"/><stop offset="1" stop-color="#F26A24"/></linearGradient>
<linearGradient id="arrow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FAFBFE"/><stop offset="1" stop-color="#E2E8F3"/></linearGradient>
<clipPath id="clip"><path d="{PLATE}"/></clipPath>
<filter id="lift" x="-25%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#050B18" flood-opacity="0.42"/></filter>
</defs>"""

S_ICON = 0.85
icon = (
    DEFS
    + f'<path d="{PLATE}" fill="url(#plate)"/><path d="{PLATE}" fill="url(#sheen)"/><path d="{PLATE}" fill="url(#shade)"/>'
    + f'<path d="{PLATE}" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="3" clip-path="url(#clip)"/>'
    + f'<g filter="url(#lift)">{mark("url(#handle)", "url(#arrow)", S_ICON, 128 - 80 * S_ICON, 130 - 85 * S_ICON)}</g>'
)
(OUT / "icon.svg").write_text(svg("0 0 256 256", icon))

HINTED = {
    16: dict(plate=(0, 0, 16, 3.5), g=dict(hx=3, hy=3, hw=10, w=2, cx=8, vy=12, arm=3)),
    22: dict(plate=(1, 1, 20, 5), g=dict(hx=4, hy=4, hw=14, w=2, cx=11, vy=16, arm=4)),
    24: dict(plate=(1, 1, 22, 5.5), g=dict(hx=5, hy=5, hw=14, w=2, cx=12, vy=17, arm=4)),
    32: dict(plate=(1, 1, 30, 7.5), g=dict(hx=7, hy=7, hw=18, w=4, cx=16, vy=23, arm=5)),
}
for px, spec in HINTED.items():
    x, y, size, r = spec["plate"]
    body = (
        f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{r}" fill="{C["harbor700"]}"/>'
        + pixel_mark(C["signal500"], C["white"], **spec["g"])
    )
    (OUT / f"icon-{px}.svg").write_text(svg(f"0 0 {px} {px}", body, px, px))

KDE = '<style id="current-color-scheme">.ColorScheme-Text{color:#232629;}</style>'
LINE = 'fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"'
# One-pixel lines on half-pixel coordinates, as Breeze draws the panel's other icons:
# the handle is an outlined pill, the rod and the arrow single lines, all centred on a pixel column.
SYMBOLIC = {
    16: f'<rect x="2.5" y="2.5" width="10" height="2" rx="1" {LINE}/><path d="M7.5 4.5V12.5M4.5 9.5L7.5 12.5L10.5 9.5" {LINE}/>',
    22: f'<rect x="4.5" y="3.5" width="12" height="2" rx="1" {LINE}/><path d="M10.5 5.5V17.5M6.5 13.5L10.5 17.5L14.5 13.5" {LINE}/>',
}
for px, glyph in SYMBOLIC.items():
    body = KDE + f'<g class="ColorScheme-Text">{glyph}</g>'
    (OUT / ("symbolic.svg" if px == 16 else f"symbolic-{px}.svg")).write_text(svg(f"0 0 {px} {px}", body, px, px))

for name, handle, arrow in (
    ("mark", C["signal600"], C["harbor800"]),
    ("mark-dark", C["signal500"], C["white"]),
    ("mark-mono", "currentColor", "currentColor"),
):
    (OUT / f"{name}.svg").write_text(svg(f"0 0 {MARK_W} {MARK_H}", mark(handle, arrow)))

WORD_W, WORD_H = 208, 130


def wordmark(color, W=18):
    h = W / 2
    return (
        f'<g fill="{color}"><rect x="9" y="8" width="{W}" height="92"/>'
        f'<rect x="0" y="30" width="46" height="{W}" rx="{h}"/></g>'
        f'<g fill="none" stroke="{color}" stroke-width="{W}">'
        f'<path d="M67 30 V70 A23 23 0 0 0 113 70"/><path d="M113 30 V100"/>'
        f'<circle cx="170" cy="65" r="28"/><path d="M198 30 V102 A18 18 0 0 1 180 120 H160"/></g>'
    )


for name, color in (("wordmark", "currentColor"), ("wordmark-light", C["harbor800"]), ("wordmark-dark", C["white"])):
    (OUT / f"{name}.svg").write_text(svg(f"0 0 {WORD_W} {WORD_H}", wordmark(color)))

K = 108 / MARK_H
GAP = 34


def lockup(handle, arrow, text):
    body = mark(handle, arrow, K, 0, -4) + f'<g transform="translate({MARK_W * K + GAP:.1f} 0)">{wordmark(text)}</g>'
    return svg(f"0 -4 {MARK_W * K + GAP + WORD_W:.0f} {WORD_H + 4}", body)


(OUT / "lockup.svg").write_text(lockup(C["signal600"], C["harbor800"], C["harbor800"]))
(OUT / "lockup-dark.svg").write_text(lockup(C["signal500"], C["white"], C["white"]))
(OUT / "lockup-mono.svg").write_text(lockup("currentColor", "currentColor", "currentColor"))
print("wrote", len(list(OUT.iterdir())), "files")
