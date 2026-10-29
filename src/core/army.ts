import { BUILDINGS, FACTIONS, HOUSING_CAP, trainOf, type TroopDef } from '../data/factions';
import { coreLevel, type Save } from './economy';

/**
 * 军营: the army is a composition (troop id -> count) the player sets up in advance. Starting a raid trains it all
 * at once (秒出), paying 灵石; whatever is not deployed is refunded when the raid ends. Heroes are not trained: the
 * 英灵殿's fielded hero joins every raid for free and takes no population.
 */
export type Army = Record<string, number>;

const ALL = FACTIONS.flatMap((f) => f.troops);
export const troopById = (id: string) => ALL.find((t) => t.id === id);
/** Every troop that can be trained, by civilization then by the faction's own order. */
export const trainable = (): TroopDef[] => ALL.filter((t) => !t.hero);

/** Population the army may hold: set by the 仙门大殿 level, +5 for 扶桑's 灵脉共鸣. */
export const housingCap = (s: Save) => HOUSING_CAP[Math.min(coreLevel(s), HOUSING_CAP.length - 1)] + (s.civilization === 1 ? 5 : 0);
// heroes may sit in a raid's pool (as 1) but are never trained, so they cost and house nothing
const sum = (a: Army, f: (t: TroopDef) => number) =>
  Object.entries(a).reduce((n, [id, c]) => { const t = troopById(id); return n + (t && !t.hero ? f(t) * Math.max(0, c) : 0); }, 0);
export const housingOf = (a: Army) => sum(a, (t) => trainOf(t).housing);
export const costOf = (a: Army) => sum(a, (t) => trainOf(t).cost);

/** Null when the troop can be trained, else what is missing (e.g. 需要 2 级仙门大殿). */
export function lockReason(s: Save, t: TroopDef): string | null {
  const { kind, lvl } = trainOf(t).unlock;
  const best = s.layout.filter((b) => b.kind === kind).reduce((m, b) => Math.max(m, b.lvl), 0);
  return best >= lvl ? null : `需要 ${lvl} 级${BUILDINGS[kind].name}`;
}

/** Add one troop to the composition; returns an error message, or null. */
export function addTroop(s: Save, id: string): string | null {
  const t = troopById(id);
  if (!t || t.hero) return '无法训练';
  const lock = lockReason(s, t);
  if (lock) return lock;
  const left = housingCap(s) - housingOf(s.army);
  if (trainOf(t).housing > left) return left > 0 ? `人口不足：${t.name}占 ${trainOf(t).housing}，只剩 ${left}` : `人口已满（${housingCap(s)}）· 升级大殿可扩充`;
  s.army[id] = (s.army[id] ?? 0) + 1;
  return null;
}

export function removeTroop(s: Save, id: string): void {
  if (!s.army[id]) return;
  if (--s.army[id] <= 0) delete s.army[id];
}

/** The composition in display order: troops grouped as listed in the factions, empty and unknown ids dropped. */
export function armyList(a: Army): { t: TroopDef; n: number }[] {
  return trainable().filter((t) => (a[t.id] ?? 0) > 0).map((t) => ({ t, n: a[t.id] }));
}

/** A new player's first army: the civilization's melee and ranged troops, filling most of a level-1 camp. */
export function starterArmy(civilization: number): Army {
  const f = FACTIONS[civilization];
  const melee = f.troops.find((t) => !t.hero && t.role === 'melee')!, ranged = f.troops.find((t) => !t.hero && t.role === 'ranged')!;
  return { [melee.id]: 10, [ranged.id]: 4 };
}

/** What a raid would train now (locked troops and any overflow past the population dropped) and its 灵石 cost. */
export function raidPlan(s: Save): { pool: Army; cost: number; error: string | null } {
  const pool: Army = {};
  let room = housingCap(s);
  for (const { t, n } of armyList(s.army)) {
    if (lockReason(s, t)) continue;
    const k = Math.min(n, Math.floor(room / trainOf(t).housing));
    if (k > 0) { pool[t.id] = k; room -= k * trainOf(t).housing; }
  }
  const cost = costOf(pool);
  const error = !Object.keys(pool).length ? '军营还没有配兵' : s.stone < cost ? `灵石不足：出兵需要 ${cost}，现有 ${Math.floor(s.stone)}` : null;
  return { pool, cost, error };
}

/**
 * Train the composition for a raid and pay for it. Returns the troops to deploy and what was paid, or an error when
 * there is nothing to train or the wallet is short (nothing is charged then).
 */
export function muster(s: Save): { pool: Army; paid: number } | { error: string } {
  const p = raidPlan(s);
  if (p.error) return { error: p.error };
  s.stone -= p.cost;
  return { pool: p.pool, paid: p.cost };
}

/** Pay back the troops a raid left undeployed. Returns the 灵石 refunded. */
export function refund(s: Save, left: Army): number {
  const back = costOf(left);
  s.stone += back;
  return back;
}
