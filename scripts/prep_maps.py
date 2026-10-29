"""Prepare the map-skin art (src/data/maps.ts) for the game.
Run: python3 scripts/prep_maps.py <id>:<sky.png>:<ground.png> [...] --cliff <rock.png>
Writes public/assets/maps/<id>_sky.jpg (2400 wide, enough for RES 3), <id>_ground.jpg and cliff.jpg.
Ground and cliff textures are made seamless by mirror-tiling 2 x 2, so they repeat without visible seams.
"""
import sys
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parent.parent
out = root / "public" / "assets" / "maps"
out.mkdir(parents=True, exist_ok=True)


def seamless(path: str, size: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    tile = Image.new("RGB", (w * 2, h * 2))
    tile.paste(im, (0, 0))
    tile.paste(ImageOps.mirror(im), (w, 0))
    tile.paste(ImageOps.flip(im), (0, h))
    tile.paste(ImageOps.flip(ImageOps.mirror(im)), (w, h))
    return tile.resize((size, size), Image.LANCZOS)


args = sys.argv[1:]
cliff = args[args.index("--cliff") + 1] if "--cliff" in args else None
for spec in [a for a in args if ":" in a]:
    sid, sky, ground = spec.split(":")
    im = Image.open(sky).convert("RGB")
    im.resize((2400, round(im.height * 2400 / im.width)), Image.LANCZOS).save(out / f"{sid}_sky.jpg", quality=86)
    seamless(ground, 1024).save(out / f"{sid}_ground.jpg", quality=88)
    print(sid)
if cliff:
    seamless(cliff, 768).save(out / "cliff.jpg", quality=88)
    print("cliff")
