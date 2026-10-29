import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../data/factions';
import { deploy, destructionOf, generateEnemyBase, newBattle, step } from './sim';

describe('battle sim', () => {
  it('keeps the raid going after the core falls and counts destruction without walls', () => {
    const b = newBattle([{ kind: 'core', x: 9, y: 9 }, { kind: 'mine', x: 3, y: 3 }, { kind: 'wall', x: 6, y: 6 }]);
    deploy(b, FACTIONS[0].troops[1], 0, 0);
    b.buildings.find((x) => x.kind === 'core')!.hp = 0;
    step(b, 0.05);
    expect(b.result).toBe('running'); // the mine still stands
    expect(destructionOf(b)).toBe(0.5); // the standing wall does not count
    b.buildings.find((x) => x.kind === 'mine')!.hp = 0;
    step(b, 0.05);
    expect(b.result).toBe('win');
    expect(destructionOf(b)).toBe(1);
  });

  it('wins on time when the core fell, loses when it stands', () => {
    const fell = newBattle([{ kind: 'core', x: 9, y: 9 }, { kind: 'mine', x: 3, y: 3 }]);
    fell.buildings[0].hp = 0;
    for (let i = 0; i < 4000 && fell.result === 'running'; i++) step(fell, 0.05);
    expect(fell.result).toBe('win');
    const held = newBattle([{ kind: 'core', x: 9, y: 9 }]);
    for (let i = 0; i < 4000 && held.result === 'running'; i++) step(held, 0.05);
    expect(held.result).toBe('lose');
  });

  it('has a hero first and one troop of every role per faction', () => {
    for (const f of FACTIONS) {
      expect(f.troops[0].hero).toBe(true);
      expect(f.troops.filter((t) => !t.hero).map((t) => t.role).sort()).toEqual(['bomber', 'flyer', 'healer', 'melee', 'ranged', 'tank']);
    }
  });

  it('wall breakers blow up on a wall and its neighbours', () => {
    const b = newBattle([{ kind: 'core', x: 15, y: 15 }, { kind: 'wall', x: 5, y: 5 }, { kind: 'wall', x: 6, y: 5 }]);
    b.pool = { cn_bomber: 1 };
    deploy(b, FACTIONS[0].troops.find((t) => t.id === 'cn_bomber')!, 5.5, 3.5);
    for (let i = 0; i < 200 && b.buildings.some((w) => w.kind === 'wall' && w.hp > 0); i++) step(b, 0.05);
    expect(b.buildings.filter((w) => w.kind === 'wall').every((w) => w.hp <= 0)).toBe(true);
    expect(b.units).toHaveLength(0); // it spent itself
  });

  it('healers restore nearby troops and do not keep a raid alive alone', () => {
    const b = newBattle([{ kind: 'core', x: 15, y: 15 }]);
    b.pool = { cn_sword: 1, cn_healer: 1 };
    const sword = FACTIONS[0].troops.find((t) => t.id === 'cn_sword')!, healer = FACTIONS[0].troops.find((t) => t.id === 'cn_healer')!;
    deploy(b, sword, 1, 1);
    deploy(b, healer, 1.5, 1);
    b.units[0].hp = 50;
    step(b, 0.05);
    expect(b.units[0].hp).toBe(50 + healer.heal!);
    b.units[0].hp = 0; // the fighter falls: only the healer is left and nothing remains to deploy
    step(b, 0.05);
    expect(b.result).toBe('lose');
  });

  it('splash towers hit grouped ground troops but not flyers', () => {
    const b = newBattle([{ kind: 'core', x: 15, y: 15 }, { kind: 'aoe', x: 5, y: 5 }]);
    b.pool = { cn_sword: 2, cn_fly: 1 };
    const sword = FACTIONS[0].troops.find((t) => t.id === 'cn_sword')!, fly = FACTIONS[0].troops.find((t) => t.id === 'cn_fly')!;
    deploy(b, fly, 5.5, 3.5);
    deploy(b, sword, 5.5, 2.5);
    deploy(b, sword, 5.9, 2.5);
    step(b, 0.05);
    const [f, s1, s2] = b.units;
    expect(f.hp).toBe(fly.hp);
    expect(s1.hp).toBeLessThan(sword.hp);
    expect(s2.hp).toBeLessThan(sword.hp);
  });

  it('rejects deploys without enough energy', () => {
    const b = newBattle(generateEnemyBase());
    expect(deploy(b, FACTIONS[0].troops[0], 0, 0)).toBe(true);
    expect(deploy(b, FACTIONS[0].troops[0], 0, 0)).toBe(true);
    expect(deploy(b, FACTIONS[0].troops[0], 0, 0)).toBe(false);
  });

  it('is deterministic and terminates for every faction', () => {
    for (const f of FACTIONS) {
      const run = () => {
        const b = newBattle(generateEnemyBase(1));
        for (let i = 0; i < 6; i++) deploy(b, f.troops[1 + (i % 4)], 1 + i, 0.5);
        for (let i = 0; i < 20 * 130 && b.result === 'running'; i++) step(b, 0.05);
        return [b.result, b.time.toFixed(2)];
      };
      const r = run();
      expect(r).toEqual(run());
      expect(r[0]).not.toBe('running');
    }
  });
});

describe('balance smoke', () => {
  it('a mixed 100-energy army can win with every faction (no units stall at range)', () => {
    for (const f of FACTIONS) {
      const b = newBattle(generateEnemyBase(1));
      deploy(b, f.troops[0], 10, 0.5);
      for (const i of [4, 4, 1, 3, 2]) deploy(b, f.troops[i], 4, 0.5);
      for (let i = 0; i < 2600 && b.result === 'running'; i++) step(b, 0.05);
      expect(b.result, f.id).toBe('win');
    }
  });
});
