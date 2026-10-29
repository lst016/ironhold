import Phaser from 'phaser';
import { FACTIONS, ROLE_NAME, SKILLS, type Role } from '../data/factions';
import { boosted, enhanceWeapon, loadSave, writeSave, type Save } from '../core/economy';
import { MAX_CONSTELLATION, starsOf } from '../core/summon';
import { burst, countTo, ensureFx, hudText, ICON, intro, label, outline, PAL, shade, stageCamera, TXT, VIEW } from './common';
import { backBtn, chip, closeX, heroFace, nine, pill, plate, stars, tag, titlePlate, TOP } from './gameUi';

/**
 * 英灵殿, built to its concept (canvas board 铁壁仙门 · 单机 IAA, node concept-hero-hall) from the kit cut out of it
 * (scripts/prep_hall.py): pick a hero on the left, see them on the pedestal, grow them on the right, and set the
 * squad along the bottom. Summoning lives on the base, not here. Roster, growth and squad share one save.
 */
const ROLE: Record<Role, string> = ROLE_NAME;
const heroes = () => FACTIONS.flatMap((f) => f.troops.filter((t) => t.hero));
const unitOf = (id: string) => FACTIONS.flatMap((f) => f.troops).find((t) => t.id === id)!;
const factionOf = (id: string) => FACTIONS.find((f) => f.troops.some((t) => t.id === id))!;
// Laid out against the screen edges when the scene starts (VIEW changes when the phone turns):
// hero cards down the left, the detail panel full height on the right, the squad bar along the bottom between
// them, and the chosen hero on the pedestal in the space that is left.
const CARD = { x: 0, w: 180, h: 80, top: 102, gap: 88 };
const PANEL = { x: 0, y: 0, w: 232, h: 0, top: 62 };
const BAR = { x: 0, y: 0, w: 0, h: 76 };
const STAGE = { x: 0, y: 0, w: 240 }; // pedestal centre and width
function layout() {
  CARD.x = VIEW.l + 100;
  PANEL.h = VIEW.h - PANEL.top - 8;
  PANEL.x = VIEW.r - PANEL.w / 2 - 10;
  PANEL.y = PANEL.top + PANEL.h / 2;
  const barL = VIEW.l + 12, barR = PANEL.x - PANEL.w / 2 - 8;
  BAR.w = barR - barL;
  BAR.x = (barL + barR) / 2;
  BAR.y = VIEW.h - 46;
  const stL = CARD.x + CARD.w / 2, stR = PANEL.x - PANEL.w / 2;
  STAGE.x = (stL + stR) / 2;
  STAGE.w = Math.min(300, stR - stL - 20);
  STAGE.y = BAR.y - BAR.h / 2 - 38;
}

export class ProgressScene extends Phaser.Scene {
  private save!: Save;
  private sel = '';
  private notice = '';
  private first = true; // entrance animation plays once; later re-renders after a tap stay still
  private shown = { stone: 0, tokens: 0 }; // last values on screen, so the capsules can roll to the new ones
  constructor() { super('progress'); }

  preload() {
    for (const t of FACTIONS.flatMap((f) => f.troops)) if (!this.textures.exists(`por_${t.id}`)) this.load.image(`por_${t.id}`, `assets/gacha/portraits/${t.id}.webp`);
  }

  create() {
    stageCamera(this);
    layout();
    ensureFx(this);
    this.save = loadSave();
    this.first = true;
    this.notice = '';
    this.shown = { stone: this.save.stone, tokens: this.save.tokens };
    const pool = heroes();
    this.sel = pool.find((h) => h.id === this.save.squad[0])?.id ?? pool[0].id;
    this.render();
  }

  private act(fn: () => string) { this.notice = fn(); writeSave(this.save); this.render(); }

  private render() {
    this.tweens.killAll();
    this.children.removeAll(true);
    const bg = this.add.image(VIEW.w / 2, VIEW.h / 2, 'hall_bg');
    bg.setScale(Math.max(VIEW.w / bg.width, VIEW.h / bg.height));
    const shadeG = this.add.graphics();
    for (let i = 0; i < 10; i++) shadeG.fillStyle(0x070b1c, 0.055 * (10 - i)).fillRect(0, i * 7, VIEW.w, 7).fillRect(0, VIEW.h - (i + 1) * 9, VIEW.w, 9);
    this.topBar();
    const base = this.children.list.length;
    this.heroList();
    this.showcase();
    this.details();
    this.squadBar();
    if (this.notice) this.toast(this.notice);
    if (this.first) { this.first = false; intro(this, base); }
  }

  // ---------- top ----------

  private topBar() {
    backBtn(this, VIEW.l + 34, 32, () => { writeSave(this.save); this.scene.start('base'); });
    titlePlate(this, VIEW.l + 160, 32, '英灵殿');
    const stone = chip(this, VIEW.r - 272, 122, 'icon_stone', '', 32), token = chip(this, VIEW.r - 136, 122, 'icon_token', '', 32);
    countTo(this, stone, this.shown.stone, this.save.stone);
    countTo(this, token, this.shown.tokens, this.save.tokens);
    this.shown = { stone: this.save.stone, tokens: this.save.tokens };
  }

  private toast(t: string) {
    const tx = outline(label(this, STAGE.x, 84, t, 14, TXT.gold), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 6);
    const g = this.add.graphics().setDepth(TOP + 5);
    g.fillStyle(0x070b1c, 0.75).fillRoundedRect(STAGE.x - tx.width / 2 - 14, 70, tx.width + 28, 28, 14);
    this.tweens.add({ targets: [tx, g], alpha: 0, delay: 2200, duration: 400 });
  }

  // ---------- left: hero banner cards ----------

  private heroList() {
    heroes().forEach((u, i) => {
      const y = CARD.top + i * CARD.gap, on = u.id === this.sel, h = this.save.heroes[u.id];
      const c = this.add.container(CARD.x, y).setDepth(TOP);
      c.add(this.add.image(0, 0, heroFace(this, u.id, factionOf(u.id).color, !!h, CARD.w, CARD.h)).setScale(1 / 3));
      c.add(on ? nine(this, 'card_on', 0, 0, CARD.w + 22, CARD.h + 22, 18, 70) : nine(this, 'card', 0, 0, CARD.w + 6, CARD.h + 6, 14, 70));
      // name pill bottom-left, constellation stars (or a padlock) bottom-right
      const t = tag(this, -CARD.w / 2 + 48, CARD.h / 2 - 15, 'tag_blue', u.name, 80, 22, 13);
      c.add([t.p, t.tx]);
      if (h) c.add(stars(this, 42, CARD.h / 2 - 15, h.constellation, MAX_CONSTELLATION, 11, 13));
      else {
        const lock = this.add.image(40, -4, 'hall_lock');
        c.add(lock.setScale(28 / lock.width));
      }
      if (on) c.setScale(1.04);
      const hit = this.add.rectangle(CARD.x, y, CARD.w, CARD.h, 0, 0).setDepth(TOP + 3).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => !on && this.tweens.add({ targets: c, scale: 1.03, duration: 90 }))
        .on('pointerout', () => !on && this.tweens.add({ targets: c, scale: 1, duration: 90 }))
        .on('pointerdown', () => { if (!on) { this.sel = u.id; this.notice = ''; this.render(); } });
    });
  }

  /** A kit icon (hall_<key>) `size` px wide. */
  private icon(x: number, y: number, key: string, size: number) {
    const img = this.add.image(x, y, `hall_${key}`);
    return img.setScale(size / img.width);
  }

  // ---------- centre: the selected hero on the pedestal ----------

  private showcase() {
    const u = unitOf(this.sel), h = this.save.heroes[u.id];
    const beam = this.add.image(STAGE.x, STAGE.y - 170, 'fx_glow').setTint(0xffd27a).setBlendMode('ADD').setScale(5.5, 15).setAlpha(0.3).setDepth(TOP - 3);
    this.tweens.add({ targets: beam, alpha: 0.45, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const rays = this.add.image(STAGE.x, STAGE.y - 170, 'fx_rays').setTint(PAL.gold).setBlendMode('ADD').setScale(2.8).setAlpha(h ? 0.22 : 0.08).setDepth(TOP - 3);
    this.tweens.add({ targets: rays, angle: 360, duration: 30000, repeat: -1 });
    const ped = this.add.image(STAGE.x, STAGE.y, 'hall_pedestal').setDepth(TOP - 2);
    ped.setScale(STAGE.w / ped.width);
    const ph = ped.displayHeight, feet = STAGE.y - ph / 2 + ph * 0.32;
    // as tall as the room under the title bar allows
    const ch = Math.min(300, feet - 76);
    const pic = this.add.image(STAGE.x, feet, `por_${u.id}`).setOrigin(0.5, 1).setDepth(TOP - 1);
    pic.setScale(Math.min(ch / pic.height, (STAGE.w - 10) / pic.width));
    if (h) this.tweens.add({ targets: pic, y: feet - 6, delay: 900, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    else {
      pic.setTint(0x2a3462).setTintMode(Phaser.TintModes.FILL);
      this.icon(STAGE.x, feet - pic.displayHeight / 2, 'lock', 64).setDepth(TOP);
    }
    hudText(this, STAGE.x, STAGE.y - ph / 2 + ph * 0.79, u.name, 17, TXT.gold).setOrigin(0.5).setDepth(TOP - 1);
  }

  // ---------- right: details and growth ----------

  private details() {
    const u = unitOf(this.sel), f = factionOf(u.id), h = this.save.heroes[u.id], b = boosted(this.save, u);
    nine(this, 'panel', PANEL.x, PANEL.y, PANEL.w, PANEL.h, 22, 60).setDepth(TOP);
    const x0 = PANEL.x - PANEL.w / 2 + 20, x1 = PANEL.x + PANEL.w / 2 - 20, D = TOP + 1;
    const line = (y: number) => this.add.graphics().setDepth(D).lineStyle(1, PAL.gold, 0.35).lineBetween(x0, y, x1, y);
    const say = (x: number, y: number, t: string, size: number, color: string, ox = 0) =>
      outline(label(this, x, y, t, size, color), TXT.edge, 3).setOrigin(ox, 0.5).setDepth(D);
    // stats flow down from the top of the panel, the two buttons sit on its bottom edge
    const T = PANEL.top, B = PANEL.top + PANEL.h;
    hudText(this, PANEL.x, T + 32, u.name, 24, TXT.gold).setOrigin(0.5).setDepth(D);
    tag(this, PANEL.x - 46, T + 64, 'tag_gold', f.name, 100, 24);
    tag(this, PANEL.x + 62, T + 64, 'tag_blue', ROLE[u.role], 68, 24);
    line(T + 84);
    // skill: the ring holds the skill orb; name and description beside it
    const ring = this.icon(x0 + 20, T + 112, 'ring', 44).setDepth(D + 0.5);
    this.add.image(ring.x, ring.y, 'ui_skill').setScale(30 / ICON).setDepth(D);
    const sk = u.skill ? SKILLS[u.skill] : undefined;
    say(x0 + 50, T + 100, sk ? sk.name : '—', 15, '#ffe9a8');
    if (sk) outline(label(this, x0 + 50, T + 111, sk.desc, 11, TXT.cream), TXT.edge, 3).setOrigin(0, 0).setDepth(D).setWordWrapWidth(x1 - x0 - 50);
    line(T + 158);
    const r = T + 176;
    say(x0, r, '命座', 14, TXT.cyan);
    for (let k = 0; k < MAX_CONSTELLATION; k++) this.icon(x0 + 56 + k * 24, r, k < (h?.constellation ?? 0) ? 'star_on' : 'star_off', 20).setDepth(D);
    say(x0, r + 24, '武器', 14, TXT.cyan);
    for (let k = 0; k < 5; k++) this.icon(x0 + 56 + k * 28, r + 24, k < (h?.weapon ?? 0) ? 'pip_on' : 'pip_off', 20).setDepth(D);
    this.add.image(x0 + 8, r + 50, 'ui_icon_sword').setScale(22 / ICON).setDepth(D);
    say(x0 + 26, r + 50, '攻击', 14, TXT.cream);
    say(x1, r + 50, `${b.dmg}`, 17, '#ffffff', 1);
    this.add.image(x0 + 8, r + 72, 'ui_icon_wall').setScale(22 / ICON).setDepth(D);
    say(x0 + 26, r + 72, '生命', 14, TXT.cream);
    say(x1, r + 72, `${b.hp}`, 17, '#ffffff', 1);
    say(PANEL.x, r + 92, '命座 攻+8% 血+10% · 武器 攻+12%', 10, TXT.dim, 0.5);

    if (!h) {
      say(PANEL.x, B - 76, '问仙召唤获得', 17, TXT.gold, 0.5);
      say(PANEL.x, B - 50, '基地「召唤」· 十连必得英雄', 11, TXT.dim, 0.5);
      say(PANEL.x, B - 30, '重复获得则提升命座', 11, TXT.dim, 0.5);
      return;
    }
    // the fielded hero's button takes it back off: raids and expeditions then go without a hero
    const onSquad = this.save.squad[0] === u.id;
    pill(this, PANEL.x, B - 82, 196, 44, onSquad ? '取消出战' : '出战', onSquad ? 0xe0604a : 0xf6c24a, () => {
      this.act(() => {
        this.save.squad[0] = onSquad ? '' : u.id;
        return onSquad ? `${u.name} 已取消出战` : `${u.name} 出战`;
      });
    }, 19, !onSquad);
    const maxed = h.weapon >= 5;
    const up = pill(this, PANEL.x, B - 34, 196, 40, maxed ? '武器已满级' : `强化武器 · ${100 * (h.weapon + 1)}灵石`, 0x3fd6c0, () => {
      const before = h.weapon;
      this.act(() => enhanceWeapon(this.save, u.id));
      if ((this.save.heroes[u.id]?.weapon ?? 0) > before) burst(this, PANEL.x, r + 24, TOP + 5, 18);
    }, 15);
    if (maxed) up.r.setStrokeStyle(1, 0, 0.5);
  }

  // ---------- bottom: the squad ----------

  private squadBar() {
    nine(this, 'bar', BAR.x, BAR.y, BAR.w, BAR.h, 16, 40).setDepth(TOP);
    const left = BAR.x - BAR.w / 2;
    const rb = this.add.image(left + 66, BAR.y - 8, 'hall_ribbon').setDepth(TOP + 1);
    rb.setScale(108 / rb.width);
    hudText(this, rb.x, rb.y - 1, '出战编队', 14, TXT.gold).setOrigin(0.5).setDepth(TOP + 2);
    // the hero slot fields the hero in raids too; raid troops come from the 军营, these four only lead expeditions
    outline(label(this, rb.x, BAR.y + 18, '英雄随军进攻 · 兵种用于远征', 10, TXT.dim), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 1);
    // slots shrink together when the squad would run past the bar into the detail panel
    const slots = this.save.squad.length, first = left + 168;
    const step = Math.min(76, (left + BAR.w - 44 - first) / Math.max(1, slots - 1)), k = Math.min(1, step / 76);
    this.save.squad.forEach((id, i) => {
      const x = first + i * step, y = BAR.y, hero = i === 0;
      // each slot is drawn at its own origin in a container scaled by k; the tag sits across its top edge
      const c = this.add.container(x, y).setDepth(TOP + 1).setScale(k);
      const g = this.add.graphics();
      c.add(g);
      if (id) {
        const f = factionOf(id);
        g.fillStyle(shade(f.color, 0.32), 1).fillRoundedRect(-27, -27, 54, 54, 9);
        g.fillStyle(shade(f.color, 0.62), 0.5).fillRoundedRect(-25, -25, 50, 26, { tl: 8, tr: 8, bl: 0, br: 0 });
        const pic = this.add.image(0, -3, `unit_${id}`);
        pic.setScale(Math.min(48 / pic.width, 46 / pic.height));
        c.add(pic);
      } else {
        // no hero fielded (取消出战): a dark seat with a plus, tap to pick one
        g.fillStyle(0x0b1127, 0.75).fillRoundedRect(-27, -27, 54, 54, 9);
        const plus = this.add.image(0, -4, 'hall_plus').setAlpha(0.85);
        plus.setScale(26 / plus.width);
        c.add(plus);
      }
      const fr = hero ? nine(this, 'slot_on', 0, 0, 74, 74, 14, 60) : nine(this, 'slot', 0, 0, 64, 64, 12, 60);
      c.add(fr);
      if (!id) c.add(outline(label(this, 0, 16, '未出战', 10, TXT.dim), TXT.edge, 3).setOrigin(0.5));
      // troop stars from souls, only once there is one; the hero slot carries the gold frame instead
      const n = hero ? 0 : starsOf(this.save.souls[id] ?? 0);
      if (n) c.add(stars(this, 0, 22, n, n, 11, 11));
      const rt = tag(this, 0, -33, hero ? 'tag_gold' : 'tag_blue', hero ? '英雄' : ROLE[unitOf(id).role], 44, 18, 11);
      c.add([rt.p, rt.tx]);
      const hit = this.add.rectangle(x, y, 68 * k, 68 * k, 0, 0).setDepth(TOP + 5).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => fr.setTint(0xfff3d0)).on('pointerout', () => fr.clearTint());
      hit.on('pointerdown', () => this.picker(i));
    });
  }

  /**
   * Choose who fills squad slot i: every candidate side by side (the hero slot lists the heroes, a troop slot that
   * role's unit from each civilization) with bust, civilization, stars and real stats; the one fielded is marked,
   * heroes not yet owned are greyed with where to get them. Tap a card to field it, tap outside to close.
   */
  private picker(i: number) {
    const hero = i === 0, cur = this.save.squad[i];
    const options = hero ? heroes() : FACTIONS.map((f) => f.troops[i]);
    const D = 900, cw = 150, ch = 214, cy = VIEW.h / 2 + 14, cx = VIEW.w / 2;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const close = () => parts.forEach((o) => o.destroy());
    parts.push(this.add.rectangle(0, 0, VIEW.w, VIEW.h, 0x050814, 0.72).setOrigin(0).setDepth(D).setInteractive().on('pointerdown', close));
    const pw = options.length * (cw + 18) + 44, ph = ch + 92;
    parts.push(plate(this, cx, cy, pw, ph).setDepth(D + 1));
    parts.push(...closeX(this, cx + pw / 2 - 6, cy - ph / 2 + 6, D + 7, close));
    const t = titlePlate(this, cx, cy - ch / 2 - 42, hero ? '更换出战英雄' : `更换${ROLE[unitOf(cur).role]}兵种`, 220, D + 2);
    parts.push(t.img, t.tx);
    options.forEach((u, k) => {
      const f = factionOf(u.id), x = cx + (k - (options.length - 1) / 2) * (cw + 18), owned = !hero || !!this.save.heroes[u.id];
      const on = u.id === cur, b = boosted(this.save, u), top = cy - ch / 2;
      const say = (sx: number, sy: number, s: string, size: number, color: string) =>
        parts.push(outline(label(this, sx, sy, s, size, color), TXT.edge, 3).setOrigin(0.5).setDepth(D + 4));
      parts.push(this.add.image(x, top + 62, heroFace(this, u.id, f.color, owned, cw - 12, 112, 1.45)).setScale(1 / 3).setDepth(D + 2));
      parts.push(nine(this, on ? 'card_on' : 'card', x, cy, cw + (on ? 18 : 4), ch + (on ? 18 : 4), on ? 18 : 14, 70).setDepth(D + 3));
      say(x, top + 134, u.name, 16, owned ? '#ffffff' : TXT.dim);
      const ft = tag(this, x, top + 156, 'tag_gold', f.name, 92, 20, 11);
      parts.push(ft.p.setDepth(D + 4), ft.tx.setDepth(D + 4.5));
      const lv = hero ? this.save.heroes[u.id]?.constellation ?? 0 : starsOf(this.save.souls[u.id] ?? 0);
      parts.push(stars(this, x, top + 178, lv, hero ? MAX_CONSTELLATION : 5, 12, 14).setDepth(D + 4));
      say(x, top + 198, owned ? `生命 ${b.hp} · 攻击 ${b.dmg}` : '问仙召唤获得', 11, owned ? TXT.cream : TXT.gold);
      if (on) {
        const st = tag(this, x, top + 6, 'tag_jade', '出战中', 64, 22, 12);
        parts.push(st.p.setDepth(D + 5), st.tx.setDepth(D + 5.5));
      }
      if (!owned) {
        const lock = this.add.image(x + 40, top + 40, 'hall_lock').setDepth(D + 4);
        parts.push(lock.setScale(28 / lock.width));
      }
      const hit = this.add.rectangle(x, cy, cw, ch, 0, 0).setDepth(D + 6).setInteractive({ useHandCursor: owned && !on });
      hit.on('pointerdown', () => {
        if (on) { close(); return; }
        if (!owned) return; // the card already says where to get them
        this.act(() => {
          this.save.squad[i] = u.id;
          if (hero) this.sel = u.id;
          return `${u.name} 出战（${hero ? '英雄' : ROLE[u.role]}）`;
        });
      });
      parts.push(hit);
    });
    parts.push(outline(label(this, cx, cy + ch / 2 + 30, '点击空白处关闭', 11, TXT.dim), TXT.edge, 3).setOrigin(0.5).setDepth(D + 4));
  }
}
