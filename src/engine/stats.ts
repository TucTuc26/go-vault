import type { GameData, Species } from '../data/schemas';
import { CP_DIVISOR, IV_COUNT, LEVEL_STEP, MIN_CP, MIN_HP, halfLevelCpm } from './constants';
import type { IVs } from './types';

const cpmCache = new WeakMap<GameData, number[]>();

/** Tabla de cpm por medio nivel: índice i ↔ nivel 1 + i/2. */
export function cpmTable(game: GameData): number[] {
  let t = cpmCache.get(game);
  if (t) return t;
  t = [];
  const w = game.cpmWhole;
  // El juego guarda los cpm como float32: Math.fround reproduce exactamente los valores del cliente (y de PvPoke).
  for (let i = 0; i < w.length; i++) {
    t.push(Math.fround(w[i]));
    if (i + 1 < w.length) t.push(halfLevelCpm(Math.fround(w[i]), Math.fround(w[i + 1])));
  }
  cpmCache.set(game, t);
  return t;
}

/** Nivel más alto con cpm conocido. */
export function maxKnownLevel(game: GameData): number {
  return 1 + (cpmTable(game).length - 1) * LEVEL_STEP;
}

export function cpmAt(game: GameData, level: number): number {
  const t = cpmTable(game);
  const i = Math.round((level - 1) / LEVEL_STEP);
  if (i < 0 || i >= t.length || Math.abs((level - 1) / LEVEL_STEP - i) > 1e-9) throw new RangeError(`Nivel inválido: ${level}`);
  return t[i];
}

export interface BaseStats { atk: number; def: number; hp: number }

export const baseOf = (s: Pick<Species, 'atk' | 'def' | 'hp'>): BaseStats => ({ atk: s.atk, def: s.def, hp: s.hp });

/** CP = max(10, floor((atk+ivA)·√(def+ivD)·√(sta+ivS)·cpm²/10)). */
export function calcCP(base: BaseStats, ivs: IVs, cpm: number): number {
  const cp = Math.floor(((base.atk + ivs.atk) * Math.sqrt(base.def + ivs.def) * Math.sqrt(base.hp + ivs.hp) * cpm * cpm) / CP_DIVISOR);
  return Math.max(MIN_CP, cp);
}

/** HP = max(10, floor((sta+ivS)·cpm)). */
export function calcHP(base: BaseStats, ivs: IVs, cpm: number): number {
  return Math.max(MIN_HP, Math.floor((base.hp + ivs.hp) * cpm));
}

export interface PokemonStats {
  level: number;
  cpm: number;
  cp: number;
  hp: number;
  /** Stats de combate (atk·cpm, def·cpm), sin multiplicadores de sombra. */
  atk: number;
  def: number;
  /** atk·def·hp (como PvPoke). */
  product: number;
}

export function statsAt(base: BaseStats, ivs: IVs, level: number, game: GameData): PokemonStats {
  const cpm = cpmAt(game, level);
  const hp = calcHP(base, ivs, cpm);
  const atk = (base.atk + ivs.atk) * cpm;
  const def = (base.def + ivs.def) * cpm;
  return { level, cpm, cp: calcCP(base, ivs, cpm), hp, atk, def, product: hp * atk * def };
}

/** Stats de combate con multiplicadores de sombra de los datos. */
export function battleStats(s: PokemonStats, shadow: boolean, game: GameData) {
  return {
    atk: s.atk * (shadow ? game.combat.shadowAttackMultiplier : 1),
    def: s.def * (shadow ? game.combat.shadowDefenseMultiplier : 1),
    hp: s.hp,
  };
}

export const ivPercent = (ivs: IVs): number => ((ivs.atk + ivs.def + ivs.hp) / (3 * (IV_COUNT - 1))) * 100;

export function* allIVs(floor = 0): Generator<IVs> {
  // Mismo orden de generación que PvPoke: hp↓, def↓, atk↓ (determina el desempate del ranking).
  for (let hp = IV_COUNT - 1; hp >= floor; hp--)
    for (let def = IV_COUNT - 1; def >= floor; def--)
      for (let atk = IV_COUNT - 1; atk >= floor; atk--) yield { atk, def, hp };
}

/** Niveles posibles (de `from` a `to`, de 0.5 en 0.5). */
export function levelsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let l = from; l <= to + 1e-9; l += LEVEL_STEP) out.push(Math.round(l * 2) / 2);
  return out;
}
