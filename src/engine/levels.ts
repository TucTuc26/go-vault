import type { GameData } from '../data/schemas';
import { IV_FLOOR_BY_ORIGIN, IV_MAX } from './constants';
import type { Origin, PokemonFlags } from './types';

/** Aumento de nivel por Mejor Amigo (GM: defaultCpBoostAdditionalLevel). */
export const buddyBoost = (game: GameData): number => game.powerUp.defaultCpBoostAdditionalLevel ?? 1;

/**
 * Nivel máximo al que una cuenta puede mejorar: min(nivel de cuenta + niveles permitidos sobre el jugador, tope normal).
 * Los datos salen de POKEMON_UPGRADE_SETTINGS (allowedLevelsAbovePlayer=10, maxNormalUpgradeLevel=50).
 * Sin nivel de cuenta se asume el tope normal.
 */
export function accountMaxLevel(game: GameData, playerLevel?: number): number {
  const cap = game.powerUp.maxNormalUpgradeLevel;
  if (!playerLevel) return cap;
  return Math.min(cap, playerLevel + game.powerUp.allowedLevelsAbovePlayer);
}

/** Nivel mostrado/efectivo máximo (con +1 de Mejor Amigo si aplica). */
export function effectiveMaxLevel(game: GameData, playerLevel?: number, bestBuddy = false): number {
  return accountMaxLevel(game, playerLevel) + (bestBuddy ? buddyBoost(game) : 0);
}

/** Nivel "real" (el de las mejoras) a partir del mostrado. */
export const realLevel = (game: GameData, shown: number, bestBuddy?: boolean): number =>
  bestBuddy ? shown - buddyBoost(game) : shown;

/** Piso de IV por origen y banderas. Usa los valores de clima/incursión del Game Master. */
export function ivFloor(game: GameData, origin: Origin = 'unknown', flags: PokemonFlags = {}): number {
  let floor: number;
  if (origin === 'weather') floor = game.weather.guaranteedIvs;
  else if (origin === 'raid') floor = game.weather.raidGuaranteedIvs;
  else floor = IV_FLOOR_BY_ORIGIN[origin] ?? 0;
  if (flags.lucky) floor = Math.max(floor, IV_FLOOR_BY_ORIGIN.lucky_trade);
  if (flags.purified || origin === 'purified') floor = Math.max(floor, IV_FLOOR_BY_ORIGIN.purified);
  return Math.min(floor, IV_MAX);
}
