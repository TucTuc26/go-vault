import type { GameData, Move, Species } from '../data/schemas';
import { DAMAGE_BONUS, DAMAGE_HALF, RAID_ESTIMATE } from './constants';
import { cpmAt } from './stats';
import type { EngineCtx, IVs } from './types';

const isTempEvo = (s: Species) => s.tags.includes('mega') || s.tags.includes('primal');
/** Especies "finales" (sin más evoluciones, no mega/primal) que se usan como población de comparación. */
function finalSpecies(ctx: Pick<EngineCtx, 'speciesById'>): Species[] {
  return [...ctx.speciesById.values()].filter((s) => s.released && !isTempEvo(s) && s.family.evolutions.length === 0);
}

const MAX_IV: IVs = { atk: 15, def: 15, hp: 15 };

// ---------------------------------------------------------------------------
// Gimnasio: resistencia = DEF × PS al nivel alcanzable (con sombra).
// ---------------------------------------------------------------------------

export function gymScore(s: Pick<Species, 'def' | 'hp'>, ivs: IVs, level: number, shadow: boolean, game: GameData): number {
  const cpm = cpmAt(game, level);
  const def = (s.def + ivs.def) * cpm * (shadow ? game.combat.shadowDefenseMultiplier : 1);
  const hp = Math.max(10, Math.floor((s.hp + ivs.hp) * cpm));
  return def * hp;
}

export interface GymEntry { speciesId: string; score: number }
const gymCache = new WeakMap<GameData, Map<number, GymEntry[]>>();

/** Población de referencia: especies finales 15/15/15 (no sombra) a ese nivel, de mayor a menor resistencia. */
export function gymPopulation(ctx: Pick<EngineCtx, 'speciesById' | 'game'>, level: number): GymEntry[] {
  let m = gymCache.get(ctx.game);
  if (!m) { m = new Map(); gymCache.set(ctx.game, m); }
  const hit = m.get(level);
  if (hit) return hit;
  const pop = finalSpecies(ctx)
    .filter((s) => !s.shadow)
    .map((s) => ({ speciesId: s.id, score: gymScore(s, MAX_IV, level, false, ctx.game) }))
    .sort((a, b) => b.score - a.score);
  m.set(level, pop);
  return pop;
}

/** Puesto (1 = el más resistente) que ocuparía este Pokémon entre la población. */
export function gymRank(pop: GymEntry[], score: number): number {
  let lo = 0, hi = pop.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pop[mid].score > score) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// Raid / ataque: estimación propia DPS/TDO (etiquetada "estimación").
// ---------------------------------------------------------------------------

export interface RaidEstimate { dps: number; tdo: number; score: number; fast: string; charged: string }

function pveDamage(m: Move, atk: number, stab: number, bossDef: number): number {
  return Math.floor(DAMAGE_HALF * (m.pve?.power ?? 0) * (atk / bossDef) * stab) + DAMAGE_BONUS;
}

/**
 * DPS del ciclo "n rápidos + 1 cargado" y TDO ∝ DPS · (DEF·PS); puntaje = DPS^0.75 · TDO^0.25 = DPS · (DEF·PS)^0.25
 * (el ordenamiento no depende de la escala del daño entrante). No considera efectividad contra un jefe concreto.
 */
export function estimateRaid(
  species: Pick<Species, 'types' | 'atk' | 'def' | 'hp'>,
  fast: Move,
  charged: Move,
  ivs: IVs,
  level: number,
  shadow: boolean,
  game: GameData,
): RaidEstimate | null {
  if (!fast.pve || !charged.pve || fast.pve.energy <= 0 || charged.pve.energy >= 0 || !fast.pve.durationMs) return null;
  const cpm = cpmAt(game, level);
  const atk = (species.atk + ivs.atk) * cpm * (shadow ? game.combat.shadowAttackMultiplier : 1);
  const def = (species.def + ivs.def) * cpm * (shadow ? game.combat.shadowDefenseMultiplier : 1);
  const hp = Math.max(10, Math.floor((species.hp + ivs.hp) * cpm));
  const stabF = species.types.includes(fast.type) ? game.combat.stab : 1;
  const stabC = species.types.includes(charged.type) ? game.combat.stab : 1;
  const n = Math.ceil(-charged.pve.energy / fast.pve.energy);
  const dmg = n * pveDamage(fast, atk, stabF, RAID_ESTIMATE.bossDefense) + pveDamage(charged, atk, stabC, RAID_ESTIMATE.bossDefense);
  const time = (n * fast.pve.durationMs + charged.pve.durationMs) / 1000;
  const dps = dmg / time;
  const bulk = def * hp;
  const tdo = dps * bulk;
  const score = Math.pow(dps, RAID_ESTIMATE.dpsWeight + RAID_ESTIMATE.tdoWeight) * Math.pow(bulk, RAID_ESTIMATE.tdoWeight);
  return { dps, tdo, score, fast: fast.id, charged: charged.id };
}

/** Mejor ataque por tipo de ataque cargado para una especie (sin ataques élite salvo que se pida). */
export function bestRaidByType(
  ctx: Pick<EngineCtx, 'game'>,
  species: Species,
  movesById: Map<string, Move>,
  ivs: IVs,
  level: number,
  shadow: boolean,
  includeElite = false,
): Map<string, RaidEstimate> {
  const out = new Map<string, RaidEstimate>();
  const elite = new Set(species.elite);
  for (const f of species.fast) {
    const fm = movesById.get(f);
    if (!fm || (!includeElite && elite.has(f))) continue;
    for (const c of species.charged) {
      const cm = movesById.get(c);
      if (!cm || (!includeElite && elite.has(c))) continue;
      const est = estimateRaid(species, fm, cm, ivs, level, shadow, ctx.game);
      if (!est) continue;
      const cur = out.get(cm.type);
      if (!cur || est.score > cur.score) out.set(cm.type, est);
    }
  }
  return out;
}

export interface RaidBoardEntry { speciesId: string; shadow: boolean; score: number; fast: string; charged: string }
const raidCache = new WeakMap<GameData, Map<string, Map<string, RaidBoardEntry[]>>>();

/** Tabla de líderes por tipo (15/15/15, nivel dado), incluye las versiones sombra. */
export function raidPopulation(ctx: Pick<EngineCtx, 'speciesById' | 'game'>, movesById: Map<string, Move>, level: number, includeElite = false): Map<string, RaidBoardEntry[]> {
  let m = raidCache.get(ctx.game);
  if (!m) { m = new Map(); raidCache.set(ctx.game, m); }
  const key = `${level}|${includeElite}`;
  const hit = m.get(key);
  if (hit) return hit;
  const boards = new Map<string, RaidBoardEntry[]>();
  for (const s of finalSpecies(ctx)) {
    const best = bestRaidByType(ctx, s, movesById, MAX_IV, level, s.shadow, includeElite);
    for (const [type, e] of best) {
      if (!boards.has(type)) boards.set(type, []);
      boards.get(type)!.push({ speciesId: s.id, shadow: s.shadow, score: e.score, fast: e.fast, charged: e.charged });
    }
  }
  for (const arr of boards.values()) arr.sort((a, b) => b.score - a.score);
  m.set(key, boards);
  return boards;
}

export const boardRank = (board: RaidBoardEntry[], score: number): number => {
  let rank = 1;
  for (const e of board) if (e.score > score) rank++; else break;
  return rank;
};
