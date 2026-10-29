"""Trim the 4 facings from render_model.py and lay them beside the current sprite for review.

Run: python3 scripts/compare_render.py cn tower [--dw 54]
Reads assets-src/renders/<fid>/<kind>_0..3.png, trims empty space above the model in place (bottom edge and
horizontal centre are the anchor, so they stay put), then writes assets-src/renders/<fid>/<kind>_compare.png:
the current sprite and the 4 facings at the same on-screen scale, each standing on its cell outline.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
fid, kind = sys.argv[1], sys.argv[2]
opt = dict(zip(sys.argv[3::2], sys.argv[4::2]))
dw = float(opt.get("--dw", 54))  # current on-screen width of this building (BUILDING_DW in sprites.ts)
TILE = 40  # display tile width (TW in iso.ts); renders use 2x
ZOOM = 3

renders = []
for i in range(4):
    p = root / "assets-src" / "renders" / fid / f"{kind}_{i}.png"
    im = Image.open(p).convert("RGBA")
    top = im.getbbox()[1] if im.getbbox() else 0
    im = im.crop((0, max(0, top - 2), im.width, im.height))
    im.save(p)
    renders.append(im.resize((round(im.width / 2), round(im.height / 2)), Image.LANCZOS))  # back to display size

cur = Image.open(root / "public" / "assets" / "buildings" / fid / f"{kind}.png").convert("RGBA")
cur = cur.resize((round(dw), round(cur.height * dw / cur.width)), Image.LANCZOS)

items = [("current", cur)] + [(f"facing {i}", r) for i, r in enumerate(renders)]
cw = max(im.width for _, im in items) + 20
ch = max(im.height for _, im in items) + 40
sheet = Image.new("RGBA", (cw * len(items) * ZOOM, ch * ZOOM), (126, 190, 104, 255))
draw = ImageDraw.Draw(sheet)
for n, (name, im) in enumerate(items):
    big = im.resize((im.width * ZOOM, im.height * ZOOM), Image.LANCZOS)
    bx = n * cw * ZOOM + cw * ZOOM // 2  # anchor x: bottom vertex of the cell
    by = (ch - 16) * ZOOM  # anchor y
    t, h = TILE / 2 * ZOOM, TILE / 4 * ZOOM
    draw.polygon([(bx, by), (bx + t, by - h), (bx, by - 2 * h), (bx - t, by - h)], outline=(255, 255, 255, 200))
    sheet.alpha_composite(big, (bx - big.width // 2, by - big.height))
    draw.text((n * cw * ZOOM + 8, 6), name, fill=(20, 30, 20, 255))
out = root / "assets-src" / "renders" / fid / f"{kind}_compare.png"
sheet.save(out)
print(out)
