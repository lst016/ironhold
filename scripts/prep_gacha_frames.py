"""Cut the summon result card frames (canvas board 抽卡 · 问仙召唤) out of their flat magenta backdrop.

Each frame becomes two webps in public/assets/gacha/: a large one for the single-pull troop reveal and a small one
for the ten-pull result cards, so neither is shrunk far at runtime.
Usage: python3 scripts/prep_gacha_frames.py <cyan.png> <gold.png>
"""
import sys
import numpy as np
from PIL import Image

OUT = 'public/assets/gacha'
SIZES = {'': 600, '_s': 300}  # suffix -> width in px


def key(src):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    m = np.array([1, 0, 1], np.float32)
    # how far each pixel is from magenta, with green carrying most of it (magenta has none)
    d = np.sqrt(((a - m) ** 2 * [0.6, 1.6, 0.6]).sum(-1))
    alpha = np.clip((d - 0.18) / 0.32, 0, 1)
    # remove the magenta that bled into soft edges
    k = alpha[..., None]
    rgb = np.where(k > 0.01, (a - (1 - k) * m) / np.maximum(k, 0.01), 0)
    im = Image.fromarray((np.dstack([np.clip(rgb, 0, 1), alpha]) * 255).astype(np.uint8), 'RGBA')
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())


def main(cyan, gold):
    for name, src in (('frame_cyan', cyan), ('frame_gold', gold)):
        im = key(src)
        for suffix, w in SIZES.items():
            im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(f'{OUT}/{name}{suffix}.webp', quality=90, method=6)
        print(name, im.size)


if __name__ == '__main__':
    main(*sys.argv[1:3])
