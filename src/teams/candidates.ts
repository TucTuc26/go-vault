import type { SavedPokemon } from '../db/types';
import { evaluateForLeague, evaluateStage, leagueCombos, ivPercent, planUpgrade, recommendMoveset, sortedRanking, type LeagueSpec, type MovesetOption } from '../engine';
import { effectiveMaxLevel } from '../engine/levels';
import { ivSetsOfRecord } from '../engine/reevaluate';
import type { EngineCtx } from '../engine/types';
import { baseIdOf } from '../engine/line';
import type { SimEnv, SimMonSpec } from '../sim';
import type { Candidate, MoveMode, Opponent } from './types';

export interface BuildCandidatesOptions {
  playerLevel?: number;
  mode: MoveMode;
  displayName: (speciesId: string) => string;
}

/** Eligible para simular: sin cambios de forma en combate (no modelados). */
const simulable = (env: SimEnv, id: string) => {
  const s = env.speciesById.get(id);
  return !!s && !s.formChange && s.fast.length > 0 && s.charged.length > 0;
};

const bestOfIvSets = (r: SavedPokemon) => {
  if (r.ivs) return r.ivs;
  const sets = ivSetsOfRecord(r).sort((a, b) => ivPercent(a) - ivPercent(b));
  return sets.length ? sets[Math.floor(sets.length / 2)] : null;
};

/** Ataques a simular según el modo. "recomendados" solo usa ataques élite si el Pokémon ya los tiene. */
export function chooseMoves(
  env: EngineCtx & SimEnv,
  stageId: string,
  leagueKey: string,
  rec: SavedPokemon,
  mode: MoveMode,
): { fast: string; charged: string[]; option: MovesetOption | null; notes: string[] } | null {
  const sp = env.speciesById.get(stageId);
  if (!sp) return null;
  const ranking = env.rankings[leagueKey];
  const entry = ranking ? sortedRanking(ranking).find((e) => e.id === stageId) ?? null : null;
  const notes: string[] = [];
  const current = { fast: rec.moves.fast, charged: rec.moves.charged, secondUnlocked: rec.moves.charged.length >= 2 };
  const recommendation = recommendMoveset(sp, entry, current);
  const a = recommendation.a;
  // Opción A (la mejor) solo si no requiere MT élite que el Pokémon no tenga; si no, B
  const aElitePending = a.needs.some((n) => n.status === 'elite_tm');
  const option = aElitePending && recommendation.b ? recommendation.b : a;
  if (aElitePending && recommendation.b) notes.push('Mejor moveset requiere MT élite: se usa la alternativa sin legacy.');
  if (mode === 'current') {
    const fast = rec.moves.fast && sp.fast.includes(rec.moves.fast) ? rec.moves.fast : null;
    const charged = rec.moves.charged.filter((m) => sp.charged.includes(m));
    if (fast && charged.length) return { fast, charged: charged.slice(0, 2), option: null, notes };
    notes.push('Faltan ataques registrados: se usaron los recomendados.');
  }
  return { fast: option.fast, charged: option.charged.slice(0, 2), option, notes };
}

/**
 * Candidatos para una liga: cada Pokémon registrado en cada etapa de su línea evolutiva que entra en la liga,
 * con sus IVs exactos (o el intermedio si son inciertos), al nivel máximo bajo el tope de CP.
 */
export function buildCandidates(env: EngineCtx & SimEnv, league: LeagueSpec, collection: SavedPokemon[], opts: BuildCandidatesOptions): Candidate[] {
  const out: Candidate[] = [];
  for (const rec of collection) {
    const ivs = bestOfIvSets(rec);
    if (!ivs || rec.id === undefined) continue;
    const evals = evaluateForLeague(env, rec.speciesId, ivs, league, { playerLevel: opts.playerLevel, bestBuddy: rec.flags.bestBuddy, shadow: rec.flags.shadow });
    for (const ev of evals) {
      if (!ev.eligible || ev.rankingPos === null || ev.level === null || ev.relation === 'previa' || ev.relation === 'mega') continue;
      if (!simulable(env, ev.stageId)) continue;
      const moves = chooseMoves(env, ev.stageId, league.key, rec, opts.mode);
      if (!moves) continue;
      const sp = env.speciesById.get(ev.stageId)!;
      const fromLevel = rec.level ?? rec.levelRange?.[0] ?? null;
      let cost = { stardust: 0, candy: 0, xlCandy: 0, eliteTm: 0, secondMove: false, needsEvolution: ev.relation === 'evolución', alreadyOptimal: false };
      if (fromLevel !== null) {
        const plan = planUpgrade(env, {
          fromSpeciesId: rec.speciesId, toSpeciesId: ev.stageId, fromLevel, toLevel: ev.level,
          mods: { shadow: rec.flags.shadow, purified: rec.flags.purified, lucky: rec.flags.lucky }, bestBuddy: rec.flags.bestBuddy,
          playerLevel: opts.playerLevel, moveset: opts.mode === 'recommended' ? moves.option : null,
        });
        cost = {
          stardust: plan.needs.stardust, candy: plan.needs.candy, xlCandy: plan.needs.xlCandy,
          eliteTm: plan.eliteFastTm + plan.eliteChargedTm, secondMove: !!plan.secondMove, needsEvolution: ev.relation === 'evolución',
          alreadyOptimal: plan.needs.stardust === 0 && plan.needs.candy === 0 && plan.needs.xlCandy === 0 && !plan.secondMove && ev.relation !== 'evolución',
        };
      }
      const notes = [...moves.notes];
      if (!rec.ivs) notes.push('IVs inciertos: se usó una combinación intermedia.');
      out.push({
        key: `${rec.id}:${ev.stageId}`,
        recordId: rec.id,
        speciesId: ev.stageId,
        baseId: baseIdOf(ev.stageId),
        dex: sp.dex,
        shadow: sp.shadow,
        label: opts.displayName(baseIdOf(ev.stageId)) + (sp.shadow ? ' (sombra)' : ''),
        nickname: rec.nickname,
        ivs,
        level: ev.level,
        cp: ev.cp!,
        fast: moves.fast,
        charged: moves.charged,
        leagueKey: league.key,
        cost,
        notes,
        sig: `${ev.stageId}|${ev.level}|${ivs.atk}/${ivs.def}/${ivs.hp}|${moves.fast}|${moves.charged.join('+')}`,
      });
    }
  }
  return out;
}

/** Los N mejores del ranking como oponentes (IVs de rank 1 de la liga, ataques del ranking), ponderados por posición. */
export function buildOpponents(env: EngineCtx & SimEnv, league: LeagueSpec, topN: number): Opponent[] {
  const ranking = env.rankings[league.key];
  if (!ranking) return [];
  const levelCap = Math.min(league.levelCap ?? Infinity, effectiveMaxLevel(env.game));
  const sorted = sortedRanking(ranking);
  const out: Opponent[] = [];
  for (let i = 0; i < sorted.length && out.length < topN; i++) {
    const e = sorted[i];
    if (!simulable(env, e.id) || e.id.includes('_mega')) continue;
    const sp = env.speciesById.get(e.id)!;
    const best = leagueCombos(sp, league.cpCap, levelCap, env.game)[0];
    if (!best) continue;
    const moves = e.moveset.filter((m) => sp.fast.includes(m) || sp.charged.includes(m));
    const fast = moves.find((m) => sp.fast.includes(m));
    const charged = moves.filter((m) => sp.charged.includes(m)).slice(0, 2);
    if (!fast || !charged.length) continue;
    out.push({
      speciesId: e.id, pos: out.length + 1, weight: 1,
      spec: { speciesId: e.id, ivs: best.ivs, level: best.level, fast, charged },
    });
  }
  // peso decreciente con la posición: 1.0 (primero) → 0.4 (último)
  out.forEach((o, i) => { o.weight = 1 - 0.6 * (i / Math.max(1, out.length - 1)); });
  return out;
}

export const toSimSpec = (c: Pick<Candidate, 'speciesId' | 'ivs' | 'level' | 'fast' | 'charged'>, shields: number): SimMonSpec => ({
  speciesId: c.speciesId, ivs: c.ivs, level: c.level, fast: c.fast, charged: c.charged, shields,
});

export { evaluateStage };
