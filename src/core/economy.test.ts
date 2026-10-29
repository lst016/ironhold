import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../data/factions';
import { accrue, applyRaid, collect, coreLevel, defaultSave, mineRate, place, remove, upgrade } from './economy';
import { castSkill, deploy, generateEnemyBase, generateWave, lootOf, newBattle, step } from './sim';

describe('economy', () => {
  it('places, charges, refunds and enforces limits', () => {
    const s = defaultSave(0);
    expect(place(s, 'tower', 3, 3)).toBeNull();
    expect(s.stone).toBe(350);
    expect(place(s, 'tower', 3, 3)).toBe('这里已有建筑');
    expect(remove(s, 3, 3)).toBeNull();
    expect(s.stone).toBe(425);
    expect(remove(s, 9, 9)).toBe('大殿不可拆除');
  });

  it('mines accrue over time up to the cap, and collect moves it to the wallet', () => {
    const s = defaultSave(0);
    accrue(s, 10_000);
    expect(s.pending).toBeCloseTo(mineRate(s) * 10, 5);
    expect(collect(s)).toBe(15);
    accrue(s, 10_000_000);
    expect(s.pending).toBeLessThanOrEqual(300);
  });

  it('upgrades are gated by core level', () => {
    const s = defaultSave(0);
    s.stone = 5000;
    place(s, 'tower', 3, 3);
    expect(upgrade(s, 3, 3)).toBe('先升级仙门大殿');
    expect(upgrade(s, 9, 9)).toBeNull();
    expect(coreLevel(s)).toBe(2);
    expect(upgrade(s, 3, 3)).toBeNull();
  });

  it('raid result changes the wallet', () => {
    const s = defaultSave(0);
    expect(applyRaid(s, true)).toBe(-125);
    expect(applyRaid(s, false)).toBe(50);
  });
});

describe('hero skills', () => {
  it('each skill casts once and has an effect', () => {
    for (const f of FACTIONS) {
      const b = newBattle(generateEnemyBase(1));
      expect(castSkill(b)).toBe(false);
      deploy(b, f.troops[0], 10, 8);
      const hp0 = b.buildings.reduce((a, x) => a + x.hp, 0);
      const n0 = b.units.length;
      expect(castSkill(b)).toBe(true);
      expect(castSkill(b)).toBe(false);
      const changed = b.buildings.reduce((a, x) => a + x.hp, 0) !== hp0 || b.units.length !== n0 || b.fx.length > 0;
      expect(changed, f.id).toBe(true);
    }
  });
});

describe('defense balance', () => {
  const run = (layout: ReturnType<typeof generateEnemyBase>, lvl: number, seed: number) => {
    const b = newBattle(layout, 'defend', generateWave(lvl, seed));
    for (let i = 0; i < 20 * 130 && b.result === 'running'; i++) step(b, 0.05);
    return b;
  };
  it('a bare core falls; a fortified base mostly holds', () => {
    let bareWins = 0, fortWins = 0;
    for (let seed = 1; seed <= 10; seed++) {
      if (run([{ kind: 'core', x: 9, y: 9 }], 1, seed).result === 'win') bareWins++;
      if (run(generateEnemyBase(1), 1, seed).result === 'win') fortWins++;
    }
    console.log('BALANCE bare', bareWins, 'fort', fortWins);
    expect(bareWins).toBeGreaterThanOrEqual(8);
    expect(fortWins).toBeLessThanOrEqual(3);
  });
  it('loot grows with destruction', () => {
    const b = newBattle(generateEnemyBase(1));
    expect(lootOf(b)).toBe(0);
    b.buildings.forEach((x) => (x.hp = 0));
    expect(lootOf(b)).toBeGreaterThan(300);
  });
});

describe('new player', () => {
  it('starts with income, and can afford a second mine without going broke', () => {
    const s = defaultSave(0);
    expect(mineRate(s)).toBeGreaterThan(0);
    expect(place(s, 'mine', 1, 1)).toBeNull();
    expect(s.stone).toBeGreaterThanOrEqual(0);
  });
});
