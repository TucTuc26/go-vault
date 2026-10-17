import type { GameData, Move, Species } from '../data/schemas';
import type { SavedPokemon } from '../db/types';
import { DAMAGE_BONUS, DAMAGE_HALF, RAID_BOSS_IV, RAID_TIERS, type RaidTierKey } from '../engine/constants';
import { effectiveMaxLevel } from '../engine/levels';
import { evolutionLine, stageIdFor } from '../engine/line';
import { gymScore } from '../engine/population';
import { ivSetsOfRecord } from '../engine/reevaluate';
import { cpmAt } from '../engine/stats';
import type { EngineCtx, IVs } from '../engine/types';

/** Interruptores de la estimación de incursión. */
export interface RaidOptions {
  tier: RaidTierKey;
  /** Clima activo (clave de `game.weather.byWeather`) o null. */
  weather: string | null;
  /** 0–4 (sin amistad … mejores amigos); usa los bonos del Game Master. */
  friendship: number;
  /** Tipo del mega activo (da el bono de mismo tipo o de otro tipo del Game Master) o null. */
  megaType: string | null;
  /** Party Play: sin efecto en el daño según el Game Master (se muestra solo como aviso). */
  party: boolean;
  /** Nivel de los atacantes: el máximo de la cuenta o el actual del registro. */
  levelMode: 'max' | 'current';
  playerLevel?: number;
  /** Bonos del GM para el mega (MEGA_EVO_SETTINGS); se pasan desde los datos de la app. */
  megaBoost: { sameType: number; otherType: number };
}

export interface RaidAttacker {
  record: SavedPokemon;
  stageId: string;
  shadow: boolean;
  level: number;
  fast: string;
  charged: string;
  dps: number;
  tdo: number;
  score: number;
  /** Siempre true: estimación propia, no un dato oficial. */
  estimate: true;
  weakToBoss: boolean;
  needsEvolution: boolean;
}

type RaidEnv = EngineCtx & { movesById: Map<string, Move> };

const chartAt = (game: GameData, atk: string, def: string[]) => def.reduce((e, d) => (d === 'none' ? e : e * game.typeChart[atk][game.typeOrder.indexOf(d)]), 1);

export function friendshipBonus(game: GameData, level: number): number {
  return game.friendship.find((f) => f.level === level)?.attackBonus ?? 1;
}

interface Boss { species: Species; atk: number; def: number; hp: number; fast: Move; charged: Move }

/** Mejor par de ataques del jefe (por poder PvE × STAB / duración), sin ataques élite. */
export function bossProfile(env: RaidEnv, bossId: string, tier: RaidTierKey): Boss | null {
  const sp = env.speciesById.get(bossId);
  if (!sp) return null;
  const cpm = RAID_TIERS[tier].cpm;
  const pool = (ids: string[]) => ids.map((i) => env.movesById.get(i)).filter((m): m is Move => !!m && !!m.pve && !sp.elite.includes(m.id));
  const fasts = pool(sp.fast).filter((m) => (m.pve?.energy ?? 0) > 0);
  const chargeds = pool(sp.charged).filter((m) => (m.pve?.energy ?? 0) < 0);
  if (!fasts.length || !chargeds.length) return null;
  const val = (m: Move) => (m.pve!.power * (sp.types.includes(m.type) ? env.game.combat.stab : 1)) / (m.pve!.durationMs || 1);
  const fast = [...fasts].sort((a, b) => val(b) - val(a))[0];
  const charged = [...chargeds].sort((a, b) => val(b) - val(a))[0];
  return { species: sp, atk: (sp.atk + RAID_BOSS_IV) * cpm, def: (sp.def + RAID_BOSS_IV) * cpm, hp: RAID_TIERS[tier].hp, fast, charged };
}

/** DPS de un ciclo (n ataques rápidos + 1 cargado). */
function cycle(fastDmg: number, fastMs: number, fastEnergy: number, chargedDmg: number, chargedMs: number, chargedCost: number): number {
  const n = Math.ceil(chargedCost / fastEnergy);
  return (n * fastDmg + chargedDmg) / ((n * fastMs + chargedMs) / 1000);
}

/**
 * ESTIMACIÓN (no oficial) de los mejores atacantes de la colección contra un jefe: DPS del ciclo con efectividad, STAB, clima,
 * amistad y mega; TDO = DPS × tiempo que sobrevive al DPS entrante del jefe; puntaje = DPS^0.75 · TDO^0.25.
 */
export function rankRaidAttackers(env: RaidEnv, collection: SavedPokemon[], bossId: string, opts: RaidOptions, top = 6): RaidAttacker[] {
  const boss = bossProfile(env, bossId, opts.tier);
  if (!boss) return [];
  const g = env.game;
  const weatherTypes = opts.weather ? g.weather.byWeather[opts.weather] ?? [] : [];
  const friend = friendshipBonus(g, opts.friendship);
  const results: RaidAttacker[] = [];

  for (const rec of collection) {
    const sets = ivSetsOfRecord(rec);
    const ivs: IVs | null = rec.ivs ?? (sets.length ? sets[Math.floor(sets.length / 2)] : null);
    if (!ivs) continue;
    const line = evolutionLine(env, rec.speciesId);
    const maxLevel = effectiveMaxLevel(g, opts.playerLevel, rec.flags.bestBuddy);
    for (const baseId of [line.self, ...line.descendants]) {
      const stageId = stageIdFor(env, baseId, !!rec.flags.shadow);
      const sp = env.speciesById.get(stageId);
      if (!sp || sp.family.evolutions.length || sp.formChange) continue;
      const level = opts.levelMode === 'current' && baseId === line.self ? Math.min(rec.level ?? maxLevel, maxLevel) : maxLevel;
      const cpm = cpmAt(g, level);
      const shadow = sp.shadow;
      const atk = (sp.atk + ivs.atk) * cpm * (shadow ? g.combat.shadowAttackMultiplier : 1);
      const def = (sp.def + ivs.def) * cpm * (shadow ? g.combat.shadowDefenseMultiplier : 1);
      const hp = Math.max(10, Math.floor((sp.hp + ivs.hp) * cpm));
      const mult = (m: Move): number => {
        let x = sp.types.includes(m.type) ? g.combat.stab : 1;
        x *= chartAt(g, m.type, boss.species.types);
        if (weatherTypes.includes(m.type)) x *= g.weather.attackBonus;
        x *= friend;
        if (opts.megaType) x *= sp.types.includes(opts.megaType) ? opts.megaBoost.sameType : opts.megaBoost.otherType;
        return x;
      };
      const dmg = (m: Move) => Math.floor(DAMAGE_HALF * m.pve!.power * (atk / boss.def) * mult(m)) + DAMAGE_BONUS;
      const bossMult = (m: Move) => (boss.species.types.includes(m.type) ? g.combat.stab : 1) * chartAt(g, m.type, sp.types);
      const bossDmg = (m: Move) => Math.floor(DAMAGE_HALF * m.pve!.power * (boss.atk / def) * bossMult(m)) + DAMAGE_BONUS;
      const bossDps = cycle(bossDmg(boss.fast), boss.fast.pve!.durationMs, boss.fast.pve!.energy, bossDmg(boss.charged), boss.charged.pve!.durationMs, -boss.charged.pve!.energy);
      const ttl = hp / bossDps;
      let best: { dps: number; fast: Move; charged: Move } | null = null;
      for (const fid of sp.fast) {
        const f = env.movesById.get(fid);
        if (!f?.pve || f.pve.energy <= 0 || sp.elite.includes(fid)) continue;
        for (const cid of sp.charged) {
          const c = env.movesById.get(cid);
          if (!c?.pve || c.pve.energy >= 0 || sp.elite.includes(cid)) continue;
          const dps = cycle(dmg(f), f.pve.durationMs, f.pve.energy, dmg(c), c.pve.durationMs, -c.pve.energy);
          if (!best || dps > best.dps) best = { dps, fast: f, charged: c };
        }
      }
      if (!best) continue;
      const tdo = best.dps * ttl;
      results.push({
        record: rec, stageId, shadow, level, fast: best.fast.id, charged: best.charged.id,
        dps: best.dps, tdo, score: Math.pow(best.dps, 0.75) * Math.pow(tdo, 0.25), estimate: true,
        weakToBoss: [boss.fast.type, boss.charged.type].some((mt) => chartAt(g, mt, sp.types) > 1.5),
        needsEvolution: baseId !== line.self,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  // un mismo registro no ocupa dos lugares (se queda con su mejor etapa)
  const seen = new Set<number>();
  const out: RaidAttacker[] = [];
  for (const r of results) {
    const id = r.record.id ?? -1;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
    if (out.length >= top) break;
  }
  return out;
}

export interface GymDefender { record: SavedPokemon; stageId: string; score: number; shadow: boolean; level: number; needsEvolution: boolean }

/** Mejores defensores de gimnasio de la colección: DEF × PS al nivel alcanzable (con sombra), solo etapas finales. */
export function rankGymDefenders(env: EngineCtx, collection: SavedPokemon[], playerLevel: number | undefined, top = 6): GymDefender[] {
  const g = env.game;
  const out: GymDefender[] = [];
  for (const rec of collection) {
    const sets = ivSetsOfRecord(rec);
    const ivs: IVs | null = rec.ivs ?? (sets.length ? sets[Math.floor(sets.length / 2)] : null);
    if (!ivs) continue;
    const line = evolutionLine(env, rec.speciesId);
    const level = effectiveMaxLevel(g, playerLevel, rec.flags.bestBuddy);
    let best: GymDefender | null = null;
    for (const baseId of [line.self, ...line.descendants]) {
      const stageId = stageIdFor(env, baseId, !!rec.flags.shadow);
      const sp = env.speciesById.get(stageId);
      if (!sp || sp.family.evolutions.length) continue;
      const score = gymScore(sp, ivs, level, sp.shadow, g);
      if (!best || score > best.score) best = { record: rec, stageId, score, shadow: sp.shadow, level, needsEvolution: baseId !== line.self };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, top);
}
