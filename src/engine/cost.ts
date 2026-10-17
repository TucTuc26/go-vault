import type { GameData, Species } from '../data/schemas';
import { LEVEL_STEP, roundCost } from './constants';
import { evolutionPath } from './line';
import type { EngineCtx } from './types';

export interface CostMods { shadow?: boolean; purified?: boolean; lucky?: boolean }

export interface PowerUpCost {
  fromLevel: number;
  toLevel: number;
  steps: number;
  stardust: number;
  candy: number;
  xlCandy: number;
  /** El destino supera lo que la cuenta puede mejorar. */
  exceedsAccount: boolean;
}

function mult(game: GameData, mods: CostMods) {
  const p = game.powerUp;
  let dust = 1;
  let candy = 1;
  if (mods.shadow) { dust *= p.shadowStardustMultiplier; candy *= p.shadowCandyMultiplier; }
  if (mods.purified) { dust *= p.purifiedStardustMultiplier; candy *= p.purifiedCandyMultiplier; }
  if (mods.lucky) dust *= p.luckyStardustMultiplier;
  return { dust, candy };
}

/**
 * Costo de subir de `fromLevel` a `toLevel` (niveles reales, múltiplos de 0.5, ≤ tope normal).
 * Cada paso de 0.5 usa la posición floor(nivel)-1 de las tablas del Game Master; desde el nivel
 * `xlCandyMinPokemonLevel` se gastan caramelos XL en lugar de normales. Redondeo por paso.
 */
export function powerUpCost(game: GameData, fromLevel: number, toLevel: number, mods: CostMods = {}, playerLevel?: number): PowerUpCost {
  const p = game.powerUp;
  if (toLevel > p.maxNormalUpgradeLevel) throw new RangeError(`No se puede mejorar por encima del nivel ${p.maxNormalUpgradeLevel}`);
  const m = mult(game, mods);
  let stardust = 0, candy = 0, xl = 0, steps = 0;
  for (let l = fromLevel; l < toLevel - 1e-9; l += LEVEL_STEP) {
    const i = Math.floor(l) - 1;
    stardust += roundCost((p.stardust[i] ?? 0) * m.dust);
    if (l >= p.xlCandyMinPokemonLevel) xl += roundCost((p.xlCandy[Math.floor(l) - p.xlCandyMinPokemonLevel] ?? 0) * m.candy);
    else candy += roundCost((p.candy[i] ?? 0) * m.candy);
    steps++;
  }
  const cap = playerLevel ? playerLevel + p.allowedLevelsAbovePlayer : Infinity;
  return { fromLevel, toLevel, steps, stardust, candy, xlCandy: xl, exceedsAccount: toLevel > cap };
}

/** Caramelos de evolución de un tramo (usa el costo purificado si corresponde). */
export function evolutionCost(ctx: Pick<EngineCtx, 'speciesById'>, fromId: string, toId: string, mods: CostMods = {}): { candy: number | null; items: string[]; steps: number } | null {
  const path = evolutionPath(ctx, fromId, toId);
  if (!path) return null;
  let candy: number | null = 0;
  const items: string[] = [];
  for (const e of path) {
    const c = mods.purified && e.candyPurified != null ? e.candyPurified : e.candy;
    candy = candy === null || c === null ? null : candy + c;
    if (e.item) items.push(e.item);
  }
  return { candy, items, steps: path.length };
}

export interface SecondMoveCost { stardust: number; candy: number | null }
/** Costo de desbloquear el 2.º ataque cargado (del Game Master; sin descuentos conocidos). */
export function secondMoveCost(species: Pick<Species, 'thirdMove'>): SecondMoveCost | null {
  return species.thirdMove ? { stardust: species.thirdMove.stardust, candy: species.thirdMove.candy } : null;
}

export interface Inventory {
  stardust?: number;
  /** Caramelos por familia (family.id, p. ej. FAMILY_MEDITITE). */
  candy?: Record<string, number>;
  xlCandy?: Record<string, number>;
  eliteFastTm?: number;
  eliteChargedTm?: number;
}

export interface Needs {
  stardust: number;
  candy: number;
  xlCandy: number;
  eliteFastTm: number;
  eliteChargedTm: number;
}

export const emptyNeeds = (): Needs => ({ stardust: 0, candy: 0, xlCandy: 0, eliteFastTm: 0, eliteChargedTm: 0 });

export interface Affordability {
  /** null si no hay inventario cargado en Ajustes. */
  known: boolean;
  ok: boolean;
  missing: Needs;
}

/** "Te alcanza / te falta X" contra el inventario opcional. */
export function affordability(needs: Needs, inv: Inventory | undefined, familyId: string | null): Affordability {
  if (!inv) return { known: false, ok: false, missing: emptyNeeds() };
  const have = {
    stardust: inv.stardust ?? 0,
    candy: familyId ? inv.candy?.[familyId] ?? 0 : 0,
    xlCandy: familyId ? inv.xlCandy?.[familyId] ?? 0 : 0,
    eliteFastTm: inv.eliteFastTm ?? 0,
    eliteChargedTm: inv.eliteChargedTm ?? 0,
  };
  const missing: Needs = {
    stardust: Math.max(0, needs.stardust - have.stardust),
    candy: Math.max(0, needs.candy - have.candy),
    xlCandy: Math.max(0, needs.xlCandy - have.xlCandy),
    eliteFastTm: Math.max(0, needs.eliteFastTm - have.eliteFastTm),
    eliteChargedTm: Math.max(0, needs.eliteChargedTm - have.eliteChargedTm),
  };
  return { known: true, ok: Object.values(missing).every((v) => v === 0), missing };
}
