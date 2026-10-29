import Phaser from 'phaser';
import { GRID } from '../core/sim';
import { OY, TH, TW, W, toGrid, toScreen } from '../core/iso';
export { OY, TH, TW, W };
import { FACTIONS, type BuildingKind } from '../data/factions';

// Isometric projection: the logic grid stays square, only drawing and picking change.
// W x H is the WORLD the island and battlefield are drawn in; screens are laid out in VIEW (below).
export const PY = OY + (GRID * TH) + 10; // y just below the island's buildable grid
export const H = PY + 170;

/**
 * The screen in stage units, built for a phone held sideways. Height is 450 units (a 390 px tall phone shows
 * them at ~0.87, so 12-unit text is ~10 px and an 52-unit button is a 44 px touch target); width follows the
 * screen's shape, never below 800 (16:9), so a 19.5:9 phone gets ~970 x 450 and a 4:3 tablet 800 x 600.
 * `l` / `r` are the left and right edges inside the notch / home-indicator safe area. Measured at boot and again
 * on rotation; a changed size is applied when the next screen starts (see stageCamera).
 */
export const VIEW = { w: 800, h: 450, l: 0, r: 800 };
const VH = 450, MAX_ASPECT = 2.3;
/** The window's landscape shape (rotateHint lays a portrait window out sideways). */
function screenSize() {
  if (typeof window === 'undefined') return { w: 1600, h: 900 };
  const w = innerWidth, h = innerHeight;
  return h > w * 1.1 ? { w: h, h: w } : { w, h };
}
/** Safe-area insets in CSS px (non-zero only with viewport-fit=cover on notched phones). */
function safeInsets() {
  if (typeof document === 'undefined' || !document.body) return { l: 0, r: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe), l = parseFloat(cs.paddingLeft) || 0, r = parseFloat(cs.paddingRight) || 0;
  probe.remove();
  return { l, r };
}
function measure() {
  const { w, h } = screenSize(), a = Math.min(MAX_ASPECT, w / h);
  const vw = Math.max(800, Math.round(VH * a)), vh = Math.round(vw / a);
  const k = vw / Math.min(w, h * MAX_ASPECT), ins = safeInsets();
  return { w: vw, h: vh, l: Math.round(ins.l * k), r: vw - Math.round(ins.r * k) };
}
Object.assign(VIEW, measure());

/**
 * Backing-store scale. The canvas has RES times as many pixels as the view and every scene camera zooms by RES
 * (stageCamera), so art and text stay sharp on a big window or a retina phone. Picked once at boot.
 */
export const RES = typeof window === 'undefined' ? 1
  : Math.min(3, Math.max(1, Math.ceil(Math.min(screenSize().w / VIEW.w, screenSize().h / VIEW.h) * (devicePixelRatio || 1))));

/** Height in px of the icon art in public/assets/ui (scripts/prep_ui_v2.py); scale icons by size / ICON. */
export const ICON = 192;

let pendingView: typeof VIEW | null = null;
/** Re-measure after a rotation or resize; the new size takes effect when the next screen starts. */
export function watchView(game: Phaser.Game) {
  if (typeof window === 'undefined') return;
  const check = () => {
    const v = measure();
    if (v.w !== VIEW.w || v.h !== VIEW.h || v.l !== VIEW.l || v.r !== VIEW.r) pendingView = v;
    // a screen that is only showing menus can re-lay itself out at once; a battle keeps its size until it ends
    const live = game.scene.getScenes(true).find((sc) => sc.scene.key !== 'battle');
    if (pendingView && live) live.scene.restart();
  };
  addEventListener('resize', () => setTimeout(check, 120));
}

/** Point the scene's camera at the view. Call first in create(). Map scenes then call splitStage. */
export function stageCamera(s: Phaser.Scene) {
  if (pendingView) {
    Object.assign(VIEW, pendingView);
    pendingView = null;
    s.scale.setGameSize(VIEW.w * RES, VIEW.h * RES); // (resize() would skip the FIT refit of the canvas box)
  }
  s.cameras.main.setOrigin(0, 0).setZoom(RES).setScroll(0, 0);
  s.cameras.main.setSize(VIEW.w * RES, VIEW.h * RES);
}

/**
 * Map scenes: the main camera becomes the WORLD camera, zoomed so `frame` (a rect in W x H world units) fills
 * the view, and a second UI camera shows the HUD laid out in VIEW units against the screen edges. Each object
 * goes to one camera: `hud(depth)` decides by depth band, and anything created inside `inUI(fn)` is HUD.
 * World pointer positions come from `toWorld(pointer)`.
 */
export function splitStage(s: Phaser.Scene, frame: { x: number; y: number; w: number; h: number }, hud: (depth: number) => boolean) {
  const world = s.cameras.main;
  const ui = s.cameras.add(0, 0, VIEW.w * RES, VIEW.h * RES).setOrigin(0, 0).setZoom(RES);
  const z = Math.min(VIEW.w / frame.w, VIEW.h / frame.h);
  world.setZoom(RES * z);
  world.setScroll(frame.x + frame.w / 2 - VIEW.w / 2 / z, frame.y + frame.h / 2 - VIEW.h / 2 / z);
  const forced = new WeakSet<Phaser.GameObjects.GameObject>();
  let uiMode = false;
  const mark = (o: Phaser.GameObjects.GameObject) => { if (uiMode) forced.add(o); };
  s.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, mark);
  s.events.once(Phaser.Scenes.Events.SHUTDOWN, () => s.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, mark));
  // route every frame: depth is usually set after an object is added, and a few change it later
  const route = () => {
    for (const o of s.children.list) {
      const d = (o as unknown as { depth: number }).depth;
      o.cameraFilter = forced.has(o) || hud(d) ? world.id : ui.id;
    }
  };
  s.events.on(Phaser.Scenes.Events.PRE_RENDER, route);
  s.events.once(Phaser.Scenes.Events.SHUTDOWN, () => s.events.off(Phaser.Scenes.Events.PRE_RENDER, route));
  /** The world rect the world camera shows. */
  const view = { x: world.scrollX, y: world.scrollY, w: VIEW.w / z, h: VIEW.h / z };
  return {
    world, ui, z, view,
    inUI<T>(fn: () => T): T { const was = uiMode; uiMode = true; try { return fn(); } finally { uiMode = was; } },
    toWorld(p: { x: number; y: number }) { return world.getWorldPoint(p.x, p.y); },
    /** A world point's position on screen, in VIEW units. */
    toScreen(x: number, y: number) { return { x: (x - view.x) * z, y: (y - view.y) * z }; },
  };
}
export type Stage = ReturnType<typeof splitStage>;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Pan and zoom for a splitStage world camera, like a base-building game's map: one finger drags the map, two
 * fingers pinch to zoom (and pan with their midpoint), the mouse wheel zooms around the cursor. Zoom runs from
 * showing all of `bounds` (a world rect the scenery fully covers) to 2.6x the stage's starting fit, and the view
 * never leaves `bounds`. A press that starts on a HUD object, or while `enabled()` says no, is left alone.
 * `pan(p)` may veto a one-finger drag (e.g. while a wall is being painted). Scenes act on taps with `tap(p)` from
 * their pointerup handler: true only for a press that neither moved nor turned into a pinch.
 */
export function mapCamera(s: Phaser.Scene, stage: Stage, bounds: { x: number; y: number; w: number; h: number },
  opts: { enabled?: () => boolean; pan?: (p: Phaser.Input.Pointer) => boolean } = {}) {
  const world = stage.world, zFit = stage.z;
  const zMin = Math.min(zFit, Math.max(VIEW.w / bounds.w, VIEW.h / bounds.h)), zMax = zFit * 2.6;
  let z = zFit, cx = stage.view.x + stage.view.w / 2, cy = stage.view.y + stage.view.h / 2;
  const apply = () => {
    z = clamp(z, zMin, zMax);
    const hw = VIEW.w / 2 / z, hh = VIEW.h / 2 / z;
    cx = bounds.w > 2 * hw ? clamp(cx, bounds.x + hw, bounds.x + bounds.w - hw) : bounds.x + bounds.w / 2;
    cy = bounds.h > 2 * hh ? clamp(cy, bounds.y + hh, bounds.y + bounds.h - hh) : bounds.y + bounds.h / 2;
    world.setZoom(RES * z).setScroll(cx - hw, cy - hh);
  };
  /** Zoom by k keeping the world point under screen point (sx, sy), in VIEW units, where it is. */
  const zoomAt = (sx: number, sy: number, k: number) => {
    const wx = cx + (sx - VIEW.w / 2) / z, wy = cy + (sy - VIEW.h / 2) / z;
    z = clamp(z * k, zMin, zMax);
    cx = wx - (sx - VIEW.w / 2) / z;
    cy = wy - (sy - VIEW.h / 2) / z;
    apply();
  };
  apply();
  s.input.addPointer(1); // two touch points for the pinch
  const on = () => opts.enabled?.() ?? true;
  const v = (p: Phaser.Input.Pointer) => ({ x: p.x / RES, y: p.y / RES });
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  const fingers = () => [s.input.pointer1, s.input.pointer2].filter((q) => q?.isDown);
  const spread = (a: Phaser.Input.Pointer, b: Phaser.Input.Pointer) => {
    const pa = v(a), pb = v(b);
    return { d: Math.hypot(pa.x - pb.x, pa.y - pb.y), mx: (pa.x + pb.x) / 2, my: (pa.y + pb.y) / 2 };
  };
  s.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
    const f = fingers();
    if (f.length >= 2) {
      // a second finger: whatever the first one was doing becomes a pinch, never a tap
      pinch = spread(f[0], f[1]);
      if (press) press.moved = true;
      return;
    }
    press = over.length || !on() ? null : { id: p.id, ...v(p), moved: false };
  });
  s.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    const f = fingers();
    if (pinch && f.length >= 2) {
      const now = spread(f[0], f[1]);
      if (pinch.d > 0) zoomAt(now.mx, now.my, now.d / pinch.d);
      cx -= (now.mx - pinch.mx) / z;
      cy -= (now.my - pinch.my) / z;
      apply();
      pinch = now;
      return;
    }
    if (!press || press.id !== p.id || !p.isDown) return;
    const at = v(p);
    if (!press.moved && Math.hypot(at.x - press.x, at.y - press.y) < 8) return; // still a tap
    if (!press.moved && opts.pan && !opts.pan(p)) return;
    press.moved = true;
    const prev = { x: p.prevPosition.x / RES, y: p.prevPosition.y / RES };
    cx -= (at.x - prev.x) / z;
    cy -= (at.y - prev.y) / z;
    apply();
  });
  s.input.on('pointerup', () => { if (fingers().length < 2) pinch = null; });
  s.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (!on()) return;
    const at = v(p);
    zoomAt(at.x, at.y, Math.exp(-dy * 0.0015));
  });
  // keyboard on a desktop: +/- zoom about the centre, arrows / WASD pan a fifth of the view
  s.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
    if (!on() || (e.target instanceof HTMLElement && e.target.tagName === 'INPUT')) return;
    const step = VIEW.w / 5 / z;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') zoomAt(VIEW.w / 2, VIEW.h / 2, 1.25);
    else if (k === '-' || k === '_') zoomAt(VIEW.w / 2, VIEW.h / 2, 0.8);
    else if (k === 'arrowleft' || k === 'a') { cx -= step; apply(); }
    else if (k === 'arrowright' || k === 'd') { cx += step; apply(); }
    else if (k === 'arrowup' || k === 'w') { cy -= step; apply(); }
    else if (k === 'arrowdown' || k === 's') { cy += step; apply(); }
  });
  return {
    /** For a pointerup handler: was this press a plain tap on the map? Consumes the press. */
    tap(p: Phaser.Input.Pointer) {
      const ok = !!press && press.id === p.id && !press.moved && !pinch;
      if (press?.id === p.id) press = null;
      return ok;
    },
    get zoom() { return z / zFit; },
  };
}
export type MapCamera = ReturnType<typeof mapCamera>;

/** 减少动态效果 (personal settings): this camera ignores shake and flash for the rest of the scene. */
export function calmCamera(cam: Phaser.Cameras.Scene2D.Camera) {
  const c = cam as unknown as { shake: () => unknown; flash: () => unknown };
  c.shake = () => cam;
  c.flash = () => cam;
}
export const FONT = '"PingFang SC","Microsoft YaHei",sans-serif';

/** Shared palette: deep indigo, warm gold, parchment cream; `slate*` is the flat casual HUD (cards, tray, pills). */
export const PAL = {
  ink: 0x0b1127, navy: 0x161d3c, indigo: 0x232b52, violet: 0x3c3466,
  gold: 0xffd868, goldHi: 0xfff0b0, goldDeep: 0xb98a2c, jade: 0x3a7a4a, ruby: 0xb04030,
  slate: 0x3a5a96, slateHi: 0x5b80c2, slateLo: 0x253c6e, sun: 0xffd23f,
};

/** Flat HUD block: a darker lip under the face, a light top band and a thin white edge. Drawn into `g` at (x, y). */
export function slab(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, face: number = PAL.slate, lip = 4) {
  g.fillStyle(0x0a1530, 0.28).fillRoundedRect(x + 1, y + lip + 3, w - 2, h, r);
  g.fillStyle(shade(face, 0.66), 1).fillRoundedRect(x, y + lip, w, h - lip, r);
  g.fillStyle(face, 1).fillRoundedRect(x, y, w, h - lip, r);
  g.fillStyle(0xffffff, 0.12).fillRoundedRect(x + 4, y + 3, w - 8, Math.min(18, (h - lip) * 0.32), { tl: r - 3, tr: r - 3, bl: 4, br: 4 });
  g.lineStyle(1.5, 0xffffff, 0.45).strokeRoundedRect(x + 0.75, y + 0.75, w - 1.5, h - lip - 1.5, r);
  return g;
}

/** White resource capsule (soft shadow, light grey lip); returns the graphics. */
export function capsule(s: Phaser.Scene, x: number, y: number, w: number, h: number, depth: number) {
  const g = s.add.graphics().setDepth(depth);
  g.fillStyle(0x0a1530, 0.25).fillRoundedRect(x + 1, y + 3, w - 2, h, h / 2);
  g.fillStyle(0xd9dce6, 1).fillRoundedRect(x, y + 2, w, h - 2, (h - 2) / 2);
  g.fillStyle(0xffffff, 1).fillRoundedRect(x, y, w, h - 3, (h - 3) / 2);
  return g;
}
/** Text colors that read on both the dark panels and the cream chips. */
export const TXT = {
  cream: '#fff4cf', gold: '#ffe08a', body: '#f4eed8', dim: '#d9d2b6', cyan: '#a9e6ff',
  ink: '#4a2c10', green: '#8cf09a', red: '#ff8f80', edge: '#1a1008',
};

export const state: { faction: number } = { faction: 0 };

// Height of each sprite above the ground plane (screen px); used for click picking.
export const BUILDING_H: Record<BuildingKind, number> = { core: 30, tower: 50, wall: 16, mine: 26, barracks: 34, aoe: 46 };

export type Pt = Phaser.Math.Vector2; // Phaser's polygon calls want real Vector2s
type Pos = { x: number; y: number };

/** Grid coords (continuous, cell units) to screen. `lift` raises the point above the ground. */
export function proj(gx: number, gy: number, lift = 0): Pt {
  const p = toScreen(gx, gy, lift);
  return new Phaser.Math.Vector2(p.x, p.y);
}

/** Screen to ground-plane grid coords. */
export const unproj = toGrid;

export const inGrid = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID;

/** Bold text rasterised at the canvas resolution (at least 2x) so it stays crisp at any fit. */
export function label(s: Phaser.Scene, x: number, y: number, t: string, size = 16, color = '#f4eed8') {
  return s.add.text(x, y, t, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold' }).setResolution(Math.max(2, RES));
}

/** Heavy white HUD lettering with a thick dark outline, for labels that float straight over the map. */
export function hudText(s: Phaser.Scene, x: number, y: number, t: string, size: number, color = '#ffffff') {
  return outline(label(s, x, y, t, size, color), '#1a1a26', Math.max(3, Math.round(size / 4)));
}

/** Dark outline plus a hard drop shadow: light text stays readable on any background. */
export function outline(t: Phaser.GameObjects.Text, stroke = TXT.edge, thickness = 4) {
  return t.setStroke(stroke, thickness).setShadow(0, 2, '#000000', 0, true, true);
}

export function mix(a: number, b: number, k: number): number {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(a), Phaser.Display.Color.ValueToColor(b), 1, k);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

/** Vertical gradient built from flat bands (no dependency on gradient-fill support). */
export function vGradient(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, top: number, bottom: number, steps = 12, alpha = 1) {
  // whole-pixel band edges so translucent bands do not leave hairline seams
  for (let i = 0; i < steps; i++) {
    const y0 = Math.round(y + (h * i) / steps), y1 = Math.round(y + (h * (i + 1)) / steps);
    g.fillStyle(mix(top, bottom, steps === 1 ? 0 : i / (steps - 1)), alpha).fillRect(x, y0, w, y1 - y0);
  }
  return g;
}

/** Caption on a slate pill with a white hairline: readable over any scene. Returns the text. */
export function caption(s: Phaser.Scene, x: number, y: number, t: string, size = 13, depth = 101, color: string = TXT.cream, minW = 40) {
  const tx = outline(label(s, x, y, t, size, color).setOrigin(0.5), '#1b2a50', 3).setDepth(depth + 0.1);
  // painted dark lacquer inset (ui/hall/inset.png, 98 px tall): round ends kept, only the middle stretches
  const pw = Math.max(minW, tx.width + 22), ph = size + 10, k = ph / 98;
  const bg = s.add.nineslice(x, y, 'hall_inset', undefined, Math.max(96, pw / k), 98, 46, 46, 46, 46).setScale(k).setDepth(depth);
  tx.once(Phaser.GameObjects.Events.DESTROY, () => bg.destroy()); // callers keep the text; tearing it down takes the inset too
  return tx;
}

/** Soft ground shadow under an icon. */
export function dropShadow(s: Phaser.Scene, x: number, y: number, w: number, h: number, depth: number) {
  return s.add.ellipse(x, y, w, h, 0x000000, 0.32).setDepth(depth);
}

// ---- effects: shared textures, sparkles, bursts, count-up, entrance ----

/** Builds the small particle textures once (4-point star, soft glow dot, light rays). */
export function ensureFx(s: Phaser.Scene) {
  if (s.textures.exists('fx_spark')) return;
  const g = s.make.graphics({ x: 0, y: 0 }, false);
  const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
  g.fillStyle(0xffffff, 1).fillPoints([V(16, 0), V(19.5, 12.5), V(32, 16), V(19.5, 19.5), V(16, 32), V(12.5, 19.5), V(0, 16), V(12.5, 12.5)], true);
  g.generateTexture('fx_spark', 32, 32);
  g.clear();
  g.fillStyle(0xffffff, 0.08).fillCircle(16, 16, 16);
  g.fillStyle(0xffffff, 0.14).fillCircle(16, 16, 12);
  g.fillStyle(0xffffff, 0.3).fillCircle(16, 16, 8);
  g.fillStyle(0xffffff, 0.9).fillCircle(16, 16, 4);
  g.generateTexture('fx_glow', 32, 32);
  g.clear();
  for (let pass = 0; pass < 4; pass++) {
    const r = 128 - pass * 26;
    g.fillStyle(0xffffff, 0.08);
    for (let k = 0; k < 12; k++) {
      const a0 = (k * Math.PI) / 6, a1 = a0 + Math.PI / 15;
      g.fillTriangle(128, 128, 128 + Math.cos(a0) * r, 128 + Math.sin(a0) * r, 128 + Math.cos(a1) * r, 128 + Math.sin(a1) * r);
    }
  }
  g.generateTexture('fx_rays', 256, 256);
  g.destroy();
}

/** A star that grows, spins and fades forever; place a few for an ambient shimmer. */
export function twinkle(s: Phaser.Scene, x: number, y: number, depth: number, scale = 0.5, delay = 0, tint = PAL.goldHi) {
  ensureFx(s);
  const st = s.add.image(x, y, 'fx_spark').setDepth(depth).setTint(tint).setAlpha(0).setScale(0).setBlendMode('ADD');
  s.tweens.add({ targets: st, alpha: 1, scale, angle: 90, duration: 650, delay, yoyo: true, repeat: -1, repeatDelay: 500 + Math.random() * 1500, ease: 'Sine.easeInOut' });
  return st;
}

/** One-shot radial burst of stars and glow dots. */
export function burst(s: Phaser.Scene, x: number, y: number, depth: number, n = 18, tints = [PAL.goldHi, PAL.gold, 0xffffff]) {
  ensureFx(s);
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = 50 + Math.random() * 70;
    const p = s.add.image(x, y, i % 3 ? 'fx_spark' : 'fx_glow').setDepth(depth).setTint(tints[i % tints.length]).setBlendMode('ADD').setScale(0.3 + Math.random() * 0.5);
    s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 18, alpha: 0, scale: 0, angle: 180, duration: 700 + Math.random() * 400, ease: 'Cubic.easeOut', onComplete: () => p.destroy() });
  }
}

/** Falling paper pieces for a victory screen. */
export function confetti(s: Phaser.Scene, depth: number, n = 36) {
  const cols = [0xffd868, 0xff7a6a, 0x7fe08a, 0x7fd8ff, 0xffffff];
  for (let i = 0; i < n; i++) {
    const x = Math.random() * VIEW.w, size = 5 + Math.random() * 5;
    const p = s.add.rectangle(x, -12, size, size * 1.6, cols[i % cols.length]).setDepth(depth).setAlpha(0.95);
    s.tweens.add({
      targets: p, x: x + (Math.random() - 0.5) * 120, y: VIEW.h + 20, angle: 360 * (Math.random() > 0.5 ? 1 : -1),
      duration: 2200 + Math.random() * 1800, delay: Math.random() * 900, ease: 'Sine.easeIn', onComplete: () => p.destroy(),
    });
  }
}

/** Rolls a number from `from` to `to`; safe if the text is destroyed mid-way. */
export function countTo(s: Phaser.Scene, tx: Phaser.GameObjects.Text, from: number, to: number, fmt: (n: number) => string = (n) => `${n}`) {
  tx.setText(fmt(from));
  if (from === to) return;
  s.tweens.addCounter({
    from, to, duration: 560, ease: 'Cubic.easeOut',
    onUpdate: (tw) => { if (tx.active) tx.setText(fmt(Math.round(tw.getValue() ?? to))); },
    onComplete: () => { if (tx.active) tx.setText(fmt(to)); },
  });
}

export type Fx = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha;

/** Staggered rise-and-fade for everything added to the scene since display-list index `from`. Hit areas stay put. */
export function intro(s: Phaser.Scene, from: number, delay = 0, rise = 14) {
  (s.children.list.slice(from) as Fx[]).forEach((o, i) => {
    if (o.input) return;
    const a = o.alpha, y = o.y;
    o.setAlpha(0);
    s.tweens.add({ targets: o, alpha: a, y: { from: y + rise, to: y }, delay: delay + Math.min(i, 26) * 14, duration: 300, ease: 'Cubic.easeOut' });
  });
}

/** Hover grow and press squash for an interactive object; `follow` objects get the same scale ratio. */
export function squashFx(s: Phaser.Scene, hit: Phaser.GameObjects.GameObject, main: Fx, base: number, follow: Fx[] = []) {
  const go = (k: number) => {
    s.tweens.add({ targets: main, scale: base * k, duration: 90, ease: 'Sine.easeOut' });
    if (follow.length) s.tweens.add({ targets: follow, scale: k, duration: 90, ease: 'Sine.easeOut' });
  };
  hit.on('pointerover', () => go(1.08)).on('pointerout', () => go(1)).on('pointerdown', () => go(0.92)).on('pointerup', () => go(1.08));
}

/** Face / lip colors of the chunky casual buttons. */
// skin colour and the dark edge its label is outlined in; skins are public/assets/ui/hall/btn_<variant>.png, rebuilt
// from the 英灵殿 concept (scripts/prep_hall.py) so every screen's buttons share that screen's look
const BTN = { navy: [0x1c2c5c, 0x0a1230], red: [0xe0452a, 0x8a1f0c], jade: [0x3fd6c0, 0x0f6a5e], gold: [0xf6c24a, 0x7a4a08] } as const;
const BTN_CAP = 0.8; // each embossed cloud end cap of a skin, as a share of its height; only the plain middle stretches
const BK = Math.max(2, RES); // button faces are baked at this scale and drawn at 1/BK, so they stay crisp at any RES

/** Square icon-button face (ui/tile_<variant>.png, scripts/prep_buttons.py) closest to a flat fill colour. */
export function tileKey(fill: number): string {
  const c = Phaser.Display.Color.IntegerToColor(fill);
  const hsv = Phaser.Display.Color.RGBToHSV(c.red, c.green, c.blue) as { h: number; s: number; v: number };
  const h = hsv.h * 360;
  const v = hsv.s < 0.3 || hsv.v < 0.35 ? 'gray' : h < 20 || h >= 340 ? 'red' : h < 60 ? 'gold' : h < 195 ? 'green' : h < 255 ? 'blue' : 'purple';
  return `ui_tile_${v}`;
}

/**
 * Glossy lacquer tile with a gold rim and cloud corners, `size` px wide, centred at (x, y); icons and labels go on
 * top. Give `h` for a taller card: it is 9-sliced so the corner ornaments keep their shape and only the sides stretch.
 */
export function tileFace(s: Phaser.Scene, x: number, y: number, size: number, fill: number, h?: number) {
  const img = s.add.image(x, y, tileKey(fill));
  const k = size / img.width;
  if (!h || Math.abs(h - img.height * k) < 2) return img.setScale(k);
  const key = img.texture.key, sw = img.width, c = Math.round(sw * 0.26);
  img.destroy();
  return s.add.nineslice(x, y, key, undefined, sw, h / k, c, c, c, c).setScale(k);
}

/** Pick the button variant closest to a flat fill color. */
function buttonArt(fill: number): keyof typeof BTN {
  const c = Phaser.Display.Color.IntegerToColor(fill);
  const hsv = Phaser.Display.Color.RGBToHSV(c.red, c.green, c.blue) as { h: number; s: number; v: number };
  const h = hsv.h * 360;
  if (hsv.s < 0.34 || hsv.v < 0.4) return 'navy';
  if (h < 25 || h > 330) return 'red';
  if (h < 62) return 'gold';
  if (h < 200) return 'jade';
  return 'navy';
}

/**
 * Button face baked once per variant and size at BK x from its painted skin, 3-sliced: the two gold cloud end caps
 * keep their shape (squeezed only when the button is narrower than both caps) and the plain lacquer middle stretches.
 */
function buttonTex(s: Phaser.Scene, v: keyof typeof BTN, w: number, h: number): string {
  const key = `btn4_${v}_${w}x${h}`;
  if (s.textures.exists(key)) return key;
  const src = s.textures.get(`hall_btn_${v}`).getSourceImage() as HTMLImageElement;
  const W2 = Math.round(w * BK), H2 = Math.round(h * BK);
  const t = s.textures.createCanvas(key, W2, H2)!, c = t.getContext();
  c.imageSmoothingQuality = 'high';
  const sw = src.width, sh = src.height, cap = Math.round(sh * BTN_CAP);
  const cw = Math.min(Math.round((cap * H2) / sh), Math.floor(W2 / 2));
  c.drawImage(src, 0, 0, cap, sh, 0, 0, cw, H2);
  c.drawImage(src, sw - cap, 0, cap, sh, W2 - cw, 0, cw, H2);
  if (W2 > cw * 2) c.drawImage(src, cap, 0, sw - cap * 2, sh, cw, 0, W2 - cw * 2, H2);
  t.refresh();
  return key;
}

/**
 * Chunky casual button (face texture baked at 2x and drawn at half scale so edges stay crisp)
 * with an invisible rectangle on top that keeps the old hit-area / setStrokeStyle API.
 */
/**
 * Enlarge a hit area to at least w x h display px around the object's center (shifted down by dy, e.g. to
 * cover a caption under an icon). The art is untouched. 44 CSS px on a landscape phone is ~76 game px.
 */
let rotateHintDone = false;
let rotated = false;
/**
 * The canvas is a fixed 800x650 landscape stage; in a portrait window FIT would shrink it to ~47% and the
 * buttons get too small to tap. Instead we lay the stage out sideways: the scale manager is told the parent is
 * (height x width), the canvas is turned 90deg with CSS, and pointer input is mapped back through the turn.
 * On a phone held sideways (or with rotation unlocked) the window is landscape again and nothing is changed.
 */
export function rotateHint(game: Phaser.Game) {
  if (rotateHintDone || typeof document === 'undefined') return;
  rotateHintDone = true;
  const sm = game.scale as Phaser.Scale.ScaleManager & { getParentBounds(): boolean };
  const im = game.input as Phaser.Input.InputManager;
  const canvas = game.canvas;
  const portrait = () => innerHeight > innerWidth * 1.1;
  const parentBounds = sm.getParentBounds.bind(sm);
  sm.getParentBounds = () => {
    if (!portrait()) return parentBounds();
    const w = innerHeight, h = innerWidth;
    if (sm.parentSize.width === w && sm.parentSize.height === h) return false;
    sm.parentSize.setSize(w, h);
    return true;
  };
  const turn = () => {
    rotated = portrait();
    // FIT centred the stage in a (height x width) box; spin it about its centre and move that centre to the window's
    canvas.style.transformOrigin = '50% 50%';
    canvas.style.transform = rotated ? `translate(${(innerWidth - innerHeight) / 2}px, ${(innerHeight - innerWidth) / 2}px) rotate(90deg)` : '';
    if (rotated) toast('已横屏显示 · 请横握手机');
  };
  const transform = im.transformPointer.bind(im);
  im.transformPointer = (pointer, pageX, pageY, wasMove) => {
    if (!rotated) { transform(pointer, pageX, pageY, wasMove); return; }
    // turned clockwise: stage x runs down the screen, stage y runs right-to-left
    const r = canvas.getBoundingClientRect(), cx = pageX - scrollX, cy = pageY - scrollY;
    pointer.prevPosition.x = pointer.position.x; pointer.prevPosition.y = pointer.position.y;
    pointer.position.x = ((cy - r.top) / r.height) * sm.width; // canvas px; cameras map them to the stage
    pointer.position.y = ((r.right - cx) / r.width) * sm.height;
  };
  sm.on(Phaser.Scale.Events.RESIZE, turn);
  sm.getParentBounds();
  sm.refresh();
  turn();
}

let toastEl: HTMLDivElement | undefined;
/** A short note that never blocks input; shown once per orientation change. */
function toast(t: string) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;left:50%;top:50%;z-index:10;pointer-events:none;padding:10px 18px;border-radius:22px;border:2px solid #f1c75b;'
      + 'background:#0b1127e6;color:#ffe9b0;font:600 16px "PingFang SC","Noto Sans SC",sans-serif;white-space:nowrap;transition:opacity .5s;transform:translate(-50%,-50%) rotate(90deg)';
    document.body.appendChild(toastEl);
  }
  if (toastEl.textContent === t && toastEl.style.opacity === '1') return;
  toastEl.textContent = t;
  toastEl.style.opacity = '1';
  setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2200);
}

export function growHit(o: Phaser.GameObjects.GameObject & { width: number; height: number; scaleX: number; scaleY: number }, w: number, h: number, dy = 0) {
  const area = o.input?.hitArea as Phaser.Geom.Rectangle | undefined;
  if (!area) return o;
  const sx = Math.abs(o.scaleX) || 1, sy = Math.abs(o.scaleY) || 1;
  const lw = Math.max(o.width, w / sx), lh = Math.max(o.height, h / sy);
  area.setTo(o.width / 2 - lw / 2, o.height / 2 - lh / 2 + dy / sy, lw, lh);
  return o;
}

export function button(s: Phaser.Scene, x: number, y: number, w: number, h: number, t: string, fill: number, on: () => void, glow = false) {
  ensureFx(s);
  const sh = s.add.graphics({ x, y });
  sh.fillStyle(0x0a1530, 0.32).fillRoundedRect(-w / 2 + 4, -h / 2 + 5, w - 8, h, h * 0.48);
  // optional breathing halo for the one call-to-action on a screen
  // (the face texture carries its own gloss; `gloss` stays an empty layer so callers can keep fading/layering it)
  const halo = glow ? s.add.image(x, y, 'fx_glow').setTint(PAL.sun).setBlendMode('ADD').setAlpha(0.25).setScale((w * 1.3) / 32, (h * 2.2) / 32) : undefined;
  if (halo) s.tweens.add({ targets: halo, alpha: 0.7, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const v = buttonArt(fill);
  const art = s.add.image(x, y, buttonTex(s, v, w, h)).setScale(1 / BK);
  const gloss = s.add.graphics({ x, y });
  const r = s.add.rectangle(x, y, w, h, fill, 0).setInteractive({ useHandCursor: true });
  const edge = `#${BTN[v][1].toString(16).padStart(6, '0')}`;
  const tx = outline(label(s, x, y - 2, t, 15, '#ffffff').setOrigin(0.5), edge, 4).setShadow(0, 2, edge, 0, true, true);
  let base = 0xffffff; // selection state: bright when selected, dimmed otherwise
  let hot = false, down = false;
  const squash = () => {
    const k = down ? 0.95 : hot ? 1.03 : 1;
    s.tweens.add({ targets: art, scale: k / BK, duration: 90, ease: 'Sine.easeOut' });
    s.tweens.add({ targets: [tx, gloss], scale: k, duration: 90, ease: 'Sine.easeOut' });
  };
  r.on('pointerdown', () => { down = true; squash(); on(); });
  r.on('pointerup', () => { down = false; squash(); });
  r.on('pointerover', () => { hot = true; art.setTint(0xfff6dc); squash(); });
  r.on('pointerout', () => { hot = false; down = false; art.setTint(base); squash(); });
  // Callers still drive the rectangle API; mirror it onto the art so layering and state stay in sync.
  r.setStrokeStyle = (lw?: number, _c?: number, a?: number) => { base = (lw ?? 0) >= 3 || (a ?? 0) >= 1 ? 0xffffff : 0xc4c4c4; art.setTint(base); return r; };
  r.setFillStyle = () => r;
  const setAlpha = r.setAlpha.bind(r), setDepth = r.setDepth.bind(r), setVisible = r.setVisible.bind(r);
  r.setAlpha = (a?: number) => { const v = a ?? 1; art.setAlpha(v); tx.setAlpha(v); gloss.setAlpha(v); sh.setAlpha(v); return setAlpha(a); };
  r.setDepth = (d?: number) => {
    const v = d ?? 0;
    sh.setDepth(v - 0.3); halo?.setDepth(v - 0.2); art.setDepth(v); gloss.setDepth(v + 0.05); tx.setDepth(v + 0.2);
    return setDepth(v + 0.1);
  };
  r.setVisible = (v?: boolean) => {
    const on2 = v ?? true;
    sh.setVisible(on2); halo?.setVisible(on2); art.setVisible(on2); gloss.setVisible(on2); tx.setVisible(on2);
    return setVisible(on2);
  };
  // destroying the rectangle takes every layer with it, so a button can live in a panel that is torn down
  const destroy = r.destroy.bind(r);
  r.destroy = (fromScene?: boolean) => { [sh, halo, art, gloss, tx].forEach((o) => o?.destroy()); destroy(fromScene); };
  return { r, tx, art, halo };
}


export function shade(c: number, f: number): number {
  const ch = (v: number) => Math.min(255, Math.round(v * f));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

function poly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number, alpha = 1) {
  g.fillStyle(color, alpha).fillPoints(pts, true);
}

/**
 * The island itself (ground, path, grid, cliff, backdrop) is a static image baked by drawScenery (island.ts).
 * This only readies the overlay layer drawn above it: hover cells, deploy regions.
 */
export function drawGround(g: Phaser.GameObjects.Graphics) {
  g.clear().setDepth(-1);
}

export { drawScenery, MAP_BOUNDS } from './island';

export function drawCell(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number, alpha: number) {
  poly(g, [proj(cx, cy), proj(cx + 1, cy), proj(cx + 1, cy + 1), proj(cx, cy + 1)], color, alpha);
}

export function strokeRegion(g: Phaser.GameObjects.Graphics, a: number, b: number, color: number, alpha: number) {
  g.lineStyle(2, color, alpha).strokePoints([proj(a, a), proj(b, a), proj(b, b), proj(a, b)], true);
}

/** Frontmost building whose silhouette contains the screen point. */
export function pickBuilding<T extends { kind: BuildingKind; x: number; y: number }>(items: T[], sx: number, sy: number): T | undefined {
  const sorted = [...items].sort((a, b) => b.x + b.y - (a.x + a.y));
  return sorted.find((it) => {
    const h = BUILDING_H[it.kind];
    const { x: cx, y: cy } = it;
    return inPoly([proj(cx, cy, h), proj(cx + 1, cy, h), proj(cx + 1, cy), proj(cx + 1, cy + 1), proj(cx, cy + 1), proj(cx, cy + 1, h)], sx, sy);
  });
}

function inPoly(p: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

/** A ground circle of radius r (cells) is an axis-aligned ellipse on screen. */
export function strokeRing(g: Phaser.GameObjects.Graphics, gx: number, gy: number, r: number, color: number, alpha: number) {
  const c = proj(gx, gy);
  g.lineStyle(3, color, alpha).strokeEllipse(c.x, c.y, r * TW * Math.SQRT2, r * TH * Math.SQRT2);
}

export function drawUnit(g: Phaser.GameObjects.Graphics, gx: number, gy: number, color: number, hero: boolean, flying: boolean, hpFrac: number) {
  g.clear();
  const r = hero ? 9 : 6;
  const lift = flying ? 22 : 0;
  const ground = proj(gx, gy);
  g.fillStyle(0x000000, 0.3).fillEllipse(ground.x, ground.y, r * 2.2, r);
  const b = proj(gx, gy, lift + r);
  g.fillStyle(color, 1).fillCircle(b.x, b.y, r);
  g.lineStyle(1.5, 0xffffff, hero ? 0.9 : 0.5).strokeCircle(b.x, b.y, r);
  g.fillStyle(0x40d060, 1).fillRect(b.x - 8, b.y - r - 6, 16 * Math.max(0, hpFrac), 2);
}

export type Scn = { mode: 'attack' | 'defend' };

export function factionOf(troopId: string) {
  return FACTIONS.find((f) => troopId.startsWith(f.id + '_')) ?? FACTIONS[0];
}
