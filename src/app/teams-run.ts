import type { SavedPokemon } from '../db/types';
import { dbRowCache, type GoVaultDB } from '../db/db';
import type { EngineCtx } from '../engine/types';
import type { SimEnv } from '../sim';
import { analyzeTeams, localComputer, type AnalyzeResult, type MatrixRow, type MoveMode, type RowComputer } from '../teams';
import type { RowsRequest, RowsResponse } from '../workers/rows.worker';

export interface RunTeamsParams {
  env: EngineCtx & SimEnv;
  db: GoVaultDB;
  leagueKey: string;
  cpCap: number;
  levelCap?: number;
  mode: MoveMode;
  topN: number;
  adviceLimit: number;
  collection: SavedPokemon[];
  playerLevel?: number;
  dataVersion: string;
  nameOf: (id: string) => string;
  onProgress?: (stage: string, done: number, total: number) => void;
  /** Número de workers (por defecto, según los núcleos del dispositivo, máx. 4). */
  workers?: number;
}

const IDLE_MS = 60_000;
let sharedPool: Worker[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function releasePool(): void {
  sharedPool.splice(0).forEach((w) => w.terminate());
}

function getPool(size: number): Worker[] {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(releasePool, IDLE_MS);
  while (sharedPool.length < size) sharedPool.push(new Worker(new URL('../workers/rows.worker.ts', import.meta.url), { type: 'module' }));
  return sharedPool.slice(0, size);
}

/**
 * Reparte las filas de la matriz entre varios Web Workers (los combates son independientes). El grupo de workers se
 * conserva ~1 min para que las siguientes consultas no paguen el arranque; si fallan, se calcula en este hilo.
 */
export function createWorkerComputer(size: number, fallback: RowComputer, version?: string): RowComputer {
  return (jobs, opponents, onProgress) =>
    new Promise((resolve, reject) => {
      const workers = getPool(Math.max(1, Math.min(size, jobs.length)));
      const out: MatrixRow[] = new Array(jobs.length);
      let next = 0, done = 0, failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        releasePool();
        fallback(jobs, opponents, onProgress).then(resolve, reject);
      };
      const feed = (w: Worker) => {
        if (next >= jobs.length) return;
        const id = next++;
        w.postMessage({ type: 'job', id, job: jobs[id] } satisfies RowsRequest);
      };
      for (const w of workers) {
        w.onmessage = (ev: MessageEvent<RowsResponse>) => {
          const m = ev.data;
          if (m.type === 'error') return fail();
          out[m.id] = m.row;
          done++;
          onProgress?.(done, jobs.length);
          if (done === jobs.length) resolve(out);
          else feed(w);
        };
        w.onerror = fail;
        w.postMessage({ type: 'init', opponents, version } satisfies RowsRequest);
        feed(w);
      }
    });
}

/** Ejecuta el análisis de equipos; las simulaciones se reparten en Web Workers (si no hay Worker, en el hilo principal). */
export function runTeamAnalysis(p: RunTeamsParams): Promise<AnalyzeResult> {
  const local = localComputer(p.env);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 1;
  const size = p.workers ?? Math.max(1, Math.min(4, cores - 1));
  const computer = typeof Worker !== 'undefined' ? createWorkerComputer(size, local, p.dataVersion) : local;
  return analyzeTeams({
    env: p.env, league: { key: p.leagueKey, cpCap: p.cpCap, levelCap: p.levelCap }, collection: p.collection, mode: p.mode, topN: p.topN,
    playerLevel: p.playerLevel, dataVersion: p.dataVersion, nameOf: p.nameOf, cache: dbRowCache(p.db), adviceLimit: p.adviceLimit,
    computer, onProgress: p.onProgress,
  });
}

/** Libera los workers (p. ej. al cerrar la pestaña de equipos). */
export const disposeTeamWorkers = releasePool;

/** Arranca los workers por adelantado (al abrir la pestaña Equipos) para que el primer cálculo no pague el arranque. */
export function prewarmTeamWorkers(version?: string, workers?: number): void {
  if (typeof Worker === 'undefined') return;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 1;
  const size = workers ?? Math.max(1, Math.min(4, cores - 1));
  for (const w of getPool(size)) w.postMessage({ type: 'init', opponents: [], version } satisfies RowsRequest);
}
