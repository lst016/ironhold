import Phaser from 'phaser';
import type { BuildingKind } from '../data/factions';
import { FACTIONS } from '../data/factions';
import type { TroopDef } from '../data/factions';
import { wallPieces, type WallPiece } from '../core/walls';
import { proj, TH, TW } from './common';
import { DECO_KEYS, preloadMaps } from './island';
import { UNIT_ANIMS, type UnitClip } from './unitAnims';

// Pre-rendered 3D sprites (tools/render3d.ts) in public/assets/3d/<id>_<facing>.png: every civilization's
// buildings, and the units listed in UNIT_3D (the rest use their flat art). Buildings are rendered at ART x the stage scale (tile 120 = 3 x the 40px tile) so they stay sharp up to
// RES 3, and draw at 1 / ART. `pad` is the render px kept below the anchor (cell front vertex for buildings,
// feet for units).
// Building facing i is the model turned i * 90 degrees; dir 0/1 shows facing 0/1, a real turn with the same light.
// Wall facing 0 runs along the grid's x axis and facing 1 along y (tools/jobs-buildings.json renders all of them).
const ART = 3;
// barracks / aoe (tools/jobs-batch1-buildings.json) ship render facings 0 and 3 as their _0 / _1, so both show the door.
const BUILDING_PAD: Record<BuildingKind, number> = { core: 66, tower: 30, mine: 36, wall: 9, barracks: 42, aoe: 30 };
// Unit facing i looks along grid direction (sin, cos) of i * 45 degrees. `body` is the render px from feet to
// the top of the head, which maps to the unit's on-screen height.
// Renders: tools/jobs-units.json (and the cn_sword entry in jobs-buildings.json).
const UNIT_3D: Partial<Record<string, { pad: number; body: number }>> = {
  cn_sword: { pad: 76, body: 196 }, cn_ape: { pad: 76, body: 204 }, cn_fly: { pad: 76, body: 198 },
  cn_hero: { pad: 76, body: 152 }, cn_talisman: { pad: 76, body: 201 },
  eu_archer: { pad: 76, body: 206 }, eu_golem: { pad: 76, body: 173 }, eu_gryphon: { pad: 76, body: 191 },
  eu_hero: { pad: 76, body: 207 }, eu_knight: { pad: 76, body: 218 },
  jp_charm: { pad: 76, body: 204 }, jp_fox: { pad: 76, body: 173 }, jp_hero: { pad: 76, body: 194 },
  jp_oni: { pad: 76, body: 153 }, jp_tengu: { pad: 76, body: 212 },
  // batch 1 wall breakers that would not rig (tools/jobs-batch1-static.json); the dwarf's keg rides above his head
  jp_bomber: { pad: 76, body: 135 }, eu_bomber: { pad: 76, body: 150 },
};
const tex3d = (id: string, i: number) => `r3d_${id}_${i}`;
// Rigged units (scripts/prep_unit_anims.py) play baked skeletal clips instead: one sheet per clip, a row per
// facing and a column per frame. They take precedence over UNIT_3D.
const animTex = (id: string, clip: UnitClip) => `ua_${id}_${clip}`;
/** Texture of a building's front facing, for menus and cards. */
export const buildingTex = (fid: string, kind: BuildingKind) => tex3d(`${fid}_${kind}`, 0);

const HALL_KIT = ['panel', 'bar', 'title', 'ribbon', 'pedestal', 'card', 'card_on', 'slot', 'slot_on', 'ring',
  'btn_gold', 'btn_jade', 'btn_red', 'btn_navy', 'star_on', 'star_off', 'pip_on', 'pip_off', 'tag_gold', 'tag_blue',
  'back', 'plus', 'lock', 'soul', 'badge', 'money', 'tag_jade', 'track', 'inset', 'fill'];

export function preloadSprites(s: Phaser.Scene) {
  for (const f of FACTIONS) {
    for (const t of f.troops) s.load.image(`unit_${t.id}`, `assets/units/${t.id}.png`);
    // portraits: cards in the hall and summon, and the player's avatar on every screen
    for (const t of f.troops) s.load.image(`por_${t.id}`, `assets/gacha/portraits/${t.id}.webp`);
    for (const k of Object.keys(BUILDING_PAD)) for (let i = 0; i < 2; i++) s.load.image(tex3d(`${f.id}_${k}`, i), `assets/3d/${f.id}_${k}_${i}.png`);
  }
  for (const id of Object.keys(UNIT_3D)) for (let i = 0; i < 8; i++) s.load.image(tex3d(id, i), `assets/3d/${id}_${i}.png`);
  for (const [id, a] of Object.entries(UNIT_ANIMS)) {
    for (const [clip, c] of Object.entries(a.clips)) s.load.spritesheet(animTex(id, clip as UnitClip), `assets/anim/${id}_${clip}.webp`, { frameWidth: c.w, frameHeight: c.h });
  }
  for (const u of ['banner', 'win', 'lose', 'skill', 'speed', 'flag', 'icon_stone', 'icon_token', 'icon_tower', 'icon_wall', 'icon_mine', 'icon_sword', 'icon_upgrade', 'icon_remove', 'icon_camp', 'icon_housing', 'close', 'tile_blue', 'tile_gold', 'tile_red', 'tile_green', 'tile_gray', 'tile_purple']) s.load.image(`ui_${u}`, `assets/ui/${u}.png`);
  // the 英灵殿 kit (scripts/prep_hall.py): its buttons are the game's text buttons, the rest dress the hero hall
  for (const u of HALL_KIT) s.load.image(`hall_${u}`, `assets/ui/hall/${u}.png`);
  s.load.image('hall_bg', 'assets/ui/hall/bg.jpg');
  for (const d of DECO_KEYS) s.load.image(`deco_${d}`, `assets/deco/${d}.png`);
  preloadMaps(s);
}

export interface BuildingView {
  kind: BuildingKind;
  fid: string;
  img: Phaser.GameObjects.Image;
  /** Second half-segment of a wall corner or T junction; hidden otherwise. */
  half: Phaser.GameObjects.Image;
  over: Phaser.GameObjects.Graphics;
  /** Soft contact shadow on the ground under the base, so the building sits in the lawn. */
  shadow: Phaser.GameObjects.Image;
  look: string; // the facing currently shown, so repaints only touch changed sprites
}

/** Footprint of each 3D render in cells (fit in tools/jobs-buildings.json), for the contact shadow. */
const FOOTPRINT: Record<BuildingKind, number> = { core: 3, tower: 1.8, mine: 2, wall: 0.8, barracks: 2.3, aoe: 1.8 };

/** A soft dark blot fading to nothing at its edge, made once. */
function shadowTex(s: Phaser.Scene) {
  if (s.textures.exists('bld_shadow')) return 'bld_shadow';
  const t = s.textures.createCanvas('bld_shadow', 128, 64)!, ctx = t.getContext();
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(16,32,12,0.42)');
  g.addColorStop(0.6, 'rgba(16,32,12,0.22)');
  g.addColorStop(1, 'rgba(16,32,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  t.refresh();
  return 'bld_shadow';
}

function placeShadow(v: BuildingView, cx: number, cy: number) {
  const c = proj(cx + 0.5, cy + 0.5), w = FOOTPRINT[v.kind] * TW * 1.05;
  v.shadow.setPosition(c.x, c.y + 3).setDisplaySize(w, w * (TH / TW));
}

export function createBuildingView(s: Phaser.Scene, fid: string, kind: BuildingKind, cx: number, cy: number, pieces: WallPiece[] | 0 | 1 = 0): BuildingView {
  const foot = proj(cx + 1, cy + 1); // the sprite's bottom corner sits on the cell's bottom vertex
  const depth = cx + cy + 1;
  const img = s.add.image(foot.x, foot.y, buildingTex(fid, kind)).setOrigin(0.5, 1).setDepth(depth);
  const half = s.add.image(foot.x, foot.y, buildingTex(fid, kind)).setOrigin(0.5, 1).setDepth(depth).setVisible(false);
  const over = s.add.graphics().setDepth(depth + 0.1);
  const shadow = s.add.image(0, 0, shadowTex(s)).setDepth(-0.9); // above the ground, below every sprite
  const v = { kind, fid, img, half, over, shadow, look: '' };
  placeShadow(v, cx, cy);
  setFacing(s, v, pieces);
  return v;
}

/**
 * Point the sprite: 0/1 picks the art or its mirror; for walls pass `wallPieces(...)`.
 * The wall art runs along the grid's y axis, its mirror along x. A half piece keeps the side of the sprite
 * that reaches toward that neighbour: +y and -x lie to the screen's left, -y and +x to its right.
 */
export function setFacing(s: Phaser.Scene, v: BuildingView, f: WallPiece[] | 0 | 1) {
  const pieces: WallPiece[] = Array.isArray(f) ? f : [{ axis: f ? 'x' : 'y', half: 'full' }];
  const look = pieces.map((p) => p.axis + p.half).join();
  if (look === v.look) return;
  v.look = look;
  const id = `${v.fid}_${v.kind}`;
  [v.img, v.half].forEach((img, i) => {
    const p = pieces[i];
    img.setVisible(!!p);
    if (!p) return;
    // a wall's facing follows its axis; any other building shows the facing the player chose
    img.setTexture(tex3d(id, v.kind === 'wall' ? +(p.axis === 'y') : +(p.axis === 'x'))).setScale(1 / ART);
    img.setOrigin(0.5, 1 - BUILDING_PAD[v.kind] / img.height);
    const w = img.width, h = img.height;
    const left = (p.axis === 'y') === (p.half === 'pos');
    if (p.half === 'full') img.setCrop();
    else img.setCrop(left ? 0 : w / 2, 0, w / 2, h);
  });
}

export function setBuildingKind(s: Phaser.Scene, v: BuildingView, kind: BuildingKind, cx: number, cy: number, f: WallPiece[] | 0 | 1 = 0) {
  if (v.kind !== kind) {
    v.kind = kind;
    v.look = '';
    const foot = proj(cx + 1, cy + 1);
    v.img.setPosition(foot.x, foot.y);
    v.half.setPosition(foot.x, foot.y);
    placeShadow(v, cx, cy);
  }
  setFacing(s, v, f);
}

/** Facing input for one building: walls follow their neighbours, everything else its own `dir`. */
export function facingOf<T extends { kind: BuildingKind; x: number; y: number; dir?: 0 | 1 }>(all: T[], b: T, cell = (q: T) => [q.x, q.y]): WallPiece[] | 0 | 1 {
  if (b.kind !== 'wall') return b.dir ?? 0;
  const walls = new Set(all.filter((q) => q.kind === 'wall').map((q) => cell(q).join()));
  const [x, y] = cell(b);
  return wallPieces((qx, qy) => walls.has(`${qx},${qy}`), x, y, b.dir ?? 0);
}

/** Level pips and an optional HP bar above the sprite. */
export function paintOverlay(v: BuildingView, cx: number, cy: number, lvl: number, hpFrac?: number) {
  const c = proj(cx + 0.5, cy + 0.5);
  const top = proj(cx + 1, cy + 1).y - v.img.displayHeight;
  const g = v.over.clear();
  const x0 = c.x - (lvl * 6) / 2;
  // level 1 is the default, so pips only appear once a building has been upgraded
  for (let i = 0; i < (lvl > 1 ? lvl : 0); i++) g.fillStyle(0xffffff, 0.95).fillCircle(x0 + i * 6 + 2, top - 3, 2.8).fillStyle(0xffc83a, 1).fillCircle(x0 + i * 6 + 2, top - 3, 1.9);
  if (hpFrac !== undefined && hpFrac < 1) {
    g.fillStyle(0x401010, 1).fillRect(c.x - 12, top - 12, 24, 3);
    g.fillStyle(0xd04040, 1).fillRect(c.x - 12, top - 12, 24 * Math.max(0, hpFrac), 3);
  }
}

/** Stand a building's sprite on another cell (dragging it around the base); its facing and art stay as they are. */
export function moveBuildingView(v: BuildingView, cx: number, cy: number) {
  const foot = proj(cx + 1, cy + 1), depth = cx + cy + 1;
  for (const img of [v.img, v.half]) img.setPosition(foot.x, foot.y).setDepth(depth);
  v.over.setDepth(depth + 0.1);
  placeShadow(v, cx, cy);
}

export function destroyBuildingView(v: BuildingView) {
  v.img.destroy();
  v.half.destroy();
  v.over.destroy();
  v.shadow.destroy();
}
void TH;

export interface UnitView {
  img: Phaser.GameObjects.Image;
  g: Phaser.GameObjects.Graphics;
  lastX: number;
  lastY: number;
  lastHp: number;
  phase: number;
  atkAt: number;
  /** Facing shown by a 3D-rendered unit (0..7), -1 for flat art. */
  dir: number;
  /** Attack cooldown seen last frame; a jump up means the unit just struck. */
  lastCd: number;
}

// Playback lengths (ms) for baked clips; the source clips are slower than the battle's pace.
const WALK_MS = 760, IDLE_MS = 1800, ATTACK_MS = 620;

/** Show frame `f` of a baked clip in facing `dir`, anchored at the feet. */
function setAnimFrame(v: UnitView, id: string, clip: UnitClip, dir: number, f: number) {
  const a = UNIT_ANIMS[id], c = a.clips[clip]!;
  v.img.setTexture(animTex(id, clip), dir * c.frames + f).setOrigin(0.5, 1 - a.pad / c.h);
}

/** Picks the clip from what the unit is doing: striking (its cooldown just reset), walking, or standing. */
function paintAnim(v: UnitView, d: TroopDef, now: number, moving: boolean, cd: number | undefined) {
  const a = UNIT_ANIMS[d.id];
  if (cd !== undefined && cd > v.lastCd + 0.05 && a.clips.attack) v.atkAt = now;
  if (cd !== undefined) v.lastCd = cd;
  const atkMs = Math.min(ATTACK_MS, d.interval * 900);
  let clip: UnitClip = 'idle', k: number;
  if (now - v.atkAt < atkMs) { clip = 'attack'; k = (now - v.atkAt) / atkMs; }
  else if (moving && a.clips.walk) { clip = 'walk'; k = ((now + v.phase * 300) % WALK_MS) / WALK_MS; }
  else if (a.clips.idle) {
    // The idle excerpt does not loop seamlessly, so it plays forward and back.
    const p = ((now + v.phase * 300) % (IDLE_MS * 2)) / IDLE_MS;
    k = p < 1 ? p : 2 - p;
  } else { clip = 'walk'; k = 0; } // quadrupeds only have a walk preset: stand on its first frame
  const n = a.clips[clip]!.frames;
  setAnimFrame(v, d.id, clip, v.dir, Math.min(n - 1, Math.floor(k * n)));
}

/** On-screen height in px, feet to top of head (a cell is 40 px across, a tower about twice that tall): troops
 * stay well below the buildings, heroes and tanks a little taller. */
export const unitHeight = (d: TroopDef) => (d.hero ? 54 : d.role === 'tank' ? 44 : 36);
/** Extra shrink for 3D units whose wings spread far past their head. */
const WING_SCALE: Partial<Record<string, number>> = { jp_tengu: 0.72, eu_hero: 0.85 };
/** Height above the ground where hits land on a unit: mid-body, plus the hover of flyers. */
export const unitHitHeight = (d: TroopDef) => unitHeight(d) * 0.55 + (d.flying ? 22 : 0);

function setUnitDir(v: UnitView, d: TroopDef, dir: number) {
  const r3d = UNIT_3D[d.id]!;
  v.dir = dir;
  v.img.setTexture(tex3d(d.id, dir)).setOrigin(0.5, 1 - r3d.pad / v.img.height);
}

export function createUnitView(s: Phaser.Scene, d: TroopDef, x: number): UnitView {
  const img = s.add.image(0, 0, `unit_${d.id}`).setOrigin(0.5, 0.97); // flat art is trimmed to the feet
  img.setScale(unitHeight(d) / img.height);
  const v = { img, g: s.add.graphics(), lastX: x, lastY: 0, lastHp: 1, phase: Math.random() * 6.28, atkAt: -1e9, dir: -1, lastCd: 0 };
  if (UNIT_ANIMS[d.id]) { v.dir = 0; setAnimFrame(v, d.id, UNIT_ANIMS[d.id].clips.idle ? 'idle' : 'walk', 0, 0); }
  else if (UNIT_3D[d.id]) setUnitDir(v, d, 0);
  return v;
}

/** Screen-space unit vector of a 3D facing, for the attack lunge. */
function dirVec(dir: number) {
  const a = (dir * Math.PI) / 4, gx = Math.sin(a), gy = Math.cos(a);
  const sx = (gx - gy) * (TW / 2), sy = (gx + gy) * (TH / 2), n = Math.hypot(sx, sy);
  return { x: sx / n, y: sy / n };
}

/**
 * Sprite, team-colored ground disc and HP bar. Motion is derived from position/HP deltas:
 * walking bobs, standing units breathe and lunge on their attack beat.
 */
export function paintUnit(v: UnitView, d: TroopDef, gx: number, gy: number, color: number, hpFrac: number, cd?: number, target?: { x: number; y: number }) {
  const now = performance.now();
  const lift = d.flying ? 22 + Math.sin(now / 280 + v.phase) * 4 : 0;
  const ground = proj(gx, gy);
  const depth = gx + gy + 0.5;
  const dx = gx - v.lastX, dy = gy - v.lastY, moving = Math.hypot(dx, dy) > 0.005;
  const anim = UNIT_ANIMS[d.id];
  if (v.dir >= 0) {
    // Turn to the nearest of 8 rendered facings: along the walk, or toward the target while standing to strike.
    const fx = moving ? dx : target ? target.x - gx : 0, fy = moving ? dy : target ? target.y - gy : 0;
    if (moving || (anim && Math.hypot(fx, fy) > 0.05)) {
      const dir = (Math.round(Math.atan2(fx, fy) / (Math.PI / 4)) + 8) % 8;
      if (dir !== v.dir) { if (anim) v.dir = dir; else setUnitDir(v, d, dir); }
    }
  } else if (Math.abs(dx) > 0.005) v.img.setFlipX(dx < 0);
  const lunge = v.dir >= 0 ? dirVec(v.dir) : { x: v.img.flipX ? -1 : 1, y: 0 };
  v.lastX = gx; v.lastY = gy;
  v.lastHp = hpFrac;
  const h = unitHeight(d);
  const base = (anim ? h / anim.body : v.dir >= 0 ? h / UNIT_3D[d.id]!.body : h / v.img.height) * (WING_SCALE[d.id] ?? 1);
  let ox = 0, oy = 0, sx = 1, sy = 1;
  if (anim) paintAnim(v, d, now, moving, cd); // the skeleton carries the motion; no squash or lunge
  else if (moving) {
    const w = Math.abs(Math.sin(now / 90 + v.phase));
    oy = -w * 4; sy = 1 + w * 0.04; sx = 1 - w * 0.03;
  } else {
    const breathe = Math.sin(now / 420 + v.phase);
    sy = 1 + breathe * 0.025; sx = 1 - breathe * 0.015;
    const beat = d.interval * 1000;
    const t = (now + v.phase * 100) % beat;
    if (t < 140) { const k = Math.sin((t / 140) * Math.PI); ox = lunge.x * k * 8; oy = lunge.y * k * 8; sx += k * 0.06; }
  }
  v.img.setScale(base * sx, base * sy).setPosition(ground.x + ox, ground.y - lift + oy).setDepth(depth);
  // Hits never recolor the body (the scene sparks at the contact point instead). A soft blob shadow grounds the
  // unit; flyers' shadow stays on the ground, smaller. The side shows on the HP bar, which appears once hurt.
  const r = (d.hero ? 12 : d.role === 'tank' ? 10 : 8) * (d.flying ? 0.75 : 1);
  const top = ground.y - lift - h * (WING_SCALE[d.id] ?? 1);
  v.g.setDepth(depth).clear();
  v.g.fillStyle(0x10200c, 0.22).fillEllipse(ground.x, ground.y, r * 2.6, r * 1.3);
  v.g.fillStyle(0x10200c, 0.18).fillEllipse(ground.x, ground.y, r * 1.6, r * 0.8);
  if (hpFrac < 0.999 || d.hero) {
    const bw = d.hero ? 26 : 18, bx = ground.x - bw / 2, by = top - 7;
    v.g.fillStyle(0x0b0f18, 0.85).fillRoundedRect(bx - 1, by - 1, bw + 2, 5, 2);
    v.g.fillStyle(color, 1).fillRoundedRect(bx, by, Math.max(1.5, bw * Math.max(0, hpFrac)), 3, 1.5);
    v.g.fillStyle(0xffffff, 0.35).fillRect(bx + 1, by, Math.max(0, bw * hpFrac - 2), 1);
  }
}

export function destroyUnitView(v: UnitView) {
  v.img.destroy();
  v.g.destroy();
}
