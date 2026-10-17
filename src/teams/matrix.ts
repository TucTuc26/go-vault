import { simulateBattle, type SimEnv } from '../sim';
import { SCENARIO_WEIGHTS, SHIELD_SCENARIOS, type Candidate, type MatrixRow, type Opponent } from './types';
import { toSimSpec } from './candidates';

/** Firma de un conjunto de oponentes (parte de la clave de caché de la matriz). */
export function opponentsSig(leagueKey: string, dataVersion: string, opponents: Opponent[]): string {
  let h = 0;
  for (const o of opponents) for (const ch of `${o.speciesId}|${o.spec.level}|${o.spec.fast}|${o.spec.charged.join('+')}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${dataVersion}|${leagueKey}|${opponents.length}|${h}`;
}

/** Fila de la matriz: calificación (0–1000) del candidato contra cada oponente y escenario de escudos (0v0, 1v1, 2v2). */
export function simulateRow(env: SimEnv, c: Pick<Candidate, 'speciesId' | 'ivs' | 'level' | 'fast' | 'charged'>, opponents: Opponent[]): MatrixRow {
  const row: MatrixRow = new Array(opponents.length * SHIELD_SCENARIOS.length);
  for (let o = 0; o < opponents.length; o++) {
    for (let s = 0; s < SHIELD_SCENARIOS.length; s++) {
      const shields = SHIELD_SCENARIOS[s];
      const res = simulateBattle(env, toSimSpec(c, shields), { ...opponents[o].spec, shields });
      row[o * SHIELD_SCENARIOS.length + s] = res.ratings[0];
    }
  }
  return row;
}

export interface RowCache {
  get(key: string): MatrixRow | undefined | Promise<MatrixRow | undefined>;
  set(key: string, row: MatrixRow): void | Promise<void>;
}

export type RowJob = Pick<Candidate, 'speciesId' | 'ivs' | 'level' | 'fast' | 'charged'>;

/** Calcula filas de la matriz (en el hilo actual o repartidas en varios Web Workers). */
export type RowComputer = (jobs: RowJob[], opponents: Opponent[], onProgress?: (done: number, total: number) => void) => Promise<MatrixRow[]>;

export const localComputer = (env: SimEnv): RowComputer => async (jobs, opponents, onProgress) => {
  const out: MatrixRow[] = [];
  for (let i = 0; i < jobs.length; i++) { out.push(simulateRow(env, jobs[i], opponents)); onProgress?.(i + 1, jobs.length); }
  return out;
};

/** Calcula (o recupera de la caché) las filas de todos los candidatos; solo simula las que faltan. */
export async function computeRows(
  env: SimEnv,
  candidates: (RowJob & { sig: string })[],
  opponents: Opponent[],
  oppSig: string,
  opts: { cache?: RowCache; computer?: RowComputer; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ rows: MatrixRow[]; computed: number; cached: number }> {
  const rows: (MatrixRow | undefined)[] = new Array(candidates.length);
  const missing: number[] = [];
  let cached = 0;
  for (let i = 0; i < candidates.length; i++) {
    const hit = opts.cache ? await opts.cache.get(`${oppSig}|${candidates[i].sig}`) : undefined;
    if (hit) { rows[i] = hit; cached++; } else missing.push(i);
  }
  opts.onProgress?.(cached, candidates.length);
  if (missing.length) {
    const computer = opts.computer ?? localComputer(env);
    const done = await computer(missing.map((i) => candidates[i]), opponents, (d) => opts.onProgress?.(cached + d, candidates.length));
    for (let k = 0; k < missing.length; k++) {
      rows[missing[k]] = done[k];
      if (opts.cache) await opts.cache.set(`${oppSig}|${candidates[missing[k]].sig}`, done[k]);
    }
  }
  return { rows: rows as MatrixRow[], computed: missing.length, cached };
}

/** Colapsa los 3 escenarios en una calificación por oponente (media ponderada). */
export function collapse(row: MatrixRow, nOpp: number): Float64Array {
  const out = new Float64Array(nOpp);
  const k = SCENARIO_WEIGHTS.length;
  for (let o = 0; o < nOpp; o++) {
    let v = 0;
    for (let s = 0; s < k; s++) v += row[o * k + s] * SCENARIO_WEIGHTS[s];
    out[o] = v;
  }
  return out;
}
