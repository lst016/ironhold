import Phaser from 'phaser';
import { FACTIONS, ROLE_NAME, ROLE_ORDER, trainOf, type Role, type TroopDef } from '../data/factions';
import { addTroop, armyList, costOf, housingCap, housingOf, lockReason, removeTroop, troopById } from '../core/army';
import { boosted, loadSave, writeSave, type Save } from '../core/economy';
import { starsOf } from '../core/summon';
import { countTo, ensureFx, hudText, intro, label, outline, PAL, shade, stageCamera, TXT, VIEW } from './common';
import { backBtn, chip, closeX, heroFace, nine, pill, plate, stars, tag, titlePlate, TOP } from './gameUi';

/**
 * 军营: set up the army a raid trains on the spot. The upper panel is the composition — population used against the
 * hall's cap, the 灵石 a raid will cost, the fielded hero and each troop with its count (tap to take one out) — and
 * the grid below lists every trainable troop (tap to add one; locked ones say which building unlocks them). Uses
 * the 英灵殿 kit so the two screens read as one set.
 */
const ROLE: Record<Role, string> = ROLE_NAME;
const factionOf = (id: string) => FACTIONS.find((f) => f.troops.some((t) => t.id === id))!;
/** The troop of civilization `f` in role `r`, if it has one: the grid is civilizations (rows) by roles (columns). */
const cellTroop = (f: number, r: Role) => FACTIONS[f].troops.find((t) => !t.hero && t.role === r);

// Laid out when the scene starts (VIEW follows the window): army panel across the top, troop grid below with
// one row per civilization and one column per role, so a column compares one role across the three.
const ARMY = { x: 0, y: 0, w: 0, h: 108, top: 56 };
const GRID = { cw: 120, ch: 80, gap: 6, top: 0, x0: 0 };
function layout() {
  ARMY.w = VIEW.r - VIEW.l - 24;
  ARMY.x = (VIEW.l + VIEW.r) / 2;
  ARMY.y = ARMY.top + ARMY.h / 2;
  GRID.top = ARMY.top + ARMY.h + 28;
  const rows = FACTIONS.length, cols = ROLE_ORDER.length;
  GRID.ch = Math.min(88, (VIEW.h - GRID.top - 6 - (rows - 1) * GRID.gap) / rows);
  GRID.cw = Math.min(168, (VIEW.r - VIEW.l - 24 - (cols - 1) * GRID.gap) / cols);
  GRID.x0 = (VIEW.l + VIEW.r) / 2 - ((cols - 1) * (GRID.cw + GRID.gap)) / 2;
}

export class TrainScene extends Phaser.Scene {
  private save!: Save;
  private notice = '';
  private first = true;
  private shownStone = 0;
  private popAt: { x: number; y: number; t: string } | null = null; // "+1" / "-1" to float after the next render
  constructor() { super('train'); }

  init(data: { notice?: string }) { this.notice = data?.notice ?? ''; }

  preload() {
    for (const t of FACTIONS.flatMap((f) => f.troops)) if (!this.textures.exists(`por_${t.id}`)) this.load.image(`por_${t.id}`, `assets/gacha/portraits/${t.id}.webp`);
  }

  create() {
    stageCamera(this);
    layout();
    ensureFx(this);
    this.save = loadSave();
    this.first = true;
    this.shownStone = this.save.stone;
    this.render();
  }

  private render() {
    this.tweens.killAll();
    this.children.removeAll(true);
    const bg = this.add.image(VIEW.w / 2, VIEW.h / 2, 'hall_bg');
    bg.setScale(Math.max(VIEW.w / bg.width, VIEW.h / bg.height));
    const shadeG = this.add.graphics();
    for (let i = 0; i < 10; i++) shadeG.fillStyle(0x070b1c, 0.06 * (10 - i)).fillRect(0, i * 7, VIEW.w, 7).fillRect(0, VIEW.h - (i + 1) * 9, VIEW.w, 9);
    this.topBar();
    const base = this.children.list.length;
    this.armyPanel();
    this.troopGrid();
    if (this.notice) { this.toast(this.notice); this.notice = ''; }
    if (this.popAt) { this.float(this.popAt.x, this.popAt.y, this.popAt.t); this.popAt = null; }
    if (this.first) { this.first = false; intro(this, base); }
  }

  private change(fn: () => string | null, pop?: { x: number; y: number; t: string }) {
    const err = fn();
    if (err) this.notice = err;
    else if (pop) this.popAt = pop;
    writeSave(this.save);
    this.render();
  }

  // ---------- top ----------

  private topBar() {
    backBtn(this, VIEW.l + 34, 30, () => { writeSave(this.save); this.scene.start('base'); });
    titlePlate(this, VIEW.l + 160, 30, '军营');
    const stone = chip(this, VIEW.r - 150, 128, 'icon_stone', '', 30);
    countTo(this, stone, this.shownStone, Math.floor(this.save.stone));
    this.shownStone = Math.floor(this.save.stone);
  }

  private toast(t: string) {
    const y = ARMY.top + ARMY.h + 14;
    const tx = outline(label(this, VIEW.w / 2, y, t, 13, TXT.gold), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 8);
    const g = this.add.graphics().setDepth(TOP + 7);
    g.fillStyle(0x070b1c, 0.85).fillRoundedRect(VIEW.w / 2 - tx.width / 2 - 14, y - 13, tx.width + 28, 26, 13);
    this.tweens.add({ targets: [tx, g], alpha: 0, delay: 2200, duration: 400 });
  }

  private float(x: number, y: number, t: string) {
    const tx = outline(label(this, x, y, t, 18, t.startsWith('+') ? TXT.green : TXT.red), TXT.edge, 4).setOrigin(0.5).setDepth(TOP + 9);
    this.tweens.add({ targets: tx, y: y - 30, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => tx.destroy() });
  }

  private img(x: number, y: number, key: string, size: number, depth = TOP + 1) {
    const i = this.add.image(x, y, key).setDepth(depth);
    return i.setScale(size / Math.max(i.width, i.height));
  }

  // ---------- upper panel: the composition ----------

  private armyPanel() {
    const s = this.save, used = housingOf(s.army), cap = housingCap(s), cost = costOf(s.army), D = TOP + 1;
    nine(this, 'panel', ARMY.x, ARMY.y, ARMY.w, ARMY.h, 20, 60).setDepth(TOP);
    const L = ARMY.x - ARMY.w / 2 + 18, R = ARMY.x + ARMY.w / 2 - 18, T = ARMY.top;
    // population: icon, count and a gold track that fills toward the cap
    const hy = T + 20;
    this.img(L + 12, hy, 'ui_icon_housing', 28);
    outline(label(this, L + 32, hy, `人口 ${used} / ${cap}`, 15, used >= cap ? TXT.gold : '#ffffff'), TXT.edge, 3).setOrigin(0, 0.5).setDepth(D);
    const tw = 150, tx0 = L + 128;
    const track = this.add.graphics().setDepth(D);
    track.fillStyle(0x070b1c, 0.8).fillRoundedRect(tx0, hy - 6, tw, 12, 6);
    track.fillStyle(used >= cap ? PAL.gold : 0x4fc3ff, 1).fillRoundedRect(tx0 + 2, hy - 4, Math.max(0, (tw - 4) * Math.min(1, used / cap)), 8, 4);
    track.fillStyle(0xffffff, 0.35).fillRoundedRect(tx0 + 4, hy - 4, Math.max(0, (tw - 8) * Math.min(1, used / cap)), 2, 1);
    const lvOf = (k: string) => s.layout.filter((b) => b.kind === k).reduce((m, b) => Math.max(m, b.lvl), 0);
    const camp = lvOf('barracks');
    outline(label(this, tx0 + tw + 10, hy, `大殿 ${lvOf('core')} 级 · ${camp ? `兵营 ${camp} 级` : '未建兵营'}`, 11, TXT.dim), TXT.edge, 3).setOrigin(0, 0.5).setDepth(D);
    // what the raid costs, against the wallet
    const short = cost > s.stone;
    const costTx = outline(label(this, R, hy, `${cost}`, 16, short ? TXT.red : '#ffffff'), TXT.edge, 3).setOrigin(1, 0.5).setDepth(D);
    const icX = R - costTx.width - 14;
    this.img(icX, hy, 'ui_icon_stone', 22);
    outline(label(this, icX - 14, hy, short ? '灵石不足 · 出兵消耗' : '出兵消耗', 12, short ? TXT.red : TXT.cream), TXT.edge, 3).setOrigin(1, 0.5).setDepth(D);
    this.add.graphics().setDepth(D).lineStyle(1, PAL.gold, 0.35).lineBetween(L, T + 36, R, T + 36);

    // the hero (from the 英灵殿, free) then each troop with its count; tap a troop to take one out
    const list = armyList(s.army);
    const hero = s.heroes[s.squad[0]] ? troopById(s.squad[0]) : undefined;
    const rowY = T + 68, btnW = 132, slotsR = R - btnW - 16;
    // the hero seat is always shown, empty after 取消出战 in the 英灵殿, so the hall stays one tap away
    const n = list.length + 1, step = Math.min(58, (slotsR - L) / Math.max(1, n)), k = Math.min(0.84, step / 66);
    let x = L + (step / 2);
    if (hero) this.slot(x, rowY, hero, k, true, 1);
    else this.noHero(x, rowY, k);
    x += step;
    for (const e of list) {
      const lock = lockReason(s, e.t);
      this.slot(x, rowY, e.t, k, false, e.n, lock);
      x += step;
    }
    if (!list.length) outline(label(this, x + 8, rowY, '点击下方兵种加入配兵 →', 13, TXT.dim), TXT.edge, 3).setOrigin(0, 0.5).setDepth(D);

    // actions on the right: clear, and march straight into a raid
    const by = rowY - 2;
    pill(this, R - btnW / 2, by - 16, btnW, 34, '出 征', 0xf6c24a, () => this.march(), 17, !!list.length && !short);
    pill(this, R - btnW / 2, by + 22, btnW, 26, '清空配兵', 0x5b6a9a, () => this.change(() => { s.army = {}; return '已清空配兵'; }), 12);
  }

  /** The hero seat with nobody fielded: a dark gold-framed seat with a plus; a tap opens the 英灵殿. */
  private noHero(x: number, y: number, k: number) {
    const c = this.add.container(x, y).setDepth(TOP + 1).setScale(k);
    const g = this.add.graphics();
    g.fillStyle(0x0b1127, 0.75).fillRoundedRect(-27, -27, 54, 54, 9);
    const plus = this.add.image(0, -4, 'hall_plus').setAlpha(0.85);
    plus.setScale(24 / plus.width);
    const tg = tag(this, 0, 33, 'tag_gold', '英雄', 40, 18, 12);
    c.add([g, plus, nine(this, 'slot_on', 0, 0, 72, 72, 14, 60), outline(label(this, 0, 14, '未出战', 10, TXT.dim), TXT.edge, 3).setOrigin(0.5), tg.p, tg.tx]);
    const hit = this.add.rectangle(x, y, 62 * k, 70 * k, 0, 0).setDepth(TOP + 4).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => c.setScale(k * 1.06)).on('pointerout', () => c.setScale(k));
    hit.on('pointerdown', () => { writeSave(this.save); this.scene.start('progress'); });
  }

  /** One composition slot: framed bust with its count; troops can be tapped to remove one. */
  private slot(x: number, y: number, t: TroopDef, k: number, hero: boolean, n: number, lock?: string | null) {
    const f = factionOf(t.id), c = this.add.container(x, y).setDepth(TOP + 1).setScale(k);
    const g = this.add.graphics();
    g.fillStyle(shade(f.color, 0.34), 1).fillRoundedRect(-27, -27, 54, 54, 9);
    g.fillStyle(shade(f.color, 0.66), 0.55).fillRoundedRect(-25, -25, 50, 26, { tl: 8, tr: 8, bl: 0, br: 0 });
    const pic = this.add.image(0, -2, `unit_${t.id}`);
    pic.setScale(Math.min(48 / pic.width, 46 / pic.height));
    if (lock) pic.setTint(0x666666);
    c.add([g, pic, hero ? nine(this, 'slot_on', 0, 0, 72, 72, 14, 60) : nine(this, 'slot', 0, 0, 62, 62, 12, 60)]);
    const tg = tag(this, 0, 33, hero ? 'tag_gold' : 'tag_blue', hero ? '英雄' : `×${n}`, hero ? 40 : 44, 18, 12);
    c.add([tg.p, tg.tx]);
    if (!hero) {
      // the red minus on the corner says what a tap does
      const m = this.add.graphics();
      m.fillStyle(0xd8402c, 1).fillCircle(24, -24, 9).lineStyle(2, 0xffffff, 0.95).strokeCircle(24, -24, 9);
      m.fillStyle(0xffffff, 1).fillRect(19, -25, 10, 2.5);
      c.add(m);
    }
    const hit = this.add.rectangle(x, y, 62 * k, 70 * k, 0, 0).setDepth(TOP + 4).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => c.setScale(k * 1.06)).on('pointerout', () => c.setScale(k));
    hit.on('pointerdown', () => {
      if (hero) { writeSave(this.save); this.scene.start('progress'); return; }
      this.change(() => { removeTroop(this.save, t.id); return null; }, { x, y: y - 30, t: '-1' });
    });
  }

  private march() {
    const s = this.save, list = armyList(s.army);
    if (!list.length) { this.notice = '先在下方选择兵种'; this.render(); return; }
    const cost = costOf(s.army);
    if (cost > s.stone) { this.notice = `灵石不足：出兵需要 ${cost}，现有 ${Math.floor(s.stone)}`; this.render(); return; }
    writeSave(s);
    this.scene.start('battle', { mode: 'attack' });
  }

  // ---------- lower grid: every trainable troop ----------

  private troopGrid() {
    const s = this.save, full = housingOf(s.army), cap = housingCap(s);
    // column headers: the role, and what unlocks it
    ROLE_ORDER.forEach((r, col) => {
      const x = GRID.x0 + col * (GRID.cw + GRID.gap), any = cellTroop(0, r) ?? FACTIONS.map((_, i) => cellTroop(i, r)).find(Boolean);
      const lock = any ? lockReason(s, any) : null;
      const tg = tag(this, x, GRID.top - 13, lock ? 'tag_blue' : 'tag_gold', ROLE[r], 46, 18, 11);
      tg.p.setDepth(TOP + 1); tg.tx.setDepth(TOP + 1.5);
      if (lock) outline(label(this, x + 27, GRID.top - 13, lock.replace('需要 ', ''), 9, TXT.red), TXT.edge, 3).setOrigin(0, 0.5).setDepth(TOP + 1);
    });
    FACTIONS.forEach((_, row) => ROLE_ORDER.forEach((r, col) => {
      const t = cellTroop(row, r);
      if (!t) return;
      const x = GRID.x0 + col * (GRID.cw + GRID.gap), y = GRID.top + GRID.ch / 2 + row * (GRID.ch + GRID.gap);
      const lock = lockReason(s, t), tr = trainOf(t), fits = full + tr.housing <= cap;
      this.card(t, x, y, lock, fits, s.army[t.id] ?? 0);
    }));
  }

  /**
   * A troop card, landscape: a square civilization-coloured bust on the left; population, price and souls' stars on
   * the right; the name along the bottom; how many are in the army on the bust's corner. Locked cards go dark with a
   * padlock; troops that no longer fit the population dim.
   */
  private card(t: TroopDef, x: number, y: number, lock: string | null, fits: boolean, inArmy: number) {
    const f = factionOf(t.id), W = GRID.cw, H = GRID.ch, tr = trainOf(t), D = TOP + 1;
    const c = this.add.container(x, y).setDepth(D);
    const bg = this.add.graphics();
    bg.fillStyle(shade(f.color, 0.26), 1).fillRoundedRect(-W / 2 + 2, -H / 2 + 2, W - 4, H - 4, 10);
    bg.fillStyle(shade(f.color, 0.45), 0.5).fillRoundedRect(-W / 2 + 4, -H / 2 + 4, W - 8, (H - 8) * 0.45, { tl: 8, tr: 8, bl: 0, br: 0 });
    c.add(bg);
    // the bust: a square tile at the left, above the name strip
    const s = H - 26, bx = -W / 2 + 5 + s / 2, by = -H / 2 + 5 + s / 2;
    c.add(this.add.image(bx, by, heroFace(this, t.id, f.color, true, s, s, 1.55)).setScale(1 / 3));
    const say = (sx: number, sy: number, str: string, size: number, color: string, ox = 0.5) => outline(label(this, sx, sy, str, size, color), TXT.edge, 3).setOrigin(ox, 0.5);
    // the column right of the bust: population, price, stars
    const rx = -W / 2 + s + 12;
    const hi = this.add.image(rx + 7, -H / 2 + 16, 'ui_icon_housing');
    hi.setScale(16 / hi.height);
    const si = this.add.image(rx + 7, -H / 2 + 36, 'ui_icon_stone');
    si.setScale(16 / si.height);
    c.add([hi, say(rx + 18, -H / 2 + 16, `${tr.housing}`, 13, '#ffffff', 0), si, say(rx + 18, -H / 2 + 36, `${tr.cost}`, 13, '#ffffff', 0)]);
    const st = starsOf(this.save.souls[t.id] ?? 0);
    if (st) c.add(stars(this, rx + 22, -H / 2 + 52, st, st, 8, 8));
    // name along the bottom
    const strip = this.add.graphics();
    strip.fillStyle(0x0a1026, 0.9).fillRoundedRect(-W / 2 + 3, H / 2 - 20, W - 6, 17, { tl: 0, tr: 0, bl: 9, br: 9 });
    c.add([strip, say(0, H / 2 - 11.5, t.name, 12, '#ffffff')]);
    c.add(nine(this, 'card', 0, 0, W + 4, H + 4, 12, 70));
    if (inArmy) {
      const n = tag(this, bx - s / 2 + 15, by - s / 2 + 8, 'tag_jade', `×${inArmy}`, 32, 17, 11);
      c.add([n.p, n.tx]);
    }
    if (lock) {
      const dark = this.add.graphics();
      dark.fillStyle(0x060914, 0.66).fillRoundedRect(-W / 2 + 2, -H / 2 + 2, W - 4, H - 4, 10);
      const lk = this.add.image(bx, by, 'hall_lock');
      lk.setScale(26 / lk.width);
      c.add([dark, lk]);
    } else if (!fits) c.setAlpha(0.6);
    // the info dot opens the troop's stats
    const ix = W / 2 - 12, iy = -H / 2 + 13;
    const info = this.add.graphics();
    info.fillStyle(0x2c6fd8, 1).fillCircle(ix, iy, 8).lineStyle(1.5, 0xffffff, 0.95).strokeCircle(ix, iy, 8);
    c.add([info, say(ix, iy, 'i', 11, '#ffffff')]);
    const infoHit = this.add.circle(x + ix, y + iy, 13, 0, 0).setDepth(D + 4).setInteractive({ useHandCursor: true });
    infoHit.on('pointerdown', () => this.details(t));
    const hit = this.add.rectangle(x, y, W, H, 0, 0).setDepth(D + 3).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => c.setScale(1.04)).on('pointerout', () => c.setScale(1));
    hit.on('pointerdown', () => {
      c.setScale(0.94);
      if (lock) { this.notice = `${t.name}：${lock}`; this.render(); return; }
      this.change(() => addTroop(this.save, t.id), { x, y: y - H / 2, t: '+1' });
    });
  }

  /** Troop stats on a popup: bust, civilization and role, real numbers with this save's growth, and the unlock. */
  private details(t: TroopDef) {
    const D = 900, f = factionOf(t.id), b = boosted(this.save, t), tr = trainOf(t), lock = lockReason(this.save, t);
    const pw = 360, ph = 236, cx = VIEW.w / 2, cy = VIEW.h / 2 + 8;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const close = () => parts.forEach((o) => o.destroy());
    parts.push(this.add.rectangle(0, 0, VIEW.w, VIEW.h, 0x050814, 0.72).setOrigin(0).setDepth(D).setInteractive().on('pointerdown', close));
    parts.push(plate(this, cx, cy, pw, ph).setDepth(D + 1));
    parts.push(...closeX(this, cx + pw / 2 - 6, cy - ph / 2 + 6, D + 7, close));
    const L = cx - pw / 2 + 20;
    parts.push(this.add.image(L + 60, cy - 6, heroFace(this, t.id, f.color, true, 120, 170, 1.45)).setScale(1 / 3).setDepth(D + 2));
    parts.push(nine(this, 'card', L + 60, cy - 6, 124, 174, 12, 70).setDepth(D + 3));
    const x0 = L + 136, say = (x: number, y: number, s: string, size: number, color: string, ox = 0) =>
      parts.push(outline(label(this, x, y, s, size, color), TXT.edge, 3).setOrigin(ox, 0.5).setDepth(D + 4));
    parts.push(hudText(this, x0, cy - ph / 2 + 30, t.name, 20, TXT.gold).setOrigin(0, 0.5).setDepth(D + 4));
    const ft = tag(this, x0 + 42, cy - ph / 2 + 56, 'tag_gold', f.name, 84, 20, 11), rt = tag(this, x0 + 120, cy - ph / 2 + 56, 'tag_blue', ROLE[t.role], 52, 20, 11);
    parts.push(ft.p.setDepth(D + 4), ft.tx.setDepth(D + 4.5), rt.p.setDepth(D + 4), rt.tx.setDepth(D + 4.5));
    const rows: [string, string][] = [
      ['生命', `${b.hp}`], ['攻击', `${b.dmg}`], ['射程', `${t.range} 格`], ['移速', `${t.speed}`],
      ['人口', `${tr.housing}`], ['训练', `${tr.cost} 灵石`],
    ];
    rows.forEach(([k, v], i) => {
      const y = cy - ph / 2 + 84 + i * 21;
      say(x0, y, k, 13, TXT.cyan);
      say(cx + pw / 2 - 24, y, v, 14, '#ffffff', 1);
    });
    say(x0, cy + ph / 2 - 20, lock ? `解锁：${lock}` : t.flying ? '飞行：越过符墙' : t.targetsDefense ? '优先攻击灵塔' : '已解锁', 12, lock ? TXT.red : TXT.green);
  }
}
