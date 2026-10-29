"""Composite proof that one gacha reveal template serves every unit.

Shared plates (gold = hero, cyan = troop) + any unit cutout from assets-src/units/v2.
The silhouette is the cutout's alpha filled black; nothing per character is hand-made.
Usage: python3 scripts/gacha_template_proof.py <gold_plate> <cyan_plate> <out.png>
"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

GOLD, CYAN, JADE_DARK = (255, 201, 74), (95, 214, 200), (18, 70, 72)
CW, CH = 640, 360
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

HEROES = [('cn_hero', '剑仙', '中土·剑宗'), ('jp_hero', '阴阳师', '扶桑·阴阳寮'), ('eu_hero', '女武神', '欧陆·圣庭')]
TROOPS = [('cn_sword', '剑修', '中土·剑宗 · 近战'), ('jp_fox', '式神狐', '扶桑·阴阳寮 · 近战'), ('eu_golem', '符文巨像', '欧陆·圣庭 · 重装')]


def font(size):
    return ImageFont.truetype(FONT, size, index=1)


def unit(uid, height):
    im = Image.open(f'assets-src/units/v2/{uid}.png').convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    k = height / im.height
    return im.resize((max(1, round(im.width * k)), round(height)), Image.LANCZOS)


def glow(im, color, radius):
    """Soft colored halo from the cutout's alpha."""
    pad = radius * 3
    a = Image.new('L', (im.width + pad * 2, im.height + pad * 2))
    a.paste(im.getchannel('A'), (pad, pad))
    a = a.filter(ImageFilter.GaussianBlur(radius))
    halo = Image.new('RGBA', a.size, color + (0,))
    halo.putalpha(a.point(lambda v: min(255, v * 2)))
    return halo, pad


def silhouette(im):
    s = Image.new('RGBA', im.size, (12, 10, 20, 255))
    s.putalpha(im.getchannel('A'))
    return s


def place(bg, im, cx, bottom, color, dark=False):
    halo, pad = glow(im, color, 14)
    x, y = round(cx - im.width / 2), round(bottom - im.height)
    bg.alpha_composite(halo, (x - pad, y - pad))
    bg.alpha_composite(silhouette(im) if dark else im, (x, y))


def label(d, xy, text, size, fill, anchor='mm', stroke=(30, 18, 8)):
    d.text(xy, text, font=font(size), fill=fill, anchor=anchor, stroke_width=max(2, size // 10), stroke_fill=stroke)


def hero_cell(plate, uid, name, faction, dark):
    bg = plate.copy()
    place(bg, unit(uid, CH * 0.62), CW / 2, CH * 0.80, GOLD, dark)
    d = ImageDraw.Draw(bg)
    if not dark:
        label(d, (24, 40), name, 40, GOLD, 'lm')
        label(d, (26, 82), faction, 18, (255, 244, 220), 'lm')
        d.rounded_rectangle((22, 104, 112, 132), 8, fill=(196, 40, 40))
        label(d, (67, 118), '新英雄', 16, (255, 236, 200), stroke=(120, 20, 20))
    return bg


def troop_cell(plate, uid, name, sub, dark):
    bg = plate.copy()
    d = ImageDraw.Draw(bg)
    cx, top, w, h = CW / 2, 52, 170, 220
    if not dark:  # code-drawn jade card frame shared by all troops
        d.rounded_rectangle((cx - w / 2, top, cx + w / 2, top + h), 18, fill=(28, 96, 96, 235), outline=CYAN, width=5)
    place(bg, unit(uid, 150), cx, top + 180, CYAN, dark)
    d = ImageDraw.Draw(bg)
    if not dark:
        label(d, (cx, top + 200), name, 22, (255, 255, 255), stroke=JADE_DARK)
        label(d, (cx, top + 246), sub, 15, CYAN, stroke=(10, 30, 32))
        label(d, (cx, top + 274), '兵魂 +1', 18, (255, 255, 255), stroke=JADE_DARK)
    return bg


def main(gold_path, cyan_path, out):
    gold = Image.open(gold_path).convert('RGBA').resize((CW, CH), Image.LANCZOS)
    cyan = Image.open(cyan_path).convert('RGBA').resize((CW, CH), Image.LANCZOS)
    gap, head, rowhead = 16, 96, 46
    W = CW * 4 + gap * 5
    H = head + (rowhead + CH) * 2 + gap * 3
    sheet = Image.new('RGBA', (W, H), (16, 20, 34, 255))
    d = ImageDraw.Draw(sheet)
    label(d, (gap, 48), '通用揭晓模板验证：同一底图 + 角色立绘插槽，新角色不需要单独做动画', 34, (255, 244, 220), 'lm', (16, 20, 34))
    rows = [
        ('英雄 · 金（3 环、金光柱、通用灵印）', GOLD, gold, HEROES, hero_cell, HEROES[1]),
        ('没出英雄 → 普通兵种 · 青（1 环、短青光、兵种卡）', CYAN, cyan, TROOPS, troop_cell, TROOPS[1]),
    ]
    y = head
    for title, color, plate, units, cell, sil in rows:
        label(d, (gap, y + rowhead / 2), title, 24, color, 'lm', (16, 20, 34))
        y += rowhead
        cells = [(cell(plate, *sil, True), '⑤ 剪影（立绘自动涂黑）')] + [(cell(plate, *u, False), f'⑥ 揭晓 · {u[1]}') for u in units]
        for i, (img, cap) in enumerate(cells):
            x = gap + i * (CW + gap)
            sheet.alpha_composite(img, (x, y))
            dd = ImageDraw.Draw(sheet)
            dd.rounded_rectangle((x + CW - 250, y + 8, x + CW - 8, y + 40), 10, fill=(0, 0, 0, 150))
            label(dd, (x + CW - 129, y + 24), cap, 16, (255, 255, 255), stroke=(0, 0, 0))
        y += CH + gap
    sheet.convert('RGB').save(out, quality=92)


if __name__ == '__main__':
    main(*sys.argv[1:4])
