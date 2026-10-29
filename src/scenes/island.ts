import Phaser from 'phaser';
import { GRID } from '../core/sim';
import { MAP_SKINS, skinById, type MapSkin } from '../data/maps';
import { H, OY, proj, PY, RES, TH, TW, W } from './common';

/**
 * Floating-island map: a painted backdrop, the island top in the skin's ground texture (projected onto the
 * 2:1 grid), a rim band around the play area for props, and a stone cliff dropping into the clouds.
 * Everything static is baked once per skin into a canvas texture at RES, so it costs one image per scene.
 */
const RIM = 1.4; // cells of island beyond the buildable grid, on every side
const CLIFF = 46; // stage px the cliff hangs below the island's front edges
const DECO_H: Record<string, number> = {
  sakura: 66, pine: 70, tree: 62, bamboo: 60, rock: 32, flowers: 24, lantern: 36, cloud: 44,
  maple: 70, snowpine: 72, snowrock: 32, autumnbush: 28,
};
export const DECO_KEYS = Object.keys(DECO_H);

export function preloadMaps(s: Phaser.Scene) {
  for (const m of MAP_SKINS) {
    s.load.image(`map_${m.id}_sky`, `assets/maps/${m.id}_sky.jpg`);
    if (!m.city) s.load.image(`map_${m.id}_ground`, `assets/maps/${m.id}_ground.jpg`); // only the drawn island uses it
    else {
      s.load.image(`map_${m.id}_city`, `assets/maps/${m.id}_city.webp`);
      s.load.image(`map_${m.id}_thumb`, `assets/maps/${m.id}_thumb.jpg`); // the skin's card in the map panel
    }
  }
  s.load.image('map_cliff', 'assets/maps/cliff.jpg');
}

const img = (s: Phaser.Scene, key: string) => s.textures.get(key).getSourceImage() as HTMLImageElement;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function path(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/** World rect a painted city map covers (keep in sync with scripts/prep_city_map.py). */
const CITY = { x: -400, y: -100, w: 1600, h: 900 };
/** How far a map camera may pan and zoom out (mapCamera): the painted city, less its fade into the clouds below. */
export const MAP_BOUNDS = { x: -400, y: -100, w: 1600, h: 800 };

/** World px the baked island reaches past each side of the W-wide world (its rim and cliff overhang it). */
const PADX = 100;

function bake(s: Phaser.Scene, skin: MapSkin, key: string) {
  const tex = s.textures.createCanvas(key, (W + PADX * 2) * RES, H * RES)!;
  const ctx = tex.getContext();
  ctx.scale(RES, RES);
  ctx.translate(PADX, 0);
  let seed = skin.id.charCodeAt(0) * 977 + skin.id.length * 131;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const T = proj(-RIM, -RIM), R = proj(GRID + RIM, -RIM), B = proj(GRID + RIM, GRID + RIM), L = proj(-RIM, GRID + RIM);
  const slope = Math.atan2(TH / 2, TW / 2) * (180 / Math.PI); // the front edges' screen angle

  // cliff: shadow on the clouds, then the two faces in the shared rock texture with a ragged lower edge
  const rag = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, taper = 0.55 + 0.45 * Math.sin(Math.PI * u);
      pts.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u + CLIFF * taper + (rnd() - 0.5) * 12 });
    }
    return pts;
  };
  ctx.save();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(40,60,90,0.22)';
  path(ctx, [L, B, R, ...rag(R, B).map((p) => ({ x: p.x, y: p.y + 26 })).reverse(), ...rag(B, L).map((p) => ({ x: p.x, y: p.y + 26 })).reverse()]);
  ctx.fill();
  ctx.restore();
  const rock = ctx.createPattern(img(s, 'map_cliff'), 'repeat')!;
  for (const [a, b, ang, shade] of [[L, B, slope, 0], [B, R, -slope, 0.22]] as const) {
    ctx.save();
    path(ctx, [a, b, ...rag(a, b).reverse()]);
    ctx.clip();
    rock.setTransform(new DOMMatrix().translate(a.x, a.y).skewY(ang).scale(96 / 768));
    ctx.fillStyle = rock;
    ctx.fillRect(-PADX, 0, W + PADX * 2, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = skin.cliffTint;
    ctx.fillRect(-PADX, 0, W + PADX * 2, H);
    ctx.globalCompositeOperation = 'source-over';
    const fade = ctx.createLinearGradient(0, Math.min(a.y, b.y), 0, Math.max(a.y, b.y) + CLIFF);
    fade.addColorStop(0, `rgba(20,30,50,${shade})`);
    fade.addColorStop(1, `rgba(20,30,50,${shade + 0.3})`);
    ctx.fillStyle = fade;
    ctx.fillRect(-PADX, 0, W + PADX * 2, H);
    ctx.restore();
  }

  // island top in the ground texture, laid onto the grid's plane (rotate 45 degrees, squash to 2:1)
  ctx.save();
  path(ctx, [T, R, B, L]);
  ctx.clip();
  const ground = ctx.createPattern(img(s, `map_${skin.id}_ground`), 'repeat')!;
  // a large tile so the texture reads as a lawn, not a carpet
  ground.setTransform(new DOMMatrix().translate(W / 2, OY).scale(1, TH / TW).rotate(45).scale(420 / 1024));
  ctx.fillStyle = ground;
  ctx.fillRect(-PADX, 0, W + PADX * 2, H);
  // broad soft patches of light and shade break up the repetition (flattened 2:1 like the ground)
  ctx.save();
  ctx.scale(1, TH / TW);
  const shade = css(skin.cellShade);
  for (let n = 0; n < 46; n++) {
    const x = rnd() * W, y = (OY + rnd() * GRID * TH) * (TW / TH), r = 40 + rnd() * 90, light = rnd() < 0.5;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, light ? 'rgba(255,255,215,0.13)' : `${shade}1c`);
    blob.addColorStop(1, light ? 'rgba(255,255,215,0)' : `${shade}00`);
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  // sunlight from the top-left, falling off toward the front corner
  const sun = ctx.createLinearGradient(W * 0.25, T.y, W * 0.7, B.y);
  sun.addColorStop(0, 'rgba(255,250,215,0.16)');
  sun.addColorStop(1, 'rgba(20,40,20,0.12)');
  ctx.fillStyle = sun;
  ctx.fillRect(-PADX, 0, W + PADX * 2, H);
  // the trodden path from the island's front edge up to the hall: a soft dirt band with stepping stones.
  // The grid itself stays hidden; the base scene shows it locally around the pointer.
  const p0 = proj(10.7, 10.7), p1 = proj(GRID + RIM, GRID + RIM);
  const dirt = (w: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  };
  dirt(30, `${css(skin.cellShade)}22`);
  dirt(24, css(skin.path));
  for (let y = p0.y + 6, side = 1; y < p1.y; y += 11 + rnd() * 9, side = -side) {
    // stepping stones wander from side to side and vary in size, like a worn trail
    const x = p0.x + side * (2 + rnd() * 5), w = 8 + rnd() * 7;
    ctx.fillStyle = 'rgba(70,55,35,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 1.5, w / 2, w / 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, w / 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // lip along the front edges, overhanging the cliff in soft lumps
  ctx.fillStyle = css(skin.lip);
  for (const [a, b] of [[L, B], [B, R]]) {
    ctx.beginPath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = css(skin.lip);
    ctx.moveTo(a.x, a.y + 2); ctx.lineTo(b.x, b.y + 2);
    ctx.stroke();
    for (let n = 0; n < 40; n++) {
      const u = rnd();
      ctx.beginPath();
      ctx.ellipse(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + 4, 3 + rnd() * 3, 2 + rnd() * 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  tex.refresh();
}

/** Props on the rim band: tall ones behind the grid, small ones in front, sorted with the buildings. */
function props(s: Phaser.Scene, skin: MapSkin) {
  let seed = skin.id.charCodeAt(1) * 613 + 17;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const put = (key: string, gx: number, gy: number, depth: number) => {
    const p = proj(gx, gy), h = DECO_H[key] * (0.85 + rnd() * 0.3);
    if (p.x < 10 - PADX || p.x > W + PADX - 10 || p.y - h < 2 || p.y > PY - 4) return;
    const im = s.add.image(p.x, p.y, `deco_${key}`).setOrigin(0.5, 0.94).setDepth(depth);
    im.setScale(h / im.height).setFlipX(rnd() < 0.5);
  };
  const pick = (set: string[]) => set[Math.floor(rnd() * set.length)];
  for (let n = 0; n < 9; n++) {
    const u = (n + 0.2 + rnd() * 0.6) / 9 * (GRID + 1) - 0.5, d = 0.45 + rnd() * 0.75;
    put(pick(rnd() < 0.75 ? skin.tall : skin.small), u, -d, -3 + u * 0.001); // back-right edge
    put(pick(rnd() < 0.75 ? skin.tall : skin.small), -d, u, -3 + u * 0.001); // back-left edge
  }
  for (let n = 0; n < 6; n++) {
    const u = (n + 0.3 + rnd() * 0.4) / 6 * GRID, d = 0.35 + rnd() * 0.6;
    put(pick(skin.small), GRID + d, u, GRID + d + u); // front edges: in front of the grid, so sort like buildings
    put(pick(skin.small), u, GRID + d, GRID + d + u);
  }
}

/**
 * Backdrop, island and props for a map skin, plus a few drifting clouds. Static; created once per scene.
 * The sky painting covers `cover` (the world rect the camera shows), centred a little above the island.
 */
export function drawScenery(s: Phaser.Scene, skinId: string, cover = { x: 0, y: 0, w: W, h: H }) {
  const skin = skinById(skinId);
  const sky = s.add.image(0, 0, `map_${skin.id}_sky`).setDepth(-11);
  const k = Math.max(cover.w / sky.width, cover.h / sky.height), sh = sky.height * k;
  const top = Math.min(cover.y, Math.max(cover.y + cover.h - sh, PY * 0.55 - sh / 2));
  sky.setOrigin(0.5, 0).setPosition(cover.x + cover.w / 2, top).setScale(k);
  if (skin.city) {
    // the painted city: its plaza is the buildable grid, everything around it is in the painting
    s.add.image(CITY.x, CITY.y, `map_${skin.id}_city`).setOrigin(0).setDisplaySize(CITY.w, CITY.h).setDepth(-10);
    return;
  }
  const key = `island2_${skin.id}_${RES}`;
  if (!s.textures.exists(key)) bake(s, skin, key);
  s.add.image(-PADX, 0, key).setOrigin(0).setScale(1 / RES).setDepth(-10);
  props(s, skin);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 3; i++) {
    const cl = s.add.image(90 + i * 300 + rnd() * 60, 22 + rnd() * 30, 'deco_cloud').setAlpha(0.9).setDepth(-5);
    cl.setScale((DECO_H.cloud + rnd() * 14) / cl.height);
    s.tweens.add({ targets: cl, x: cl.x + 40, duration: 8000 + rnd() * 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}
