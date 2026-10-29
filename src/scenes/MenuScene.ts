import Phaser from 'phaser';
import { FACTIONS } from '../data/factions';
import { chooseCivilization, loadSave, TRAITS, writeSave } from '../core/economy';
import { button, caption, drawGround, drawScenery, intro, label, rotateHint, outline, PAL, splitStage, stageCamera, state, TXT, twinkle, vGradient, VIEW } from './common';
import { cardFx, pedestal, plate, TOP } from './gameUi'; // TOP: everything on the menu sits above the dimmed backdrop
import { createBuildingView, facingOf, paintOverlay } from './sprites';

let autoEntered = false; // skip the menu once per page load when a civilization is already saved

export class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }

  create() {
    stageCamera(this);
    rotateHint(this.game);
    const save = loadSave();
    if (save.civilization !== null && !autoEntered) { autoEntered = true; state.faction = save.civilization; this.scene.start('base'); return; }
    const owned = save.civilization;
    this.cameras.main.fadeIn(450);

    // Backdrop: the player's own base (or the starter layout) in the world camera, behind a dim veil on the HUD one.
    const stage = splitStage(this, { x: -60, y: 10, w: 920, h: 550 }, (d) => d >= 400);
    drawScenery(this, save.mapSkin, stage.view);
    drawGround(this.add.graphics());
    for (const b of save.layout) {
      const v = createBuildingView(this, FACTIONS[b.faction ?? owned ?? 0].id, b.kind, b.x, b.y, facingOf(save.layout, b));
      paintOverlay(v, b.x, b.y, b.lvl);
    }
    const veil = this.add.graphics().setDepth(400);
    // the whole screen dims a little, darker toward the bottom where the big button floats
    vGradient(veil, 0, 0, VIEW.w, VIEW.h, 0x1d3466, 0x0f1c3a, 14, 0.5);
    for (let i = 0; i < 12; i++) twinkle(this, 30 + ((i * 131) % (VIEW.w - 60)), 30 + ((i * 71) % (VIEW.h - 60)), 401, 0.3 + (i % 3) * 0.12, i * 300);

    this.title();
    const base = this.children.list.length;
    if (owned !== null) this.continueView(owned);
    else this.pickView(save);
    intro(this, base, 250, 18);
  }

  /** Title on the scroll banner: drops in with a small overshoot, sparkles on its corners. */
  private title() {
    const cx = VIEW.w / 2;
    const ban = this.add.image(cx, 64, 'ui_banner').setDepth(TOP);
    const bk = Math.min(400 / ban.width, 112 / ban.height);
    ban.setScale(bk);
    const name = label(this, cx, 62, '铁壁仙门', 40, '#6e1f0c').setOrigin(0.5).setDepth(TOP + 1).setLetterSpacing(6).setShadow(0, 2, '#fff6d8', 0, false, true);
    const sub = outline(label(this, cx, 124, '万国英雄 · 仙侠大乱斗', 18, TXT.gold).setOrigin(0.5).setDepth(TOP + 1), '#1a1008', 5);
    [ban, name].forEach((o, i) => {
      const k = o === ban ? bk : 1, y = o.y;
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, y: { from: y - 40, to: y }, scale: { from: k * 0.82, to: k }, duration: 650, delay: i * 80, ease: 'Back.easeOut' });
    });
    sub.setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, delay: 420 });
    [[-190, 34], [190, 34], [0, 14], [95, 110], [-110, 110]].forEach(([dx, dy], i) => twinkle(this, cx + dx, dy, TOP + 2, 0.55, 700 + i * 260));
  }

  /** Existing save: one big continue button. */
  private continueView(civ: number) {
    const f = FACTIONS[civ], cx = VIEW.w / 2, B = VIEW.h;
    const mid = (140 + B - 96) / 2; // between the title and the button
    pedestal(this, cx, mid + 34, 160, f.color);
    const hero = this.add.image(cx, mid - 22, `unit_${f.troops[0].id}`).setDepth(TOP + 1);
    hero.setScale(Math.min(112 / hero.height, 116 / hero.width));
    this.tweens.add({ targets: hero, y: hero.y - 6, delay: 900, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    caption(this, cx, mid + 64, `当前道统：${f.name}`, 17, TOP + 1, TXT.gold, 240);
    this.bigButton(cx, B - 62, 320, 66, '继续经营', () => { state.faction = civ; this.scene.start('base'); });
    outline(label(this, cx, B - 17, '领地、英灵与远征进度已保存', 13, TXT.dim).setOrigin(0.5).setDepth(TOP + 1), '#101420', 3);
  }

  /** Fresh save: choose the opening civilization, then start. */
  private pickView(save: ReturnType<typeof loadSave>) {
    let sel = 0;
    const draws: Array<(on: boolean) => void> = [];
    // three cards between the title and the start button, as tall as the screen allows
    const ch = Math.min(256, VIEW.h - 250), cy = 146 + ch / 2;
    FACTIONS.forEach((f, i) => {
      const cx = VIEW.w / 2 + (i - 1) * 250, picY = cy - ch / 2 + 50;
      const idle = plate(this, cx, cy, 216, ch);
      const lit = plate(this, cx, cy, 216, ch, true);
      pedestal(this, cx, picY + 40, 140, f.color);
      const pic = this.add.image(cx, picY, `unit_${f.troops[0].id}`).setDepth(TOP + 1);
      pic.setScale(Math.min(96 / pic.height, 140 / pic.width));
      outline(label(this, cx, cy + ch / 2 - 82, f.name, 20, TXT.gold).setOrigin(0.5).setDepth(TOP + 1), '#1a1008', 5);
      outline(label(this, cx, cy + ch / 2 - 58, f.tagline, 14, TXT.body).setOrigin(0.5).setDepth(TOP + 1), '#1a1008', 3);
      outline(label(this, cx, cy + ch / 2 - 26, TRAITS[i].replace('：', '\n'), 13, TXT.cyan).setOrigin(0.5).setAlign('center').setLineSpacing(2).setDepth(TOP + 1), '#101830', 3);
      // check badge on the chosen card
      const tick = this.add.graphics({ x: cx + 92, y: cy - ch / 2 + 20 }).setDepth(TOP + 2);
      tick.fillStyle(PAL.goldDeep, 1).fillCircle(0, 0, 13).fillStyle(PAL.gold, 1).fillCircle(0, 0, 11).lineStyle(3, 0x5a3a08, 1).lineBetween(-5, 0, -1, 4).lineBetween(-1, 4, 6, -5);
      const hit = this.add.rectangle(cx, cy, 216, ch, 0, 0).setDepth(TOP + 3).setInteractive({ useHandCursor: true });
      cardFx(this, hit, cx, cy, 216, ch, 18);
      draws.push((on) => {
        idle.setVisible(!on);
        lit.setVisible(on);
        tick.setVisible(on);
        pic.setAlpha(1);
        this.tweens.killTweensOf(pic);
        pic.y = picY;
        if (on) this.tweens.add({ targets: pic, y: picY - 6, delay: 700, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      });
      hit.on('pointerdown', () => { sel = i; draws.forEach((d, k) => d(k === sel)); });
    });
    draws.forEach((d, k) => d(k === sel));
    this.bigButton(VIEW.w / 2, VIEW.h - 56, 300, 60, '开始游戏', () => {
      chooseCivilization(save, sel); writeSave(save); state.faction = sel; this.scene.start('base');
    });
    outline(label(this, VIEW.w / 2, VIEW.h - 15, '选择开局道统 · 之后建筑、兵种可自由混编', 13, TXT.dim).setOrigin(0.5).setDepth(TOP + 1), '#101420', 3);
  }

  private bigButton(x: number, y: number, w: number, h: number, t: string, on: () => void) {
    const b = button(this, x, y, w, h, t, 0xf6c24a, on, true);
    b.tx.setFontSize(26);
    b.r.setDepth(TOP + 2);
    twinkle(this, x - w / 2 + 14, y - h / 2 + 4, TOP + 3, 0.5, 300);
    twinkle(this, x + w / 2 - 14, y + h / 2 - 6, TOP + 3, 0.45, 1100);
    return b;
  }
}
