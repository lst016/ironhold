/**
 * The battle's first-person 3D view (第一人称). A three.js scene over the Phaser canvas that mirrors the running
 * Battle every frame: the Tripo models (scripts/prep_fp3d.mjs → public/assets/3dm) for buildings and troops, their
 * skeletal clips, strikes, tower shots, collapses and skill rings. The battle itself keeps running in BattleScene;
 * this module only reads it, and reaches back through `FpHost` (skill, close).
 *
 * Entering, the camera starts where the 2.5D map is seen from (30 deg down, 45 deg round, the angle the sprites
 * were baked at) and swoops down to the eyes of the followed troop; leaving plays it backwards. Loaded on demand
 * (BattleScene imports it dynamically), so three.js and the models cost nothing until the player opens the view.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GRID, type Battle, type Building, type Unit } from '../core/sim';
import { wallPieces } from '../core/walls';
import type { BuildingKind, TroopDef } from '../data/factions';

export interface FpHost {
  battle: () => Battle;
  /** Model set (civilization id) a building is drawn with. */
  fidOf: (b: Building) => string;
  /** Time left, destruction and whether the clock is in its last seconds, as the 2D HUD shows them. */
  status: () => { time: string; pct: string; warn: boolean };
  /** Cast the hero's skill as the 2D button does; false when it cannot be cast. */
  castSkill: () => boolean;
  /**
   * Attacks only. A card tap sends that troop in at the last deploy point (only selecting it while there is none);
   * a ground tap sends the selected troop in there and makes it the new deploy point. Border rule included.
   */
  deploy?: {
    cards: () => FpCard[];
    card: (i: number) => { ok: boolean; msg: string };
    at: (gx: number, gy: number) => { ok: boolean; msg: string };
    last: () => { x: number; y: number } | null;
  };
  /** The view has flown back out and removed itself. */
  onClosed: () => void;
}

/** One troop card as the 2D row shows it: count left (or 灵气 cost), selected, and whether it can be sent now. */
export interface FpCard { id: string; name: string; hero: boolean; badge: string; sel: boolean; ok: boolean }

type Clip = 'idle' | 'walk' | 'attack';
const DIR = 'assets/3dm/';
const FONT = '"PingFang SC","Microsoft YaHei",sans-serif';
const C = { x: GRID / 2, z: GRID / 2 }; // middle of the battlefield
/** Footprint in cells of each building model (tools/jobs-*.json `fit`), which sets its size on the grid. */
const FIT: Record<BuildingKind, number> = { core: 3, tower: 1.8, mine: 2, wall: 1, barracks: 2.3, aoe: 1.8 };
/** Rigged troops (a mesh plus idle / walk / attack clips) and the seconds of each source clip that are used. */
const RIGGED: Record<string, { attack?: [number, number] }> = {
  cn_sword: { attack: [0.5, 4.5] }, cn_hero: { attack: [0.5, 4.5] }, eu_hero: { attack: [0.5, 4.5] },
  eu_knight: { attack: [0.5, 4.5] }, jp_hero: { attack: [0.5, 4.5] }, jp_tengu: { attack: [0.5, 4.5] },
  cn_ape: { attack: [0.8, 3.2] }, eu_golem: { attack: [0.8, 3.2] }, jp_oni: { attack: [0.8, 3.2] },
  cn_talisman: { attack: [0.6, 4.2] }, eu_archer: { attack: [0.6, 4.2] }, jp_charm: { attack: [0.6, 4.2] },
  jp_fox: {},
};
/** Troops that would not rig: static meshes, with the turn that brings their front to +Z (degrees). */
const STATIC: Record<string, number> = { cn_fly: 0, eu_gryphon: 0, jp_bomber: -90, eu_bomber: -90 };
/** Clip playback lengths (s), matching the 2D battle's pace (sprites.ts WALK_MS / IDLE_MS / ATTACK_MS). */
const WALK_S = 0.76, IDLE_S = 1.8, ATTACK_S = 0.62;
const ISO_FOV = 16, EYE_FOV = 66;

/** Height in cells, feet to head: troops, tanks and heroes as in the 2D battle, a touch shorter for eye level. */
const heightOf = (d: TroopDef) => (d.hero ? 1.6 : d.role === 'tank' ? 1.35 : d.flying ? 1.05 : 1.1);
const hoverOf = (d: TroopDef) => (d.flying ? 0.95 : 0);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// ---------- loading (cached for the page's life, so a second visit is instant) ----------

let loader: GLTFLoader | null = null;
const gltfs = new Map<string, Promise<GLTF | null>>();
function gltf(name: string): Promise<GLTF | null> {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  let p = gltfs.get(name);
  if (!p) {
    // a missing or broken file is drawn as a flat card instead, never an error
    p = loader.loadAsync(DIR + name + '.glb').catch(() => null);
    gltfs.set(name, p);
  }
  return p;
}
const textures = new Map<string, THREE.Texture>();
function texture(url: string, setup?: (t: THREE.Texture) => void) {
  let t = textures.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    setup?.(t);
    textures.set(url, t);
  }
  return t;
}

/** Matte toy look whatever the generator baked in, and shadows both ways. */
function dress(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
      if ('metalness' in mat) { mat.metalness = 0; mat.roughness = Math.max(mat.roughness, 0.7); }
    }
  });
}

/** A building model wrapped so its base sits on y = 0, centred, its bottom slice `fit` cells across. */
function buildingTemplate(g: GLTF, fit: number) {
  const model = g.scene;
  dress(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  // the footprint comes from the bottom slice only, so roofs and arms that overhang do not shrink the model
  const foot = new THREE.Box3(), cut = box.min.y + size.y * 0.12, v = new THREE.Vector3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry.getAttribute('position') : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y <= cut) foot.expandByPoint(v);
    }
  });
  if (foot.isEmpty()) foot.copy(box);
  const fs = foot.getSize(new THREE.Vector3()), k = fit / Math.max(fs.x, fs.z, 1e-3);
  model.scale.multiplyScalar(k);
  model.position.set(-((foot.min.x + foot.max.x) / 2) * k, -box.min.y * k, -((foot.min.z + foot.max.z) / 2) * k);
  const wrap = new THREE.Group();
  wrap.add(model);
  return { wrap, height: size.y * k };
}

/** A troop model wrapped to stand on its feet at the origin, facing +Z, `h` cells to the top of its head. */
function unitTemplate(g: GLTF, h: number, yawDeg: number) {
  const model = g.scene;
  dress(model);
  model.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  // size by the head bone when there is one, so raised weapons, wings and tall hats do not shrink the troop
  let head = 0;
  const v = new THREE.Vector3();
  model.traverse((o) => { if ((o as THREE.Bone).isBone && /(^|:)head(_\d)?$/i.test(o.name)) head = Math.max(head, o.getWorldPosition(v).y - box.min.y); });
  const k = head > 0 ? (h * 0.92) / head : h / Math.max(box.max.y - box.min.y, 1e-3);
  const c = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group(), inner = new THREE.Group();
  inner.add(model);
  inner.scale.setScalar(k);
  inner.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  wrap.add(inner);
  return wrap;
}

/** Pin the hips' horizontal travel to its first key, so walk cycles play in place (as tools/render3d.ts does). */
function inPlace(clip: THREE.AnimationClip) {
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position') || !/hip|pelvis|root/i.test(t.name)) continue;
    const v = t.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  return clip;
}

/** A soft round glow drawn once, for sparks, shots and dust. */
let glowTex: THREE.Texture | null = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * The ground: the 20 x 20 jade plaza of the 2D map with its tile seams and a stone rim, set in a lawn that runs to
 * the island's edge. One canvas, mapped onto the island disc.
 */
function groundTexture(size: number) {
  const px = 2048, k = px / size, c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d')!;
  const at = (gx: number) => (gx - (C.x - size / 2)) * k; // grid units to canvas px (both axes share the centre)
  x.fillStyle = '#6f9e44'; x.fillRect(0, 0, px, px);
  // lawn: many small soft tufts in two greens, scattered at random, so it is not a flat colour up close
  for (let i = 0; i < 9000; i++) {
    const r = 2 + Math.random() * 7;
    x.fillStyle = Math.random() < 0.55 ? 'rgba(84,134,52,0.35)' : 'rgba(150,196,92,0.30)';
    x.beginPath(); x.ellipse(Math.random() * px, Math.random() * px, r, r * 0.6, Math.random() * 3, 0, Math.PI * 2); x.fill();
  }
  const p0 = at(-0.6), p1 = at(GRID + 0.6);
  x.fillStyle = '#cfc4a6'; x.fillRect(p0, p0, p1 - p0, p1 - p0); // stone rim
  const q0 = at(0), q1 = at(GRID);
  x.fillStyle = '#7cc6a2'; x.fillRect(q0, q0, q1 - q0, q1 - q0); // jade plaza, a shade deeper than the 2D map (lit, it reads lighter)
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    x.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.09)' : `rgba(30,90,70,${0.03 + Math.random() * 0.05})`;
    x.fillRect(at(i), at(j), k, k);
  }
  x.strokeStyle = 'rgba(36,100,76,0.5)'; x.lineWidth = 2.5;
  for (let i = 0; i <= GRID; i++) {
    x.beginPath(); x.moveTo(at(i), q0); x.lineTo(at(i), q1); x.stroke();
    x.beginPath(); x.moveTo(q0, at(i)); x.lineTo(q1, at(i)); x.stroke();
  }
  // the carved lotus in the middle of the plaza
  x.strokeStyle = 'rgba(36,100,76,0.4)'; x.lineWidth = 5;
  for (const r of [2.2, 4.4]) { x.beginPath(); x.arc(at(C.x), at(C.z), r * k, 0, Math.PI * 2); x.stroke(); }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    x.beginPath(); x.ellipse(at(C.x) + Math.cos(a) * 3.3 * k, at(C.z) + Math.sin(a) * 3.3 * k, 1.1 * k, 0.45 * k, a, 0, Math.PI * 2); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- the view ----------

interface BObj { root: THREE.Group; kind: BuildingKind; height: number; jolt: number; falling: number; gone: boolean; look: string }
interface UObj {
  root: THREE.Group; body: THREE.Object3D; def: TroopDef; mixer?: THREE.AnimationMixer;
  acts: Partial<Record<Clip, THREE.AnimationAction>>; cur?: Clip; atkUntil: number;
  yaw: number; lastX: number; lastY: number; moving: boolean; dying: number; h: number;
  /** Its own materials (cloned from the shared model), so it can fade alone; 1 solid, 0 hidden. */
  mats: THREE.Material[]; fade: number;
}
interface Bit { s: THREE.Sprite; vx: number; vy: number; vz: number; life: number; max: number; grow: number; fall: number }
interface Shot { s: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; color: number }

export class FirstPerson {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(ISO_FOV, 1, 0.05, 600);
  private root: HTMLDivElement;
  private hud: Record<string, HTMLElement> = {};
  private bObjs = new Map<number, BObj>();
  private uObjs = new Map<number, UObj>();
  private bPrev = new Map<number, { hp: number; cd: number }>();
  private uPrev = new Map<number, { hp: number; cd: number }>();
  private hurtAt = new Map<number, number>(); // unit id -> when it last lost HP, for aiming tower shots
  private rings = new Map<object, THREE.Mesh>();
  private bits: Bit[] = [];
  private shots: Shot[] = [];
  private subject: number | null = null;
  private phase: 'loading' | 'in' | 'live' | 'out' | 'closed' = 'loading';
  private t = 0; // progress of the current fly-in / fly-out
  private from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: EYE_FOV };
  private eye = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private look = { yaw: 0, pitch: 0, drag: false, lx: 0, ly: 0, idle: 0 };
  private overview = 0; // orbit angle while nobody can be followed
  private last = performance.now();
  private endedAt = 0;
  private raf = 0;
  private toastUntil = 0;
  private sunTarget = new THREE.Object3D();
  /** The 2-cell border where troops may land, lit on the ground while any can still be sent. */
  private band: THREE.Group | null = null;
  private pin: THREE.Group | null = null; // marks the last deploy point

  private followNew = false; // a troop was just deployed with nobody followed: follow it once it appears
  private cardLook = '';
  private templates = new Map<string, { wrap: THREE.Group; height: number } | null>();
  private unitTemplates = new Map<string, { wrap: THREE.Group; clips: Partial<Record<Clip, THREE.AnimationClip>> } | null>();
  private onResize = () => this.resize();

  private constructor(private host: FpHost) {
    this.root = document.createElement('div');
    this.root.className = 'fp3d';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.root.appendChild(this.renderer.domElement);
    this.buildHud();
    document.body.appendChild(this.root);
    addEventListener('resize', this.onResize);
    this.resize();
    this.world();
  }

  /** Open the view: loads what this battle needs (showing progress), then flies in. */
  static open(host: FpHost) {
    const v = new FirstPerson(host);
    void v.load();
    v.raf = requestAnimationFrame(v.frame);
    return v;
  }

  /** Fly back out to the map angle, then remove the view. */
  close() {
    if (this.phase === 'out' || this.phase === 'closed') return;
    if (this.phase === 'loading') { this.dispose(); return; }
    this.from.pos.copy(this.cam.position);
    this.from.look.copy(this.eye.look);
    this.from.fov = this.cam.fov;
    this.phase = 'out';
    this.t = 0;
    this.root.classList.add('fp3d-leaving');
  }

  /** Remove at once (the battle scene is shutting down). */
  dispose() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.root.remove();
    this.host.onClosed();
  }

  /** Test-only summary (BattleScene's playtest bridge). */
  snapshot() {
    const c = this.cam.position;
    return {
      phase: this.phase, subject: this.subject, buildings: this.bObjs.size, units: this.uObjs.size,
      models: [...this.templates.values()].filter(Boolean).length + [...this.unitTemplates.values()].filter(Boolean).length,
      cam: [c.x, c.y, c.z].map((n) => +n.toFixed(2)),
      troops: [...this.uObjs].map(([id, o]) => ({ id, fade: +o.fade.toFixed(2), shown: o.body.visible, at: [+o.root.position.x.toFixed(2), +o.root.position.z.toFixed(2)] })),
    };
  }

  // ---------- setup ----------

  private world() {
    const s = this.scene;
    s.background = new THREE.Color(0x7fb8ec);
    s.fog = new THREE.Fog(0xf6ead2, 70, 210);
    s.add(new THREE.HemisphereLight(0xe8f4ff, 0x8f8060, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.5);
    sun.position.set(C.x - 14, 26, C.z + 10);
    this.sunTarget.position.set(C.x, 0, C.z);
    s.add(this.sunTarget);
    sun.target = this.sunTarget;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 80 });
    s.add(sun);

    // island: the lawn and plaza on a disc, a rock skirt under it, a sea of clouds far below
    const R = 26;
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: groundTexture(R * 2), roughness: 0.95 }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(C.x, 0, C.z);
    top.receiveShadow = true;
    s.add(top);
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.55, 10, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x9a8466, roughness: 1 }));
    rock.position.set(C.x, -5.01, C.z);
    s.add(rock);
    // sky: the panorama wrapped round a cylinder, mirrored once so its two ends meet without a seam; the
    // horizon of the painting sits at eye level, and its sea of clouds closes into a floor far below the island
    const SR = 300, SH = (Math.PI * SR) / 3; // each copy of the 3:1 image spans half the circle
    const sky = texture('assets/3dm/sky.webp', (t) => { t.wrapS = THREE.MirroredRepeatWrapping; t.repeat.set(2, 1); });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(SR, SR, SH, 64, 1, true), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false }));
    const skyY = 1 + SH * 0.57 - SH / 2;
    cyl.position.set(C.x, skyY, C.z);
    s.add(cyl);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(SR, 64), new THREE.MeshBasicMaterial({ color: 0xfbe8c8, fog: false }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(C.x, skyY - SH / 2 + 0.5, C.z);
    s.add(sea);
    // drifts of cloud hugging the island below its rim, so it reads as floating
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2, r = R + 2 + Math.random() * 14;
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: i % 3 ? 0xffffff : 0xfff1d8, transparent: true, opacity: 0.85, depthWrite: false }));
      c.position.set(C.x + Math.cos(a) * r, -3 - Math.random() * 7, C.z + Math.sin(a) * r);
      c.scale.set(14 + Math.random() * 12, 7 + Math.random() * 5, 1);
      s.add(c);
    }

    // attacks: the deploy border, a soft wash over the outer two cells with a bright line along its inner edge
    if (this.host.deploy) {
      // a square frame between inset a and inset b cells, flat on the ground
      const frame = (a: number, b: number, color: number, opacity: number, y: number) => {
        const sq = (d: number) => [new THREE.Vector2(d, d), new THREE.Vector2(GRID - d, d), new THREE.Vector2(GRID - d, GRID - d), new THREE.Vector2(d, GRID - d)];
        const shape = new THREE.Shape(sq(a));
        shape.holes.push(new THREE.Path(sq(b).reverse()));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = Math.PI / 2; // shape x, y onto grid x, y
        m.position.y = y;
        m.userData.opacity = opacity;
        return m;
      };
      this.band = new THREE.Group();
      this.band.add(frame(0, 2, 0xffd860, 0.3, 0.025), frame(1.88, 2.06, 0xfff4c0, 0.95, 0.035));
      s.add(this.band);
      // the deploy point the cards send troops to: a gold ring on the ground under a soft beam of light
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.44, 40), new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 2.4, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 1.2;
      this.pin = new THREE.Group();
      this.pin.add(ring, beam);
      this.pin.visible = false;
      s.add(this.pin);
    }
  }

  private buildHud() {
    if (!document.getElementById('fp3d-style')) {
      const st = document.createElement('style');
      st.id = 'fp3d-style';
      st.textContent = `
.fp3d{position:fixed;inset:0;z-index:20;opacity:0;transition:opacity .35s ease;font-family:${FONT};color:#fff;user-select:none;-webkit-user-select:none;touch-action:none}
.fp3d.fp3d-on{opacity:1}.fp3d canvas{display:block;width:100%;height:100%;touch-action:none}
.fp3d-t{text-shadow:0 2px 0 #1a1008,0 0 3px #1a1008,1px 1px 0 #1a1008,-1px -1px 0 #1a1008;font-weight:700}
.fp3d-panel{position:absolute;background:rgba(10,15,30,.58);border:1.5px solid rgba(255,216,104,.75);border-radius:14px;padding:6px 12px}
.fp3d-btn{position:absolute;border:2px solid #fff0b0;border-radius:999px;padding:0 18px;height:clamp(34px,7vh,46px);font:700 clamp(13px,2.3vh,17px) ${FONT};color:#fff;cursor:pointer;
 box-shadow:0 4px 0 rgba(0,0,0,.35),inset 0 2px 0 rgba(255,255,255,.35);text-shadow:0 2px 0 rgba(0,0,0,.45)}
.fp3d-btn:active{transform:translateY(2px) scale(.97)}
.fp3d-red{background:linear-gradient(#ef6a52,#c2382a)}.fp3d-navy{background:linear-gradient(#4a6ab8,#253c6e)}.fp3d-gold{background:linear-gradient(#ffd868,#d9952a);color:#4a2c10;text-shadow:none}
.fp3d-bar{height:7px;border-radius:4px;background:#0b0f18;overflow:hidden;margin-top:4px}.fp3d-bar>i{display:block;height:100%;background:linear-gradient(#8cf09a,#3aa84e)}
.fp3d-toast{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-size:clamp(16px,3.4vh,26px);opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap}
.fp3d-cross{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px;border-radius:50%;border:2px solid rgba(255,255,255,.55);pointer-events:none}
.fp3d-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(15px,3vh,22px);background:rgba(8,12,26,.35)}
.fp3d-cards{position:absolute;left:50%;bottom:max(8px, env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:6px;align-items:flex-end}
.fp3d-card{position:relative;width:clamp(46px,8.4vh,64px);height:clamp(54px,9.8vh,74px);padding:0;border:2px solid #fff0b0;border-radius:10px;overflow:hidden;cursor:pointer;
 background:linear-gradient(#6f9cf0,#2f58b8);box-shadow:0 3px 0 rgba(0,0,0,.35);transition:transform .12s,filter .12s;font:700 10px ${FONT};color:#fff}
.fp3d-card.hero{background:linear-gradient(#ffd35a,#d98a20)}.fp3d-card.sel{transform:translateY(-7px) scale(1.06);border-color:#fff;box-shadow:0 0 0 2px #fff,0 6px 10px rgba(0,0,0,.4)}
.fp3d-card.off{filter:grayscale(.85) brightness(.75)}
.fp3d-card img{position:absolute;left:4%;top:2%;width:92%;height:78%;object-fit:contain;pointer-events:none}
.fp3d-card b{position:absolute;left:3px;top:3px;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:rgba(10,15,30,.75);border:1.5px solid #fff;font-size:11px;text-align:center}
.fp3d-card span{position:absolute;left:0;right:0;bottom:0;height:16px;line-height:16px;background:rgba(10,15,30,.55);text-shadow:0 1px 0 #000;white-space:nowrap;overflow:hidden}
.fp3d-leaving .fp3d-panel,.fp3d-leaving .fp3d-btn,.fp3d-leaving .fp3d-cross,.fp3d-leaving .fp3d-cards{opacity:0;transition:opacity .2s}`;
      document.head.appendChild(st);
    }
    const el = (tag: string, cls: string, css: string, text = '') => {
      const e = document.createElement(tag);
      e.className = cls;
      e.style.cssText = css;
      e.textContent = text;
      this.root.appendChild(e);
      return e;
    };
    const pad = 'max(12px, env(safe-area-inset-left))';
    this.hud.who = el('div', 'fp3d-panel fp3d-t', `left:${pad};top:12px;min-width:150px;font-size:clamp(13px,2.4vh,16px)`);
    this.hud.time = el('div', 'fp3d-panel fp3d-t', 'left:50%;top:12px;transform:translateX(-50%);font-size:clamp(15px,3vh,22px)');
    this.hud.pct = el('div', 'fp3d-panel fp3d-t', 'right:max(12px, env(safe-area-inset-right));top:12px;font-size:clamp(13px,2.4vh,16px)');
    this.hud.cross = el('div', 'fp3d-cross', '');
    this.hud.toast = el('div', 'fp3d-toast fp3d-t', '');
    const exit = el('button', 'fp3d-btn fp3d-red', `left:${pad};bottom:max(14px, env(safe-area-inset-bottom))`, '退出视角');
    exit.onclick = () => this.close();
    // the follow switch sits on the bottom edge, or just above the troop cards when the view can deploy
    const sw = this.host.deploy ? 'calc(max(8px, env(safe-area-inset-bottom)) + clamp(64px, 11vh, 86px))' : 'max(14px, env(safe-area-inset-bottom))';
    const prev = el('button', 'fp3d-btn fp3d-navy', `left:50%;bottom:${sw};transform:translateX(calc(-100% - 70px))`, '◀');
    const next = el('button', 'fp3d-btn fp3d-navy', `left:50%;bottom:${sw};transform:translateX(70px)`, '▶');
    this.hud.name = el('div', 'fp3d-t', `position:absolute;left:50%;bottom:calc(${sw} + 10px);transform:translateX(-50%);font-size:clamp(13px,2.4vh,16px);white-space:nowrap`);
    prev.onclick = () => this.cycle(-1);
    next.onclick = () => this.cycle(1);
    this.hud.skill = el('button', 'fp3d-btn fp3d-gold', 'right:max(12px, env(safe-area-inset-right));bottom:max(14px, env(safe-area-inset-bottom))', '释放技能');
    this.hud.skill.onclick = () => { if (this.host.castSkill()) this.toast('技能释放!'); else this.toast('先部署英雄；每场技能只能释放一次'); };
    const buttons = [exit, prev, next, this.hud.skill];
    // troop cards: the same choice as the 2D row; tap one, then tap the glowing border on the ground
    if (this.host.deploy) {
      this.hud.cards = el('div', 'fp3d-cards', '');
      this.host.deploy.cards().forEach((cd, i) => {
        const b = document.createElement('button');
        b.className = `fp3d-card${cd.hero ? ' hero' : ''}`;
        b.innerHTML = `<img src="assets/units/${cd.id}.png" alt=""><b></b><span>${cd.name}</span>`;
        b.onclick = () => this.cardTap(i);
        this.hud.cards.appendChild(b);
        buttons.push(b);
      });
    }
    this.hud.load = el('div', 'fp3d-load fp3d-t', '', '正在进入 3D 战场…');
    for (const b of buttons) b.addEventListener('pointerdown', (e) => e.stopPropagation());

    // drag anywhere to look around; the view drifts back to straight ahead a moment after letting go. A press that
    // barely moves is a tap: in an attack it sends the selected troop in where it lands on the ground
    const c = this.renderer.domElement;
    const down = { x: 0, y: 0, t: 0 };
    c.addEventListener('pointerdown', (e) => {
      this.look.drag = true; this.look.lx = e.clientX; this.look.ly = e.clientY;
      Object.assign(down, { x: e.clientX, y: e.clientY, t: performance.now() });
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.look.drag) return;
      const k = 3.2 / Math.max(innerWidth, innerHeight);
      this.look.yaw = Math.max(-2.6, Math.min(2.6, this.look.yaw - (e.clientX - this.look.lx) * k));
      this.look.pitch = Math.max(-0.7, Math.min(0.55, this.look.pitch - (e.clientY - this.look.ly) * k));
      this.look.lx = e.clientX; this.look.ly = e.clientY; this.look.idle = 0;
    });
    const up = (e: PointerEvent) => {
      this.look.drag = false; this.look.idle = 0;
      if (e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && performance.now() - down.t < 450) this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  /** A tap on the 3D view: find the ground under it and deploy there (the host applies the border rule). */
  private tap(cx: number, cy: number) {
    const d = this.host.deploy;
    if (!d || this.phase !== 'live') return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit) { this.toast('请点击地面部署'); return; }
    this.landed(d.at(hit.x, hit.z));
  }

  /** A card tap: that troop goes in at the last deploy point at once (the first time, it only picks the card). */
  private cardTap(i: number) {
    const d = this.host.deploy;
    if (!d || this.phase === 'out' || this.phase === 'closed') return;
    this.landed(d.card(i));
  }

  /** After a deploy attempt: say what happened; on success a burst where they land and, with nobody followed, ride along. */
  private landed(res: { ok: boolean; msg: string }) {
    if (res.msg) this.toast(res.msg, 1100);
    const at = this.host.deploy?.last();
    if (!res.ok || !at) return;
    this.sparks(new THREE.Vector3(at.x, 0.3, at.y), 0xfff0b0, 14, 1.2);
    if (this.subject === null) this.followNew = true;
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  private toast(t: string, ms = 1400) {
    this.hud.toast.textContent = t;
    this.hud.toast.style.opacity = '1';
    this.toastUntil = performance.now() + ms;
  }

  /** Every model this battle can show: its buildings, the troops on the field and all that could still be sent. */
  private async load() {
    const b = this.host.battle();
    const bKeys = new Set(b.buildings.map((x) => `${this.host.fidOf(x)}_${x.kind}`));
    const ids = new Set<string>([...b.units.map((u) => u.def.id), ...Object.keys(b.pool ?? {}), ...b.spawns.map((s) => s.def.id)]);
    if (ids.has('jp_hero')) ids.add('jp_fox'); // the 阴阳师's skill calls foxes
    const jobs: Promise<void>[] = [];
    let done = 0;
    const total = bKeys.size + ids.size;
    const tick = () => { done++; this.hud.load.textContent = `正在进入 3D 战场… ${Math.round((done / Math.max(1, total)) * 100)}%`; };
    for (const key of bKeys) jobs.push(gltf(key).then((g) => {
      this.templates.set(key, g ? buildingTemplate(g, FIT[key.split('_').slice(1).join('_') as BuildingKind]) : null);
      tick();
    }));
    for (const id of ids) jobs.push(this.loadUnit(id).then(tick));
    await Promise.all(jobs);
    if (this.phase !== 'loading') return;
    this.hud.load.remove();
    this.sync(0);
    this.subject = this.pickSubject();
    this.isoPose(this.from);
    this.cam.position.copy(this.from.pos);
    this.cam.fov = this.from.fov;
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(this.from.look);
    this.phase = 'in';
    this.t = -0.35; // hold on the map angle while the view fades in, then swoop
    this.root.classList.add('fp3d-on');
    if (this.host.deploy) this.toast(this.host.deploy.last() ? '点兵卡即在上次部署点出兵 · 点地面边缘可换部署点' : '先点地面边缘发光区选部署点，之后点兵卡即可出兵', 2600);
    else if (this.subject === null) this.toast('还没有可跟随的兵种', 2200);
  }

  private async loadUnit(id: string) {
    if (this.unitTemplates.has(id)) return;
    if (RIGGED[id]) {
      const [rig, ...clips] = await Promise.all([gltf(id), gltf(`${id}_idle`), gltf(`${id}_walk`), gltf(`${id}_attack`)]);
      if (!rig) { this.unitTemplates.set(id, null); return; }
      const out: Partial<Record<Clip, THREE.AnimationClip>> = {};
      (['idle', 'walk', 'attack'] as Clip[]).forEach((name, i) => {
        let a = clips[i]?.animations[0];
        if (!a) return;
        // keep only the useful seconds of long source clips (a 15 s fidget, a slash with a long recovery)
        const range = name === 'idle' ? [0, 3] : name === 'attack' ? RIGGED[id].attack : undefined;
        if (range) a = THREE.AnimationUtils.subclip(a, name, Math.round(range[0] * 30), Math.round(Math.min(range[1], a.duration) * 30), 30);
        out[name] = inPlace(a);
      });
      this.unitTemplates.set(id, { wrap: unitTemplate(rig, 1, -90), clips: out });
    } else if (id in STATIC) {
      const g = await gltf(id);
      this.unitTemplates.set(id, g ? { wrap: unitTemplate(g, 1, STATIC[id]), clips: {} } : null);
    } else this.unitTemplates.set(id, null);
  }

  // ---------- per frame ----------

  private frame = () => {
    if (this.phase === 'closed') return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'loading') return;
    this.sync(dt);
    this.camera(dt);
    this.effects(dt);
    this.updateHud(now);
    this.renderer.render(this.scene, this.cam);
  };

  /** Bring the scene in line with the battle: new and fallen buildings, troops, strikes and shots. */
  private sync(dt: number) {
    const b = this.host.battle(), now = performance.now();
    const standing = b.buildings.filter((x) => x.hp > 0);
    const walls = new Set(standing.filter((x) => x.kind === 'wall').map((x) => `${Math.floor(x.x)},${Math.floor(x.y)}`));
    for (const bl of b.buildings) {
      const prev = this.bPrev.get(bl.id);
      this.bPrev.set(bl.id, { hp: bl.hp, cd: bl.cd });
      let o = this.bObjs.get(bl.id);
      if (!o) { o = this.addBuilding(bl); this.bObjs.set(bl.id, o); }
      if (!prev) continue;
      if (prev.hp - bl.hp > 0.5) o.jolt = 0.09;
      if (bl.hp <= 0 && prev.hp > 0) { o.falling = 0.001; this.dust(bl.x, bl.y, o.height); }
      else if (bl.hp > 0 && bl.cd > prev.cd + 0.05) this.towerShot(bl, o, b.units);
      // walls re-join over the gaps as their neighbours fall
      if (bl.kind === 'wall' && bl.hp > 0) {
        const cx = Math.floor(bl.x), cy = Math.floor(bl.y);
        const look = wallPieces((x, y) => walls.has(`${x},${y}`), cx, cy, bl.dir).map((p) => p.axis + p.half).join();
        if (look !== o.look) this.layWall(o, bl);
      }
    }
    for (const o of this.bObjs.values()) {
      if (o.jolt > 0) { o.jolt -= dt; o.root.children[0].position.x = o.jolt > 0 ? Math.sin(now / 14) * 0.035 : 0; }
      if (o.falling > 0 && !o.gone) {
        o.falling += dt;
        const k = Math.min(1, o.falling / 0.7);
        o.root.scale.y = 1 - k * 0.85;
        o.root.position.y = -k * 0.15;
        if (k >= 1) { o.gone = true; o.root.visible = false; this.rubble(o); }
      }
    }

    const alive = new Set<number>();
    for (const u of b.units) {
      alive.add(u.id);
      let o = this.uObjs.get(u.id);
      if (!o) { o = this.addUnit(u); this.uObjs.set(u.id, o); }
      const prev = this.uPrev.get(u.id);
      this.uPrev.set(u.id, { hp: u.hp, cd: u.cd });
      if (prev && prev.hp - u.hp > 0.5) { this.hurtAt.set(u.id, now); this.sparks(new THREE.Vector3(u.x, hoverOf(u.def) + o.h * 0.55, u.y), 0xfff2d8, 3, 0.6); }
      const tgt = u.target === null ? undefined : b.buildings.find((x) => x.id === u.target);
      if (prev && u.cd > prev.cd + 0.05) this.strike(u, o, tgt);
      this.moveUnit(o, u, tgt, dt, now);
    }
    for (const [id, o] of this.uObjs) {
      if (alive.has(id)) continue;
      if (o.dying === 0) {
        o.dying = 0.001;
        this.sparks(o.root.position.clone().setY(o.h * 0.5 + o.root.position.y), 0xffffff, 8, 1);
        if (id === this.subject) this.toast('跟随的兵种阵亡');
      }
      o.dying += dt;
      const k = Math.min(1, o.dying / 0.55);
      o.root.scale.setScalar(1 - k * 0.6);
      o.root.position.y -= dt * 0.8;
      if (k >= 1) { this.scene.remove(o.root); this.uObjs.delete(id); this.uPrev.delete(id); }
      o.mixer?.update(dt);
    }

    // skill rings: one flat ring per sim effect, growing as it fades
    const live = new Set<object>();
    for (const f of b.fx) {
      live.add(f);
      let m = this.rings.get(f);
      if (!m) {
        m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: f.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(f.x, 0.06, f.y);
        this.scene.add(m);
        this.rings.set(f, m);
        this.sparks(new THREE.Vector3(f.x, 0.6, f.y), f.color, 18, f.r * 0.7);
      }
      const life = Math.min(1, f.life);
      m.scale.setScalar(f.r * (1.15 - life * 0.25));
      (m.material as THREE.MeshBasicMaterial).opacity = life;
    }
    for (const [f, m] of this.rings) if (!live.has(f)) { this.scene.remove(m); m.geometry.dispose(); this.rings.delete(f); }

    if (this.subject !== null && !this.uObjs.has(this.subject) && this.phase !== 'out') this.subject = this.pickSubject();
    // just deployed from the view with nobody to follow: ride along with the troop that landed
    if (this.followNew && b.units.length) {
      this.followNew = false;
      this.subject = b.units.reduce((a, u) => (u.id > a.id ? u : a)).id;
      this.look.yaw = this.look.pitch = 0;
    }
    if (b.result !== 'running') {
      if (!this.endedAt) this.endedAt = now;
      else if (now - this.endedAt > 1300 && this.phase === 'live') this.close(); // let the last collapse land, then hand back for the result
    }
  }

  private addBuilding(bl: Building): BObj {
    const root = new THREE.Group(), holder = new THREE.Group();
    root.add(holder);
    root.position.set(bl.x, 0, bl.y);
    const tpl = this.templates.get(`${this.host.fidOf(bl)}_${bl.kind}`);
    const o: BObj = { root, kind: bl.kind, height: tpl?.height ?? 1.5, jolt: 0, falling: 0, gone: bl.hp <= 0, look: '' };
    if (bl.kind === 'wall') this.layWall(o, bl);
    else if (tpl) {
      const m = tpl.wrap.clone();
      // facing 1 is the model turned 90 degrees; barracks and 法阵塔 show their door with the 270 degree turn
      m.rotation.y = bl.dir ? (bl.kind === 'barracks' || bl.kind === 'aoe' ? -Math.PI / 2 : Math.PI / 2) : 0;
      holder.add(m);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(FIT[bl.kind] * 0.8, 1.2, FIT[bl.kind] * 0.8), new THREE.MeshStandardMaterial({ color: 0xc8a878 }));
      box.position.y = 0.6;
      holder.add(box);
    }
    root.visible = !o.gone;
    this.scene.add(root);
    return o;
  }

  /** A wall: one full segment on a straight run, half segments meeting in the cell at corners and T junctions. */
  private layWall(o: BObj, bl: Building) {
    const b = this.host.battle();
    const walls = new Set(b.buildings.filter((x) => x.kind === 'wall' && x.hp > 0).map((x) => `${Math.floor(x.x)},${Math.floor(x.y)}`));
    const cx = Math.floor(bl.x), cy = Math.floor(bl.y);
    const pieces = wallPieces((x, y) => walls.has(`${x},${y}`), cx, cy, bl.dir);
    o.look = pieces.map((p) => p.axis + p.half).join();
    const holder = o.root.children[0] as THREE.Group;
    holder.clear();
    const tpl = this.templates.get(`${this.host.fidOf(bl)}_wall`);
    for (const p of pieces) {
      const g = new THREE.Group(), s = new THREE.Group();
      // the model runs along x; the y axis is the same model turned a quarter
      g.rotation.y = p.axis === 'y' ? Math.PI / 2 : 0;
      if (p.half !== 'full') {
        s.scale.x = 0.5;
        const off = p.half === 'pos' ? 0.25 : -0.25;
        g.position.set(p.axis === 'x' ? off : 0, 0, p.axis === 'y' ? off : 0);
      }
      s.add(tpl ? tpl.wrap.clone() : new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.3), new THREE.MeshStandardMaterial({ color: 0xc9b48a })));
      g.add(s);
      holder.add(g);
    }
  }

  private rubble(o: BObj) {
    const r = FIT[o.kind] * 0.42;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshStandardMaterial({ color: 0x6d6250, roughness: 1, transparent: true, opacity: 0.75 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(o.root.position.x, 0.02, o.root.position.z);
    m.receiveShadow = true;
    this.scene.add(m);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08 + Math.random() * 0.1), new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 1 }));
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      s.position.set(o.root.position.x + Math.cos(a) * d, 0.06, o.root.position.z + Math.sin(a) * d);
      s.castShadow = true;
      this.scene.add(s);
    }
  }

  private addUnit(u: Unit): UObj {
    const h = heightOf(u.def), tpl = this.unitTemplates.get(u.def.id);
    const root = new THREE.Group();
    let body: THREE.Object3D;
    const o: UObj = { root, body: root, def: u.def, acts: {}, atkUntil: 0, yaw: 0, lastX: u.x, lastY: u.y, moving: false, dying: 0, h, mats: [], fade: 1 };
    if (tpl) {
      body = RIGGED[u.def.id] ? cloneSkinned(tpl.wrap) : tpl.wrap.clone();
      body.scale.setScalar(h);
      if (RIGGED[u.def.id]) {
        o.mixer = new THREE.AnimationMixer(body);
        for (const [name, clip] of Object.entries(tpl.clips) as [Clip, THREE.AnimationClip][]) {
          const a = o.mixer.clipAction(clip);
          a.timeScale = clip.duration / (name === 'walk' ? WALK_S : name === 'idle' ? IDLE_S : ATTACK_S);
          if (name === 'idle') a.setLoop(THREE.LoopPingPong, Infinity); // the idle excerpt does not loop seamlessly
          if (name === 'attack') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
          o.acts[name] = a;
        }
        o.mixer.update(Math.random() * 2); // so a squad does not breathe in step
      }
    } else {
      // no model: the troop's flat art on a card that always faces the camera
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(`assets/units/${u.def.id}.png`), transparent: true, alphaTest: 0.1 }));
      sp.center.set(0.5, 0.03);
      const img = sp.material.map!.image as HTMLImageElement | undefined;
      const aspect = img && img.width ? img.width / img.height : 0.8;
      sp.scale.set(h * aspect, h, 1);
      body = sp;
    }
    root.add(body);
    o.body = body;
    // own copies of the materials (clones share them), remembering how each was set so solid restores it
    body.traverse((n) => {
      const m = n as THREE.Mesh, sp = n as THREE.Sprite;
      if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      else if (!sp.isSprite) return;
      for (const mat of [m.material].flat() as THREE.Material[]) {
        mat.userData = { ...mat.userData, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
        o.mats.push(mat);
      }
    });
    // a soft blob under every troop (flyers too, left on the ground)
    const shade = new THREE.Mesh(new THREE.CircleGeometry(0.28 * (u.def.hero ? 1.3 : u.def.role === 'tank' ? 1.15 : 1), 20), new THREE.MeshBasicMaterial({ color: 0x10200c, transparent: true, opacity: 0.25, depthWrite: false }));
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.015 - hoverOf(u.def);
    shade.name = 'shade';
    root.add(shade);
    root.position.set(u.x, hoverOf(u.def), u.y);
    this.scene.add(root);
    return o;
  }

  /** Ease a troop's opacity toward `target` (1 solid, 0 gone); materials only change while it moves. */
  private fade(o: UObj, target: number, dt: number) {
    if (o.fade === target) return;
    o.fade = Math.abs(target - o.fade) < 0.02 ? target : o.fade + (target - o.fade) * Math.min(1, dt * 12);
    const solid = o.fade >= 1;
    for (const m of o.mats) {
      const see = !solid || !!m.userData.transparent;
      // whether a material is transparent is compiled into its shader (opaque ones force alpha to 1): rebuild on change
      if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
      m.opacity = solid ? m.userData.opacity ?? 1 : o.fade;
      m.depthWrite = solid ? m.userData.depthWrite ?? true : false;
    }
    o.body.visible = o.fade > 0.03;
  }

  private play(o: UObj, clip: Clip) {
    const a = o.acts[clip] ?? o.acts.walk;
    if (!a || o.cur === clip) return;
    const old = o.cur ? o.acts[o.cur] : undefined;
    a.reset().play();
    if (old && old !== a) old.crossFadeTo(a, 0.12, false);
    o.cur = clip;
  }

  /** Follow the sim: walk along the path, turn toward the target to strike, bob in the air when flying. */
  private moveUnit(o: UObj, u: Unit, tgt: Building | undefined, dt: number, now: number) {
    const dx = u.x - o.lastX, dy = u.y - o.lastY;
    const moving = Math.hypot(dx, dy) > 0.002;
    o.lastX = u.x; o.lastY = u.y;
    const fx = moving ? dx : tgt ? tgt.x - u.x : 0, fy = moving ? dy : tgt ? tgt.y - u.y : 0;
    if (Math.hypot(fx, fy) > 0.001) o.yaw = lerpAngle(o.yaw, Math.atan2(fx, fy), Math.min(1, dt * 10));
    o.root.rotation.y = o.yaw;
    const bob = u.def.flying ? Math.sin(now / 280 + u.id) * 0.06 : 0;
    o.root.position.set(u.x, hoverOf(u.def) + bob, u.y);
    o.moving = moving;
    if (o.mixer) {
      if (now < o.atkUntil) this.play(o, 'attack');
      else this.play(o, moving ? 'walk' : o.acts.idle ? 'idle' : 'walk');
      if (!moving && !o.acts.idle && o.cur === 'walk') o.acts.walk!.paused = true; // quadrupeds: stand still on the walk pose
      else if (o.acts.walk) o.acts.walk.paused = false;
      o.mixer.update(dt);
    } else if (o.body instanceof THREE.Sprite) {
      // the flat art loads after the card is made: take its real proportions once it arrives
      const img = o.body.material.map?.image as HTMLImageElement | undefined;
      if (img?.width) o.body.scale.x = o.h * (img.width / img.height);
    } else {
      // static meshes: a little step bounce or breath, as the flat sprites do
      o.body.position.y = moving ? Math.abs(Math.sin(now / 90 + u.id)) * 0.05 : 0;
    }
  }

  /** A troop struck its target: the swing, then a spark on the building, or a bolt for archers and casters. */
  private strike(u: Unit, o: UObj, tgt: Building | undefined) {
    o.atkUntil = performance.now() + Math.min(ATTACK_S, u.def.interval * 0.9) * 1000;
    if (o.acts.attack) { o.cur = undefined; o.acts.attack.reset(); }
    if (!tgt) return;
    const bo = this.bObjs.get(tgt.id);
    const r = FIT[tgt.kind] * 0.4, d = Math.hypot(u.x - tgt.x, u.y - tgt.y) || 1;
    const hit = new THREE.Vector3(tgt.x + ((u.x - tgt.x) / d) * r, Math.min((bo?.height ?? 1.5) * 0.45, 1.2), tgt.y + ((u.y - tgt.y) / d) * r);
    const color = u.def.hero ? 0xfff0b0 : u.def.heal ? 0x9cffb0 : 0xffe2a8;
    if (u.def.range > 2) this.shoot(new THREE.Vector3(u.x, hoverOf(u.def) + o.h * 0.7, u.y), hit, color, 0.22);
    else this.sparks(hit, color, u.def.hero ? 9 : 5, 0.9);
  }

  /** A tower fired: a bolt from its top to the troop that was just hit (or the nearest one). */
  private towerShot(bl: Building, o: BObj, units: Unit[]) {
    const now = performance.now();
    let best: Unit | undefined, bd = Infinity;
    for (const u of units) {
      const fresh = now - (this.hurtAt.get(u.id) ?? -1e9) < 120;
      const d = Math.hypot(u.x - bl.x, u.y - bl.y) - (fresh ? 100 : 0);
      if (d < bd) { bd = d; best = u; }
    }
    if (!best) return;
    const from = new THREE.Vector3(bl.x, o.height * 0.85, bl.y);
    const to = new THREE.Vector3(best.x, hoverOf(best.def) + heightOf(best.def) * 0.55, best.y);
    this.shoot(from, to, bl.kind === 'aoe' ? 0x9cd8ff : 0xff8a5c, 0.3);
  }

  // ---------- effects ----------

  private sprite(color: number, size: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size);
    this.scene.add(s);
    return s;
  }

  private sparks(at: THREE.Vector3, color: number, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const s = this.sprite(color, 0.07 + Math.random() * 0.07);
      s.material.opacity = 0.85;
      s.position.copy(at);
      const a = Math.random() * Math.PI * 2, v = speed * (0.6 + Math.random() * 0.8);
      this.bits.push({ s, vx: Math.cos(a) * v, vy: 0.8 + Math.random() * 1.6 * speed, vz: Math.sin(a) * v, life: 0.45, max: 0.45, grow: 0, fall: 5 });
    }
  }

  private dust(x: number, z: number, h: number) {
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xe8dcc0, transparent: true, opacity: 0.8, depthWrite: false }));
      s.scale.setScalar(0.6);
      s.position.set(x + (Math.random() - 0.5) * 1.2, Math.random() * h * 0.6, z + (Math.random() - 0.5) * 1.2);
      this.scene.add(s);
      const a = Math.random() * Math.PI * 2;
      this.bits.push({ s, vx: Math.cos(a) * 0.7, vy: 0.4 + Math.random() * 0.6, vz: Math.sin(a) * 0.7, life: 1.1, max: 1.1, grow: 1.6, fall: 0 });
    }
    this.sparks(new THREE.Vector3(x, h * 0.5, z), 0xffd27a, 12, 1.4);
  }

  private shoot(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number) {
    const s = this.sprite(color, 0.32);
    s.position.copy(from);
    this.shots.push({ s, from, to, t: 0, dur, color });
  }

  private effects(dt: number) {
    this.bits = this.bits.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); return false; }
      p.vy -= p.fall * dt;
      p.s.position.x += p.vx * dt; p.s.position.y = Math.max(0.03, p.s.position.y + p.vy * dt); p.s.position.z += p.vz * dt;
      if (p.grow) p.s.scale.setScalar(p.s.scale.x + p.grow * dt);
      p.s.material.opacity = Math.min(1, (p.life / p.max) * 1.4) * (p.grow ? 0.75 : 0.85);
      return true;
    });
    this.shots = this.shots.filter((sh) => {
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      sh.s.position.lerpVectors(sh.from, sh.to, k);
      sh.s.position.y += Math.sin(k * Math.PI) * 0.35; // a slight arc
      if (k < 1) return true;
      this.scene.remove(sh.s);
      sh.s.material.dispose();
      this.sparks(sh.to, sh.color, 4, 0.7);
      return false;
    });
  }

  // ---------- camera ----------

  /** The 2.5D map angle: 30 degrees down and 45 round, far off with a narrow lens so it reads almost flat. */
  private isoPose(out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }) {
    const elev = THREE.MathUtils.degToRad(30), azim = THREE.MathUtils.degToRad(45);
    const dir = new THREE.Vector3(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim));
    const half = Math.tan(THREE.MathUtils.degToRad(ISO_FOV / 2));
    // fit the plaza's diagonal across and its depth (plus the tallest buildings) up and down
    const d = Math.max(16 / (half * this.cam.aspect), 10 / half);
    out.look.set(C.x, 0.6, C.z);
    out.pos.copy(out.look).addScaledVector(dir, d);
    out.fov = ISO_FOV;
  }

  private pickSubject(): number | null {
    const us = this.host.battle().units.filter((u) => u.hp > 0);
    if (!us.length) return null;
    const hero = us.find((u) => u.def.hero);
    if (hero && this.subject === null) return hero.id;
    // the troop sent last, or the next one after the one that fell
    const after = this.subject === null ? undefined : us.find((u) => u.id > this.subject!);
    return (after ?? us[us.length - 1]).id;
  }

  private cycle(d: number) {
    const us = this.host.battle().units.filter((u) => u.hp > 0).sort((a, b) => a.id - b.id);
    if (!us.length) { this.toast('战场上没有可跟随的兵种'); return; }
    const i = us.findIndex((u) => u.id === this.subject);
    this.subject = us[(i + d + us.length) % us.length].id;
    this.look.yaw = this.look.pitch = 0;
  }

  /**
   * Where the eyes are: at the followed troop's head, looking where it walks or strikes. Standing at a building
   * the eyes step back so they never end up inside it; with nobody to follow, a slow orbit over the base.
   */
  private eyePose(dt: number) {
    const b = this.host.battle();
    const u = this.subject === null ? undefined : b.units.find((x) => x.id === this.subject);
    const o = u && this.uObjs.get(u.id);
    // In someone's eyes nobody may block the view: the followed troop is hidden (seen on the way in and out),
    // anyone right against the lens too, and any troop standing on the line of sight ahead fades to a ghost
    const eyes = this.subject !== null && (this.phase === 'live' || (this.phase === 'in' && this.t >= 0.6));
    // "In the way" is judged on screen: the troop projected, feet to head, overlapping the middle of the view
    // (between the top HUD and the card row) while near enough to loom large
    const cp = this.cam.position, view = this.cam.getWorldDirection(new THREE.Vector3());
    const feet = new THREE.Vector3(), head = new THREE.Vector3();
    for (const [id, x] of this.uObjs) {
      let target = 1;
      if (eyes) {
        const p = x.root.position, flat = Math.hypot(p.x - cp.x, p.z - cp.z);
        const t = feet.set(p.x, p.y + x.h * 0.5, p.z).sub(cp).dot(view); // depth along the view
        if (id === this.subject || flat < 0.55 + x.h * 0.35) target = 0;
        else if (t > 0.2 && t < 7) {
          feet.set(p.x, p.y, p.z).project(this.cam);
          head.set(p.x, p.y + x.h, p.z).project(this.cam);
          const tall = head.y - feet.y, half = Math.max(0.06, tall * 0.35 / this.cam.aspect);
          const inMiddle = feet.x + half > -0.42 && feet.x - half < 0.42 && head.y > -0.6 && feet.y < 0.7;
          if (inMiddle && tall > 0.18) target = t < 1.8 ? 0 : 0.14;
        }
      }
      this.fade(x, target, dt);
    }
    if (!u || !o) {
      this.overview += dt * 0.12;
      this.eye.pos.set(C.x + Math.cos(this.overview) * 17, 8.5, C.z + Math.sin(this.overview) * 17);
      this.eye.look.set(C.x, 0.5, C.z);
      return;
    }
    const tgt = u.target === null ? undefined : b.buildings.find((x) => x.id === u.target);
    const fwd = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    // standing at a building, step back far enough to see the whole of it and some of the fight around it
    let back = 0.2;
    if (tgt && tgt.hp > 0) {
      const d = Math.hypot(tgt.x - u.x, tgt.y - u.y), need = FIT[tgt.kind] * 0.5 + (tgt.kind === 'wall' ? 1.2 : 2.1);
      back = Math.max(back, need - d);
    }
    // stepped back, the eyes also rise a little so the troop's own fight stays in view over the building's base
    const eyeH = hoverOf(u.def) + o.h * 0.92 + Math.min(0.6, back * 0.25);
    this.eye.pos.set(u.x, eyeH, u.y).addScaledVector(fwd, -back);
    const yaw = o.yaw + this.look.yaw, pitch = -0.12 + this.look.pitch;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.eye.look.copy(this.eye.pos).addScaledVector(dir, 6);
  }

  private camera(dt: number) {
    if (!this.look.drag) {
      this.look.idle += dt;
      if (this.look.idle > 1.2) { const k = Math.min(1, dt * 2.5); this.look.yaw *= 1 - k; this.look.pitch *= 1 - k; }
    }
    this.eyePose(dt);
    if (this.phase === 'in') {
      this.t += dt / 1.6;
      const k = ease(Math.max(0, Math.min(1, this.t)));
      this.cam.position.lerpVectors(this.from.pos, this.eye.pos, k);
      const look = new THREE.Vector3().lerpVectors(this.from.look, this.eye.look, k);
      this.cam.fov = THREE.MathUtils.lerp(ISO_FOV, EYE_FOV, k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(look);
      if (this.t >= 1) this.phase = 'live';
      return;
    }
    if (this.phase === 'out') {
      this.t += dt / 1.0;
      const k = ease(Math.min(1, this.t)), iso = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: ISO_FOV };
      this.isoPose(iso);
      this.cam.position.lerpVectors(this.from.pos, iso.pos, k);
      this.cam.fov = THREE.MathUtils.lerp(this.from.fov, ISO_FOV, k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(new THREE.Vector3().lerpVectors(this.from.look, iso.look, k));
      if (this.t >= 1 && this.root.classList.contains('fp3d-on')) {
        this.root.classList.remove('fp3d-on');
        setTimeout(() => this.dispose(), 360);
      }
      return;
    }
    // live: chase the eye point smoothly, so the sim's 50 ms steps and turns never jerk the view
    const k = Math.min(1, dt * 9);
    this.cam.position.lerp(this.eye.pos, k);
    this.cam.fov = EYE_FOV;
    this.cam.updateProjectionMatrix();
    const cur = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion).add(this.cam.position);
    this.cam.lookAt(cur.lerp(this.eye.look, Math.min(1, dt * 8)));
  }

  private updateHud(now: number) {
    const b = this.host.battle(), st = this.host.status();
    this.hud.time.textContent = `离战斗结束 ${st.time}`;
    this.hud.time.style.color = st.warn ? '#ff8f80' : '#fff';
    this.hud.pct.textContent = `摧毁率 ${st.pct}`;
    const u = this.subject === null ? undefined : b.units.find((x) => x.id === this.subject);
    if (u) {
      const f = Math.max(0, u.hp / u.def.hp);
      this.hud.who.innerHTML = `第一人称 · ${u.def.name}<div class="fp3d-bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
      this.hud.name.textContent = `${u.def.name}`;
    } else {
      this.hud.who.textContent = '3D 巡视';
      this.hud.name.textContent = '切换兵种';
    }
    this.hud.cross.style.display = u ? 'block' : 'none';
    const hero = b.units.find((x) => x.def.hero && x.hp > 0);
    this.hud.skill.style.display = hero && !b.skillUsed && b.result === 'running' ? 'block' : 'none';
    if (now > this.toastUntil) this.hud.toast.style.opacity = '0';
    // troop cards mirror the 2D row: count or cost, the selected one lifted, the spent ones greyed
    const d = this.host.deploy;
    if (d && this.hud.cards) {
      const cards = d.cards(), look = cards.map((c) => `${c.badge}${c.sel ? 's' : ''}${c.ok ? 'o' : ''}`).join();
      if (look !== this.cardLook) {
        this.cardLook = look;
        cards.forEach((c, i) => {
          const el = this.hud.cards.children[i] as HTMLElement | undefined;
          if (!el) return;
          el.classList.toggle('sel', c.sel);
          el.classList.toggle('off', !c.ok);
          el.querySelector('b')!.textContent = c.badge;
        });
      }
      const any = b.result === 'running' && cards.some((c) => c.ok);
      if (this.band) {
        this.band.visible = any;
        // a slow breath so the border reads as something to tap
        const k = 0.75 + Math.sin(now / 420) * 0.25;
        for (const m of this.band.children as THREE.Mesh[]) (m.material as THREE.MeshBasicMaterial).opacity = m.userData.opacity * k;
      }
      const at = d.last();
      if (this.pin) {
        this.pin.visible = any && !!at;
        if (at) this.pin.position.set(at.x, 0, at.y);
        this.pin.children[0].scale.setScalar(1 + Math.sin(now / 300) * 0.12);
      }
    }
  }
}
