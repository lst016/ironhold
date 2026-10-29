import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../data/factions';
import { addTroop, costOf, housingCap, housingOf, lockReason, muster, refund, removeTroop, starterArmy, troopById } from './army';
import { chooseCivilization, defaultSave } from './economy';
import { deploy, newBattle, step } from './sim';

const fresh = (civ = 0) => { const s = defaultSave(0); chooseCivilization(s, civ); return s; };

describe('军营 army', () => {
  it('starts a new player with a starter army that fits a level-1 camp', () => {
    const s = fresh();
    expect(s.army).toEqual(starterArmy(0));
    expect(housingOf(s.army)).toBeLessThanOrEqual(housingCap(s));
  });

  it('caps population by the hall level and 扶桑 gets +5', () => {
    const s = fresh();
    expect(housingCap(s)).toBe(20);
    s.layout.find((b) => b.kind === 'core')!.lvl = 3;
    expect(housingCap(s)).toBe(40);
    expect(housingCap(fresh(1))).toBe(25);
  });

  it('refuses troops past the population cap', () => {
    const s = fresh();
    s.army = {};
    for (let i = 0; i < 20; i++) expect(addTroop(s, 'cn_sword')).toBeNull();
    expect(addTroop(s, 'cn_sword')).toMatch('人口已满');
    removeTroop(s, 'cn_sword');
    expect(s.army.cn_sword).toBe(19);
  });

  it('unlocks troops by the 兵营 level; melee and ranged come with the hall', () => {
    const s = fresh();
    const ape = troopById('cn_ape')!, fly = troopById('cn_fly')!, healer = troopById('cn_healer')!, bomber = troopById('cn_bomber')!;
    expect(lockReason(s, troopById('cn_sword')!)).toBeNull();
    expect(lockReason(s, ape)).toBe('需要 1 级兵营');
    expect(addTroop(s, 'cn_ape')).toBe('需要 1 级兵营');
    s.layout.push({ kind: 'barracks', x: 3, y: 3, lvl: 1 });
    expect(lockReason(s, ape)).toBeNull();
    expect(lockReason(s, bomber)).toBeNull();
    expect(lockReason(s, healer)).toBe('需要 2 级兵营');
    expect(lockReason(s, fly)).toBe('需要 3 级兵营');
  });

  it('mixes troops across civilizations', () => {
    const s = fresh();
    s.army = {};
    expect(addTroop(s, 'jp_fox')).toBeNull();
    expect(addTroop(s, 'eu_archer')).toBeNull();
  });

  it('pays on muster, refunds what was not deployed', () => {
    const s = fresh();
    s.army = { cn_sword: 4, cn_talisman: 2 };
    const before = s.stone, cost = costOf(s.army);
    const m = muster(s);
    expect('pool' in m && m.paid).toBe(cost);
    expect(s.stone).toBe(before - cost);
    if (!('pool' in m)) return;
    const b = newBattle([{ kind: 'core', x: 9, y: 9 }]);
    b.pool = { ...m.pool };
    expect(deploy(b, FACTIONS[0].troops[1], 0, 0)).toBe(true);
    expect(b.pool.cn_sword).toBe(3);
    expect(refund(s, b.pool)).toBe(cost - 10);
    expect(s.stone).toBe(before - 10);
  });

  it('will not muster without enough 灵石', () => {
    const s = fresh();
    s.stone = 5;
    expect(muster(s)).toEqual({ error: expect.stringContaining('灵石不足') });
    expect(s.stone).toBe(5);
  });

  it('ends a pool raid once every troop is out and dead', () => {
    const b = newBattle([{ kind: 'core', x: 9, y: 9 }, { kind: 'tower', x: 1, y: 1, lvl: 3 }]);
    b.pool = { cn_sword: 1 };
    deploy(b, FACTIONS[0].troops[1], 1, 0);
    expect(deploy(b, FACTIONS[0].troops[1], 1, 0)).toBe(false);
    for (let i = 0; i < 4000 && b.result === 'running'; i++) step(b, 0.05);
    expect(b.result).toBe('lose');
    expect(b.time).toBeLessThan(120);
  });
});
