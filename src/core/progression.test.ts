import { describe, expect, it } from 'vitest';
import { armyOf, avatarChoices, buildingStats, avatarOf, chooseCivilization, move, setAvatar, setName, defaultSave, enhanceWeapon, expeditionReward, place } from './economy';
import { summon } from './summon';

describe('civilization and progression', () => {
  it('locks starting choice without locking future mixed squads', () => {
    const s = defaultSave(0);
    chooseCivilization(s, 1); chooseCivilization(s, 2);
    expect(s.civilization).toBe(1);
    expect(s.heroes.jp_hero).toBeDefined();
    s.squad[1] = 'eu_knight';
    expect(armyOf(s)[1].id).toBe('eu_knight');
    // new buildings take the opening civilization's style
    expect(place(s, 'tower', 1, 1)).toBeNull();
    expect(s.layout.at(-1)?.faction).toBe(1);
  });
  it('a hero taken off (取消出战) leaves the expedition lineup to the troops', () => {
    const s = defaultSave(0); chooseCivilization(s, 0);
    s.squad[0] = '';
    const army = armyOf(s);
    expect(army).toHaveLength(s.squad.length - 1);
    expect(army.some((t) => t.hero)).toBe(false);
  });
  it('lists a building\'s stats with the next level beside them', () => {
    const tower = buildingStats('tower', 1);
    expect(tower.find((r) => r.label === '伤害')).toEqual({ label: '伤害', now: '18', next: '25' });
    expect(tower.find((r) => r.label === '射程')).toEqual({ label: '射程', now: '6 格', next: '6 格' });
    expect(buildingStats('mine', 3).every((r) => r.next === null)).toBe(true); // max level: nothing to come
    expect(buildingStats('mine', 1).map((r) => r.label)).toEqual(['生命', '每分钟产灵石', '灵石储量']);
  });
  it('moves a building only onto an empty cell inside the grid', () => {
    const s = defaultSave(0); chooseCivilization(s, 0);
    const mine = s.layout.find((b) => b.kind === 'mine')!, { x, y } = mine;
    expect(move(s, x, y, 9, 9)).toBe('这里已有建筑'); // the hall stands there
    expect(move(s, x, y, -1, 3)).toBe('超出地图');
    expect(move(s, x, y, 2, 3)).toBeNull();
    expect([mine.x, mine.y]).toEqual([2, 3]);
    expect(move(s, x, y, 4, 4)).toBe('这里没有建筑');
  });
  it('names the player and only allows owned heroes as the avatar', () => {
    const s = defaultSave(0); chooseCivilization(s, 0);
    expect(s.profile.name).toMatch(/^道友\d{4}$/);
    expect(s.profile.avatar).toBe('cn_hero');
    expect(setName(s, '   ')).toBe('道号不能为空');
    expect(setName(s, '一二三四五六七八九')).toContain('最多');
    expect(setName(s, '  青云  客 ')).toBeNull();
    expect(s.profile.name).toBe('青云 客');
    expect(setAvatar(s, 'jp_hero')).toContain('召唤');
    expect(setAvatar(s, 'jp_fox')).toBeNull();
    expect(avatarOf(s)).toBe('jp_fox');
    expect(avatarChoices(s).filter((c) => !c.unlocked).map((c) => c.id)).toEqual(['jp_hero', 'eu_hero']);
  });
  it('weapon and constellations affect actual deployed definitions', () => {
    const s = defaultSave(0); chooseCivilization(s, 2);
    const before = armyOf(s)[0];
    const rolls = [0, 0.9, 0.9]; // hero roll, pick the third hero (eu_hero), no cyan opening
    enhanceWeapon(s, 'eu_hero'); summon(s, 1, () => rolls.shift()!);
    const after = armyOf(s)[0];
    expect(after.dmg).toBeGreaterThan(before.dmg);
    expect(after.hp).toBeGreaterThan(before.hp);
    expect(s.stone).toBe(400);
    expect(expeditionReward(s)).toBe('召唤代币 +2 · 灵石 +100');
    expect(s.tokens).toBe(4); expect(s.stone).toBe(500);
  });
});
