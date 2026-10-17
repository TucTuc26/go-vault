import { describe, it, expect } from 'vitest';
import { buildGame, buildSpecies, buildMoves, compactRanking, parseCsv, buildNames, squash, planFormats, checkTypeChart } from '../scripts/lib/build';
import { GM_TYPE_ORDER } from '../src/engine/constants';

const tpl = (templateId: string, data: any) => ({ templateId, data: { templateId, ...data } });
const chart = (a: string, over: Record<string, number>) =>
  tpl(`POKEMON_TYPE_${a.toUpperCase()}`, {
    typeEffective: { attackType: `POKEMON_TYPE_${a.toUpperCase()}`, attackScalar: GM_TYPE_ORDER.map((d) => over[d] ?? 1) },
  });

const cpm = [0.094, 0.16639787, ...Array.from({ length: 53 }, (_, i) => 0.2157 + 0.005 * i), 0.9, 0.9];
const gmFixture = [
  tpl('PLAYER_LEVEL_SETTINGS', { playerLevel: { cpMultiplier: cpm } }),
  tpl('POKEMON_UPGRADE_SETTINGS', { pokemonUpgrades: { upgradesPerLevel: 2, allowedLevelsAbovePlayer: 10, candyCost: [1, 1], stardustCost: [200, 200], xlCandyCost: [10], maxNormalUpgradeLevel: 50, xlCandyMinPlayerLevel: 31, xlCandyMinPokemonLevel: 40, shadowStardustMultiplier: 1.2, shadowCandyMultiplier: 1.2, purifiedStardustMultiplier: 0.9, purifiedCandyMultiplier: 0.9 } }),
  tpl('LUCKY_POKEMON_SETTINGS', { luckyPokemonSettings: { powerUpStardustDiscountPercent: 0.5 } }),
  tpl('COMBAT_SETTINGS', { combatSettings: { shadowPokemonAttackBonusMultiplier: 1.2, shadowPokemonDefenseBonusMultiplier: 0.8333333, sameTypeAttackBonusMultiplier: 1.2 } }),
  tpl('WEATHER_BONUS_SETTINGS', { weatherBonusSettings: { attackBonusMultiplier: 1.2, guaranteedIndividualValues: 4, raidEncounterGuaranteedIndividualValues: 10, cpBaseLevelBonus: 5, raidEncounterCpBaseLevelBonus: 5 } }),
  tpl('WEATHER_AFFINITY_CLEAR', { weatherAffinities: { weatherCondition: 'CLEAR', pokemonType: ['POKEMON_TYPE_FIRE'] } }),
  tpl('FRIENDSHIP_LEVEL_1', { friendshipMilestoneSettings: { attackBonusPercentage: 1.03 } }),
  tpl('COMBAT_LEAGUE_DEFAULT_GREAT', { combatLeague: { pokemonCondition: [{ withPokemonCpLimit: { maxCp: 1500 } }] } }),
  chart('fire', { grass: 1.6, water: 0.625 }),
  chart('normal', { ghost: 0.390625 }),
  chart('water', { fire: 1.6 }),
  chart('electric', { ground: 0.390625 }),
  chart('fairy', { dragon: 1.6 }),
  chart('dragon', { fairy: 0.390625 }),
  tpl('V0307_POKEMON_MEDITITE', { pokemonSettings: { pokemonId: 'MEDITITE', stats: { baseAttack: 78, baseDefense: 107, baseStamina: 102 }, evolutionBranch: [{ evolution: 'MEDICHAM', candyCost: 100, candyCostPurified: 90, form: 'MEDICHAM_NORMAL' }], thirdMove: { stardustToUnlock: 50000, candyToUnlock: 50 } } }),
  tpl('V0308_POKEMON_MEDICHAM', { pokemonSettings: { pokemonId: 'MEDICHAM', stats: { baseAttack: 121, baseDefense: 152, baseStamina: 155 }, eliteCinematicMove: ['POWER_UP_PUNCH'], thirdMove: { stardustToUnlock: 50000, candyToUnlock: 50 } } }),
  tpl('V0026_POKEMON_RAICHU_ALOLA', { pokemonSettings: { pokemonId: 'RAICHU', form: 'RAICHU_ALOLA', stats: { baseAttack: 201, baseDefense: 154, baseStamina: 155 } } }),
];
const pv = [
  { dex: 307, speciesName: 'Meditite', speciesId: 'meditite', baseStats: { atk: 78, def: 107, hp: 102 }, types: ['fighting', 'psychic'], fastMoves: ['CONFUSION'], chargedMoves: ['ICE_PUNCH'], thirdMoveCost: 50000, released: true, family: { id: 'FAMILY_MEDITITE', evolutions: ['medicham'] } },
  { dex: 308, speciesName: 'Medicham', speciesId: 'medicham', baseStats: { atk: 121, def: 152, hp: 150 }, types: ['fighting', 'psychic'], fastMoves: ['COUNTER'], chargedMoves: ['DYNAMIC_PUNCH'], eliteMoves: ['DYNAMIC_PUNCH'], thirdMoveCost: false, released: true, tags: ['shadoweligible'], family: { id: 'FAMILY_MEDITITE', parent: 'meditite' } },
  { dex: 308, speciesName: 'Medicham (Shadow)', speciesId: 'medicham_shadow', baseStats: { atk: 121, def: 152, hp: 155 }, types: ['fighting', 'none'], fastMoves: ['COUNTER'], chargedMoves: ['PSYCHIC'], tags: ['shadow'], released: true, family: { id: 'FAMILY_MEDITITE', parent: 'meditite_shadow' } },
  { dex: 26, speciesName: 'Raichu (Alolan)', speciesId: 'raichu_alolan', baseStats: { atk: 201, def: 154, hp: 155 }, types: ['electric', 'psychic'], fastMoves: [], chargedMoves: [], released: true, tags: ['alolan'], family: { id: 'FAMILY_PIKACHU', parent: 'pikachu', evolutions: [] } },
];

describe('fetch-data: normalización', () => {
  it('squash unifica nombres regionales', () => {
    expect(squash('raichu_alolan')).toBe(squash('RAICHU_ALOLA'));
    expect(squash('MR_MIME_GALARIAN')).toBe(squash('mr_mime_galarian'));
  });
  it('buildGame extrae cpm, costos y multiplicadores del Game Master', () => {
    const w: string[] = [];
    const g = buildGame(gmFixture as any, { settings: { partySize: 3 } }, w);
    expect(g.cpmWhole[0]).toBe(0.094);
    expect(g.cpmWhole.length).toBe(56);
    expect(g.powerUp.shadowStardustMultiplier).toBe(1.2);
    expect(g.powerUp.luckyStardustMultiplier).toBe(0.5);
    expect(g.combat.shadowDefenseMultiplier).toBeCloseTo(0.8333333);
    expect(g.weather.byWeather.clear).toEqual(['fire']);
    expect(g.leagues).toEqual([{ id: 'great', cpCap: 1500, title: 'Super Liga' }]);
    checkTypeChart(g, w);
    expect(w).toEqual([]);
  });
  it('buildSpecies usa el Game Master para stats, evoluciones y movimientos élite', () => {
    const w: string[] = [];
    const { species, statMismatch } = buildSpecies(pv as any, gmFixture as any, w);
    const meditite = species.find((s) => s.id === 'meditite')!;
    expect(meditite.family.evolutions[0]).toMatchObject({ to: 'medicham', candy: 100, candyPurified: 90 });
    expect(meditite.thirdMove).toEqual({ stardust: 50000, candy: 50 });
    const medicham = species.find((s) => s.id === 'medicham')!;
    expect(medicham.hp).toBe(155); // el GM corrige a PvPoke (150)
    expect(statMismatch).toBe(1);
    expect([...medicham.elite].sort()).toEqual(['DYNAMIC_PUNCH', 'POWER_UP_PUNCH']);
    expect(medicham.shadowEligible).toBe(true);
    const sh = species.find((s) => s.id === 'medicham_shadow')!;
    expect(sh.shadow).toBe(true);
    expect(sh.baseId).toBe('medicham');
    expect(sh.types).toEqual(['fighting']);
    expect(species.find((s) => s.id === 'raichu_alolan')!.atk).toBe(201);
  });
  it('compactRanking guarda matchups solo para los primeros N', () => {
    const raw = Array.from({ length: 3 }, (_, i) => ({
      speciesId: 'a' + i, rating: 700, score: 90, moveset: ['X', 'Y'], stats: { product: 1800, atk: 100, def: 100, hp: 100 },
      matchups: [{ opponent: 'b', rating: 600 }], counters: [], moves: { fastMoves: [{ moveId: 'X', uses: 1 }], chargedMoves: [] },
    }));
    const c = compactRanking(raw, 2);
    expect(c[0].matchups).toEqual([{ id: 'b', rating: 600 }]);
    expect(c[2].matchups).toBeUndefined();
    expect(c[0].fastUse).toEqual(['X']);
  });
  it('planFormats incluye las 4 ligas base sin duplicados', () => {
    const p = planFormats([{ cup: 'little', cp: 500, title: 'Little' }, { cup: 'little', cp: 500, title: 'Little 2' }]);
    expect(p.map((x) => `${x.cup}-${x.cp}`)).toEqual(['all-1500', 'all-2500', 'all-10000', 'all-500', 'little-500']);
  });
  it('parseCsv y buildNames respetan comillas y español (idioma 7)', () => {
    expect(parseCsv('a,"b,c",d\n1,2,3\n')).toEqual([['a', 'b,c', 'd'], ['1', '2', '3']]);
    const n = buildNames('pokemon_species_id,local_language_id,name,genus\n25,9,Pikachu,Mouse\n25,7,Pikachu,Ratón\n122,7,"Mr. Mime",x\n', 'id,identifier\n1,pound\n2,dragon-breath\n', 'move_id,local_language_id,name\n2,7,Dragoaliento\n2,9,Dragon Breath\n', [{ moveId: 'DRAGON_BREATH' }]);
    expect(n.species['122']).toBe('Mr. Mime');
    expect(n.moves.DRAGON_BREATH).toBe('Dragoaliento');
  });
  it('buildMoves adjunta datos PvE por movementId', () => {
    const m = buildMoves([{ moveId: 'WRAP', name: 'Wrap', type: 'normal', power: 70, energy: 45, energyGain: 0, cooldown: 500 }], [tpl('V0013_MOVE_WRAP', { moveSettings: { movementId: 'WRAP', power: 60, durationMs: 3000, energyDelta: -33 } })] as any);
    expect(m[0].pve).toMatchObject({ power: 60, durationMs: 3000, energy: -33 });
  });
});
