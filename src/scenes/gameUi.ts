import Phaser from 'phaser';
import { button, caption, drawGround, hudText, ICON, drawScenery, dropShadow, growHit, label, outline, PAL, shade, squashFx, TXT, twinkle, vGradient, VIEW } from './common';

/** Shared pieces for the menu-style screens (expedition, roster): backdrop, plates, icon buttons. */
export const TOP = 600;

/**
 * The player's map (in the world camera of a splitStage with HUD depth >= 400, `view` its visible rect) under a soft
 * blue veil over the whole screen, a few drifting sparkles, and a bottom dock `tray` px tall when given.
 */
export function backdrop(s: Phaser.Scene, skin: string, view: { x: number; y: number; w: number; h: number }, tray = 0) {
  drawScenery(s, skin, view);
  drawGround(s.add.graphics());
  const veil = s.add.graphics().setDepth(400);
  vGradient(veil, 0, 0, VIEW.w, VIEW.h, 0x1d3466, 0x2b4c8a, 14, 0.72);
  for (let i = 0; i < 8; i++) twinkle(s, 40 + ((i * 97) % (VIEW.w - 80)), 70 + ((i * 53) % (VIEW.h - tray - 120)), 401, 0.32 + (i % 3) * 0.1, i * 350);
  if (tray) dock(s, tray);
}

/** Navy lacquer strip with gold trim (hall/bar) along the bottom `h` px of a menu screen, behind its actions. */
export function dock(s: Phaser.Scene, h: number, depth = TOP - 0.5) {
  const l = VIEW.l + 10, r = VIEW.r - 10;
  return nine(s, 'bar', (l + r) / 2, VIEW.h - h / 2 - 4, r - l, h, 18, 40).setDepth(depth);
}

/**
 * The red lacquer ✕ (ui/close) for a popup's top-right corner, `size` px across with a finger-sized hit area.
 * Returns its parts so the popup can tear them down with the rest.
 */
export function closeX(s: Phaser.Scene, x: number, y: number, depth: number, on: () => void, size = 38) {
  const img = s.add.image(x, y, 'ui_close').setDepth(depth);
  const k = size / img.width;
  img.setScale(k);
  const hit = s.add.circle(x, y, Math.max(26, size * 0.7), 0, 0).setDepth(depth + 0.5).setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => img.setScale(k * 1.08)).on('pointerout', () => img.setScale(k))
    .on('pointerdown', () => { img.setScale(k * 0.9); on(); });
  return [img, hit];
}

/** Round navy lacquer back button with a gold rim (hall/back), top-left of every menu screen. */
export function backBtn(s: Phaser.Scene, x: number, y: number, on: () => void) {
  dropShadow(s, x, y + 20, 36, 9, TOP + 1.9);
  const g = s.add.image(x, y, 'hall_back').setDepth(TOP + 2);
  const k = 46 / g.width;
  g.setScale(k);
  const hit = s.add.rectangle(x, y, 64, 64, 0, 0).setDepth(TOP + 3).setInteractive({ useHandCursor: true });
  const to = (f: number) => s.tweens.add({ targets: g, scale: k * f, duration: 90, ease: 'Sine.easeOut' });
  hit.on('pointerover', () => to(1.08)).on('pointerout', () => to(1)).on('pointerdown', () => { to(0.9); on(); });
  return hit;
}

export function text(s: Phaser.Scene, x: number, y: number, t: string, size = 14, color: string = TXT.cream, stroke: string = TXT.edge) {
  return outline(label(s, x, y, t, size, color), stroke, 4).setDepth(TOP + 1);
}

/**
 * Navy lacquer panel with gold cloud-corner trim (hall/panel), centred; `on` lays the glowing gold selected frame
 * over it. Returns a container so callers can fade, hide or re-layer the whole card.
 */
export function plate(s: Phaser.Scene, x: number, y: number, w: number, h: number, on = false) {
  const c = s.add.container(x, y).setDepth(TOP);
  c.add(nine(s, 'panel', 0, 0, w, h, 20, 60));
  if (on) c.add(nine(s, 'card_on', 0, 0, w + 20, h + 20, 22, 70));
  return c;
}

/** Navy currency bar with a gold rim (hall/money), the icon over its left end and the value right-aligned. */
export function chip(s: Phaser.Scene, x: number, w: number, icon: string, value: string, y = 24) {
  const h = 28;
  nine(s, 'money', x + w / 2, y, w, h, (55 * h) / 121, 55).setDepth(TOP);
  s.add.image(x + 6, y, `ui_${icon}`).setScale(36 / ICON).setDepth(TOP + 1);
  return outline(label(s, x + w - 14, y, value, 15, '#ffffff'), TXT.edge, 3).setOrigin(1, 0.5).setDepth(TOP + 1);
}

/** The game's title plate (hall/title): navy with gold cloud ends, the screen name in gold. */
export function titlePlate(s: Phaser.Scene, x: number, y: number, t: string, w = 200, depth = TOP) {
  const img = s.add.image(x, y, 'hall_title').setDepth(depth);
  img.setScale(w / img.width);
  const tx = hudText(s, x, y - 1, t, 22, TXT.gold).setOrigin(0.5).setDepth(depth + 1);
  return { img, tx };
}

/** Square art button with a ground shadow and a caption pill; grows on hover and squashes when pressed. */
export function iconBtn(s: Phaser.Scene, x: number, y: number, key: string, size: number, cap: string, on: () => void) {
  dropShadow(s, x, y + size * 0.42, size * 0.78, size * 0.2, TOP + 1.5);
  const img = s.add.image(x, y, `ui_${key}`).setDepth(TOP + 2).setInteractive({ useHandCursor: true });
  const k = size / img.height;
  img.setScale(k);
  growHit(img, Math.max(76, size + 12), Math.max(76, size + 36), 12);
  squashFx(s, img, img, k);
  img.on('pointerdown', on);
  if (cap) caption(s, x, y + size / 2 + 12, cap, 13, TOP + 2.5);
  return img;
}

export function pill(s: Phaser.Scene, x: number, y: number, w: number, h: number, t: string, fill: number, on: () => void, size = 15, glow = false) {
  const b = button(s, x, y, w, h, t, fill, on, glow);
  b.r.setDepth(TOP + 2);
  b.tx.setFontSize(size);
  return b;
}

/** Row of painted gem pips (hall/pip_on, pip_off), the first n of max lit, for constellation / weapon levels. */
export function pips(s: Phaser.Scene, x: number, y: number, n: number, max: number) {
  const c = s.add.container(x, y).setDepth(TOP + 1);
  for (let i = 0; i < max; i++) {
    const img = s.add.image(i * 18, 0, i < n ? 'hall_pip_on' : 'hall_pip_off');
    c.add(img.setScale(16 / img.width));
  }
  return c;
}

/** Row of painted stars (hall/star_on, star_off) `size` px wide and `gap` apart, centred on x. */
export function stars(s: Phaser.Scene, x: number, y: number, n: number, max: number, size = 14, gap = size + 2) {
  const c = s.add.container(x, y).setDepth(TOP + 1);
  for (let i = 0; i < max; i++) {
    const img = s.add.image((i - (max - 1) / 2) * gap, 0, i < n ? 'hall_star_on' : 'hall_star_off');
    c.add(img.setScale(size / img.width));
  }
  return c;
}

/** Glowing stage under a portrait so a cut-out character does not float on the dark card. */
export function pedestal(s: Phaser.Scene, x: number, y: number, w: number, tint = PAL.gold) {
  s.add.ellipse(x, y + 2, w, w * 0.26, 0x000000, 0.4).setDepth(TOP + 0.7);
  return s.add.image(x, y - 4, 'fx_glow').setTint(tint).setBlendMode('ADD').setAlpha(0.65).setScale(w / 32, (w * 0.34) / 32).setDepth(TOP + 0.8);
}

/** Gold outline that fades in on hover and dims on press; for whole-card hit areas. */
export function cardFx(s: Phaser.Scene, hit: Phaser.GameObjects.GameObject, x: number, y: number, w: number, h: number, r = 16) {
  const g = s.add.graphics({ x, y }).setDepth(TOP + 2.5).setAlpha(0);
  g.lineStyle(8, PAL.gold, 0.22).strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, r + 3);
  g.lineStyle(3, PAL.goldHi, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  const to = (a: number) => s.tweens.add({ targets: g, alpha: a, duration: 120 });
  hit.on('pointerover', () => to(1)).on('pointerout', () => to(0)).on('pointerdown', () => to(0.45)).on('pointerup', () => to(1));
  return g;
}

/**
 * A painted kit piece (hall_<key>) stretched to w x h, centred at (x, y): its corners keep `corner` display px of
 * ornament (cut from a `src`-px band of the art) while the edges and middle stretch.
 */
export function nine(s: Phaser.Scene, key: string, x: number, y: number, w: number, h: number, corner: number, src: number) {
  const k = corner / src;
  return s.add.nineslice(x, y, `hall_${key}`, undefined, w / k, h / k, src, src, src, src).setScale(k);
}

/** Every menu screen's top bar: a soft dark fade, the back button at top-left and the title plate beside it. */
export function header(s: Phaser.Scene, title: string, back: () => void) {
  const g = s.add.graphics().setDepth(TOP - 1);
  for (let i = 0; i < 8; i++) g.fillStyle(0x0a0f1e, 0.06 * (8 - i)).fillRect(0, i * 8, VIEW.w, 8);
  backBtn(s, VIEW.l + 34, 32, back);
  titlePlate(s, VIEW.l + 160, 32, title);
}

/**
 * A round avatar `d` px across, painted once at k x: the unit's civilization colour as a radial gradient and its
 * portrait (por_<id>) framed on the head and shoulders, clipped to the circle. Lay hall_ring over it as the rim.
 */
/** Where the figure sits in a portrait, in image px: its top, its bottom, and the head's centre and width. */
interface Focus { top: number; bottom: number; cx: number; head: number }
const focusCache = new Map<string, Focus>();
/**
 * Art the outline cannot read: wings spread over the head (狮鹫, 天狗), a keg on the shoulder (矮人爆破工), a head
 * that is most of the body (式神狐). The face's centre (x, y) and the head's size, as fractions of the image; checked
 * against the portraits with a contact sheet. Every other portrait is framed from its outline alone.
 */
const FACE: Record<string, [number, number, number]> = {
  eu_gryphon: [0.69, 0.40, 0.38], jp_fox: [0.66, 0.40, 0.62], jp_tengu: [0.57, 0.40, 0.38], eu_bomber: [0.37, 0.44, 0.42],
};

/**
 * Find the figure in a portrait from its opaque pixels, so every crop adapts to the art instead of assuming the
 * head fills the top half of the image. The top is the first row with real substance (a sword tip, an antenna or
 * a single feather is skipped); the head is the opaque span of the figure's upper part, centred on its mass, so a
 * gryphon or a fox whose head sits to one side is still framed on the head.
 */
function focusOf(id: string, img: HTMLImageElement): Focus {
  const hit = focusCache.get(id);
  if (hit) return hit;
  const n = 160, sc = n / Math.max(img.width, img.height, 1);
  const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx2 = cv.getContext('2d', { willReadFrequently: true })!;
  cx2.drawImage(img, 0, 0, w, h);
  const px = cx2.getImageData(0, 0, w, h).data;
  const rows: number[] = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) rows[y]++;
  const most = Math.max(...rows, 1);
  let top = rows.findIndex((c) => c >= most * 0.14), bottom = h - 1;
  while (bottom > 0 && rows[bottom] < most * 0.05) bottom--;
  if (top < 0) top = 0;
  // the upper part of the figure: its opaque span and centre of mass
  const band = top + Math.max(4, (bottom - top) * 0.3);
  let sum = 0, cnt = 0, minX = w, maxX = 0;
  for (let y = top; y < band && y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] <= 40) continue;
    sum += x; cnt++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const tall = bottom - top;
  const span = cnt ? maxX - minX : w * 0.5;
  // chibi heads run about a third of the figure: the span says how wide, but raised weapons, wings and arms widen
  // it, so it is held between 28% and 42% of the figure's height
  const f: Focus = {
    top: top / sc, bottom: bottom / sc,
    cx: (cnt ? sum / cnt : w / 2) / sc,
    head: Math.max(tall * 0.28, Math.min(span, tall * 0.42)) / sc,
  };
  const face = FACE[id];
  if (face) {
    f.cx = face[0] * img.width;
    f.head = face[2] * img.height;
    f.top = face[1] * img.height - f.head * 0.55;
  }
  focusCache.set(id, f);
  return f;
}

export function avatarTex(s: Phaser.Scene, id: string, color: number, d: number, k = 3) {
  const key = `avatar_${id}_${d}`;
  if (s.textures.exists(key)) return key;
  const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const D = d * k, t = s.textures.createCanvas(key, D, D)!, c = t.getContext();
  c.save();
  c.beginPath(); c.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2); c.clip();
  const bg = c.createRadialGradient(D / 2, D * 0.38, 0, D / 2, D / 2, D * 0.62);
  bg.addColorStop(0, css(shade(color, 0.85))); bg.addColorStop(1, css(shade(color, 0.3)));
  c.fillStyle = bg; c.fillRect(0, 0, D, D);
  const img = s.textures.get(`por_${id}`).getSourceImage() as HTMLImageElement;
  // fit the head (found in the art) to the circle: its width a little inside the rim, its top just below it
  const f = focusOf(id, img), sc = (D * 0.92) / (f.head * 1.2);
  c.drawImage(img, D / 2 - f.cx * sc, D * 0.07 - f.top * sc, img.width * sc, img.height * sc);
  c.restore();
  t.refresh();
  return key;
}

/**
 * A hero's banner face, painted once into a texture at k x: the civilization colour as a rounded gradient card, a
 * soft glow and the hero's portrait (por_<id>) cropped to the upper body, full-bleed — a dark-gold silhouette on
 * summoning gold when not owned — shaded at the bottom so tags read. The gold frame is a kit piece laid over it.
 */
export function heroFace(s: Phaser.Scene, id: string, color: number, owned: boolean, w: number, h: number, zoom = 2.5, k = 3) {
  const key = `heroface_${id}_${owned ? 1 : 0}_${w}x${h}_${zoom}`;
  if (s.textures.exists(key)) return key;
  const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const W2 = w * k, H2 = h * k;
  const t = s.textures.createCanvas(key, W2, H2)!, c = t.getContext();
  c.save();
  c.beginPath(); c.roundRect(0, 0, W2, H2, 12 * k); c.clip();
  // owned: the civilization's colour; not yet owned: warm summoning gold, so the card still invites a pull
  const base = owned ? color : 0xd8a040;
  const bg = c.createLinearGradient(0, 0, W2, H2);
  bg.addColorStop(0, css(shade(base, owned ? 0.62 : 0.78))); bg.addColorStop(1, css(shade(base, owned ? 0.22 : 0.32)));
  c.fillStyle = bg; c.fillRect(0, 0, W2, H2);
  const glow = c.createRadialGradient(W2 * 0.64, H2 * 0.4, 0, W2 * 0.64, H2 * 0.4, W2 * 0.48);
  glow.addColorStop(0, `rgba(255,${owned ? 255 : 236},${owned ? 255 : 170},${owned ? 0.38 : 0.45})`); glow.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W2, H2);
  const img = s.textures.get(`por_${id}`).getSourceImage() as HTMLImageElement;
  // zoom above 2 is a bust for banner cards: framed on the head found in the art, like the round avatars. Lower
  // zooms show the figure (portrait height = card height x zoom), centred on the figure rather than the image
  const f = focusOf(id, img), bust = zoom > 2;
  const sc = bust ? (H2 * 0.95) / (f.head * 1.3) : (H2 * zoom) / img.height;
  const pw = img.width * sc, ph = img.height * sc;
  const px = W2 * (bust ? 0.62 : 0.5) - f.cx * sc, py = bust ? H2 * 0.08 - f.top * sc : -H2 * 0.04;
  if (owned) c.drawImage(img, px, py, pw, ph);
  else {
    const sil = document.createElement('canvas');
    sil.width = Math.ceil(pw); sil.height = Math.ceil(ph);
    const sc = sil.getContext('2d')!;
    sc.drawImage(img, 0, 0, pw, ph);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = 'rgba(70,40,8,0.78)'; sc.fillRect(0, 0, pw, ph);
    c.drawImage(sil, px, py);
  }
  const foot = c.createLinearGradient(0, H2 * 0.5, 0, H2);
  foot.addColorStop(0, 'rgba(6,10,28,0)'); foot.addColorStop(1, 'rgba(6,10,28,0.7)');
  c.fillStyle = foot; c.fillRect(0, 0, W2, H2);
  c.restore();
  t.refresh();
  return key;
}

/** A kit tag pill (hall/tag_gold, tag_blue, tag_jade) `w` x `h`, its round ends kept, with a short white label. */
export function tag(s: Phaser.Scene, x: number, y: number, key: string, t: string, w: number, h = 22, size = 12) {
  const src = key === 'tag_jade' ? 60 : 42;
  const p = nine(s, key, x, y, w, h, (src * h) / (key === 'tag_jade' ? 131 : 89), src).setDepth(TOP + 1);
  const tx = outline(label(s, x, y - 1, t, size, '#ffffff'), TXT.edge, 3).setOrigin(0.5).setDepth(TOP + 1.5);
  return { p, tx };
}

/** Art key for one reward / status phrase, picked by what it mentions. */
export function rewardIcon(t: string) {
  if (t.includes('代币')) return 'ui_icon_token';
  if (t.includes('灵石')) return 'ui_icon_stone';
  if (t.includes('遗物') || t.includes('远征') || t.includes('提示')) return 'ui_skill';
  if (t.includes('补给')) return 'ui_speed';
  if (t.includes('战备')) return 'ui_icon_wall';
  if (t.includes('撤离') || t.includes('保留') || t.includes('无损')) return 'ui_flag';
  return 'ui_icon_sword';
}
