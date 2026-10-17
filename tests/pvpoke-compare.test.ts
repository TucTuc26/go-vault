import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import { pvpokeCpms, pvpokeGenerateIVCombinations } from './pvpoke-reference';
import { leagueCombos } from '../src/engine/league';
import type { EngineCtx } from '../src/engine/types';

let ctx: EngineCtx;
beforeAll(async () => { ctx = (await loadTestCtx()).ctx; });

const LEAGUES = [
  { key: 'all-1500', cap: 1500 },
  { key: 'all-2500', cap: 2500 },
  { key: 'all-10000', cap: 10000 },
];

describe('motor vs lógica de PvPoke (generateIVCombinations)', () => {
  it('mismo orden de las 4096 combinaciones, nivel y stat product en ≥20 especies × 3 ligas', () => {
    const cpms = pvpokeCpms(ctx.game.cpmWhole);
    let cases = 0;
    for (const lg of LEAGUES) {
      const top = ctx.rankings[lg.key]!.entries.filter((e) => !e.id.endsWith('_shadow') && !e.id.includes('_mega')).slice(0, 10);
      for (const e of top) {
        const s = ctx.speciesById.get(e.id)!;
        const ref = pvpokeGenerateIVCombinations(s, cpms, lg.cap, 50);
        const mine = leagueCombos(s, lg.cap, 50, ctx.game);
        expect(mine.length).toBe(ref.length);
        for (const i of [0, 1, 17, 100, 1000, ref.length - 1]) {
          const r = ref[Math.min(i, ref.length - 1)];
          const m = mine[Math.min(i, mine.length - 1)];
          // la tabla literal de PvPoke tiene 15 cifras: los empates exactos de stat product pueden ordenarse distinto
          expect(Math.abs(m.product - r.overall) / r.overall).toBeLessThan(1e-9);
          const idx = Math.min(i, ref.length - 1);
          const tied = [idx - 1, idx + 1].some((j) => j >= 0 && j < ref.length && Math.abs(ref[j].overall - r.overall) / r.overall < 1e-9);
          if (!tied) {
            expect(m.ivs).toEqual(r.ivs);
            expect(m.level).toBe(r.level);
            expect(m.cp).toBe(r.cp);
          }
        }
        cases++;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(20);
  });

  it('cada ranking publicado por PvPoke corresponde a una de mis 4096 combinaciones (≥20 casos, 3 ligas)', () => {
    let cases = 0;
    for (const lg of LEAGUES) {
      const entries = ctx.rankings[lg.key]!.entries.filter((e) => !e.id.endsWith('_shadow') && !e.id.includes('_mega')).slice(0, 12);
      for (const e of entries) {
        const s = ctx.speciesById.get(e.id)!;
        const combos = leagueCombos(s, lg.cap, 50, ctx.game);
        // PvPoke publica atk/def truncados a 1 decimal y el stat product /1000 de sus IVs por defecto
        const match = combos.find((c) => c.atk - e.atk > -1e-6 && c.atk - e.atk < 0.1 && c.def - e.def > -1e-6 && c.def - e.def < 0.1 && c.hp === e.hp);
        expect(match, e.id + ' ' + lg.key).toBeDefined();
        expect(Math.abs(Math.round(match!.product / 1000) - e.product)).toBeLessThanOrEqual(1);
        expect(combos[0].product).toBeGreaterThanOrEqual(match!.product);
        cases++;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(20);
  });
});
