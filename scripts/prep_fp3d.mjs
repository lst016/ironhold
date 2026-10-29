/**
 * Models for the battle's first-person 3D view (src/scenes/fp3d.ts), from the Tripo GLBs in assets-src/models into
 * public/assets/3dm. Each is optimised with gltf-transform: meshopt-compressed and quantised geometry, simplified
 * meshes and 512 px webp textures (the source buildings carry 4.7 MB PNGs), so a whole battlefield stays small.
 * Walls appear by the dozen and are simplified hardest.
 *
 *   node scripts/prep_fp3d.mjs            (uses npx @gltf-transform/cli; set GLTF_TRANSFORM to a local binary instead)
 *
 * The sky panorama is copied by hand: assets/generated sky → public/assets/3dm/sky.webp.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';

const OUT = 'public/assets/3dm';
const SRC = 'assets-src/models';
const bin = process.env.GLTF_TRANSFORM;
const run = (args) => (bin ? execFileSync(bin, args, { stdio: 'pipe' }) : execFileSync('npx', ['-y', '@gltf-transform/cli@4.5.1', ...args], { stdio: 'pipe' }));

/** Mesh models: simplify `ratio` of the triangles away within `error`, textures to 512 px webp. */
function mesh(src, out, ratio, error = 0.01) {
  run(['optimize', src, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512',
    '--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', String(error)]);
}
/** Animation-only GLBs (Tripo animate tasks): compressed, nothing to simplify. */
function clip(src, out) { run(['optimize', src, out, '--compress', 'meshopt']); }

mkdirSync(OUT, { recursive: true });
const done = [];
const step = (out, f) => { f(); done.push(`${out} ${(statSync(out).size / 1024).toFixed(0)} KB`); console.log(done.at(-1)); };

// buildings: the v2 renders are what the 2D battle shows
const BUILDINGS = { core: 'core_v2', tower: 'tower_v2', mine: 'mine_v2', wall: 'wall_v2', barracks: 'barracks', aoe: 'aoe' };
for (const fid of ['cn', 'jp', 'eu']) for (const [kind, file] of Object.entries(BUILDINGS)) {
  const out = `${OUT}/${fid}_${kind}.glb`;
  step(out, () => mesh(`${SRC}/${fid}/${file}.glb`, out, kind === 'wall' ? 0.12 : 0.3, kind === 'wall' ? 0.02 : 0.01));
}

// rigged troops: the skinned mesh plus one GLB per clip on the same skeleton
for (const id of ['cn_ape', 'cn_hero', 'cn_sword', 'cn_talisman', 'eu_archer', 'eu_golem', 'eu_hero', 'eu_knight', 'jp_charm', 'jp_fox', 'jp_hero', 'jp_oni', 'jp_tengu']) {
  const dir = `${SRC}/anim/${id}`;
  step(`${OUT}/${id}.glb`, () => mesh(`${dir}/rig.glb`, `${OUT}/${id}.glb`, 0.5, 0.004));
  for (const c of ['idle', 'walk', 'attack']) if (existsSync(`${dir}/${c}.glb`)) step(`${OUT}/${id}_${c}.glb`, () => clip(`${dir}/${c}.glb`, `${OUT}/${id}_${c}.glb`));
}

// troops that did not rig: static meshes
for (const [id, file] of Object.entries({ cn_fly: 'cn/fly', eu_gryphon: 'eu/gryphon', jp_bomber: 'jp/bomber', eu_bomber: 'eu/bomber' })) {
  step(`${OUT}/${id}.glb`, () => mesh(`${SRC}/${file}.glb`, `${OUT}/${id}.glb`, 0.5, 0.004));
}
console.log(`${done.length} files`);
