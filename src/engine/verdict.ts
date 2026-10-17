import type { Cup, Format, Move, Species } from '../data/schemas';
import { roleKey, type Role, type SavedPokemon, type ShowcaseReason } from '../db/types';
import { effectiveMaxLevel } from './levels';
import { evaluateForLeague } from './league';
import { evolutionLine, stageIdFor } from './line';
import { ivPercent } from './stats';
import { bestRaidByType, boardRank, gymPopulation, gymRank, gymScore, raidPopulation } from './population';
import type { EngineCtx, IVs, LeagueSpec, PokemonFlags } from './types';
import type { Question } from './infer';

/** Ajustes del veredicto (todo configurable desde Ajustes). Las fórmulas están en DECISIONS.md. */
export interface VerdictSettings {
  playerLevel?: number;
  pvp: {
    /** Posición máxima de la especie en el ranking vigente. */
    topN: number;
    /** IV rank máximo (entre las 4096 combinaciones)… */
    maxIvRank: number;
    /** …o % mínimo del stat product del rank 1. */
    minPercentOfBest: number;
    /** Liga Máster: IV mínimos en cada stat. */
    masterMinIv: number;
    /** Claves de ranking a evaluar (por defecto, todas las disponibles). */
    leagueKeys: string[] | null;
  };
  gym: { enabled: boolean; topN: number };
  raid: { enabled: boolean; topN: number };
  showcase: Record<ShowcaseReason, boolean>;
  /** Copias iguales o mejores para dejar de guardar. */
  redundantCopies: number;
}

export const DEFAULT_VERDICT_SETTINGS: VerdictSettings = {
  pvp: { topN: 100, maxIvRank: 200, minPercentOfBest: 97, masterMinIv: 14, leagueKeys: null },
  gym: { enabled: true, topN: 40 },
  raid: { enabled: true, topN: 5 },
  showcase: {
    hundo: true, nundo: true, shiny: true, lucky: true, xxl: true, xxs: true, costume: true, legacy: true,
    bestBuddy: true, background: true, first: false,
  },
  redundantCopies: 3,
};

export interface VerdictEnv extends EngineCtx {
  movesById: Map<string, Move>;
  leagues: (LeagueSpec & { cup: string })[];
}

/** Ligas evaluables = formatos con ranking, con tope de nivel de su copa. */
export function buildLeagues(formats: Format[], cups: Record<string, Cup>, titleOverrides: Record<string, string> = {}): VerdictEnv['leagues'] {
  const out: VerdictEnv['leagues'] = [];
  for (const f of formats) {
    if (!f.rankingKey) continue;
    out.push({ key: f.rankingKey, cup: f.cup, cpCap: f.cp, levelCap: cups[f.cup]?.levelCap, title: titleOverrides[f.rankingKey] ?? f.title });
  }
  return out;
}

/** Datos mínimos del Pokémon a evaluar (el borrador de la Fase 3). */
export interface EvalInput {
  speciesId: string;
  /** IVs posibles (1 si son exactos). */
  ivSets: IVs[];
  flags: PokemonFlags;
  moves: { fast: string | null; charged: string[] };
  cp?: number | null;
  question?: Question | null;
}

export type SkipReason = 'no_sirve' | 'redundante' | 'duplicado';

export interface Verdict {
  /** save = guardar; maybe = solo sirve con algunas combinaciones de IV (falta información); skip = no guardar. */
  status: 'save' | 'maybe' | 'skip';
  roles: Role[];
  /** Roles que valían pero ya hay N copias iguales o mejores. */
  redundantRoles: Role[];
  skipReason?: SkipReason;
  duplicateOfId?: number;
  question: Question | null;
  /** Explicaciones legibles (motivo de cada rol o de la omisión). */
  reasons: string[];
}

const MAX_SETS = 40;

/** Reduce muchos conjuntos de IV a una muestra repartida (peor, mejor y puntos intermedios). */
function sampleSets(sets: IVs[]): IVs[] {
  const uniq = new Map<string, IVs>();
  for (const s of sets) uniq.set(`${s.atk}/${s.def}/${s.hp}`, s);
  const arr = [...uniq.values()].sort((a, b) => ivPercent(a) - ivPercent(b) || a.atk - b.atk);
  if (arr.length <= MAX_SETS) return arr;
  const out: IVs[] = [];
  for (let i = 0; i < MAX_SETS; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (MAX_SETS - 1))]);
  return out;
}

const isHundo = (v: IVs) => v.atk === 15 && v.def === 15 && v.hp === 15;
const isNundo = (v: IVs) => v.atk === 0 && v.def === 0 && v.hp === 0;

/** Roles de UN conjunto de IVs concreto. */
export function rolesForIVs(env: VerdictEnv, input: EvalInput, ivs: IVs, settings: VerdictSettings, collection: SavedPokemon[]): Role[] {
  const roles: Role[] = [];
  const shadow = !!input.flags.shadow;
  const maxLevel = effectiveMaxLevel(env.game, settings.playerLevel, input.flags.bestBuddy);
  const base = env.speciesById.get(input.speciesId);
  if (!base) return roles;

  // ---- PvP ----
  const keys = settings.pvp.leagueKeys;
  for (const lg of env.leagues) {
    if (keys && !keys.includes(lg.key)) continue;
    if (!env.rankings[lg.key]) continue;
    const evals = evaluateForLeague(env, input.speciesId, ivs, lg, { playerLevel: settings.playerLevel, bestBuddy: input.flags.bestBuddy, shadow });
    for (const e of evals) {
      if (!e.eligible || e.rankingPos === null || e.rankingPos > settings.pvp.topN) continue;
      const isMaster = lg.cpCap >= (env.game.leagues.find((l) => l.id === 'master')?.cpCap ?? Infinity);
      const ivOk = isMaster
        ? Math.min(ivs.atk, ivs.def, ivs.hp) >= settings.pvp.masterMinIv
        : e.ivRank! <= settings.pvp.maxIvRank || e.percentOfBest! >= settings.pvp.minPercentOfBest;
      if (!ivOk) continue;
      roles.push({
        kind: 'pvp', leagueKey: lg.key, leagueTitle: lg.title ?? lg.key, stageId: e.stageId, rankingPos: e.rankingPos,
        ivRank: e.ivRank!, percentOfBest: Math.round(e.percentOfBest! * 100) / 100, level: e.level!, cp: e.cp!, moveset: e.moveset ?? [],
      });
    }
  }

  // ---- Gimnasio ----
  if (settings.gym.enabled) {
    const pop = gymPopulation(env, maxLevel);
    const line = evolutionLine(env, input.speciesId);
    for (const baseId of [line.self, ...line.descendants]) {
      const stageId = stageIdFor(env, baseId, shadow);
      const sp = env.speciesById.get(stageId);
      if (!sp || sp.family.evolutions.length) continue; // solo etapas finales defienden gimnasios
      const score = gymScore(sp, ivs, maxLevel, shadow, env.game);
      const rank = gymRank(pop, score);
      if (rank <= settings.gym.topN) roles.push({ kind: 'gym', stageId, rank, score: Math.round(score), level: maxLevel });
    }
  }

  // ---- Raid / ataque (estimación) ----
  if (settings.raid.enabled) {
    const boards = raidPopulation(env, env.movesById, maxLevel);
    const line = evolutionLine(env, input.speciesId);
    for (const baseId of [line.self, ...line.descendants]) {
      const stageId = stageIdFor(env, baseId, shadow);
      const sp = env.speciesById.get(stageId);
      if (!sp || sp.family.evolutions.length) continue;
      for (const [type, est] of bestRaidByType(env, sp, env.movesById, ivs, maxLevel, shadow)) {
        const board = boards.get(type);
        if (!board) continue;
        const rank = boardRank(board, est.score);
        if (rank <= settings.raid.topN) roles.push({ kind: 'raid', type, stageId, rank, score: Math.round(est.score * 10) / 10, fast: est.fast, charged: est.charged, estimate: true });
      }
    }
  }

  // ---- Exhibición ----
  roles.push(...showcaseRoles(env, input, ivs, settings, collection, base));
  return roles;
}

export function showcaseRoles(env: Pick<VerdictEnv, 'speciesById'>, input: EvalInput, ivs: IVs, settings: VerdictSettings, collection: SavedPokemon[], base: Species): Role[] {
  const s = settings.showcase;
  const f = input.flags;
  const out: Role[] = [];
  const add = (reason: ShowcaseReason, cond: boolean) => { if (s[reason] && cond) out.push({ kind: 'showcase', reason }); };
  add('hundo', isHundo(ivs));
  add('nundo', isNundo(ivs));
  add('shiny', !!f.shiny);
  add('lucky', !!f.lucky);
  add('xxl', !!f.xxl);
  add('xxs', !!f.xxs);
  add('costume', !!f.costume);
  add('bestBuddy', !!f.bestBuddy);
  add('background', !!f.background);
  const elite = new Set(base.elite);
  add('legacy', (!!input.moves.fast && elite.has(input.moves.fast)) || input.moves.charged.some((m) => elite.has(m)));
  add('first', !collection.some((c) => c.speciesId === base.baseId));
  return out;
}

/** ¿El registro existente cuenta como "igual o mejor" para este rol? */
export function atLeastAsGood(existing: Role, mine: Role): boolean {
  if (existing.kind !== mine.kind) return false;
  switch (mine.kind) {
    case 'pvp': return (existing as typeof mine).ivRank <= mine.ivRank;
    case 'gym': return (existing as typeof mine).score >= mine.score;
    case 'raid': return (existing as typeof mine).score >= mine.score;
    default: return true;
  }
}

/** Duplicado exacto (misma especie, CP, PS, IVs/nivel y banderas relevantes). */
export function findDuplicate(collection: SavedPokemon[], input: EvalInput, ivs: IVs | null, level: number | null): SavedPokemon | undefined {
  return collection.find((c) =>
    c.speciesId === input.speciesId && c.cp === (input.cp ?? null) &&
    !!c.flags.shadow === !!input.flags.shadow && !!c.flags.purified === !!input.flags.purified && !!c.flags.lucky === !!input.flags.lucky &&
    ((ivs && c.ivs && c.ivs.atk === ivs.atk && c.ivs.def === ivs.def && c.ivs.hp === ivs.hp) || (!ivs && !c.ivs)) &&
    (level === null || c.level === null || c.level === level),
  );
}

export function describeRole(r: Role, names: (id: string) => string = (id) => id): string {
  switch (r.kind) {
    case 'pvp': return `${r.leagueTitle}: ${names(r.stageId)} es #${r.rankingPos} del ranking; tus IVs son rank ${r.ivRank}/4096 (${r.percentOfBest.toFixed(1)} % del mejor)`;
    case 'gym': return `Gimnasio: ${names(r.stageId)} está en el puesto ${r.rank} de resistencia (DEF×PS)`;
    case 'raid': return `Ataque ${r.type}: ${names(r.stageId)} puesto ${r.rank} (estimación)`;
    case 'showcase': return `Exhibición: ${SHOWCASE_LABEL[r.reason]}`;
    case 'manual': return 'Guardado manualmente';
  }
}

export const SHOWCASE_LABEL: Record<ShowcaseReason, string> = {
  hundo: '100 % de IVs', nundo: '0 % de IVs', shiny: 'brillante', lucky: 'de suerte', xxl: 'XXL', xxs: 'XXS',
  costume: 'disfraz / forma especial', legacy: 'ataque legacy', bestBuddy: 'mejor amigo', background: 'fondo especial', first: 'primer ejemplar de la especie',
};


/** Roles seguros (válidos para TODAS las combinaciones de IV posibles) y dudosos (solo para algunas). */
export function computeRoles(env: VerdictEnv, input: EvalInput, sets: IVs[], settings: VerdictSettings, collection: SavedPokemon[]): { sure: Role[]; maybe: Role[] } {
  const perSet = sets.map((iv) => rolesForIVs(env, input, iv, settings, collection));
  if (!perSet.length) {
    // sin IVs: solo cuenta lo que no depende de ellos
    const base = env.speciesById.get(input.speciesId);
    const sc = base ? showcaseRoles(env, input, { atk: 8, def: 8, hp: 8 }, settings, collection, base).filter((r) => r.kind === 'showcase' && r.reason !== 'hundo' && r.reason !== 'nundo') : [];
    perSet.push(sc);
  }
  const key = (r: Role) => roleKey(r, env.speciesById.get(input.speciesId)?.baseId ?? input.speciesId);
  // sure = presente en TODAS las combinaciones; peor caso (menor calidad) para los números
  const sure: Role[] = [];
  const maybe: Role[] = [];
  const allKeys = new Set(perSet.flat().map(key));
  for (const k of allKeys) {
    const have = perSet.map((rs) => rs.find((r) => key(r) === k));
    const present = have.filter((r): r is Role => !!r);
    const worst = present.reduce((a, b) => (isWorse(b, a) ? b : a));
    const best = present.reduce((a, b) => (isWorse(a, b) ? b : a));
    if (present.length === perSet.length) sure.push(worst);
    else maybe.push({ ...best, uncertain: true } as Role);
  }

  return { sure, maybe };
}

/**
 * Veredicto completo: roles válidos por conjunto de IVs, certeza (todas las combinaciones vs. solo algunas),
 * redundancia contra la colección y duplicados.
 */
export function evaluateVerdict(env: VerdictEnv, input: EvalInput, collection: SavedPokemon[], settings: VerdictSettings = DEFAULT_VERDICT_SETTINGS, level: number | null = null): Verdict {
  const sets = sampleSets(input.ivSets.length ? input.ivSets : []);
  const exact = sets.length === 1 ? sets[0] : null;
  const dup = findDuplicate(collection, input, exact, level);
  if (dup) return { status: 'skip', roles: [], redundantRoles: [], skipReason: 'duplicado', duplicateOfId: dup.id, question: null, reasons: ['Duplicado exacto de un Pokémon ya guardado.'] };

  const { sure, maybe } = computeRoles(env, input, sets, settings, collection);

  // redundancia
  const n = settings.redundantCopies;
  const keep: Role[] = [];
  const redundantRoles: Role[] = [];
  const key = (r: Role) => roleKey(r, env.speciesById.get(input.speciesId)?.baseId ?? input.speciesId);
  const countBetter = (r: Role) => collection.filter((c) => c.roles.some((x) => key(x) === key(r) && atLeastAsGood(x, r))).length;
  for (const r of sure) (countBetter(r) >= n ? redundantRoles : keep).push(r);
  const keepMaybe = maybe.filter((r) => countBetter(r) < n);

  const reasons = keep.map((r) => describeRole(r, (id) => env.speciesById.get(id)?.name ?? id));
  if (keep.length) return { status: 'save', roles: keep, redundantRoles, question: null, reasons };
  if (keepMaybe.length) {
    return {
      status: 'maybe', roles: keepMaybe, redundantRoles, question: input.question ?? null,
      reasons: ['Podría servir según sus IVs exactos: ' + keepMaybe.map((r) => describeRole(r, (id) => env.speciesById.get(id)?.name ?? id)).slice(0, 3).join('; ')],
    };
  }
  if (redundantRoles.length) {
    return { status: 'skip', roles: [], redundantRoles, skipReason: 'redundante', question: null, reasons: [`Ya tienes ${n} o más copias iguales o mejores para: ${redundantRoles.map((r) => describeRole(r, (id) => env.speciesById.get(id)?.name ?? id)).slice(0, 3).join('; ')}`] };
  }
  return { status: 'skip', roles: [], redundantRoles, skipReason: 'no_sirve', question: null, reasons: ['No sirve, no se guardó nada.'] };
}

function isWorse(a: Role, b: Role): boolean {
  switch (a.kind) {
    case 'pvp': return a.ivRank > (b as typeof a).ivRank;
    case 'gym': return a.score < (b as typeof a).score;
    case 'raid': return a.score < (b as typeof a).score;
    default: return false;
  }
}

/** Cambios entre dos listas de roles (para la reevaluación automática). */
export function diffRoles(oldRoles: Role[], newRoles: Role[], speciesBaseId: string, label: (r: Role) => string): { gained: string[]; lost: string[] } {
  const o = new Map(oldRoles.map((r) => [roleKey(r, speciesBaseId), r]));
  const n = new Map(newRoles.map((r) => [roleKey(r, speciesBaseId), r]));
  const gained: string[] = [];
  const lost: string[] = [];
  for (const [k, r] of n) if (!o.has(k)) gained.push(label(r));
  for (const [k, r] of o) if (!n.has(k) && r.kind !== 'manual') lost.push(label(r));
  return { gained, lost };
}
