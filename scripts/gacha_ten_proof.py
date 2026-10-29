"""Composite proof of the ten-pull flow built only from shared parts.

One card back, one teal troop face, one gold hero face; portraits come from assets-src/units/v2.
Usage: python3 scripts/gacha_ten_proof.py <gold_plate> <cyan_plate> <out.png>
"""
import sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from gacha_template_proof import CYAN, GOLD, JADE_DARK, label, place, unit

PW, PH = 1280, 720
CARD_W, CARD_H = 176, 236
# (unit id, name, hero?) in rolled order; the hero keeps its slot but flips last
ROLL = [('cn_sword', '剑修', False), ('jp_fox', '式神狐', False), ('eu_hero', '女武神', True), ('eu_golem', '符文巨像', False),
        ('cn_talisman', '符箓师', False), ('jp_tengu', '天狗', False), ('eu_archer', '精灵弓手', False), ('cn_ape', '灵猿力士', False),
        ('jp_oni', '鬼武者', False), ('eu_knight', '符文骑士', False)]


def slots():
    gx, gy = 28, 26
    x0 = (PW - (CARD_W * 5 + gx * 4)) / 2
    y0 = 118
    return [(round(x0 + (i % 5) * (CARD_W + gx)), round(y0 + (i // 5) * (CARD_H + gy))) for i in range(10)]


def edge_glow(img, box, color, r=12, strength=2.2):
    x, y, w, h = box
    m = Image.new('L', img.size)
    ImageDraw.Draw(m).rounded_rectangle((x, y, x + w, y + h), 16, outline=255, width=8)
    m = m.filter(ImageFilter.GaussianBlur(r)).point(lambda v: min(255, int(v * strength)))
    layer = Image.new('RGBA', img.size, color + (0,))
    layer.putalpha(m)
    img.alpha_composite(layer)


def card_back(img, x, y, color):
    edge_glow(img, (x, y, CARD_W, CARD_H), color)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y, x + CARD_W, y + CARD_H), 16, fill=(244, 214, 120), outline=color, width=5)
    d.rounded_rectangle((x + 12, y + 12, x + CARD_W - 12, y + CARD_H - 12), 10, outline=(200, 150, 60), width=2)
    d.rectangle((x + CARD_W / 2 - 14, y + 26, x + CARD_W / 2 + 14, y + 54), outline=(196, 40, 40), width=3)
    # a generic rune: same on every card back
    d.line([(x + 88, y + 74), (x + 70, y + 120), (x + 104, y + 140), (x + 76, y + 196)], fill=(196, 40, 40), width=6, joint='curve')
    d.line([(x + 60, y + 100), (x + 118, y + 92)], fill=(196, 40, 40), width=5)


def card_face(img, x, y, uid, name, hero, stars=None):
    color = GOLD if hero else CYAN
    edge_glow(img, (x, y, CARD_W, CARD_H), color, strength=3 if hero else 1.6)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y, x + CARD_W, y + CARD_H), 16, fill=(120, 80, 20, 245) if hero else (28, 96, 96, 245), outline=color, width=5)
    place(img, unit(uid, 150), x + CARD_W / 2, y + 168, color)
    d = ImageDraw.Draw(img)
    label(d, (x + CARD_W / 2, y + 190), name, 20, (255, 255, 255), stroke=(60, 36, 8) if hero else JADE_DARK)
    if hero:
        label(d, (x + CARD_W / 2, y + 216), '新英雄', 16, GOLD, stroke=(60, 36, 8))
        d.ellipse((x + CARD_W - 40, y - 12, x + CARD_W + 12, y + 40), fill=(206, 40, 40), outline=(255, 220, 160), width=3)
        label(d, (x + CARD_W - 14, y + 14), '新', 22, (255, 240, 210), stroke=(120, 20, 20))
    else:
        label(d, (x + CARD_W / 2, y + 216), '兵魂 +1' + (f'  ★{stars}' if stars else ''), 15, CYAN, stroke=(10, 30, 32))


def panel(plate, title, step):
    img = ImageEnhance.Brightness(plate).enhance(0.62).convert('RGBA')
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 600, 76), 14, fill=(0, 0, 0, 160))
    label(d, (40, 48), f'{step}  {title}', 26, (255, 244, 220), 'lm', (0, 0, 0))
    return img


def main(gold_path, cyan_path, out):
    gold = Image.open(gold_path).convert('RGBA').resize((PW, PH), Image.LANCZOS)
    cyan = Image.open(cyan_path).convert('RGBA').resize((PW, PH), Image.LANCZOS)
    S = slots()

    a = panel(cyan, '卡背落定：边光预告品质（9 青 1 金）', '④')
    for (uid, name, hero), (x, y) in zip(ROLL, S):
        card_back(a, x, y, GOLD if hero else CYAN)

    b = panel(cyan, '青卡从左到右快速连翻，金卡留到最后', '⑤')
    for i, ((uid, name, hero), (x, y)) in enumerate(zip(ROLL, S)):
        if hero:
            card_back(b, x, y, GOLD)
            edge_glow(b, (x, y, CARD_W, CARD_H), GOLD, r=22, strength=3)
        elif i < 8:
            card_face(b, x, y, uid, name, False)
        else:
            card_back(b, x, y, CYAN)

    c = ImageEnhance.Brightness(gold).enhance(0.95).convert('RGBA')
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((20, 20, 600, 76), 14, fill=(0, 0, 0, 160))
    label(d, (40, 48), '⑥  金卡飞到中央，套用单抽英雄揭晓', 26, (255, 244, 220), 'lm', (0, 0, 0))
    place(c, unit('eu_hero', PH * 0.62), PW / 2, PH * 0.80, GOLD)
    d = ImageDraw.Draw(c)
    label(d, (48, 150), '女武神', 64, GOLD, 'lm')
    label(d, (52, 214), '欧陆·圣庭', 26, (255, 244, 220), 'lm')
    d.rounded_rectangle((48, 246, 178, 286), 10, fill=(196, 40, 40))
    label(d, (113, 266), '新英雄', 22, (255, 236, 200), stroke=(120, 20, 20))
    label(d, (PW - 40, PH - 40), '点按继续 → 回到卡位', 22, (255, 255, 255), 'rm', (0, 0, 0))

    e = panel(cyan, '结果页：卡位与抽取顺序一致', '⑦')
    for (uid, name, hero), (x, y) in zip(ROLL, S):
        card_face(e, x, y, uid, name, hero, None if hero else 1)
    d = ImageDraw.Draw(e)
    label(d, (PW / 2, 652), '本次：新英雄 ×1 · 兵魂 ×9 · 保底已重置', 22, (255, 244, 220), stroke=(0, 0, 0))
    for bx, text, fill in ((PW / 2 - 230, '返回', (40, 52, 84)), (PW / 2 + 30, '再来十连 · 10 代币', (232, 176, 52))):
        d.rounded_rectangle((bx, 672, bx + 200, 712), 20, fill=fill, outline=(255, 230, 170), width=2)
        label(d, (bx + 100, 692), text, 18, (255, 255, 255), stroke=(0, 0, 0))

    gap = 16
    sheet = Image.new('RGBA', (PW * 2 + gap * 3, PH * 2 + gap * 3 + 70), (16, 20, 34, 255))
    label(ImageDraw.Draw(sheet), (gap, 38), '十连流程验证：一张卡背 + 青/金两种卡面 + 单抽英雄揭晓，全部通用，角色只换立绘', 34, (255, 244, 220), 'lm', (16, 20, 34))
    for i, p in enumerate((a, b, c, e)):
        sheet.alpha_composite(p, (gap + (i % 2) * (PW + gap), 70 + gap + (i // 2) * (PH + gap)))
    sheet.convert('RGB').save(out, quality=92)


if __name__ == '__main__':
    main(*sys.argv[1:4])
