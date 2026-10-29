import Phaser from 'phaser';
import { boosted, chooseCivilization, defaultSave, loadSave, writeSave, type Save } from '../core/economy';
import { FULL_SOUL_STONE, HERO_RATE, heroPool, MAX_CONSTELLATION, mulberry32, PITY, pullsToHero, soulProgress, soulsToNext, STAR_BONUS, SOUL_STEPS, summon, troopPool, type Pull } from '../core/summon';
import { FACTIONS, ROLE_NAME, SKILLS, type Role } from '../data/factions';
import { burst, calmCamera, caption, ensureFx, factionOf, H, hudText, ICON, label, outline, shade, splitStage, stageCamera, twinkle, TXT, VIEW, W, type Stage } from './common';
import { chip, closeX, header, heroFace, nine, pill, pips, plate, stars, tag, titlePlate, TOP } from './gameUi';

/**
 * 问仙召唤 (canvas/documents/gacha-design.md). One shared stage for every result: the painted pavilion is the
 * only fixed art; the talisman, rune strokes, circle rings, light pillar, meteors and cards are drawn here, and the
 * result's own portrait is dropped into the silhouette / reveal slot. Results are rolled and saved before any of
 * it plays, so skipping or closing never changes what was won.
 */
const GOLD = 0xffc94a, CYAN = 0x5fd6c8, INK = 0x0d0d18;
/**
 * Two layers (splitStage): the stage art — backdrop, clips, talisman, circle, pillar, cards and portraits, depth
 * below 39 — lives in "stage px", the 800 x 650 W x H box the painted art was measured in, and the world camera
 * frames its STAGE band to the screen height. Words, buttons and the HUD (depth 39 and up) are laid out in screen
 * units (VIEW) against the screen edges, placed next to the art through toScreen / worldX.
 */
const STAGE = { x: 200, y: 60, w: 400, h: 510 };
const CIRCLE = { x: 400, y: 477, rx: 283, ry: 69 }; // the carved circle in gacha/stage.jpg, in stage px
const TALI = { x: 400, y: 215, w: 128, h: 320 };
const CARD = { w: 104, h: 140 };
// painted result frames (scripts/prep_gacha_frames.py): where the pedestal's top sits, as a share of frame height
const FOOT = { cyan: 0.79, gold: 0.81 };
const REVEAL = { y: 240, w: 196 }; // the single-pull troop card
const FACE_W = 84; // ten-pull result cards
const TEX = 3; // generated textures are drawn at 3x and shown at 1/3 so they stay sharp at any RES
const ROLE: Record<Role, string> = ROLE_NAME;
// A generic rune in talisman-relative coords (0..1), one polyline per brush stroke.
const RUNE: [number, number][][] = [
  [[0.3, 0.2], [0.7, 0.2], [0.62, 0.27]],
  [[0.28, 0.35], [0.72, 0.35]],
  [[0.5, 0.24], [0.46, 0.4], [0.57, 0.52], [0.43, 0.66], [0.52, 0.8]],
  [[0.32, 0.45], [0.39, 0.52]],
  [[0.68, 0.45], [0.61, 0.52]],
  [[0.3, 0.86], [0.5, 0.8], [0.72, 0.88], [0.6, 0.94]],
];
const SKIP = Symbol('skip');
/**
 * Pre-rendered clips (canvas board 抽卡 · 问仙召唤, encoded into public/assets/gacha/video) and their frame size.
 * Video carries only what does not depend on who was summoned: the openings per quality, ambient loops and a burst
 * on black (drawn with ADD). The result itself is always placed by code after the cut on a white flash.
 */
const VIDS = {
  open_cyan: [1024, 586], open_gold: [1024, 586], open_rise: [1024, 586], open_ten: [1024, 586],
  idle: [960, 548], loop_gold: [960, 548], loop_cyan: [960, 548], fx_burst: [640, 366],
} as const;
type Vid = keyof typeof VIDS;
const blobs: Partial<Record<Vid, string>> = {}; // object URLs made once from the preloaded bytes, so playback never waits on the network
// two rows of five, each card with its two label lines under it, between the results title and summary
const slot = (i: number) => ({ x: 156 + (i % 5) * 122, y: i < 5 ? 178 : 352 });
const unitOf = (id: string) => FACTIONS.flatMap((f) => f.troops).find((t) => t.id === id)!;
const colorOf = (p: Pull) => (p.kind === 'hero' ? GOLD : CYAN);
// low-motion mode: the system asks for less motion, so no camera shake or white flashes (colour and cards stay)
const CALM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class SummonScene extends Phaser.Scene {
  private save!: Save;
  private rng: () => number = Math.random;
  private phase = 'home';
  private last: Pull[] = [];
  private busy = false;
  private skipped = false;
  private pending = new Set<() => void>();
  private onTap: (() => void) | null = null;
  private home: Phaser.GameObjects.GameObject[] = [];
  private base = new Set<Phaser.GameObjects.GameObject>(); // the stage before any animation; the display list re-sorts by depth, so track objects, not indices
  private started = 0; // when the current pull began, so the press that started it is not taken as a hurry-up tap
  private plate!: Phaser.GameObjects.Image;
  private talisman!: Phaser.GameObjects.Container;
  private rune!: Phaser.GameObjects.Graphics;
  private tap!: Phaser.GameObjects.Zone;
  private skipBtn: Phaser.GameObjects.GameObject[] = [];
  private notice!: Phaser.GameObjects.Text;
  private page = 0;
  private useVideo = false; // false when any clip failed to load or play: the drawn show runs instead
  private bg!: Phaser.GameObjects.Image;
  private idleVid?: Phaser.GameObjects.Video;
  private plateVid?: Phaser.GameObjects.Video;
  private current?: Phaser.GameObjects.Video; // the opening clip now playing, so a tap can hurry it
  private stage!: Stage;

  constructor() { super('summon'); }

  /** Screen position of a stage-px point. */
  private onScreen(x: number, y: number) { return this.stage.toScreen(x, y); }
  /** Stage-px x under a screen x. */
  private worldX(x: number) { return this.stage.view.x + x / this.stage.z; }

  preload() {
    stageCamera(this);
    const t = outline(label(this, VIEW.w / 2, VIEW.h / 2, '问仙台开启中…', 18, TXT.cream), TXT.edge, 4).setOrigin(0.5);
    this.load.on('progress', (v: number) => t.setText(`问仙台开启中… ${Math.round(v * 100)}%`));
    this.load.once('complete', () => t.destroy());
    for (const k of ['stage', 'gold', 'cyan', 'home']) if (!this.textures.exists(`gacha_${k}`)) this.load.image(`gacha_${k}`, `assets/gacha/${k}.jpg`);
    for (const k of ['frame_cyan', 'frame_gold', 'frame_cyan_s', 'frame_gold_s']) if (!this.textures.exists(`gacha_${k}`)) this.load.image(`gacha_${k}`, `assets/gacha/${k}.webp`);
    for (const t2 of FACTIONS.flatMap((f) => f.troops)) if (!this.textures.exists(`por_${t2.id}`)) this.load.image(`por_${t2.id}`, `assets/gacha/portraits/${t2.id}.webp`);
    for (const k of Object.keys(VIDS) as Vid[]) if (!blobs[k] && !this.cache.binary.exists(`gvb_${k}`)) this.load.binary(`gvb_${k}`, `assets/gacha/video/${k}.mp4`);
  }

  create(data?: { again?: 1 | 10 }) {
    stageCamera(this);
    this.stage = splitStage(this, STAGE, (d) => d >= 39);
    view = this.stage.view;
    ensureFx(this);
    makeTextures(this);
    this.save = loadSave();
    if (this.save.settings.calm) calmCamera(this.cameras.main);
    Object.assign(this, { phase: 'home', busy: false, skipped: false, onTap: null, page: 0 });
    this.pending.clear();
    this.speed(1);
    for (const k of Object.keys(VIDS) as Vid[]) {
      if (!blobs[k] && this.cache.binary.exists(`gvb_${k}`)) blobs[k] = URL.createObjectURL(new Blob([this.cache.binary.get(`gvb_${k}`)], { type: 'video/mp4' }));
    }
    this.useVideo = (Object.keys(VIDS) as Vid[]).every((k) => blobs[k]) && this.textures.exists('gacha_home');
    // the home backdrop is the first frame of every opening clip, so the cut into a clip is invisible
    this.bg = cover(this, this.useVideo ? 'gacha_home' : 'gacha_stage', 0);
    this.idleVid = this.useVideo ? this.vid('idle', 0.5, true) : undefined;
    this.plateVid = this.current = undefined;
    this.plate = cover(this, 'gacha_gold', 1).setAlpha(0);
    this.idle();
    this.tap = this.add.zone(0, 0, VIEW.w, VIEW.h).setOrigin(0).setDepth(150);
    this.tap.on('pointerdown', () => {
      if (this.onTap) { const f = this.onTap; this.onTap = null; f(); } else if (this.busy && Date.now() - this.started > 300) this.speed(3); // tap hurries the automatic part
    });
    this.skipBtn = this.makeSkip();
    this.buildHome();
    this.base = new Set(this.children.list);
    this.bridge();
    // leaving the tab mid-show lands on the final frame on return (the result is already saved either way)
    const onHide = () => { if (document.hidden) this.skip(); };
    document.addEventListener('visibilitychange', onHide);
    this.events.once('shutdown', () => document.removeEventListener('visibilitychange', onHide));
    // Phaser keeps the last start data unless new data is given; consume it so a later entry never re-pulls
    const again = data?.again;
    this.sys.settings.data = {};
    if (again) this.time.delayedCall(250, () => this.pull(again));
  }

  // ---------- home ----------

  /** Hanging talisman with its rune layer, a breathing circle and a few motes. */
  private idle() {
    const img = this.add.image(0, 0, 'gacha_talisman').setScale(1 / TEX);
    const glow = this.add.image(0, 0, 'fx_glow').setTint(GOLD).setBlendMode('ADD').setAlpha(0.45).setScale(7, 13);
    this.rune = this.add.graphics();
    this.talisman = this.add.container(TALI.x, TALI.y, [glow, img, this.rune]).setDepth(10);
    this.tweens.add({ targets: this.talisman, y: TALI.y + 5, angle: 1.2, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: glow, alpha: 0.75, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (this.useVideo) { this.talisman.setVisible(false); return; } // the painted talisman and its idle loop are in the video
    const ring = this.add.graphics().setDepth(5).setBlendMode('ADD');
    ring.lineStyle(10, CYAN, 0.18).strokeEllipse(CIRCLE.x, CIRCLE.y, CIRCLE.rx * 2, CIRCLE.ry * 2);
    ring.lineStyle(2, CYAN, 0.5).strokeEllipse(CIRCLE.x, CIRCLE.y, CIRCLE.rx * 2, CIRCLE.ry * 2);
    this.tweens.add({ targets: ring, alpha: 0.35, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    for (let i = 0; i < 7; i++) twinkle(this, 230 + ((i * 131) % 340), 120 + ((i * 71) % 300), 12, 0.3 + (i % 3) * 0.12, i * 420, i % 2 ? GOLD : CYAN);
  }

  private buildHome() {
    const s = this.save, from = this.children.list.length, L = VIEW.l, R = VIEW.r, B = VIEW.h;
    header(this, '问仙召唤', () => this.leave());
    // currency top right, the token bar with its "+" that says where tokens come from
    chip(this, R - 294, 122, 'icon_token', `${s.tokens}`, 32);
    const plus = this.add.image(R - 160, 32, 'hall_plus').setDepth(TOP + 1).setInteractive({ useHandCursor: true });
    plus.setScale(24 / plus.width);
    plus.on('pointerdown', () => this.say('出征远征可获得召唤代币'));
    chip(this, R - 132, 116, 'icon_stone', `${s.stone}`, 32);
    this.heroList();

    // pity, bottom left: a painted strip, the count large, a gold fill in a recessed track, the rates ring
    const py = B - 38;
    nine(this, 'bar', L + 138, py, 252, 62, 16, 40).setDepth(TOP);
    const left = pullsToHero(s);
    outline(label(this, L + 30, py - 14, '再', 14, TXT.cream), TXT.edge, 3).setOrigin(0, 0.5).setDepth(TOP + 1);
    const n = outline(label(this, L + 48, py - 15, `${left}`, 22, TXT.gold), TXT.edge, 4).setOrigin(0, 0.5).setDepth(TOP + 1);
    outline(label(this, L + 52 + n.width, py - 14, '次必得英雄', 14, TXT.cream), TXT.edge, 3).setOrigin(0, 0.5).setDepth(TOP + 1);
    nine(this, 'track', L + 116, py + 12, 180, 14, 6, 30).setDepth(TOP + 1);
    if (s.pity) {
      const fw = Math.max(14, (174 * s.pity) / (PITY - 1));
      nine(this, 'fill', L + 29 + fw / 2, py + 12, fw, 9, 4.5, 24).setDepth(TOP + 1.5);
    }
    const info = this.add.image(L + 238, py, 'hall_ring').setDepth(TOP + 2).setInteractive({ useHandCursor: true });
    info.setScale(36 / info.width);
    this.add.circle(L + 238, py, 12, 0x0c1636, 1).setDepth(TOP + 1.5);
    outline(label(this, L + 238, py - 1, 'i', 17, '#ffffff'), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 2.5);
    info.on('pointerdown', () => this.rates());

    // troop souls, top right under the currency: a round emblem with a ribbon of its star total
    const all = troopPool(), got = all.reduce((a, t) => a + soulProgress(s.souls[t.id] ?? 0).stars, 0);
    const soul = this.add.image(R - 50, 102, 'hall_soul').setDepth(TOP + 1).setInteractive({ useHandCursor: true });
    const sk = 54 / soul.width;
    soul.setScale(sk);
    nine(this, 'ribbon', R - 50, 138, 104, 24, 10, 60).setDepth(TOP + 1);
    outline(label(this, R - 50, 137, `兵魂 ★${got}/${all.length * SOUL_STEPS.length}`, 12, TXT.gold), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 2);
    soul.on('pointerover', () => this.tweens.add({ targets: soul, scale: sk * 1.08, duration: 90 }))
      .on('pointerout', () => this.tweens.add({ targets: soul, scale: sk, duration: 90 }))
      .on('pointerdown', () => this.soulBook());

    // feedback line (errors and hints); the rates live behind the ring
    this.notice = outline(label(this, R - 173, B - 110, '', 13, TXT.cream), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 1);
    // two equal summon buttons, the cost inside each, a corner badge on the ten-pull
    const one = this.summonBtn(R - 254, B - 60, '召唤 ×1', 1, 0x3fd6c0, () => this.pull(1));
    const ten = this.summonBtn(R - 92, B - 60, '召唤 ×10', 10, 0xf6c24a, () => this.pull(10), s.tokens >= 10);
    const badge = this.add.image(R - 26, B - 88, 'hall_badge').setDepth(TOP + 4);
    badge.setScale(40 / badge.height);
    outline(label(this, R - 26, B - 90, '必\n得', 10, '#fff0d0'), '#5a0a0a', 3).setOrigin(0.5).setAlign('center').setLineSpacing(-2).setDepth(TOP + 4.5);
    if (s.tokens < 1) one.r.setAlpha(0.6);
    if (s.tokens < 10) ten.r.setAlpha(0.6);
    this.home = this.children.list.slice(from);
  }

  /** A 152 x 64 summon button: the label on top, the token cost on a dark inset inside the button. */
  private summonBtn(x: number, y: number, t: string, cost: number, fill: number, on: () => void, glow = false) {
    const b = pill(this, x, y, 152, 64, t, fill, on, 20, glow);
    b.tx.setY(y - 12);
    nine(this, 'inset', x, y + 15, 78, 22, 10, 46).setDepth(TOP + 3);
    this.add.image(x - 20, y + 15, 'ui_icon_token').setScale(20 / ICON).setDepth(TOP + 3.5);
    outline(label(this, x - 6, y + 15, `${cost}`, 13, '#ffffff'), TXT.edge, 3).setOrigin(0, 0.5).setDepth(TOP + 3.5);
    return b;
  }

  private say(t: string) {
    this.notice.setText(t).setColor(TXT.cream).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 2200, duration: 400 });
  }

  /**
   * Every hero in the pool, three per page, as banner cards: the hero's bust full-bleed on its civilization colour
   * under the gold frame, an 已拥有 tag and constellation stars when owned, a padlock and 可召唤 when not.
   */
  private heroList() {
    const per = 3, pool = heroPool(), pages = Math.ceil(pool.length / per);
    const objs: Phaser.GameObjects.GameObject[] = [];
    const cw = 160, ch = 84, cx = VIEW.l + 98, pageY = 106 + per * 90 - 22;
    const draw = () => {
      objs.splice(0).forEach((o) => o.destroy());
      pool.slice(this.page * per, this.page * per + per).forEach((u, i) => {
        const h = this.save.heroes[u.id], y = 106 + i * 90;
        const face = this.add.image(cx, y, heroFace(this, u.id, factionOf(u.id).color, !!h, cw, ch)).setScale(1 / 3).setDepth(TOP);
        const frame = nine(this, 'card', cx, y, cw + 6, ch + 6, 14, 70).setDepth(TOP + 0.5);
        const name = outline(label(this, cx - cw / 2 + 10, y - ch / 2 + 15, u.name, 15, TXT.gold), TXT.edge, 3).setOrigin(0, 0.5).setDepth(TOP + 1);
        objs.push(face, frame, name);
        if (h) {
          const t = tag(this, cx - 46, y + ch / 2 - 15, 'tag_jade', '已拥有', 62);
          objs.push(t.p, t.tx, stars(this, cx + 38, y + ch / 2 - 15, h.constellation, MAX_CONSTELLATION, 11, 12));
        } else {
          const t = tag(this, cx - 46, y + ch / 2 - 15, 'tag_gold', '可召唤', 62);
          const lock = this.add.image(cx + 34, y - 4, 'hall_lock').setDepth(TOP + 1);
          objs.push(t.p, t.tx, lock.setScale(30 / lock.width));
        }
      });
      if (pages > 1) objs.push(caption(this, cx, pageY, `${this.page + 1} / ${pages}`, 12, TOP + 1));
    };
    draw();
    if (pages > 1) for (const [x, d] of [[cx - 52, -1], [cx + 52, 1]] as const) {
      const b = this.add.image(x, pageY, 'hall_back').setDepth(TOP + 1).setInteractive({ useHandCursor: true }).setAngle(d < 0 ? 90 : -90);
      b.setScale(26 / b.width);
      b.on('pointerdown', () => { this.page = (this.page + d + pages) % pages; draw(); });
    }
  }

  /** A modal: dim veil, painted panel with a title plate; returns the parts list, torn down on any tap. */
  private modal(cx: number, cy: number, w: number, h: number, title: string) {
    const parts: Phaser.GameObjects.GameObject[] = [];
    const dim = this.add.rectangle(0, 0, VIEW.w, VIEW.h, 0x050814, 0.78).setOrigin(0).setDepth(900).setInteractive();
    const t = titlePlate(this, cx, cy - h / 2 + 4, title, 220, 902);
    const close = () => parts.forEach((o) => o.destroy());
    parts.push(dim, plate(this, cx, cy, w, h).setDepth(901), t.img, t.tx);
    parts.push(...closeX(this, cx + w / 2 - 6, cy - h / 2 + 6, 905, close));
    this.time.delayedCall(150, () => dim.once('pointerdown', close));
    return parts;
  }

  private rates() {
    const cx = VIEW.w / 2, cy = VIEW.h / 2 + 10;
    const parts = this.modal(cx, cy, 470, 300, '概率说明');
    const lines = [
      `英雄 ${HERO_RATE * 100}%：池内 ${heroPool().length} 位英雄等概率`,
      `普通兵种 ${100 - HERO_RATE * 100}%：随机一种兵种的兵魂 ×1`,
      `保底：连续 ${PITY - 1} 次未出英雄，第 ${PITY} 次必出（优先未拥有）`,
      '因此每次十连至少 1 位英雄；含保底综合约 14%',
      '重复英雄：命座 +1，满 6 阶后转化 200 灵石',
      '兵魂升星：1/2/3/4/5 个升 1~5 星，每星生命与伤害 +6%',
    ];
    lines.forEach((t, i) => parts.push(outline(label(this, cx - 204, cy - 104 + i * 32, t, 14, i < 3 ? TXT.cream : TXT.dim), TXT.edge, 3).setDepth(902)));
    parts.push(outline(label(this, cx, cy + 124, '点击任意处关闭', 12, TXT.dim), TXT.edge, 3).setOrigin(0.5).setDepth(902));
  }

  /** Every troop by civilization: stars, souls toward the next star and the bonus it already gives in battle. */
  private soulBook() {
    // one column per troop of a civilization; narrower cards shrink the portrait column
    const cols = Math.max(...FACTIONS.map((f) => f.troops.filter((t) => !t.hero).length));
    const cw = Math.min(176, (VIEW.r - VIEW.l - 80) / cols - 8), ch = 100, pc = cw >= 150 ? 72 : 52;
    const mw = cols * (cw + 8) + 40, mh = 3 * (ch + 8) + 92, cy = VIEW.h / 2 + 6, top = cy - mh / 2;
    const parts = this.modal(VIEW.w / 2, cy, mw, mh, '兵魂 · 升星');
    const g = this.add.graphics().setDepth(901.5);
    parts.push(g);
    FACTIONS.forEach((f, r) => f.troops.filter((t) => !t.hero).forEach((t, c) => {
      const x = VIEW.w / 2 - mw / 2 + 24 + c * (cw + 8), y = top + 36 + r * (ch + 8), owned = this.save.souls[t.id] ?? 0, pr = soulProgress(owned), full = !pr.need;
      // a civilization-tinted face under the gold card frame (glowing once the troop is fully starred)
      g.fillStyle(shade(f.color, 0.28), 1).fillRoundedRect(x, y, cw, ch, 12);
      g.fillStyle(shade(f.color, 0.5), 0.45).fillRoundedRect(x + 3, y + 3, cw - 6, ch * 0.42, { tl: 10, tr: 10, bl: 0, br: 0 });
      parts.push(nine(this, full ? 'card_on' : 'card', x + cw / 2, y + ch / 2, cw + (full ? 18 : 6), ch + (full ? 18 : 6), full ? 18 : 14, 70).setDepth(902));
      const pic = this.add.image(x + pc / 2, y + ch - 6, `por_${t.id}`).setOrigin(0.5, 1).setDepth(902.5);
      pic.setScale(Math.min(80 / pic.height, (pc - 10) / pic.width));
      if (!owned) pic.setTint(0x8890a8);
      const say = (tx: number, ty: number, s: string, size: number, color: string, ox = 0) =>
        parts.push(outline(label(this, tx, ty, s, size, color), TXT.edge, 3).setOrigin(ox, 0.5).setDepth(903));
      const rx = x + pc, rw = cw - pc - 10; // the column right of the portrait
      say(rx, y + 17, t.name, cw >= 150 ? 15 : 13, '#ffffff');
      say(rx, y + 34, cw >= 150 ? `${f.name.split('·')[0]} · ${ROLE[t.role]}` : ROLE[t.role], 11, TXT.cream);
      const ss = Math.min(14, (rw - 2) / SOUL_STEPS.length);
      parts.push(pic, stars(this, rx + rw / 2, y + 52, pr.stars, SOUL_STEPS.length, ss, ss + 1).setDepth(903));
      parts.push(nine(this, 'track', rx + rw / 2, y + 68, rw, 12, 5, 30).setDepth(903));
      if (full || pr.have) {
        const fw = Math.max(12, full ? rw - 4 : ((rw - 4) * pr.have) / pr.need);
        parts.push(nine(this, 'fill', rx + 2 + fw / 2, y + 68, fw, 8, 4, 24).setDepth(903.5));
      }
      say(rx, y + 86, full ? '已满星' : `兵魂 ${pr.have}/${pr.need}`, 12, full ? TXT.gold : TXT.cream);
      say(x + cw - 10, y + 86, pr.stars ? `+${Math.round(pr.stars * STAR_BONUS * 100)}%` : '+0%', 12, pr.stars ? TXT.gold : TXT.dim, 1);
    }));
    const foot = top + mh;
    parts.push(outline(label(this, VIEW.w / 2, foot - 40, `召唤没出英雄时随机得一种兵魂 · 每星该兵种生命与伤害 +${STAR_BONUS * 100}% · 满星后兵魂转化 ${FULL_SOUL_STONE} 灵石`, 12, TXT.cream), TXT.edge, 3).setOrigin(0.5).setDepth(902));
    parts.push(outline(label(this, VIEW.w / 2, foot - 20, '点击任意处关闭', 12, TXT.dim), TXT.edge, 3).setOrigin(0.5).setDepth(902));
  }

  private leave() { writeSave(this.save); this.scene.start('base'); }
  /** Back to the empty stage. */
  private toStage() { this.scene.restart({}); }

  // ---------- pulling ----------

  private pull(count: 1 | 10) {
    if (this.busy) return;
    const r = summon(this.save, count, this.rng);
    if (typeof r === 'string') {
      this.tweens.killTweensOf(this.notice);
      this.notice.setText(r).setColor(TXT.red).setAlpha(1);
      const nx = VIEW.r - 173;
      this.tweens.add({ targets: this.notice, x: { from: nx - 8, to: nx }, duration: 60, yoyo: true, repeat: 2 });
      return;
    }
    writeSave(this.save); // the result is kept before anything is shown
    this.last = r;
    this.busy = true;
    this.started = Date.now();
    this.home.forEach((o) => { (o as unknown as Phaser.GameObjects.Components.Visible).setVisible?.(false); if (o.input) o.input.enabled = false; });
    this.tap.setInteractive();
    this.skipBtn.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true));
    this.skipBtn[0].input!.enabled = true;
    void this.play(r);
  }

  private async play(pulls: Pull[]) {
    const single = pulls.length === 1;
    try {
      if (single) await this.single(pulls[0]);
      else await this.ten(pulls);
    } catch (e) {
      if (e !== SKIP) throw e;
      this.clearLayer();
      this.skipped = false;
      this.showSkip(false);
      if (!single) { this.results(pulls, true); return; }
      try { await this.reveal(pulls[0], true); await this.tapped(); } catch (e2) { if (e2 !== SKIP) throw e2; }
    }
    if (single) this.toStage();
  }

  private async single(p: Pull) {
    this.phase = 'single';
    const hero = p.kind === 'hero', rise = hero && p.upgrade, col = colorOf(p);
    if (this.useVideo) {
      const v = await this.clip(hero ? (rise ? 'open_rise' : 'open_gold') : 'open_cyan');
      if (v) {
        // cut on a white flash: the clip ends in light, the shared reveal starts in light
        this.flash(hero ? 420 : 280, 255, 250, 236);
        this.showPlate(hero, true);
        v.destroy();
        this.dropIdle();
        if (hero) this.fx(CIRCLE.x, 300);
        await this.reveal(p);
        await this.tapped();
        return;
      }
      this.toDrawn();
    }
    await this.tween({ targets: this.talisman, scale: 1.06, duration: 110, yoyo: true });
    await this.writeRune(RUNE.map((_, i) => (hero && (!rise || i === RUNE.length - 1) ? GOLD : CYAN)), 1000);
    if (rise) { this.flash(160, 255, 220, 120); burst(this, TALI.x, TALI.y + 120, 12, 20); await this.wait(220); }
    this.gather(col);
    await this.tween({ targets: this.talisman, x: CIRCLE.x, y: CIRCLE.y - 24, scale: 0.12, alpha: 0, duration: 650, ease: 'Cubic.easeIn' });
    await this.rings(hero ? 3 : 1, rise ? CYAN : col, rise);
    await this.pillar(hero);
    await this.reveal(p);
    await this.tapped();
  }

  private async ten(pulls: Pull[]) {
    this.phase = 'ten';
    // the clip shows the split and the slips leaving for the sky without any colour; the meteors that come back
    // down carry each pull's colour and land in its slot, so that part is always drawn
    let fromSky = false;
    if (this.useVideo) {
      const v = await this.clip('open_ten');
      if (v) {
        fromSky = true;
        this.bg.setTexture('gacha_stage');
        this.dropIdle();
        this.tweens.add({ targets: v, alpha: 0, duration: 350, onComplete: () => v.destroy() });
      } else this.toDrawn();
    }
    if (!fromSky) {
      await this.tween({ targets: this.talisman, scale: 1.06, duration: 110, yoyo: true });
      await this.writeRune(RUNE.map(() => CYAN), 650); // a ten-pull never shows gold before the split
      this.tweens.add({ targets: this.talisman, alpha: 0, scale: 0.8, duration: 260 });
    }

    // ten slips; each slip's glow already tells its colour
    const minis = pulls.map((p, i) => {
      const a = Phaser.Math.DegToRad(-50 + (i * 100) / 9);
      const col = p.kind === 'hero' && !p.upgrade ? GOLD : CYAN;
      const glow = this.add.image(0, 0, 'fx_glow').setBlendMode('ADD').setTint(col).setScale(3, 4.6).setAlpha(0.9);
      const trail = this.add.image(0, -70, 'fx_glow').setBlendMode('ADD').setTint(col).setScale(1.2, 6).setAlpha(0);
      const paper = this.add.image(0, 0, 'gacha_talisman').setScale(0.3 / TEX);
      const rim = this.add.graphics();
      const paint = (c: number) => rim.clear().lineStyle(9, c, 0.45).strokeRoundedRect(-22, -51, 44, 102, 7).lineStyle(3, c, 1).strokeRoundedRect(-20, -49, 40, 98, 5);
      paint(col);
      const c = this.add.container(TALI.x, TALI.y, [trail, glow, paper, rim]).setDepth(20).setAlpha(0);
      if (!fromSky) this.tweens.add({ targets: c, x: 400 + Math.sin(a) * 330, y: 330 - Math.cos(a) * 170, rotation: a * 0.5, alpha: 1, duration: 420, delay: i * 30, ease: 'Back.easeOut' });
      return { c, glow, trail, paint };
    });
    if (!fromSky) {
      // the drawn version: fanned in the air, then up into the sky
      await this.wait(420 + 9 * 30 + 260);
      minis.forEach((m, i) => this.tweens.add({ targets: m.c, y: -140, duration: 260, delay: i * 45, ease: 'Cubic.easeIn' }));
      await this.wait(260 + 9 * 45 + 160);
    }

    // down onto the table as meteors
    const backs: Phaser.GameObjects.Container[] = [];
    minis.forEach((m, i) => {
      const p = pulls[i], to = slot(i), late = p.kind === 'hero' && p.upgrade;
      m.c.setPosition(to.x + 70, -120).setRotation(0.35).setAlpha(1);
      m.trail.setAlpha(0.85);
      this.tweens.add({
        targets: m.c, x: to.x, y: to.y, rotation: 0, duration: 380, delay: i * 70, ease: 'Quad.easeIn',
        onUpdate: (tw) => {
          if (late && tw.progress > 0.5 && m.glow.tintTopLeft !== GOLD) { m.glow.setTint(GOLD); m.trail.setTint(GOLD); m.paint(GOLD); burst(this, m.c.x, m.c.y, 22, 10); }
        },
        onComplete: () => { m.c.destroy(); backs[i] = this.cardBack(to.x, to.y, colorOf(p)); burst(this, to.x, to.y, 22, 6, [colorOf(p), 0xffffff]); },
      });
    });
    await this.wait(9 * 70 + 380 + 220);

    // common cards flip left to right; hero cards wait for the end
    const faces: Phaser.GameObjects.Container[] = [];
    for (let i = 0; i < 10; i++) {
      if (pulls[i].kind !== 'troop') continue;
      await this.tween({ targets: backs[i], scaleX: 0, duration: 75, ease: 'Sine.easeIn' });
      backs[i].destroy();
      faces[i] = this.faceCard(pulls[i], slot(i).x, slot(i).y).setScale(0, 1);
      await this.tween({ targets: faces[i], scaleX: 1, duration: 85, ease: 'Sine.easeOut' });
    }
    for (let i = 0; i < 10; i++) {
      if (pulls[i].kind !== 'hero') continue;
      const others = pulls.map((_, j) => (j === i ? undefined : faces[j] ?? backs[j])).filter((c): c is Phaser.GameObjects.Container => !!c?.active);
      faces[i] = await this.heroCard(pulls[i], backs[i], slot(i), others);
    }
    this.results(pulls, false);
  }

  /** A gold card leaves its slot, plays the shared hero reveal over the cleared stage, then returns face up. */
  private async heroCard(p: Pull, back: Phaser.GameObjects.Container, at: { x: number; y: number }, others: Phaser.GameObjects.Container[]) {
    back.setDepth(26);
    this.showPlate(true);
    this.tweens.add({ targets: others, alpha: 0, duration: 300 });
    await this.tween({ targets: back, x: 400, y: 300, scale: 2.2, duration: 380, ease: 'Cubic.easeOut' });
    this.shake(240, 0.006);
    burst(this, 400, 300, 27, 24);
    this.fx(400, 300);
    await this.tween({ targets: back, alpha: 0, scale: 2.7, duration: 200 });
    back.destroy();
    const before = new Set(this.children.list);
    await this.reveal(p);
    await this.tapped();
    this.added(before).forEach((o) => { this.tweens.killTweensOf(o); o.destroy(); });
    this.hidePlate();
    await this.tween({ targets: others, alpha: 1, duration: 260 });
    const face = this.faceCard(p, at.x, at.y).setScale(0);
    burst(this, at.x, at.y, 22, 14);
    await this.tween({ targets: face, scale: 1, duration: 260, ease: 'Back.easeOut' });
    return face;
  }

  private results(pulls: Pull[], instant: boolean) {
    this.phase = 'results';
    this.busy = false;
    this.speed(1);
    this.showSkip(false);
    this.tap.disableInteractive();
    if (instant) pulls.forEach((p, i) => this.faceCard(p, slot(i).x, slot(i).y));
    const cx = VIEW.w / 2, B = VIEW.h;
    hudText(this, cx, 26, '召唤结果', 26, TXT.gold).setOrigin(0.5).setDepth(40);
    caption(this, cx + 170, 28, '点击卡片查看角色信息', 12, 40); // beside the title, clear of the top row of cards
    // each card opens its unit's details; the hit box sits in the HUD layer over the card and its two label lines
    const fr = this.textures.get('gacha_frame_gold_s').getSourceImage(), fh = (FACE_W * fr.height) / fr.width, z = this.stage.z;
    pulls.forEach((p, i) => {
      const at = this.onScreen(slot(i).x, slot(i).y + 18);
      this.add.rectangle(at.x, at.y, (FACE_W + 24) * z, (fh + 56) * z, 0, 0).setDepth(41)
        .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.details(p));
    });
    const heroes = pulls.filter((p) => p.kind === 'hero');
    const sum = [
      heroes.filter((p) => p.kind === 'hero' && p.fresh).length ? `新英雄 ×${heroes.filter((p) => p.kind === 'hero' && p.fresh).length}` : '',
      heroes.filter((p) => p.kind === 'hero' && !p.fresh && !p.stone).length ? `命座 +${heroes.filter((p) => p.kind === 'hero' && !p.fresh && !p.stone).length}` : '',
      `兵魂 ×${pulls.filter((p) => p.kind === 'troop' && !p.stone).length}`,
      pulls.some((p) => p.kind === 'troop' && p.starUp) ? `升星 ×${pulls.filter((p) => p.kind === 'troop' && p.starUp).length}` : '',
      pulls.some((p) => p.stone) ? `灵石 +${pulls.reduce((a, p) => a + p.stone, 0)}` : '',
    ].filter(Boolean).join(' · ');
    outline(label(this, cx, B - 78, `本次：${sum}`, 15, TXT.cream), TXT.edge, 4).setOrigin(0.5).setDepth(40);
    pill(this, cx - 110, B - 36, 150, 46, '返回', 0x888888, () => this.toStage(), 18);
    const again = pill(this, cx + 90, B - 36, 190, 46, '再来十连', 0xf6c24a, () => this.scene.restart({ again: 10 }), 18, this.save.tokens >= 10);
    if (this.save.tokens < 10) again.r.setAlpha(0.6);
    caption(this, cx + 280, B - 36, `消耗 10 代币 · 现有 ${this.save.tokens}`, 11, TOP + 2);
  }

  /**
   * A result card's unit on a popup: bust, civilization and role, its battle stats with this save's growth (命座,
   * 兵魂 stars, civilization trait), then the hero's skill and 命座 or the troop's soul stars.
   */
  private details(p: Pull) {
    const u = unitOf(p.id), f = factionOf(p.id), b = boosted(this.save, u), hero = p.kind === 'hero';
    const pw = Math.min(460, VIEW.r - VIEW.l - 24), ph = 300, cx = VIEW.w / 2, cy = VIEW.h / 2 + 10, top = cy - ph / 2;
    const parts = this.modal(cx, cy, pw, ph, hero ? '英雄信息' : '兵种信息');
    const L = cx - pw / 2 + 24, x0 = L + 150, x1 = cx + pw / 2 - 26;
    parts.push(this.add.image(L + 62, cy + 4, heroFace(this, u.id, f.color, true, 124, 180, 1.45)).setScale(1 / 3).setDepth(902));
    parts.push(nine(this, 'card', L + 62, cy + 4, 128, 184, 12, 70).setDepth(902.5));
    const say = (x: number, y: number, t: string, size: number, color: string, ox = 0) => {
      const tx = outline(label(this, x, y, t, size, color), TXT.edge, 3).setOrigin(ox, 0.5).setDepth(904);
      parts.push(tx);
      return tx;
    };
    parts.push(hudText(this, x0, top + 44, u.name, 22, TXT.gold).setOrigin(0, 0.5).setDepth(904));
    const ft = tag(this, x0 + 44, top + 72, 'tag_gold', f.name, 88, 20, 11), rt = tag(this, x0 + 126, top + 72, 'tag_blue', hero ? '英雄' : ROLE[u.role], 56, 20, 11);
    parts.push(ft.p.setDepth(904), ft.tx.setDepth(904.5), rt.p.setDepth(904), rt.tx.setDepth(904.5));
    const rows: [string, string][] = [['生命', `${b.hp}`], ['攻击', `${b.dmg}`], ['射程', `${u.range} 格`], ['移速', `${u.speed}`], ['攻击间隔', `${u.interval} 秒`]];
    rows.forEach(([k, v], i) => {
      const y = top + 100 + i * 21;
      say(x0, y, k, 13, TXT.cyan);
      say(x1, y, v, 14, '#ffffff', 1);
    });
    const y = top + 100 + rows.length * 21 + 6, h = this.save.heroes[u.id];
    if (hero && u.skill) {
      say(x0, y, `技能 · ${SKILLS[u.skill].name}`, 14, TXT.gold);
      parts.push(outline(label(this, x0, y + 12, SKILLS[u.skill].desc, 12, TXT.cream), TXT.edge, 3).setOrigin(0, 0).setDepth(904).setWordWrapWidth(x1 - x0));
      say(x0, top + ph - 26, '命座', 13, TXT.cyan);
      parts.push(pips(this, x0 + 46, top + ph - 26, h?.constellation ?? 0, MAX_CONSTELLATION).setDepth(904));
    } else {
      const pr = soulProgress(this.save.souls[u.id] ?? 0);
      say(x0, y + 2, '兵魂', 13, TXT.cyan);
      parts.push(stars(this, x0 + 84, y + 2, pr.stars, SOUL_STEPS.length, 16, 18).setDepth(904));
      say(x0, y + 26, pr.need ? `兵魂 ${pr.have}/${pr.need} · 生命与攻击 +${Math.round(pr.stars * STAR_BONUS * 100)}%` : `已满星 · 生命与攻击 +${Math.round(pr.stars * STAR_BONUS * 100)}%`, 12, TXT.cream);
      say(x0, y + 48, u.flying ? '飞行：越过符墙' : u.targetsDefense ? '优先攻击灵塔' : `${ROLE[u.role]}兵种`, 12, TXT.dim);
    }
    say(cx, top + ph + 16, '点击任意处关闭', 12, TXT.dim, 0.5);
  }

  // ---------- shared pieces of the show ----------

  private async writeRune(colors: number[], ms: number) {
    const pts = RUNE.map((s) => s.map(([x, y]) => new Phaser.Math.Vector2((x - 0.5) * TALI.w, (y - 0.5) * TALI.h)));
    const lens = pts.map((s) => s.slice(1).reduce((a, p, i) => a + p.distance(s[i]), 0));
    const total = lens.reduce((a, b) => a + b, 0);
    const draw = (t: number) => {
      const g = this.rune.clear();
      let left = t * total;
      pts.forEach((s, k) => {
        if (left <= 0) return;
        const path: Phaser.Math.Vector2[] = [s[0]];
        for (let i = 1; i < s.length && left > 0; i++) {
          const d = s[i].distance(s[i - 1]), f = Math.min(1, left / d);
          path.push(s[i - 1].clone().lerp(s[i], f));
          left -= d;
        }
        // halo, dark ink edge (reads on the yellow paper), colour, bright core; gold strokes run a deeper orange-gold
        const c = colors[k] === GOLD ? 0xff9a14 : colors[k];
        for (const [w, col, a] of [[16, c, 0.35], [9, 0x3a1606, 0.85], [5.5, c, 1], [1.6, 0xffffff, 0.9]] as const) g.lineStyle(w, col, a).strokePoints(path, false);
      });
    };
    await this.hold((done) => this.tweens.addCounter({ from: 0, to: 1, duration: ms, ease: 'Sine.easeInOut', onUpdate: (tw) => draw(tw.getValue() ?? 1), onComplete: done }));
    draw(1);
  }

  /** Motes of light rushing from all around into the circle. */
  private gather(col: number) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 160;
      const m = this.add.image(CIRCLE.x + Math.cos(a) * r, CIRCLE.y - 120 + Math.sin(a) * r * 0.6, i % 3 ? 'fx_glow' : 'fx_spark')
        .setTint(col).setBlendMode('ADD').setScale(0.4 + Math.random() * 0.5).setDepth(12).setAlpha(0);
      this.tweens.add({ targets: m, x: CIRCLE.x, y: CIRCLE.y - 10, alpha: { from: 1, to: 0.2 }, duration: 520 + Math.random() * 300, delay: i * 18, ease: 'Cubic.easeIn', onComplete: () => m.destroy() });
    }
  }

  /** Light the circle ring by ring; `rise` lights one cyan ring and then breaks it open into three gold ones. */
  private async rings(n: number, col: number, rise: boolean) {
    const g = this.add.graphics().setDepth(5).setBlendMode('ADD');
    const ring = (k: number, c: number) => {
      const f = [1, 0.7, 0.42][k];
      g.lineStyle(16, c, 0.25).strokeEllipse(CIRCLE.x, CIRCLE.y, CIRCLE.rx * 2 * f, CIRCLE.ry * 2 * f);
      g.lineStyle(4, c, 1).strokeEllipse(CIRCLE.x, CIRCLE.y, CIRCLE.rx * 2 * f, CIRCLE.ry * 2 * f);
    };
    for (let k = 0; k < (rise ? 1 : n); k++) { ring(k, col); await this.wait(140); }
    if (rise) {
      await this.wait(160);
      g.clear();
      this.flash(140, 255, 230, 140);
      for (let k = 0; k < 3; k++) { ring(k, GOLD); await this.wait(110); }
    }
  }

  private async pillar(hero: boolean) {
    const col = hero ? GOLD : CYAN, w = hero ? 200 : 110, h = hero ? 520 : 290;
    const p = this.add.image(CIRCLE.x, CIRCLE.y + 12, 'gacha_pillar').setOrigin(0.5, 1).setBlendMode('ADD').setTint(col).setDepth(6);
    const sx = w / p.width, sy = h / p.height;
    p.setScale(sx * 0.3, 0);
    if (hero) this.shake(300, 0.008);
    burst(this, CIRCLE.x, CIRCLE.y - 20, 12, hero ? 26 : 10, [col, 0xffffff]);
    await this.tween({ targets: p, scaleX: sx, scaleY: sy, duration: 280, ease: 'Cubic.easeOut' });
    this.showPlate(hero);
    await this.tween({ targets: p, alpha: 0.4, duration: 320 });
  }

  /** Silhouette, flash, portrait and words for any pull; `instant` lands straight on the final frame. */
  private async reveal(p: Pull, instant = false) {
    const hero = p.kind === 'hero', col = colorOf(p), u = unitOf(p.id), f = factionOf(p.id);
    this.phase = 'reveal';
    if (instant) this.showPlate(hero, true);
    // the hero stands right of centre on screen (the words take the left), a troop on its card in the middle
    let cx = this.worldX(VIEW.w * 0.62), bottom = 522, cardBottom = 0;
    let card: Phaser.GameObjects.Image | undefined;
    if (!hero) {
      // troops stand on the pedestal of the painted jade card
      card = this.add.image(400, REVEAL.y, 'gacha_frame_cyan').setDepth(28);
      const s = REVEAL.w / card.width, h = card.height * s;
      const glow = this.add.image(400, REVEAL.y, 'fx_glow').setTint(CYAN).setBlendMode('ADD').setDepth(27.5).setScale(REVEAL.w / 14, h / 14).setAlpha(0);
      this.tweens.add({ targets: glow, alpha: { from: 0, to: 0.55 }, duration: instant ? 1 : 400 });
      this.tweens.add({ targets: glow, alpha: 0.3, delay: 400, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      card.setScale(s);
      if (!instant) card.setAlpha(0).setScale(s * 0.86);
      cx = 400;
      bottom = REVEAL.y - h / 2 + h * FOOT.cyan;
      cardBottom = REVEAL.y + h / 2;
    }
    const pic = this.add.image(cx, bottom, `por_${p.id}`).setOrigin(0.5, 1).setDepth(30);
    const rk = REVEAL.w / 210; // the troop portrait was tuned on a 210-wide card
    const k = hero ? Math.min(370 / pic.height, 420 / pic.width) : Math.min((196 * rk) / pic.height, (168 * rk) / pic.width);
    // the silhouette's rim light: the same portrait filled with the quality colour, a touch larger, centred on it
    const halo = this.add.image(cx, bottom - (pic.height * k) / 2, `por_${p.id}`).setDepth(29).setScale(k * 1.06).setBlendMode('ADD')
      .setTint(col).setTintMode(Phaser.TintModes.FILL).setAlpha(0);
    pic.setScale(k);
    if (hero) {
      const rays = this.add.image(cx, bottom - 200, 'fx_rays').setTint(GOLD).setBlendMode('ADD').setDepth(27).setScale(3.4).setAlpha(0);
      this.tweens.add({ targets: rays, alpha: 0.55, duration: instant ? 1 : 600 });
      this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
    }
    if (!instant) {
      pic.setTint(INK).setTintMode(Phaser.TintModes.FILL).setAlpha(0).setScale(k * 0.9);
      if (card) this.tweens.add({ targets: card, alpha: 1, scale: REVEAL.w / card.width, duration: 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: halo, alpha: 0.8, duration: 380 });
      await this.tween({ targets: pic, alpha: 1, scale: k, duration: 380, ease: 'Cubic.easeOut' });
      await this.wait(hero ? 420 : 160);
      this.flash(hero ? 220 : 130, 255, 252, 236);
      pic.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      burst(this, cx, bottom - (hero ? 200 : 90), 31, hero ? 30 : 14, [col, 0xffffff]);
    }
    this.tweens.add({ targets: halo, alpha: 0, duration: instant ? 1 : 500 });

    const words: Phaser.GameObjects.GameObject[] = [];
    const say = (x: number, y: number, t: string, size: number, color: string, ox = 0) =>
      words.push(outline(label(this, x, y, t, size, color), TXT.edge, Math.max(3, size / 6)).setOrigin(ox, 0.5).setDepth(40));
    if (p.kind === 'hero') {
      // a column of words down the left of the screen, centred in the height when there is room to spare
      const x = VIEW.l + 40, y = 40 + Math.max(0, (VIEW.h - 450) / 2);
      const tag = p.fresh ? '新英雄' : p.stone ? '命座已满' : '命座提升';
      const g = this.add.graphics().setDepth(39);
      g.fillStyle(0xc42828, 1).fillRoundedRect(x, y, 96, 32, 9).lineStyle(2, 0xffe0a0, 0.9).strokeRoundedRect(x, y, 96, 32, 9);
      words.push(g);
      say(x + 48, y + 16, tag, 17, '#fff0d0', 0.5);
      words.push(hudText(this, x, y + 78, u.name, 54, TXT.gold).setOrigin(0, 0.5).setDepth(40).setShadow(0, 3, '#c07010', 10, true, true));
      say(x + 2, y + 132, f.name, 18, TXT.cream);
      if (u.skill) {
        say(x + 2, y + 168, `技能 · ${SKILLS[u.skill].name}`, 17, TXT.cyan);
        words.push(outline(label(this, x + 2, y + 190, SKILLS[u.skill].desc, 12, TXT.dim), TXT.edge, 3).setOrigin(0, 0).setDepth(40).setWordWrapWidth(250));
      }
      if (!p.fresh) { say(x + 2, y + 256, '命座', 14, TXT.cyan); words.push(pips(this, x + 52, y + 256, p.constellation, 6).setDepth(40)); }
      if (p.stone) say(x + 2, y + 288, `已满 6 阶，转化灵石 +${p.stone}`, 14, TXT.gold);
      // field the hero straight from the reveal; it sits above the tap zone, so pressing it does not continue
      const on = () => this.save.squad[0] === p.id, bx = x + 72, by = y + 340;
      const b = pill(this, bx, by, 150, 44, on() ? '已上阵' : '上阵', 0x70509a, () => {
        if (on()) return;
        this.save.squad[0] = p.id;
        writeSave(this.save);
        b.tx.setText('已上阵');
        burst(this, bx, by, TOP + 5, 14);
      }, 17);
    } else {
      // name, civilization, stars and the soul line stacked under the card
      const at = this.onScreen(400, cardBottom), x = at.x, y = at.y;
      words.push(hudText(this, x, y + 16, u.name, 26).setOrigin(0.5).setDepth(40));
      const tag = this.add.graphics().setDepth(39);
      tag.fillStyle(0x08262c, 0.88).fillRoundedRect(x - 88, y + 31, 176, 24, 12).lineStyle(1.5, CYAN, 0.85).strokeRoundedRect(x - 88, y + 31, 176, 24, 12);
      words.push(tag);
      say(x, y + 43, `${f.name} · ${ROLE[u.role]}`, 13, TXT.cyan, 0.5);
      words.push(stars(this, x, y + 74, p.stars, SOUL_STEPS.length, 24, 30).setDepth(40));
      const line = p.stone ? `兵魂已满，转化灵石 +${p.stone}` : p.starUp ? `兵魂 +1 · 升至 ★${p.stars}` : `兵魂 +1 · 距 ★${p.stars + 1} 还需 ${soulsToNext(p.souls)}`;
      say(x, y + 104, line, 15, p.starUp ? TXT.gold : TXT.cream, 0.5);
    }
    const tip = outline(label(this, VIEW.w / 2, VIEW.h - 14, '点击任意处继续', 13, TXT.dim), TXT.edge, 3).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: tip, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    if (!instant) words.forEach((o, i) => {
      const t = o as unknown as Phaser.GameObjects.Components.Alpha;
      t.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, x: { from: (o as unknown as { x: number }).x - 16, to: (o as unknown as { x: number }).x }, delay: 80 + i * 60, duration: 260 });
    });
  }

  private cardBack(x: number, y: number, col: number) {
    const glow = this.add.image(0, 0, 'fx_glow').setTint(col).setBlendMode('ADD').setScale(4.2, 5.4).setAlpha(col === GOLD ? 1 : 0.7);
    const img = this.add.image(0, 0, 'gacha_cardback').setScale(1 / TEX);
    const rim = this.add.graphics().lineStyle(10, col, 0.45).strokeRoundedRect(-CARD.w / 2 - 3, -CARD.h / 2 - 3, CARD.w + 6, CARD.h + 6, 14)
      .lineStyle(4, col, 1).strokeRoundedRect(-CARD.w / 2, -CARD.h / 2, CARD.w, CARD.h, 11);
    const c = this.add.container(x, y, [glow, img, rim]).setDepth(20).setScale(0.4);
    this.tweens.add({ targets: c, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: glow, alpha: col === GOLD ? 0.6 : 0.4, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return c;
  }

  /** One result card: the same frame for every unit, gold for heroes and cyan for troops. */
  private faceCard(p: Pull, x: number, y: number) {
    const hero = p.kind === 'hero', u = unitOf(p.id);
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (hero) parts.push(this.add.image(0, 0, 'fx_rays').setTint(GOLD).setBlendMode('ADD').setScale(0.7).setAlpha(0.6));
    const fr = this.add.image(0, 0, hero ? 'gacha_frame_gold_s' : 'gacha_frame_cyan_s');
    fr.setScale(FACE_W / fr.width);
    const h = fr.displayHeight;
    parts.push(this.add.ellipse(0, h / 2 - 2, FACE_W * 0.9, 14, 0x000000, 0.35), fr);
    const pic = this.add.image(0, -h / 2 + h * (hero ? FOOT.gold : FOOT.cyan), `por_${p.id}`).setOrigin(0.5, 1);
    pic.setScale(Math.min((h * 0.6) / pic.height, (FACE_W * 0.8) / pic.width));
    parts.push(pic);
    const line = p.kind === 'hero'
      ? (p.fresh ? '新英雄' : p.stone ? `灵石 +${p.stone}` : `命座 ${p.constellation}`)
      : (p.stone ? `灵石 +${p.stone}` : p.starUp ? `升至 ★${p.stars}` : `兵魂 +1 ★${p.stars}`);
    // a touch larger than the HUD type: the stage layer is drawn smaller than screen units on a phone
    parts.push(outline(label(this, 0, h / 2 + 12, u.name, 15, '#ffffff'), TXT.edge, 3).setOrigin(0.5));
    parts.push(outline(label(this, 0, h / 2 + 30, line, 13, hero || (p.kind === 'troop' && p.starUp) ? TXT.gold : TXT.cyan), TXT.edge, 3).setOrigin(0.5));
    if (p.kind === 'hero' && p.fresh) {
      parts.push(this.add.circle(FACE_W / 2 - 6, -h / 2 + 10, 14, 0xc42828).setStrokeStyle(2, 0xffe0a0));
      parts.push(outline(label(this, FACE_W / 2 - 6, -h / 2 + 9, '新', 14, '#fff0d0'), '#600', 3).setOrigin(0.5));
    }
    return this.add.container(x, y, parts).setDepth(20);
  }

  private makeSkip() {
    const g = this.add.graphics().setDepth(700);
    const R = VIEW.r;
    g.fillStyle(0x0a0f1e, 0.7).fillRoundedRect(R - 104, 14, 90, 34, 17).lineStyle(1.5, 0xffffff, 0.5).strokeRoundedRect(R - 104, 14, 90, 34, 17);
    const t = outline(label(this, R - 59, 31, '跳过 ›', 15, '#ffffff'), TXT.edge, 3).setOrigin(0.5).setDepth(701);
    const hit = this.add.rectangle(R - 59, 31, 110, 56, 0, 0).setDepth(702).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.skip());
    const all = [hit, g, t];
    all.forEach((o) => o.setVisible(false));
    hit.input!.enabled = false;
    return all;
  }

  private showSkip(on: boolean) {
    this.skipBtn.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(on));
    this.skipBtn[0].input!.enabled = on;
  }

  /** Remove everything the animation added and return the stage to its empty state. */
  private clearLayer() {
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.added(this.base).forEach((o) => o.destroy());
    this.plateVid = this.current = undefined;
    this.dropIdle();
    this.bg.setTexture('gacha_stage');
    this.talisman.setVisible(false);
    this.rune.clear();
    this.plate.setAlpha(0);
  }

  // ---------- video layers ----------

  /** A clip from the preloaded bytes, scaled to cover the stage (or by `scale`), playing at once. */
  private vid(k: Vid, depth: number, loop: boolean, scale?: number) {
    const [w, h] = VIDS[k];
    const v = this.add.video(W / 2, H / 2).setDepth(depth);
    v.loadURL(blobs[k]!, true);
    v.setScale(scale ?? coverScale(w, h));
    v.play(loop);
    return v;
  }

  /** Play an opening clip to its end. Resolves with it still on screen, or null if it would not play. */
  private async clip(k: Vid) {
    const v = this.vid(k, 14, false);
    this.current = v;
    let ok = true;
    await this.hold((done) => {
      v.once(Phaser.GameObjects.Events.VIDEO_COMPLETE, done);
      v.once(Phaser.GameObjects.Events.VIDEO_ERROR, () => { ok = false; done(); });
      // blocked or stalled playback must never hang a summon: fall back to the drawn show
      this.time.delayedCall(2500, () => { if (v.active && !(v.video && v.video.currentTime > 0)) { ok = false; done(); } });
      this.time.delayedCall(10000, done);
    });
    this.current = undefined;
    if (ok) return v;
    v.destroy();
    return null;
  }

  /** Reveal backdrop: the still plate at once, its living loop on top as soon as it has a frame. */
  private showPlate(hero: boolean, instant = false) {
    this.plate.setTexture(hero ? 'gacha_gold' : 'gacha_cyan');
    if (instant) this.plate.setAlpha(1);
    else this.tweens.add({ targets: this.plate, alpha: 1, duration: 320 });
    if (!this.useVideo) return;
    this.plateVid?.destroy();
    this.plateVid = this.vid(hero ? 'loop_gold' : 'loop_cyan', 1.1, true);
  }

  private hidePlate() {
    this.tweens.add({ targets: this.plate, alpha: 0, duration: 260 });
    const v = this.plateVid;
    this.plateVid = undefined;
    if (v) this.tweens.add({ targets: v, alpha: 0, duration: 260, onComplete: () => v.destroy() });
  }

  /** Gold burst on black, added over the backdrop so only its light shows; it sits behind the portrait so the hero stays readable. */
  private fx(x: number, y: number) {
    if (!this.useVideo) return;
    const v = this.vid('fx_burst', 28.5, false, 1.5).setPosition(x, y).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
    v.once(Phaser.GameObjects.Events.VIDEO_COMPLETE, () => v.destroy());
  }

  private dropIdle() { this.idleVid?.destroy(); this.idleVid = undefined; }

  private flash(ms: number, r: number, g: number, b: number) { if (!CALM) this.cameras.main.flash(ms, r, g, b); }
  private shake(ms: number, k: number) { if (!CALM) this.cameras.main.shake(ms, k); }

  /** A clip would not play: switch this scene to the drawn show (bare stage plus the code talisman). */
  private toDrawn() {
    this.useVideo = false;
    this.dropIdle();
    this.bg.setTexture('gacha_stage');
    this.talisman.setVisible(true).setAlpha(1).setScale(1).setPosition(TALI.x, TALI.y);
  }

  /** Objects on the display list that were not in `before`. */
  private added(before: Set<Phaser.GameObjects.GameObject>) { return this.children.list.filter((o) => !before.has(o)); }

  // ---------- timing: every await can be cut short by 跳过 ----------

  private hold(start: (done: () => void) => void): Promise<void> {
    if (this.skipped) return Promise.reject(SKIP);
    return new Promise<void>((res, rej) => {
      const done = () => { this.pending.delete(done); if (this.skipped) rej(SKIP); else res(); };
      this.pending.add(done);
      start(done);
    });
  }
  private wait(ms: number) { return this.hold((d) => { this.time.delayedCall(ms, d); }); }
  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig) { return this.hold((d) => { this.tweens.add({ ...cfg, onComplete: d }); }); }
  /** Wait for the player; the automatic part runs at normal speed again. */
  private tapped() { this.speed(1); return this.hold((d) => { this.onTap = d; }); }
  private speed(k: number) { this.tweens.timeScale = k; this.time.timeScale = k; this.current?.setPlaybackRate(k > 1 ? 2.5 : 1); }
  private skip() {
    if (this.skipped || !this.busy) return;
    this.skipped = true;
    this.onTap = null;
    this.tweens.killAll();
    this.time.removeAllEvents();
    [...this.pending].forEach((f) => f());
  }

  private bridge() {
    if (new URLSearchParams(location.search).get('ohmygamePlaytest') !== '1') return;
    const target = globalThis as typeof globalThis & { __OHMYGAME_PLAYTEST__?: unknown };
    target.__OHMYGAME_PLAYTEST__ = {
      snapshot: () => ({
        scene: 'summon', phase: this.phase, video: this.useVideo, tokens: this.save.tokens, pity: this.save.pity, heroes: this.save.heroes, souls: this.save.souls,
        last: this.last.map((p) => ({ kind: p.kind, id: p.id, upgrade: p.kind === 'hero' && p.upgrade })),
      }),
      setSeed: (seed: number) => { this.rng = mulberry32(seed); },
      // test-only: a starting save with tokens for both buttons
      reset: () => { const s = defaultSave(Date.now()); chooseCivilization(s, 0); s.tokens = 30; writeSave(s); this.toStage(); },
    };
    this.events.once('shutdown', () => { delete target.__OHMYGAME_PLAYTEST__; });
  }
}

let view = { x: 0, y: 0, w: W, h: H }; // the stage-px rect the world camera shows, set on create

/**
 * Scale for w x h art centred on the stage as it was painted (filling the stage height, 16:9 cropped at the sides),
 * grown only if the camera shows more than that, so the art still covers the screen and the circle stays put.
 */
function coverScale(w: number, h: number) {
  const hw = Math.max(W / 2 - view.x, view.x + view.w - W / 2), hh = Math.max(H / 2 - view.y, view.y + view.h - H / 2);
  return Math.max(H / h, W / w, (2 * hw) / w, (2 * hh) / h);
}

function cover(s: Phaser.Scene, key: string, depth: number) {
  const img = s.add.image(W / 2, H / 2, key).setDepth(depth);
  return img.setScale(coverScale(img.width, img.height));
}

/** Talisman, card back and light pillar, drawn once into canvas textures. */
function makeTextures(s: Phaser.Scene) {
  if (s.textures.exists('gacha_talisman')) return;
  const paper = (key: string, w: number, h: number, seal: string) => {
    const t = s.textures.createCanvas(key, w * TEX, h * TEX)!, c = t.getContext();
    c.scale(TEX, TEX);
    const r = Math.min(w, h) * 0.08;
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#fbe6a0'); bg.addColorStop(1, '#efc35a');
    c.fillStyle = bg;
    c.beginPath(); c.roundRect(0, 0, w, h, r); c.fill();
    c.globalAlpha = 0.12; c.strokeStyle = '#a0782a'; c.lineWidth = 0.6;
    for (let i = 0; i < w * 0.9; i++) { const x = (i * 37) % w, y = (i * 53) % h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 4, y + 1); c.stroke(); }
    c.globalAlpha = 1;
    c.strokeStyle = '#b8362a'; c.lineWidth = Math.max(1.5, w * 0.02);
    c.beginPath(); c.roundRect(w * 0.07, w * 0.07, w * 0.86, h - w * 0.14, r * 0.6); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.roundRect(w * 0.11, w * 0.11, w * 0.78, h - w * 0.22, r * 0.4); c.stroke();
    const sz = w * 0.26;
    c.fillStyle = '#c0392b'; c.fillRect(w / 2 - sz / 2, h * 0.055, sz, sz);
    c.fillStyle = '#fbe6a0'; c.font = `bold ${sz * 0.72}px "PingFang SC","Microsoft YaHei",serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(seal, w / 2, h * 0.055 + sz / 2 + 1);
    t.refresh();
  };
  paper('gacha_talisman', TALI.w, TALI.h, '敕');
  paper('gacha_cardback', CARD.w, CARD.h, '令');
  // the card back carries one fixed rune so all ten look the same until flipped
  const back = s.textures.get('gacha_cardback') as Phaser.Textures.CanvasTexture, c = back.getContext();
  c.save(); c.scale(TEX, TEX); c.strokeStyle = '#b8362a'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(52, 52); c.lineTo(44, 78); c.lineTo(62, 92); c.lineTo(46, 120); c.stroke();
  c.beginPath(); c.moveTo(34, 66); c.lineTo(70, 62); c.stroke();
  c.restore(); back.refresh();

  const pt = s.textures.createCanvas('gacha_pillar', 64, 256)!, pc = pt.getContext();
  const hz = pc.createLinearGradient(0, 0, 64, 0);
  hz.addColorStop(0, 'rgba(255,255,255,0)'); hz.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  hz.addColorStop(0.5, 'rgba(255,255,255,1)'); hz.addColorStop(0.65, 'rgba(255,255,255,0.55)'); hz.addColorStop(1, 'rgba(255,255,255,0)');
  pc.fillStyle = hz; pc.fillRect(0, 0, 64, 256);
  pc.globalCompositeOperation = 'destination-in';
  const vt = pc.createLinearGradient(0, 0, 0, 256);
  vt.addColorStop(0, 'rgba(0,0,0,0)'); vt.addColorStop(0.4, 'rgba(0,0,0,0.8)'); vt.addColorStop(1, 'rgba(0,0,0,1)');
  pc.fillStyle = vt; pc.fillRect(0, 0, 64, 256);
  pt.refresh();
}
