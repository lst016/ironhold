"""Contact sheet of the baked unit clips (idle / walk / attack, mid-clip frame, facing 1) for a quick visual check.
Run: python3 scripts/preview_unit_anims.py <out.jpg>
"""
import glob
import json
import sys

from PIL import Image

SRC = 'assets-src/renders/anim'
ids = sorted(p.split('/')[-1][: -len('_anim.json')] for p in glob.glob(f'{SRC}/*_anim.json'))
sheet = Image.new('RGB', (len(ids) * 170, 3 * 240), (90, 140, 80))
for i, uid in enumerate(ids):
    clips = json.load(open(f'{SRC}/{uid}_anim.json'))['clips']
    for r, clip in enumerate(['idle', 'walk', 'attack']):
        if clip not in clips:
            continue
        c = clips[clip]
        w, h, f = c['w'], c['h'], c['frames'] // 2
        cell = Image.open(f'{SRC}/{uid}_{clip}.png').crop((f * w, h, f * w + w, 2 * h))
        cell.thumbnail((165, 235))
        bg = Image.new('RGBA', cell.size, (90, 140, 80, 255))
        bg.alpha_composite(cell)
        sheet.paste(bg.convert('RGB'), (i * 170, r * 240))
sheet.save(sys.argv[1])
print(' '.join(ids))
