"""Cut the 英灵殿 UI kit (canvas board 铁壁仙门 · 单机 IAA, nodes hall-*) into transparent PNGs.

The kit was rebuilt from one full-screen concept (concept-hero-hall), so every piece shares its style:
  panels  sheet: tall detail panel, wide bar panel, title plate, name ribbon, pedestal (with its own name plate)
  frames  sheet: hero banner card frame (+ selected), square slot frame (+ selected), round icon ring; hollow
  buttons sheet: gold / jade / red / navy buttons, then star on/off, gem pip on/off, gold / blue tag pills
Pieces are found as connected regions of the keyed alpha and named by layout, so a regenerated sheet with the
same arrangement drops straight in. Writes public/assets/ui/hall/*.png and the backdrop public/assets/ui/hall/bg.jpg.
Usage: python3 scripts/prep_hall.py <panels.png> <frames.png> <buttons.png> <bg.png> [<small.png>]
"""
import os
import sys
from collections import deque
import numpy as np
from PIL import Image

OUT = 'public/assets/ui/hall'
MAX_W = 900  # longest side of an exported piece; the stage shows them at well under half of that


def key(src):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    m = np.array([1, 0, 1], np.float32)
    d = np.sqrt(((a - m) ** 2 * [0.6, 1.6, 0.6]).sum(-1))
    alpha = np.clip((d - 0.18) / 0.32, 0, 1)
    k = alpha[..., None]
    rgb = np.where(k > 0.01, (a - (1 - k) * m) / np.maximum(k, 0.01), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), alpha]) * 255).astype(np.uint8), 'RGBA')


def pieces(im, step=4, min_area=0.002):
    """Bounding boxes of the connected opaque regions, biggest first; specks and sparkles are dropped."""
    mask = np.asarray(im.getchannel('A'))[::step, ::step] > 40
    h, w = mask.shape
    seen = np.zeros_like(mask)
    boxes = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]: continue
            q, n = deque([(y0, x0)]), 0
            seen[y0, x0] = True
            x1 = x2 = x0; y1 = y2 = y0
            while q:
                y, x = q.popleft(); n += 1
                x1, x2, y1, y2 = min(x1, x), max(x2, x), min(y1, y), max(y2, y)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True; q.append((yy, xx))
            if n > min_area * h * w:
                pad = 2
                boxes.append(((x1 - pad) * step, (y1 - pad) * step, (x2 + 1 + pad) * step, (y2 + 1 + pad) * step))
    return [tuple(max(0, v) if i < 2 else v for i, v in enumerate(b)) for b in boxes]


def save(im, box, name, raw=None):
    p = im.crop(box)
    if raw is not None:
        # a gold glow over magenta comes out pink (blue above green). Magenta has no green, so the green channel
        # says how much glow a pixel holds: use it as alpha and repaint those pixels in the glow's own gold.
        a = np.asarray(p).astype(np.float32)
        src = np.asarray(raw.crop(box)).astype(np.float32)
        pink = src[..., 2] > src[..., 1] + 8
        a[pink, 3] = np.clip(src[pink, 1] / 214, 0, 1) * 255
        a[pink, :3] = [255, 214, 110]
        p = Image.fromarray(a.astype(np.uint8), 'RGBA')
    p = p.crop(p.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox())
    k = min(1, MAX_W / max(p.size))
    p = p.resize((round(p.width * k), round(p.height * k)), Image.LANCZOS)
    p.save(f'{OUT}/{name}.png', optimize=True)
    print(name, p.size)


def cx(b): return (b[0] + b[2]) / 2
def cy(b): return (b[1] + b[3]) / 2


def main(panels, frames, buttons, bg, small=None):
    os.makedirs(OUT, exist_ok=True)

    im = key(panels)
    bs = pieces(im)
    tall = max(bs, key=lambda b: (b[3] - b[1]) / (b[2] - b[0]))
    rest = sorted([b for b in bs if b != tall], key=cy)
    for name, b in zip(['panel', 'bar', 'title', 'ribbon', 'pedestal'], [tall] + rest):
        save(im, b, name)

    im, raw = key(frames), Image.open(frames).convert('RGB')
    bs = sorted(pieces(im), key=lambda b: (round(cy(b) / (im.height / 2)), cx(b)))
    for name, b in zip(['card', 'card_on', 'slot', 'slot_on', 'ring'], bs):
        save(im, b, name, raw if name.endswith('_on') else None)

    im = key(buttons)
    bs = pieces(im)
    wide = sorted([b for b in bs if b[2] - b[0] > im.width * 0.3], key=cy)
    minor = sorted([b for b in bs if b[2] - b[0] <= im.width * 0.3], key=cy)
    for name, b in zip(['btn_gold', 'btn_jade', 'btn_red', 'btn_navy'], wide):
        save(im, b, name)
    for name, b in zip(['star_on', 'star_off', 'pip_on', 'pip_off', 'tag_gold', 'tag_blue'], minor):
        save(im, b, name)

    Image.open(bg).convert('RGB').save(f'{OUT}/bg.jpg', quality=86, optimize=True, progressive=True)

    if small:
        im = key(small)
        bs = sorted(pieces(im), key=cy)
        rows, row = [], [bs[0]]
        for b in bs[1:]:
            if cy(b) - cy(row[-1]) > im.height * 0.06: rows.append(row); row = [b]
            else: row.append(b)
        rows.append(row)
        ordered = [b for r in rows for b in sorted(r, key=cx)]
        for name, b in zip(SMALL, ordered):
            save(im, b, name)


# small sheet (node hall-kit-small), reading order: row 1 round pieces, row 2 currency bar + jade tag,
# row 3 progress track + cost inset, row 4 progress fill
SMALL = ['back', 'plus', 'lock', 'soul', 'badge', 'money', 'tag_jade', 'track', 'inset', 'fill']


if __name__ == '__main__':
    main(*sys.argv[1:6])
