import { buildRecord } from '../src/db/record';
import type { SavedPokemon } from '../src/db/types';
import { leagueCombos } from '../src/engine/league';
import type { EngineCtx } from '../src/engine/types';
import type { PokemonDraft } from '../src/providers/pipeline';

/** Registros de prueba: especies del top del ranking con IVs buenos y ataques del ranking (determinista). */
export function testCollection(env: EngineCtx, dataVersion: string, count: number, offset = 0, rankingKey = 'all-1500', cap = 1500): SavedPokemon[] {
  const ranking = env.rankings[rankingKey]!.entries.filter((e) => {
    const s = env.speciesById.get(e.id)!;
    return !s.formChange && !e.id.includes('_mega');
  });
  const out: SavedPokemon[] = [];
  const seenDex = new Set<number>();
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const e of ranking.slice(offset)) {
    if (out.length >= count) break;
    const sp = env.speciesById.get(e.id)!;
    if (seenDex.has(sp.dex)) continue;
    seenDex.add(sp.dex);
    const combos = leagueCombos(sp, cap, 50, env.game);
    const c = combos[Math.floor(rand() * Math.min(150, combos.length))];
    const draft = {
      speciesId: sp.baseId, speciesName: sp.name, nickname: null, cp: c.cp, hp: c.hp, level: c.level, powerUpDust: null,
      ivs: c.ivs, ivsExact: true, candidates: [], ivPercentRange: null, appraisal: null,
      flags: { shadow: sp.shadow }, origin: 'unknown', moves: { fast: e.moveset[0], charged: e.moveset.slice(1, 3) }, sourceId: null,
    } as unknown as PokemonDraft;
    const rec = buildRecord({ draft, species: sp, roles: [{ kind: 'manual' }], dataVersion });
    out.push({ ...rec, id: out.length + 1 });
  }
  return out;
}
