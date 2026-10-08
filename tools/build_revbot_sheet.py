"""Bake RevBot's web sprite sheet from the Desktop-Pet v3 atlas (the charcoal,
yellow-striped look cut from Dave's videos; NOT the red 1.0 example sheet).

Reads  M:/Projects/Desktop-Pet/src/DesktopPet/Assets/atlas.{json,png}
Writes deploy/public_html/assets/revbot.webp and assets/revbot.webp
Prints the SPRITE block for main.js.

The page plays a fixed-cell grid, one row per animation, frames left to right,
feet anchored at the cell's bottom centre (the atlas carries ox/oy per frame).
Long clips are thinned to MAX_FRAMES; each row keeps its own fps so thinning
does not change the speed on screen.
"""
import json
from pathlib import Path
from PIL import Image

PET = Path("M:/Projects/Desktop-Pet/src/DesktopPet/Assets")
SITE = Path(__file__).resolve().parents[1]
OUT = [SITE / "deploy/public_html/assets/revbot.webp", SITE / "assets/revbot.webp"]

SCALE = 0.6           # 172 px tall at source -> ~103 px on the page
MAX_FRAMES = 16

# web row -> (atlas clip, flip)
ROWS = [
    ("idle",     "idle",       False),
    ("runRight", "walk_right", False),
    ("runLeft",  "walk_right", True),
    ("wave",     "wave",       False),
    ("jump",     "jump",       False),
    ("failed",   "failed",     False),
    ("waiting",  "waiting",    False),
    ("running",  "working",    False),
    ("review",   "review",     False),
    ("happy",    "happy",      False),
    ("sleep",    "sleeping",   False),
    ("held",     "held",       False),
]

atlas = json.loads((PET / "atlas.json").read_text(encoding="utf-8"))
sheet = Image.open(PET / "atlas.png").convert("RGBA")
frames = {}
for f in atlas["frames"]:
    frames.setdefault(f["row"], {})[f["index"]] = f


def thin(seq, n):
    if len(seq) <= n:
        return list(seq)
    return [seq[round(i * (len(seq) - 1) / (n - 1))] for i in range(n)]


rows = []
for web, clip, flip in ROWS:
    c = atlas["clips"][clip]
    seq = thin(c["frames"], MAX_FRAMES)
    fps = c["fps"] * len(seq) / len(c["frames"])   # keep the clip's wall-clock length
    rows.append((web, clip, flip, seq, round(fps, 2), c["loop"]))

# one cell for every used frame: widest reach either side of the feet, tallest crown
left = right = up = 0
for _, clip, _, seq, _, _ in rows:
    for i in seq:
        f = frames[clip][i]
        left = max(left, -f["ox"]); right = max(right, f["w"] + f["ox"]); up = max(up, -f["oy"])
half = max(left, right)                      # symmetric, so a flipped row keeps its feet in place
cw = int(round(2 * half * SCALE)) + 2
ch = int(round(up * SCALE)) + 2
cols = max(len(r[3]) for r in rows)
out = Image.new("RGBA", (cw * cols, ch * len(rows)), (0, 0, 0, 0))
ax, ay = cw // 2, ch - 1                     # feet: bottom centre of the cell

for r, (web, clip, flip, seq, fps, loop) in enumerate(rows):
    for k, i in enumerate(seq):
        f = frames[clip][i]
        im = sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        w, h = max(1, round(f["w"] * SCALE)), max(1, round(f["h"] * SCALE))
        im = im.resize((w, h), Image.LANCZOS)
        ox, oy = f["ox"], f["oy"]
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            ox = -(f["w"] + ox)
        out.alpha_composite(im, (k * cw + ax + int(round(ox * SCALE)), r * ch + ay + int(round(oy * SCALE))))

for p in OUT:
    p.parent.mkdir(parents=True, exist_ok=True)
    out.save(p, "WEBP", quality=88, method=6)
    print(p, p.stat().st_size, "bytes")

print(f"sheet {out.size[0]}x{out.size[1]}  cell {cw}x{ch}  cols {cols}  rows {len(rows)}")
print("  var SPRITE = {")
print('    src: "assets/revbot.webp",')
print(f"    frameW: {cw}, frameH: {ch}, cols: {cols}, rowsTotal: {len(rows)},")
print("    scale: 1,")
print("    fps: 8,")
print("    rows: {   // [row, frames, fps]")
for r, (web, clip, flip, seq, fps, loop) in enumerate(rows):
    print(f"      {web}: [{r}, {len(seq)}, {fps}],")
print("    },")
print("  };")
