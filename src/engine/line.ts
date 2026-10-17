import type { Evolution, Species } from '../data/schemas';
import type { EngineCtx } from './types';

type SpeciesMap = Pick<EngineCtx, 'speciesById'>;

export const baseIdOf = (id: string): string => id.replace(/_shadow$/, '');

/** Id del ranking/etapa: la versión sombra si existe como entrada propia. */
export function stageIdFor(ctx: SpeciesMap, baseId: string, shadow: boolean): string {
  if (shadow && ctx.speciesById.has(`${baseId}_shadow`)) return `${baseId}_shadow`;
  return baseId;
}

const isTempEvo = (s: Species) => s.tags.includes('mega') || s.tags.includes('primal');

export interface EvolutionLine {
  /** Ids base (sin _shadow) de los ancestros, del más antiguo al más cercano. */
  ancestors: string[];
  self: string;
  /** Todas las evoluciones posteriores (no incluye hermanos). */
  descendants: string[];
}

export function evolutionLine(ctx: SpeciesMap, speciesId: string): EvolutionLine {
  const self = baseIdOf(speciesId);
  const ancestors: string[] = [];
  let cur = ctx.speciesById.get(self);
  const guard = new Set<string>([self]);
  while (cur?.family.parent) {
    const p = baseIdOf(cur.family.parent);
    if (guard.has(p) || !ctx.speciesById.has(p)) break;
    guard.add(p);
    ancestors.unshift(p);
    cur = ctx.speciesById.get(p);
  }
  const descendants: string[] = [];
  const walk = (id: string) => {
    const sp = ctx.speciesById.get(id);
    if (!sp) return;
    for (const e of sp.family.evolutions) {
      const t = baseIdOf(e.to);
      const ts = ctx.speciesById.get(t);
      if (!ts || guard.has(t) || descendants.includes(t) || isTempEvo(ts)) continue;
      descendants.push(t);
      walk(t);
    }
  };
  walk(self);
  return { ancestors, self, descendants };
}

/** Formas Mega/Primal derivadas de una especie (para ligas que las admiten). */
export function tempEvolutions(ctx: SpeciesMap, baseId: string): string[] {
  const out: string[] = [];
  for (const s of ctx.speciesById.values()) {
    if (s.shadow || !isTempEvo(s)) continue;
    if (s.id.startsWith(`${baseId}_mega`) || s.id.startsWith(`${baseId}_primal`)) out.push(s.id);
  }
  return out;
}

/** Cadena de evoluciones (aristas) de `from` a `to`, o null si no hay camino. */
export function evolutionPath(ctx: SpeciesMap, fromId: string, toId: string): Evolution[] | null {
  const from = baseIdOf(fromId);
  const to = baseIdOf(toId);
  if (from === to) return [];
  const dfs = (id: string, seen: Set<string>): Evolution[] | null => {
    const sp = ctx.speciesById.get(id);
    if (!sp) return null;
    for (const e of sp.family.evolutions) {
      const t = baseIdOf(e.to);
      if (seen.has(t)) continue;
      if (t === to) return [e];
      seen.add(t);
      const rest = dfs(t, seen);
      if (rest) return [e, ...rest];
    }
    return null;
  };
  return dfs(from, new Set([from]));
}
