import { FACTIONS, type TroopDef } from '../data/factions';
import { armyOf, type Save } from './economy';
import { generateEnemyBase, type Battle } from './sim';

export type NodeKind = 'outpost' | 'elite' | 'camp' | 'ruin' | 'boss';
export type RelicId = 'fury' | 'sky' | 'range' | 'guard' | 'siege' | 'plunder';
export const RELICS: Record<RelicId, { name: string; desc: string }> = {
  fury: { name: '征伐战旗', desc: '全军伤害 +18% / 层' },
  sky: { name: '风神羽印', desc: '飞行兵伤害 +35%，速度 +15% / 层' },
  range: { name: '鹰眼秘卷', desc: '远程兵射程 +1，伤害 +20% / 层' },
  guard: { name: '不屈军魂', desc: '全军生命 +25%，重装伤害 +25% / 层' },
  siege: { name: '破城军械', desc: '全军对建筑伤害 +30% / 层' },
  plunder: { name: '以战养战', desc: '每摧毁一座建筑，回复 4 灵气 / 层' },
};
export const NODE_INFO: Record<NodeKind, { name: string; desc: string; color: number }> = {
  outpost: { name: '边境据点', desc: '常规攻城 · 灵石 90 · 补给 +25', color: 0x638fb3 },
  elite: { name: '精英城寨', desc: '防御加强 · 灵石 160 · 补给 +35', color: 0xc76b59 },
  camp: { name: '行军营地', desc: '恢复 30 战备与 60 补给', color: 0x539e8b },
  ruin: { name: '失落遗迹', desc: '封存战利品，或冒险搜寻宝藏', color: 0xa587c6 },
  boss: { name: '镇境首领', desc: '决战主城 · 灵石 300 · 代币 +2', color: 0xd5ac58 },
};
export interface Run {
  seed: number;
  stage: number;
  phase: 'route' | 'battle' | 'relic' | 'finished';
  node: NodeKind | null;
  engaged: boolean;
  path: number[];
  supplies: number;
  readiness: number;
  carried: number;
  secured: number;
  tokens: number;
  victories: number;
  relics: Partial<Record<RelicId, number>>;
  offers: RelicId[];
  army: TroopDef[];
  civilization: number;
  result: string;
}
const random = (seed: number) => {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
};
export function startRun(s: Save, seed = Date.now()): boolean {
  if (s.civilization === null || (s.run && s.run.phase !== 'finished')) return false;
  s.run = { seed: seed >>> 0, stage: 0, phase: 'route', node: null, engaged: false, path: [],
    supplies: 220, readiness: 100, carried: 0, secured: 0, tokens: 0,
    victories: 0, relics: {}, offers: [], army: armyOf(s), civilization: s.civilization, result: '' };
  return true;
}
export function routeAt(r: Run, stage = r.stage): NodeKind[] {
  if (stage === 4) return ['boss'];
  if (stage === 2) return ['camp', 'ruin'];
  const flip = random(r.seed + stage * 113)() > 0.5;
  return flip ? ['elite', 'outpost'] : ['outpost', 'elite'];
}
export function chooseNode(r: Run, lane: number): boolean {
  if (r.phase !== 'route' || r.node !== null) return false;
  const node = routeAt(r)[lane];
  // the boss is the only way forward on the last stage, so low supplies weaken that fight instead of blocking it
  if (!node || (!['camp', 'ruin', 'boss'].includes(node) && r.supplies < MIN_SUPPLIES)) return false;
  r.node = node; r.path.push(lane);
  if (node === 'camp') {
    r.supplies = Math.min(260, r.supplies + 60); r.readiness = Math.min(100, r.readiness + 30); r.stage++; r.node = null;
  } else if (node !== 'ruin') { r.phase = 'battle'; r.engaged = false; }
  return true;
}
export function resolveRuin(r: Run, safe: boolean): boolean {
  if (r.phase !== 'route' || r.node !== 'ruin') return false;
  if (safe) { r.secured += r.carried; r.carried = 0; }
  else { r.carried += 180; r.readiness = Math.max(35, r.readiness - 20); }
  r.node = null; r.stage++;
  return true;
}
export function runArmy(r: Run): TroopDef[] {
  const stacks = (id: RelicId) => r.relics[id] ?? 0;
  return r.army.map(t => ({ ...t,
    hp: Math.max(1, Math.round(t.hp * r.readiness / 100 * (1 + stacks('guard') * 0.25))),
    dmg: Math.round(t.dmg * (1 + stacks('fury') * 0.18 + (t.flying ? stacks('sky') * 0.25 : 0)
      + (t.role === 'ranged' ? stacks('range') * 0.2 : 0) + (t.role === 'tank' ? stacks('guard') * 0.25 : 0))),
    speed: t.speed * (1 + (t.flying ? stacks('sky') * 0.15 : 0)),
    range: t.range + (t.role === 'ranged' ? stacks('range') : 0),
  }));
}
/** Supplies needed to enter a regular battle node, and the 灵气 every expedition battle gets at least. */
export const MIN_SUPPLIES = 40;
export const runEnergy = (r: Run) => Math.max(MIN_SUPPLIES, Math.min(r.supplies, 100 + (r.civilization === 1 ? 15 : 0)));
export function runLayout(r: Run) {
  const layout = generateEnemyBase(r.seed + r.stage * 31, 1);
  // First nodes are lighter than standard raids; elite/boss add durable defenses.
  const towers = layout.filter(b => b.kind === 'tower');
  const count = r.node === 'boss' ? 4 : r.node === 'elite' ? 2 : 1;
  return layout.filter(b => b.kind !== 'tower' || towers.indexOf(b) < count).map(b => ({ ...b,
    lvl: r.node === 'boss' && (b.kind === 'core' || b.kind === 'tower') ? 2 : 1 }));
}
export function relicOffers(r: Run): RelicId[] {
  const rnd = random(r.seed + r.stage * 777 + 43);
  const pool = (Object.keys(RELICS) as RelicId[]).filter(id => (r.relics[id] ?? 0) < 2);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}
export function finishEncounter(s: Save, b: Battle): string {
  const r = s.run;
  if (!r || r.phase !== 'battle' || !r.engaged) return '';
  const spent = Math.max(0, b.energySpent);
  r.supplies = Math.max(0, r.supplies - spent);
  if (b.result !== 'win') return cashOut(s, false);
  r.victories++;
  r.carried += r.node === 'boss' ? 300 : r.node === 'elite' ? 160 : 90;
  r.tokens += r.node === 'boss' ? 2 : 1;
  r.supplies = Math.min(260, r.supplies + (r.node === 'elite' ? 35 : 25));
  const dead = Math.max(0, b.deployedCount - b.units.length);
  r.readiness = Math.max(35, r.readiness - Math.min(25, 8 + dead * 2));
  if (r.node === 'boss') return cashOut(s, true, true);
  r.stage++; r.phase = 'relic'; r.engaged = false; r.node = null; r.offers = relicOffers(r);
  return '据点攻克 · 战利品已装载\n选择一件遗物，继续远征或撤离';
}
export function pickRelic(r: Run, id: RelicId): boolean {
  if (r.phase !== 'relic' || !r.offers.includes(id)) return false;
  r.relics[id] = (r.relics[id] ?? 0) + 1; r.offers = []; r.phase = 'route';
  return true;
}
export function cashOut(s: Save, success: boolean, cleared = false): string {
  const r = s.run;
  if (!r || r.phase === 'finished') return r?.result ?? '';
  const stone = r.secured + (success ? r.carried : Math.floor(r.carried / 2));
  s.stone += stone;
  if (success) {
    s.tokens += r.tokens;
    s.wins += r.victories;
  }
  r.phase = 'finished'; r.engaged = false;
  r.result = `${cleared ? '远征大捷' : success ? '安全撤离' : '远征受挫'} · 灵石 +${stone}\n` +
    (success ? `代币 +${r.tokens}` : '保留封存与半数随身灵石，英雄与装备无损');
  return r.result;
}
