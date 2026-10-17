import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import type { EngineCtx } from '../src/engine/types';
import {
  accountMaxLevel, affordability, appraisalOf, bestLevelUnderCap, calcCP, calcHP, cpmAt, dustForNextPowerUp, evaluateForLeague,
  evolutionCost, evolutionLine, inferIVs, ivFloor, leagueCombos, matchesAppraisal, planUpgrade, powerUpCost, recommendMoveset,
  secondMoveCost, statsAt, baseOf, effectiveMaxLevel,
} from '../src/engine';

let ctx: EngineCtx;
const sp = (id: string) => ctx.speciesById.get(id)!;
beforeAll(async () => { ctx = (await loadTestCtx()).ctx; });

describe('CP / PS / niveles', () => {
  it('Mewtwo 15/15/15: CP 4178 nivel 40 y 4724 nivel 50 (valores conocidos del juego)', () => {
    const b = baseOf(sp('mewtwo'));
    const ivs = { atk: 15, def: 15, hp: 15 };
    expect(statsAt(b, ivs, 40, ctx.game).cp).toBe(4178);
    expect(statsAt(b, ivs, 50, ctx.game).cp).toBe(4724);
    expect(statsAt(b, ivs, 40, ctx.game).hp).toBe(180);
  });
  it('CP mínimo = 10 y HP mínimo = 10', () => {
    const b = { atk: 10, def: 10, hp: 10 };
    expect(calcCP(b, { atk: 0, def: 0, hp: 0 }, cpmAt(ctx.game, 1))).toBe(10);
    expect(calcHP(b, { atk: 0, def: 0, hp: 0 }, cpmAt(ctx.game, 1))).toBe(10);
  });
  it('niveles en pasos de 0.5, rechaza niveles inválidos', () => {
    expect(cpmAt(ctx.game, 1)).toBe(0.094);
    expect(cpmAt(ctx.game, 1.5)).toBeCloseTo(0.1351374318, 7);
    expect(() => cpmAt(ctx.game, 1.3)).toThrow();
    expect(cpmAt(ctx.game, 51)).toBeGreaterThan(cpmAt(ctx.game, 50));
  });
  it('tope de nivel por cuenta y Mejor Amigo (nivel 51)', () => {
    expect(accountMaxLevel(ctx.game, 30)).toBe(40);
    expect(accountMaxLevel(ctx.game, 40)).toBe(50);
    expect(accountMaxLevel(ctx.game, 50)).toBe(50);
    expect(accountMaxLevel(ctx.game)).toBe(50);
    expect(effectiveMaxLevel(ctx.game, 45, true)).toBe(51);
  });
  it('pisos de IV por origen', () => {
    const g = ctx.game;
    expect(ivFloor(g, 'wild')).toBe(0);
    expect(ivFloor(g, 'weather')).toBe(g.weather.guaranteedIvs);
    expect(ivFloor(g, 'raid')).toBe(g.weather.raidGuaranteedIvs);
    expect(ivFloor(g, 'egg')).toBe(10);
    expect(ivFloor(g, 'trade_best')).toBe(5);
    expect(ivFloor(g, 'wild', { lucky: true })).toBe(12);
    expect(ivFloor(g, 'wild', { purified: true })).toBe(2);
  });
});

describe('inferIVs', () => {
  const mewtwo = () => sp('mewtwo');
  it('IVs exactos: solo valida contra CP/PS', () => {
    const r = inferIVs(ctx.game, { species: mewtwo(), cp: 4178, hp: 180, level: 40, exactIVs: { atk: 15, def: 15, hp: 15 } });
    expect(r.candidates).toHaveLength(1);
    expect(r.inconsistent).toBe(false);
    const bad = inferIVs(ctx.game, { species: mewtwo(), cp: 4179, hp: 180, level: 40, exactIVs: { atk: 15, def: 15, hp: 15 } });
    expect(bad.inconsistent).toBe(true);
  });
  it('con nivel conocido, el hundo de Mewtwo es la única opción con valoración máxima', () => {
    const r = inferIVs(ctx.game, { species: mewtwo(), cp: 4178, hp: 180, level: 40, appraisal: { overall: 4, bestStats: ['atk', 'def', 'hp'], bestStatTier: 4 } });
    expect(r.distinctIVs).toBe(1);
    expect(r.ivPercentRange).toEqual([100, 100]);
    expect(r.ambiguous).toBe(false);
  });
  it('sin valoración devuelve varios candidatos y propone una pregunta mínima', () => {
    const b = baseOf(sp('medicham'));
    const cpm = cpmAt(ctx.game, 24);
    const ivs = { atk: 15, def: 15, hp: 14 };
    const cp = calcCP(b, ivs, cpm);
    const hp = calcHP(b, ivs, cpm);
    const r = inferIVs(ctx.game, { species: sp('medicham'), cp, hp });
    expect(r.candidates.some((c) => c.level === 24 && c.ivs.hp === 14 && c.ivs.atk === 15)).toBe(true);
    expect(r.ambiguous).toBe(true);
    expect(r.question).not.toBeNull();
  });
  it('el polvo de la siguiente mejora acota el nivel (y sombra ×1.2 lo cambia)', () => {
    const g = ctx.game;
    expect(dustForNextPowerUp(g, 24)).toBe(g.powerUp.stardust[23]);
    expect(dustForNextPowerUp(g, 24, { shadow: true })).toBe(Math.round(g.powerUp.stardust[23] * 1.2));
    expect(dustForNextPowerUp(g, 24, { lucky: true })).toBe(Math.round(g.powerUp.stardust[23] * 0.5));
    expect(dustForNextPowerUp(g, 50)).toBeNull();
    const b = baseOf(sp('medicham'));
    const ivs = { atk: 12, def: 13, hp: 14 };
    const cpm = cpmAt(g, 24);
    const dust = dustForNextPowerUp(g, 24)!;
    const r = inferIVs(g, { species: sp('medicham'), cp: calcCP(b, ivs, cpm), hp: calcHP(b, ivs, cpm), powerUpDust: dust });
    expect(r.levels.every((l) => dustForNextPowerUp(g, l) === dust)).toBe(true);
    expect(r.candidates.some((c) => c.ivs.atk === 12 && c.ivs.def === 13 && c.ivs.hp === 14)).toBe(true);
  });
  it('piso de IV del origen descarta candidatos (huevo ≥10)', () => {
    const b = baseOf(sp('medicham'));
    const ivs = { atk: 12, def: 13, hp: 14 };
    const cpm = cpmAt(ctx.game, 20);
    const input = { species: sp('medicham'), cp: calcCP(b, ivs, cpm), hp: calcHP(b, ivs, cpm), level: 20 };
    const libre = inferIVs(ctx.game, input);
    const huevo = inferIVs(ctx.game, { ...input, origin: 'egg' });
    expect(huevo.candidates.length).toBeLessThanOrEqual(libre.candidates.length);
    expect(huevo.candidates.every((c) => Math.min(c.ivs.atk, c.ivs.def, c.ivs.hp) >= 10)).toBe(true);
  });
  it('nivel 51 solo existe con Mejor Amigo', () => {
    const b = baseOf(sp('medicham'));
    const ivs = { atk: 15, def: 15, hp: 15 };
    const cpm = cpmAt(ctx.game, 51);
    const input = { species: sp('medicham'), cp: calcCP(b, ivs, cpm), hp: calcHP(b, ivs, cpm) };
    expect(inferIVs(ctx.game, input).candidates.some((c) => c.level === 51)).toBe(false);
    const buddy = inferIVs(ctx.game, { ...input, flags: { bestBuddy: true }, appraisal: { overall: 4, bestStats: ['atk', 'def', 'hp'], bestStatTier: 4 } });
    expect(buddy.candidates.map((c) => c.level)).toContain(51);
  });
  it('lectura imposible = inconsistente (lectura dudosa)', () => {
    const r = inferIVs(ctx.game, { species: sp('medicham'), cp: 99999, hp: 5 });
    expect(r.inconsistent).toBe(true);
    expect(r.candidates).toEqual([]);
  });
  it('valoración: matchesAppraisal y appraisalOf son inversas', () => {
    const ivs = { atk: 15, def: 10, hp: 3 };
    const a = appraisalOf(ivs);
    expect(a).toMatchObject({ overall: 2, bestStats: ['atk'], bestStatTier: 4 });
    expect(a.bars).toEqual({ atk: 3, def: 1, hp: 0 });
    expect(matchesAppraisal(ivs, a)).toBe(true);
    expect(matchesAppraisal({ atk: 14, def: 10, hp: 3 }, a)).toBe(false);
  });
  it('un Pokémon de CP mínimo (CP 10) se infiere sin romperse', () => {
    const r = inferIVs(ctx.game, { species: { atk: 10, def: 10, hp: 10 }, cp: 10, hp: 10, level: 1 });
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe('powerUpCost', () => {
  it('40→50 cuesta 250 000 de polvo y 296 caramelos XL (tablas conocidas)', () => {
    const c = powerUpCost(ctx.game, 40, 50);
    expect(c.stardust).toBe(250000);
    expect(c.xlCandy).toBe(296);
    expect(c.candy).toBe(0);
  });
  it('1→40 cuesta 270 000 de polvo', () => {
    const c = powerUpCost(ctx.game, 1, 40);
    expect(c.stardust).toBe(270000);
    expect(c.xlCandy).toBe(0);
    expect(c.candy).toBeGreaterThan(200);
  });
  it('sombra ×1.2, purificado ×0.9, suerte ×0.5 (solo polvo)', () => {
    const n = powerUpCost(ctx.game, 30, 40);
    const s = powerUpCost(ctx.game, 30, 40, { shadow: true });
    const p = powerUpCost(ctx.game, 30, 40, { purified: true });
    const l = powerUpCost(ctx.game, 30, 40, { lucky: true });
    expect(s.stardust).toBeCloseTo(n.stardust * 1.2, -2);
    expect(p.stardust).toBeCloseTo(n.stardust * 0.9, -2);
    expect(l.stardust).toBe(n.stardust / 2);
    expect(l.candy).toBe(n.candy);
    expect(s.candy).toBeGreaterThan(n.candy);
  });
  it('no deja pasar de 50 y marca nivel de cuenta insuficiente', () => {
    expect(() => powerUpCost(ctx.game, 40, 51)).toThrow();
    expect(powerUpCost(ctx.game, 20, 35, {}, 20).exceedsAccount).toBe(true);
    expect(powerUpCost(ctx.game, 20, 30, {}, 20).exceedsAccount).toBe(false);
  });
  it('costo de evolución, 2.º ataque e inventario', () => {
    expect(evolutionCost(ctx, 'meditite', 'medicham')!.candy).toBe(sp('meditite').family.evolutions[0].candy);
    expect(sp('meditite').family.evolutions[0].candy).toBeGreaterThan(0);
    expect(secondMoveCost(sp('medicham'))).toEqual({ stardust: 50000, candy: 50 });
    const needs = { stardust: 1000, candy: 10, xlCandy: 0, eliteFastTm: 0, eliteChargedTm: 1 };
    expect(affordability(needs, undefined, null).known).toBe(false);
    const a = affordability(needs, { stardust: 400, candy: { FAMILY_MEDITITE: 20 }, eliteChargedTm: 0 }, 'FAMILY_MEDITITE');
    expect(a.ok).toBe(false);
    expect(a.missing).toMatchObject({ stardust: 600, candy: 0, eliteChargedTm: 1 });
  });
});

describe('evolución y ligas', () => {
  it('línea evolutiva: previas, actual y evoluciones (sin hermanos)', () => {
    const l = evolutionLine(ctx, 'medicham');
    expect(l.ancestors).toEqual(['meditite']);
    expect(l.descendants).toEqual([]);
    const m = evolutionLine(ctx, 'meditite');
    expect(m.descendants).toEqual(['medicham']);
    const v = evolutionLine(ctx, 'vaporeon');
    expect(v.ancestors).toEqual(['eevee']);
    expect(v.descendants).not.toContain('jolteon');
  });
  it('evaluateForLeague evalúa cada etapa y respeta el tope de CP', () => {
    const ev = evaluateForLeague(ctx, 'meditite', { atk: 6, def: 14, hp: 15 }, { key: 'all-1500', cpCap: 1500 });
    expect(ev.map((e) => e.relation)).toEqual(['actual', 'evolución']);
    for (const e of ev) {
      expect(e.cp).toBeLessThanOrEqual(1500);
      expect(e.ivRank).toBeGreaterThanOrEqual(1);
      expect(e.percentOfBest).toBeLessThanOrEqual(100);
    }
    const medicham = ev.find((e) => e.stageId === 'medicham')!;
    expect(medicham.rankingPos).not.toBeNull();
  });
  it('el rank 1 tiene 100 % y el nivel máximo respeta el tope de cuenta', () => {
    const sps = sp('medicham');
    const combos = leagueCombos(sps, 1500, 50, ctx.game);
    expect(combos).toHaveLength(4096);
    const ev = evaluateForLeague(ctx, 'medicham', combos[0].ivs, { key: 'all-1500', cpCap: 1500 })[1];
    expect(ev.ivRank).toBe(1);
    expect(ev.percentOfBest).toBe(100);
    const lim = evaluateForLeague(ctx, 'medicham', combos[0].ivs, { key: 'all-1500', cpCap: 1500 }, { playerLevel: 20 })[1];
    expect(lim.level).toBeLessThanOrEqual(30);
  });
  it('sombra usa la entrada _shadow del ranking', () => {
    const ev = evaluateForLeague(ctx, 'vulpix', { atk: 1, def: 15, hp: 15 }, { key: 'all-1500', cpCap: 1500 }, { shadow: true });
    expect(ev.every((e) => e.stageId.endsWith('_shadow'))).toBe(true);
  });
  it('bestLevelUnderCap devuelve null si ni el nivel 1 cabe', () => {
    expect(bestLevelUnderCap({ atk: 500, def: 500, hp: 500 }, { atk: 15, def: 15, hp: 15 }, 10, 50, ctx.game)).toBeNull();
  });
  it('Maestra: el nivel 50 de un hundo entra; con Mejor Amigo llega a 51', () => {
    const ev = evaluateForLeague(ctx, 'mewtwo', { atk: 15, def: 15, hp: 15 }, { key: 'all-10000', cpCap: 10000 }, { bestBuddy: true })[0];
    expect(ev.level).toBe(51);
    const ev2 = evaluateForLeague(ctx, 'mewtwo', { atk: 15, def: 15, hp: 15 }, { key: 'all-10000', cpCap: 10000 })[0];
    expect(ev2.level).toBe(50);
  });
});

describe('movesets y plan', () => {
  it('Opción A (ranking, puede ser legacy) y B (sin élite)', () => {
    const entry = ctx.rankings['all-1500']!.entries.find((e) => e.id === 'medicham')!;
    const rec = recommendMoveset(sp('medicham'), entry, { fast: 'PSYCHO_CUT', charged: ['ICE_PUNCH'] });
    expect(rec.a.fast).toBe(entry.moveset[0]);
    expect(rec.a.needs.length).toBe(3);
    if (rec.b) {
      expect(rec.b.usesElite).toBe(false);
      expect(rec.a.usesElite).toBe(true);
    }
    // Con solo un ataque cargado, el segundo requiere desbloquear la ranura
    expect(rec.a.needs.filter((n) => n.status === 'second_move').length + rec.a.needs.filter((n) => n.status === 'elite_tm' && n.kind === 'charged').length).toBeGreaterThan(0);
  });
  it('detecta "ya los tiene"', () => {
    const entry = ctx.rankings['all-1500']!.entries.find((e) => e.id === 'medicham')!;
    const [f, c1, c2] = entry.moveset;
    const rec = recommendMoveset(sp('medicham'), entry, { fast: f, charged: [c1, c2] });
    expect(rec.a.needs.every((n) => n.status === 'have')).toBe(true);
  });
  it('planUpgrade suma mejora + evolución + 2.º ataque y compara con inventario', () => {
    const plan = planUpgrade(ctx, {
      fromSpeciesId: 'meditite', toSpeciesId: 'medicham', fromLevel: 20, toLevel: 30, mods: {},
      moveset: { fast: 'COUNTER', charged: ['X', 'Y'], usesElite: false, needs: [], totals: { eliteFastTm: 0, eliteChargedTm: 1, tm: 1, secondMove: true } },
      inventory: { stardust: 10000, candy: { FAMILY_MEDITITE: 5 } },
    });
    expect(plan.powerUp!.stardust).toBeGreaterThan(0);
    expect(plan.evolution!.candy).toBe(sp('meditite').family.evolutions[0].candy);
    expect(plan.secondMove).toEqual({ stardust: 50000, candy: 50 });
    expect(plan.needs.stardust).toBe(plan.powerUp!.stardust + 50000);
    expect(plan.afford.ok).toBe(false);
    expect(plan.afford.missing.eliteChargedTm).toBe(1);
  });
  it('no calcula evoluciones inexistentes ni niveles por debajo del actual', () => {
    const p = planUpgrade(ctx, { fromSpeciesId: 'medicham', toSpeciesId: 'meditite', fromLevel: 30, toLevel: 20, mods: {} });
    expect(p.powerUp).toBeNull();
    expect(p.notes.length).toBeGreaterThan(0);
  });
});
