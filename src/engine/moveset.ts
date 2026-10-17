import type { RankingEntry, Species } from '../data/schemas';
import type { Needs } from './cost';
import { emptyNeeds } from './cost';

/** Qué hace falta para tener un ataque. */
export type MoveStatus = 'have' | 'tm' | 'second_move' | 'elite_tm';

export interface MoveNeed {
  moveId: string;
  kind: 'fast' | 'charged';
  status: MoveStatus;
  /** Es un ataque élite/legacy de la especie. */
  elite: boolean;
}

export interface MovesetOption {
  fast: string;
  charged: string[];
  usesElite: boolean;
  needs: MoveNeed[];
  /** Resumen agregado de objetos/desbloqueos (no incluye polvo del 2.º ataque; ver secondMove). */
  totals: Pick<Needs, 'eliteFastTm' | 'eliteChargedTm'> & { tm: number; secondMove: boolean };
}

export interface CurrentMoves {
  fast?: string | null;
  charged: string[];
  /** Tiene desbloqueado el 2.º ataque cargado. Por defecto: tiene 2 cargados. */
  secondUnlocked?: boolean;
}

export interface MovesetRecommendation {
  /** Mejor ataque según el ranking, aunque sea legacy. */
  a: MovesetOption;
  /** Mejor opción sin ataques élite; null si A ya no necesita legacy (A = B). */
  b: MovesetOption | null;
  fromRanking: boolean;
}

const eliteSet = (s: Pick<Species, 'elite'>) => new Set(s.elite);

function classify(species: Pick<Species, 'elite'>, fast: string, charged: string[], cur: CurrentMoves): MovesetOption {
  const elite = eliteSet(species);
  const needs: MoveNeed[] = [];
  const hasSecond = cur.secondUnlocked ?? cur.charged.length >= 2;
  needs.push({
    moveId: fast, kind: 'fast', elite: elite.has(fast),
    status: cur.fast === fast ? 'have' : elite.has(fast) ? 'elite_tm' : 'tm',
  });
  let missingNonHeld = charged.filter((m) => !cur.charged.includes(m));
  // Si hay que usar 2 cargados y no está desbloqueado el 2.º, el último faltante ocupa la ranura nueva.
  const slotNeeded = !hasSecond && charged.length > 1 ? missingNonHeld[missingNonHeld.length - 1] : undefined;
  for (const m of charged) {
    const have = cur.charged.includes(m);
    needs.push({
      moveId: m, kind: 'charged', elite: elite.has(m),
      status: have ? 'have' : elite.has(m) ? 'elite_tm' : m === slotNeeded ? 'second_move' : 'tm',
    });
  }
  missingNonHeld = [];
  return {
    fast, charged,
    usesElite: needs.some((n) => n.elite),
    needs,
    totals: {
      eliteFastTm: needs.filter((n) => n.kind === 'fast' && n.status === 'elite_tm').length,
      eliteChargedTm: needs.filter((n) => n.kind === 'charged' && n.status === 'elite_tm').length,
      tm: needs.filter((n) => n.status === 'tm' || n.status === 'second_move').length,
      secondMove: needs.some((n) => n.status === 'second_move'),
    },
  };
}

function firstUsable(order: string[], pool: string[], elite: Set<string>, taken: string[]): string | undefined {
  for (const m of order) if (pool.includes(m) && !elite.has(m) && !taken.includes(m)) return m;
  for (const m of pool) if (!elite.has(m) && !taken.includes(m)) return m;
  return undefined;
}

/**
 * recommendMoveset: A = moveset del ranking de PvPoke (aunque sea legacy); B = el mejor sin ataques élite,
 * sustituyendo los élite por los siguientes más usados en el ranking (uso de simulaciones de PvPoke).
 */
export function recommendMoveset(species: Pick<Species, 'fast' | 'charged' | 'elite'>, entry: RankingEntry | null | undefined, current: CurrentMoves): MovesetRecommendation {
  const elite = eliteSet(species);
  let fast: string;
  let charged: string[];
  let fromRanking = false;
  if (entry && entry.moveset.length >= 2) {
    fast = entry.moveset[0];
    charged = entry.moveset.slice(1).filter(Boolean);
    fromRanking = true;
  } else {
    fast = species.fast.find((m) => !elite.has(m)) ?? species.fast[0];
    charged = species.charged.filter((m) => !elite.has(m)).slice(0, 2);
  }
  const a = classify(species, fast, charged, current);
  if (!a.usesElite) return { a, b: null, fromRanking };
  const bFast = elite.has(fast) ? firstUsable(entry?.fastUse ?? [], species.fast, elite, []) ?? fast : fast;
  const bCharged: string[] = [];
  for (const m of charged) {
    if (!elite.has(m)) bCharged.push(m);
  }
  for (const m of entry?.chargedUse ?? []) {
    if (bCharged.length >= charged.length) break;
    if (species.charged.includes(m) && !elite.has(m) && !bCharged.includes(m)) bCharged.push(m);
  }
  while (bCharged.length < charged.length) {
    const m = firstUsable([], species.charged, elite, bCharged);
    if (!m) break;
    bCharged.push(m);
  }
  return { a, b: classify(species, bFast, bCharged, current), fromRanking };
}

export { emptyNeeds };
