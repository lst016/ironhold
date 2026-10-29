import { BUILDINGS, FACTIONS, MAX_LEVEL, levelMul, ROLE_NAME, ROLE_ORDER, TRAIN_BY_ROLE, upgradeCost, type BuildingKind, type TroopDef } from '../data/factions';
import { GRID, type BuildingSpec } from './sim';
import type { Run } from './expedition';
import { DEFAULT_SKIN, MAP_SKINS } from '../data/maps';
import { STAR_BONUS, starsOf } from './summon';
import { costOf, starterArmy } from './army';

export interface Save {
  layout: (BuildingSpec & { lvl: number })[];
  stone: number; // 灵石 in the wallet
  pending: number; // 灵石 produced by mines, waiting to be collected
  ts: number; // last accrual time (ms)
  opponent: number; // index of the next enemy base
  wins: number;
  civilization: number | null;
  tokens: number;
  heroes: Record<string, { constellation: number; weapon: number }>;
  squad: string[]; // [0] the hero fielded in raids ('' when none is fielded); all five make the expedition lineup
  army: Record<string, number>; // 军营 composition: troop id -> count, trained when a raid starts (src/core/army.ts)
  raidPool: Record<string, number> | null; // troops of a raid in progress not yet deployed; refunded if it never settles
  buildFaction: number; // style of newly placed buildings: the opening civilization
  mapFaction: number;
  run: Run | null;
  mapSkin: string; // equipped map skin (src/data/maps.ts)
  skins: string[]; // unlocked map skins
  skinAds: Record<string, number>; // rewarded views counted toward each locked skin
  adReceipts: string[]; // receipts already granted, so a replayed callback pays out once
  pity: number; // summons since the last hero (src/core/summon.ts)
  souls: Record<string, number>; // troop souls collected per troop id, toward its stars
  profile: { name: string; avatar: string }; // 道号 and the unit whose portrait is the avatar (both set on the first civilization pick)
  settings: { calm: boolean }; // calm: no screen shake or flashes
}

const SURNAMES = ['云', '林', '苏', '萧', '叶', '沈', '楚', '顾', '白', '墨', '凌', '慕容', '上官', '司徒'];
const GIVEN = ['无尘', '长歌', '子衿', '逍遥', '凌霄', '惊鸿', '听雪', '问天', '青玄', '清欢', '止水', '星河', '临渊', '扶摇'];
/** The placeholder 道号 a new game starts with, e.g. 道友3721; the player renames it in 个人设置. */
export function defaultName(rng: () => number = Math.random): string {
  return `道友${1000 + Math.floor(rng() * 9000)}`;
}

export const NAME_MAX = 8;
/** Rename the player: trimmed, inner runs of spaces collapsed, 1..NAME_MAX characters. */
export function setName(s: Save, raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return '道号不能为空';
  if ([...name].length > NAME_MAX) return `道号最多 ${NAME_MAX} 个字`;
  s.profile.name = name;
  return null;
}

/** A random xianxia-style 道号, e.g. 云无尘 (the 随机 button in the rename box). */
export function randomName(rng: () => number = Math.random): string {
  const sur = SURNAMES[Math.floor(rng() * SURNAMES.length)];
  // skip given names that start with the surname (凌 + 凌霄 would read 凌凌霄)
  const given = GIVEN.filter((g) => !g.startsWith(sur));
  return sur + given[Math.floor(rng() * given.length)];
}

/** Units that may be the avatar: every troop, and the heroes already owned. */
export function avatarChoices(s: Save) {
  return FACTIONS.flatMap((f) => f.troops).map((t) => ({ id: t.id, unlocked: !t.hero || !!s.heroes[t.id] }));
}

/** Put on an avatar; heroes not yet summoned are refused. */
export function setAvatar(s: Save, id: string): string | null {
  const c = avatarChoices(s).find((a) => a.id === id);
  if (!c) return '没有这个头像';
  if (!c.unlocked) return '召唤获得该英雄后可用';
  s.profile.avatar = id;
  return null;
}

/** The avatar shown: the chosen one, else the opening civilization's hero. */
export const avatarOf = (s: Save) => s.profile.avatar || FACTIONS[s.civilization ?? 0].troops[0].id;

export const MINE_RATE = 1.5; // 灵石/s per level-1 mine
export const START_STONE = 500;

export const defaultSave = (now: number): Save => ({
  layout: [{ kind: 'core', x: 9, y: 9, lvl: 1 }, { kind: 'mine', x: 7, y: 12, lvl: 1 }], // a free starter mine so a new player always has income
  stone: START_STONE, pending: 0, ts: now, opponent: 1, wins: 0,
  civilization: null, tokens: 3,
  heroes: {}, squad: [], army: {}, raidPool: null, buildFaction: 0, mapFaction: 0, run: null,
  mapSkin: DEFAULT_SKIN, skins: MAP_SKINS.filter((m) => !m.ads).map((m) => m.id), skinAds: {}, adReceipts: [],
  pity: 0, souls: {},
  profile: { name: '', avatar: '' }, settings: { calm: false },
});

/** Put on an unlocked map skin. */
export function equipSkin(s: Save, id: string): string | null {
  if (!s.skins.includes(id)) return '该地图尚未解锁';
  s.mapSkin = id;
  return null;
}

/**
 * Count one completed rewarded view toward a skin; the last required view unlocks and equips it.
 * Call only after the ad platform's reward callback. A receipt seen before changes nothing.
 */
export function grantSkinAd(s: Save, id: string, receipt: string): 'unlocked' | 'progress' | 'duplicate' | 'owned' | 'unknown' {
  const skin = MAP_SKINS.find((m) => m.id === id);
  if (!skin) return 'unknown';
  if (s.adReceipts.includes(receipt)) return 'duplicate';
  if (s.skins.includes(id)) return 'owned';
  s.adReceipts.push(receipt);
  const n = (s.skinAds[id] ?? 0) + 1;
  s.skinAds[id] = n;
  if (n < skin.ads) return 'progress';
  s.skins.push(id);
  s.mapSkin = id;
  return 'unlocked';
}

export const BUILDING_DESC: Record<BuildingKind, string> = {
  core: '仙门根本。大殿等级决定其他建筑能升到几级，被攻破即告败。',
  tower: '自动攻击射程内最近的敌人，是守城的主力。',
  wall: '拦住敌军去路，逼他们绕行或先拆墙。',
  mine: '持续产出灵石，点右上角灵石条收取；数量越多、等级越高，产得越快、存得越多。',
  barracks: '操练兵马。兵营等级决定能在军营训练哪些兵种，等级不能超过大殿。',
  aoe: '轰击射程内的地面敌军，命中点周围一并受伤；打不到飞行兵，攻速较慢。',
};

/** What each 兵营 level unlocks in the 军营, e.g. 1 -> 重装 · 破墙. */
export function barracksUnlocks(lvl: number): string {
  return ROLE_ORDER.filter((r) => TRAIN_BY_ROLE[r].unlock.kind === 'barracks' && TRAIN_BY_ROLE[r].unlock.lvl === lvl).map((r) => ROLE_NAME[r]).join(' · ') || '—';
}

/** What a building of `kind` does at `lvl`, row by row, with the next level's value when there is one. */
export function buildingStats(kind: BuildingKind, lvl: number) {
  const def = BUILDINGS[kind], next = lvl < MAX_LEVEL ? lvl + 1 : null;
  const rows: { label: string; now: string; next: string | null }[] = [];
  const row = (label: string, f: (l: number) => string) => rows.push({ label, now: f(lvl), next: next ? f(next) : null });
  row('生命', (l) => `${Math.round(def.hp * levelMul(l))}`);
  if (kind === 'tower' || kind === 'aoe') {
    row('伤害', (l) => `${Math.round(def.dmg! * levelMul(l))}`);
    row('每秒伤害', (l) => `${Math.round((def.dmg! * levelMul(l)) / def.interval!)}`);
    row('射程', () => `${def.range} 格`);
    row('攻击间隔', () => `${def.interval} 秒`);
    if (def.splash) row('溅射范围', () => `${def.splash} 格 · 仅地面`);
  }
  if (kind === 'barracks') row('本级解锁', (l) => barracksUnlocks(l));
  if (kind === 'mine') {
    // units ride in the label so the two value columns stay short
    row('每分钟产灵石', (l) => `${Math.round(MINE_RATE * levelMul(l) * 60)}`);
    row('灵石储量', (l) => `${Math.round(200 * levelMul(l))}`);
  }
  if (kind === 'core') row('建筑等级上限', (l) => `${l} 级`);
  return rows;
}

export const coreLevel = (s: Save) => s.layout.find((b) => b.kind === 'core')?.lvl ?? 1;
export const mineRate = (s: Save) => s.layout.filter((b) => b.kind === 'mine').reduce((a, b) => a + MINE_RATE * levelMul(b.lvl), 0);
export const pendingCap = (s: Save) => 100 + s.layout.filter((b) => b.kind === 'mine').reduce((a, b) => a + 200 * levelMul(b.lvl), 0);

export function accrue(s: Save, now: number): void {
  const dt = Math.max(0, (now - s.ts) / 1000);
  s.pending = Math.min(pendingCap(s), s.pending + mineRate(s) * dt);
  s.ts = now;
}

export function collect(s: Save): number {
  const got = Math.floor(s.pending);
  s.stone += got;
  s.pending -= got;
  return got;
}

const at = (s: Save, x: number, y: number) => s.layout.findIndex((b) => b.x === x && b.y === y);

/** Each mutator returns an error message, or null on success. */
export function place(s: Save, kind: BuildingKind, x: number, y: number): string | null {
  const def = BUILDINGS[kind];
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return '超出地图';
  if (at(s, x, y) >= 0) return '这里已有建筑';
  if (s.layout.filter((b) => b.kind === kind).length >= def.limit) return `${def.name}已达上限 ${def.limit}`;
  if (s.stone < def.cost) return `灵石不足,需要 ${def.cost}`;
  s.stone -= def.cost;
  s.layout.push({ kind, x, y, lvl: 1, faction: s.buildFaction });
  return null;
}

/** Move the building on (x, y) to the empty cell (nx, ny); free, like rearranging a base. */
export function move(s: Save, x: number, y: number, nx: number, ny: number): string | null {
  const i = at(s, x, y);
  if (i < 0) return '这里没有建筑';
  if (nx === x && ny === y) return null;
  if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return '超出地图';
  if (at(s, nx, ny) >= 0) return '这里已有建筑';
  s.layout[i].x = nx;
  s.layout[i].y = ny;
  return null;
}

export function upgrade(s: Save, x: number, y: number): string | null {
  const i = at(s, x, y);
  if (i < 0) return '这里没有建筑';
  const b = s.layout[i];
  const name = BUILDINGS[b.kind].name;
  if (b.lvl >= MAX_LEVEL) return `${name}已满级`;
  if (b.kind !== 'core' && b.lvl >= coreLevel(s)) return '先升级仙门大殿';
  const cost = upgradeCost(b.kind, b.lvl);
  if (s.stone < cost) return `灵石不足,升级需要 ${cost}`;
  s.stone -= cost;
  b.lvl++;
  return null;
}

/** Turn a building to face the other way. A wall joined to other walls takes its facing from them. */
export function turn(s: Save, x: number, y: number): string | null {
  const i = at(s, x, y);
  if (i < 0) return '这里没有建筑';
  const b = s.layout[i];
  if (b.kind === 'wall' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.layout.some((q) => q.kind === 'wall' && q.x === x + dx && q.y === y + dy)))
    return '相连的城墙会顺着邻墙自动转向';
  b.dir = b.dir ? 0 : 1;
  return null;
}

export function remove(s: Save, x: number, y: number): string | null {
  const i = at(s, x, y);
  if (i < 0) return '这里没有建筑';
  const b = s.layout[i];
  if (b.kind === 'core') return '大殿不可拆除';
  s.stone += Math.floor(BUILDINGS[b.kind].cost / 2);
  s.layout.splice(i, 1);
  return null;
}

/** Losing a defense costs a quarter of the wallet; holding it pays a small bounty. */
export function applyRaid(s: Save, coreFell: boolean): number {
  if (coreFell) { const lost = Math.floor(s.stone * 0.25); s.stone -= lost; return -lost; }
  s.stone += 50;
  return 50;
}

const KEY = 'ironhold.save.v2';

/**
 * Testing: in the dev preview every load tops summon tokens back up to this many (0 turns it off).
 * Published builds are not affected.
 */
export const TEST_TOKENS = 0;
const DEV = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

export function loadSave(now = Date.now()): Save {
  const s = readSave(now);
  if (DEV && s.tokens < TEST_TOKENS) s.tokens = TEST_TOKENS;
  return s;
}

function readSave(now: number): Save {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && Array.isArray(v.layout)) {
      const s = { ...defaultSave(now), ...v } as Save;
      if (!s.squad.length && s.civilization !== null) chooseCivilization(s, s.civilization);
      // saves from before the 军营 start with the civilization's starter army
      if (!s.army || typeof s.army !== 'object') s.army = {};
      if (!('army' in v) && s.civilization !== null) s.army = starterArmy(s.civilization);
      // a raid that was closed before it settled: pay back the troops it never sent in
      if (s.raidPool) { s.stone += costOf(s.raidPool); s.raidPool = null; }
      // older saves: starter mine hidden behind the hall, and runs saved without an army snapshot
      const core = s.layout.find((b) => b.kind === 'core');
      const hid = s.layout.find((b) => b.kind === 'mine' && b.x === 7 && b.y === 9);
      if (core && core.x === 9 && core.y === 9 && hid && !s.layout.some((b) => b.x === 7 && b.y === 12)) hid.y = 12;
      if (s.run && (!Array.isArray(s.run.army) || !s.run.army.length)) s.run.army = armyOf(s);
      if (!s.skins.includes(s.mapSkin)) s.mapSkin = DEFAULT_SKIN;
      if (!s.profile.name && s.civilization !== null) s.profile.name = defaultName();
      if (!s.profile.avatar && s.civilization !== null) s.profile.avatar = FACTIONS[s.civilization].troops[0].id;
      accrue(s, now); return s;
    }
  } catch { /* corrupted or no storage: start fresh */ }
  return defaultSave(now);
}

export const TRAITS = ['剑道传承：全军伤害 +10%', '灵脉共鸣：带兵人口 +5', '圣庭庇护：全军生命 +15%'];

export function chooseCivilization(s: Save, index: number): void {
  if (s.civilization !== null && s.squad.length) return;
  s.civilization = index;
  s.buildFaction = index;
  s.mapFaction = index;
  const hero = FACTIONS[index].troops[0];
  // a new player starts as 道友xxxx with their civilization's hero as the avatar
  if (!s.profile.name) s.profile.name = defaultName();
  if (!s.profile.avatar) s.profile.avatar = hero.id;
  s.heroes[hero.id] = { constellation: 0, weapon: 0 };
  s.squad = FACTIONS[index].troops.map(t => t.id);
  if (!Object.keys(s.army).length) s.army = starterArmy(index);
  s.layout.forEach(b => b.faction = index);
  // Each civilization receives a different free foundational defense.
  if (index !== 0 && !s.layout.some(b => b.kind === 'tower' || b.kind === 'wall'))
    s.layout.push({ kind: index === 1 ? 'wall' : 'tower', x: 10, y: 9, lvl: 1, faction: index });
}

export function enhanceWeapon(s: Save, id: string): string {
  const h = s.heroes[id];
  if (!h) return '尚未拥有此英雄';
  if (h.weapon >= 5) return '武器已达最高 5 级';
  const cost = 100 * (h.weapon + 1);
  if (s.stone < cost) return `灵石不足，需要 ${cost}`;
  s.stone -= cost; h.weapon++;
  return `武器强化至 ${h.weapon} 级（每级伤害 +12%）`;
}

export function expeditionReward(s: Save): string {
  s.tokens += 2;
  s.stone += 100;
  return '召唤代币 +2 · 灵石 +100';
}

/** The expedition lineup; an empty hero slot ('' after 取消出战) is skipped. */
export function armyOf(s: Save) {
  const all = FACTIONS.flatMap(f => f.troops);
  return s.squad.flatMap(id => { const t = all.find(q => q.id === id); return t ? [boosted(s, t)] : []; });
}

/** A unit with this save's growth applied: troop stars, hero constellation and weapon, and the civilization trait. */
export function boosted<T extends TroopDef>(s: Save, t: T): T {
  const h = s.heroes[t.id];
  const star = 1 + starsOf(s.souls[t.id] ?? 0) * STAR_BONUS; // troop souls from summons; heroes have none
  return { ...t,
    dmg: Math.round(t.dmg * star * (s.civilization === 0 ? 1.1 : 1) * (1 + (h?.weapon ?? 0) * 0.12 + (h?.constellation ?? 0) * 0.08)),
    hp: Math.round(t.hp * star * (s.civilization === 2 ? 1.15 : 1) * (1 + (h?.constellation ?? 0) * 0.1)) };
}

export function writeSave(s: Save): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Forget the saved game; the next load starts fresh. */
export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
