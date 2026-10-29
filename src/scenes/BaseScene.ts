import Phaser from 'phaser';
import { BUILDINGS, FACTIONS, MAX_LEVEL, upgradeCost, type BuildingKind } from '../data/factions';
import { accrue, avatarChoices, avatarOf, BUILDING_DESC, buildingStats, clearSave, collect, coreLevel, equipSkin, grantSkinAd, loadSave, move, pendingCap, place, remove, setAvatar, setName, turn, upgrade, writeSave, type Save } from '../core/economy';
import { raidPlan } from '../core/army';
import { soulProgress, troopPool } from '../core/summon';
import { button, caption, factionOf, hudText, ICON, MAP_BOUNDS, mapCamera, type MapCamera, splitStage, stageCamera, tileFace, drawCell, drawGround, drawScenery, ensureFx, inGrid, label, outline, pickBuilding, PAL, proj, PY, RES, state, TXT, unproj, VIEW, type Stage } from './common';
import { avatarTex, closeX, nine, plate, titlePlate } from './gameUi';
import { askName } from './nameDialog';
import { wallPath } from '../core/walls';
import { GRID } from '../core/sim';
import { adMiss, showRewarded } from '../core/ads';
import { MAP_SKINS, skinById } from '../data/maps';
import { buildingTex, createBuildingView, destroyBuildingView, facingOf, moveBuildingView, paintOverlay, setBuildingKind, type BuildingView } from './sprites';

const BUILDABLE: BuildingKind[] = ['tower', 'aoe', 'wall', 'mine', 'barracks'];
/** The ghost's ✓ / ✕: a drawn face and its separate top-level hit circle, moved together. */
type GhostBtn = { c: Phaser.GameObjects.Container; hit: Phaser.GameObjects.Arc };
type Counter = 'stone' | 'tokens';
type Cell = { x: number; y: number };

const hud = (s: Phaser.Scene, x: number, y: number, t: string, size: number, color = '#ffffff') => hudText(s, x, y, t, size, color).setDepth(120);

/** The world rect the camera fits to the screen: the whole island with its rim tips, back props and cliff. */
const ISLAND = { x: -60, y: 10, w: 920, h: 550 };

/**
 * Home island. The map fills the screen and the HUD floats over its edges: resources top-right, the hall badge
 * top-left, shortcuts down the left side, attack bottom-left, build bottom-right. Buildings are tapped to select
 * them (upgrade / turn / remove appear at the bottom); new ones come from the build menu, then a tap places them.
 * The island lives in the world camera; everything at depth 100 and above is HUD, laid out in VIEW units.
 */
export class BaseScene extends Phaser.Scene {
  private save!: Save;
  /** Kind being placed from the build menu; null while browsing. */
  private tool: BuildingKind | null = null;
  private sel: Cell | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private stoneTx!: Phaser.GameObjects.Text;
  private pendTx!: Phaser.GameObjects.Text;
  private tokenTx!: Phaser.GameObjects.Text;
  private toastTx!: Phaser.GameObjects.Text;
  private actions: Phaser.GameObjects.Container | null = null;
  private placeBar: Phaser.GameObjects.Container | null = null;
  private views = new Map<string, BuildingView>();
  private hover: Cell | null = null;
  /** Last cell of a wall drag in progress (pointer held after placing a wall), with the walls laid so far. */
  private drag: { x: number; y: number; laid: number } | null = null;
  /** A locked map skin shown on trial (not saved); a panel (maps, build menu) is open while `modal`. */
  private preview: string | undefined;
  private modal = false;
  private shown: Record<Counter, number> = { stone: -1, tokens: -1 }; // numbers currently on screen
  private tgt: Record<Counter, number> = { stone: -1, tokens: -1 }; // numbers they are rolling toward
  private rolls: Partial<Record<Counter, Phaser.Tweens.Tween>> = {};
  private stage!: Stage;
  private cam!: MapCamera;
  /** A new building waiting to be put down: a see-through copy the player drags, with ✓ / ✗ floating above it. */
  private ghost: { kind: BuildingKind; x: number; y: number; view: BuildingView; ok: GhostBtn; no: GhostBtn } | null = null;
  /** What the finger is carrying: the ghost, or a placed building on its way from one cell to another. */
  private carry: 'ghost' | { from: Cell; at: Cell } | null = null;
  /** Build mode: the build tray sits along the bottom and buildings can be moved; outside it a tap only selects. */
  private editing = false;
  private tray: Phaser.GameObjects.GameObject[] = [];
  private trayTop = 0;
  private nav: Phaser.GameObjects.Components.Visible[] = [];

  constructor() { super('base'); }

  create(data: { preview?: string; maps?: boolean; profile?: boolean } = {}) {
    // Phaser keeps the last start data for a bare restart(); consume it, or 关闭 / 退出 / a screen rotation would
    // re-open the panel (or the map preview) that the last restart asked for
    this.sys.settings.data = {};
    this.save = loadSave();
    this.preview = data.preview && !this.save.skins.includes(data.preview) ? data.preview : undefined;
    this.modal = false;
    this.tool = null;
    this.sel = null;
    this.ghost = null;
    this.carry = null;
    this.actions = this.placeBar = null;
    this.editing = false;
    this.tray = [];
    state.faction = this.save.civilization ?? 0;
    this.views.clear();
    this.shown = { stone: -1, tokens: -1 };
    this.tgt = { stone: -1, tokens: -1 };
    this.rolls = {};
    ensureFx(this);
    stageCamera(this);
    this.stage = splitStage(this, ISLAND, (d) => d >= 100);
    if (!data.profile) this.cameras.main.fadeIn(300); // a settings change re-opens the panel in place
    this.g = this.add.graphics();
    drawScenery(this, this.preview ?? this.save.mapSkin, MAP_BOUNDS); // the sky covers all the camera can reach
    // registered before the scene's own handlers, so a press is known to be a drag or pinch by its pointerup
    this.cam = mapCamera(this, this.stage, MAP_BOUNDS, { enabled: () => !this.modal, pan: () => !this.drag && !this.carry });
    this.buildHud();
    this.toastTx = hud(this, VIEW.w / 2, 100, '', 18).setOrigin(0.5).setDepth(700).setAlpha(0); // above the panels
    if (this.preview) this.previewBar(this.preview);
    if (data.maps) this.openMaps();
    else if (data.profile) this.openProfile();

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.modal) return;
      if (this.drag && p.isDown) this.extendWall(p);
      if (this.carry && p.isDown) this.carryTo(this.groundAt(p, true));
      this.hover = this.cellAt(p);
      this.refresh();
    });
    // A press on the ghost picks it up, and in build mode so does a press on any building; walls are painted from
    // the moment the finger lands; anything else waits for a tap, so a drag pans the map.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.drag = null;
      this.carry = null;
      if (this.modal || over.length) return; // a HUD button took the press
      const g = this.groundAt(p), c = this.cellAt(p);
      if (this.ghost) {
        const w = this.stage.toWorld(p);
        if ((g && g.x === this.ghost.x && g.y === this.ghost.y) || this.opaqueAt(this.ghost.view, w.x, w.y)) this.carry = 'ghost';
        return;
      }
      // build mode: a press on a building picks it up; dragging moves it, releasing in place is a tap
      if (this.editing && !this.tool && c && this.at(c.x, c.y)) { this.carry = { from: { ...c }, at: { ...c } }; return; }
      if (this.tool === 'wall' && c && !this.at(c.x, c.y)) this.placeAt(c);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const tap = this.cam.tap(p), painted = !!this.drag, carry = this.carry;
      this.drag = null;
      this.carry = null;
      if (painted) this.drawTray(); // walls were laid: the tray's counts and costs changed
      if (carry === 'ghost') return;
      if (carry && (carry.at.x !== carry.from.x || carry.at.y !== carry.from.y)) { this.drop(carry.from, carry.at); return; }
      if (!tap || painted || this.modal || over.length) return;
      if (this.ghost) { const g = this.groundAt(p); if (g) this.carryGhost(g); return; } // tap a cell: the ghost jumps there
      const c = this.cellAt(p);
      const same = !!c && !!this.sel && this.sel.x === c.x && this.sel.y === c.y;
      if (this.tool) this.placeAt(c);
      else if (!this.editing) this.select(c && this.at(c.x, c.y) && !same ? c : null);
      // build mode: tap a building to pick it (again to put it back), then tap free ground to move it there
      else if (c && this.at(c.x, c.y)) { this.select(same ? null : c); if (!same) this.say(`拖动${BUILDINGS[this.at(c.x, c.y)!.kind].name}或点击空地，移到新位置`); }
      else if (c && this.sel) this.drop(this.sel, c);
      else this.select(null);
    });
    this.time.addEvent({ delay: 500, loop: true, callback: () => { accrue(this.save, Date.now()); writeSave(this.save); this.refresh(); } });
    this.refresh();
  }

  private at(x: number, y: number) {
    return this.save.layout.find((q) => q.x === x && q.y === y);
  }

  /** The ground cell under the pointer (sprites ignored); `clampIn` keeps a dragged building on the grid's edge. */
  private groundAt(p: Phaser.Input.Pointer, clampIn = false): Cell | null {
    const w = this.stage.toWorld(p), g = unproj(w.x, w.y);
    if (clampIn) return { x: Math.max(0, Math.min(GRID - 1, Math.floor(g.x))), y: Math.max(0, Math.min(GRID - 1, Math.floor(g.y))) };
    return inGrid(g) ? { x: Math.floor(g.x), y: Math.floor(g.y) } : null;
  }

  /** The carried building follows the finger, cell by cell. */
  private carryTo(c: Cell | null) {
    if (!c || !this.carry) return;
    if (this.carry === 'ghost') { this.carryGhost(c); return; }
    const { from, at } = this.carry;
    if (c.x === at.x && c.y === at.y) return;
    this.carry.at = c;
    const v = this.views.get(`${from.x},${from.y}`);
    if (v) { moveBuildingView(v, c.x, c.y); this.liftGhost(v); }
    this.sel = c;
  }

  /** Let go of a carried building: it moves if the cell is free, otherwise it springs back. */
  private drop(from: Cell, to: Cell) {
    const v = this.views.get(`${from.x},${from.y}`);
    const err = move(this.save, from.x, from.y, to.x, to.y);
    if (err) {
      if (v) moveBuildingView(v, from.x, from.y);
      this.say(err);
      this.select(from);
      return;
    }
    writeSave(this.save);
    if (v) { moveBuildingView(v, to.x, to.y); this.views.delete(`${from.x},${from.y}`); this.views.set(`${to.x},${to.y}`, v); }
    this.select(to);
    if (from.x !== to.x || from.y !== to.y) this.say('已移动');
  }

  /** A card from the build menu: a see-through building appears on the free cell nearest the middle of the view. */
  private startGhost(kind: BuildingKind) {
    this.endGhost();
    const cam = this.stage.world;
    // the middle of the map the player can see: above the build tray when it is open
    const shown = this.editing ? this.trayTop * RES : cam.height;
    const mid = unproj(cam.scrollX + cam.width / 2 / cam.zoom, cam.scrollY + shown / 2 / cam.zoom);
    // the free cell nearest the middle, preferring one with nothing around it so the copy is not hidden
    let best: Cell | null = null, bd = Infinity;
    for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) {
      if (this.at(x, y)) continue;
      const crowd = this.save.layout.some((b) => Math.abs(b.x - x) <= 2 && Math.abs(b.y - y) <= 2);
      const d = Math.hypot(x + 0.5 - mid.x, y + 0.5 - mid.y) + (crowd ? 6 : 0);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) { this.say('没有空地了'); return; }
    const view = createBuildingView(this, FACTIONS[this.save.buildFaction].id, kind, best.x, best.y, 0);
    for (const o of [view.img, view.half]) o.setAlpha(0.8);
    this.liftGhost(view);
    const mk = (fill: number, glyph: string, on: () => void): GhostBtn => {
      const c = this.add.container(0, 0).setDepth(150);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.3).fillCircle(0, 3, 21);
      g.fillStyle(fill, 1).fillCircle(0, 0, 20).lineStyle(3, PAL.goldHi, 1).strokeCircle(0, 0, 20);
      c.add([g, outline(label(this, 0, -1, glyph, 22, '#ffffff'), '#1b2a50', 3).setOrigin(0.5)]);
      // the hit area is a top-level object, not a container child: only top-level objects are routed to the HUD
      // camera, and a child would also be hit-tested by the map camera at the wrong spot
      const hit = this.add.circle(0, 0, 26, 0, 0).setDepth(151).setInteractive({ useHandCursor: true }).on('pointerdown', on);
      return { c, hit };
    };
    this.ghost = { kind, ...best, view, ok: mk(0x3aa84e, '✓', () => this.confirmGhost()), no: mk(0xd0503c, '✕', () => this.endGhost()) };
    this.say(`拖动${BUILDINGS[kind].name}到空地，点 ✓ 建造`);
    this.update();
    this.refresh();
  }

  private carryGhost(c: Cell) {
    const gh = this.ghost;
    if (!gh || (c.x === gh.x && c.y === gh.y)) return;
    gh.x = c.x;
    gh.y = c.y;
    moveBuildingView(gh.view, c.x, c.y);
    this.liftGhost(gh.view);
    this.refresh();
  }

  /** The copy in the player's hand draws over every placed building (still in the world layer, below 100). */
  private liftGhost(v: BuildingView) {
    v.img.setDepth(90);
    v.half.setDepth(90);
    v.over.setDepth(90.1);
  }

  private confirmGhost() {
    const gh = this.ghost;
    if (!gh) return;
    const err = place(this.save, gh.kind, gh.x, gh.y);
    if (err) { this.say(err); return; }
    writeSave(this.save);
    this.say(`${BUILDINGS[gh.kind].name} 建造完成`);
    this.endGhost();
    this.drawTray();
  }

  private endGhost() {
    const gh = this.ghost;
    if (!gh) return;
    destroyBuildingView(gh.view);
    for (const b of [gh.ok, gh.no]) { b.c.destroy(); b.hit.destroy(); }
    this.ghost = null;
    this.carry = null;
    this.refresh();
  }

  /** Keep the ghost's ✓ / ✗ floating just above it as the map pans and zooms. */
  update() {
    const gh = this.ghost;
    if (!gh) return;
    const cam = this.stage.world, top = proj(gh.x + 0.5, gh.y + 0.5);
    const sx = ((top.x - cam.scrollX) * cam.zoom) / RES, sy = ((top.y - cam.scrollY) * cam.zoom) / RES;
    const lift = (gh.kind === 'core' ? 90 : 62) * (cam.zoom / RES);
    const y = Math.max(78, Math.min((this.editing ? this.trayTop - 4 : VIEW.h) - 26, sy - lift));
    const put = (b: GhostBtn, x: number) => { b.c.setPosition(x, y); b.hit.setPosition(x, y); };
    put(gh.ok, Math.max(VIEW.l + 30, Math.min(VIEW.r - 30, sx + 30)));
    put(gh.no, Math.max(VIEW.l + 30, Math.min(VIEW.r - 30, sx - 30)));
  }

  /** Place mode: put the chosen kind on an empty cell. Walls stay in place mode and can be dragged. */
  private placeAt(c: Cell | null) {
    const kind = this.tool!;
    if (!c) return;
    const err = place(this.save, kind, c.x, c.y);
    if (err) { this.say(err); return; }
    writeSave(this.save);
    if (kind === 'wall') { this.drag = { x: c.x, y: c.y, laid: 1 }; this.say('按住拖动可连续铺设符墙'); }
    else { this.say(`${BUILDINGS[kind].name} 建造完成`); this.setTool(null); this.drawTray(); }
    this.refresh();
  }

  /** The cell under the pointer: a building's silhouette wins over the ground behind it.
   *  Sprites (the hall is 120px wide on a one-cell footprint) reach far past their fixed pick height, so we test
   *  the real opaque pixels first, frontmost sprite first. A ground cell in front of the sprite still wins in
   *  place mode, so empty cells beside a big building stay placeable. */
  private cellAt(p: Phaser.Input.Pointer): Cell | null {
    const { x: sx, y: sy } = this.stage.toWorld(p); // world coordinates through the island camera
    if (sy >= PY || p.y / this.stage.ui.zoom < 52) return null; // below the island, or under the top HUD band
    const g0 = unproj(sx, sy);
    const ground = inGrid(g0) ? { x: Math.floor(g0.x), y: Math.floor(g0.y) } : null;
    const below = ground && this.at(ground.x, ground.y);
    const hits = this.save.layout.filter((b) => this.opaqueAt(this.views.get(`${b.x},${b.y}`), sx, sy))
      .sort((a, b) => b.x + b.y - (a.x + a.y));
    // a building hidden behind a bigger one is still reached by tapping its own floor
    if (below && hits.includes(below)) return { x: below.x, y: below.y };
    const top = hits[0];
    if (top && (!ground || below || !this.tool || top.x + top.y >= ground.x + ground.y)) return { x: top.x, y: top.y };
    const b = pickBuilding(this.save.layout, sx, sy);
    if (b) return { x: b.x, y: b.y };
    return ground;
  }

  /**
   * Lay walls from the last drag cell to the ground cell under the pointer. Cells that already hold a building are
   * stepped over; running out of stone or hitting the wall limit ends the drag. A wall laid this way faces along the
   * drag, so even the first one of a run already points the right way.
   */
  private extendWall(p: Phaser.Input.Pointer) {
    const d = this.drag!;
    const w = this.stage.toWorld(p);
    if (w.y >= PY) return;
    const g = unproj(w.x, w.y);
    if (!inGrid(g)) return;
    const to = { x: Math.floor(g.x), y: Math.floor(g.y) };
    for (const c of wallPath(d, to)) {
      const err = place(this.save, 'wall', c.x, c.y);
      if (err && this.at(c.x, c.y)) { Object.assign(d, c); continue; }
      if (err) { this.say(d.laid > 1 ? `已铺设 ${d.laid} 段符墙 · ${err}` : err); this.drag = null; break; }
      const dir = c.axis === 'x' ? 1 : 0;
      this.at(c.x, c.y)!.dir = dir;
      const prev = this.at(d.x, d.y);
      if (prev?.kind === 'wall' && d.laid === 1) prev.dir = dir; // the run's first wall turns with the drag too
      Object.assign(d, c);
      d.laid++;
      this.say(`已铺设 ${d.laid} 段符墙`);
    }
    writeSave(this.save);
  }

  /** True when the screen point lands on a visible (alpha > 60) pixel of the building sprite. */
  private opaqueAt(v: BuildingView | undefined, sx: number, sy: number) {
    if (!v) return false;
    const img = v.img;
    const lx = Math.floor((sx - img.x) / img.scaleX + img.width * img.originX);
    const ly = Math.floor((sy - img.y) / img.scaleY + img.height * img.originY);
    if (lx < 0 || ly < 0 || lx >= img.width || ly >= img.height) return false;
    return (this.textures.getPixelAlpha(lx, ly, img.texture.key, img.frame.name) ?? 0) > 60;
  }

  private go(mode: 'attack' | 'defend') {
    accrue(this.save, Date.now());
    writeSave(this.save);
    // a raid trains the 军营 composition on the spot: with nothing set up, or not enough 灵石, open the camp instead
    const plan = mode === 'attack' ? raidPlan(this.save) : null;
    if (plan?.error) { this.scene.start('train', { notice: plan.error }); return; }
    this.scene.start('battle', { mode });
  }

  /**
   * Square HUD button: a gold-rimmed lacquer tile with an icon and a label tucked into its lower edge; grows on
   * hover, squashes on press. `face` picks the tile colour (the attack button is amber, the rest azure).
   */
  private tile(x: number, y: number, size: number, icon: string, cap: string, on: () => void, face: number = PAL.slateHi) {
    const c = this.add.container(x, y).setDepth(110);
    const g = tileFace(this, 0, 0, size, face);
    const img = this.add.image(0, -size * 0.1, `ui_${icon}`).setScale((size * 0.72) / ICON);
    const tx = hud(this, 0, size / 2 - 11, cap, Math.max(12, Math.round(size * 0.2))).setOrigin(0.5);
    c.add([g, img, tx]);
    const hit = this.add.rectangle(x, y, Math.max(size, 64), Math.max(size, 64), 0, 0).setDepth(111).setInteractive({ useHandCursor: true });
    const to = (k: number) => this.tweens.add({ targets: c, scale: k, duration: 90, ease: 'Sine.easeOut' });
    hit.on('pointerover', () => to(1.06)).on('pointerout', () => to(1)).on('pointerdown', () => { to(0.92); on(); }).on('pointerup', () => to(1.06));
    return c;
  }

  /** A short "+N" that floats up from a point and fades. */
  private floatText(x: number, y: number, t: string) {
    const tx = hud(this, x, y, t, 20, TXT.gold).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: tx, y: y - 36, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => tx.destroy() });
  }

  /** Rolls a counter toward its new value so changes read as motion. */
  private roll(key: Counter, tx: Phaser.GameObjects.Text, to: number) {
    if (this.tgt[key] === to) return;
    const from = this.shown[key];
    this.tgt[key] = to;
    this.rolls[key]?.stop();
    this.rolls[key] = undefined;
    if (from < 0) { this.shown[key] = to; tx.setText(`${to}`); return; }
    this.rolls[key] = this.tweens.addCounter({
      from, to, duration: 500, ease: 'Cubic.easeOut',
      onUpdate: (tw) => { const v = Math.round(tw.getValue() ?? to); this.shown[key] = v; tx.setText(`${v}`); },
      onComplete: () => { this.shown[key] = to; tx.setText(`${to}`); this.rolls[key] = undefined; },
    });
  }

  /** A resource bar: dark translucent track with a coloured fill, the number right-aligned, the icon on the end. */
  private bar(y: number, icon: string, fill: number) {
    const x = VIEW.r - 196, w = 170, h = 24;
    const g = this.add.graphics().setDepth(110);
    g.fillStyle(0x0a0f1e, 0.55).fillRoundedRect(x, y - h / 2, w, h, h / 2);
    g.fillStyle(fill, 1).fillRoundedRect(x + 3, y - h / 2 + 3, w - 6, h - 6, (h - 6) / 2);
    g.fillStyle(0xffffff, 0.28).fillRoundedRect(x + 8, y - h / 2 + 4, w - 22, 5, 2.5);
    this.add.image(x + w + 4, y, `ui_${icon}`).setScale(40 / ICON).setDepth(111);
    return hud(this, x + w - 20, y, '', 17).setOrigin(1, 0.5).setDepth(112);
  }

  private buildHud() {
    // top-left: the player's avatar with the hall's level on its corner, 道号 and civilization beside it;
    // tapping any of it opens 个人设置
    const f = FACTIONS[this.save.civilization ?? 0], L = VIEW.l, R = VIEW.r, B = VIEW.h;
    const av = this.avatar(L + 32, 33, 46, 110);
    const lv = this.add.graphics().setDepth(111.5);
    lv.fillStyle(0x2c6fd8, 1).fillCircle(L + 50, 51, 10).lineStyle(2, 0xffffff, 0.95).strokeCircle(L + 50, 51, 10);
    hud(this, L + 50, 51, `${coreLevel(this.save)}`, 12).setOrigin(0.5).setDepth(112);
    const name = hud(this, L + 66, 22, this.save.profile.name || '道友', 16).setOrigin(0, 0.5);
    hud(this, L + 66, 44, `${f.name} · 胜场 ${this.save.wins}`, 13, TXT.gold).setOrigin(0, 0.5);
    const me = this.add.rectangle(L + 4, 2, Math.max(150, name.width + 70), 60, 0, 0).setOrigin(0).setDepth(113).setInteractive({ useHandCursor: true });
    me.on('pointerover', () => av.forEach((o) => o.setScale(o.getData('k') * 1.06)))
      .on('pointerout', () => av.forEach((o) => o.setScale(o.getData('k'))))
      .on('pointerdown', () => this.openProfile());

    // top-right: resources; tapping the stone bar collects what the mines made
    this.stoneTx = this.bar(26, 'icon_stone', 0x3cc77a);
    this.tokenTx = this.bar(60, 'icon_token', 0xf2b632);
    const collectHit = this.add.rectangle(R - 110, 26, 200, 30, 0, 0).setDepth(113).setInteractive({ useHandCursor: true });
    collectHit.on('pointerdown', () => {
      const got = collect(this.save);
      writeSave(this.save);
      this.say(got > 0 ? `收取 ${got} 灵石` : '灵石矿还没有产出');
      if (got > 0) this.floatText(R - 90, 46, `+${got}`);
      this.refresh();
    });
    this.pendTx = hud(this, R - 26, 86, '', 13, '#9cff9c').setOrigin(1, 0.5);
    this.tweens.add({ targets: this.pendTx, scale: 1.1, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // left side: shortcuts in a column, spaced to fit between the top bar and the attack button
    const navFrom = this.children.list.length;
    const col: [string, string, () => void][] = [
      ['icon_camp', '军营', () => { writeSave(this.save); this.scene.start('train'); }],
      ['skill', '英灵', () => { writeSave(this.save); this.scene.start('progress'); }],
      ['icon_token', '召唤', () => { writeSave(this.save); this.scene.start('summon'); }],
      ['flag', '演习', () => this.go('defend')],
    ];
    const top = 104, step = Math.min(66, (B - top - 96 - 30) / (col.length - 1)), size = Math.min(54, step - 6);
    col.forEach(([icon, cap, on], i) => this.tile(L + 34, top + i * step, size, icon, cap, on));
    // a ten-pull is ready: a dot on the summon shortcut
    if (this.save.tokens >= 10) {
      const si = col.findIndex(([, cap]) => cap === '召唤');
      const dot = this.add.circle(L + 34 + size * 0.42, top + si * step - size * 0.42, 8, PAL.ruby, 1).setStrokeStyle(2, 0xffffff, 1).setDepth(115);
      this.tweens.add({ targets: dot, scale: 1.25, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // bottom-left: attack, the main action, with expedition beside it
    const halo = this.add.image(L + 54, B - 52, 'fx_glow').setTint(0xffb040).setBlendMode('ADD').setScale(4.4).setAlpha(0.35).setDepth(109);
    this.tweens.add({ targets: halo, alpha: 0.75, scale: 5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tile(L + 54, B - 52, 82, 'icon_sword', '进攻', () => this.go('attack'), 0xf0a030);
    const run = this.save.run && this.save.run.phase !== 'finished';
    this.tile(L + 140, B - 46, 66, 'flag', run ? '继续远征' : '远征', () => { writeSave(this.save); this.scene.start('expedition'); }, 0xd8604a);
    if (run) {
      const dot = this.add.circle(L + 166, B - 76, 9, PAL.ruby, 1).setStrokeStyle(2, 0xffffff, 1).setDepth(115);
      hud(this, dot.x, dot.y, '!', 12).setOrigin(0.5).setDepth(116);
      this.tweens.add({ targets: dot, scale: 1.25, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    // bottom-right: the build menu
    this.tile(R - 54, B - 52, 82, 'icon_remove', '建造', () => this.enterBuild(), 0x48b860);
    // the shortcuts, attack and build tiles with their dots and halo: hidden while the build tray is open
    this.nav = this.children.list.slice(navFrom) as unknown as Phaser.GameObjects.Components.Visible[];
  }

  /**
   * Enter build mode: the build tray opens along the bottom and buildings can be moved (drag one, or tap it and
   * then tap free ground). `pick` starts with that building already picked up.
   */
  private enterBuild(pick: Cell | null = null) {
    if (this.modal) return;
    this.select(null);
    this.editing = true;
    this.drawTray();
    this.say('选卡片建造新建筑 · 拖动或点选已有建筑可移动');
    if (pick) this.select(pick);
  }

  private exitBuild() {
    if (!this.editing) return;
    this.endGhost();
    this.setTool(null);
    this.editing = false;
    this.drawTray();
    this.select(null);
  }

  /**
   * The build tray: a strip of cards along the bottom, one per buildable kind, shrinking when the row would not
   * fit. It is not modal, so the map above it still pans and its buildings can still be moved. Redrawn after each
   * build so counts and costs stay current; with build mode off it is just torn down.
   */
  private drawTray() {
    this.tray.forEach((o) => o.destroy());
    this.tray = [];
    this.nav.forEach((o) => o.setVisible(!this.editing));
    if (!this.editing) return;
    const n = BUILDABLE.length, D = 130, H = 168, top = VIEW.h - H - 4, pw = Math.min(VIEW.r - VIEW.l - 16, 132 * n + 60);
    const step = Math.min(132, (pw - 30) / n), k = Math.min(0.8, (step - 10) / 128), CX = VIEW.w / 2;
    this.trayTop = top;
    const layer = this.tray;
    // swallows taps on the tray, so they neither reach the map nor the HUD tiles it covers
    layer.push(this.add.rectangle(CX, top + H / 2, pw, H, 0, 0).setDepth(D).setInteractive());
    layer.push(nine(this, 'panel', CX, top + H / 2, pw, H, 22, 60).setDepth(D + 1));
    layer.push(hud(this, CX - pw / 2 + 22, top + 22, `建造模式 · ${FACTIONS[this.save.buildFaction].name}`, 17).setOrigin(0, 0.5).setDepth(D + 2));
    layer.push(hud(this, CX, top + 22, '拖动或点选建筑可移动位置', 13, TXT.cream).setOrigin(0.5).setDepth(D + 2));
    const fid = FACTIONS[this.save.buildFaction].id;
    BUILDABLE.forEach((kind, i) => {
      const def = BUILDINGS[kind], built = this.save.layout.filter((b) => b.kind === kind).length;
      const cx = CX + (i - (n - 1) / 2) * step, cy = top + 44 + 75 * k, full = built >= def.limit, poor = this.save.stone < def.cost;
      layer.push(tileFace(this, cx, cy, 128 * k, full ? 0x7a8399 : PAL.slateHi, 150 * k).setDepth(D + 2));
      const pic = this.add.image(cx, cy - 12 * k, buildingTex(fid, kind)).setDepth(D + 3);
      pic.setScale(Math.min((96 * k) / pic.width, (92 * k) / pic.height));
      layer.push(pic);
      layer.push(hud(this, cx, cy - 58 * k, def.name, 14).setOrigin(0.5).setDepth(D + 4));
      // cost and count sit on the face, clear of the gold cloud corners
      layer.push(hud(this, cx + 44 * k, cy + 50 * k, `${built}/${def.limit}`, 12, TXT.cream).setOrigin(1, 0.5).setDepth(D + 4));
      layer.push(this.add.image(cx - 34 * k, cy + 50 * k, 'ui_icon_stone').setScale(20 / ICON).setDepth(D + 4));
      layer.push(hud(this, cx - 22 * k, cy + 50 * k, `${def.cost}`, 14, poor ? '#ff8a7a' : '#ffffff').setOrigin(0, 0.5).setDepth(D + 4));
      const hit = this.add.rectangle(cx, cy, 128 * k, 150 * k, 0, 0).setDepth(D + 5).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        // checked live: stone keeps flowing in while the tray is open
        if (this.save.layout.filter((b) => b.kind === kind).length >= def.limit) { this.say(`${def.name}已达上限 ${def.limit}`); return; }
        if (this.save.stone < def.cost) { this.say(`灵石不足，需要 ${def.cost}`); return; }
        this.select(null);
        // walls are painted along a drag; everything else is dragged into place as a see-through copy
        if (kind === 'wall') { this.endGhost(); this.setTool(kind); }
        else { this.setTool(null); this.startGhost(kind); }
      });
      layer.push(hit);
    });
    const done = button(this, CX + pw / 2 - 54, top + 24, 84, 32, '完成', 0x48b860, () => this.exitBuild());
    done.r.setDepth(D + 6); done.tx.setFontSize(14);
    layer.push(done.r);
  }

  /** Enter or leave place mode; a strip at the top names what is being placed. */
  private setTool(k: BuildingKind | null) {
    this.tool = k;
    this.placeBar?.destroy();
    this.placeBar = null;
    if (!k) { this.refresh(); return; }
    const c = this.add.container(VIEW.w / 2, 92).setDepth(150);
    c.add([nine(this, 'money', 0, 0, 340, 36, 16, 55), hud(this, -152, 0, k === 'wall' ? '放置符墙 · 按住拖动连续铺设' : `放置${BUILDINGS[k].name} · 点击空地`, 15).setOrigin(0, 0.5)]);
    const done = button(this, VIEW.w / 2 + 128, 92, 80, 32, '完成', 0x48b860, () => this.setTool(null));
    done.r.setDepth(151); done.tx.setFontSize(14);
    c.once('destroy', () => done.r.destroy());
    this.placeBar = c;
    this.refresh();
  }

  /**
   * Select a building: its actions appear at the bottom centre. null clears the selection. In build mode the
   * selection is the building picked up for moving, so only its cell is marked.
   */
  private select(c: Cell | null) {
    this.sel = c;
    this.actions?.destroy();
    this.actions = null;
    const b = c && this.at(c.x, c.y);
    if (!b || this.editing) { this.refresh(); return; }
    const by = VIEW.h - 56, box = this.add.container(VIEW.w / 2, by).setDepth(140);
    box.add(hud(this, 0, -62, `${BUILDINGS[b.kind].name} · ${b.lvl} 级`, 18).setOrigin(0.5));
    box.add(hud(this, 0, -84, '点「建造」进入建造模式，可移动建筑位置', 12, TXT.cream).setOrigin(0.5).setAlpha(0.85));
    const acts: { cap: string; sub: string; face: number; icon: string; run: () => string | null; open?: () => void }[] = [];
    acts.push({ cap: '信息', sub: '', face: 0x5b80c2, icon: '', run: () => null, open: () => this.openInfo(c) });
    if (b.lvl < MAX_LEVEL) acts.push({ cap: '升级', sub: `${upgradeCost(b.kind, b.lvl)}`, face: 0x48b860, icon: 'icon_upgrade', run: () => upgrade(this.save, b.x, b.y) });
    else acts.push({ cap: '满级', sub: '', face: 0x7a8399, icon: 'icon_upgrade', run: () => '已满级' });
    if (b.kind !== 'core') {
      acts.push({ cap: '转向', sub: '', face: 0x4a9aff, icon: '', run: () => turn(this.save, b.x, b.y) });
      acts.push({ cap: '拆除', sub: '返还部分', face: 0xe0604a, icon: 'icon_remove', run: () => remove(this.save, b.x, b.y) });
    }
    // build mode, with this building already picked up for moving
    acts.push({ cap: '建造', sub: '', face: 0xf0a030, icon: 'icon_remove', run: () => null, open: () => this.enterBuild(c) });
    acts.forEach((a, i) => {
      const x = (i - (acts.length - 1) / 2) * 84;
      box.add(tileFace(this, x, 0, 72, a.face));
      if (a.icon) box.add(this.add.image(x, -6, `ui_${a.icon}`).setScale(42 / ICON));
      else if (a.open) {
        // info: a white ring with an "i"
        const r = this.add.graphics();
        r.lineStyle(4, 0xffffff, 1).strokeCircle(x, -6, 15);
        box.add([r, outline(label(this, x, -7, 'i', 22, '#ffffff'), '#1b2a50', 3).setOrigin(0.5)]);
      } else {
        // turn arrow: an open ring with an arrowhead
        const r = this.add.graphics();
        r.lineStyle(5, 0xffffff, 1).beginPath().arc(x, -6, 13, Math.PI * 0.15, Math.PI * 1.65).strokePath();
        r.fillStyle(0xffffff, 1).fillTriangle(x + 13, -14, x + 21, -2, x + 6, -1);
        box.add(r);
      }
      box.add(hud(this, x, 22, a.cap, 14).setOrigin(0.5));
      if (a.sub) {
        if (a.cap === '升级') box.add(this.add.image(x - 22, -26, 'ui_icon_stone').setScale(18 / ICON));
        box.add(hud(this, a.cap === '升级' ? x - 12 : x, -26, a.sub, 12, TXT.cream).setOrigin(a.cap === '升级' ? 0 : 0.5, 0.5));
      }
      const hit = this.add.rectangle(VIEW.w / 2 + x, by, 74, 76, 0, 0).setDepth(141).setInteractive({ useHandCursor: true });
      box.once('destroy', () => hit.destroy());
      hit.on('pointerdown', () => {
        if (a.open) { a.open(); return; }
        const err = a.run();
        if (err) { this.say(err); return; }
        writeSave(this.save);
        if (a.cap === '升级') this.say(`${BUILDINGS[b.kind].name} 升到 ${b.lvl} 级`);
        else if (a.cap === '转向') this.say('已转向');
        else { this.say('已拆除'); this.select(null); return; }
        this.select(c); // rebuild with the new level / cost
      });
    });
    this.actions = box;
    this.refresh();
  }

  /**
   * A building's 信息 card: its art on a glowing stand with level and count on the left; on the right what it is
   * for and every stat, the next level's value in green beside it; upgrade from here or close.
   */
  private openInfo(c: Cell) {
    const b = this.at(c.x, c.y);
    if (!b || this.modal) return;
    this.modal = true;
    const D = 500, CX = VIEW.w / 2, CY = VIEW.h / 2 + 8, pw = Math.min(VIEW.r - VIEW.l - 24, 580), ph = Math.min(340, VIEW.h - 40);
    const left = CX - pw / 2, top = CY - ph / 2, def = BUILDINGS[b.kind];
    const layer: Phaser.GameObjects.GameObject[] = [];
    const close = () => { layer.forEach((o) => o.destroy()); this.modal = false; };
    const say = (x: number, y: number, t: string, size: number, color: string = TXT.cream, ox = 0) => {
      const tx = outline(label(this, x, y, t, size, color).setOrigin(ox, 0.5).setDepth(D + 3), '#1b2a50', 3);
      layer.push(tx);
      return tx;
    };
    layer.push(this.add.rectangle(CX, VIEW.h / 2, VIEW.w, VIEW.h, 0x0a1530, 0.55).setDepth(D).setInteractive().on('pointerdown', close));
    layer.push(nine(this, 'panel', CX, CY, pw, ph, 22, 60).setDepth(D + 1));
    const t = titlePlate(this, CX, top + 2, def.name, 220, D + 2);
    layer.push(t.img, t.tx, ...closeX(this, left + pw - 8, top + 8, D + 5, close));

    // left: the building on a stand, its level and how many are built
    const LX = left + 118;
    const glow = this.add.image(LX, top + 150, 'fx_glow').setTint(PAL.gold).setBlendMode('ADD').setAlpha(0.5).setScale(5, 1.6).setDepth(D + 2);
    const pic = this.add.image(LX, top + 156, buildingTex(FACTIONS[b.faction ?? this.save.civilization ?? 0].id, b.kind)).setOrigin(0.5, 1).setDepth(D + 3);
    pic.setScale(Math.min(150 / pic.width, 120 / pic.height));
    layer.push(glow, pic);
    say(LX, top + 182, `${b.lvl} / ${MAX_LEVEL} 级`, 18, TXT.gold, 0.5);
    const built = this.save.layout.filter((q) => q.kind === b.kind).length;
    say(LX, top + 208, `已建 ${built} / ${def.limit}`, 13, TXT.cream, 0.5);
    layer.push(this.add.rectangle(left + 232, CY + 4, 1, ph - 80, PAL.gold, 0.25).setDepth(D + 2));

    // right: description and the stat table, current level and the next
    const x0 = left + 254, x1 = left + pw - 30;
    say(x0, top + 54, BUILDING_DESC[b.kind], 13, TXT.cream).setOrigin(0, 0).setWordWrapWidth(x1 - x0).setLineSpacing(3);
    const rows = buildingStats(b.kind, b.lvl), r0 = top + 118, step = Math.min(30, 150 / rows.length);
    const nowX = x1 - 104;
    say(nowX, r0 - 20, '当前', 11, TXT.dim, 1);
    if (b.lvl < MAX_LEVEL) say(x1, r0 - 20, '下一级', 11, TXT.dim, 1);
    rows.forEach((r, i) => {
      const y = r0 + i * step;
      say(x0, y, r.label, 14, '#ffffff');
      say(nowX, y, r.now, 15, '#ffffff', 1);
      if (r.next) say(x1, y, r.next === r.now ? '—' : `→ ${r.next}`, 15, r.next === r.now ? TXT.dim : '#8dff9a', 1);
      if (i < rows.length - 1) layer.push(this.add.rectangle((x0 + x1) / 2, y + step / 2, x1 - x0, 1, PAL.gold, 0.15).setDepth(D + 2));
    });

    // bottom: upgrade from the card
    const by = top + ph - 40;
    if (b.lvl < MAX_LEVEL) {
      const cost = upgradeCost(b.kind, b.lvl);
      const up = button(this, (x0 + x1) / 2, by, 200, 40, `升级 · ${cost} 灵石`, 0x48b860, () => {
        const err = upgrade(this.save, b.x, b.y);
        if (err) { this.say(err); return; }
        writeSave(this.save);
        this.say(`${def.name} 升到 ${b.lvl} 级`);
        close();
        this.select(c);
        this.openInfo(c);
      });
      up.r.setDepth(D + 4); up.tx.setFontSize(16);
      layer.push(up.r);
      if (this.save.stone < cost) up.r.setAlpha(0.6);
    } else layer.push(caption(this, (x0 + x1) / 2, by, '已满级', 15, D + 4, TXT.gold, 120));
  }

  /** A unit's round avatar `d` px across under the gold ring; `id` defaults to the player's own. */
  private avatar(x: number, y: number, d: number, depth: number, id = avatarOf(this.save)) {
    const face = this.add.image(x, y, avatarTex(this, id, factionOf(id).color, d)).setDepth(depth);
    const ring = this.add.image(x, y, 'hall_ring').setDepth(depth + 0.5);
    face.setScale(1 / 3).setData('k', 1 / 3);
    const k = (d + 4) / 320; // the ring's inner circle is ~320 px across
    ring.setScale(k).setData('k', k);
    return [face, ring];
  }

  /**
   * 个人设置, opened from the avatar: the profile on the left (avatar, 道号 and its rename box, progress), and on the
   * right the avatar picker (every troop and each hero once summoned) and the settings — reduced motion, map
   * skin, back to the title screen, and a reset that asks twice.
   */
  private openProfile() {
    if (this.modal) return;
    this.exitBuild();
    this.select(null);
    this.setTool(null);
    this.modal = true;
    const s = this.save, D = 500, CX = VIEW.w / 2, ph = Math.min(416, VIEW.h - 30), CY = VIEW.h / 2 + 8;
    const pw = Math.min(VIEW.r - VIEW.l - 24, 720), top = CY - ph / 2, left = CX - pw / 2;
    const again = () => { writeSave(s); this.scene.restart({ profile: true }); };
    let foot: Phaser.GameObjects.Text, note = (t: string) => this.say(t); // set up with the footer below
    const say = (x: number, y: number, t: string, size: number, color: string = TXT.cream, ox = 0) =>
      outline(label(this, x, y, t, size, color).setOrigin(ox, 0.5).setDepth(D + 3), '#1b2a50', 3);
    const btn = (x: number, y: number, w: number, t: string, fill: number, on: () => void) => {
      const b = button(this, x, y, w, 30, t, fill, on);
      b.r.setDepth(D + 4); b.tx.setFontSize(14);
      return b;
    };
    this.add.rectangle(CX, VIEW.h / 2, VIEW.w, VIEW.h, 0x0a1530, 0.55).setDepth(D).setInteractive(); // swallows taps behind
    nine(this, 'panel', CX, CY, pw, ph, 22, 60).setDepth(D + 1);
    titlePlate(this, CX, top + 2, '个人设置', 220, D + 2);
    btn(left + pw - 52, top + 28, 72, '关闭', 0xff7a55, () => this.scene.restart());

    // left: who you are
    const LX = left + 128, f = FACTIONS[s.civilization ?? 0];
    this.avatar(LX, top + 104, 100, D + 2);
    say(LX, top + 176, s.profile.name || '道友', 22, TXT.gold, 0.5);
    btn(LX, top + 208, 112, '修改道号', 0x3fd6c0, () => {
      let renamed = false;
      askName(s.profile.name, (n) => { const err = setName(s, n); renamed = !err; return err; }, () => { if (renamed) again(); });
    });
    say(LX, top + 244, f.name, 15, TXT.cyan, 0.5);
    const owned = FACTIONS.filter((q) => s.heroes[q.troops[0].id]).length;
    const souls = troopPool().reduce((a, t) => a + soulProgress(s.souls[t.id] ?? 0).stars, 0);
    [`大殿 Lv.${coreLevel(s)}`, `胜场 ${s.wins}`, `英雄 ${owned} / ${FACTIONS.length}`, `兵魂 ★${souls}`].forEach((t, i) =>
      say(LX + (i % 2 ? 54 : -54), top + 280 + Math.floor(i / 2) * 28, t, 14, TXT.cream, 0.5));
    this.add.rectangle(left + 258, CY + 6, 1, ph - 70, PAL.gold, 0.25).setDepth(D + 2);

    // right: avatar picker, two rows of round faces
    const x0 = left + 286, x1 = left + pw - 30, cur = avatarOf(s);
    say(x0, top + 50, '更换头像', 16, TXT.gold);
    const choices = avatarChoices(s), per = Math.ceil(choices.length / 2), gap = Math.min(52, (x1 - x0) / per);
    choices.forEach((c, i) => {
      const x = x0 + 22 + (i % per) * gap, y = top + 92 + Math.floor(i / per) * 54;
      const [face] = this.avatar(x, y, 40, D + 2, c.id);
      if (!c.unlocked) {
        face.setTint(0x404a70);
        const lock = this.add.image(x, y, 'hall_lock').setDepth(D + 3);
        lock.setScale(20 / lock.width);
      }
      if (c.id === cur) {
        const g = this.add.graphics().setDepth(D + 3);
        g.lineStyle(3, PAL.goldHi, 1).strokeCircle(x, y, 25);
        g.fillStyle(0x2f9e4f, 1).fillCircle(x + 16, y - 16, 8).lineStyle(2, 0xffffff, 1).strokeCircle(x + 16, y - 16, 8);
        say(x + 16, y - 16, '✓', 11, '#ffffff', 0.5);
      }
      const hit = this.add.circle(x, y, 24, 0, 0).setDepth(D + 5).setInteractive({ useHandCursor: c.unlocked });
      hit.on('pointerdown', () => {
        const err = setAvatar(s, c.id);
        if (err) { note(err); return; }
        again();
      });
    });

    // right: settings rows, a label on the left and its control on the right
    say(x0, top + 190, '设置', 16, TXT.gold);
    const row = (i: number, name: string, note: string) => {
      const y = top + 226 + i * 40;
      say(x0, y - (note ? 7 : 0), name, 15, '#ffffff');
      if (note) say(x0, y + 10, note, 11, TXT.dim);
      if (i < 3) this.add.rectangle((x0 + x1) / 2, y + 20, x1 - x0, 1, PAL.gold, 0.15).setDepth(D + 2);
      return y;
    };
    const bx = x1 - 52, bw = 104; // wide enough that each skin's colour shows between its gold end caps
    let y = row(0, '减少动态效果', '关闭战斗与召唤中的震屏和闪白');
    btn(bx, y, bw, s.settings.calm ? '已开启' : '已关闭', s.settings.calm ? 0x3fd6c0 : 0x888888, () => { s.settings.calm = !s.settings.calm; again(); });
    y = row(1, '地图皮肤', `当前：${skinById(s.mapSkin).name}`);
    btn(bx, y, bw, '更换', 0xf6c24a, () => this.scene.restart({ maps: true }));
    y = row(2, '返回标题', '');
    btn(bx, y, bw, '前往', 0x888888, () => { writeSave(s); this.scene.start('menu'); });
    y = row(3, '重置存档', '清除全部进度，重新选择文明');
    let armed = false;
    const reset = btn(bx, y, bw, '重置', 0xe0604a, () => {
      if (!armed) {
        armed = true;
        reset.tx.setText('确认');
        note('再点一次「确认」，所有进度将被清除');
        this.time.delayedCall(3000, () => { armed = false; if (reset.tx.active) reset.tx.setText('重置'); });
        return;
      }
      clearSave();
      this.scene.start('menu');
    });
    const FOOT = '存档只保存在本机浏览器中，清除浏览器数据会丢失进度';
    foot = say(CX, top + ph - 22, FOOT, 11, TXT.dim, 0.5);
    // the panel's own message line: a hint shows in gold for a few seconds, then the footnote returns
    note = (t: string) => {
      foot.setText(t).setColor(TXT.gold).setFontSize(13);
      this.time.delayedCall(2600, () => { if (foot.active) foot.setText(FOOT).setColor(TXT.dim).setFontSize(11); });
    };
  }

  /**
   * Map skin panel: owned maps can be put on, locked ones previewed or unlocked with rewarded videos.
   * Closing restarts the scene, so the panel needs no teardown of its own.
   */
  private openMaps() {
    if (this.modal) return;
    this.modal = true;
    this.drag = null;
    const D = 500;
    const CX = VIEW.w / 2, CY = VIEW.h / 2 + 12, pw = Math.min(VIEW.r - VIEW.l - 24, 770);
    this.add.rectangle(CX, VIEW.h / 2, VIEW.w, VIEW.h, 0x0a1530, 0.5).setDepth(D).setInteractive(); // swallows taps behind the panel
    nine(this, 'panel', CX, CY - 2, pw, Math.min(420, VIEW.h - 34), 22, 60).setDepth(D + 1);
    titlePlate(this, CX, CY - Math.min(420, VIEW.h - 34) / 2 + 2, '地图皮肤', 220, D + 2);
    const note = outline(label(this, CX, CY + 170, '皮肤只改变外观，不影响战斗数值', 14, TXT.cream).setOrigin(0.5).setDepth(D + 2), '#1b2a50', 3);
    MAP_SKINS.forEach((m, i) => {
      const cx = CX + (i - 1.5) * 182, cy = CY - 10;
      const owned = this.save.skins.includes(m.id), on = this.save.mapSkin === m.id;
      plate(this, cx, cy + 3, 168, 286, on).setDepth(D + 2);
      const pic = this.add.image(cx, cy - 78, m.city ? `map_${m.id}_thumb` : `map_${m.id}_sky`).setDepth(D + 3);
      pic.setDisplaySize(148, 148 * (pic.height / pic.width));
      const frame = this.add.graphics().setDepth(D + 3.1);
      frame.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(cx - 74, cy - 78 - pic.displayHeight / 2, 148, pic.displayHeight, 8);
      if (!owned) {
        // "unlocked by video" badge: a white disc with a play mark
        const bx = cx + 60, by = cy - 112, badge = this.add.graphics().setDepth(D + 3.2);
        badge.fillStyle(0x0a1530, 0.3).fillCircle(bx + 1, by + 2, 14);
        badge.fillStyle(0xffffff, 1).fillCircle(bx, by, 14);
        badge.fillStyle(0x4a9aff, 1).fillTriangle(bx - 4, by - 7, bx - 4, by + 7, bx + 7, by);
      }
      outline(label(this, cx, cy - 8, m.name, 19, '#ffffff').setOrigin(0.5).setDepth(D + 3), '#1b2a50', 4);
      outline(label(this, cx, cy + 18, m.desc, 13, TXT.cream).setOrigin(0.5).setDepth(D + 3), '#1b2a50', 3);
      const btn = (y: number, t: string, fill: number, fn: () => void, w = 136, h = 36) => {
        const b = button(this, cx, y, w, h, t, fill, fn);
        b.r.setDepth(D + 4);
        b.tx.setFontSize(15);
      };
      if (on) caption(this, cx, cy + 62, '使用中', 15, D + 4, TXT.gold, 120);
      else if (owned) btn(cy + 62, '使用', 0x55cc55, () => { equipSkin(this.save, m.id); writeSave(this.save); this.scene.restart(); });
      else {
        btn(cy + 58, `看广告 ${this.save.skinAds[m.id] ?? 0}/${m.ads}`, 0x4a9aff, () => this.watchAd(m.id, note));
        btn(cy + 104, '预览', 0x888888, () => this.scene.restart({ preview: m.id }), 96, 30);
      }
    });
    const close = button(this, CX + pw / 2 - 52, CY - Math.min(420, VIEW.h - 34) / 2 + 28, 72, 34, '关闭', 0xff7a55, () => this.scene.restart());
    close.r.setDepth(D + 4);
  }

  /**
   * One rewarded view toward a locked map. The grant happens only on the platform's reward callback, once per
   * receipt; with no ad platform connected the player is told so and nothing changes.
   */
  private async watchAd(id: string, note: Phaser.GameObjects.Text) {
    const r = await showRewarded(`map_${id}`);
    if (!this.scene.isActive()) return;
    if (r.status !== 'rewarded') { note.setText(adMiss(r.status)).setColor('#ffd27a'); return; }
    const got = grantSkinAd(this.save, id, r.receipt);
    writeSave(this.save);
    // unlocked: show the new map right away; one more view needed: reopen the panel with the updated count
    this.scene.restart(got === 'unlocked' ? {} : { maps: true });
  }

  /** Strip across the top while a locked map is on trial: unlock or leave. */
  private previewBar(id: string) {
    const m = skinById(id), y = 92;
    const cx = VIEW.w / 2;
    nine(this, 'money', cx, y, 380, 34, 15, 55).setDepth(150);
    outline(label(this, cx - 172, y, `预览：${m.name}`, 15, '#ffffff'), TXT.edge, 3).setOrigin(0, 0.5).setDepth(151);
    const a = button(this, cx + 78, y, 80, 28, '解锁', 0x4a9aff, () => this.scene.restart({ maps: true }));
    a.r.setDepth(152); a.tx.setFontSize(14);
    const b = button(this, cx + 154, y, 60, 28, '退出', 0x888888, () => this.scene.restart());
    b.r.setDepth(152); b.tx.setFontSize(14);
  }

  /** A message that pops in under the top HUD and fades away. */
  private say(t: string) {
    // in build mode it sits just above the tray, clear of the ✓ / ✕ floating over a new building
    this.toastTx.setText(t).setAlpha(1).setScale(1.12).setY(this.editing ? this.trayTop - 18 : 100);
    this.tweens.killTweensOf(this.toastTx);
    this.tweens.add({ targets: this.toastTx, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.toastTx, alpha: 0, delay: 1600, duration: 500 });
  }

  private refresh() {
    drawGround(this.g);
    const mark = (c: Cell, color: number) => {
      drawCell(this.g, c.x, c.y, color, 0.24);
      this.g.lineStyle(2.5, color === 0xffffff ? PAL.goldHi : color, 0.95).strokePoints([proj(c.x, c.y), proj(c.x + 1, c.y), proj(c.x + 1, c.y + 1), proj(c.x, c.y + 1)], true);
    };
    // the grid shows near the pointer while placing, and while a picked-up building waits for its new cell
    if (this.hover && (this.tool || (this.editing && this.sel))) {
      const { x, y } = this.hover;
      // while placing, the grid shows near the pointer, fading out over a few cells
      for (let i = x - 3; i <= x + 3; i++) for (let j = y - 3; j <= y + 3; j++) {
        const d = Math.hypot(i - x, j - y);
        if (d > 3.2 || i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        this.g.lineStyle(1, 0xffffff, 0.42 * (1 - d / 3.4)).strokePoints([proj(i, j), proj(i + 1, j), proj(i + 1, j + 1), proj(i, j + 1)], true);
      }
      mark(this.hover, this.at(x, y) ? 0xff6050 : 0xffffff);
    }
    // a building being dragged: the grid shows around it, its cell green where it may go and red where it may not
    const held = this.ghost ? { x: this.ghost.x, y: this.ghost.y, home: null as Cell | null }
      : this.carry && this.carry !== 'ghost' ? { ...this.carry.at, home: this.carry.from } : null;
    if (held) {
      for (let i = held.x - 3; i <= held.x + 3; i++) for (let j = held.y - 3; j <= held.y + 3; j++) {
        const d = Math.hypot(i - held.x, j - held.y);
        if (d > 3.2 || i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        this.g.lineStyle(1, 0xffffff, 0.42 * (1 - d / 3.4)).strokePoints([proj(i, j), proj(i + 1, j), proj(i + 1, j + 1), proj(i, j + 1)], true);
      }
      const taken = this.at(held.x, held.y) && !(held.home && held.home.x === held.x && held.home.y === held.y);
      mark(held, taken ? 0xff6050 : 0x6dff8a);
      // the sprite says it too, since a tall building hides its own cell
      if (this.ghost) for (const o of [this.ghost.view.img, this.ghost.view.half]) o.setTint(taken ? 0xff7a6a : 0xffffff);
    } else if (this.sel) mark(this.sel, 0x7fe0ff);
    // Sprites sort themselves by depth (x+y); here we only keep them in sync with the save.
    const live = new Set<string>();
    for (const b of this.save.layout) {
      const key = `${b.x},${b.y}`;
      live.add(key);
      let v = this.views.get(key);
      const face = facingOf(this.save.layout, b);
      if (!v) { v = createBuildingView(this, FACTIONS[b.faction ?? this.save.civilization ?? 0].id, b.kind, b.x, b.y, face); this.views.set(key, v); }
      setBuildingKind(this, v, b.kind, b.x, b.y, face);
      // a building in the player's hand shows its pips where it is being held
      const held = this.carry && this.carry !== 'ghost' && this.carry.from.x === b.x && this.carry.from.y === b.y ? this.carry.at : b;
      paintOverlay(v, held.x, held.y, b.lvl);
    }
    for (const [key, v] of this.views) if (!live.has(key)) { destroyBuildingView(v); this.views.delete(key); }
    // see-through: sprites standing in front of the hovered or selected building fade so it can be found
    const focus = this.sel ?? this.hover;
    const hv = focus && this.views.get(`${focus.x},${focus.y}`);
    const hb = hv?.img.getBounds();
    // build mode: the building picked up for moving glows cyan, since its own sprite hides its cell mark
    const picked = this.editing && this.sel ? this.views.get(`${this.sel.x},${this.sel.y}`) : undefined;
    for (const v of this.views.values()) {
      const front = !!hv && !!hb && v !== hv && v.img.depth > hv.img.depth && Phaser.Geom.Intersects.RectangleToRectangle(hb, v.img.getBounds());
      v.img.setAlpha(front ? 0.4 : 1).setTint(v === picked ? 0x9fe8ff : 0xffffff);
      v.half.setAlpha(front ? 0.4 : 1).setTint(v === picked ? 0x9fe8ff : 0xffffff);
      v.over.setAlpha(front ? 0.4 : 1);
    }
    const s = this.save;
    this.roll('stone', this.stoneTx, s.stone);
    const pend = Math.floor(s.pending);
    this.pendTx.setText(pend > 0 ? `矿场 +${pend} · 点击收取` : '').setColor(pend >= pendingCap(s) ? '#ffb0a0' : '#9cff9c');
    this.roll('tokens', this.tokenTx, s.tokens);
  }
}
