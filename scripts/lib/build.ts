/**
 * Funciones puras que normalizan las fuentes (PvPoke, PokeMiners, PokeAPI) a nuestros esquemas.
 * Sin red ni disco: se prueban con fixtures en tests/fetch-data.test.ts.
 */
import {
  GameDataSchema, SpeciesSchema, MoveSchema,
  type GameData, type Species, type Move, type Evolution, type RankingEntry, type Format,
} from '../../src/data/schemas';
import { GM_TYPE_ORDER } from '../../src/engine/constants';

type Json = any;
export interface GmTemplate { templateId: string; data?: Json; [k: string]: Json }

const tdata = (t: GmTemplate | undefined): Json => (t ? (t.data ?? t) : undefined);

export function indexTemplates(gm: GmTemplate[]): Map<string, GmTemplate> {
  const m = new Map<string, GmTemplate>();
  for (const t of gm) m.set(t.templateId, t);
  return m;
}

const lowerType = (s: string) => s.replace(/^POKEMON_TYPE_/, '').toLowerCase();

export function buildGame(gm: GmTemplate[], pvpokeBase: Json, warnings: string[]): GameData {
  const idx = indexTemplates(gm);
  const need = (id: string): Json => {
    const d = tdata(idx.get(id));
    if (!d) throw new Error(`Falta la plantilla ${id} en el Game Master`);
    return d;
  };
  const pl = need('PLAYER_LEVEL_SETTINGS').playerLevel;
  // La tabla se repite plana al final (tope): conservar hasta el primer valor repetido.
  const raw: number[] = pl.cpMultiplier;
  const cpmWhole: number[] = [];
  for (const v of raw) {
    if (cpmWhole.length && v <= cpmWhole[cpmWhole.length - 1]) break;
    cpmWhole.push(v);
  }
  const up = need('POKEMON_UPGRADE_SETTINGS').pokemonUpgrades;
  const lucky = need('LUCKY_POKEMON_SETTINGS').luckyPokemonSettings;
  const cs = need('COMBAT_SETTINGS').combatSettings;
  const wb = need('WEATHER_BONUS_SETTINGS').weatherBonusSettings;
  const byWeather: Record<string, string[]> = {};
  for (const t of gm) {
    if (!t.templateId.startsWith('WEATHER_AFFINITY_')) continue;
    const w = tdata(t).weatherAffinities;
    byWeather[String(w.weatherCondition).toLowerCase()] = (w.pokemonType as string[]).map(lowerType);
  }
  const friendship: { level: number; attackBonus: number }[] = [];
  for (let l = 0; l <= 4; l++) {
    const f = tdata(idx.get(`FRIENDSHIP_LEVEL_${l}`))?.friendshipMilestoneSettings;
    if (f) friendship.push({ level: l, attackBonus: f.attackBonusPercentage ?? 1 });
  }
  const typeChart: Record<string, number[]> = {};
  for (const t of gm) {
    if (!/^POKEMON_TYPE_[A-Z]+$/.test(t.templateId)) continue;
    const te = tdata(t).typeEffective;
    if (te) typeChart[lowerType(te.attackType)] = te.attackScalar;
  }
  const leagues: GameData['leagues'] = [];
  for (const [tid, id, title] of [
    ['COMBAT_LEAGUE_DEFAULT_GREAT', 'great', 'Super Liga'],
    ['COMBAT_LEAGUE_DEFAULT_ULTRA', 'ultra', 'Ultra Liga'],
    ['COMBAT_LEAGUE_DEFAULT_MASTER', 'master', 'Liga Master'],
  ] as const) {
    const cl = tdata(idx.get(tid))?.combatLeague;
    const cap = cl?.pokemonCondition?.find((c: Json) => c.withPokemonCpLimit)?.withPokemonCpLimit?.maxCp;
    if (cap) leagues.push({ id, cpCap: cap, title });
  }
  const sim = pvpokeBase.settings ?? {};
  return GameDataSchema.parse({
    cpmWhole,
    powerUp: {
      candy: up.candyCost,
      stardust: up.stardustCost,
      xlCandy: up.xlCandyCost,
      upgradesPerLevel: up.upgradesPerLevel,
      maxNormalUpgradeLevel: up.maxNormalUpgradeLevel,
      allowedLevelsAbovePlayer: up.allowedLevelsAbovePlayer,
      xlCandyMinPlayerLevel: up.xlCandyMinPlayerLevel,
      xlCandyMinPokemonLevel: up.xlCandyMinPokemonLevel,
      defaultCpBoostAdditionalLevel: up.defaultCpBoostAdditionalLevel,
      shadowStardustMultiplier: up.shadowStardustMultiplier,
      shadowCandyMultiplier: up.shadowCandyMultiplier,
      purifiedStardustMultiplier: up.purifiedStardustMultiplier,
      purifiedCandyMultiplier: up.purifiedCandyMultiplier,
      luckyStardustMultiplier: lucky.powerUpStardustDiscountPercent,
    },
    combat: {
      shadowAttackMultiplier: cs.shadowPokemonAttackBonusMultiplier,
      shadowDefenseMultiplier: cs.shadowPokemonDefenseBonusMultiplier,
      stab: cs.sameTypeAttackBonusMultiplier,
      fastAttackBonus: cs.fastAttackBonusMultiplier,
      chargeAttackBonus: cs.chargeAttackBonusMultiplier,
    },
    weather: {
      attackBonus: wb.attackBonusMultiplier,
      guaranteedIvs: wb.guaranteedIndividualValues,
      raidGuaranteedIvs: wb.raidEncounterGuaranteedIndividualValues,
      cpBaseLevelBonus: wb.cpBaseLevelBonus,
      raidCpBaseLevelBonus: wb.raidEncounterCpBaseLevelBonus,
      byWeather,
    },
    friendship,
    typeOrder: [...GM_TYPE_ORDER],
    typeChart,
    leagues,
    simulator: {
      partySize: sim.partySize ?? 3,
      maxBuffStages: sim.maxBuffStages ?? 4,
      buffDivisor: sim.buffDivisor ?? 4,
    },
  });
}

/** Verifica la matriz de tipos con casos conocidos; devuelve avisos si no concuerda. */
export function checkTypeChart(game: GameData, warnings: string[]): void {
  const at = (a: string, d: string) => game.typeChart[a]?.[GM_TYPE_ORDER.indexOf(d as never)];
  const checks: [string, string, number][] = [
    ['fire', 'grass', 1.6], ['water', 'fire', 1.6], ['normal', 'ghost', 0.390625],
    ['electric', 'ground', 0.390625], ['fire', 'water', 0.625], ['fairy', 'dragon', 1.6], ['dragon', 'fairy', 0.390625],
  ];
  for (const [a, d, v] of checks) {
    const got = at(a, d);
    if (got === undefined || Math.abs(got - v) > 1e-6) warnings.push(`Matriz de tipos: ${a}→${d} = ${got}, se esperaba ${v}`);
  }
}

// ---------- Especies ----------

const REGION_ALIASES: [RegExp, string][] = [
  [/alolan/g, 'alola'], [/galarian/g, 'galar'], [/hisuian/g, 'hisui'], [/paldean/g, 'paldea'],
];
export const squash = (s: string): string => {
  let x = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [re, to] of REGION_ALIASES) x = x.replace(re, to);
  return x;
};
const stripNormal = (k: string) => (k.endsWith('normal') && k.length > 6 ? k.slice(0, -6) : k);

interface Tpl { pokemonId: string; form?: string; s: Json }

export function indexPokemonTemplates(gm: GmTemplate[]): Map<string, Tpl> {
  const m = new Map<string, Tpl>();
  const formless = new Map<string, Tpl>();
  for (const t of gm) {
    if (!/^V\d{4}_POKEMON_/.test(t.templateId)) continue;
    const s = tdata(t)?.pokemonSettings;
    if (!s) continue;
    const tpl: Tpl = { pokemonId: s.pokemonId, form: s.form, s };
    const key = stripNormal(squash(s.form ?? s.pokemonId));
    // Preferir la plantilla con forma explícita (_NORMAL) si hay dos para la misma clave.
    if (!m.has(key) || s.form) m.set(key, tpl);
    if (!s.form) formless.set(squash(s.pokemonId), tpl);
  }
  for (const [k, v] of formless) if (!m.has(k)) m.set(k, v);
  return m;
}

function findTemplate(index: Map<string, Tpl>, speciesId: string): Tpl | undefined {
  const base = speciesId.replace(/_shadow$/, '');
  return index.get(stripNormal(squash(base)));
}

const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

function evoNotes(b: Json): string | null {
  const n: string[] = [];
  if (b.onlyDaytime) n.push('de día');
  if (b.onlyNighttime) n.push('de noche');
  if (b.mustBeBuddy) n.push('como compañero');
  if (b.genderRequirement) n.push(`género ${String(b.genderRequirement).toLowerCase()}`);
  if (b.questDisplay?.length) n.push('requiere misión');
  if (b.lureItemRequirement) n.push('con módulo señuelo');
  return n.length ? n.join(', ') : null;
}

export interface SpeciesBuildResult { species: Species[]; unmatched: number; statMismatch: number }

export function buildSpecies(pvpokeList: Json[], gm: GmTemplate[], warnings: string[]): SpeciesBuildResult {
  const tpls = indexPokemonTemplates(gm);
  const byId = new Map<string, Json>(pvpokeList.map((p) => [p.speciesId, p]));
  let unmatched = 0;
  let statMismatch = 0;
  const mismatchSamples: string[] = [];
  const out: Species[] = [];
  for (const p of pvpokeList) {
    const shadow = p.speciesId.endsWith('_shadow') || (p.tags ?? []).includes('shadow');
    const baseId = p.speciesId.replace(/_shadow$/, '');
    const isTempEvo = (p.tags ?? []).some((t: string) => t === 'mega' || t === 'primal');
    const tpl = isTempEvo ? undefined : findTemplate(tpls, p.speciesId);
    if (!tpl && !isTempEvo && p.released) unmatched++;
    let { atk, def, hp } = { atk: p.baseStats.atk, def: p.baseStats.def, hp: p.baseStats.hp };
    if (tpl?.s.stats) {
      const g = { atk: tpl.s.stats.baseAttack, def: tpl.s.stats.baseDefense, hp: tpl.s.stats.baseStamina };
      if (g.atk !== atk || g.def !== def || g.hp !== hp) {
        statMismatch++;
        if (mismatchSamples.length < 8) mismatchSamples.push(`${p.speciesId} pvpoke ${atk}/${def}/${hp} vs GM ${g.atk}/${g.def}/${g.hp}`);
      }
      ({ atk, def, hp } = g); // el Game Master del juego manda
    }
    const elite = new Set<string>([...(p.eliteMoves ?? []), ...(p.legacyMoves ?? [])]);
    if (tpl) {
      for (const m of tpl.s.eliteQuickMove ?? []) elite.add(String(m).replace(/_FAST$/, ''));
      for (const m of tpl.s.eliteCinematicMove ?? []) elite.add(String(m));
    }
    const gt = tpl?.s.thirdMove;
    const sd = gt?.stardustToUnlock ?? p.thirdMoveCost;
    const third = typeof sd === "number" ? { stardust: sd, candy: typeof gt?.candyToUnlock === "number" ? gt.candyToUnlock : null } : null;
    const evolutions: Evolution[] = [];
    for (const toId of (p.family?.evolutions ?? []) as string[]) {
      const target = byId.get(toId);
      const tgtTpl = findTemplate(tpls, toId);
      let branch: Json | undefined;
      if (tpl?.s.evolutionBranch) {
        const toKey = stripNormal(squash(toId.replace(/_shadow$/, '')));
        branch = (tpl.s.evolutionBranch as Json[]).find(
          (b) => b.evolution && stripNormal(squash(b.form ?? b.evolution)) === toKey,
        );
        if (!branch && tgtTpl) branch = (tpl.s.evolutionBranch as Json[]).find((b) => b.evolution === tgtTpl.pokemonId);
      }
      if (!target) continue;
      evolutions.push({
        to: toId,
        candy: branch?.candyCost ?? null,
        candyPurified: branch?.candyCostPurified ?? null,
        item: strOrNull(branch?.evolutionItemRequirement) ?? strOrNull(branch?.lureItemRequirement),
        buddyKm: branch?.kmBuddyDistanceRequirement ?? null,
        notes: branch ? evoNotes(branch) : null,
      });
    }
    out.push(
      SpeciesSchema.parse({
        id: p.speciesId,
        dex: p.dex,
        name: p.speciesName,
        baseId,
        shadow,
        shadowEligible: (p.tags ?? []).includes('shadoweligible') || !!tpl?.s.shadow,
        types: (p.types as string[]).filter((t) => t !== 'none'),
        atk, def, hp,
        fast: p.fastMoves ?? [],
        charged: [...(p.chargedMoves ?? []), ...(p.extraChargedMoves ?? [])],
        elite: [...elite],
        thirdMove: third,
        family: { id: p.family?.id ?? null, parent: p.family?.parent ?? null, evolutions },
        tags: p.tags ?? [],
        released: p.released !== false,
        levelFloor: p.levelFloor,
        buddyKm: p.buddyDistance ?? tpl?.s.kmBuddyDistance ?? null,
      }),
    );
  }
  if (statMismatch) warnings.push(`Stats base: ${statMismatch} especies difieren entre PvPoke y el Game Master (se usa el Game Master). Ej.: ${mismatchSamples.join('; ')}`);
  if (unmatched) warnings.push(`${unmatched} especies liberadas de PvPoke sin plantilla en el Game Master (se usan datos de PvPoke).`);
  return { species: out, unmatched, statMismatch };
}

// ---------- Ataques ----------

export function buildMoves(pvpokeMoves: Json[], gm: GmTemplate[]): Move[] {
  const pve = new Map<string, Json>();
  for (const t of gm) {
    if (!/^V\d{4}_MOVE_/.test(t.templateId)) continue;
    const s = tdata(t)?.moveSettings;
    if (s?.movementId) pve.set(String(s.movementId), s);
  }
  return pvpokeMoves.map((m) => {
    const p = pve.get(m.moveId) ?? pve.get(`${m.moveId}_FAST`);
    return MoveSchema.parse({
      id: m.moveId,
      name: m.name,
      type: m.type,
      power: m.power ?? 0,
      energy: m.energy ?? 0,
      energyGain: m.energyGain ?? 0,
      cooldown: m.cooldown ?? 0,
      turns: m.turns,
      buffs: m.buffs,
      buffTarget: m.buffTarget,
      buffApplyChance: m.buffApplyChance !== undefined ? String(m.buffApplyChance) : undefined,
      archetype: m.archetype,
      pve: p
        ? { power: p.power ?? 0, durationMs: p.durationMs ?? 0, energy: p.energyDelta ?? 0, windowStartMs: p.damageWindowStartMs }
        : undefined,
    });
  });
}

// ---------- Rankings ----------

export function compactRanking(raw: Json[], topDetail = 100): RankingEntry[] {
  return raw.map((r, i) => {
    const fastUse = (r.moves?.fastMoves ?? []).slice(0, 4).map((m: Json) => m.moveId);
    const chargedUse = (r.moves?.chargedMoves ?? []).slice(0, 6).map((m: Json) => m.moveId);
    const e: RankingEntry = {
      id: r.speciesId,
      rating: r.rating,
      score: r.score,
      moveset: r.moveset,
      product: r.stats.product,
      atk: r.stats.atk,
      def: r.stats.def,
      hp: r.stats.hp,
      fastUse,
      chargedUse,
    };
    if (i < topDetail) {
      e.matchups = (r.matchups ?? []).map((m: Json) => ({ id: m.opponent, rating: m.rating }));
      e.counters = (r.counters ?? []).map((m: Json) => ({ id: m.opponent, rating: m.rating }));
    }
    return e;
  });
}

export function planFormats(formats: Json[]): { cup: string; cp: number; title: string; meta?: string; rules?: string[]; hide?: boolean }[] {
  const seen = new Set<string>();
  const out: ReturnType<typeof planFormats> = [];
  const add = (cup: string, cp: number, title: string, f?: Json) => {
    const key = `${cup}-${cp}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cup, cp, title, meta: f?.meta, rules: f?.rules, hide: f?.hideRankings });
  };
  add('all', 1500, 'Super Liga');
  add('all', 2500, 'Ultra Liga');
  add('all', 10000, 'Liga Máster');
  add('all', 500, 'Liga Little (todos)');
  for (const f of formats) add(f.cup, f.cp, f.title, f);
  return out;
}

export function buildFormat(p: ReturnType<typeof planFormats>[number], hasRanking: boolean): Format {
  return {
    title: p.title, cup: p.cup, cp: p.cp, meta: p.meta, rules: p.rules, hideRankings: p.hide,
    rankingKey: hasRanking ? `${p.cup}-${p.cp}` : null,
  };
}

// ---------- Nombres (PokeAPI CSV) ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const ES = '7';
export function buildNames(speciesCsv: string, movesCsv: string, moveNamesCsv: string, pvpokeMoves: Json[]) {
  const species: Record<string, string> = {};
  for (const [id, lang, name] of parseCsv(speciesCsv).slice(1)) if (lang === ES && name) species[id] = name;
  const ident = new Map<string, string>();
  for (const r of parseCsv(movesCsv).slice(1)) ident.set(r[0], r[1]);
  const byIdent = new Map<string, string>();
  for (const [id, lang, name] of parseCsv(moveNamesCsv).slice(1)) if (lang === ES && name && ident.has(id)) byIdent.set(ident.get(id)!, name);
  const moves: Record<string, string> = {};
  for (const m of pvpokeMoves) {
    const key = String(m.moveId).toLowerCase().replace(/_/g, '-');
    const es = byIdent.get(key) ?? byIdent.get(key.replace(/-fast$/, ''));
    if (es) moves[m.moveId] = es;
  }
  return { species, moves };
}
