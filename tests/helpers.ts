import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle, type DataBundle } from '../src/data/loader';
import type { EngineCtx } from '../src/engine/types';
import type { RankingFile } from '../src/data/schemas';

const DIR = join(__dirname, '..', 'public', 'data');
export const fileFetcher = async (p: string) => JSON.parse(readFileSync(join(DIR, p), 'utf8'));

let cached: Promise<{ bundle: DataBundle; ctx: EngineCtx }> | null = null;

/** Datos reales de public/data + todos los rankings, listos para el motor. */
export function loadTestCtx(): Promise<{ bundle: DataBundle; ctx: EngineCtx }> {
  cached ??= (async () => {
    const bundle = await loadBundle(fileFetcher);
    const rankings: Record<string, RankingFile> = {};
    for (const r of bundle.manifest.rankings) rankings[r.key] = await bundle.loadRanking(r.key);
    return { bundle, ctx: { game: bundle.game, speciesById: bundle.speciesById, rankings } };
  })();
  return cached;
}
