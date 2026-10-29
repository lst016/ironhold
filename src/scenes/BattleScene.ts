import Phaser from 'phaser';
import { BUILDINGS, FACTIONS, SKILLS, type TroopDef } from '../data/factions';
import { FACTION_SKIN } from '../data/maps';
import { castSkill, deploy, destructionOf, generateEnemyBase, generateWave, GRID, heroAlive, lootOf, newBattle, step, TIME_LIMIT, type Battle } from '../core/sim';
import { applyRaid, armyOf, boosted, coreLevel, expeditionReward, loadSave, writeSave, type Save } from '../core/economy';
import { armyList, muster, refund, troopById } from '../core/army';
import { finishEncounter, NODE_INFO, runArmy, runEnergy, runLayout } from '../core/expedition';
import { button, burst, calmCamera, hudText, ICON, MAP_BOUNDS, mapCamera, type MapCamera, splitStage, stageCamera, tileFace, RES, confetti, countTo, drawGround, drawScenery, dropShadow, ensureFx, factionOf, growHit, type Fx, H, inGrid, label, mix, outline, PAL, proj, squashFx, state, strokeRegion, strokeRing, TXT, unproj, VIEW, W, type Stage } from './common';
import { plate, rewardIcon } from './gameUi';
import { createBuildingView, createUnitView, destroyBuildingView, destroyUnitView, facingOf, paintOverlay, paintUnit, setFacing, unitHitHeight, type BuildingView, type UnitView } from './sprites';

/** Last-frame snapshot of a sim entity; hits, attacks and deaths are read off the differences. */
type Track = { hp: number; cd: number; x: number; y: number };
/** A loose particle (debris, sparks) with simple ballistic motion; lands on `floor`. */
type Bit = { o: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle; vx: number; vy: number; vr: number; floor: number; life: number };

/** Pooled effect images allowed on screen before optional sparks, trails and puffs are dropped. */
const FX_CAP = 180;
const hud = (s: Phaser.Scene, x: number, y: number, t: string, size: number, color = '#ffffff') => hudText(s, x, y, t, size, color).setDepth(6001);

/** Faction effect textures: a flying sword, a paper talisman, a sakura petal, a feather and a summoning seal. */
function ensureBattleFx(s: Phaser.Scene) {
  if (s.textures.exists('fx_sword')) return;
  const g = s.make.graphics({ x: 0, y: 0 }, false);
  const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
  // sword, point down: blade, guard, grip
  g.fillStyle(0xffffff, 1).fillPoints([V(8, 14), V(12, 14), V(12, 50), V(10, 60), V(8, 50)], true);
  g.fillStyle(0xd8d8d8, 1).fillRect(3, 11, 14, 4).fillRect(8, 0, 4, 11);
  g.generateTexture('fx_sword', 20, 60);
  g.clear();
  // ofuda: cream slip with a red seal stroke
  g.fillStyle(0xfff6dc, 1).fillRect(0, 0, 12, 30);
  g.fillStyle(0xd02a2a, 1).fillRect(5, 3, 2, 22).fillRect(2, 8, 8, 2).fillRect(3, 16, 6, 2);
  g.generateTexture('fx_ofuda', 12, 30);
  g.clear();
  // five-lobed petal shape reduced to one teardrop
  g.fillStyle(0xffffff, 1).fillEllipse(8, 6, 12, 10).fillTriangle(3, 8, 13, 8, 8, 15);
  g.generateTexture('fx_petal', 16, 16);
  g.clear();
  g.fillStyle(0xffffff, 1).fillEllipse(8, 18, 12, 32);
  g.lineStyle(1.5, 0xc8d8f0, 1).lineBetween(8, 2, 8, 36);
  g.generateTexture('fx_feather', 16, 36);
  g.clear();
  // onmyoji seal: double ring and a five-point star
  g.lineStyle(5, 0xffffff, 1).strokeCircle(64, 64, 60);
  g.lineStyle(2, 0xffffff, 1).strokeCircle(64, 64, 50);
  const star = [0, 2, 4, 1, 3].map((i) => V(64 + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * 48, 64 + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * 48));
  g.lineStyle(4, 0xffffff, 1).strokePoints(star, true);
  g.generateTexture('fx_seal', 128, 128);
  g.destroy();
}

export class BattleScene extends Phaser.Scene {
  private b!: Battle;
  private save!: Save;
  private mode: 'attack' | 'defend' = 'attack';
  private g!: Phaser.GameObjects.Graphics;
  private pool: Phaser.GameObjects.Image[] = []; // spent glow/spark images, reused instead of re-created
  private numPool: Phaser.GameObjects.Text[] = [];
  private fxLive = 0; // pooled effect images on screen; optional effects are skipped above FX_CAP
  private sel = 1;
  private speed = 1;
  private hud!: Phaser.GameObjects.Text;
  private timeTx!: Phaser.GameObjects.Text;
  private timeWarn = false;
  private lastLeft = -1;
  private lootBank = 0;
  private retreated = false;
  /** Raid troops trained from the 军营 for this battle (the sim's pool); null outside raids. */
  private paidPool: Record<string, number> | null = null;
  private skillBtn?: Phaser.GameObjects.Image;
  private skillHalo?: Phaser.GameObjects.Image;
  private speedTx!: Phaser.GameObjects.Text;
  private pctTx!: Phaser.GameObjects.Text;
  private pctStars: Phaser.GameObjects.Graphics[] = [];
  private litStars = 0;
  private done = false;
  private expedition = false;
  private hint!: Phaser.GameObjects.Text;
  private cardDraw: Array<(on: boolean) => void> = [];
  private cardAfford: Array<() => void> = [];
  private bViews = new Map<number, BuildingView>();
  private uViews = new Map<number, UnitView>();
  private fxG!: Phaser.GameObjects.Graphics;
  private enemyColor = 0xd04040;
  private fp?: import('./fp3d').FirstPerson;
  /** The troop types on the card row (attack only), indexed by `sel`. */
  private troops: TroopDef[] = [];
  /** Where a troop was last sent in (2D or 3D); the 3D view's cards deploy there. */
  private lastDeploy: { x: number; y: number } | null = null;
  private fpLoading = false;
  private testFrozen = false; // playtest bridge only (step(-1)); normal play never sets it
  private skin = 'cn'; // building set: own faction when defending, a different faction's when attacking
  private bPrev = new Map<number, Track>();
  private uPrev = new Map<number, Track & { hero: boolean; flying: boolean; fid: string; hitH: number }>();
  private uDmg = new Map<number, { t: number; n: number }>(); // unit id -> last hit shown / damage since
  private bDmg = new Map<number, { t: number; n: number; k?: number }>(); // building id -> last number shown / damage since
  private bJolt = new Map<number, number>(); // building id -> time its hit flash / shake ends
  private bJoltAt = new Map<number, number>(); // building id -> when its last flash started
  private bBaseX = new Map<number, number>();
  private bits: Bit[] = [];
  private floats = 0; // live damage numbers, capped so a big brawl does not drown the field
  private rubble!: Phaser.GameObjects.Graphics;
  /** World camera on the battlefield, UI camera for the HUD; HUD depths are 6000-7100 and 8150 and up. */
  private stage!: Stage;
  private cam!: MapCamera;

  constructor() { super('battle'); }

  init(data: { mode?: 'attack' | 'defend'; expedition?: boolean }) { this.mode = data.mode ?? 'attack'; this.expedition = !!data.expedition; }

  create() {
    this.save = loadSave();
    state.faction = this.save.civilization ?? 0;
    const run = this.save.run;
    if (this.expedition && (!run || run.phase !== 'battle' || run.engaged)) { this.scene.start('expedition'); return; }
    // older saves can carry a run without an army snapshot; fall back to the current lineup instead of crashing
    const runTroops = this.expedition && run ? runArmy(run) : [];
    // a raid trains the 军营 composition on the spot (paid now, unused troops refunded at the end); the base only
    // sends the player here once muster can succeed, so a failure falls back to the camp
    this.paidPool = null;
    let raidTroops: TroopDef[] = [];
    if (!this.expedition && this.mode === 'attack') {
      const m = muster(this.save);
      if ('error' in m) { this.scene.start('train', { notice: m.error }); return; }
      const hero = this.save.heroes[this.save.squad[0]] ? troopById(this.save.squad[0]) : undefined;
      this.paidPool = { ...m.pool, ...(hero ? { [hero.id]: 1 } : {}) };
      raidTroops = [...(hero ? [hero] : []), ...armyList(m.pool).map((e) => e.t)].map((t) => boosted(this.save, t));
      // the save holds the live pool, so a raid closed before it settles is refunded on the next load
      this.save.raidPool = this.paidPool;
      writeSave(this.save);
    }
    const f = { ...FACTIONS[state.faction], troops: runTroops.length ? runTroops : raidTroops.length ? raidTroops : armyOf(this.save) };
    this.done = false;
    this.sel = 1;
    this.troops = [];
    this.lastDeploy = null;
    this.speed = 1;
    this.cardDraw = [];
    this.cardAfford = [];
    this.skillBtn = undefined;
    this.skillHalo = undefined;
    this.timeWarn = false;
    this.lastLeft = -1;
    this.lootBank = 0;
    this.retreated = false;
    this.litStars = 0;
    const lvl = coreLevel(this.save);
    if (this.expedition && run) {
      this.b = newBattle(runLayout(run));
      this.b.energy = runEnergy(run);
      this.b.siege = (run.relics.siege ?? 0) * 0.3;
      this.b.plunder = (run.relics.plunder ?? 0) * 4;
      this.b.singleHero = true;
      run.engaged = true;
      writeSave(this.save);
    } else if (this.mode === 'attack') {
      this.b = newBattle(generateEnemyBase(this.save.opponent, lvl));
      this.b.pool = this.paidPool; // 扶桑's 灵脉共鸣 is already in the camp's population
      this.b.singleHero = true;
    } else {
      const seed = Date.now() % 100000;
      const wave = generateWave(lvl, seed);
      this.enemyColor = factionOf(wave[0].def.id).color;
      this.b = newBattle(this.save.layout, 'defend', wave);
    }
    this.skin = FACTIONS[this.mode === 'attack' ? (state.faction + 1) % FACTIONS.length : state.faction].id;
    this.bViews.clear();
    this.uViews.clear();
    this.bPrev.clear();
    this.uPrev.clear();
    this.uDmg.clear();
    this.bJolt.clear();
    this.bJoltAt.clear();
    this.bDmg.clear();
    this.bBaseX.clear();
    this.bits = [];
    this.floats = 0;
    this.pendingShots = [];
    ensureFx(this);
    stageCamera(this);
    this.stage = splitStage(this, { x: -60, y: 10, w: 920, h: 550 }, (d) => (d >= 6000 && d < 7100) || d >= 8150);
    if (this.save.settings.calm) calmCamera(this.cameras.main);
    this.cameras.main.fadeIn(300);
    this.pool = [];
    this.numPool = [];
    this.fxLive = 0;
    ensureBattleFx(this);
    // the ground never changes during a fight: draw it once and keep it as a single image
    this.g = this.add.graphics();
    drawGround(this.g);
    if (this.mode === 'attack') strokeRegion(this.g, 2, GRID - 2, 0xffffff, 0.2);
    // baked at canvas resolution and shown at 1/RES, so it is as sharp as live vector drawing
    const ground = this.add.renderTexture(0, 0, W * RES, H * RES).setOrigin(0).setScale(1 / RES).setDepth(-1);
    this.g.setScale(RES);
    ground.draw(this.g);
    ground.render();
    this.g.destroy();
    this.rubble = this.add.graphics().setDepth(-0.5);
    // an AI base shows its culture's map; at home it is the player's own
    drawScenery(this, this.mode === 'attack' ? FACTION_SKIN[this.skin] : this.save.mapSkin, MAP_BOUNDS);
    this.cam = mapCamera(this, this.stage, MAP_BOUNDS, { enabled: () => !this.done });
    this.fxG = this.add.graphics().setDepth(5000);
    const L = VIEW.l, R = VIEW.r, CX = VIEW.w / 2;
    // floating tip in the middle of the field: the latest hint or deploy error
    this.hint = hud(this, CX, 110, '', 17).setOrigin(0.5).setAlpha(0);
    this.tip(this.mode === 'attack' ? (this.expedition ? '点击地图边缘部署；英雄每场限一次' : '选好兵种，点击地图边缘 2 格内出兵') : '观察战局 · 可随时加速或撤退');

    // top-left: what this fight is, what can be won (or what is coming), and the deploy pool
    const heading = this.expedition && run ? `远征 ${run.stage + 1}/5 · ${NODE_INFO[run.node!].name} · 战备 ${run.readiness}%` : this.mode === 'attack' ? 'AI 模拟领地 · 单机掠夺' : 'AI 演习 · 离线防守';
    hud(this, L + 14, 18, heading, 14, TXT.cream).setOrigin(0, 0.5);
    if (this.mode === 'attack') {
      const all = lootOf({ ...this.b, buildings: this.b.buildings.map((x) => ({ ...x, hp: 0 })) } as Battle);
      hud(this, L + 14, 42, '可获得的战利品：', 13).setOrigin(0, 0.5);
      this.add.image(L + 26, 66, 'ui_icon_stone').setScale(26 / ICON).setDepth(6001);
      hud(this, L + 44, 66, `${all}`, 17).setOrigin(0, 0.5);
    }
    this.add.image(L + 26, this.mode === 'attack' ? 94 : 46, `ui_${this.mode === 'attack' ? 'icon_token' : 'icon_sword'}`).setScale(26 / ICON).setDepth(6001);
    this.hud = hud(this, L + 44, this.mode === 'attack' ? 94 : 46, '', 17).setOrigin(0, 0.5);
    // top-centre: the countdown, big
    hud(this, CX, 16, '离战斗结束还有', 13, TXT.cream).setOrigin(0.5);
    this.timeTx = hud(this, CX, 42, '', 26).setOrigin(0.5);
    // top-right: the player's own wallet, as on the home island
    this.walletBar(24, 'icon_stone', 0x3cc77a, this.save.stone);
    this.walletBar(54, 'icon_token', 0xf2b632, this.save.tokens);

    const row = VIEW.h - 52;
    if (this.mode === 'attack') {
      // a raid can bring many troop types: cards shrink to fit between the left edge and the destruction panel
      const heroDef = f.troops.find((t) => t.hero);
      const room = R - 210 - (L + 12) - (heroDef ? 92 : 0), step = Math.min(84, room / f.troops.length), k = step / 84;
      this.troops = f.troops;
      f.troops.forEach((t, i) => this.makeCard(t, i, L + 12 + step * (i + 0.5), row, k));
      this.sel = f.troops.findIndex((t) => !t.hero);
      if (this.sel < 0) this.sel = 0;
      if (heroDef?.skill) {
        const sk = SKILLS[heroDef.skill], sx = L + 12 + step * f.troops.length + 48;
        this.skillHalo = this.add.image(sx, row, 'fx_glow').setTint(0x6cd8ff).setBlendMode('ADD').setScale(3.6).setAlpha(0.5).setDepth(6000);
        this.tweens.add({ targets: this.skillHalo, alpha: 0.9, scale: 4.2, duration: 850, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.skillBtn = this.icon(sx, row - 8, 'skill', 56, () => this.useSkill());
        hud(this, sx, row + 32, sk.name, 12).setOrigin(0.5);
      }
    } else {
      // defend: nothing to deploy, so a plate along the bottom tells the story instead
      const g = this.add.graphics().setDepth(6000);
      g.fillStyle(0x0a0f1e, 0.55).fillRoundedRect(L + 120, row - 34, 380, 68, 16);
      this.add.image(L + 156, row, 'ui_icon_wall').setScale(50 / ICON).setDepth(6001);
      hud(this, L + 190, row - 12, '防守战', 20, TXT.gold).setOrigin(0, 0.5);
      hud(this, L + 190, row + 14, '失守或中途撤退，损失 25% 灵石', 14, '#ffb4a0').setOrigin(0, 0.5);
    }
    // bottom-left: leave the fight, the way the genre puts it, a red bar above the cards
    const quit = button(this, L + 78, row - 92, 136, 40, this.expedition ? '撤退保底' : this.mode === 'attack' ? '结束战斗' : '撤退', 0xe0483a, () => this.leave());
    quit.r.setDepth(6002);
    // bottom-right: destruction (or what still stands) with its three stars, the speed toggle above it
    const pg = this.add.graphics().setDepth(6000);
    pg.fillStyle(0x0a0f1e, 0.55).fillRoundedRect(R - 196, row - 40, 184, 80, 16);
    hud(this, R - 104, row - 26, this.mode === 'attack' ? '摧毁率' : '完好率', 13, TXT.cream).setOrigin(0.5);
    this.pctTx = hud(this, R - 24, row + 8, '0%', 28).setOrigin(1, 0.5);
    this.pctStars = [0, 1, 2].map((i) => this.star(R - 176 + i * 26, row + 8, 10, false, 6001));
    this.icon(R - 40, row - 86, 'speed', 46, () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; });
    this.speedTx = hud(this, R - 40, row - 54, 'x1', 14, TXT.gold).setOrigin(0.5);
    // above the speed toggle: drop from the 2.5D map into the eyes of a troop on the field (fp3d.ts)
    this.fp = undefined;
    this.fpLoading = false;
    this.testFrozen = false;
    const fpBtn = button(this, R - 64, row - 148, 112, 38, '第一人称', 0x4a9aff, () => void this.openFp());
    fpBtn.r.setDepth(6002); fpBtn.tx.setFontSize(15);
    hud(this, R - 64, row - 120, '3D 视角', 11, TXT.cyan).setOrigin(0.5);
    this.events.once('shutdown', () => { this.fp?.dispose(); this.fp = undefined; });

    // deploy on a tap; a drag pans the battlefield and a pinch zooms it (mapCamera)
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // HUD buttons keep their taps, and so does the top HUD band; nothing reaches the map while the 3D view is up
      if (this.fp || !this.cam.tap(p) || this.done || this.mode !== 'attack' || over.length || p.y / this.stage.ui.zoom < 50) return;
      const w = this.stage.toWorld(p), g = unproj(w.x, w.y);
      if (!inGrid(g)) return;
      const r = this.deployAt(g.x, g.y);
      if (r.msg) this.tip(r.msg);
    });
    this.banner(this.mode === 'attack' ? '进 攻 开 始' : '敌 军 来 袭');
    if (new URLSearchParams(location.search).get('ohmygamePlaytest') === '1') {
      const target = globalThis as typeof globalThis & { __OHMYGAME_PLAYTEST__?: unknown };
      target.__OHMYGAME_PLAYTEST__ = {
        snapshot: () => ({ mode: this.expedition ? 'expedition' : this.mode, result: this.b.result, energy: this.b.energy, units: this.b.units.length, run: this.save.run, fp: this.fp?.snapshot() ?? null }),
        // test-only: step(ms) advances the fight; step(-1) freezes live time so a moment can be inspected, step(0) thaws it
        step: (ms: number) => {
          if (ms < 0) { this.testFrozen = true; return; }
          if (ms === 0) { this.testFrozen = false; return; }
          for (let t = 0; t < Math.min(ms, 120000) && this.b.result === 'running'; t += 50) step(this.b, 0.05);
          this.update(0, 0);
        },
      };
      this.events.once('shutdown', () => { delete target.__OHMYGAME_PLAYTEST__; });
    }
  }

  /** Whether troop type `t` can still be sent in: troops left in a raid's pool, or 灵气 for its cost. */
  private canDeploy(t: TroopDef) {
    const p = this.b.pool;
    return p ? (p[t.id] ?? 0) > 0 && !(t.hero && this.b.heroDeployed) : this.b.energy >= t.cost;
  }

  /**
   * Send the selected troop in at grid point (gx, gy), from a tap on the 2D map or on the ground of the 3D view.
   * Only the border (2 cells deep) takes troops, as in the genre. Returns what to tell the player.
   */
  private deployAt(gx: number, gy: number): { ok: boolean; msg: string } {
    if (this.done || this.mode !== 'attack' || this.b.result !== 'running') return { ok: false, msg: '' };
    if (!inGrid({ x: gx, y: gy }) || Math.min(gx, gy, GRID - gx, GRID - gy) > 2) return { ok: false, msg: '请在地图边缘 2 格内部署' };
    const t = this.troops[this.sel];
    if (!deploy(this.b, t, gx, gy)) {
      return { ok: false, msg: t.hero && this.b.singleHero && this.b.heroDeployed ? '英雄本场已部署' : this.b.pool ? `${t.name} 已全部出战` : '灵气不足，无法部署' };
    }
    this.deployFx(gx, gy, t.hero ? PAL.goldHi : FACTIONS[state.faction].color, !!t.hero);
    this.lastDeploy = { x: gx, y: gy };
    const p = this.b.pool;
    if (p) writeSave(this.save); // save.raidPool is this pool: a deployed troop is spent even if the game closes now
    // that troop type ran out: move the selection to the next one still waiting
    if (p && !(p[t.id] > 0)) {
      // the next troop type after this one (wrapping); the hero is never picked for the player
      const n = this.troops.length;
      for (let d = 1; d < n; d++) {
        const j = (this.sel + d) % n, u = this.troops[j];
        if (!u.hero && p[u.id] > 0) { this.sel = j; break; }
      }
    }
    return { ok: true, msg: `${t.name} 已出阵` };
  }

  /**
   * The 3D view's card tap: pick troop type i and send one in at the last place anything was deployed this fight,
   * nudged a little so a column does not stand in one spot (the exact point when the nudge would leave the border).
   * With no deployment yet there is no place to reuse, so it only selects.
   */
  private deployCard(i: number): { ok: boolean; msg: string } {
    this.sel = i;
    const at = this.lastDeploy;
    if (!at) return { ok: false, msg: '先点地面边缘选一个部署点' };
    const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.25;
    const nx = Math.max(0.05, Math.min(GRID - 0.05, at.x + Math.cos(a) * r)), ny = Math.max(0.05, Math.min(GRID - 0.05, at.y + Math.sin(a) * r));
    const keep = { ...at };
    const res = Math.min(nx, ny, GRID - nx, GRID - ny) <= 2 ? this.deployAt(nx, ny) : this.deployAt(at.x, at.y);
    this.lastDeploy = keep; // the deploy point stays where the player chose it, not where the nudge landed
    return res;
  }

  /** The hero's skill, from the 2D button or the 3D view; false (with the reason shown) when it cannot be cast. */
  private useSkill(): boolean {
    const h = heroAlive(this.b);
    if (!h || !castSkill(this.b)) { this.tip('先部署英雄；每场技能只能释放一次'); return false; }
    const sk = SKILLS[h.def.skill!];
    this.skillFx(h.def.skill!, h.x, h.y, sk.name);
    this.tip(`${sk.name}!`);
    return true;
  }

  /**
   * First-person 3D view: three.js and the models load only now (a separate chunk), then the view flies down from
   * the map angle into a troop's eyes. The battle keeps running here; the view only reads it.
   */
  private async openFp() {
    if (this.fp || this.fpLoading || this.done) return;
    this.fpLoading = true;
    this.tip('正在载入 3D 视角…');
    try {
      const { FirstPerson } = await import('./fp3d');
      if (!this.scene.isActive() || this.done) return;
      const own = (bl: { x: number; y: number }) => this.save.layout.find((q) => q.x === Math.floor(bl.x) && q.y === Math.floor(bl.y));
      this.fp = FirstPerson.open({
        battle: () => this.b,
        fidOf: (bl) => (this.mode === 'defend' ? FACTIONS[own(bl)?.faction ?? state.faction].id : this.skin),
        status: () => {
          const left = Math.max(0, Math.ceil(TIME_LIMIT - this.b.time));
          const { pct } = this.stars(this.mode === 'attack' || this.b.result !== 'lose');
          return { time: left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}秒`, pct: `${Math.round(pct * 100)}%`, warn: left <= 10 };
        },
        castSkill: () => this.useSkill(),
        // attacks deploy from inside the 3D view too: the same cards, selection and border rule as the 2D row
        deploy: this.mode === 'attack' ? {
          cards: () => this.troops.map((t, i) => ({
            id: t.id, name: t.name, hero: !!t.hero, sel: i === this.sel, ok: this.canDeploy(t),
            badge: this.b.pool ? `${this.b.pool[t.id] ?? 0}` : `${t.cost}`,
          })),
          card: (i) => this.deployCard(i),
          at: (gx, gy) => this.deployAt(gx, gy),
          last: () => this.lastDeploy,
        } : undefined,
        onClosed: () => { this.fp = undefined; },
      });
    } catch {
      this.tip('3D 视角载入失败');
    } finally {
      this.fpLoading = false;
    }
  }

  /** Wallet bar at the top right: dark track, coloured fill, number right-aligned, icon on the end. */
  private walletBar(y: number, icon: string, fill: number, value: number) {
    const x = VIEW.r - 186, w = 160, h = 22;
    const g = this.add.graphics().setDepth(6000);
    g.fillStyle(0x0a0f1e, 0.55).fillRoundedRect(x, y - h / 2, w, h, h / 2);
    g.fillStyle(fill, 1).fillRoundedRect(x + 3, y - h / 2 + 3, w - 6, h - 6, (h - 6) / 2);
    g.fillStyle(0xffffff, 0.28).fillRoundedRect(x + 8, y - h / 2 + 4, w - 22, 4, 2);
    this.add.image(x + w + 4, y, `ui_${icon}`).setScale(34 / ICON).setDepth(6001);
    hud(this, x + w - 18, y, `${value}`, 15).setOrigin(1, 0.5);
  }

  /** Round art button with a ground shadow, hover grow and press squash. */
  private icon(x: number, y: number, key: string, size: number, on: () => void) {
    dropShadow(this, x, y + size * 0.42, size * 0.78, size * 0.2, 6000);
    const img = this.add.image(x, y, `ui_${key}`).setDepth(6001).setInteractive({ useHandCursor: true });
    const k = size / img.height;
    img.setScale(k);
    // speed / retreat sit 76px apart; the skill orb has room to the left
    growHit(img, size > 60 ? 80 : 74, 92, 14);
    squashFx(this, img, img, k);
    img.on('pointerdown', on);
    return img;
  }

  /**
   * Troop card in the bottom row: portrait on a colour-coded tile (gold for the hero, blue for troops), the cost
   * in a badge at the corner (in a raid: how many are left). The chosen card lifts with a white rim; cards that
   * cannot be deployed turn grey. `k` scales the card down when many troop types share the row.
   */
  private makeCard(t: TroopDef, i: number, cx: number, cy: number, k = 1) {
    const card = this.add.container(cx, cy).setDepth(6000).setScale(k);
    const face = t.hero ? 0xf0a030 : 0x4a7fe0;
    const tile = tileFace(this, 0, -2, 78, face, 94);
    const sky = this.add.graphics();
    sky.fillStyle(0xffffff, 0.12).fillRoundedRect(-30, -38, 60, 54, 9);
    const pic = this.add.image(0, -10, `unit_${t.id}`).setOrigin(0.5);
    pic.setScale(Math.min(64 / pic.width, 60 / pic.height));
    const strip = this.add.graphics();
    strip.fillStyle(0x0a0f1e, 0.5).fillRoundedRect(-33, 20, 66, 18, { tl: 0, tr: 0, bl: 9, br: 9 });
    const nameTx = hud(this, 0, 29, t.name, 11).setOrigin(0.5);
    const badge = this.add.graphics();
    badge.fillStyle(0x0a0f1e, 0.7).fillCircle(-28, -36, 13).lineStyle(2, 0xffffff, 0.9).strokeCircle(-28, -36, 13);
    const pool = () => this.b.pool;
    const costTx = hud(this, -28, -36, pool() ? `${pool()![t.id] ?? 0}` : `${t.cost}`, 13).setOrigin(0.5);
    const rim = this.add.graphics().setVisible(false);
    rim.lineStyle(4, 0xffffff, 1).strokeRoundedRect(-40, -48, 80, 91, 13);
    card.add([tile, sky, pic, strip, nameTx, badge, costTx, rim]);
    if (t.hero) card.add(this.add.image(30, -38, 'fx_spark').setTint(0xfff0a0).setScale(0.6));
    const hit = this.add.rectangle(cx, cy, 80 * k, 96 * k, 0, 0).setDepth(6002).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { this.sel = i; });
    let cur: boolean | null = null; // paint() calls every frame; only react to changes
    this.cardDraw.push((sel) => {
      if (cur === sel) return;
      cur = sel;
      rim.setVisible(sel);
      this.tweens.add({ targets: card, y: sel ? cy - 10 : cy, scale: (sel ? 1.06 : 1) * k, duration: 150, ease: 'Back.easeOut' });
    });
    let can: boolean | null = null, left = -1;
    this.cardAfford.push(() => {
      const p = pool(), n = p ? p[t.id] ?? 0 : 0;
      if (p && n !== left) { left = n; costTx.setText(`${n}`); }
      const ok = this.canDeploy(t);
      if (ok === can) return;
      can = ok;
      tile.setAlpha(ok ? 1 : 0.55);
      pic.setTint(ok ? 0xffffff : 0x8a8a8a);
      costTx.setColor(ok ? '#ffffff' : TXT.red);
    });
  }

  /** A message that pops up over the field and fades. */
  private tip(t: string) {
    this.hint.setText(t).setAlpha(1).setScale(1.12);
    this.tweens.killTweensOf(this.hint);
    this.tweens.add({ targets: this.hint, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.hint, alpha: 0, delay: 1800, duration: 500 });
  }

  // ---- combat feedback: all of it is derived from the sim state, the sim itself is untouched ----

  /** Opening swoosh: a gold ribbon slides through the middle of the field. */
  private banner(t: string) {
    const y = VIEW.h / 2 - 20, vw = VIEW.w, g = this.add.graphics().setDepth(7000);
    g.fillStyle(0x0b1127, 0.78).fillRect(-vw / 2, -26, vw, 52);
    g.fillStyle(PAL.gold, 0.9).fillRect(-vw / 2, -26, vw, 2).fillRect(-vw / 2, 24, vw, 2);
    g.setPosition(vw / 2, y).setScale(0, 1);
    const tx = outline(label(this, vw / 2, y, t, 30, TXT.gold).setOrigin(0.5).setDepth(7001), '#2a1608', 6).setAlpha(0).setScale(1.6);
    this.tweens.chain({ targets: g, tweens: [
      { scaleX: 1, duration: 260, ease: 'Cubic.easeOut' },
      { alpha: 0, duration: 300, delay: 900, onComplete: () => g.destroy() },
    ] });
    this.tweens.chain({ targets: tx, tweens: [
      { alpha: 1, scale: 1, duration: 320, delay: 120, ease: 'Back.easeOut' },
      { alpha: 0, x: vw / 2 + 60, duration: 300, delay: 760, onComplete: () => tx.destroy() },
    ] });
  }

  /** A pooled effect image. Optional effects (`must` false) are skipped once FX_CAP are on screen, so a big
   *  x4 brawl keeps a bounded object count instead of piling up sparks. Release with `free()`. */
  private fx(x: number, y: number, key: string, tint: number, depth: number, scale: number, must = false, add = true) {
    if (!must && this.fxLive >= FX_CAP) return undefined;
    const o = this.pool.pop() ?? this.add.image(0, 0, key);
    o.setTexture(key).setPosition(x, y).setTint(tint).setBlendMode(add ? 'ADD' : 'NORMAL').setDepth(depth)
      .setScale(scale).setAlpha(1).setAngle(0).setFlip(false, false).setOrigin(0.5).setVisible(true).setActive(true);
    this.fxLive++;
    return o;
  }

  private free(o: Phaser.GameObjects.Image) {
    if (!o.active) return;
    o.setVisible(false).setActive(false);
    this.fxLive--;
    this.pool.push(o);
  }

  /** Busy-ness of the field, 0..1; cosmetic extras thin out as it rises. */
  private get busy() { return this.fxLive / FX_CAP; }

  /** Floating damage number; `big` for skill-sized hits. Friendly losses read red, damage dealt reads gold.
   *  Text objects are pooled: making a fresh Text costs a canvas and a texture upload each time. */
  private popNumber(x: number, y: number, n: number, friendly: boolean) {
    if (this.floats >= 22 || n < 1) return;
    this.floats++;
    const big = n >= 100;
    const tx = this.numPool.pop() ?? outline(label(this, 0, 0, '', 15).setOrigin(0.5), '#2a0a06', 4).setDepth(8000);
    tx.setText(`-${Math.round(n)}`).setFontSize(big ? 22 : 15).setColor(friendly ? '#ff7a6a' : big ? '#ffb347' : '#fff1b8')
      .setStroke('#2a0a06', big ? 5 : 4).setPosition(x + (Math.random() - 0.5) * 18, y).setAlpha(1).setScale(big ? 1.9 : 1.5).setVisible(true);
    this.tweens.add({ targets: tx, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: tx, y: y - (big ? 40 : 28), alpha: 0, duration: big ? 900 : 650, delay: 140, ease: 'Cubic.easeOut',
      onComplete: () => { tx.setVisible(false); this.numPool.push(tx); this.floats--; } });
  }

  /** Small star flash where a blow lands. */
  private impact(x: number, y: number, tint: number, n = 3) {
    const fl = this.fx(x, y, 'fx_glow', tint, 7900, 0.6);
    if (!fl) return;
    this.tweens.add({ targets: fl, scale: 1.8, alpha: 0, duration: 220, onComplete: () => this.free(fl) });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = this.fx(x, y, 'fx_spark', tint, 7900, 0.35);
      if (!sp) break;
      this.bits.push({ o: sp, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 60, vr: 6, floor: y + 14, life: 0.35 });
    }
  }

  /** Glowing bolt on a shallow arc from a to b, with a spark where it lands. */
  private bolt(ax: number, ay: number, bx: number, by: number, tint: number, size = 0.9) {
    const head = this.fx(ax, ay, 'fx_glow', tint, 7800, size, true)!;
    const core = this.fx(ax, ay, 'fx_spark', 0xffffff, 7801, size * 0.45, true)!;
    const d = Math.hypot(bx - ax, by - ay), arc = Math.min(40, d * 0.25);
    let lastTrail = 0;
    this.tweens.addCounter({
      from: 0, to: 1, duration: Math.min(280, 90 + d * 0.6),
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 1, x = ax + (bx - ax) * k, y = ay + (by - ay) * k - Math.sin(k * Math.PI) * arc;
        head.setPosition(x, y); core.setPosition(x, y).setAngle(k * 360);
        // a trail puff every ~12% of the flight, fewer when the field is crowded
        if (k - lastTrail > 0.12 + this.busy * 0.25) {
          lastTrail = k;
          const tr = this.fx(x, y, 'fx_glow', tint, 7799, size * 0.6);
          if (tr) { tr.setAlpha(0.7); this.tweens.add({ targets: tr, alpha: 0, scale: 0.1, duration: 200, onComplete: () => this.free(tr) }); }
        }
      },
      onComplete: () => { this.free(head); this.free(core); this.impact(bx, by, tint, 2); },
    });
  }

  /** White crescent swipe for a melee blow. */
  private slash(x: number, y: number, face: number, tint: number) {
    if (this.busy > 0.85) return;
    const g = this.add.graphics({ x, y }).setDepth(7850).setBlendMode('ADD');
    g.lineStyle(4, tint, 0.95).beginPath().arc(0, 0, 14, -2.4, -0.4).strokePath();
    g.lineStyle(2, 0xffffff, 1).beginPath().arc(0, 0, 12, -2.2, -0.6).strokePath();
    g.setScale(face, 1).setAngle(face * -20).setAlpha(1);
    this.tweens.add({ targets: g, angle: face * 60, scaleX: face * 1.3, scaleY: 1.3, alpha: 0, duration: 200, ease: 'Cubic.easeOut', onComplete: () => g.destroy() });
  }

  /** Soft dust puffs that swell and fade. */
  private dust(x: number, y: number, n: number, spread: number, tint = 0xe8dcc0, depth = 7700) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, r = spread * (0.4 + Math.random() * 0.6);
      const p = this.fx(x, y, 'fx_glow', tint, depth, 0.8 + Math.random() * 0.6, false, false);
      if (!p) return;
      p.setAlpha(0.85);
      this.tweens.add({ targets: p, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.5 - 8, scale: 2.2 + Math.random(), alpha: 0, duration: 520 + Math.random() * 300, ease: 'Cubic.easeOut', onComplete: () => this.free(p) });
    }
  }

  private deployFx(gx: number, gy: number, tint: number, hero: boolean) {
    const p = proj(gx, gy);
    const ring = this.add.ellipse(p.x, p.y, 20, 10).setStrokeStyle(3, tint, 1).setDepth(7600);
    this.tweens.add({ targets: ring, scaleX: hero ? 4 : 2.6, scaleY: hero ? 4 : 2.6, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    const col = this.add.image(p.x, p.y - 30, 'fx_glow').setTint(tint).setBlendMode('ADD').setDepth(7600).setScale(1.2, 4).setAlpha(0.9);
    this.tweens.add({ targets: col, scaleX: 0.2, alpha: 0, duration: 380, ease: 'Cubic.easeIn', onComplete: () => col.destroy() });
    this.dust(p.x, p.y, hero ? 8 : 5, hero ? 34 : 22);
    if (hero) { this.cameras.main.shake(140, 0.004); burst(this, p.x, p.y - 40, 7700, 14); }
  }

  /** Collapse of a building: flash, dust cloud, flying debris, a lasting rubble patch and the loot it dropped. */
  private wreck(cx: number, cy: number, kind: string, top: number, loot: number) {
    const p = proj(cx + 0.5, cy + 0.5), core = kind === 'core', k = core ? 1.8 : kind === 'wall' ? 0.6 : 1;
    const fl = this.add.image(p.x, p.y - 20 * k, 'fx_glow').setTint(0xfff0c0).setBlendMode('ADD').setDepth(7900).setScale(2 * k);
    this.tweens.add({ targets: fl, scale: 6 * k, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => fl.destroy() });
    this.dust(p.x, p.y - 6, Math.round(8 * k), 40 * k, 0xd8ccb4);
    const cols = [0x6b4a30, 0x8a6a48, 0x9a9a9a, 0x5a5050, 0xb0402c];
    for (let i = 0; i < Math.round(10 * k) && this.bits.length < 160; i++) {
      const s = 3 + Math.random() * 5 * k;
      const o = this.add.rectangle(p.x + (Math.random() - 0.5) * 20 * k, top + (p.y - top) * Math.random(), s, s * 0.7, cols[i % cols.length]).setDepth(7700);
      this.bits.push({ o, vx: (Math.random() - 0.5) * 220 * k, vy: -120 - Math.random() * 180 * k, vr: (Math.random() - 0.5) * 20, floor: p.y + (Math.random() - 0.3) * 14, life: 1.1 });
    }
    const r = this.rubble;
    r.fillStyle(0x2a2018, 0.35).fillEllipse(p.x, p.y, 34 * k, 16 * k);
    for (let i = 0; i < 5 * k; i++) r.fillStyle(cols[i % 3], 0.9).fillEllipse(p.x + (Math.random() - 0.5) * 26 * k, p.y + (Math.random() - 0.5) * 10 * k, 4 + Math.random() * 4, 3);
    this.cameras.main.shake(core ? 420 : 110, core ? 0.014 : 0.004);
    if (core) {
      this.cameras.main.flash(260, 255, 245, 210);
      burst(this, p.x, p.y - 40, 7950, 30);
    }
    // walls drop small change: bank it and show it with the next real building instead of a float each
    if (kind === 'wall') { this.lootBank += loot; loot = 0; }
    else if (loot > 0) { loot += this.lootBank; this.lootBank = 0; }
    if (loot > 0) {
      const ic = this.add.image(0, 0, 'ui_icon_stone').setScale(22 / ICON);
      const tx = outline(label(this, 13, 0, `+${loot}`, 17, TXT.gold).setOrigin(0, 0.5), '#2a1608', 4);
      const c = this.add.container(p.x - 10, top - 4, [ic, tx]).setDepth(8100).setScale(0.4);
      this.tweens.chain({ targets: c, tweens: [
        { scale: 1, y: top - 22, duration: 260, ease: 'Back.easeOut' },
        { y: top - 46, alpha: 0, duration: 700, delay: 500, ease: 'Cubic.easeIn', onComplete: () => c.destroy() },
      ] });
    }
  }

  /** Hero skill cast, one look per faction: 剑宗 a rain of flying swords, 阴阳寮 a spinning seal with talismans
   *  and petals, 圣庭 a pillar of light with a shock ring and drifting feathers. Plus a big skill-name callout. */
  private skillFx(skill: string, gx: number, gy: number, name: string) {
    const p = proj(gx, gy), D = 7950, cam = this.cameras.main;
    const tw = (o: Phaser.GameObjects.GameObject, cfg: Phaser.Types.Tweens.TweenBuilderConfig | object) => this.tweens.add({ targets: o, ...cfg });
    const kill = (o: Phaser.GameObjects.GameObject) => () => o.destroy();
    let col = 0xffe08a, edge = '#5a3a00';
    if (skill === 'sword_rain') {
      cam.flash(180, 255, 236, 180);
      const R = 3.5;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R, t = proj(gx + Math.cos(a) * r, gy + Math.sin(a) * r);
        const sw = this.add.image(t.x + 70, t.y - 300, 'fx_sword').setOrigin(0.5, 1).setDepth(D).setTint(i % 3 ? 0xffe9a8 : 0xffffff)
          .setBlendMode('ADD').setScale(1.2 + Math.random() * 0.5).setAngle(13).setAlpha(0);
        tw(sw, { x: t.x, y: t.y, alpha: 1, duration: 200, delay: i * 40 + Math.random() * 60, ease: 'Cubic.easeIn',
          onComplete: () => {
            this.impact(t.x, t.y - 4, 0xffe08a, 3);
            if (i % 4 === 0) cam.shake(90, 0.005);
            tw(sw, { alpha: 0, scaleY: 0.4, duration: 260, delay: 120, onComplete: kill(sw) });
          } });
      }
      const ring = this.add.ellipse(p.x, p.y, R * 2 * 46, R * 46, 0xffe08a, 0.08).setStrokeStyle(4, 0xfff0b0, 0.9).setDepth(7600).setScale(0.2);
      tw(ring, { scale: 1, duration: 260, ease: 'Back.easeOut', onComplete: () => tw(ring, { alpha: 0, duration: 700, delay: 500, onComplete: kill(ring) }) });
      cam.shake(420, 0.01);
    } else if (skill === 'summon') {
      col = 0xff5a6a; edge = '#4a0010';
      cam.flash(200, 255, 120, 150);
      const seal = this.add.image(0, 0, 'fx_seal').setTint(0xff3a5a).setBlendMode('ADD').setAlpha(0);
      const holder = this.add.container(p.x, p.y, [seal]).setDepth(7600).setScale(0.3, 0.15);
      tw(holder, { scaleX: 1.3, scaleY: 0.65, duration: 320, ease: 'Back.easeOut' });
      tw(seal, { alpha: 0.95, angle: 240, duration: 1300, ease: 'Sine.easeOut', onComplete: () => tw(seal, { alpha: 0, duration: 400, onComplete: kill(holder) }) });
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12, of = this.add.image(p.x, p.y - 10, 'fx_ofuda').setDepth(D).setScale(0.2).setAngle(Math.random() * 360);
        tw(of, { x: p.x + Math.cos(a) * 90, y: p.y - 30 + Math.sin(a) * 45 - 40, scale: 1, angle: of.angle + 360, duration: 650, delay: i * 25, ease: 'Cubic.easeOut',
          onComplete: () => tw(of, { y: of.y - 30, alpha: 0, duration: 420, onComplete: kill(of) }) });
      }
      for (let i = 0; i < 20; i++) this.petal(p.x + (Math.random() - 0.5) * 220, p.y - 120 - Math.random() * 80, D);
      cam.shake(260, 0.007);
    } else {
      col = 0x9fd4ff; edge = '#0a2450';
      cam.flash(260, 230, 245, 255);
      const pillar = this.add.image(p.x, p.y - 160, 'fx_glow').setTint(0xd8f0ff).setBlendMode('ADD').setDepth(D).setScale(0.4, 14).setAlpha(0);
      tw(pillar, { scaleX: 3.2, alpha: 1, duration: 180, ease: 'Cubic.easeOut', onComplete: () => tw(pillar, { scaleX: 0.2, alpha: 0, duration: 650, onComplete: kill(pillar) }) });
      const rays = this.add.image(p.x, p.y - 30, 'fx_rays').setTint(0xfff2c0).setBlendMode('ADD').setDepth(D - 1).setScale(0.4).setAlpha(0.9);
      tw(rays, { scale: 2.2, angle: 50, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: kill(rays) });
      const ring = this.add.ellipse(p.x, p.y, 40, 20).setStrokeStyle(5, 0xbfe4ff, 1).setDepth(7600);
      tw(ring, { scale: 12, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: kill(ring) });
      for (let i = 0; i < 14; i++) this.feather(p.x + (Math.random() - 0.5) * 260, p.y - 150 - Math.random() * 100, D);
      // the heal touches every ally: a rising cross of light over each
      for (const u of this.b.units.slice(0, 24)) {
        const q = proj(u.x, u.y, u.def.flying ? 40 : 24), h = this.fx(q.x, q.y, 'fx_spark', 0x9dffb0, D, 0.9, true)!;
        tw(h, { y: q.y - 30, angle: 90, alpha: 0, duration: 700, delay: Math.random() * 200, onComplete: () => this.free(h) });
      }
      cam.shake(240, 0.006);
    }
    // the name, stamped big across the field
    const tx = outline(label(this, VIEW.w / 2, 150, name, 44, Phaser.Display.Color.IntegerToColor(col).rgba).setOrigin(0.5), edge, 8).setDepth(8200).setScale(2.2).setAlpha(0);
    const glow = this.add.image(VIEW.w / 2, 150, 'fx_glow').setTint(col).setBlendMode('ADD').setDepth(8199).setScale(14, 3).setAlpha(0);
    this.tweens.chain({ targets: tx, tweens: [
      { scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' },
      { scale: 1.06, duration: 600 },
      { alpha: 0, y: 130, duration: 320, ease: 'Cubic.easeIn', onComplete: kill(tx) },
    ] });
    tw(glow, { alpha: 0.6, duration: 200, yoyo: true, hold: 500, onComplete: kill(glow) });
  }

  /** A sakura petal that tumbles down and sideways. */
  private petal(x: number, y: number, depth: number) {
    const o = this.fx(x, y, 'fx_petal', Math.random() < 0.5 ? 0xffb7c8 : 0xffd6e0, depth, 0.5 + Math.random() * 0.4, false, false);
    if (!o) return;
    o.setAngle(Math.random() * 360).setAlpha(0.95);
    this.tweens.add({ targets: o, x: x + 40 + Math.random() * 60, y: y + 90 + Math.random() * 60, angle: o.angle + 300, alpha: 0,
      duration: 1100 + Math.random() * 600, ease: 'Sine.easeIn', onComplete: () => this.free(o) });
  }

  /** A feather that sways down slowly. */
  private feather(x: number, y: number, depth: number) {
    const o = this.fx(x, y, 'fx_feather', 0xffffff, depth, 0.5 + Math.random() * 0.3, false, false);
    if (!o) return;
    o.setAngle(-30 + Math.random() * 60).setAlpha(0.95);
    this.tweens.add({ targets: o, y: y + 110 + Math.random() * 50, alpha: 0, duration: 1500 + Math.random() * 600, ease: 'Sine.easeIn', onComplete: () => this.free(o) });
    this.tweens.add({ targets: o, x: x + 18, angle: o.angle + 40, duration: 380, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
  }

  /** Death of a unit: a white ghost of the sprite lifts and fades, then a faction send-off:
   *  剑宗 crossed sword-qi and gold motes, 阴阳寮 talismans and petals scatter, 圣庭 a thin column of light and a feather. */
  private fallFx(v: UnitView, tint: number, fid: string, hero = false) {
    const img = v.img, x = img.x, y = img.y;
    const D = 7900, lite = this.busy > 0.6;
    // knock-back flash: the sprite pops white, rises and squashes away; a faction-coloured flash behind it
    const ghost = this.add.image(x, y, img.texture.key).setOrigin(0.5, 0.92).setScale(img.scaleX * 1.12, img.scaleY * 1.12).setFlipX(img.flipX).setDepth(img.depth + 0.01);
    ghost.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL).setAlpha(1);
    this.tweens.add({ targets: ghost, y: y - 22, scaleY: img.scaleY * 0.15, scaleX: img.scaleX * 1.5, alpha: 0, duration: 420, delay: 60, ease: 'Cubic.easeIn', onComplete: () => ghost.destroy() });
    const fl = this.fx(x, y - 26, 'fx_glow', mix(tint, 0xffffff, 0.35), D, 1.2, true)!;
    this.tweens.add({ targets: fl, scale: hero ? 5 : 3.4, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => this.free(fl) });
    // a ground shock ring so the spot of the loss stays readable for half a second
    const ring = this.fx(x, y, 'fx_glow', tint, 7650, 0.6, true)!;
    ring.setScale(1.2, 0.5).setAlpha(0.9);
    this.tweens.add({ targets: ring, scaleX: hero ? 5 : 3.4, scaleY: hero ? 2.2 : 1.5, alpha: 0, duration: 480, ease: 'Cubic.easeOut', onComplete: () => this.free(ring) });
    this.dust(x, y - 4, lite ? 3 : 7, 26, 0xc8c0d8);
    if (fid === 'cn') {
      // crossed sword-qi slashes and gold motes
      for (const s of [-1, 1]) {
        const q = this.fx(x, y - 26, 'fx_glow', 0xffe08a, D + 1, 0.3, true)!;
        q.setScale(0.35, 3.2).setAngle(s * 45);
        this.tweens.add({ targets: q, scaleY: 5, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => this.free(q) });
      }
      for (let i = 0; i < (lite ? 2 : 6); i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.45;
        const m = this.fx(x, y - 24, 'fx_spark', 0xffd860, D, 0.55);
        if (m) this.tweens.add({ targets: m, x: x + Math.cos(a) * 40, y: y - 24 + Math.sin(a) * 50, angle: 180, alpha: 0, scale: 0.15, duration: 700, delay: i * 30, ease: 'Cubic.easeOut', onComplete: () => this.free(m) });
      }
    } else if (fid === 'jp') {
      // talismans burst outward, then a scatter of petals
      for (let i = 0; i < (lite ? 2 : 5); i++) {
        const o = this.fx(x, y - 22, 'fx_ofuda', 0xffffff, D, 0.6, true, false)!;
        const a = (Math.PI * 2 * i) / 5 + Math.random() * 0.4;
        o.setAngle(Math.random() * 360);
        this.tweens.add({ targets: o, x: x + Math.cos(a) * 38, y: y - 40 + Math.sin(a) * 24 - 16, angle: o.angle + 260, scale: 0.9, alpha: 0, duration: 760, ease: 'Cubic.easeOut', onComplete: () => this.free(o) });
      }
      const seal = this.fx(x, y, 'fx_seal', 0xff4a6a, 7651, 0.1, true)!;
      seal.setScale(0.12, 0.06);
      this.tweens.add({ targets: seal, scaleX: 0.5, scaleY: 0.25, angle: 120, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => this.free(seal) });
      for (let i = 0; i < (lite ? 2 : 6); i++) this.petal(x - 16 + Math.random() * 32, y - 40, D);
    } else {
      // a column of light lifts the fallen, feathers drift down
      const c = this.fx(x, y - 50, 'fx_glow', 0xdff2ff, D, 0.3, true)!;
      c.setScale(0.6, 6);
      this.tweens.add({ targets: c, y: y - 90, scaleX: 1.6, alpha: 0, duration: 620, ease: 'Cubic.easeOut', onComplete: () => this.free(c) });
      const rays = this.fx(x, y - 30, 'fx_rays', 0xfff2c0, D - 1, 0.15, true)!;
      this.tweens.add({ targets: rays, scale: 0.5, angle: 40, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => this.free(rays) });
      for (let i = 0; i < (lite ? 1 : 3); i++) this.feather(x - 20 + i * 20, y - 50 - Math.random() * 20, D);
    }
    const soul = this.fx(x, y - 24, 'fx_spark', mix(tint, 0xffffff, 0.3), D + 2, 0.8, true)!;
    this.tweens.add({ targets: soul, y: y - 90, angle: 270, alpha: 0, scale: 0.2, duration: 800, ease: 'Sine.easeOut', onComplete: () => this.free(soul) });
    if (hero) this.cameras.main.flash(120, 255, 255, 255);
  }

  /** Compare the sim against the last frame and play hits, shots, deaths and collapses. */
  private feedback() {
    const b = this.b, now = this.time.now, attack = this.mode === 'attack';
    const myColor = attack ? FACTIONS[state.faction].color : this.enemyColor;
    const hitB: { x: number; y: number; top: number }[] = [];
    const hitU: { x: number; y: number }[] = [];
    for (const bl of b.buildings) {
      const prev = this.bPrev.get(bl.id), v = this.bViews.get(bl.id);
      this.bPrev.set(bl.id, { hp: bl.hp, cd: bl.cd, x: bl.x, y: bl.y });
      if (!prev || prev.hp <= 0 || !v) continue;
      const cx = Math.floor(bl.x), cy = Math.floor(bl.y);
      const top = proj(cx + 1, cy + 1).y - v.img.displayHeight;
      const mid = proj(cx + 0.5, cy + 0.5);
      const dmg = prev.hp - Math.max(0, bl.hp);
      if (dmg > 0.5) {
        hitB.push({ x: mid.x, y: mid.y, top });
        // rapid hits on one building are summed into a single number every ~220ms
        const acc = this.bDmg.get(bl.id) ?? { t: 0, n: 0 };
        acc.n += dmg;
        if (now - acc.t >= 320) {
          // alternate left/right so a building under heavy fire shows a readable column, not a pile
          acc.k = (acc.k ?? 0) + 1;
          this.popNumber(mid.x + (acc.k % 2 ? -16 : 16), top + 10 - (acc.k % 3) * 8, acc.n, !attack); acc.t = now; acc.n = 0;
        }
        this.bDmg.set(bl.id, acc);
        // a struck building pulses at most every 450 ms, so sustained fire reads as hits, not a strobe
        if (now - (this.bJoltAt.get(bl.id) ?? -1e9) > 450) { this.bJolt.set(bl.id, now + 90); this.bJoltAt.set(bl.id, now); }
        if (!this.bBaseX.has(bl.id)) this.bBaseX.set(bl.id, v.img.x);
      }
      if (bl.hp <= 0) {
        this.wreck(cx, cy, bl.kind, top, attack ? lootOf({ buildings: [bl] } as Battle) : 0);
      } else if (bl.cd > prev.cd + 0.05) {
        // a tower fired this frame: aim at the closest unit that just lost HP
        const from = { x: mid.x, y: top + 14 };
        this.pendingShots.push(from);
      }
    }
    const alive = new Set<number>();
    for (const u of b.units) {
      alive.add(u.id);
      const prev = this.uPrev.get(u.id);
      const hitH = unitHitHeight(u.def);
      this.uPrev.set(u.id, { hp: u.hp, cd: u.cd, x: u.x, y: u.y, hero: !!u.def.hero, flying: !!u.def.flying, fid: prev?.fid ?? factionOf(u.def.id).id, hitH });
      if (!prev) continue;
      const p = proj(u.x, u.y, hitH);
      if (prev.hp - u.hp > 0.5) {
        hitU.push(p);
        // a unit under fire sparks at the body (it never flashes) and shows its summed damage every ~400 ms
        const acc = this.uDmg.get(u.id) ?? { t: -1e9, n: 0 };
        acc.n += prev.hp - u.hp;
        if (now - acc.t >= 400) { this.impact(p.x, p.y, 0xfff4dc, 1); this.popNumber(p.x, p.y - 14, acc.n, attack); acc.t = now; acc.n = 0; }
        this.uDmg.set(u.id, acc);
      }
      if (u.cd > prev.cd + 0.05) {
        // the unit struck: find the building it hit (the closest one that just lost HP)
        const at = proj(u.x, u.y, hitH);
        let best: { x: number; y: number; top: number } | undefined, bd = Infinity;
        for (const h of hitB) { const d = Math.hypot(h.x - at.x, h.y - at.y); if (d < bd) { bd = d; best = h; } }
        if (!best) continue;
        const hy = (best.y + best.top) / 2 + 6;
        if (u.def.range > 2) this.bolt(at.x, at.y - 12, best.x, hy, u.def.hero ? PAL.goldHi : mix(myColor, 0xffffff, 0.45), u.def.hero ? 1.3 : 0.8);
        else { this.slash(best.x + (at.x - best.x) * 0.4, hy, at.x > best.x ? -1 : 1, u.def.hero ? PAL.goldHi : 0xfff4d0); this.impact(best.x, hy, 0xfff0c0, u.def.hero ? 4 : 2); }
      }
    }
    for (const [id, prev] of this.uPrev) {
      if (alive.has(id)) continue;
      this.uPrev.delete(id);
      this.uDmg.delete(id);
      const p = proj(prev.x, prev.y, prev.hitH);
      hitU.push(p);
      this.popNumber(p.x, p.y - 18, prev.hp, attack);
      const v = this.uViews.get(id);
      if (v) this.fallFx(v, myColor, prev.fid, prev.hero);
      if (prev.hero) this.cameras.main.shake(180, 0.006);
    }
    for (const s of this.pendingShots) {
      let best: { x: number; y: number } | undefined, bd = Infinity;
      for (const h of hitU) { const d = Math.hypot(h.x - s.x, h.y - s.y); if (d < bd) { bd = d; best = h; } }
      if (best) this.bolt(s.x, s.y, best.x, best.y, attack ? 0xff8a5c : 0x8fdcff, 1);
    }
    this.pendingShots = [];
    // a short shake on struck buildings (no recolor: the slash/impact sparks mark the hit)
    for (const [id, until] of this.bJolt) {
      const v = this.bViews.get(id), x0 = this.bBaseX.get(id);
      if (!v || x0 === undefined) { this.bJolt.delete(id); continue; }
      const jolt = now < until;
      for (const img of [v.img, v.half]) img.x = jolt ? x0 + Math.sin(now / 16) * 1.5 : x0;
      if (!jolt) this.bJolt.delete(id);
    }
  }

  private pendingShots: { x: number; y: number }[] = [];

  /** Advance loose particles: gravity, spin, a bounce-less stop on the ground and a fade. */
  private stepBits(dt: number) {
    this.bits = this.bits.filter((p) => {
      p.life -= dt;
      if (p.life <= 0 || !p.o.active) {
        if (p.o instanceof Phaser.GameObjects.Image) this.free(p.o); else p.o.destroy();
        return false;
      }
      if (p.o.y < p.floor || p.vy < 0) {
        p.vy += 900 * dt;
        p.o.x += p.vx * dt; p.o.y += p.vy * dt; p.o.angle += p.vr;
      }
      if (p.life < 0.3) p.o.setAlpha(p.life / 0.3);
      return true;
    });
  }

  private leave() {
    // the raid keeps going after the core falls (to finish the rest), so ending it early still keeps that win
    const coreDown = this.b.buildings.some((x) => x.kind === 'core' && x.hp <= 0);
    if (this.expedition && !this.done) { this.b.result = coreDown ? 'win' : 'lose'; this.settle(); }
    else if (this.b.result === 'running' && this.mode === 'attack' && this.b.deployedCount > 0) {
      // ending a raid settles it as it stands (update() shows the result on the next frame)
      this.retreated = true;
      this.b.result = coreDown ? 'win' : 'lose';
      return;
    }
    else if (this.b.result === 'running' && this.mode === 'defend') {
      // walking away from a live defense counts as the hall falling: no bounty, the normal raid loss,
      // and the result screen explains it (update() settles on the next frame)
      this.retreated = true;
      this.b.result = 'win';
      return;
    }
    if (this.mode === 'defend' && !this.done) return;
    // left before sending anyone: the whole trained army is paid back
    if (!this.done && this.b.pool) { refund(this.save, this.b.pool); this.b.pool = null; this.save.raidPool = null; writeSave(this.save); }
    this.scene.start(this.expedition ? 'expedition' : 'base');
  }

  private settle() {
    if (this.done) return '';
    this.done = true;
    let text = '';
    if (this.expedition) {
      text = finishEncounter(this.save, this.b);
    } else if (this.mode === 'attack') {
      if (this.b.result === 'win') {
        const loot = lootOf(this.b);
        this.save.stone += loot;
        this.save.wins++;
        this.save.opponent++;
        text = `缴获 ${loot} 灵石\n${expeditionReward(this.save)}`;
      } else {
        const razed = this.b.buildings.filter((x) => x.kind !== 'wall' && x.hp <= 0).length;
        text = `未能攻破大殿${razed ? ` · 已摧毁 ${razed} 座建筑` : ''}\n提示：${razed ? '重装兵在前吸引火力，英雄随后出阵' : '把兵种集中投放在一侧，先拆外围建筑'}`;
      }
      // troops trained for this raid but never sent in are paid back
      const back = this.b.pool ? refund(this.save, this.b.pool) : 0;
      this.save.raidPool = null;
      if (back > 0) text += `\n未出战兵力返还 ${back} 灵石`;
    } else {
      const fell = this.b.result === 'win';
      const d = applyRaid(this.save, fell);
      text = !fell ? `守城赏金 ${d} 灵石`
        : this.retreated ? `主动撤退视同失守 · 损失 ${-d} 灵石\n提示：守满时间或击退全部来袭才有赏金`
        : `损失 ${-d} 灵石\n提示：在大殿周围补灵塔与符墙，再升级灵塔`;
    }
    writeSave(this.save);
    return text;
  }

  /** 0-3 stars: attack scores 50% destroyed / core down / all down; defense scores what is still standing. */
  private stars(good: boolean) {
    const core = this.b.buildings.find((x) => x.kind === 'core');
    const pct = destructionOf(this.b); // walls are not counted
    if (this.mode === 'attack') return { n: (pct >= 0.5 ? 1 : 0) + (core && core.hp <= 0 ? 1 : 0) + (pct >= 1 ? 1 : 0), pct };
    const kept = 1 - pct;
    return { n: good ? (kept >= 0.5 ? 1 : 0) + (core && core.hp > 0 ? 1 : 0) + (kept >= 1 ? 1 : 0) : 0, pct: kept };
  }

  /** Five-point star with a gold rim; dim when not earned. */
  private star(x: number, y: number, r: number, lit: boolean, depth: number) {
    const pts = (rr: number) => Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? rr * 0.45 : rr;
      return new Phaser.Math.Vector2(Math.cos(a) * k, Math.sin(a) * k);
    });
    const g = this.add.graphics({ x, y }).setDepth(depth);
    g.fillStyle(0x000000, 0.35).fillPoints(pts(r).map((p) => p.clone().add(new Phaser.Math.Vector2(0, 3))), true);
    g.fillStyle(lit ? PAL.goldDeep : 0x2a2440, 1).fillPoints(pts(r), true);
    g.fillStyle(lit ? PAL.gold : 0x4a4466, 1).fillPoints(pts(r * 0.78), true);
    if (lit) g.fillStyle(0xffffff, 0.45).fillPoints(pts(r * 0.34).map((p) => p.clone().add(new Phaser.Math.Vector2(-r * 0.12, -r * 0.16))), true);
    return g;
  }

  /**
   * Settlement screen: banner drops in with stars, then a reward list (one row per phrase,
   * numbers rolling up), battle stats, and the return button.
   */
  private showResult(text: string, good: boolean, boss = false) {
    const D = 9990, CX = VIEW.w / 2;
    const dim = this.add.rectangle(CX, VIEW.h / 2, VIEW.w, VIEW.h, 0x050814, 1).setAlpha(0).setDepth(D);
    this.tweens.add({ targets: dim, alpha: 0.68, duration: 400 });
    const by = 84;
    if (good) {
      const rays = this.add.image(CX, by, 'fx_rays').setDepth(D + 1).setBlendMode('ADD').setTint(boss ? 0xffc860 : PAL.goldHi).setScale(boss ? 2.8 : 2.2).setAlpha(0);
      this.tweens.add({ targets: rays, alpha: boss ? 0.9 : 0.7, duration: 700, delay: 200 });
      this.tweens.add({ targets: rays, angle: 360, duration: 16000, repeat: -1 });
      confetti(this, D + 2, boss ? 70 : 36);
      this.time.delayedCall(260, () => burst(this, CX, by - 30, D + 6, 30));
      if (boss) this.time.delayedCall(700, () => { burst(this, CX - 160, by + 20, D + 6, 20); burst(this, CX + 160, by + 20, D + 6, 20); });
    }
    const ban = this.add.image(CX, by, good ? 'ui_win' : 'ui_lose').setDepth(D + 5);
    const k = Math.min(340 / ban.width, 168 / ban.height);
    ban.setScale(k * 0.3).setAlpha(0);
    this.tweens.add({ targets: ban, scale: k, alpha: 1, duration: 620, ease: 'Back.easeOut' });
    // the defeat banner is dark cloth, so its title goes light with a dark shadow
    const title = good ? (boss ? '首 领 击 破' : this.mode === 'defend' ? '守 住 了' : '大 捷') : this.mode === 'defend' ? (this.retreated ? '弃 守 撤 退' : '大 殿 失 守') : '败 退';
    // the title sits on the ribbon (the banner's ornament takes the top); the stars hang below the banner
    const head = label(this, CX, by + 4, title, boss ? 24 : 26, good ? '#a3221a' : '#f4f0ff').setOrigin(0.5).setDepth(D + 10).setShadow(0, 2, good ? '#fff6d8' : '#1a1030', good ? 0 : 4, false, true).setAlpha(0);
    this.tweens.add({ targets: head, alpha: 1, duration: 350, delay: 380 });
    this.tweens.add({ targets: head, scale: { from: 1.5, to: 1 }, duration: 420, delay: 380, ease: 'Back.easeOut' });

    const { n, pct } = this.stars(good);
    [-1, 0, 1].forEach((dx, i) => {
      const lit = i < n, sx = CX + dx * 44, sy = by + 62 + (dx ? 0 : -4);
      const st = this.star(sx, sy, dx ? 17 : 21, lit, D + 10).setScale(0);
      this.tweens.add({ targets: st, scale: 1, duration: 300, delay: 620 + i * 220, ease: 'Back.easeOut',
        onStart: () => { if (lit) burst(this, sx, sy, D + 11, 8); } });
    });

    // reward list: one row per phrase; an expedition name such as "扶桑·阴阳寮" keeps its tight dot
    const rows = text.split('\n').flatMap((l) => l.split(' · ')).map((t) => t.trim()).filter((t) => t && !(boss && t === '远征大捷'));
    // long phrases shrink a little, then wrap onto a second line instead of shrinking into unreadable type
    const pw = 440, maxW = pw - 90, py = by + 90;
    const texts = rows.map((t, i) => {
      const tx = outline(label(this, CX - pw / 2 + 64, 0, t, 17, i === 0 ? TXT.gold : TXT.cream).setOrigin(0, 0.5), '#0b1127', 4).setDepth(D + 10);
      if (tx.width > maxW / 0.82) tx.setFontSize(15).setWordWrapWidth(maxW, true).setLineSpacing(2);
      if (tx.width > maxW) tx.setScale(maxW / tx.width);
      return tx;
    });
    // rows shrink a little when there are many, so the card and its button always fit on a landscape phone
    const rowH = rows.length > 3 ? 30 : 34;
    const hs = texts.map((tx) => Math.max(rowH, tx.displayHeight + 12));
    const ph = 22 + hs.reduce((a, b) => a + b, 0) + 30;
    const card = plate(this, CX, py + ph / 2, pw, ph, good).setDepth(D + 4).setAlpha(0);
    let y = py + 9;
    rows.forEach((t, i) => {
      y += hs[i] / 2;
      const tx = texts[i].setY(y);
      this.children.bringToTop(tx);
      this.add.image(CX - pw / 2 + 40, y, rewardIcon(t)).setScale(28 / ICON).setDepth(D + 10);
      const m = /^(.*?)(\d+)(\D*)$/.exec(t);
      if (m && good && hs[i] === rowH) this.time.delayedCall(900 + i * 160, () => countTo(this, tx, 0, +m[2], (v) => `${m[1]}${v}${m[3]}`));
      if (i < rows.length - 1) this.add.rectangle(CX, y + hs[i] / 2, pw - 60, 1, PAL.gold, 0.18).setDepth(D + 10);
      y += hs[i] / 2;
    });
    const used = Math.min(TIME_LIMIT, Math.round(this.b.time));
    const stat = this.mode === 'attack'
      ? `摧毁 ${Math.round(pct * 100)}%  ·  出兵 ${this.b.deployedCount}  ·  用时 ${used}s`
      : `建筑完好 ${Math.round(pct * 100)}%  ·  坚守 ${used}s`;
    label(this, CX, py + ph - 19, stat, 14, TXT.dim).setOrigin(0.5).setDepth(D + 10);
    (this.children.list.slice(this.children.list.indexOf(card)) as Fx[]).forEach((o, i) => {
      const a = o.alpha, y = o.y;
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: a || 1, y: { from: y + 16, to: y }, delay: 700 + i * 25, duration: 280, ease: 'Cubic.easeOut' });
    });
    const ended = this.expedition && this.save.run?.phase === 'finished';
    const back = button(this, CX, Math.min(py + ph + 34, VIEW.h - 30), 240, 48, ended ? '查看远征结算' : this.expedition ? '返回远征路线' : '返回基地', 0xf6c24a, () => this.scene.start(this.expedition ? 'expedition' : 'base'), true);
    back.r.setDepth(D + 10);
    back.r.setVisible(false);
    this.time.delayedCall(1100, () => {
      back.r.setVisible(true);
      this.tweens.add({ targets: [back.art, back.tx], alpha: { from: 0, to: 1 }, duration: 250 });
    });
  }

  update(_t: number, dtMs: number) {
    if (!this.b || !this.hud) return;
    const dt = this.testFrozen ? 0 : Math.min(dtMs / 1000, 0.1) * this.speed;
    for (let left = dt; left > 0; left -= 0.05) step(this.b, Math.min(0.05, left));
    // Defense ends when the wave is spent without the core falling.
    if (this.mode === 'defend' && this.b.result === 'lose') { /* held */ }
    this.paint();
    this.stepBits(Math.min(dtMs / 1000, 0.1));
    if (this.b.result !== 'running' && !this.done) {
      const boss = this.expedition && this.save.run?.node === 'boss';
      const text = this.settle();
      const good = this.mode === 'attack' ? this.b.result === 'win' : this.b.result !== 'win';
      // let the last collapse play out before the scroll drops in
      this.time.delayedCall(this.retreated ? 200 : this.b.result === 'win' ? 1100 : 500, () => this.showResult(text, good, boss && good));
    }
  }

  private paint() {
    const color = this.mode === 'attack' ? FACTIONS[state.faction].color : this.enemyColor;
    this.feedback();
    // Buildings are sprites and units are small graphics; both carry a depth of x+y so the engine sorts them.
    // walls re-join over the gaps as their neighbours fall
    const standing = this.b.buildings.filter((q) => q.hp > 0);
    const cell = (q: { x: number; y: number }) => [Math.floor(q.x), Math.floor(q.y)];
    for (const bl of this.b.buildings) {
      const cx = Math.floor(bl.x), cy = Math.floor(bl.y);
      let v = this.bViews.get(bl.id);
      if (bl.hp <= 0) { if (v) { destroyBuildingView(v); this.bViews.delete(bl.id); } continue; }
      const face = facingOf(standing, bl, cell);
      if (!v) { const own = this.save.layout.find(b => b.x === cx && b.y === cy);
        const skin = this.mode === 'defend' ? FACTIONS[own?.faction ?? state.faction].id : this.skin;
        v = createBuildingView(this, skin, bl.kind, cx, cy, face); this.bViews.set(bl.id, v); }
      else setFacing(this, v, face);
      paintOverlay(v, cx, cy, bl.lvl, bl.hp / bl.maxHp);
    }
    const seen = new Set<number>();
    for (const u of this.b.units) {
      seen.add(u.id);
      let uv = this.uViews.get(u.id);
      if (!uv) { uv = createUnitView(this, u.def, u.x); this.uViews.set(u.id, uv); }
      const tgt = u.target === null ? undefined : this.b.buildings.find((x) => x.id === u.target);
      paintUnit(uv, u.def, u.x, u.y, color, u.hp / u.def.hp, u.cd, tgt);
    }
    for (const [id, uv] of this.uViews) if (!seen.has(id)) { destroyUnitView(uv); this.uViews.delete(id); }
    this.fxG.clear();
    for (const f of this.b.fx) strokeRing(this.fxG, f.x, f.y, f.r, f.color, Math.min(1, f.life));
    this.cardDraw.forEach((d, i) => d(i === this.sel));
    this.cardAfford.forEach((d) => d());
    if (this.skillBtn) {
      const ready = !this.b.skillUsed && !!heroAlive(this.b);
      this.skillBtn.setAlpha(ready ? 1 : 0.4);
      this.skillHalo?.setVisible(ready);
    }
    this.speedTx.setText(`x${this.speed}`);
    const left = Math.max(0, Math.ceil(TIME_LIMIT - this.b.time));
    const leftTroops = this.b.pool ? Object.entries(this.b.pool).reduce((n, [id, c]) => n + (troopById(id)?.hero ? 0 : c), 0) : 0;
    this.hud.setText(this.mode !== 'attack' ? `来袭 ${this.b.units.length + this.b.spawns.length} 个` : this.b.pool ? `待命 ${leftTroops} 兵` : `灵气 ${this.b.energy}`);
    this.timeTx.setText(left >= 60 ? `${Math.floor(left / 60)}分钟 ${left % 60}秒` : `${left}秒`);
    const { n, pct } = this.stars(this.mode === 'attack' || this.b.result !== 'lose');
    this.pctTx.setText(`${Math.round(pct * 100)}%`);
    if (n !== this.litStars) {
      this.litStars = n;
      this.pctStars.forEach((s, i) => {
        const x = s.x, y = s.y;
        s.destroy();
        this.pctStars[i] = this.star(x, y, 10, i < n, 6001);
        if (i === n - 1) burst(this, x, y, 6002, 8);
      });
    }
    const warn = left <= 10 && this.b.result === 'running';
    if (warn !== this.timeWarn) { this.timeWarn = warn; this.timeTx.setColor(warn ? TXT.red : '#ffffff'); }
    // last ten seconds: the timer thumps once per second
    if (warn && left !== this.lastLeft) {
      this.tweens.killTweensOf(this.timeTx);
      this.timeTx.setScale(1.35);
      this.tweens.add({ targets: this.timeTx, scale: 1, duration: 320, ease: 'Back.easeOut' });
    }
    this.lastLeft = left;
  }
}
