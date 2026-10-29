import { BUILDINGS, FACTIONS, levelMul, type BuildingKind, type TroopDef } from '../data/factions';

export const GRID = 20;

export interface Building { id: number; kind: BuildingKind; x: number; y: number; lvl: number; hp: number; maxHp: number; cd: number; dir: 0 | 1 }
export interface Unit { id: number; def: TroopDef; x: number; y: number; hp: number; cd: number; target: number | null }
/** dir 1 shows the mirrored art (the building faces the other way); walls pick their own facing from neighbours. */
export interface BuildingSpec { kind: BuildingKind; x: number; y: number; lvl?: number; faction?: number; dir?: 0 | 1 }
export interface Spawn { t: number; def: TroopDef; x: number; y: number }
export interface Fx { x: number; y: number; r: number; color: number; life: number }

export type Mode = 'attack' | 'defend';

export interface Battle {
  mode: Mode;
  time: number;
  buildings: Building[];
  units: Unit[];
  spawns: Spawn[]; // scheduled arrivals (defense waves), sorted by t
  fx: Fx[];
  energy: number;
  energySpent: number;
  /** Raids from the 军营: troops left to deploy by id (the hero as 1). When set it replaces 灵气 as the limit. */
  pool: Record<string, number> | null;
  deployedCount: number;
  siege: number;
  plunder: number;
  rewarded: number[];
  singleHero: boolean;
  heroDeployed: boolean;
  nextId: number;
  skillUsed: boolean;
  /** 'win' = the core fell (attacker succeeded); 'lose' = the attack failed or timed out. */
  result: 'running' | 'win' | 'lose';
}

export const TIME_LIMIT = 120;
export const START_ENERGY = 100;
const ALL_TROOPS = FACTIONS.flatMap((f) => f.troops);

export function newBattle(layout: BuildingSpec[], mode: Mode = 'attack', spawns: Spawn[] = []): Battle {
  const b: Battle = {
    mode, time: 0, buildings: [], units: [], spawns: [...spawns].sort((p, q) => p.t - q.t), fx: [],
    energy: mode === 'attack' ? START_ENERGY : 0, energySpent: 0, pool: null, deployedCount: 0,
    siege: 0, plunder: 0, rewarded: [], singleHero: false, heroDeployed: false,
    nextId: 1, skillUsed: false, result: 'running',
  };
  for (const s of layout) {
    const lvl = s.lvl ?? 1;
    const maxHp = Math.round(BUILDINGS[s.kind].hp * levelMul(lvl));
    b.buildings.push({ id: b.nextId++, kind: s.kind, x: s.x + 0.5, y: s.y + 0.5, lvl, hp: maxHp, maxHp, cd: 0, dir: s.dir ?? 0 });
  }
  return b;
}

/** Deploy a troop at a point. Returns false if none are left (pool) or energy is short, or the battle is over. */
export function deploy(b: Battle, def: TroopDef, x: number, y: number): boolean {
  if (b.result !== 'running' || b.mode !== 'attack') return false;
  if (b.pool ? !(b.pool[def.id] > 0) : b.energy < def.cost) return false;
  if (def.hero && b.singleHero && b.heroDeployed) return false;
  if (def.hero) b.heroDeployed = true;
  if (b.pool) b.pool[def.id]--;
  else {
    b.energy -= def.cost;
    b.energySpent += def.cost;
  }
  b.deployedCount++;
  b.units.push({ id: b.nextId++, def, x, y, hp: def.hp, cd: 0, target: null });
  return true;
}

export function heroAlive(b: Battle): Unit | undefined {
  return b.units.find((u) => u.def.hero && u.hp > 0);
}

/** Cast the deployed hero's skill (once per battle). */
export function castSkill(b: Battle): boolean {
  if (b.result !== 'running' || b.skillUsed) return false;
  const hero = heroAlive(b);
  if (!hero) return false;
  switch (hero.def.skill) {
    case 'sword_rain':
      for (const bl of b.buildings) if (bl.hp > 0 && dist(hero.x, hero.y, bl.x, bl.y) <= 3.5) bl.hp -= 150 * (1 + b.siege);
      b.fx.push({ x: hero.x, y: hero.y, r: 3.5, color: 0xf0e090, life: 0.8 });
      break;
    case 'summon': {
      const fox = ALL_TROOPS.find((t) => t.id === 'jp_fox')!;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.units.push({ id: b.nextId++, def: fox, x: hero.x + Math.cos(a), y: hero.y + Math.sin(a), hp: fox.hp, cd: 0, target: null });
      }
      b.fx.push({ x: hero.x, y: hero.y, r: 1.5, color: 0xd04a5a, life: 0.8 });
      break;
    }
    case 'warcry':
      for (const u of b.units) { u.hp = Math.min(u.def.hp, u.hp + 250); u.cd = 0; }
      b.fx.push({ x: hero.x, y: hero.y, r: 6, color: 0x80b0ff, life: 0.8 });
      break;
    default:
      return false;
  }
  b.skillUsed = true;
  return true;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function pickTarget(b: Battle, u: Unit): Building | undefined {
  const alive = b.buildings.filter((x) => x.hp > 0);
  // wall breakers go for walls while any stand
  const walls = u.def.wallMul ? alive.filter((x) => x.kind === 'wall') : [];
  let pool = walls.length ? walls : alive.filter((x) => x.kind !== 'wall');
  if (u.def.targetsDefense) {
    const towers = pool.filter((x) => x.kind === 'tower');
    if (towers.length) pool = towers;
  }
  if (!pool.length) pool = alive;
  let best: Building | undefined;
  let bd = Infinity;
  for (const t of pool) {
    const d = dist(u.x, u.y, t.x, t.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export function step(b: Battle, dt: number): void {
  for (const f of b.fx) f.life -= dt;
  b.fx = b.fx.filter((f) => f.life > 0);
  if (b.result !== 'running') return;
  b.time += dt;

  while (b.spawns.length && b.spawns[0].t <= b.time) {
    const s = b.spawns.shift()!;
    b.units.push({ id: b.nextId++, def: s.def, x: s.x, y: s.y, hp: s.def.hp, cd: 0, target: null });
  }

  for (const u of b.units) {
    if (u.hp <= 0) continue;
    u.cd -= dt;
    if (u.def.heal) { healerStep(b, u, dt); continue; }
    let t = b.buildings.find((x) => x.id === u.target && x.hp > 0);
    if (!t) { t = pickTarget(b, u); u.target = t ? t.id : null; }
    if (!t) continue;

    // Ground units are blocked by walls on the way: attack the wall in front instead.
    let goal = t;
    if (!u.def.flying) {
      const d = dist(u.x, u.y, t.x, t.y) || 1;
      const px = u.x + ((t.x - u.x) / d) * 0.8;
      const py = u.y + ((t.y - u.y) / d) * 0.8;
      const wall = b.buildings.find((w) => w.hp > 0 && w.kind === 'wall' && Math.floor(w.x) === Math.floor(px) && Math.floor(w.y) === Math.floor(py));
      if (wall) goal = wall;
    }

    const d = dist(u.x, u.y, goal.x, goal.y);
    if (d > u.def.range + 1e-6) {
      const s = Math.min(u.def.speed * dt, d - u.def.range);
      u.x += ((goal.x - u.x) / d) * s;
      u.y += ((goal.y - u.y) / d) * s;
    } else if (u.cd <= 0) {
      if (u.def.wallMul) {
        // a wall breaker blows up on contact: heavy damage to the wall and the walls beside it, light to anything else
        const hit = goal.kind === 'wall' ? b.buildings.filter((w) => w.hp > 0 && w.kind === 'wall' && dist(w.x, w.y, goal.x, goal.y) <= 1.2) : [goal];
        for (const w of hit) w.hp -= u.def.dmg * (w.kind === 'wall' ? u.def.wallMul : 1) * (1 + b.siege);
        b.fx.push({ x: goal.x, y: goal.y, r: 1.2, color: 0xffa040, life: 0.5 });
        u.hp = 0;
      } else goal.hp -= u.def.dmg * (1 + b.siege);
      u.cd = u.def.interval;
    }
  }

  for (const bl of b.buildings) {
    const def = BUILDINGS[bl.kind];
    if (bl.hp <= 0 || !def.dmg) continue;
    bl.cd -= dt;
    if (bl.cd > 0) continue;
    let best: Unit | undefined;
    let bd = def.range!;
    for (const u of b.units) {
      if (u.hp <= 0 || (def.groundOnly && u.def.flying)) continue;
      const d = dist(bl.x, bl.y, u.x, u.y);
      if (d <= bd) { bd = d; best = u; }
    }
    if (!best) continue;
    const dmg = def.dmg * levelMul(bl.lvl);
    if (def.splash) {
      const at = best;
      for (const u of b.units) if (u.hp > 0 && !(def.groundOnly && u.def.flying) && dist(u.x, u.y, at.x, at.y) <= def.splash) u.hp -= dmg;
      b.fx.push({ x: at.x, y: at.y, r: def.splash, color: 0x60c8ff, life: 0.45 });
    } else best.hp -= dmg;
    bl.cd = def.interval!;
  }

  b.units = b.units.filter((u) => u.hp > 0);

  for (const bl of b.buildings) if (bl.hp <= 0 && !b.rewarded.includes(bl.id)) {
    b.rewarded.push(bl.id);
    b.energy += b.plunder;
  }
  // The core falling secures the win, but the raid goes on until every building (walls excepted) is down, time
  // runs out, or no troops are left; then it is a win exactly when the core fell.
  const core = b.buildings.find((x) => x.kind === 'core');
  const coreDown = !!core && core.hp <= 0;
  // healers on their own cannot take a building, so they do not keep a raid alive
  const fighters = b.units.some((u) => !u.def.heal);
  if (!b.buildings.some((x) => x.kind !== 'wall' && x.hp > 0)) b.result = 'win';
  else if (b.time >= TIME_LIMIT || (!fighters && !b.spawns.length && !canDeploy(b))) b.result = coreDown ? 'win' : 'lose';
}

/**
 * A healer keeps near the closest friendly fighter (or the closest friend at all) and, once its cooldown is up,
 * restores HP to every hurt friend within its range. The cooldown only restarts when someone was healed, so its
 * cast animation plays on real heals.
 */
function healerStep(b: Battle, u: Unit, dt: number) {
  let lead: Unit | undefined, ld = Infinity;
  for (const o of b.units) {
    if (o === u || o.hp <= 0) continue;
    const d = dist(u.x, u.y, o.x, o.y) + (o.def.heal ? 100 : 0); // prefer fighters
    if (d < ld) { ld = d; lead = o; }
  }
  if (lead) {
    const d = dist(u.x, u.y, lead.x, lead.y), keep = Math.min(1.4, u.def.range * 0.6);
    if (d > keep) {
      const s = Math.min(u.def.speed * dt, d - keep);
      u.x += ((lead.x - u.x) / d) * s;
      u.y += ((lead.y - u.y) / d) * s;
    }
  }
  if (u.cd > 0) return;
  let healed = false;
  for (const o of b.units) {
    if (o === u || o.hp <= 0 || o.hp >= o.def.hp || dist(u.x, u.y, o.x, o.y) > u.def.range) continue;
    o.hp = Math.min(o.def.hp, o.hp + u.def.heal!);
    healed = true;
  }
  if (healed) {
    b.fx.push({ x: u.x, y: u.y, r: u.def.range, color: 0x7cf0a0, life: 0.5 });
    u.cd = u.def.interval;
  }
}

/** Whether the attacker still has anything to send in. */
export const canDeploy = (b: Battle) => (b.pool ? Object.values(b.pool).some((n) => n > 0) : b.energy >= 5);

/** Share of buildings destroyed, walls excepted (troops only break walls that stand in their way). */
export function destructionOf(b: Battle): number {
  const counted = b.buildings.filter((x) => x.kind !== 'wall');
  return counted.length ? counted.filter((x) => x.hp <= 0).length / counted.length : 0;
}

/** 灵石 plundered from the buildings that fell. */
export function lootOf(b: Battle): number {
  const per = { core: 300, mine: 80, tower: 40, wall: 5, barracks: 60, aoe: 50 } as const;
  return b.buildings.reduce((s, x) => s + (x.hp <= 0 ? per[x.kind] * x.lvl : 0), 0);
}

/** Deterministic enemy base so results are reproducible. Deeper `level` means stronger buildings. */
export function generateEnemyBase(seed = 1, level = 1): BuildingSpec[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const taken = new Set<string>();
  const out: BuildingSpec[] = [];
  const put = (kind: BuildingKind, x: number, y: number) => {
    const k = `${x},${y}`;
    if (x < 0 || y < 0 || x >= GRID || y >= GRID || taken.has(k)) return;
    taken.add(k);
    // vary the facing so a generated base doesn't read as one stamped sprite
    out.push({ kind, x, y, lvl: level, dir: kind === 'wall' ? 0 : ((x + y) & 1) as 0 | 1 });
  };
  put('core', 10, 10);
  for (let i = 0; i < 4; i++) put('tower', 7 + Math.floor(rnd() * 7), 7 + Math.floor(rnd() * 7));
  for (let i = 0; i < 5; i++) put('mine', 5 + Math.floor(rnd() * 11), 5 + Math.floor(rnd() * 11));
  for (let x = 6; x <= 14; x++) { put('wall', x, 6); put('wall', x, 14); }
  for (let y = 7; y <= 13; y++) { put('wall', 6, y); put('wall', 14, y); }
  for (let i = 1; i < level; i++) put('tower', 7 + Math.floor(rnd() * 7), 7 + Math.floor(rnd() * 7));
  // a barracks inside the walls, and splash towers from level 2 (one more per level)
  put('barracks', 8 + Math.floor(rnd() * 5), 8 + Math.floor(rnd() * 5));
  for (let i = 1; i < level; i++) put('aoe', 8 + Math.floor(rnd() * 5), 8 + Math.floor(rnd() * 5));
  return out;
}

/** An AI raid that hits the player's base from one edge. Stronger with the player's core level. */
export function generateWave(level: number, seed: number): Spawn[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const faction = FACTIONS[Math.floor(rnd() * FACTIONS.length)];
  const side = Math.floor(rnd() * 4);
  const edge = (): [number, number] => {
    const p = 2 + rnd() * (GRID - 4);
    return side === 0 ? [p, 0.5] : side === 1 ? [p, GRID - 0.5] : side === 2 ? [0.5, p] : [GRID - 0.5, p];
  };
  const out: Spawn[] = [];
  const count = 3 + 2 * level;
  for (let i = 0; i < count; i++) {
    const [x, y] = edge();
    out.push({ t: i * 1.8 + rnd(), def: faction.troops[1 + Math.floor(rnd() * (level >= 2 ? 4 : 3))], x, y });
  }
  if (level >= 2) { const [x, y] = edge(); out.push({ t: 8, def: faction.troops[0], x, y }); }
  return out;
}
