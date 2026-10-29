"""Cut the v2 art (flat grey backgrounds) into transparent PNGs.
Run: python3 scripts/prep_ui_v2.py ui <icons.png> <title.png> <win.png> <lose.png>
     python3 scripts/prep_ui_v2.py deco <deco-sheet.png>
     python3 scripts/prep_ui_v2.py seasons <season-props.png>
     python3 scripts/prep_ui_v2.py units <unit_id>:<concept.png> [...]
Writes the trimmed full-size cuts to assets-src/<ui|deco>/v2/ and display-ready copies (~3-4x the drawn size, for
RES up to 3) to public/assets/<ui|deco>/. A sheet is a grid; items are found from empty rows/columns of the alpha
mask and named in reading order.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps

root = Path(__file__).resolve().parent.parent
ICONS = ["icon_stone", "icon_token", "icon_tower", "icon_wall", "icon_mine", "icon_sword", "flag", "skill", "speed", "icon_upgrade", "icon_remove"]
DECO = ["sakura", "pine", "tree", "bamboo", "rock", "flowers", "lantern", "cloud"]
SEASONS = ["maple", "snowpine", "snowrock", "autumnbush"]  # deco-sheet-seasons on the canvas
MARK = (255, 0, 255)


def knock_out(path: str, thresh: int = 26) -> Image.Image:
    """Flood the background from every border pixel, so only outside-connected grey goes transparent."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    for x in range(0, w, 6):
        for y in (0, h - 1):
            if im.getpixel((x, y)) != MARK: ImageDraw.floodfill(im, (x, y), MARK, thresh=thresh)
    for y in range(0, h, 6):
        for x in (0, w - 1):
            if im.getpixel((x, y)) != MARK: ImageDraw.floodfill(im, (x, y), MARK, thresh=thresh)
    a = Image.new("L", (w, h), 255)
    px, ap = im.load(), a.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == MARK: ap[x, y] = 0
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert("RGBA")
    out.putalpha(a)
    return out


def runs(filled: list[bool], gap: int) -> list[tuple[int, int]]:
    """Spans of True, merging spans separated by fewer than `gap` False entries."""
    spans, start = [], None
    for i, f in enumerate(filled + [False]):
        if f and start is None: start = i
        if not f and start is not None: spans.append([start, i]); start = None
    merged = []
    for s in spans:
        if merged and s[0] - merged[-1][1] < gap: merged[-1][1] = s[1]
        else: merged.append(s)
    return [(a, b) for a, b in merged if b - a > 20]


def grid(sheet: Image.Image, names: list[str]) -> list[Image.Image]:
    alpha = sheet.getchannel("A")
    w, h = sheet.size
    found = []
    for y0, y1 in runs([alpha.crop((0, y, w, y + 1)).getextrema()[1] > 40 for y in range(h)], 30):
        for x0, x1 in runs([alpha.crop((x, y0, x + 1, y1)).getextrema()[1] > 40 for x in range(w)], 40):
            cut = sheet.crop((x0, y0, x1, y1))
            found.append(cut.crop(cut.getbbox()))
    if len(found) != len(names):
        sys.exit(f"expected {len(names)} items, found {len(found)}")
    return found


def save(im: Image.Image, kind: str, name: str, side: str, v: int):
    src = root / "assets-src" / kind / "v2"
    src.mkdir(parents=True, exist_ok=True)
    im.save(src / f"{name}.png")
    k = v / (im.height if side == "h" else im.width)
    im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).save(root / "public" / "assets" / kind / f"{name}.png", optimize=True)
    print(name, im.size)


if sys.argv[1] == "ui":
    for name, im in zip(ICONS, grid(knock_out(sys.argv[2]), ICONS)):
        save(im, "ui", name, "h", 192)  # ICON in src/scenes/common.ts
    for path, name in zip(sys.argv[3:6], ["banner", "win", "lose"]):
        im = knock_out(path)
        save(im.crop(im.getbbox()), "ui", name, "w", 1280)
elif sys.argv[1] == "units":
    # single-character concept art -> flat unit sprites and portraits, mirrored so they face right like the old art
    # (the game flips a sprite when it walks left). Heroes are drawn ~100px tall, troops 64-78: 3x is 300 / 240.
    for spec in sys.argv[2:]:
        uid, path = spec.split(":")
        im = knock_out(path, 22)
        im = ImageOps.mirror(im.crop(im.getbbox()))
        save(im, "units", uid, "h", 300 if uid.endswith("_hero") else 240)
elif sys.argv[1] == "icons":
    # extra icons drawn later in the same style, e.g. the 军营 pair: icons <sheet.png> icon_camp icon_housing
    names = sys.argv[3:]
    for name, im in zip(names, grid(knock_out(sys.argv[2]), names)):
        save(im, "ui", name, "h", 192)
elif sys.argv[1] in ("deco", "seasons"):
    names = DECO if sys.argv[1] == "deco" else SEASONS
    # a slightly gentler flood: the white cloud and snow caps sit close to the grey background
    for name, im in zip(names, grid(knock_out(sys.argv[2], 22), names)):
        save(im, "deco", name, "h", 240)  # the tallest prop draws ~70px (DECO_H in common.ts)
