/**
 * Dev-only sprite baker: renders a GLB with the game's fixed 2:1 isometric camera and saves PNGs through the
 * dev server (vite.config.ts renderSink). Replaces scripts/render_model.py where Blender cannot run.
 *
 * One job:  /tools/render3d.html?src=<glb>&out=assets-src/renders/cn/tower[&fit=1][&tile=80][&facings=4][&pad=0][&anchor=center]
 * Batch:    /tools/render3d.html?jobs=tools/jobs-buildings.json   (a JSON array of objects with the same keys)
 *   static:   writes <out>_0.png .. <out>_<facings-1>.png, one per 360/facings turn of the model.
 *   animated: add clip=<name>&frames=8 to write <out>_<clip>.png, a sheet with one row per facing and one
 *             column per frame, every cell the same size with the feet at the cell's bottom centre.
 *
 * Framing matches sprites.ts: the footprint is `fit` cells wide (1 cell = 1 world unit), a cell diagonal spans
 * `tile` px (80 = 2x the 40px display tile), and the cell's front vertex sits `pad` px above the bottom centre
 * of the image, which is where the game anchors a building. The camera and sun stay fixed while
 * the model turns, so light falls the same way on every facing.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface Job {
  src: string;
  out: string;
  fit?: number;
  tile?: number;
  /** Turns of 360 / facings each. Buildings need 4 (facing 1 is the 90 degree turn the game uses). */
  facings?: number;
  /** px kept below the anchor, for parts that reach in front of it (a base wider than its cell, a unit's feet).
   * The game sets the sprite's origin from it: originY = 1 - pad / height. */
  pad?: number;
  /** Buildings anchor on their cell's front vertex; units ('center') on the point between their feet. */
  anchor?: 'center';
  clip?: string;
  /** Clip name -> animation-only GLB for the same skeleton; writes <out>_<name>.png per clip plus <out>_anim.json. */
  clips?: Record<string, string | { src: string; start?: number; end?: number; frames?: number }>;
  frames?: number;
  yaw?: number;
}

/** Pin the hips' horizontal travel to its first key, so walk cycles play in place. */
function inPlace(clip: THREE.AnimationClip) {
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position') || !/hip|pelvis|root/i.test(t.name)) continue;
    const v = t.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  return clip;
}

const logEl = document.getElementById('log')!;
const log = (m: string) => (logEl.textContent += m + '\n');

const ELEV = THREE.MathUtils.degToRad(30); // sin 30 = 0.5 gives the 2:1 diamond
const AZIM = THREE.MathUtils.degToRad(45);
const toCam = new THREE.Vector3(Math.cos(ELEV) * Math.sin(AZIM), Math.sin(ELEV), Math.cos(ELEV) * Math.cos(AZIM));

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

// Soft toy-like light: sky/ground fill plus a warm sun from the screen's upper left.
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x8f8060, 1.3));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
const left = new THREE.Vector3(-Math.cos(AZIM), 0, Math.sin(AZIM));
sun.position.copy(left.multiplyScalar(3)).add(new THREE.Vector3(0, 5, 0)).addScaledVector(toCam, 2).multiplyScalar(4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 80 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0xcfe6ff, 0.6);
rim.position.set(-4, 3, -4);
scene.add(rim);

async function save(c: HTMLCanvasElement | Blob, path: string) {
  const blob = c instanceof Blob ? c : await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const res = await fetch(`/__render/save?path=${encodeURIComponent(path)}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  log('saved ' + path);
}

/** Opaque bounds of the current frame, in px. */
function bounds(W: number, H: number): { x0: number; x1: number; y0: number } | null {
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let x0 = W, x1 = -1, y0 = H;
  for (let y = 0; y < H; y++) {
    const row = (H - 1 - y) * W * 4; // readPixels starts at the bottom row
    for (let x = 0; x < W; x++) {
      if (px[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0 };
}

/** Crop keeping the bottom edge and the horizontal centre (the anchor) in place. */
function crop(W: number, H: number, halfW: number, top: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = halfW * 2;
  c.height = H - top;
  c.getContext('2d')!.drawImage(renderer.domElement, W / 2 - halfW, top, halfW * 2, H - top, 0, 0, halfW * 2, H - top);
  return c;
}

async function render(job: Job) {
  const { src, out, fit = 1, tile = 80, facings = 4, pad = 0, clip: clipName, frames = 8 } = job;
  const u = Math.SQRT2 / tile; // world units per px (a cell diagonal is horizontal on screen)
  const W = Math.ceil(tile * Math.max(fit, 1) * 2.4);
  const H = Math.ceil(tile * Math.max(fit, 1) * 4.2);
  renderer.setSize(W, H);
  const front = job.anchor === 'center' ? new THREE.Vector3() : new THREE.Vector3(0.5, 0, 0.5); // the cell corner nearest the camera
  const cam = new THREE.OrthographicCamera((-W / 2) * u, (W / 2) * u, (H - pad) * u, -pad * u, 0.1, 200);
  cam.position.copy(front).addScaledVector(toCam, 50);
  cam.lookAt(front);

  const gltf = await new GLTFLoader().loadAsync('/' + src.replace(/^\//, ''));
  const model = gltf.scene;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
      if ('metalness' in mat) {
        mat.metalness = 0; // matte toy look regardless of what the generator baked in
        mat.roughness = Math.max(mat.roughness, 0.7);
      }
    }
  });

  // Normalise: base on y = 0, centred on the origin, footprint `fit` cells wide. The footprint is measured on
  // the bottom slice only, so parts that overhang higher up (a ballista arm, a sword) do not shrink the model.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const foot = new THREE.Box3();
  const cut = box.min.y + size.y * 0.12;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry.getAttribute('position') : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y <= cut) foot.expandByPoint(v);
    }
  });
  const fs = foot.getSize(new THREE.Vector3());
  const k = fit / Math.max(fs.x, fs.z);
  const pivot = new THREE.Group();
  model.scale.setScalar(k);
  model.position.set(-((foot.min.x + foot.max.x) / 2) * k, -box.min.y * k, -((foot.min.z + foot.max.z) / 2) * k);
  pivot.add(model);
  scene.add(pivot);
  log(`${src}: model ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}, foot ${fs.x.toFixed(2)}x${fs.z.toFixed(2)} -> scale ${k.toFixed(3)}, canvas ${W}x${H}`);

  // Heights in screen px (a vertical world length shows at cos 30 deg): the whole rest pose, and the head bone,
  // which ignores raised weapons, wings and tall hats when the game sizes the unit.
  pivot.updateMatrixWorld(true);
  const px = (y: number) => Math.round((y * Math.cos(ELEV)) / u);
  let headY = 0;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone && /(^|:)head(_\d)?$/i.test(o.name)) headY = Math.max(headY, o.getWorldPosition(v).y);
  });
  const heights = { top: px(size.y * k), head: headY ? px(headY) : undefined };

  // `yaw` (degrees) turns models whose front is not +Z, so facing i still looks along grid (sin, cos) of i * 45.
  const yaw = THREE.MathUtils.degToRad(job.yaw ?? 0);
  const turn = (i: number) => (pivot.rotation.y = (i / facings) * Math.PI * 2 + yaw);
  try {
    if (!clipName && !job.clips) {
      for (let i = 0; i < facings; i++) {
        turn(i);
        renderer.render(scene, cam);
        const b = bounds(W, H);
        if (!b) throw new Error('empty render');
        const halfW = Math.ceil(Math.max(W / 2 - b.x0, b.x1 + 1 - W / 2)) + 2;
        await save(crop(W, H, halfW, Math.max(0, b.y0 - 2)), `${out}_${i}.png`);
      }
    } else {
      // Clips come from the model itself (`clip`) or from separate animation-only GLBs on the same skeleton
      // (`clips`, as Tripo Studio's animate tasks deliver them). Every clip of a job shares the model's scale.
      const named: [string, THREE.AnimationClip][] = [];
      if (clipName) {
        const clip = gltf.animations.find((a) => a.name === clipName);
        if (!clip) throw new Error(`no clip ${clipName}; have: ${gltf.animations.map((a) => a.name).join(', ')}`);
        named.push([clipName, clip]);
      }
      const counts: Record<string, number> = {};
      for (const [name, spec] of Object.entries(job.clips ?? {})) {
        const c = typeof spec === 'string' ? { src: spec } : spec;
        let a = (await new GLTFLoader().loadAsync('/' + c.src.replace(/^\//, ''))).animations[0];
        if (!a) throw new Error(`${c.src}: no animation`);
        // Keep only [start, end] seconds of long clips (an idle that fidgets for 15 s, a slash with a long recovery).
        if (c.start !== undefined || c.end !== undefined) {
          const fps = 30;
          a = THREE.AnimationUtils.subclip(a, name, Math.round((c.start ?? 0) * fps), Math.round((c.end ?? a.duration) * fps), fps);
        }
        if (c.frames) counts[name] = c.frames;
        named.push([name, inPlace(a)]);
      }
      const meta: Record<string, { w: number; h: number; frames: number; duration: number }> = {};
      const mixer = new THREE.AnimationMixer(model);
      for (const [name, clip] of named) {
        const frames = counts[name] ?? job.frames ?? 8;
        mixer.stopAllAction();
        mixer.clipAction(clip).play();
        const pose = (f: number) => mixer.setTime((f / frames) * clip.duration);
        // Pass 1: union bounds over every facing and frame, so all cells share one size and anchor.
        let halfW = 0, top = H;
        for (let i = 0; i < facings; i++) for (let f = 0; f < frames; f++) {
          turn(i);
          pose(f);
          renderer.render(scene, cam);
          const b = bounds(W, H);
          if (!b) continue;
          halfW = Math.max(halfW, Math.ceil(Math.max(W / 2 - b.x0, b.x1 + 1 - W / 2)) + 2);
          top = Math.min(top, Math.max(0, b.y0 - 2));
        }
        const cw = halfW * 2, ch = H - top;
        const sheet = document.createElement('canvas');
        sheet.width = cw * frames;
        sheet.height = ch * facings;
        const ctx = sheet.getContext('2d')!;
        for (let i = 0; i < facings; i++) for (let f = 0; f < frames; f++) {
          turn(i);
          pose(f);
          renderer.render(scene, cam);
          ctx.drawImage(crop(W, H, halfW, top), f * cw, i * ch);
        }
        await save(sheet, `${out}_${name.replace(/\W+/g, '_')}.png`);
        meta[name] = { w: cw, h: ch, frames, duration: clip.duration };
        log(`${name}: cell ${cw}x${ch}, ${frames} frames x ${facings} facings, ${clip.duration.toFixed(2)}s`);
      }
      mixer.stopAllAction();
      if (job.clips) await save(new Blob([JSON.stringify({ pad, heights, clips: meta })]), `${out}_anim.json`);
    }
  } finally {
    scene.remove(pivot);
  }
}

async function main() {
  const q = new URLSearchParams(location.search);
  const list = q.get('jobs');
  let jobs: Job[];
  if (list) jobs = await (await fetch('/' + list.replace(/^\//, ''))).json();
  else {
    const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    jobs = [{ src: q.get('src')!, out: q.get('out')!, fit: num('fit'), tile: num('tile'), facings: num('facings'), pad: num('pad'),
      anchor: q.get('anchor') === 'center' ? 'center' : undefined, clip: q.get('clip') ?? undefined, frames: num('frames') }];
  }
  for (const j of jobs) await render(j);
  log('done');
  document.title = 'render3d done';
}

main().catch((e) => {
  log('ERROR ' + (e as Error).message);
  document.title = 'render3d error';
});
