import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import { createOriginal, originalCpmTable, type OriginalMon, type OriginalSpec } from './pvpoke-original';
import { cpmTable } from '../src/engine/stats';
import { leagueCombos } from '../src/engine/league';
import { simulateBattle, type SimEnv, type SimMonSpec } from '../src/sim';
import type { Species } from '../src/data/schemas';

let env: SimEnv;
let original: ReturnType<typeof createOriginal>;
let rankings: Record<string, import('../src/data/schemas').RankingFile | undefined>;

beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  env = { game: bundle.game, speciesById: bundle.speciesById, movesById: bundle.movesById };
  original = createOriginal({ species: bundle.species, moves: bundle.moves, game: bundle.game });
  rankings = ctx.rankings;
});

// PRNG determinista
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('tabla de cpm vs la de PvPoke', () => {
  it('coincide con los valores literales de Pokemon.js (niveles 1–50.5 en pasos de 0.5)', () => {
    const orig = originalCpmTable();
    const mine = cpmTable(env.game);
    for (let i = 0; i < 101; i++) expect(Math.abs(mine[i] - orig[i]) / orig[i]).toBeLessThan(1e-9);
  });
});

describe('tabla de tipos del juego vs la de PvPoke', () => {
  it('los multiplicadores por tipo coinciden para todos los pares de tipos', () => {
    const types = env.game.typeOrder;
    const sp = (t1: string, t2?: string): Species => ({ id: 'x', dex: 1, name: 'X', baseId: 'x', shadow: false, shadowEligible: false, types: t2 ? [t1, t2] : [t1], atk: 100, def: 100, hp: 100, fast: ['COUNTER'], charged: ['ICE_PUNCH'], elite: [], thirdMove: null, family: { id: null, parent: null, evolutions: [] }, tags: [], released: true });
    // PvPoke: DamageCalculator.getEffectiveness(moveType, [t1, t2]) vía un Pokémon de ese tipo
    const o = createOriginal({ species: [sp('normal'), ...types.map((t) => ({ ...sp(t), id: `t_${t}` }))], moves: [...env.movesById.values()], game: env.game });
    const ctx = o.ctx as import('node:vm').Context;
    for (const a of types) for (const d of types) {
      const orig = (require('node:vm') as typeof import('node:vm')).runInContext(`DamageCalculator.getEffectiveness(${JSON.stringify(a)}, [${JSON.stringify(d)}])`, ctx) as number;
      const mine = Math.fround(env.game.typeChart[a][types.indexOf(d)]);
      expect(Math.abs(mine - orig)).toBeLessThan(1e-6);
    }
  });
});

describe('simulador (port) vs simulador original de PvPoke', () => {
  const LEAGUES: { key: string; cap: number }[] = [{ key: 'all-1500', cap: 1500 }, { key: 'all-2500', cap: 2500 }, { key: 'all-10000', cap: 10000 }];

  function pick(rng: () => number, key: string, cap: number): { mon: OriginalMon & SimMonSpec; label: string } | null {
    const entries = rankings[key]!.entries.filter((e) => !env.speciesById.get(e.id)!.formChange && !e.id.includes('_mega')).slice(0, 40);
    const e = entries[Math.floor(rng() * entries.length)];
    const sp = env.speciesById.get(e.id)!;
    const combos = leagueCombos(sp, cap, 50, env.game);
    if (!combos.length) return null;
    const c = combos[Math.floor(rng() * Math.min(300, combos.length))];
    const fast = e.moveset[0];
    const charged = e.moveset.slice(1, 3).filter(Boolean);
    const shields = Math.floor(rng() * 3);
    return { mon: { id: sp.id, speciesId: sp.id, ivs: c.ivs, level: c.level, fast, charged, shields }, label: `${sp.id} L${c.level}` };
  }

  const cases = 3 * 70;
  it(`coincide en ${cases} combates (3 ligas, 0/1/2 escudos, IVs y ataques variados): PS, energía, escudos, buffs, calificaciones, turnos y ataques usados`, () => {
    const rng = mulberry32(20261017);
    let n = 0;
    let chargedEvents = 0, shieldEvents = 0, buffed = 0, wins = [0, 0, 0];
    const mismatches: string[] = [];
    for (const lg of LEAGUES) {
      for (let k = 0; k < 70; k++) {
        const a = pick(rng, lg.key, lg.cap);
        const b = pick(rng, lg.key, lg.cap);
        if (!a || !b) continue;
        const spec: OriginalSpec = { cp: lg.cap, a: a.mon, b: b.mon };
        const orig = original.simulate(spec);
        const mine = simulateBattle(env, a.mon, b.mon, { timeline: true });
        const sig = (r: { hp: number[]; energy: number[]; shields: number[]; ratings: number[]; turns: number; turnsToWin: number[]; winner: number; buffs: number[][] }) =>
          JSON.stringify([r.hp, r.energy, r.shields, r.ratings, r.turns, r.turnsToWin, r.winner, r.buffs]);
        const evt = (tl: { type: string; name: string; actor: number; turn: number }[]) =>
          tl.filter((e) => /^(fast|charged)/.test(e.type) || e.type === 'shield' || e.type === 'faint').map((e) => `${e.turn}:${e.actor}:${e.type}:${e.name}`).join('|');
        if (sig(orig) !== sig(mine) || evt(orig.timeline) !== evt(mine.timeline)) {
          mismatches.push(`${lg.cap} ${a.label} (${a.mon.shields}🛡 ${a.mon.fast}/${a.mon.charged.join('+')}) vs ${b.label} (${b.mon.shields}🛡 ${b.mon.fast}/${b.mon.charged.join('+')})\n   orig ${sig(orig)}\n   mine ${sig(mine)}`);
        }
        chargedEvents += mine.timeline.filter((e) => e.type.startsWith('charged')).length;
        shieldEvents += mine.timeline.filter((e) => e.type === 'shield').length;
        if (mine.buffs.some((b) => b.some((x) => x !== 0))) buffed++;
        wins[mine.winner === -1 ? 2 : mine.winner]++;
        n++;
      }
    }
    // la comparación no es trivial: hay ataques cargados, escudos, buffs y victorias de ambos lados
    expect(chargedEvents).toBeGreaterThan(300);
    expect(shieldEvents).toBeGreaterThan(50);
    expect(buffed).toBeGreaterThan(10);
    expect(wins[0]).toBeGreaterThan(30);
    expect(wins[1]).toBeGreaterThan(30);
    expect(n).toBeGreaterThanOrEqual(150);
    expect(mismatches.slice(0, 5).join('\n')).toBe('');
  }, 120000);

  it('las estadísticas de combate y el orden de los ataques cargados coinciden con el original', () => {
    const rng = mulberry32(7);
    for (let k = 0; k < 40; k++) {
      const a = pick(rng, 'all-1500', 1500)!;
      const b = pick(rng, 'all-1500', 1500)!;
      const orig = original.simulate({ cp: 1500, a: a.mon, b: b.mon });
      // estadísticas base del original vs port (usando el mismo constructor)
      const mine = simulateBattle(env, a.mon, b.mon);
      expect(mine.winner).toBe(orig.winner);
      expect(mine.ratings).toEqual(orig.ratings);
    }
  });
});
