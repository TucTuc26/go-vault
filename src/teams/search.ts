import type { GameData } from '../data/schemas';
import type { SimEnv } from '../sim';
import { collapse } from './matrix';
import { SCENARIO_WEIGHTS, type Candidate, type MatrixRow, type Opponent, type TeamResult } from './types';

/** Parámetros del puntaje del equipo (ver DECISIONS.md, Fase 7). */
export const TEAM_SCORING = {
  /** Peso del mejor, 2.º y 3.er miembro frente a cada amenaza. */
  rank: [0.6, 0.3, 0.1] as const,
  /** Una amenaza cuenta como "cubierta" si algún miembro la vence (calificación > 500). */
  winRating: 500,
  /** Penalización por debilidad de tipo compartida (2 miembros / 3 miembros) si ninguno resiste. */
  sharedWeakness: [12, 35] as const,
  /** Umbral de multiplicador para considerar una debilidad / resistencia. */
  weakAt: 1.5,
  resistAt: 0.99,
  /** Candidatos a partir de los cuales se usa búsqueda por haz en vez de exhaustiva. */
  exhaustiveMax: 40,
  beamWidth: 300,
} as const;

interface Prepared {
  n: number;
  nOpp: number;
  R: Float64Array[];
  w: Float64Array;
  totalW: number;
  family: string[];
  weak: Uint8Array[]; // por candidato y tipo: 2 = débil, 1 = neutro, 0 = resiste
  typeNames: string[];
}

export function typeProfile(game: GameData, types: string[]): Uint8Array {
  const out = new Uint8Array(game.typeOrder.length);
  game.typeOrder.forEach((atk, t) => {
    let e = 1;
    for (const d of types) if (d !== 'none') e *= game.typeChart[atk][game.typeOrder.indexOf(d)];
    out[t] = e >= TEAM_SCORING.weakAt ? 2 : e < TEAM_SCORING.resistAt ? 0 : 1;
  });
  return out;
}

export function prepare(env: SimEnv, candidates: Candidate[], rows: MatrixRow[], opponents: Opponent[]): Prepared {
  const nOpp = opponents.length;
  const w = new Float64Array(nOpp);
  let totalW = 0;
  opponents.forEach((o, i) => { w[i] = o.weight; totalW += o.weight; });
  return {
    n: candidates.length, nOpp,
    R: rows.map((r) => collapse(r, nOpp)),
    w, totalW,
    family: candidates.map((c) => String(c.dex)),
    weak: candidates.map((c) => typeProfile(env.game, env.speciesById.get(c.speciesId)!.types)),
    typeNames: env.game.typeOrder,
  };
}

/** Penalización por debilidades de tipo compartidas (≥2 miembros débiles y ninguno resiste). */
function weaknessPenalty(p: Prepared, members: number[]): number {
  let pen = 0;
  for (let t = 0; t < p.typeNames.length; t++) {
    let weak = 0, resist = 0;
    for (const m of members) { const v = p.weak[m][t]; if (v === 2) weak++; else if (v === 0) resist++; }
    if (weak >= 2 && resist === 0) pen += TEAM_SCORING.sharedWeakness[weak === 2 ? 0 : 1];
  }
  return pen;
}

/** Puntaje del equipo (0–1000 aprox.): por amenaza 0.6·mejor + 0.3·2.º + 0.1·3.º, ponderado, menos penalizaciones. */
export function scoreTeam(p: Prepared, members: number[]): number {
  const [w1, w2, w3] = TEAM_SCORING.rank;
  const ra = p.R[members[0]], rb = p.R[members[1]], rc = members.length > 2 ? p.R[members[2]] : null;
  let sum = 0;
  for (let o = 0; o < p.nOpp; o++) {
    let a = ra[o], b = rb[o], c = rc ? rc[o] : -1;
    // ordenar a >= b >= c
    if (b > a) [a, b] = [b, a];
    if (c > b) { [b, c] = [c, b]; if (b > a) [a, b] = [b, a]; }
    sum += p.w[o] * (rc ? w1 * a + w2 * b + w3 * c : 0.65 * a + 0.35 * b);
  }
  return sum / p.totalW - weaknessPenalty(p, members);
}

export function coverageOf(p: Prepared, members: number[]): { coverage: number; uncovered: { o: number; best: number }[] } {
  let covered = 0;
  const uncovered: { o: number; best: number }[] = [];
  for (let o = 0; o < p.nOpp; o++) {
    let best = -1;
    for (const m of members) best = Math.max(best, p.R[m][o]);
    if (best > TEAM_SCORING.winRating) covered += p.w[o];
    else uncovered.push({ o, best });
  }
  uncovered.sort((x, y) => p.w[y.o] - p.w[x.o] || x.best - y.best);
  return { coverage: covered / p.totalW, uncovered };
}

export interface SearchOptions { top?: number; maxCandidates?: number }

/** Mejores equipos de 3 (sin repetir especie): exhaustivo hasta 40 candidatos, búsqueda por haz si hay más. */
export function searchTeams(p: Prepared, opts: SearchOptions = {}): { members: number[]; score: number }[] {
  const n = p.n;
  const ok = (i: number, j: number) => p.family[i] !== p.family[j];
  const all: { members: number[]; score: number }[] = [];
  if (n < 3) return all; // un equipo necesita 3 miembros
  if (n <= TEAM_SCORING.exhaustiveMax) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (!ok(i, j)) continue;
      for (let k = j + 1; k < n; k++) {
        if (!ok(i, k) || !ok(j, k)) continue;
        all.push({ members: [i, j, k], score: scoreTeam(p, [i, j, k]) });
      }
    }
  } else {
    const pairs: { a: number; b: number; score: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (ok(i, j)) pairs.push({ a: i, b: j, score: scoreTeam(p, [i, j]) });
    pairs.sort((x, y) => y.score - x.score);
    const seen = new Set<string>();
    for (const pr of pairs.slice(0, TEAM_SCORING.beamWidth)) {
      for (let k = 0; k < n; k++) {
        if (k === pr.a || k === pr.b || !ok(pr.a, k) || !ok(pr.b, k)) continue;
        const members = [pr.a, pr.b, k].sort((x, y) => x - y);
        const key = members.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ members, score: scoreTeam(p, members) });
      }
    }
  }
  all.sort((x, y) => y.score - x.score);
  // mejor equipo + alternativas que comparten como máximo 1 miembro con las ya elegidas (si no hay, se relaja)
  const want = opts.top ?? 3;
  const picked: typeof all = [];
  for (const t of all) {
    if (picked.length >= want) break;
    if (picked.every((q) => q.members.filter((m) => t.members.includes(m)).length <= 1)) picked.push(t);
  }
  for (const t of all) {
    if (picked.length >= want) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

const avgScenario = (row: MatrixRow, p: Prepared, s: number, topW?: number): number => {
  const k = SCENARIO_WEIGHTS.length;
  let sum = 0, tw = 0;
  const limit = topW ?? p.nOpp;
  for (let o = 0; o < Math.min(limit, p.nOpp); o++) { sum += row[o * k + s] * p.w[o]; tw += p.w[o]; }
  return sum / tw;
};

/** Describe un equipo: roles (apertura / cambio / cierre), cobertura, amenazas sin cubrir y debilidades compartidas. */
export function describeTeam(
  env: SimEnv, p: Prepared, candidates: Candidate[], rows: MatrixRow[], opponents: Opponent[], members: number[], score: number,
  nameOf: (speciesId: string) => string,
): TeamResult {
  const lead = [...members].sort((a, b) => avgScenario(rows[b], p, 1, 40) - avgScenario(rows[a], p, 1, 40))[0];
  const rest = members.filter((m) => m !== lead);
  const closer = [...rest].sort((a, b) => avgScenario(rows[b], p, 0) - avgScenario(rows[a], p, 0))[0];
  const swap = rest.find((m) => m !== closer) ?? closer;
  const { coverage, uncovered } = coverageOf(p, members);
  const shared: { type: string; members: number }[] = [];
  for (let t = 0; t < p.typeNames.length; t++) {
    let weak = 0, resist = 0;
    for (const m of members) { if (p.weak[m][t] === 2) weak++; else if (p.weak[m][t] === 0) resist++; }
    if (weak >= 2 && resist === 0) shared.push({ type: p.typeNames[t], members: weak });
  }
  const unc = uncovered.slice(0, 5).map((u) => ({ speciesId: opponents[u.o].speciesId, best: Math.round(u.best) }));
  const name = (i: number) => candidates[i].label;
  const parts: string[] = [
    `${name(lead)} abre: es el que mejor rinde en el cruce inicial contra las amenazas más comunes.`,
    `${name(swap)} es el cambio y ${name(closer)} cierra (mejor sin escudos).`,
    `Cubre el ${Math.round(coverage * 100)} % de las amenazas del meta (ponderado por popularidad).`,
  ];
  if (unc.length) parts.push(`Le cuesta: ${unc.slice(0, 3).map((u) => nameOf(u.speciesId)).join(', ')}.`);
  if (shared.length) parts.push(`Debilidad compartida: ${shared.map((s) => `${s.type} (${s.members})`).join(', ')}.`);
  return {
    members: members.map((m) => candidates[m]), score: Math.round(score * 10) / 10, coverage,
    roles: { lead: candidates[lead], swap: candidates[swap], closer: candidates[closer] },
    uncovered: unc, sharedWeaknesses: shared, explanation: parts.join(' '),
  };
}
