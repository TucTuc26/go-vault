import type { SavedPokemon } from '../db/types';
import type { LeagueSpec, EngineCtx } from '../engine/types';
import type { SimEnv } from '../sim';
import { buildCandidates, buildOpponents } from './candidates';
import { localComputer, collapse, computeRows, opponentsSig, type RowCache, type RowComputer } from './matrix';
import { describeTeam, prepare, scoreTeam, searchTeams, typeProfile } from './search';
import type { Candidate, MissingAdvice, MoveMode, Opponent, TeamResult } from './types';

export interface AnalyzeInput {
  env: EngineCtx & SimEnv;
  league: LeagueSpec;
  collection: SavedPokemon[];
  mode: MoveMode;
  /** Cuántos del ranking se usan como meta (por defecto 100). */
  topN?: number;
  playerLevel?: number;
  dataVersion: string;
  nameOf: (speciesId: string) => string;
  cache?: RowCache;
  /** Dónde se simulan las filas (por defecto, este hilo; en la app, un grupo de Web Workers). */
  computer?: RowComputer;
  onProgress?: (stage: string, done: number, total: number) => void;
  /** Cuántos del top se evalúan en "¿Qué me falta?" (0 = no calcular). */
  adviceLimit?: number;
}

export interface AnalyzeResult {
  candidates: Candidate[];
  opponents: Opponent[];
  teams: TeamResult[];
  advice: MissingAdvice[];
  stats: { battles: number; computedRows: number; cachedRows: number; ms: number };
}

/** Pipeline completo: candidatos → matriz de simulaciones → mejores equipos de 3 → qué falta. */
export async function analyzeTeams(inp: AnalyzeInput): Promise<AnalyzeResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { env, league } = inp;
  const opponents = buildOpponents(env, league, inp.topN ?? 100);
  const candidates = buildCandidates(env, league, inp.collection, { playerLevel: inp.playerLevel, mode: inp.mode, displayName: inp.nameOf });
  const sig = opponentsSig(league.key, inp.dataVersion, opponents);
  inp.onProgress?.('matriz', 0, candidates.length);
  const { rows, computed, cached } = await computeRows(env, candidates, opponents, sig, {
    cache: inp.cache, computer: inp.computer, onProgress: (d, t) => inp.onProgress?.('matriz', d, t),
  });

  const p = prepare(env, candidates, rows, opponents);
  const found = searchTeams(p, { top: 3 });
  const teams = found.map((f) => describeTeam(env, p, candidates, rows, opponents, f.members, f.score, inp.nameOf));

  // ¿Qué me falta?: especies del top que no tengo, ordenadas por cuánto mejoran el mejor equipo
  const advice: MissingAdvice[] = [];
  const adviceLimit = inp.adviceLimit ?? 0;
  if (adviceLimit > 0 && found.length) {
    const ownedDex = new Set(candidates.map((c) => c.dex));
    const bestScore = found[0].score;
    const pool = opponents.filter((o) => !ownedDex.has(env.speciesById.get(o.speciesId)!.dex)).slice(0, adviceLimit);
    const adviceRows = await (inp.computer ?? localComputer(env))(pool.map((o) => o.spec), opponents, (d, t) => inp.onProgress?.('consejos', d, t));
    for (let pi = 0; pi < pool.length; pi++) {
      const o = pool[pi];
      const row = adviceRows[pi];
      const ext = { ...p, n: p.n + 1, R: [...p.R, collapse(row, opponents.length)], family: [...p.family, String(env.speciesById.get(o.speciesId)!.dex)], weak: [...p.weak, typeProfile(env.game, env.speciesById.get(o.speciesId)!.types)] };
      const idx = p.n;
      let best = -Infinity, bestMembers: number[] = [];
      for (let i = 0; i < p.n; i++) {
        if (ext.family[i] === ext.family[idx]) continue;
        for (let j = i + 1; j < p.n; j++) {
          if (ext.family[j] === ext.family[idx] || ext.family[i] === ext.family[j]) continue;
          const s = scoreTeam(ext, [i, j, idx]);
          if (s > best) { best = s; bestMembers = [i, j, idx]; }
        }
      }
      if (bestMembers.length) {
        const kept = bestMembers.slice(0, 2).map((m) => candidates[m].label);
        advice.push({ speciesId: o.speciesId, pos: o.pos, delta: Math.round((best - bestScore) * 10) / 10, replaces: kept.join(' + '), newScore: Math.round(best * 10) / 10 });
      }
    }
    advice.sort((a, b) => b.delta - a.delta);
  }

  return {
    candidates, opponents, teams, advice,
    stats: { battles: computed * opponents.length * 3, computedRows: computed, cachedRows: cached, ms: now() - t0 },
  };
}
