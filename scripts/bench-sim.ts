/** Mide el rendimiento del simulador: npx tsx scripts/bench-sim.ts */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle } from '../src/data/loader';
import { leagueCombos } from '../src/engine/league';
import { simulateBattle, type SimEnv } from '../src/sim';

const dir = join(process.cwd(), 'public', 'data');
const bundle = await loadBundle(async (p) => JSON.parse(readFileSync(join(dir, p), 'utf8')));
const env: SimEnv = { game: bundle.game, speciesById: bundle.speciesById, movesById: bundle.movesById };
const rk = await bundle.loadRanking('all-1500');
const es = rk.entries.filter((e) => !bundle.speciesById.get(e.id)!.formChange).slice(0, 100);
const mons = es.map((e) => { const sp = bundle.speciesById.get(e.id)!; const c = leagueCombos(sp, 1500, 50, env.game)[0]; return { speciesId: e.id, ivs: c.ivs, level: c.level, fast: e.moveset[0], charged: e.moveset.slice(1, 3), shields: 1 }; });
const N = Number(process.argv[2] ?? 60);
const t0 = performance.now(); let n = 0;
for (let i = 0; i < N; i++) for (let j = 0; j < 100; j++) for (const s of [0, 1, 2]) { simulateBattle(env, { ...mons[i % 100], shields: s }, { ...mons[j], shields: s }); n++; }
const dt = performance.now() - t0;
console.log(`${n} combates en ${dt.toFixed(0)} ms = ${(dt / n).toFixed(3)} ms/combate`);
