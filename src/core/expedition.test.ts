import { describe, expect, it } from 'vitest';
import { chooseCivilization, defaultSave } from './economy';
import { cashOut, chooseNode, finishEncounter, pickRelic, relicOffers, resolveRuin, routeAt, runArmy, runEnergy, runLayout, startRun } from './expedition';
import { deploy, newBattle, step } from './sim';
const fresh = () => { const s = defaultSave(0); chooseCivilization(s, 0); startRun(s, 1234); return s; };
const victory = (s: ReturnType<typeof fresh>, lane = 0) => {
  const r = s.run!; chooseNode(r, lane); r.engaged = true;
  const b = newBattle(runLayout(r)); b.result = 'win'; b.energySpent = 60; b.deployedCount = 5;
  finishEncounter(s, b); return b;
};
describe('offline roguelike expedition', () => {
  it('generates stable routes and offers across save round trips', () => {
    const s = fresh(), r = s.run!, clone = JSON.parse(JSON.stringify(r));
    expect(routeAt(r)).toEqual(routeAt(clone));
    expect(relicOffers(r)).toEqual(relicOffers(clone));
    expect(startRun(s, 456)).toBe(false);
    const troop = r.army[0].dmg; s.heroes.cn_hero.weapon = 5;
    expect(r.army[0].dmg).toBe(troop);
  });
  it('consumes supplies, grants one relic, and prevents duplicate victory rewards', () => {
    const s = fresh(), r = s.run!;
    const b = victory(s);
    expect(r.supplies).toBeGreaterThanOrEqual(185);
    expect(r.readiness).toBeLessThan(100);
    expect(r.phase).toBe('relic');
    const carried = r.carried; finishEncounter(s, b); expect(r.carried).toBe(carried);
    expect(pickRelic(r, r.offers[0])).toBe(true);
    expect(pickRelic(r, 'fury')).toBe(false);
    expect(r.phase).toBe('route');
  });
  it('extracts full rewards once without affecting owned heroes or gear', () => {
    const s = fresh(), r = s.run!; victory(s);
    const before = s.stone, amount = r.carried; cashOut(s, true); cashOut(s, true);
    expect(s.stone).toBe(before + amount); expect(s.tokens).toBe(4);
    expect(s.heroes.cn_hero).toEqual({ constellation: 0, weapon: 0 });
    expect(startRun(s, 5678)).toBe(true);
  });
  it('secures rewards at ruins and preserves only guaranteed resources on defeat', () => {
    const s = fresh(), r = s.run!;
    r.stage = 2; r.carried = 200;
    expect(chooseNode(r, 1)).toBe(true); expect(chooseNode(r, 1)).toBe(false);
    expect(resolveRuin(r, true)).toBe(true); expect(resolveRuin(r, true)).toBe(false);
    expect(r.secured).toBe(200); r.carried = 101; r.tokens = 4;
    cashOut(s, false);
    expect(s.stone).toBe(750); expect(s.tokens).toBe(3);
  });
  it('recovers at camps and prevents entering battle with insufficient supplies', () => {
    const s = fresh(), r = s.run!; r.stage = 2; r.supplies = 0; r.readiness = 40;
    chooseNode(r, 0); expect(r.supplies).toBe(60); expect(r.readiness).toBe(70);
    r.supplies = 39; expect(chooseNode(r, 0)).toBe(false); expect(r.path).toHaveLength(1);
  });
  it('always lets the final boss be entered, with at least 40 灵气 when supplies run low', () => {
    const r = fresh().run!; r.stage = 4; r.supplies = 25;
    expect(chooseNode(r, 0)).toBe(true);
    expect(r.phase).toBe('battle'); expect(r.node).toBe('boss');
    expect(runEnergy(r)).toBe(40);
  });
  it('relics change actual troop stats and hero deployments are limited', () => {
    const r = fresh().run!; const before = runArmy(r);
    r.relics = { fury: 1, sky: 1, range: 1, guard: 1 };
    const after = runArmy(r); expect(after[0].dmg).toBeGreaterThan(before[0].dmg);
    expect(after[2].speed).toBeGreaterThan(before[2].speed);
    expect(after[3].range).toBeGreaterThan(before[3].range);
    const b = newBattle(runLayout(r)); b.singleHero = true;
    expect(deploy(b, after[0], 1, 1)).toBe(true);
    expect(deploy(b, after[0], 1, 1)).toBe(false);
    expect(b.energySpent).toBe(40);
    expect(runEnergy(r)).toBe(100);
  });
  it('siege damages buildings and plunder only pays once per destroyed building', () => {
    const b = newBattle([{ kind: 'core', x: 2, y: 2 }, { kind: 'wall', x: 1, y: 1 }]);
    b.siege = 0.3; b.plunder = 4; b.buildings[1].hp = 0;
    deploy(b, fresh().run!.army[0], 2.5, 2.5);
    const hp = b.buildings[0].hp; step(b, 0.05);
    expect(b.buildings[0].hp).toBeLessThan(hp - fresh().run!.army[0].dmg);
    expect(b.energy).toBe(64); step(b, 0.05); expect(b.energy).toBe(64);
  });
  it('clears a full five-stage campaign with boss payout', () => {
    const s = fresh(), r = s.run!;
    for (let stage = 0; stage < 5; stage++) {
      if (stage === 2) { chooseNode(r, 0); continue; }
      victory(s);
      if (r.phase === 'relic') pickRelic(r, r.offers[0]);
    }
    expect(r.phase).toBe('finished'); expect(r.result).toContain('远征大捷');
    expect(s.tokens).toBe(8);
  });
});
