"""Prepare summon-scene art in public/assets/gacha/.

Backgrounds (canvas board 抽卡 · 问仙召唤): stage (no talisman), gold reveal plate, cyan reveal plate.
Portraits: every unit cutout in assets-src/units/v2, cropped to its alpha and scaled to a common height,
so the reveal can show any hero or troop the data lists.
Usage: python3 scripts/prep_gacha.py <stage.png> <gold.png> <cyan.png>
"""
import glob
import os
import sys
from PIL import Image

OUT = 'public/assets/gacha'
PORTRAIT_H = 560


def portraits():
    os.makedirs(f'{OUT}/portraits', exist_ok=True)
    for f in sorted(glob.glob('assets-src/units/v2/*.png')):
        im = Image.open(f).convert('RGBA')
        im = im.crop(im.getchannel('A').getbbox())
        k = PORTRAIT_H / im.height
        im = im.resize((round(im.width * k), PORTRAIT_H), Image.LANCZOS)
        im.save(f'{OUT}/portraits/{os.path.basename(f)[:-4]}.webp', quality=88, method=6)


def main(stage, gold, cyan):
    for name, src in (('stage', stage), ('gold', gold), ('cyan', cyan)):
        Image.open(src).convert('RGB').save(f'{OUT}/{name}.jpg', quality=86, optimize=True, progressive=True)
    portraits()


if __name__ == '__main__':
    # `portraits` alone re-cuts the portraits after new units land in assets-src/units/v2
    portraits() if sys.argv[1:] == ['portraits'] else main(*sys.argv[1:4])
