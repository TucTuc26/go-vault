import type { GameData, Species } from '../data/schemas';
import { APPRAISAL_BAR_BANDS, APPRAISAL_BEST_STAT_BANDS, APPRAISAL_OVERALL_BANDS, IV_COUNT, roundCost } from './constants';
import { accountMaxLevel, buddyBoost, ivFloor } from './levels';
import { allIVs, baseOf, calcCP, calcHP, cpmAt, levelsBetween, maxKnownLevel } from './stats';
import { STAT_KEYS, type Appraisal, type Candidate, type IVs, type Origin, type PokemonFlags, type StatKey } from './types';

const bandOf = (bands: readonly (readonly [number, number])[], v: number): number => bands.findIndex(([a, b]) => v >= a && v <= b);

/** ¿Los IVs son coherentes con la valoración dada? */
export function matchesAppraisal(ivs: IVs, a: Appraisal | undefined): boolean {
  if (!a) return true;
  const sum = ivs.atk + ivs.def + ivs.hp;
  if (a.overall !== undefined && bandOf(APPRAISAL_OVERALL_BANDS, sum) !== a.overall - 1) return false;
  const max = Math.max(ivs.atk, ivs.def, ivs.hp);
  if (a.bestStats?.length) {
    const top = STAT_KEYS.filter((k) => ivs[k] === max);
    if (top.length !== a.bestStats.length || !a.bestStats.every((k) => top.includes(k))) return false;
  }
  if (a.bestStatTier !== undefined && bandOf(APPRAISAL_BEST_STAT_BANDS, max) !== a.bestStatTier - 1) return false;
  if (a.bars) for (const k of STAT_KEYS) if (a.bars[k] !== undefined && bandOf(APPRAISAL_BAR_BANDS, ivs[k]) !== a.bars[k]) return false;
  return true;
}

/** Estadísticas de valoración que produce un conjunto de IVs (inverso de matchesAppraisal). */
export function appraisalOf(ivs: IVs): Required<Pick<Appraisal, 'overall' | 'bestStats' | 'bestStatTier' | 'bars'>> {
  const sum = ivs.atk + ivs.def + ivs.hp;
  const max = Math.max(ivs.atk, ivs.def, ivs.hp);
  return {
    overall: (bandOf(APPRAISAL_OVERALL_BANDS, sum) + 1) as 1 | 2 | 3 | 4,
    bestStats: STAT_KEYS.filter((k) => ivs[k] === max),
    bestStatTier: (bandOf(APPRAISAL_BEST_STAT_BANDS, max) + 1) as 1 | 2 | 3 | 4,
    bars: Object.fromEntries(STAT_KEYS.map((k) => [k, bandOf(APPRAISAL_BAR_BANDS, ivs[k])])) as Record<StatKey, 0 | 1 | 2 | 3>,
  };
}

export interface InferInput {
  species: Pick<Species, 'atk' | 'def' | 'hp'>;
  cp: number;
  hp: number;
  /** Polvo que pide la siguiente mejora (el que muestra el juego: ya incluye sombra/suerte/purificado). */
  powerUpDust?: number;
  /** Nivel mostrado, si se conoce. */
  level?: number;
  appraisal?: Appraisal;
  origin?: Origin;
  flags?: PokemonFlags;
  /** Nivel de cuenta: acota el nivel máximo. */
  playerLevel?: number;
  /** Si se dan IVs exactos no se infiere: solo se valida contra CP/PS. */
  exactIVs?: IVs;
}

export interface Question { id: string; text: string }

export interface InferResult {
  candidates: Candidate[];
  /** Niveles (mostrados) que aparecen entre los candidatos. */
  levels: number[];
  distinctIVs: number;
  ivPercentRange: [number, number] | null;
  /** Más de una combinación de IVs posible. */
  ambiguous: boolean;
  /** Ningún candidato encaja: lectura dudosa. */
  inconsistent: boolean;
  /** La pregunta mínima que más reduciría la ambigüedad. */
  question: Question | null;
  floor: number;
}

/** Costo de polvo mostrado para mejorar desde un nivel real (con modificadores de la ficha). */
export function dustForNextPowerUp(game: GameData, realLevel: number, flags: PokemonFlags = {}): number | null {
  const base = game.powerUp.stardust[Math.floor(realLevel) - 1];
  if (base === undefined || realLevel >= game.powerUp.maxNormalUpgradeLevel) return null;
  let m = 1;
  if (flags.shadow) m *= game.powerUp.shadowStardustMultiplier;
  if (flags.purified) m *= game.powerUp.purifiedStardustMultiplier;
  if (flags.lucky) m *= game.powerUp.luckyStardustMultiplier;
  return roundCost(base * m);
}

const QUESTION_TEXT: Record<string, string> = {
  level: '¿Qué nivel tiene el Pokémon (o cuánto polvo pide la siguiente mejora)?',
  overall: '¿Qué dice la frase general de la valoración (la del líder de tu equipo)?',
  bestStats: '¿Qué estadística destaca la valoración (ataque, defensa o PS)?',
  bestStatTier: '¿Cómo califica la valoración a su mejor estadística?',
  bar_atk: '¿Cuánto llena la barra de Ataque en la valoración?',
  bar_def: '¿Cuánto llena la barra de Defensa en la valoración?',
  bar_hp: '¿Cuánto llena la barra de PS en la valoración?',
};

function pickQuestion(cands: Candidate[], appraisal: Appraisal | undefined, levelKnown: boolean): Question | null {
  const parts: [string, (c: Candidate) => string][] = [];
  if (!levelKnown) parts.push(['level', (c) => String(c.level)]);
  if (appraisal?.overall === undefined) parts.push(['overall', (c) => String(appraisalOf(c.ivs).overall)]);
  if (!appraisal?.bestStats?.length) parts.push(['bestStats', (c) => appraisalOf(c.ivs).bestStats.join('+')]);
  if (appraisal?.bestStatTier === undefined) parts.push(['bestStatTier', (c) => String(appraisalOf(c.ivs).bestStatTier)]);
  for (const k of STAT_KEYS) if (appraisal?.bars?.[k] === undefined) parts.push([`bar_${k}`, (c) => String(appraisalOf(c.ivs).bars[k])]);
  let best: { id: string; worst: number; groups: number } | null = null;
  for (const [id, fn] of parts) {
    const groups = new Map<string, Set<string>>();
    for (const c of cands) {
      const g = fn(c);
      if (!groups.has(g)) groups.set(g, new Set());
      groups.get(g)!.add(`${c.ivs.atk}/${c.ivs.def}/${c.ivs.hp}`);
    }
    const worst = Math.max(...[...groups.values()].map((s) => s.size));
    if (groups.size > 1 && (!best || worst < best.worst || (worst === best.worst && groups.size > best.groups))) best = { id, worst, groups: groups.size };
  }
  return best ? { id: best.id, text: QUESTION_TEXT[best.id] } : null;
}

/**
 * Infiere los IVs posibles a partir de CP, PS, polvo de la siguiente mejora, nivel y valoración.
 * Recorre los niveles posibles (acotados por polvo/nivel/cuenta) × combinaciones permitidas por el piso de IV.
 */
export function inferIVs(game: GameData, input: InferInput): InferResult {
  const base = baseOf(input.species);
  const flags = input.flags ?? {};
  const floor = ivFloor(game, input.origin, flags);
  const boost = flags.bestBuddy ? buddyBoost(game) : 0;
  const maxReal = accountMaxLevel(game, input.playerLevel);
  const maxShown = Math.min(maxReal + boost, maxKnownLevel(game));

  // Niveles reales posibles
  let realLevels = levelsBetween(1, maxReal);
  if (input.level !== undefined) realLevels = realLevels.filter((l) => Math.abs(l + boost - input.level!) < 1e-9);
  if (input.powerUpDust !== undefined) realLevels = realLevels.filter((l) => dustForNextPowerUp(game, l, flags) === input.powerUpDust);

  const cands: Candidate[] = [];
  const ivList = input.exactIVs ? [input.exactIVs] : [...allIVs(floor)];
  for (const real of realLevels) {
    const shown = real + boost;
    if (shown > maxShown) continue;
    const cpm = cpmAt(game, shown);
    for (const ivs of ivList) {
      if (calcCP(base, ivs, cpm) !== input.cp || calcHP(base, ivs, cpm) !== input.hp) continue;
      if (!input.exactIVs && !matchesAppraisal(ivs, input.appraisal)) continue;
      cands.push({ level: shown, ivs });
    }
  }
  const distinct = new Set(cands.map((c) => `${c.ivs.atk}/${c.ivs.def}/${c.ivs.hp}`));
  const pcts = cands.map((c) => ((c.ivs.atk + c.ivs.def + c.ivs.hp) / (3 * (IV_COUNT - 1))) * 100);
  const ambiguous = distinct.size > 1;
  return {
    candidates: cands,
    levels: [...new Set(cands.map((c) => c.level))].sort((a, b) => a - b),
    distinctIVs: distinct.size,
    ivPercentRange: pcts.length ? [Math.min(...pcts), Math.max(...pcts)] : null,
    ambiguous,
    inconsistent: cands.length === 0,
    question: ambiguous || new Set(cands.map((c) => c.level)).size > 1 ? pickQuestion(cands, input.appraisal, input.level !== undefined) : null,
    floor,
  };
}
