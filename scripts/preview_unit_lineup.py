"""All animated units standing on one baseline at their in-game scale (body -> 100 px), facing the camera (facing 1),
to check relative sizes. Run: python3 scripts/preview_unit_lineup.py <out.jpg>
"""
import importlib.util
import json
import re
import sys

from PIL import Image, ImageDraw

SRC = 'assets-src/renders/anim'
ts = open('src/scenes/unitAnims.ts').read()
anims = json.loads(re.search(r'UNIT_ANIMS: Record<string, UnitAnim> = (\{.*\});', ts, re.S).group(1))
TARGET, BASE = 100, 260
sheet = Image.new('RGB', (len(anims) * 130 + 20, 320), (90, 140, 80))
d = ImageDraw.Draw(sheet)
d.line((0, BASE, sheet.width, BASE), fill=(40, 70, 40))
d.line((0, BASE - TARGET, sheet.width, BASE - TARGET), fill=(200, 200, 90))
for i, (uid, a) in enumerate(anims.items()):
    clip = 'idle' if 'idle' in a['clips'] else 'walk'
    c = a['clips'][clip]
    cell = Image.open(f'{SRC}/{uid}_{clip}.png').crop((0, c['h'], c['w'], 2 * c['h']))
    k = TARGET / a['body']
    cell = cell.resize((max(1, round(c['w'] * k)), max(1, round(c['h'] * k))), Image.LANCZOS)
    x = 75 + i * 130 - cell.width // 2
    y = BASE - round((c['h'] - a['pad']) * k)
    sheet.paste(cell, (x, y), cell)
    d.text((75 + i * 130 - 30, BASE + 20), uid, fill=(255, 255, 0))
sheet.save(sys.argv[1])
