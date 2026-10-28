"""Assets for the deck and poster.

- Blender renders (build/blender/out/*.png) -> compact JPEGs on the shared paper colour
- App screenshots (build/shots/*.png) -> JPEGs
- Top-down plan diagrams drawn straight from the data (crisp at print size)
- route_stats.json: exact numbers for the "same order, two floors" captions
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
OUT = ROOT / "img"
OUT.mkdir(exist_ok=True)
D = json.loads((ROOT / "blender" / "scene.json").read_text())

PAPER = (241, 234, 219)          # floor colour of the Blender renders = deck / poster paper
INK, RULE, SAFETY = (31, 34, 38), (214, 205, 188), (233, 174, 12)
RAMP = ["#D7D3C8", "#A9C3BB", "#4E978A", "#EDB23A", "#E0442A"]


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ramp(v):
    v = max(0.0, min(1.0, v)) * (len(RAMP) - 1)
    i = min(int(v), len(RAMP) - 2)
    a, b = hexrgb(RAMP[i]), hexrgb(RAMP[i + 1])
    return tuple(round(a[k] + (b[k] - a[k]) * (v - i)) for k in range(3))


# ---- renders + screenshots -> JPEG
for p in sorted((ROOT / "blender" / "out").glob("*.png")):
    im = Image.open(p).convert("RGBA")
    bg = Image.new("RGBA", im.size, PAPER + (255,))
    Image.alpha_composite(bg, im).convert("RGB").save(OUT / f"{p.stem}.jpg", quality=90, optimize=True, progressive=True)
    print("render", p.stem, im.size)
for p in sorted((ROOT / "shots").glob("app_*.png")):
    Image.open(p).convert("RGB").save(OUT / f"{p.stem}.jpg", quality=90, optimize=True)
    print("shot", p.stem)

# ---- plan diagrams: dock at the bottom, aisle 01 on the left (as seen from the dock in the app)
S = 4  # supersample
cfg = D["cfg"]
allv = [math.sqrt(v) for L in D["layouts"].values() for v in L["visits"]]
lo, hi = min(allv), max(allv)
W_m, x0 = D["width"] + 2, -1.0          # metres shown across
z_top, z_bot = D["depth"] + 0.3, D["dock"][1] - 3.0
scale = 1000 * S / W_m
H = int((z_top - z_bot) * scale)
font = ImageFont.truetype(r"C:\Windows\Fonts\bahnschrift.ttf", 26 * S)


def X(x):  # web x -> px (mirrored so aisle 01 = largest x is on the left)
    return (D["width"] + 1 - x) * scale


def Y(z):
    return (z_top - z) * scale


for k, L in D["layouts"].items():
    im = Image.new("RGBA", (1000 * S, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)
    # slots
    for s in D["slots"]:
        v = (math.sqrt(L["visits"][s["id"]]) - lo) / (hi - lo)
        x1, x2 = X(s["x"] + cfg["rackD"] / 2), X(s["x"] - cfg["rackD"] / 2)
        y1, y2 = Y(s["z"] + cfg["bayW"] / 2), Y(s["z"] - cfg["bayW"] / 2)
        g.rectangle((x1 + 1.5 * S, y1 + 1.5 * S, x2 - 1.5 * S, y2 - 1.5 * S), fill=ramp(v) + (255,))
    # rack outlines
    for rx in sorted({s["x"] for s in D["slots"]}):
        g.rectangle((X(rx + cfg["rackD"] / 2), Y(D["depth"]), X(rx - cfg["rackD"] / 2), Y(0)), outline=INK + (255,), width=2 * S)
    # dock
    dx, dz = D["dock"]
    g.rectangle((X(dx + 4.5), Y(dz - 0.1), X(dx - 4.5), Y(dz - 2.7)), fill=INK + (255,))
    g.text((X(dx), Y(dz - 1.4)), "DOCK", fill=PAPER + (255,), font=font, anchor="mm")
    for a, ax in enumerate(D["aisleX"]):
        g.text((X(ax), Y(D["frontZ"] + 0.2)), f"{cfg['aisles'] - a:02d}", fill=(125, 120, 108, 255), font=font, anchor="mm")
    im.resize((1000, H // S), Image.LANCZOS).save(OUT / f"plan_{k}.png", optimize=True)
    print("plan", k, L["km"])

# ---- route stats for captions
R = D["sampleRoute"]
slot_aisle = {s["id"]: s["aisle"] for s in D["slots"]}
stats = {"order": R["order"], "lines": R["lines"]}
for k in ("original", "optimized"):
    stats[k] = {"m": round(R[k]["dist"]), "aisles": len({slot_aisle[s] for s in R[k]["slots"]})}
(ROOT / "route_stats.json").write_text(json.dumps(stats, indent=1))
print(stats)
