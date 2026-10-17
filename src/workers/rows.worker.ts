/// <reference lib="webworker" />
import { loadSimData } from '../data/loader';
import type { SimEnv } from '../sim';
import { simulateRow, type RowJob } from '../teams/matrix';
import type { MatrixRow, Opponent } from '../teams/types';

export type RowsRequest = { type: 'init'; opponents: Opponent[]; version?: string } | { type: 'job'; id: number; job: RowJob };
export type RowsResponse = { type: 'row'; id: number; row: MatrixRow } | { type: 'error'; id?: number; error: string };

const post = (m: RowsResponse) => (self as unknown as Worker).postMessage(m);

let envP: Promise<SimEnv> | null = null;
let opponents: Opponent[] = [];
let envVersion: string | undefined;
const getEnv = (version?: string) => {
  if (!envP || (version && version !== envVersion)) { envVersion = version; envP = loadSimData(version); }
  return envP;
};

/** Simula filas de la matriz (un candidato contra todas las amenazas × 3 escenarios de escudos). */
self.onmessage = async (ev: MessageEvent<RowsRequest>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') { opponents = m.opponents; await getEnv(m.version); return; }
    const env = await getEnv();
    post({ type: 'row', id: m.id, row: simulateRow(env, m.job, opponents) });
  } catch (e) {
    post({ type: 'error', id: m.type === 'job' ? m.id : undefined, error: String((e as Error).message ?? e) });
  }
};
