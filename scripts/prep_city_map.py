"""Fit a painted base map onto the game grid.

The art (canvas board 铁壁仙门 · 单机 IAA, e.g. node map-jade-city) is generated from a layout guide
(assets/ref/map_layout_guide.png) and comes back with its empty jade plaza roughly where the guide put it. This finds
the plaza (a pale mint region grown from the image centre), takes its four corners and warps the painting with a
perspective transform so those corners land exactly on the 20 x 20 grid's corners in world units. The result covers
world x -400..1200, y -100..800 (the widest area any screen shape shows) at SCALE px per world unit; whatever the
painting does not reach is left transparent, so the sky behind shows. src/scenes/island.ts draws it at that rect.

Run: python3 scripts/prep_city_map.py <generated.png> <skin id>
  ->  public/assets/maps/<skin id>_city.webp (the map) and <skin id>_thumb.jpg (its card in the map panel)
Sources so far: jade output-66, sakura output-67, snow output-68, autumn output-69 (assets/imported).
"""
import sys
import numpy as np
from PIL import Image

X0, Y0, WW, WH = -400, -100, 1600, 900  # world rect the output covers (keep in sync with CITY in island.ts)
SCALE = 1.5
GRID_CORNERS = [(400, 70), (800, 270), (400, 470), (0, 270)]  # top, right, bottom, left (src/core/iso.ts)


def plaza_mask(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mint = (g > 195) & (g - r > 20) & (b > 165) & (r > 120)
    h, w = mint.shape
    ys, xs = np.nonzero(mint[h // 4: 3 * h // 4, w // 4: 3 * w // 4])
    seed = (ys[len(ys) // 2] + h // 4, xs[len(xs) // 2] + w // 4)
    grown = np.zeros_like(mint)
    grown[seed] = True
    while True:  # 4-connected region growing inside the mint mask
        d = grown.copy()
        d[1:] |= grown[:-1]; d[:-1] |= grown[1:]; d[:, 1:] |= grown[:, :-1]; d[:, :-1] |= grown[:, 1:]
        d &= mint
        if (d == grown).all():
            return grown
        grown = d


def corners(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    pick = lambda sel: (xs[sel].mean(), ys[sel].mean())
    return [pick(ys <= ys.min() + 1), pick(xs >= xs.max() - 1), pick(ys >= ys.max() - 1), pick(xs <= xs.min() + 1)]


def homography(src, dst):
    """Coefficients mapping dst -> src points (what PIL's PERSPECTIVE transform wants)."""
    A, rhs = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
    return np.linalg.solve(np.array(A, float), np.array(rhs, float))


def main(path: str, skin: str):
    im = Image.open(path).convert('RGBA')
    mask = plaza_mask(np.asarray(im.convert('RGB')).astype(int))
    src = corners(mask)
    print('plaza corners in the painting:', [(round(x), round(y)) for x, y in src], 'area', int(mask.sum()))
    dst = [((x - X0) * SCALE, (y - Y0) * SCALE) for x, y in GRID_CORNERS]
    size = (round(WW * SCALE), round(WH * SCALE))
    out = im.transform(size, Image.PERSPECTIVE, tuple(homography(src, dst)), Image.BICUBIC)
    out.save(f'public/assets/maps/{skin}_city.webp', quality=90, method=6)
    print('wrote', f'public/assets/maps/{skin}_city.webp', out.size)
    # the skin's card in the map panel: world x -120..920, y 0..585 around the plaza, 16:9
    box = tuple(round(v * SCALE) for v in (-120 - X0, 0 - Y0, 920 - X0, 585 - Y0))
    out.convert('RGB').crop(box).resize((384, 216), Image.LANCZOS).save(f'public/assets/maps/{skin}_thumb.jpg', quality=86)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
