"""Cut the themed button skins (canvas board 铁壁仙门 · 单机 IAA) out of their flat magenta backdrop.

Sheet: four wide buttons stacked top to bottom (jade green, vermilion, azure, stone gray); close: one square button;
tiles: six square icon-button faces in a 3 x 2 grid (see TILES).
Writes public/assets/ui/btn_<variant>.png at BTN_H px tall, close.png at CLOSE px and tile_<variant>.png at TILE px;
common.ts 3-slices the buttons at runtime (fixed end caps, stretched middle), so one skin serves every width.
Usage: python3 scripts/prep_buttons.py <sheet.png> <close.png> <tiles.png>
"""
import sys
import numpy as np
from PIL import Image

OUT = 'public/assets/ui'
NAMES = ['btn_green', 'btn_red', 'btn_blue', 'btn_gray']
TILES = ['tile_blue', 'tile_gold', 'tile_red', 'tile_green', 'tile_gray', 'tile_purple']  # 3 x 2 sheet, reading order
BTN_H = 160
CLOSE = 192
TILE = 224


def key(src):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    m = np.array([1, 0, 1], np.float32)
    d = np.sqrt(((a - m) ** 2 * [0.6, 1.6, 0.6]).sum(-1))
    alpha = np.clip((d - 0.18) / 0.32, 0, 1)
    k = alpha[..., None]
    rgb = np.where(k > 0.01, (a - (1 - k) * m) / np.maximum(k, 0.01), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), alpha]) * 255).astype(np.uint8), 'RGBA')


def trim(im):
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())


def rows(im, axis=1):
    """Spans of the sheet that hold something: rows top to bottom (axis=1) or columns left to right (axis=0)."""
    filled = (np.asarray(im.getchannel('A')) > 24).any(axis)
    spans, start = [], None
    for y, f in enumerate(filled):
        if f and start is None: start = y
        if not f and start is not None: spans.append((start, y)); start = None
    if start is not None: spans.append((start, len(filled)))
    return [s for s in spans if s[1] - s[0] > 20]


def grid(src):
    """Square tiles in reading order, from a sheet laid out in rows."""
    im = key(src)
    for y0, y1 in rows(im):
        row = im.crop((0, y0, im.width, y1))
        for x0, x1 in rows(row, 0):
            yield trim(row.crop((x0, 0, x1, row.height)))


def main(sheet, close, tiles):
    for name, t in zip(TILES, grid(tiles)):
        t.resize((TILE, round(t.height * TILE / t.width)), Image.LANCZOS).save(f'{OUT}/{name}.png', optimize=True)
        print(name, t.size)
    im = key(sheet)
    spans = rows(im)
    assert len(spans) == len(NAMES), f'expected {len(NAMES)} buttons, found {len(spans)}'
    for name, (y0, y1) in zip(NAMES, spans):
        b = trim(im.crop((0, y0, im.width, y1)))
        b.resize((round(b.width * BTN_H / b.height), BTN_H), Image.LANCZOS).save(f'{OUT}/{name}.png', optimize=True)
        print(name, b.size)
    c = trim(key(close))
    c.resize((CLOSE, round(c.height * CLOSE / c.width)), Image.LANCZOS).save(f'{OUT}/close.png', optimize=True)
    print('close', c.size)


if __name__ == '__main__':
    main(*sys.argv[1:4])
