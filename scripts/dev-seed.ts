/** Genera datos de prueba (JSON de respaldo) para probar la app en el navegador: npx tsx scripts/dev-seed.ts > seed.json */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle } from '../src/data/loader';
import { testCollection } from '../tests/records';

const dir = join(process.cwd(), 'public', 'data');
const bundle = await loadBundle(async (p) => JSON.parse(readFileSync(join(dir, p), 'utf8')));
const rankings: Record<string, any> = {};
for (const r of bundle.manifest.rankings) rankings[r.key] = await bundle.loadRanking(r.key);
const env = { game: bundle.game, speciesById: bundle.speciesById, rankings };
const pokemon = testCollection(env as never, bundle.manifest.dataVersion, Number(process.argv[2] ?? 12), 0).map(({ id: _id, ...r }) => r);
console.log(JSON.stringify({ app: 'go-vault', version: 1, exportedAt: new Date().toISOString(), pokemon }));
