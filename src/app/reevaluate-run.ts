import type { SavedPokemon } from '../db/types';
import type { VerdictEnv, VerdictSettings } from '../engine/verdict';
import { reevaluateRecords, type RoleChange } from '../engine/reevaluate';
import type { ReevalResponse } from '../workers/reevaluate.worker';

/** Reevalúa en un Web Worker; si no hay Worker (pruebas), lo hace en el hilo principal. */
export async function reevaluateAsync(env: VerdictEnv, records: SavedPokemon[], settings: VerdictSettings, nameOf: (id: string) => string): Promise<RoleChange[]> {
  if (typeof Worker === 'undefined') return reevaluateRecords(env, records, settings, nameOf);
  return new Promise<RoleChange[]>((resolve, reject) => {
    const w = new Worker(new URL('../workers/reevaluate.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<ReevalResponse>) => {
      w.terminate();
      if (ev.data.ok) resolve(ev.data.changes);
      else reject(new Error(ev.data.error));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ records, settings });
  });
}
