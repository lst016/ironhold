import { describe, expect, it } from 'vitest';
import { armyOf, chooseCivilization, defaultSave } from './economy';
import { FULL_HERO_STONE, FULL_SOUL_STONE, heroPool, mulberry32 as seeded, PITY, pullsToHero, soulProgress, soulsToNext, starsOf, summon, troopPool, type Pull } from './summon';
const fresh = (tokens = 100) => { const s = defaultSave(0); chooseCivilization(s, 0); s.tokens = tokens; return s; };
const pulls = (r: Pull[] | string) => { if (typeof r === 'string') throw new Error(r); return r; };

describe('summon', () => {
  it('pool is read from the unit data', () => {
    expect(heroPool().map((h) => h.id)).toEqual(['cn_hero', 'jp_hero', 'eu_hero']);
    expect(troopPool()).toHaveLength(18);
  });

  it('refuses without enough tokens and spends nothing', () => {
    const s = fresh(9);
    expect(summon(s, 10)).toContain('不足');
    expect(s.tokens).toBe(9);
    expect(s.pity).toBe(0);
  });

  it('a miss pays a troop soul and advances pity', () => {
    const s = fresh();
    const r = pulls(summon(s, 1, () => 0.5));
    expect(r[0].kind).toBe('troop');
    expect(s.souls[r[0].id]).toBe(1);
    expect(s.pity).toBe(1);
    expect(pullsToHero(s)).toBe(PITY - 1);
    expect(s.tokens).toBe(99);
  });

  it('the 10th pull without a hero is a hero, preferring one not owned', () => {
    const s = fresh();
    const r = pulls(summon(s, 10, () => 0.99)); // 0.99 never rolls a hero on its own
    expect(r.slice(0, 9).every((p) => p.kind === 'troop')).toBe(true);
    expect(r[9]).toMatchObject({ kind: 'hero', fresh: true });
    expect(r[9].id).not.toBe('cn_hero'); // cn_hero came with the civilization
    expect(s.pity).toBe(0);
  });

  it('every ten-pull holds at least one hero, whatever the pity was', () => {
    const rng = seeded(7);
    for (let start = 0; start < PITY; start++) {
      const s = fresh(); s.pity = start;
      expect(pulls(summon(s, 10, rng)).some((p) => p.kind === 'hero')).toBe(true);
    }
  });

  it('hero rate lands near 8% plus pity over many pulls, with the same results per seed', () => {
    const a = fresh(100000), b = fresh(100000);
    const ra = pulls(summon(a, 10, seeded(42))), rb = pulls(summon(b, 10, seeded(42)));
    expect(ra).toEqual(rb);
    const s = fresh(20000), rng = seeded(1);
    let heroes = 0;
    for (let i = 0; i < 2000; i++) heroes += pulls(summon(s, 10, rng)).filter((p) => p.kind === 'hero').length;
    const rate = heroes / 20000;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.16);
  });

  it('duplicate heroes raise constellation, then convert to stone', () => {
    const s = fresh();
    const stone = s.stone;
    for (let i = 0; i < 7; i++) summon(s, 1, () => 0); // always a hero, always the first one (cn_hero, owned)
    expect(s.heroes.cn_hero.constellation).toBe(6);
    expect(s.stone).toBe(stone + FULL_HERO_STONE);
  });

  it('souls raise stars 1/2/3/4/5 apart, stars buff that troop, and extra souls become stone', () => {
    expect([0, 1, 2, 3, 6, 10, 15].map(starsOf)).toEqual([0, 1, 1, 2, 3, 4, 5]);
    expect(soulsToNext(3)).toBe(3);
    expect([0, 1, 4, 14, 15, 20].map(soulProgress)).toEqual([
      { stars: 0, have: 0, need: 1 }, { stars: 1, have: 0, need: 2 }, { stars: 2, have: 1, need: 3 },
      { stars: 4, have: 4, need: 5 }, { stars: 5, have: 0, need: 0 }, { stars: 5, have: 0, need: 0 },
    ]);
    const s = fresh();
    const before = armyOf(s)[1];
    s.souls[before.id] = 15;
    const after = armyOf(s)[1];
    expect(after.hp).toBe(Math.round(before.hp * 1.3));
    const stone = s.stone;
    s.pity = 0;
    const r = pulls(summon(s, 1, () => 0.5)); // a troop; force it to the maxed one
    s.souls[r[0].id] = 15; s.pity = 0;
    const again = pulls(summon(s, 1, () => 0.5))[0];
    expect(again).toMatchObject({ kind: 'troop', id: r[0].id, stone: FULL_SOUL_STONE, stars: 5 });
    expect(s.stone).toBe(stone + FULL_SOUL_STONE);
  });
});
