import Phaser from 'phaser';
import { loadSave, writeSave, type Save } from '../core/economy';
import { cashOut, chooseNode, MIN_SUPPLIES, NODE_INFO, pickRelic, RELICS, resolveRuin, routeAt, runEnergy, startRun, type NodeKind, type RelicId, type Run } from '../core/expedition';
import { caption, ICON, intro, PAL, shade, splitStage, stageCamera, TXT, VIEW } from './common';
import { backdrop, cardFx, chip, header, iconBtn, pedestal, pill, pips, plate, rewardIcon, text, TOP } from './gameUi';

const NODE_ICON: Record<NodeKind, string> = { outpost: 'icon_tower', elite: 'icon_sword', camp: 'icon_wall', ruin: 'icon_mine', boss: 'flag' };
const RELIC_ICON: Record<RelicId, string> = { fury: 'icon_sword', sky: 'speed', range: 'skill', guard: 'icon_wall', siege: 'icon_tower', plunder: 'icon_stone' };
const DEFAULT_NOTE = '安全撤离带走全部；失败只保留封存与半数灵石，代币需成功撤离';
const ISLAND = { x: -60, y: 10, w: 920, h: 550 }; // the base island the world camera frames behind the veil
const TRAY = 96; // bottom dock: run stats, or the main action

/**
 * Screen bands for the phone-landscape layout, measured when the scene starts: the body sits between the header and
 * the bottom tray (BT..BB, centre BM), centred on CX across a usable width SPAN inside the safe area.
 */
const L = { CX: 0, SPAN: 0, TY: 0, BT: 62, BB: 0, BM: 0 };
function layout() {
  L.CX = (VIEW.l + VIEW.r) / 2;
  L.SPAN = VIEW.r - VIEW.l;
  L.TY = VIEW.h - TRAY - 4;
  L.BB = L.TY - 6;
  L.BM = (L.BT + L.BB) / 2;
}

export class ExpeditionScene extends Phaser.Scene {
  private save!: Save;
  private note = '';
  private lastKey = ''; // view the entrance animation last played for; re-renders of the same view stay still
  private view = { x: 0, y: 0, w: 0, h: 0 };
  constructor() { super('expedition'); }
  create() {
    stageCamera(this);
    layout();
    this.view = splitStage(this, ISLAND, (d) => d >= 400).view;
    this.save = loadSave(); this.note = ''; this.lastKey = ''; this.render();
  }
  private commit() { writeSave(this.save); this.render(); }

  /** "常规攻城 · 灵石 90 · 补给 +25" -> a row of small colored pills, wrapping at `right`; plain text when there is one part. */
  private tags(x: number, y: number, desc: string, right: number) {
    const parts = desc.split(' · ');
    if (parts.length === 1) { text(this, x, y, desc, 13, TXT.body).setOrigin(0, 0.5); return; }
    const g = this.add.graphics().setDepth(TOP + 0.5);
    let cx = x, cy = y;
    for (const t of parts) {
      const tone = /见底/.test(t) ? 0xb03a2e : /灵石|代币/.test(t) ? 0xc9962e : /补给|战备/.test(t) ? 0x2f8a5a : 0x3a4470;
      const tx = text(this, 0, 0, t, 13, TXT.cream).setOrigin(0, 0.5);
      const pw = tx.width + 14;
      if (cx + pw > right && cx > x) { cx = x; cy += 26; }
      g.fillStyle(0x000000, 0.3).fillRoundedRect(cx, cy - 9, pw, 22, 11);
      g.fillStyle(tone, 0.95).fillRoundedRect(cx, cy - 11, pw, 22, 11);
      g.fillStyle(0xffffff, 0.14).fillRoundedRect(cx + 4, cy - 9, pw - 8, 7, 4);
      tx.setPosition(cx + 7, cy);
      cx += pw + 5;
    }
  }

  private wrap(x: number, y: number, t: string, size: number, width: number, color: string = TXT.cream) {
    return text(this, x, y, t, size, color).setWordWrapWidth(width, true).setLineSpacing(4);
  }

  /** Dark disc with a gold ring: a seat for an icon. */
  private seat(x: number, y: number, r: number) {
    const g = this.add.graphics().setDepth(TOP + 0.9);
    g.fillStyle(0x000000, 0.3).fillCircle(x, y + 3, r);
    g.fillStyle(0x0b1127, 0.7).fillCircle(x, y, r);
    g.lineStyle(2, PAL.gold, 0.7).strokeCircle(x, y, r);
    g.lineStyle(1, 0xffffff, 0.14).strokeCircle(x, y, r - 4);
  }

  /** Relic icons in a row from x: a seat each with its stack count on a gold badge. */
  private relicRow(r: Run, x: number, y: number, size: number, gap: number) {
    (Object.keys(r.relics) as RelicId[]).forEach((id, i) => {
      const rx = x + i * gap, b = size * 0.46;
      this.seat(rx, y, size * 0.62);
      this.add.image(rx, y, `ui_${RELIC_ICON[id]}`).setDepth(TOP + 1).setScale(size / ICON);
      this.add.circle(rx + b, y + b * 0.9, 7.5, 0x0b1127, 1).setStrokeStyle(1.5, PAL.gold, 1).setDepth(TOP + 1.5);
      text(this, rx + b, y + b * 0.9, `${r.relics[id]}`, 11, TXT.gold).setOrigin(0.5).setDepth(TOP + 1.6);
    });
  }

  private render() {
    this.tweens.killAll();
    this.children.removeAll(true);
    backdrop(this, this.save.mapSkin, this.view, TRAY);
    header(this, '万国远征', () => { writeSave(this.save); this.scene.start('base'); });
    const base = this.children.list.length;
    this.body();
    const r = this.save.run;
    const key = r ? `${r.phase}|${r.stage}|${r.node ?? ''}` : 'none';
    if (key !== this.lastKey) { this.lastKey = key; intro(this, base); }
  }

  private body() {
    const r = this.save.run;
    if (!r || r.phase === 'finished') { this.landing(r); return; }
    if (r.phase === 'battle') { this.interrupted(r); return; }
    this.stats(r);
    if (r.phase === 'relic') this.relics(r);
    else if (r.node === 'ruin') this.ruin(r);
    else this.route(r);
  }

  /** Bottom tray while a run is active: supplies, loot, relics and the retreat button. */
  private stats(r: Run) {
    const x = VIEW.l + 22, y = L.TY + 22;
    chip(this, x, 150, 'speed', `补给 ${r.supplies}`, y);
    chip(this, x + 172, 160, 'icon_wall', `战备 ${r.readiness}%`, y);
    chip(this, x + 354, 170, 'icon_stone', `随身 ${r.carried}`, y);
    chip(this, x + 546, 110, 'icon_token', `${r.tokens}`, y);
    const st = text(this, x + 6, y + 27, `第 ${Math.min(5, r.stage + 1)} / 5 层 · 已封存 ${r.secured} · 胜场 ${r.victories}`, 14, TXT.gold).setOrigin(0, 0.5);
    const rx = st.x + st.width + 22;
    text(this, rx, y + 27, '遗物', 14, TXT.cyan).setOrigin(0, 0.5);
    if (!Object.keys(r.relics).length) text(this, rx + 38, y + 27, '暂无，攻克据点后选择', 13, TXT.dim).setOrigin(0, 0.5);
    this.relicRow(r, rx + 52, y + 27, 22, 36);
    this.wrap(x + 6, y + 54, this.note || DEFAULT_NOTE, 13, L.SPAN - 190, this.note ? TXT.gold : TXT.dim).setOrigin(0, 0.5);
    iconBtn(this, VIEW.r - 62, L.TY + 38, 'flag', 54, '安全撤离', () => { cashOut(this.save, true); this.commit(); });
  }

  private landing(r: Run | null) {
    const { CX, BT, BB, BM } = L;
    if (r) this.summary(r);
    else {
      plate(this, CX, BM, Math.min(640, L.SPAN - 40), BB - BT);
      text(this, CX, BM - 112, '在未知边境，选择你的征途', 26, TXT.gold, '#2a1608').setOrigin(0.5).setShadow(0, 2, '#ffb030', 6, true, true);
      ([['五层分岔路线', 'icon_tower'], ['战后遗物三选一', 'skill'], ['跨关补给与战损', 'speed']] as const).forEach(([t, k], i) => {
        const x = CX + (i - 1) * 190;
        pedestal(this, x, BM - 18, 80);
        this.add.image(x, BM - 46, `ui_${k}`).setDepth(TOP + 1).setScale(56 / ICON);
        caption(this, x, BM + 10, t, 14, TOP + 1);
      });
      this.wrap(CX, BM + 36, '营地恢复，遗迹封存，精英城寨收获更丰；挑战首领，或在路线界面提前撤离。', 14, 540, TXT.body).setOrigin(0.5, 0).setAlign('center');
      this.wrap(CX, BM + 86, '携带当前编队与养成属性 · 无体力门票，不需要看广告即可完成', 13, 540, TXT.dim).setOrigin(0.5, 0).setAlign('center');
    }
    pill(this, CX, L.TY + 38, 320, 62, r ? '再次远征' : '开始远征', 0xf6c24a, () => { startRun(this.save); this.commit(); }, 26, true);
    text(this, CX, VIEW.h - 20, '当前未接入广告平台；玩家战争仅为 AI 模拟领地，不涉及真人资源', 12, TXT.dim).setOrigin(0.5);
  }

  /** Mini route of the finished run: ✓ for cleared stages, ✗ where it fell, ? for stages never reached. */
  private track(r: Run, cx: number, y: number, gap: number, fell: boolean, cleared: boolean) {
    const g = this.add.graphics().setDepth(TOP + 0.9), x0 = cx - gap * 2, R = 20;
    g.lineStyle(4, 0x000000, 0.3).lineBetween(x0, y + 3, x0 + gap * 4, y + 3);
    for (let st = 0; st < 4; st++) {
      const walked = st < r.stage || (cleared && st < 4);
      g.lineStyle(4, walked ? PAL.gold : 0x4a5278, walked ? 1 : 0.8).lineBetween(x0 + st * gap + R, y, x0 + (st + 1) * gap - R, y);
    }
    for (let st = 0; st < 5; st++) {
      const x = x0 + st * gap, chosen = r.path[st];
      const kind = chosen !== undefined ? routeAt(r, st)[chosen] : undefined;
      const won = kind !== undefined && (st < r.stage || cleared);
      const lost = kind !== undefined && !won && fell;
      g.fillStyle(0x000000, 0.35).fillCircle(x, y + 3, R);
      g.fillStyle(won ? PAL.goldHi : lost ? 0xc05040 : 0x4a5278, 1).fillCircle(x, y, R);
      g.fillStyle(kind ? shade(NODE_INFO[kind].color, won ? 0.9 : 0.5) : 0x161d3c, 1).fillCircle(x, y, R - 3);
      if (kind) this.add.image(x, y, `ui_${NODE_ICON[kind]}`).setDepth(TOP + 1).setScale(26 / ICON).setAlpha(won ? 1 : 0.6);
      else text(this, x, y, '?', 16, '#6b7398').setOrigin(0.5);
      if (won || lost) {
        g.fillStyle(won ? 0x2f9e4f : 0xb03a2e, 1).fillCircle(x + 14, y - 14, 8).lineStyle(2, 0xffffff, 1).strokeCircle(x + 14, y - 14, 8);
        text(this, x + 14, y - 14, won ? '✓' : '✗', 11, '#ffffff').setOrigin(0.5).setDepth(TOP + 1.5);
      }
      text(this, x, y + 31, kind ? NODE_INFO[kind].name : `第 ${st + 1} 层`, 12, won ? TXT.gold : TXT.dim).setOrigin(0.5);
    }
  }

  /** Icon rows for phrases such as "灵石 +170"; long phrases shrink to fit. Tight steps use the smaller type. */
  private rows(x: number, y: number, w: number, lines: string[], color: string = TXT.cream, step = 32, lead: string = TXT.gold) {
    const small = step < 28, size = small ? 14 : 16, icon = small ? 22 : 26;
    lines.forEach((t, i) => {
      const ry = y + i * step;
      this.add.image(x + 16, ry, rewardIcon(t)).setDepth(TOP + 1).setScale(icon / ICON);
      const tx = text(this, x + 36, ry, t, size, i === 0 ? lead : color).setOrigin(0, 0.5);
      if (tx.width > w - 44) tx.setScale((w - 44) / tx.width);
      if (i < lines.length - 1) this.add.rectangle(x + w / 2, ry + step / 2, w - 16, 1, PAL.gold, 0.16).setDepth(TOP + 1);
    });
  }

  /**
   * Finished run, in two columns of one card: on the left the outcome, the route walked and the relics carried; on
   * the right the rewards and the stock they landed in.
   */
  private summary(r: Run) {
    const { CX, BT, BB, BM } = L;
    const cleared = r.result.startsWith('远征大捷'), fell = r.result.startsWith('远征受挫');
    const [title, ...rest] = r.result.split('\n').flatMap((l) => l.split(' · ')).map((t) => t.trim()).filter(Boolean);
    const PW = Math.min(880, L.SPAN - 40), colW = PW / 2 - 40, LX = CX - PW / 4 + 8, RX = CX + PW / 4 - 8;
    plate(this, CX, BM, PW, BB - BT, cleared);
    if (!fell) {
      const rays = this.add.image(LX, BT + 40, 'fx_rays').setDepth(TOP - 0.5).setBlendMode('ADD').setTint(PAL.goldHi).setScale(1.4).setAlpha(0.45);
      this.tweens.add({ targets: rays, angle: 360, duration: 18000, repeat: -1 });
    }
    this.add.rectangle(CX, BM, 1, BB - BT - 56, PAL.gold, 0.22).setDepth(TOP + 1);
    // left: outcome, route, relics
    text(this, LX, BT + 40, title ?? '战役结算', 28, fell ? '#e8e2ff' : TXT.gold, '#2a1608').setOrigin(0.5).setShadow(0, 2, fell ? '#000000' : '#ffb030', 6, true, true);
    text(this, LX, BT + 72, `攻克 ${r.victories} 座据点 · 遗物随本次远征结束清除`, 13, TXT.dim).setOrigin(0.5);
    this.track(r, LX, BT + 128, Math.min(80, (colW - 44) / 4), fell, cleared);
    const lx = LX - colW / 2, ry = BT + 206;
    text(this, lx, ry, '遗物', 14, TXT.cyan).setOrigin(0, 0.5);
    if (!Object.keys(r.relics).length) text(this, lx + 42, ry, '本次未取得遗物', 13, TXT.dim).setOrigin(0, 0.5);
    this.relicRow(r, lx + 60, ry, 24, 42);
    text(this, lx, ry + 36, `补给 ${r.supplies}  ·  战备 ${r.readiness}%`, 14, fell ? TXT.dim : TXT.cream).setOrigin(0, 0.5);
    // right: rewards, then stock
    const bx = RX - colW / 2, bh = rest.length * 32 + 12, top = BT + 26;
    const box = this.add.graphics().setDepth(TOP + 0.5);
    box.fillStyle(0x070b18, 0.45).fillRoundedRect(bx, top, colW, bh, 10);
    this.rows(bx + 8, top + 22, colW - 16, rest, fell ? TXT.dim : TXT.cream);
    const iy = top + bh + 30;
    text(this, bx, iy, '库存', 14, TXT.cyan).setOrigin(0, 0.5);
    chip(this, bx + 48, 120, 'icon_stone', `${this.save.stone}`, iy);
    chip(this, bx + 180, 100, 'icon_token', `${this.save.tokens}`, iy);
  }

  private dashed(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number) {
    const n = Math.max(2, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 9));
    g.lineStyle(3, color, alpha);
    for (let i = 0; i < n; i += 2) {
      const a = i / n, b = (i + 1) / n;
      g.lineBetween(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
    }
  }

  /** The five-stage map across the top of the body, and the next choices as cards under it. */
  private route(r: Run) {
    const { CX, BT, BB } = L;
    const g = this.add.graphics().setDepth(TOP);
    const gap = Math.min(170, (L.SPAN - 140) / 4), x0 = CX - gap * 2, R = 26;
    const ysOf = (n: number) => (n === 1 ? [BT + 92] : [BT + 56, BT + 128]);
    // lanes first so the nodes sit on top: solid gold where the player walked, dashed ahead
    for (let st = 0; st < 4; st++) {
      const x = x0 + st * gap, ys = ysOf(routeAt(r, st).length), next = ysOf(routeAt(r, st + 1).length);
      ys.forEach((y, a) => next.forEach((ny, b) => {
        const taken = st < r.stage && r.path[st] === a && (st + 1 >= r.stage || r.path[st + 1] === b);
        if (taken) {
          g.lineStyle(8, 0x000000, 0.3).lineBetween(x + R, y + 2, x + gap - R, ny + 2);
          g.lineStyle(4, PAL.gold, 1).lineBetween(x + R, y, x + gap - R, ny);
        } else this.dashed(g, x + R, y, x + gap - R, ny, st >= r.stage ? 0xe2d092 : 0x7a82a6, st >= r.stage ? 0.75 : 0.35);
      }));
    }
    for (let st = 0; st < 5; st++) {
      const nodes = routeAt(r, st), x = x0 + st * gap, ys = ysOf(nodes.length);
      if (st === r.stage) caption(this, x, BT + 12, '当前', 12, TOP + 1, TXT.gold);
      else text(this, x, BT + 12, `${st + 1}`, 13, TXT.dim).setOrigin(0.5);
      nodes.forEach((kind, lane) => {
        const info = NODE_INFO[kind], y = ys[lane], done = st < r.stage, taken = done && r.path[st] === lane, cur = st === r.stage;
        const a = cur ? 1 : done ? (taken ? 0.95 : 0.5) : 0.72;
        if (cur) {
          const gl = this.add.image(x, y, 'fx_glow').setTint(PAL.gold).setBlendMode('ADD').setDepth(TOP + 0.5).setScale(2.7).setAlpha(0.5);
          this.tweens.add({ targets: gl, alpha: 0.95, scale: 3.2, duration: 850, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
        g.fillStyle(0x000000, 0.35).fillCircle(x, y + 3, R);
        g.fillStyle(cur ? PAL.goldHi : 0x9a8a5c, a).fillCircle(x, y, R + 0.5);
        g.fillStyle(done ? 0x1b2340 : shade(info.color, 0.55), a).fillCircle(x, y, R - 2.5);
        g.fillStyle(done ? 0x2c3860 : info.color, a).fillCircle(x, y - 1, R - 5.5);
        g.fillStyle(0xffffff, cur ? 0.3 : 0.16).fillEllipse(x, y - 10.5, 26, 11);
        const ic = this.add.image(x, y, `ui_${NODE_ICON[kind]}`).setDepth(TOP + 1).setScale(32 / ICON);
        if (done) ic.setAlpha(taken ? 0.95 : 0.35);
        if (taken) {
          g.fillStyle(0x2f9e4f, 1).fillCircle(x + 18, y - 18, 8.5).lineStyle(2, 0xffffff, 1).strokeCircle(x + 18, y - 18, 8.5);
          text(this, x + 18, y - 18, '✓', 12, '#ffffff').setOrigin(0.5).setDepth(TOP + 1.5);
        }
        text(this, x, y + 36, info.name, 12, cur ? TXT.gold : TXT.dim).setOrigin(0.5);
      });
    }
    const opts = routeAt(r), cy = BB - 50, ch = 100;
    opts.forEach((kind, lane, all) => {
      const info = NODE_INFO[kind], single = all.length === 1;
      const w = single ? Math.min(560, L.SPAN - 60) : Math.min(400, (L.SPAN - 60) / 2);
      const x = single ? CX : CX + (lane ? 1 : -1) * (w / 2 + 10);
      plate(this, x, cy, w, ch);
      this.seat(x - w / 2 + 46, cy, 32);
      this.add.image(x - w / 2 + 46, cy, `ui_${NODE_ICON[kind]}`).setDepth(TOP + 1).setScale(48 / ICON);
      text(this, x - w / 2 + 90, cy - 22, `前往 ${info.name}`, 20, TXT.gold).setOrigin(0, 0.5);
      const lean = kind === 'boss' && r.supplies < MIN_SUPPLIES ? ` · 补给见底 灵气 ${runEnergy(r)}` : '';
      this.tags(x - w / 2 + 90, cy + 10, info.desc + lean, x + w / 2 - 40);
      text(this, x + w / 2 - 20, cy, '›', 32, TXT.gold).setOrigin(0.5);
      const hit = this.add.rectangle(x, cy, w, ch, 0, 0).setDepth(TOP + 3).setInteractive({ useHandCursor: true });
      cardFx(this, hit, x, cy, w, ch);
      hit.on('pointerdown', () => {
        if (!chooseNode(r, lane)) { this.note = '补给不足 40，建议安全撤离，带回已有战利品。'; this.render(); return; }
        writeSave(this.save);
        if (r.phase === 'battle') this.scene.start('battle', { mode: 'attack', expedition: true });
        else this.render();
      });
    });
  }

  private relics(r: Run) {
    const { CX, BT, BB } = L;
    text(this, CX, BT + 18, '战后奇遇 · 选择一件遗物', 24, TXT.gold, '#2a1608').setOrigin(0.5).setShadow(0, 2, '#ffb030', 6, true, true);
    const gap = Math.min(260, (L.SPAN - 30) / 3), cw = Math.min(228, gap - 16), ch = BB - BT - 44, cy = BT + 44 + ch / 2;
    r.offers.forEach((id, i) => {
      const x = CX + (i - 1) * gap, info = RELICS[id], lv = r.relics[id] ?? 0;
      plate(this, x, cy, cw, ch);
      pedestal(this, x, cy - 44, 96);
      const ic = this.add.image(x, cy - 72, `ui_${RELIC_ICON[id]}`).setDepth(TOP + 1).setScale(60 / ICON);
      this.tweens.add({ targets: ic, y: ic.y - 4, delay: 700 + i * 120, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      text(this, x, cy - 14, info.name, 20, TXT.gold).setOrigin(0.5);
      this.wrap(x, cy + 4, info.desc, 13, cw - 40, TXT.body).setOrigin(0.5, 0).setAlign('center');
      text(this, x - 30, cy + 60, lv ? '升至' : '层数', 13, TXT.cyan).setOrigin(1, 0.5);
      pips(this, x - 14, cy + 60, lv + 1, 2);
      if (lv) caption(this, x + 54, cy + 60, `${lv}→${lv + 1}`, 12, TOP + 1, TXT.cyan, 40);
      const take = () => { pickRelic(r, id); this.commit(); };
      const hit = this.add.rectangle(x, cy - 24, cw, ch - 60, 0, 0).setDepth(TOP + 3).setInteractive({ useHandCursor: true });
      cardFx(this, hit, x, cy, cw, ch);
      hit.on('pointerdown', take);
      pill(this, x, cy + ch / 2 - 26, 164, 34, '收下遗物', 0xb04030, take, 15);
    });
  }

  private ruin(r: Run) {
    const { CX, BT, BB } = L;
    text(this, CX, BT + 16, '遗迹中的抉择', 24, TXT.gold, '#2a1608').setOrigin(0.5).setShadow(0, 2, '#ffb030', 6, true, true);
    text(this, CX, BT + 44, '古老商道尽头，封存石匣与危险藏宝室同时出现', 14, TXT.body).setOrigin(0.5);
    // previews mirror resolveRuin(): sealing moves carried loot to secured; the vault adds 180 for 20 readiness (floor 35)
    const risk = Math.max(35, r.readiness - 20), dx = Math.min(190, L.SPAN / 4), ch = BB - BT - 64, cy = BT + 64 + ch / 2;
    ([
      [CX - dx, 'icon_wall', '封存战利品', '随身灵石转为失败也能保留的财富', [`封存 ${r.secured} → ${r.secured + r.carried}`, `随身 ${r.carried} → 0`], '封存', 0x3a7a4a, true, '稳妥', 0x2f9e4f],
      [CX + dx, 'icon_mine', '深入藏宝室', '搜刮更多宝藏，但队伍会疲惫', [`随身 ${r.carried} → ${r.carried + 180}`, `战备 ${r.readiness}% → ${risk}%`], '冒险', 0xb04030, false, '高风险', 0xb03a2e],
    ] as const).forEach(([x, ic, title, desc, delta, btn, fill, safe, tag, tagC]) => {
      plate(this, x, cy, 340, ch);
      pedestal(this, x, cy - 52, 90);
      this.add.image(x, cy - 76, `ui_${ic}`).setDepth(TOP + 1).setScale(54 / ICON);
      const g = this.add.graphics().setDepth(TOP + 1);
      g.fillStyle(tagC, 1).fillRoundedRect(x + 96, cy - 98, 62, 24, 12).lineStyle(1.5, 0xffffff, 0.6).strokeRoundedRect(x + 96, cy - 98, 62, 24, 12);
      text(this, x + 127, cy - 86, tag, 13, '#ffffff').setOrigin(0.5);
      text(this, x, cy - 26, title, 20, TXT.gold).setOrigin(0.5);
      text(this, x, cy - 3, desc, 13, TXT.dim).setOrigin(0.5);
      delta.forEach((t, i) => {
        const y = cy + 22 + i * 24;
        this.add.image(x - 96, y, rewardIcon(t.startsWith('战备') ? '战备' : '灵石')).setDepth(TOP + 1).setScale(22 / ICON);
        text(this, x - 80, y, t, 15, i === 1 && !safe ? TXT.red : TXT.cream).setOrigin(0, 0.5);
      });
      pill(this, x, cy + ch / 2 - 28, 200, 38, btn, fill, () => { resolveRuin(r, safe); this.commit(); }, 17);
    });
  }

  private interrupted(r: Run) {
    const { CX, BT, BB, BM } = L;
    const node = r.node ?? 'outpost', info = NODE_INFO[node];
    plate(this, CX, BM, Math.min(640, L.SPAN - 40), BB - BT);
    pedestal(this, CX, BT + 58, 84, 0xff7a5a);
    this.seat(CX, BT + 38, 28);
    this.add.image(CX, BT + 38, `ui_${NODE_ICON[node]}`).setDepth(TOP + 1).setScale(44 / ICON);
    text(this, CX, BT + 86, r.engaged ? '战斗已中断' : '战斗尚未开始', 26, TXT.gold, '#2a1608').setOrigin(0.5).setShadow(0, 2, '#ffb030', 6, true, true);
    text(this, CX, BT + 114, `第 ${r.stage + 1} / 5 层 · ${info.name} · 战备 ${r.readiness}% · 封存 ${r.secured} · 随身 ${r.carried}`, 13, TXT.dim).setOrigin(0.5);
    const top = BT + 140;
    if (!r.engaged) {
      const [lead, ...gain] = info.desc.split(' · ');
      const g = this.add.graphics().setDepth(TOP + 0.5), h = 30 + gain.length * 24;
      g.fillStyle(0x070b18, 0.5).fillRoundedRect(CX - 200, top, 400, h, 12);
      g.lineStyle(2, PAL.gold, 0.7).strokeRoundedRect(CX - 200, top, 400, h, 12);
      g.fillStyle(PAL.goldDeep, 1).fillRoundedRect(CX - 60, top - 10, 120, 22, 11);
      text(this, CX, top + 1, '胜利可得', 13, '#ffffff').setOrigin(0.5);
      this.rows(CX - 188, top + 28, 376, gain, TXT.cream, 24);
      text(this, CX, top + h + 16, `${lead} · 进入后战斗才开始计时`, 13, TXT.dim).setOrigin(0.5);
    } else {
      // preview of cashOut(…, false): sealed loot and half the carried loot stay, the rest of the run is lost
      const keep = r.secured + Math.floor(r.carried / 2), lose = r.carried - Math.floor(r.carried / 2);
      const relics = Object.values(r.relics).reduce((a, b) => a + (b ?? 0), 0);
      const kept = [`灵石 +${keep}`, '英雄与装备无损'];
      const lost = [`随身灵石 -${lose}`, ...(r.tokens ? [`代币 ${r.tokens} 枚`] : []), ...(relics ? [`遗物 ${relics} 层`] : [])];
      ([[CX - 150, '保底可得', 0x2f9e4f, kept, TXT.cream], [CX + 150, '将会失去', 0xb03a2e, lost, TXT.red]] as const).forEach(([x, cap, col, lines, color]) => {
        const g = this.add.graphics().setDepth(TOP + 0.5), h = 30 + Math.max(kept.length, lost.length) * 24;
        g.fillStyle(0x070b18, 0.5).fillRoundedRect(x - 136, top, 272, h, 12);
        g.lineStyle(2, col, 0.85).strokeRoundedRect(x - 136, top, 272, h, 12);
        g.fillStyle(col, 1).fillRoundedRect(x - 54, top - 10, 108, 22, 11);
        text(this, x, top + 1, cap, 13, '#ffffff').setOrigin(0.5);
        this.rows(x - 124, top + 28, 248, [...lines], color, 24, color === TXT.red ? TXT.red : TXT.gold);
      });
    }
    pill(this, CX, L.TY + 34, 360, 56, r.engaged ? '领取保底 · 结束远征' : '继续进入战斗', r.engaged ? 0xb04030 : 0xf6c24a, () => {
      if (r.engaged) { cashOut(this.save, false); this.commit(); }
      else this.scene.start('battle', { mode: 'attack', expedition: true });
    }, 22, true);
    caption(this, CX, VIEW.h - 22, '⚠ 退出或刷新会结束本次战斗，不能重复刷取节点奖励', 12, TOP + 1, '#ffb4a0');
  }
}
