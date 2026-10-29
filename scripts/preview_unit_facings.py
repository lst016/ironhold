"""One row per unit, one column per facing (idle frame 0, or walk for walk-only units), to check that every
model faces the same way. Facing 1 should look straight down the screen at the camera.
Run: python3 scripts/preview_unit_facings.py <out.jpg>
"""
import glob
import json
import sys

from PIL import Image, ImageDraw

SRC = 'assets-src/renders/anim'
ids = sorted(p.split('/')[-1][: -len('_anim.json')] for p in glob.glob(f'{SRC}/*_anim.json'))
CW, CH = 120, 150
sheet = Image.new('RGB', (90 + 8 * CW, len(ids) * CH), (90, 140, 80))
d = ImageDraw.Draw(sheet)
for r, uid in enumerate(ids):
    clips = json.load(open(f'{SRC}/{uid}_anim.json'))['clips']
    clip = 'idle' if 'idle' in clips else 'walk'
    c = clips[clip]
    im = Image.open(f'{SRC}/{uid}_{clip}.png')
    d.text((4, r * CH + 60), uid, fill=(255, 255, 0))
    for i in range(8):
        cell = im.crop((0, i * c['h'], c['w'], (i + 1) * c['h']))
        cell.thumbnail((CW - 4, CH - 4))
        bg = Image.new('RGBA', cell.size, (90, 140, 80, 255))
        bg.alpha_composite(cell)
        sheet.paste(bg.convert('RGB'), (90 + i * CW, r * CH))
        if r == 0:
            d.text((90 + i * CW + 2, 2), str(i), fill=(255, 255, 255))
sheet.save(sys.argv[1])
