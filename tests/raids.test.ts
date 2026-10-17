import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import { testCollection } from './records';
import { bossProfile, friendshipBonus, rankGymDefenders, rankRaidAttackers, type RaidOptions } from '../src/raids/raid';
import { RAID_TIERS } from '../src/engine/constants';
import { buildRecord } from '../src/db/record';
import type { SavedPokemon } from '../src/db/types';
import type { PokemonDraft } from '../src/providers/pipeline';
import type { EngineCtx } from '../src/engine/types';
import type { Move } from '../src/data/schemas';

let env: EngineCtx & { movesById: Map<string, Move> };
let dv = 'x';
let col: SavedPokemon[];
const baseOpts = (over: Partial<RaidOptions> = {}): RaidOptions => ({
  tier: 'tier5', weather: null, friendship: 0, megaType: null, party: false, levelMode: 'max', playerLevel: 40,
  megaBoost: { sameType: 1.3, otherType: 1.1 }, ...over,
});

beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  env = { ...ctx, movesById: bundle.movesById };
  dv = bundle.manifest.dataVersion;
  col = testCollection(ctx, dv, 40, 0, 'all-2500', 2500);
});

function rec(speciesId: string, ivs = { atk: 15, def: 15, hp: 15 }, level = 40, shadow = false): SavedPokemon {
  const sp = env.speciesById.get(speciesId)!;
  const draft = { speciesId: sp.baseId, speciesName: sp.name, nickname: null, cp: 1000, hp: 100, level, powerUpDust: null, ivs, ivsExact: true, candidates: [], ivPercentRange: null, appraisal: null, flags: { shadow }, origin: 'unknown', moves: { fast: null, charged: [] }, sourceId: null } as unknown as PokemonDraft;
  return { ...buildRecord({ draft, species: sp, roles: [], dataVersion: dv }), id: Math.floor(Math.random() * 1e9) };
}

describe('incursiones (estimación)', () => {
  it('jefe: perfil con ataques PvE y PS/CPM del nivel', () => {
    const b = bossProfile(env, 'mewtwo', 'tier5')!;
    expect(b.hp).toBe(RAID_TIERS.tier5.hp);
    expect(b.fast.pve).toBeDefined();
    expect(b.charged.pve!.energy).toBeLessThan(0);
    expect(bossProfile(env, 'inexistente', 'tier5')).toBeNull();
  });

  it('devuelve hasta 6 atacantes distintos, ordenados, etiquetados como estimación', () => {
    const r = rankRaidAttackers(env, col, 'mewtwo', baseOpts());
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(6);
    expect(new Set(r.map((x) => x.record.id)).size).toBe(r.length);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    for (const a of r) { expect(a.estimate).toBe(true); expect(a.dps).toBeGreaterThan(0); expect(a.tdo).toBeGreaterThan(0); }
  });

  it('los tipos con ventaja contra el jefe puntúan más (Mewtwo es psíquico → siniestro/bicho/fantasma)', () => {
    const c = [rec('tyranitar'), rec('machamp'), rec('chansey'), rec('blissey')];
    const r = rankRaidAttackers(env, c, 'mewtwo', baseOpts(), 4);
    const ty = r.find((x) => x.stageId.startsWith('tyranitar'))!;
    const ch = r.find((x) => x.stageId.startsWith('blissey'))!;
    expect(ty.score).toBeGreaterThan(ch.score);
  });

  it('interruptores: clima, amistad y mega aumentan el DPS; la sombra ataca más', () => {
    const c = [rec('machamp')];
    const base = rankRaidAttackers(env, c, 'mewtwo', baseOpts())[0];
    const friend = rankRaidAttackers(env, c, 'mewtwo', baseOpts({ friendship: 4 }))[0];
    expect(friendshipBonus(env.game, 4)).toBeGreaterThan(1);
    expect(friend.dps).toBeGreaterThan(base.dps);
    const weather = rankRaidAttackers(env, c, 'mewtwo', baseOpts({ weather: Object.keys(env.game.weather.byWeather).find((w) => env.game.weather.byWeather[w].includes('fighting')) ?? 'cloudy' }))[0];
    expect(weather.dps).toBeGreaterThan(base.dps);
    const mega = rankRaidAttackers(env, c, 'mewtwo', baseOpts({ megaType: 'fighting' }))[0];
    expect(mega.dps).toBeGreaterThan(friend.dps * 0.9);
    expect(mega.dps).toBeGreaterThan(base.dps);
    const sh = rankRaidAttackers(env, [rec('machamp', { atk: 15, def: 15, hp: 15 }, 40, true)], 'mewtwo', baseOpts())[0];
    expect(sh.shadow).toBe(true);
    expect(sh.dps).toBeGreaterThan(base.dps);
    expect(sh.tdo / sh.dps).toBeLessThan(base.tdo / base.dps); // más frágil
  });

  it('el nivel "actual" produce menos DPS que el máximo', () => {
    const c = [rec('machamp', { atk: 15, def: 15, hp: 15 }, 20)];
    const cur = rankRaidAttackers(env, c, 'mewtwo', baseOpts({ levelMode: 'current' }))[0];
    const max = rankRaidAttackers(env, c, 'mewtwo', baseOpts({ levelMode: 'max' }))[0];
    expect(max.dps).toBeGreaterThan(cur.dps);
  });

  it('marca las evoluciones necesarias y no usa etapas intermedias', () => {
    const r = rankRaidAttackers(env, [rec('machop')], 'mewtwo', baseOpts());
    expect(r[0].stageId).toBe('machamp');
    expect(r[0].needsEvolution).toBe(true);
  });
});

describe('defensores de gimnasio', () => {
  it('ordena por DEF×PS; sombra pesa menos; etapa final', () => {
    const c = [rec('blissey'), rec('pidgey'), rec('snorlax'), rec('chansey'), rec('blissey', { atk: 15, def: 15, hp: 15 }, 40, true)];
    const r = rankGymDefenders(env, c, 40, 3);
    expect(r).toHaveLength(3);
    expect(r[0].stageId.startsWith('blissey')).toBe(true);
    expect(r[0].shadow).toBe(false);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    expect(rankGymDefenders(env, [rec('chansey')], 40)[0].stageId).toBe('blissey'); // evoluciona
  });
});
