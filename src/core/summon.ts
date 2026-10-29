import { FACTIONS, type TroopDef } from '../data/factions';
import type { Save } from './economy';

/**
 * 问仙召唤 (canvas/documents/gacha-design.md). Every pull is either a hero or a troop the player can already field;
 * a troop pull pays a soul toward that troop's stars. The pool is read from the faction data, so a new hero only
 * needs its unit entry and portrait.
 */
export const HERO_RATE = 0.08;
export const PITY = 10; // the 10th pull without a hero is a hero, so any ten-pull holds at least one
export const UPGRADE_RATE = 0.3; // share of hero pulls that open cyan and turn gold
export const SOUL_STEPS = [1, 2, 3, 4, 5]; // souls for star 1..5
export const STAR_BONUS = 0.06; // hp and damage per star
export const MAX_CONSTELLATION = 6;
export const FULL_HERO_STONE = 200;
export const FULL_SOUL_STONE = 20;

const MAX_SOULS = SOUL_STEPS.reduce((a, b) => a + b, 0);

export const heroPool = (): TroopDef[] => FACTIONS.flatMap((f) => f.troops.filter((t) => t.hero));
export const troopPool = (): TroopDef[] => FACTIONS.flatMap((f) => f.troops.filter((t) => !t.hero));

/** Stars reached with `souls` collected. */
export function starsOf(souls: number): number {
  let need = 0, stars = 0;
  for (const step of SOUL_STEPS) { need += step; if (souls >= need) stars++; }
  return stars;
}

/** Souls still missing for the next star, or 0 at max. */
export function soulsToNext(souls: number): number {
  let need = 0;
  for (const step of SOUL_STEPS) { need += step; if (souls < need) return need - souls; }
  return 0;
}

/** Progress inside the current star: souls held toward the next one and the size of that step (need 0 at max). */
export function soulProgress(souls: number): { stars: number; have: number; need: number } {
  const stars = starsOf(souls);
  const base = SOUL_STEPS.slice(0, stars).reduce((a, b) => a + b, 0);
  return { stars, have: Math.min(souls, MAX_SOULS) - base, need: SOUL_STEPS[stars] ?? 0 };
}

export type Pull =
  | { kind: 'hero'; id: string; fresh: boolean; constellation: number; stone: number; upgrade: boolean }
  | { kind: 'troop'; id: string; souls: number; stars: number; starUp: boolean; stone: number };

/**
 * Spend tokens and roll `count` pulls, applying every result to the save before anything is shown.
 * Returns the pulls in rolled order, or an error message when the wallet cannot pay (nothing is spent then).
 */
export function summon(s: Save, count: 1 | 10, rng: () => number = Math.random): Pull[] | string {
  if (s.tokens < count) return `召唤代币不足，需要 ${count} 枚（远征可获得）`;
  s.tokens -= count;
  const out: Pull[] = [];
  for (let i = 0; i < count; i++) out.push(pullOnce(s, rng));
  return out;
}

function pullOnce(s: Save, rng: () => number): Pull {
  const forced = s.pity >= PITY - 1;
  if (forced || rng() < HERO_RATE) {
    s.pity = 0;
    const pool = heroPool(), unowned = pool.filter((h) => !s.heroes[h.id]);
    const from = forced && unowned.length ? unowned : pool;
    const hero = from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
    const upgrade = rng() < UPGRADE_RATE;
    const owned = s.heroes[hero.id];
    if (!owned) {
      s.heroes[hero.id] = { constellation: 0, weapon: 0 };
      return { kind: 'hero', id: hero.id, fresh: true, constellation: 0, stone: 0, upgrade };
    }
    if (owned.constellation < MAX_CONSTELLATION) {
      owned.constellation++;
      return { kind: 'hero', id: hero.id, fresh: false, constellation: owned.constellation, stone: 0, upgrade };
    }
    s.stone += FULL_HERO_STONE;
    return { kind: 'hero', id: hero.id, fresh: false, constellation: owned.constellation, stone: FULL_HERO_STONE, upgrade };
  }
  s.pity++;
  const pool = troopPool();
  const troop = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const before = s.souls[troop.id] ?? 0;
  if (before >= MAX_SOULS) {
    s.stone += FULL_SOUL_STONE;
    return { kind: 'troop', id: troop.id, souls: before, stars: starsOf(before), starUp: false, stone: FULL_SOUL_STONE };
  }
  s.souls[troop.id] = before + 1;
  const stars = starsOf(before + 1);
  return { kind: 'troop', id: troop.id, souls: before + 1, stars, starUp: stars > starsOf(before), stone: 0 };
}

/** Small seeded rng (Mulberry32) for reproducible summons in tests and playtests. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pulls left before the guaranteed hero, counting the guaranteed one. */
export const pullsToHero = (s: Save) => PITY - s.pity;
