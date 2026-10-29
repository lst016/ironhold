import { describe, expect, it } from 'vitest';
import { defaultSave, equipSkin, grantSkinAd } from './economy';
import { showRewarded } from './ads';

describe('map skins', () => {
  it('starts with the free map equipped and the rest locked', () => {
    const s = defaultSave(0);
    expect(s.mapSkin).toBe('jade');
    expect(s.skins).toEqual(['jade']);
    expect(equipSkin(s, 'snow')).toBe('该地图尚未解锁');
    expect(s.mapSkin).toBe('jade');
  });

  it('unlocks and equips after the required rewarded views', () => {
    const s = defaultSave(0);
    expect(grantSkinAd(s, 'snow', 'r1')).toBe('progress');
    expect(s.skins).not.toContain('snow');
    expect(grantSkinAd(s, 'snow', 'r2')).toBe('unlocked');
    expect(s.skins).toContain('snow');
    expect(s.mapSkin).toBe('snow');
    expect(equipSkin(s, 'jade')).toBeNull();
  });

  it('pays a replayed receipt only once', () => {
    const s = defaultSave(0);
    expect(grantSkinAd(s, 'snow', 'same')).toBe('progress');
    expect(grantSkinAd(s, 'snow', 'same')).toBe('duplicate');
    expect(s.skinAds.snow).toBe(1);
    expect(grantSkinAd(s, 'jade', 'other')).toBe('owned');
    expect(grantSkinAd(s, 'nope', 'x')).toBe('unknown');
  });

  it('never reports a fake view while no ad platform is connected', async () => {
    expect(await showRewarded('skin_snow')).toEqual({ status: 'unavailable' });
  });
});
