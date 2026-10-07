"""Bake RevBot's web sprite sheet from the Desk Pet Maker example sheet.

Reads  M:/Projects/Desk-Pet-Maker/template/revbot-example-clean.png (+ sheet-spec.json)
Writes deploy/public_html/assets/revbot.webp and assets/revbot.webp
Prints the SPRITE block for main.js.

The source is the 2048 x 2560 pet sheet: 10 rows, 8 columns, 256 px cells, feet
on the ground line. The page needs a smaller fixed-cell grid with one row per
animation it plays, so each used cell is cropped to a common box around the
drawing and scaled down; a left-walking row is a horizontal flip of the walk.
"""
import json
from pathlib import Path
from PIL import Image

SRC = Path("M:/Projects/Desk-Pet-Maker/template")
SITE = Path(__file__).resolve().parents[1]
OUT = [SITE / "deploy/public_html/assets/revbot.webp", SITE / "assets/revbot.webp"]

SCALE = 0.45                       # 256 px cell -> ~101 px on the page (Damien was 104)
# web row -> (sheet row, flip)
ROWS = [
    ("idle",     "idle",  False),
    ("runRight", "walk",  False),
    ("runLeft",  "walk",  True),
    ("wave",     "wave",  False),
    ("jump",     "jump",  False),
    ("failed",   "oops",  False),
    ("waiting",  "think", False),
    ("running",  "work",  False),
    ("review",   "happy", False),
    ("sleep",    "sleep", False),
    ("held",     "held",  False),
]

spec = json.loads((SRC / "sheet-spec.json").read_text(encoding="utf-8"))
cell, cols = spec["cell"], spec["columns"]
srow = {r["name"]: (i, r) for i, r in enumerate(spec["rows"])}
im = Image.open(SRC / "revbot-example-clean.png").convert("RGBA")
alpha = im.getchannel("A")

# frames per row = drawn cells, left to right
def frames_in(row_index):
    n = 0
    for c in range(cols):
        if alpha.crop((c * cell, row_index * cell, (c + 1) * cell, (row_index + 1) * cell)).getbbox():
            n = c + 1
    return n

used = []
for web, name, flip in ROWS:
    ri, r = srow[name]
    n = frames_in(ri)
    if n:
        used.append((web, ri, flip, n, r["fps"]))

# one crop box for every used cell, symmetric about the cell's centre x so a flip
# keeps the feet in place
x0 = y0 = 10**9; x1 = y1 = 0
for _, ri, _, n, _ in used:
    for c in range(n):
        b = alpha.crop((c * cell, ri * cell, (c + 1) * cell, (ri + 1) * cell)).getbbox()
        x0, y0, x1, y1 = min(x0, b[0]), min(y0, b[1]), max(x1, b[2]), max(y1, b[3])
half = max(cell / 2 - x0, x1 - cell / 2) + 4
bx0, bx1 = int(cell / 2 - half), int(cell / 2 + half)
by0, by1 = max(0, y0 - 4), min(cell, spec["ground_y"] + 6)
cw, chh = bx1 - bx0, by1 - by0
ow, oh = round(cw * SCALE), round(chh * SCALE)
maxn = max(u[3] for u in used)
out = Image.new("RGBA", (ow * maxn, oh * len(used)), (0, 0, 0, 0))
for r, (web, ri, flip, n, fps) in enumerate(used):
    for c in range(n):
        f = im.crop((c * cell + bx0, ri * cell + by0, c * cell + bx1, ri * cell + by1))
        if flip:
            f = f.transpose(Image.FLIP_LEFT_RIGHT)
        f = f.resize((ow, oh), Image.LANCZOS)
        out.alpha_composite(f, (c * ow, r * oh))

for p in OUT:
    p.parent.mkdir(parents=True, exist_ok=True)
    out.save(p, "WEBP", quality=90, method=6)
    print(p, p.stat().st_size, "bytes")

print(f"sheet {out.size[0]}x{out.size[1]}  cell {ow}x{oh}  cols {maxn}  rows {len(used)}")
print("  var SPRITE = {")
print('    src: "assets/revbot.webp",')
print(f"    frameW: {ow}, frameH: {oh}, cols: {maxn}, rowsTotal: {len(used)},")
print("    scale: 1,")
print("    fps: 8,")
print("    rows: {   // [row, frames, fps]")
for r, (web, ri, flip, n, fps) in enumerate(used):
    print(f"      {web}: [{r}, {n}, {fps}],")
print("    },")
print("  };")
