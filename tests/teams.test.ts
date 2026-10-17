import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import { analyzeTeams, buildCandidates, buildOpponents, opponentsSig, type RowCache } from '../src/teams';
import { buildRecord } from '../src/db/record';
import type { SavedPokemon } from '../src/db/types';
import { leagueCombos } from '../src/engine/league';
import { displayName } from '../src/data/names';
import type { SimEnv } from '../src/sim';
import type { EngineCtx } from '../src/engine/types';
import type { PokemonDraft } from '../src/providers/pipeline';

let env: EngineCtx & SimEnv;
let nameOf: (id: string) => string;
let dataVersion: string;
const league = { key: 'all-1500', cpCap: 1500, title: 'Súper Liga' };

beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  env = { ...ctx, movesById: bundle.movesById };
  nameOf = (id) => { const s = bundle.speciesById.get(id); return s ? displayName(s, bundle.names) : id; };
  dataVersion = bundle.manifest.dataVersion;
});

/** Pokémon de prueba: especies del top del ranking con IVs buenos (del top 150 por stat product) y ataques del ranking. */
function testCollection(count: number, offset = 0): SavedPokemon[] {
  const ranking = env.rankings['all-1500']!.entries.filter((e) => {
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
    const combos = leagueCombos(sp, 1500, 50, env.game);
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

describe('equipos', () => {
  it('candidatos: respeta tope de CP, sombra como entrada distinta, no repite especie en equipos', () => {
    const col = testCollection(12);
    const cands = buildCandidates(env, league, col, { mode: 'recommended', displayName: nameOf });
    expect(cands.length).toBeGreaterThanOrEqual(10);
    for (const c of cands) {
      expect(c.cp).toBeLessThanOrEqual(1500);
      expect(c.charged.length).toBeGreaterThan(0);
      expect(c.sig).toContain(c.speciesId);
    }
    const opp = buildOpponents(env, league, 100);
    expect(opp).toHaveLength(100);
    expect(opp[0].weight).toBe(1);
    expect(opp[99].weight).toBeCloseTo(0.4);
    expect(opponentsSig('all-1500', 'v', opp)).toBe(opponentsSig('all-1500', 'v', opp));
  });

  it('con 36 Pokémon devuelve 3 equipos distintos en < 5 s (matriz de 100 amenazas × 3 escenarios de escudos)', async () => {
    const col = testCollection(36);
    expect(col.length).toBeGreaterThanOrEqual(30);
    const t0 = performance.now();
    const r = await analyzeTeams({ env, league, collection: col, mode: 'recommended', topN: 100, dataVersion, nameOf });
    const ms = performance.now() - t0;
    expect(r.candidates.length).toBeGreaterThanOrEqual(30);
    expect(ms).toBeLessThan(5000);
    expect(r.teams).toHaveLength(3);
    for (const t of r.teams) {
      expect(t.members).toHaveLength(3);
      expect(new Set(t.members.map((m) => m.dex)).size).toBe(3); // sin repetir especie
      expect(t.coverage).toBeGreaterThan(0);
      expect(t.explanation.length).toBeGreaterThan(20);
      expect(new Set([t.roles.lead.key, t.roles.swap.key, t.roles.closer.key]).size).toBe(3);
    }
    expect(r.teams[0].score).toBeGreaterThanOrEqual(r.teams[1].score);
    expect(r.teams[1].score).toBeGreaterThanOrEqual(r.teams[2].score);
    // las alternativas se distinguen del mejor equipo
    expect(r.teams[1].members.filter((m) => r.teams[0].members.some((x) => x.key === m.key)).length).toBeLessThanOrEqual(1);
    console.info(`equipos: ${r.candidates.length} candidatos, ${r.stats.battles} combates en ${ms.toFixed(0)} ms`);
  }, 60000);

  it('la caché de la matriz evita recalcular y da el mismo resultado', async () => {
    const col = testCollection(8);
    const store = new Map<string, number[]>();
    const cache: RowCache = { get: (k) => store.get(k), set: (k, v) => { store.set(k, v); } };
    const a = await analyzeTeams({ env, league, collection: col, mode: 'recommended', topN: 40, dataVersion, nameOf, cache });
    const b = await analyzeTeams({ env, league, collection: col, mode: 'recommended', topN: 40, dataVersion, nameOf, cache });
    expect(a.stats.computedRows).toBe(a.candidates.length);
    expect(b.stats.computedRows).toBe(0);
    expect(b.stats.cachedRows).toBe(b.candidates.length);
    expect(b.teams.map((t) => t.score)).toEqual(a.teams.map((t) => t.score));
  }, 60000);

  it('"¿Qué me falta?" propone especies del top que no tengo y cuánto mejoran el equipo', async () => {
    const col = testCollection(14, 20);
    const r = await analyzeTeams({ env, league, collection: col, mode: 'recommended', topN: 60, dataVersion, nameOf, adviceLimit: 8 });
    expect(r.advice.length).toBeGreaterThan(0);
    const owned = new Set(r.candidates.map((c) => c.dex));
    for (const a of r.advice) expect(owned.has(env.speciesById.get(a.speciesId)!.dex)).toBe(false);
    for (let i = 1; i < r.advice.length; i++) expect(r.advice[i - 1].delta).toBeGreaterThanOrEqual(r.advice[i].delta);
  }, 60000);

  it('el modo "ataques actuales" usa los registrados; sin ellos, los recomendados', () => {
    const col = testCollection(3);
    col[0] = { ...col[0], moves: { fast: null, charged: [] } };
    const cur = buildCandidates(env, league, col, { mode: 'current', displayName: nameOf });
    const first = cur.find((c) => c.recordId === col[0].id)!;
    expect(first.notes.join()).toMatch(/Faltan ataques/);
    const second = cur.find((c) => c.recordId === col[1].id)!;
    expect(second.fast).toBe(col[1].moves.fast);
  });

  it('con pocos candidatos (<3) no inventa equipos', async () => {
    const r = await analyzeTeams({ env, league, collection: testCollection(2), mode: 'recommended', topN: 20, dataVersion, nameOf });
    expect(r.teams.length).toBe(0);
  }, 30000);
});
