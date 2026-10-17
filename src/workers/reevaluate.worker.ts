/// <reference lib="webworker" />
import { loadBundle } from '../data/loader';
import { buildLeagues, DEFAULT_VERDICT_SETTINGS, type VerdictEnv, type VerdictSettings } from '../engine/verdict';
import { reevaluateRecords, type RoleChange } from '../engine/reevaluate';
import { displayName } from '../data/names';
import type { SavedPokemon } from '../db/types';
import type { RankingFile } from '../data/schemas';

export interface ReevalRequest { records: SavedPokemon[]; settings?: Partial<VerdictSettings> & Record<string, unknown> }
export type ReevalResponse = { ok: true; changes: RoleChange[]; dataVersion: string } | { ok: false; error: string };

/** Reevaluación automática en segundo plano al cambiar la versión de datos. */
self.onmessage = async (ev: MessageEvent<ReevalRequest>) => {
  try {
    const bundle = await loadBundle();
    const rankings: Record<string, RankingFile> = {};
    for (const r of bundle.manifest.rankings) rankings[r.key] = await bundle.loadRanking(r.key);
    const env: VerdictEnv = {
      game: bundle.game, speciesById: bundle.speciesById, rankings, movesById: bundle.movesById,
      leagues: buildLeagues(bundle.formats, bundle.cups),
    };
    const settings = { ...DEFAULT_VERDICT_SETTINGS, ...(ev.data.settings ?? {}) } as VerdictSettings;
    const nameOf = (id: string) => { const s = bundle.speciesById.get(id); return s ? displayName(s, bundle.names) : id; };
    const changes = reevaluateRecords(env, ev.data.records, settings, nameOf);
    (self as unknown as Worker).postMessage({ ok: true, changes, dataVersion: bundle.manifest.dataVersion } satisfies ReevalResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((e as Error).message ?? e) } satisfies ReevalResponse);
  }
};
