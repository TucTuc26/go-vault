import type { Move, Names, Species } from '../data/schemas';
import { displayName, normalizeText } from '../data/names';
import { inferIVs, type InferResult } from '../engine/infer';
import type { Appraisal, Candidate, IVs, Origin, PokemonFlags } from '../engine/types';
import type { EngineCtx } from '../engine/types';
import { dice, levenshtein, type SpeciesIndex } from './species-match';
import type { ScanResult } from './schema';

/** Borrador de Pokémon ya interpretado (solo texto/números; nunca imagen). */
export interface PokemonDraft {
  speciesId: string; // id base (sin _shadow)
  speciesName: string;
  nickname: string | null;
  cp: number | null;
  hp: number | null;
  level: number | null;
  powerUpDust: number | null;
  /** IVs exactos si el usuario los dio o si la inferencia deja un único candidato. */
  ivs: IVs | null;
  ivsExact: boolean;
  candidates: Candidate[];
  ivPercentRange: [number, number] | null;
  appraisal: Appraisal | null;
  flags: PokemonFlags & { shiny?: boolean };
  origin: Origin;
  moves: { fast: string | null; charged: string[] };
  sourceId: string | null;
}

export interface ProcessedEntry {
  draft: PokemonDraft;
  /** `ok` = confiable y coherente (se puede auto-guardar); `review` = a la cola "Por revisar". */
  status: 'ok' | 'review';
  reasons: string[];
  inference: InferResult | null;
  /** Lectura dudosa: ningún candidato de IV encaja con CP/PS. */
  doubtful: boolean;
  speciesAlternatives: { speciesId: string; label: string; score: number }[];
}

export interface PipelineOptions {
  playerLevel?: number;
  /** Confianza mínima para auto-aceptar un campo leído. */
  minConfidence?: number;
}

export interface PipelineDeps {
  ctx: EngineCtx;
  names: Names;
  speciesIndex: SpeciesIndex;
  moves: Move[];
}

const SHADOW_RE = /\b(sombra|sombrio|oscuro|shadow)\b/i;
const PURIFIED_RE = /\b(purificad[oa]|purified)\b/i;

export function buildMoveIndex(moves: Move[], names: Names) {
  const entries = moves.map((m) => ({ id: m.id, keys: [normalizeText(m.name), normalizeText(names.moves[m.id] ?? '')].filter(Boolean) }));
  return (text: string): string | null => {
    const q = normalizeText(text);
    if (!q) return null;
    let best: { id: string; s: number } | null = null;
    for (const e of entries)
      for (const k of e.keys) {
        const s = k === q ? 1 : Math.max(1 - levenshtein(q, k) / Math.max(q.length, k.length), dice(q, k) * 0.95);
        if (!best || s > best.s) best = { id: e.id, s };
      }
    return best && best.s >= 0.82 ? best.id : null;
  };
}

const usable = (f: { value: unknown; confidence: number } | undefined, min: number) => (f && f.value !== null && f.confidence >= min ? f.value : null);

/** Resuelve los nombres de ataque y los reparte en rápido/cargados según los datos de la especie. */
function classifyMoves(scan: ScanResult, species: Species | undefined, lookup: (t: string) => string | null): { fast: string | null; charged: string[] } {
  const raw = [scan.moves.fast.value, ...scan.moves.charged.map((c) => c.value)].filter((x): x is string => !!x);
  const ids = raw.map(lookup).filter((m): m is string => !!m);
  if (!species) return { fast: ids[0] ?? null, charged: ids.slice(1) };
  const fast = ids.find((m) => species.fast.includes(m)) ?? null;
  const charged = ids.filter((m) => m !== fast && species.charged.includes(m));
  return { fast, charged: [...new Set(charged)].slice(0, 2) };
}

export function toAppraisal(scan: ScanResult, min = 0.6): Appraisal | null {
  const a = scan.appraisal;
  if (!a) return null;
  const out: Appraisal = {};
  const overall = usable(a.overall, min);
  if (overall !== null) out.overall = overall as 1 | 2 | 3 | 4;
  const best = usable(a.bestStats, min);
  if (best !== null && (best as string[]).length) out.bestStats = best as Appraisal['bestStats'];
  const tier = usable(a.bestStatTier, min);
  if (tier !== null) out.bestStatTier = tier as 1 | 2 | 3 | 4;
  const bars: NonNullable<Appraisal['bars']> = {};
  for (const k of ['atk', 'def', 'hp'] as const) {
    const v = usable(a.bars[k], min);
    if (v !== null) bars[k] = v as 0 | 1 | 2 | 3;
  }
  if (Object.keys(bars).length) out.bars = bars;
  return Object.keys(out).length ? out : null;
}

/** Interpreta un resultado de proveedor, valida coherencia con el motor y decide ok/revisar. */
export function processScan(deps: PipelineDeps, scan: ScanResult, opts: PipelineOptions = {}, moveLookup = buildMoveIndex(deps.moves, deps.names)): ProcessedEntry {
  const min = opts.minConfidence ?? 0.8;
  const reasons: string[] = [];
  const speciesText = scan.species.value ?? '';
  const matches = speciesText ? deps.speciesIndex.match(speciesText, 5) : [];
  let species: Species | undefined;
  let speciesConf = 0;
  const best = speciesText ? deps.speciesIndex.best(speciesText) : null;
  if (best) {
    species = deps.ctx.speciesById.get(best.speciesId);
    speciesConf = Math.min(best.score, scan.species.confidence);
  }

  const shadow = scan.flags.shadow ?? (SHADOW_RE.test(speciesText) ? true : null);
  const purified = scan.flags.purified ?? (PURIFIED_RE.test(speciesText) ? true : null);
  const flags: PokemonFlags = {
    shadow: !!shadow, purified: !!purified, lucky: !!scan.flags.lucky, shiny: !!scan.flags.shiny,
    bestBuddy: !!scan.flags.bestBuddy, xxl: !!scan.flags.xxl, xxs: !!scan.flags.xxs, costume: !!scan.flags.costume,
  };
  const origin: Origin = scan.origin ?? (flags.lucky ? 'lucky_trade' : 'unknown');

  const cp = scan.cp.value;
  const hp = scan.hp.value;
  const level = scan.level.value;
  const dust = scan.powerUpDust.value;
  const appraisal = toAppraisal(scan);
  const exact = scan.ivs ? { ...scan.ivs } : null;

  const draft: PokemonDraft = {
    speciesId: species?.id ?? '',
    speciesName: species ? displayName(species, deps.names) : speciesText,
    nickname: scan.nickname,
    cp, hp, level, powerUpDust: dust,
    ivs: exact, ivsExact: !!exact, candidates: [], ivPercentRange: null,
    appraisal, flags, origin,
    moves: classifyMoves(scan, species, moveLookup),
    sourceId: scan.sourceId,
  };

  const alternatives = matches.map((m) => ({ speciesId: m.speciesId, label: m.label, score: m.score }));
  if (!species) {
    reasons.push(speciesText ? `Especie no reconocida o ambigua: "${speciesText}"` : 'No se leyó la especie');
    return { draft, status: 'review', reasons, inference: null, doubtful: false, speciesAlternatives: alternatives };
  }
  if (speciesConf < min) reasons.push(`Especie poco segura (${Math.round(speciesConf * 100)} %)`);

  let inference: InferResult | null = null;
  let doubtful = false;
  if (cp === null || hp === null) {
    if (!exact) reasons.push('Falta CP o PS');
  } else {
    if (scan.cp.confidence < min) reasons.push(`CP poco seguro (${Math.round(scan.cp.confidence * 100)} %)`);
    if (scan.hp.confidence < min) reasons.push(`PS poco seguro (${Math.round(scan.hp.confidence * 100)} %)`);
    if (level !== null && scan.level.confidence < min) reasons.push('Nivel poco seguro');
    if (dust !== null && scan.powerUpDust.confidence < min) reasons.push('Polvo poco seguro');
    const base = {
      species, cp, hp, flags, origin, playerLevel: opts.playerLevel,
      level: level ?? undefined, powerUpDust: dust ?? undefined, exactIVs: exact ?? undefined,
    };
    inference = inferIVs(deps.ctx.game, { ...base, appraisal: appraisal ?? undefined });
    if (inference.inconsistent && appraisal) {
      const without = inferIVs(deps.ctx.game, base);
      if (!without.inconsistent) {
        reasons.push('La valoración no concuerda con CP/PS: se ignoró');
        inference = without;
        draft.appraisal = null;
      }
    }
    if (inference.inconsistent && (level !== null || dust !== null)) {
      const loose = inferIVs(deps.ctx.game, { ...base, level: undefined, powerUpDust: undefined, appraisal: undefined });
      if (!loose.inconsistent) reasons.push('Nivel/polvo no concuerdan con CP/PS');
    }
    if (inference.inconsistent) {
      doubtful = true;
      reasons.push('Lectura dudosa: ninguna combinación de IVs encaja con CP/PS');
    } else {
      draft.candidates = inference.candidates;
      draft.ivPercentRange = inference.ivPercentRange;
      if (!draft.ivs && inference.distinctIVs === 1) {
        draft.ivs = inference.candidates[0].ivs;
        if (level === null) draft.level = inference.candidates[0].level;
      }
    }
  }
  return {
    draft,
    status: reasons.length ? 'review' : 'ok',
    reasons,
    inference,
    doubtful,
    speciesAlternatives: alternatives,
  };
}

/**
 * Desambigua especies candidatas por coherencia del motor: devuelve las que pueden producir ese CP y PS.
 * Útil para OCR cuando el nombre se leyó mal.
 */
export function coherentSpecies(deps: PipelineDeps, candidateIds: string[], cp: number, hp: number, extra: { level?: number; powerUpDust?: number; flags?: PokemonFlags; playerLevel?: number } = {}): string[] {
  const out: string[] = [];
  for (const id of candidateIds) {
    const s = deps.ctx.speciesById.get(id);
    if (!s) continue;
    const r = inferIVs(deps.ctx.game, { species: s, cp, hp, ...extra });
    if (!r.inconsistent) out.push(id);
  }
  return out;
}
