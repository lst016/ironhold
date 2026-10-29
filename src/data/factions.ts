// All unit/building numbers live here: adding a faction means adding data, not code.
export type Role = 'melee' | 'flyer' | 'ranged' | 'tank' | 'bomber' | 'healer';
/** Display names of the roles, shared by every screen that labels a troop. */
export const ROLE_NAME: Record<Role, string> = { melee: '近战', flyer: '飞行', ranged: '远程', tank: '重装', bomber: '破墙', healer: '治疗' };
export type SkillId = 'sword_rain' | 'summon' | 'warcry';

export const SKILLS: Record<SkillId, { name: string; desc: string }> = {
  sword_rain: { name: '万剑归宗', desc: '剑雨砸向英雄周围 3.5 格内所有建筑,各受 150 伤害' },
  summon: { name: '百鬼夜行', desc: '在英雄身边立刻召唤 3 只式神狐(免费)' },
  warcry: { name: '英灵战吼', desc: '全体友军回复 250 生命,并立刻可以再次攻击' },
};

export interface TroopDef {
  id: string;
  name: string;
  role: Role;
  hp: number;
  dmg: number;
  range: number; // cells
  speed: number; // cells per second
  interval: number; // seconds between attacks
  cost: number; // 灵气
  flying: boolean;
  hero?: boolean;
  skill?: SkillId; // heroes only; one cast per battle
  targetsDefense?: boolean; // prefers towers
  /** 破墙: heads for the nearest wall, deals dmg x wallMul to walls (and splashes walls within 1.2 cells), then blows up. */
  wallMul?: number;
  /** 治疗: attacks nothing; every `interval` it restores `heal` HP to friendly troops within `range`. */
  heal?: number;
}

export interface Faction {
  id: string;
  name: string;
  tagline: string;
  color: number;
  troops: TroopDef[]; // first entry is the hero
}

export const FACTIONS: Faction[] = [
  {
    id: 'cn', name: '中土·剑宗', tagline: '御剑问道', color: 0xe0b040,
    troops: [
      { id: 'cn_hero', name: '剑仙', role: 'melee', hp: 900, dmg: 70, range: 1.2, speed: 2.2, interval: 0.8, cost: 40, flying: false, hero: true, skill: 'sword_rain' },
      { id: 'cn_sword', name: '剑修', role: 'melee', hp: 120, dmg: 18, range: 1.1, speed: 2, interval: 1, cost: 5, flying: false },
      { id: 'cn_fly', name: '御剑童子', role: 'flyer', hp: 70, dmg: 14, range: 1.1, speed: 2.8, interval: 0.8, cost: 8, flying: true },
      { id: 'cn_talisman', name: '符箓师', role: 'ranged', hp: 80, dmg: 16, range: 4.5, speed: 1.8, interval: 1.1, cost: 7, flying: false },
      { id: 'cn_ape', name: '灵猿力士', role: 'tank', hp: 520, dmg: 24, range: 1.1, speed: 1.4, interval: 1.2, cost: 12, flying: false },
      // batch 1 (canvas board 兵种及动画): one wall breaker and one healer per civilization
      { id: 'cn_bomber', name: '丹炉童子', role: 'bomber', hp: 60, dmg: 40, range: 0.9, speed: 2.6, interval: 1, cost: 10, flying: false, wallMul: 8 },
      { id: 'cn_healer', name: '药仙', role: 'healer', hp: 180, dmg: 0, range: 3, speed: 1.8, interval: 1, cost: 15, flying: false, heal: 35 },
    ],
  },
  {
    id: 'jp', name: '扶桑·阴阳寮', tagline: '式神百鬼', color: 0xd04a5a,
    troops: [
      { id: 'jp_hero', name: '阴阳师', role: 'ranged', hp: 600, dmg: 85, range: 5, speed: 1.8, interval: 1.2, cost: 40, flying: false, hero: true, skill: 'summon' },
      { id: 'jp_fox', name: '式神狐', role: 'melee', hp: 100, dmg: 20, range: 1.1, speed: 2.6, interval: 0.9, cost: 5, flying: false },
      { id: 'jp_tengu', name: '天狗', role: 'flyer', hp: 90, dmg: 13, range: 1.1, speed: 2.7, interval: 0.8, cost: 8, flying: true },
      { id: 'jp_charm', name: '咒符师', role: 'ranged', hp: 75, dmg: 17, range: 4.5, speed: 1.8, interval: 1.1, cost: 7, flying: false },
      { id: 'jp_oni', name: '鬼武者', role: 'tank', hp: 560, dmg: 30, range: 1.1, speed: 1.3, interval: 1.3, cost: 12, flying: false },
      { id: 'jp_bomber', name: '爆符狸猫', role: 'bomber', hp: 70, dmg: 36, range: 0.9, speed: 2.7, interval: 1, cost: 10, flying: false, wallMul: 8 },
      { id: 'jp_healer', name: '巫女', role: 'healer', hp: 160, dmg: 0, range: 3.2, speed: 1.9, interval: 1, cost: 15, flying: false, heal: 32 },
    ],
  },
  {
    id: 'eu', name: '欧陆·圣庭', tagline: '符文圣骑', color: 0x4a86d0,
    troops: [
      { id: 'eu_hero', name: '女武神', role: 'flyer', hp: 700, dmg: 60, range: 1.3, speed: 2.8, interval: 0.8, cost: 40, flying: true, hero: true, skill: 'warcry' },
      { id: 'eu_knight', name: '符文骑士', role: 'melee', hp: 140, dmg: 17, range: 1.1, speed: 1.9, interval: 1, cost: 5, flying: false },
      { id: 'eu_gryphon', name: '狮鹫', role: 'flyer', hp: 110, dmg: 14, range: 1.1, speed: 2.7, interval: 0.9, cost: 8, flying: true },
      { id: 'eu_archer', name: '精灵弓手', role: 'ranged', hp: 70, dmg: 18, range: 5, speed: 1.9, interval: 1.2, cost: 7, flying: false },
      { id: 'eu_golem', name: '符文巨像', role: 'tank', hp: 600, dmg: 22, range: 1.1, speed: 1.2, interval: 1.3, cost: 12, flying: false, targetsDefense: true },
      { id: 'eu_bomber', name: '矮人爆破工', role: 'bomber', hp: 90, dmg: 34, range: 0.9, speed: 2.3, interval: 1, cost: 10, flying: false, wallMul: 8 },
      { id: 'eu_healer', name: '修女', role: 'healer', hp: 200, dmg: 0, range: 3, speed: 1.8, interval: 1.1, cost: 15, flying: false, heal: 38 },
    ],
  },
];

export type BuildingKind = 'core' | 'tower' | 'wall' | 'mine' | 'barracks' | 'aoe';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  hp: number;
  color: number;
  limit: number;
  cost: number; // 灵石 to place; upgrades scale from it
  // defenses only
  range?: number;
  dmg?: number;
  interval?: number;
  /** Damage also lands on every troop within this many cells of the one aimed at. */
  splash?: number;
  /** Cannot hit flying troops. */
  groundOnly?: boolean;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  core: { kind: 'core', name: '仙门大殿', hp: 800, color: 0xf0d060, limit: 1, cost: 300 },
  tower: { kind: 'tower', name: '灵塔', hp: 320, color: 0x8060d0, limit: 6, cost: 150, range: 6, dmg: 18, interval: 1 },
  wall: { kind: 'wall', name: '符墙', hp: 160, color: 0x808890, limit: 40, cost: 20 },
  mine: { kind: 'mine', name: '灵石矿', hp: 140, color: 0x40b0a0, limit: 8, cost: 100 },
  // batch 1 (canvas board 兵种及动画)
  barracks: { kind: 'barracks', name: '兵营', hp: 420, color: 0xd07a40, limit: 1, cost: 200 },
  aoe: { kind: 'aoe', name: '法阵塔', hp: 380, color: 0x40a0d0, limit: 3, cost: 250, range: 5, dmg: 34, interval: 2.4, splash: 1.3, groundOnly: true },
};

/**
 * Training in the 军营: each troop costs 灵石 (paid when the raid starts, refunded for troops left undeployed) and
 * takes `housing` of the army's population; heroes are free and take none. A troop unlocks once the player owns a
 * building of `unlock.kind` at `unlock.lvl` or higher, so new buildings can gate troops by data alone.
 */
export interface TrainDef { housing: number; cost: number; unlock: { kind: BuildingKind; lvl: number } }
// melee and ranged come with the hall so a new player can always raid; the rest follow the 兵营's level
export const TRAIN_BY_ROLE: Record<Role, TrainDef> = {
  melee: { housing: 1, cost: 10, unlock: { kind: 'core', lvl: 1 } },
  ranged: { housing: 2, cost: 18, unlock: { kind: 'core', lvl: 1 } },
  tank: { housing: 4, cost: 40, unlock: { kind: 'barracks', lvl: 1 } },
  bomber: { housing: 2, cost: 25, unlock: { kind: 'barracks', lvl: 1 } },
  healer: { housing: 4, cost: 50, unlock: { kind: 'barracks', lvl: 2 } },
  flyer: { housing: 2, cost: 22, unlock: { kind: 'barracks', lvl: 3 } },
};
/** Grid order of roles in the 军营: by unlock, so locked ones sit to the right. */
export const ROLE_ORDER: Role[] = ['melee', 'ranged', 'tank', 'bomber', 'healer', 'flyer'];
export const trainOf = (t: TroopDef): TrainDef => TRAIN_BY_ROLE[t.role];
/** Army population by 仙门大殿 level (index = level). */
export const HOUSING_CAP = [0, 20, 30, 40];

export const MAX_LEVEL = 3;
/** HP, tower damage and mine output all scale with this. */
export const levelMul = (lvl: number) => 1 + 0.4 * (lvl - 1);
/** Cost to go from `lvl` to `lvl + 1`. */
export const upgradeCost = (kind: BuildingKind, lvl: number) => Math.round(BUILDINGS[kind].cost * lvl * 1.5);
