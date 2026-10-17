import type { GameData, RankingEntry, RankingFile, Species } from '../data/schemas';
import { LEVEL_STEP } from './constants';
import { accountMaxLevel, effectiveMaxLevel } from './levels';
import { allIVs, baseOf, calcCP, calcHP, cpmTable, ivPercent, maxKnownLevel, type BaseStats } from './stats';
import { evolutionLine, stageIdFor, tempEvolutions } from './line';
import type { EngineCtx, IVs, LeagueSpec } from './types';

export interface Combo {
  ivs: IVs;
  level: number;
  cp: number;
  hp: number;
  atk: number;
  def: number;
  product: number;
}

const comboCache = new WeakMap<GameData, Map<string, Combo[]>>();

/** Nivel más alto cuyo CP no supera el tope (null si ni el nivel 1 cabe). */
export function bestLevelUnderCap(base: BaseStats, ivs: IVs, cpCap: number, levelCap: number, game: GameData): { level: number; cpm: number; cp: number } | null {
  const t = cpmTable(game);
  const top = Math.min(Math.round((levelCap - 1) / LEVEL_STEP), t.length - 1);
  // CP crece con el nivel: búsqueda binaria del último índice con CP <= tope.
  if (calcCP(base, ivs, t[0]) > cpCap) return null;
  let lo = 0;
  let hi = top;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (calcCP(base, ivs, t[mid]) <= cpCap) lo = mid;
    else hi = mid - 1;
  }
  return { level: 1 + lo * LEVEL_STEP, cpm: t[lo], cp: calcCP(base, ivs, t[lo]) };
}

/**
 * Las 4096 combinaciones de IV al nivel máximo bajo el tope de CP, ordenadas por stat product
 * (atk·def·hp) descendente. Orden de empate = el de PvPoke (generación hp↓, def↓, atk↓; orden estable).
 */
export function leagueCombos(species: Pick<Species, 'id' | 'atk' | 'def' | 'hp'>, cpCap: number, levelCap: number, game: GameData): Combo[] {
  let m = comboCache.get(game);
  if (!m) { m = new Map(); comboCache.set(game, m); }
  const key = `${species.atk}/${species.def}/${species.hp}|${cpCap}|${levelCap}`;
  const hit = m.get(key);
  if (hit) return hit;
  const base = baseOf(species);
  const out: Combo[] = [];
  for (const ivs of allIVs()) {
    const b = bestLevelUnderCap(base, ivs, cpCap, levelCap, game);
    if (!b) continue;
    const atk = b.cpm * (base.atk + ivs.atk);
    const def = b.cpm * (base.def + ivs.def);
    const hp = calcHP(base, ivs, b.cpm);
    out.push({ ivs, level: b.level, cp: b.cp, hp, atk, def, product: hp * atk * def });
  }
  out.sort((a, b) => b.product - a.product); // Array.prototype.sort es estable
  m.set(key, out);
  return out;
}

const rankIndexCache = new WeakMap<Combo[], Map<number, number>>();
/** Índice rápido ivs → puesto (0-based) para una lista de combinaciones. */
export function rankIndex(combos: Combo[]): Map<number, number> {
  let m = rankIndexCache.get(combos);
  if (!m) {
    m = new Map();
    combos.forEach((c, i) => m!.set(c.ivs.atk * 256 + c.ivs.def * 16 + c.ivs.hp, i));
    rankIndexCache.set(combos, m);
  }
  return m;
}

const sortedCache = new WeakMap<RankingFile, RankingEntry[]>();
export function sortedRanking(r: RankingFile): RankingEntry[] {
  let s = sortedCache.get(r);
  if (!s) { s = [...r.entries].sort((a, b) => b.score - a.score); sortedCache.set(r, s); }
  return s;
}

const posCache = new WeakMap<RankingEntry[], Map<string, number>>();
function rankPos(_r: RankingFile | undefined, sorted: RankingEntry[], id: string): number {
  let m = posCache.get(sorted);
  if (!m) { m = new Map(); sorted.forEach((e, i) => m!.set(e.id, i)); posCache.set(sorted, m); }
  return m.get(id) ?? -1;
}

export interface LeagueEvaluation {
  stageId: string;
  leagueKey: string;
  eligible: boolean;
  level: number | null;
  cp: number | null;
  hp: number | null;
  /** Puesto entre las 4096 combinaciones (1 = mejor). */
  ivRank: number | null;
  /** Stat product / stat product del rank 1, en %. */
  percentOfBest: number | null;
  best: { ivs: IVs; level: number; cp: number } | null;
  /** Posición de la especie en el ranking vigente (1 = mejor) o null si no aparece. */
  rankingPos: number | null;
  rankingScore: number | null;
  rankingSize: number;
  moveset: string[] | null;
}

export function evaluateStage(
  ctx: EngineCtx,
  stageId: string,
  ivs: IVs,
  league: LeagueSpec,
  opts: { playerLevel?: number; bestBuddy?: boolean } = {},
): LeagueEvaluation {
  const species = ctx.speciesById.get(stageId);
  if (!species) throw new Error(`Especie desconocida: ${stageId}`);
  const levelCap = Math.min(league.levelCap ?? Infinity, effectiveMaxLevel(ctx.game, opts.playerLevel, opts.bestBuddy), maxKnownLevel(ctx.game));
  const combos = leagueCombos(species, league.cpCap, levelCap, ctx.game);
  const ranking = ctx.rankings[league.key];
  const sorted = ranking ? sortedRanking(ranking) : [];
  const pos = rankPos(ranking, sorted, stageId);
  const entry = pos >= 0 ? sorted[pos] : null;
  const base: LeagueEvaluation = {
    stageId, leagueKey: league.key, eligible: false, level: null, cp: null, hp: null, ivRank: null,
    percentOfBest: null, best: null, rankingPos: pos >= 0 ? pos + 1 : null, rankingScore: entry?.score ?? null,
    rankingSize: sorted.length, moveset: entry?.moveset ?? null,
  };
  if (!combos.length) return base;
  const idx = rankIndex(combos).get(ivs.atk * 256 + ivs.def * 16 + ivs.hp) ?? -1;
  const top = combos[0];
  base.best = { ivs: top.ivs, level: top.level, cp: top.cp };
  if (idx < 0) return base;
  const c = combos[idx];
  return { ...base, eligible: true, level: c.level, cp: c.cp, hp: c.hp, ivRank: idx + 1, percentOfBest: (c.product / top.product) * 100 };
}

export interface LineEvaluation extends LeagueEvaluation {
  /** Etapa relativa al Pokémon actual. */
  relation: 'previa' | 'actual' | 'evolución' | 'mega';
  speciesName: string;
}

/**
 * evaluateForLeague: evalúa CADA etapa de la línea evolutiva (previas, actual y evoluciones; megas si la liga las trae)
 * con los IVs dados. Una sombra evalúa las entradas _shadow de cada etapa.
 */
export function evaluateForLeague(
  ctx: EngineCtx,
  speciesId: string,
  ivs: IVs,
  league: LeagueSpec,
  opts: { playerLevel?: number; bestBuddy?: boolean; shadow?: boolean } = {},
): LineEvaluation[] {
  const shadow = opts.shadow ?? ctx.speciesById.get(speciesId)?.shadow ?? false;
  const line = evolutionLine(ctx, speciesId);
  const stages: { base: string; relation: LineEvaluation['relation'] }[] = [
    ...line.ancestors.map((b) => ({ base: b, relation: 'previa' as const })),
    { base: line.self, relation: 'actual' as const },
    ...line.descendants.map((b) => ({ base: b, relation: 'evolución' as const })),
  ];
  const ranking = ctx.rankings[league.key];
  const out: LineEvaluation[] = [];
  const inRanking = (id: string) => !!ranking?.entries.some((e) => e.id === id);
  for (const st of stages) {
    const id = stageIdFor(ctx, st.base, shadow);
    out.push({ ...evaluateStage(ctx, id, ivs, league, opts), relation: st.relation, speciesName: ctx.speciesById.get(id)!.name });
  }
  for (const st of stages) {
    for (const mega of tempEvolutions(ctx, st.base)) {
      if (!inRanking(mega)) continue;
      out.push({ ...evaluateStage(ctx, mega, ivs, league, opts), relation: 'mega', speciesName: ctx.speciesById.get(mega)!.name });
    }
  }
  return out;
}

export { accountMaxLevel, ivPercent };
