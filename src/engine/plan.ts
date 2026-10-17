import { affordability, emptyNeeds, evolutionCost, powerUpCost, secondMoveCost, type Affordability, type CostMods, type Inventory, type Needs, type PowerUpCost } from './cost';
import { buddyBoost } from './levels';
import { baseIdOf } from './line';
import type { MovesetOption } from './moveset';
import type { EngineCtx } from './types';

export interface UpgradePlanInput {
  fromSpeciesId: string;
  toSpeciesId: string;
  /** Nivel mostrado actual y objetivo (con el +1 de Mejor Amigo si aplica). */
  fromLevel: number;
  toLevel: number;
  mods: CostMods;
  bestBuddy?: boolean;
  playerLevel?: number;
  moveset?: MovesetOption | null;
  inventory?: Inventory;
}

export interface UpgradePlan {
  powerUp: PowerUpCost | null;
  evolution: { candy: number | null; items: string[]; steps: number } | null;
  secondMove: { stardust: number; candy: number | null } | null;
  eliteFastTm: number;
  eliteChargedTm: number;
  needs: Needs;
  afford: Affordability;
  familyId: string | null;
  notes: string[];
}

/** Calculadora: polvo, caramelos, XL, evolución, 2.º ataque y TM élite para llegar al objetivo. */
export function planUpgrade(ctx: EngineCtx, input: UpgradePlanInput): UpgradePlan {
  const notes: string[] = [];
  const boost = input.bestBuddy ? buddyBoost(ctx.game) : 0;
  const maxReal = ctx.game.powerUp.maxNormalUpgradeLevel;
  const fromReal = input.fromLevel - boost;
  const toReal = Math.min(input.toLevel - boost, maxReal);
  let powerUp: PowerUpCost | null = null;
  if (toReal > fromReal) powerUp = powerUpCost(ctx.game, fromReal, toReal, input.mods, input.playerLevel);
  else if (toReal < fromReal) notes.push('Ya superó el nivel objetivo.');
  if (powerUp?.exceedsAccount) notes.push('Tu nivel de cuenta no alcanza para llegar a ese nivel.');
  if (input.bestBuddy && input.toLevel > maxReal) notes.push('El nivel por encima de 50 requiere mantener a Mejor Amigo.');

  const from = ctx.speciesById.get(baseIdOf(input.fromSpeciesId));
  const evo = baseIdOf(input.fromSpeciesId) === baseIdOf(input.toSpeciesId) ? null : evolutionCost(ctx, input.fromSpeciesId, input.toSpeciesId, input.mods);
  if (baseIdOf(input.fromSpeciesId) !== baseIdOf(input.toSpeciesId) && !evo) notes.push('La especie objetivo no es una evolución de este Pokémon.');
  if (evo?.items.length) notes.push(`Requiere objeto: ${evo.items.join(', ')}.`);

  const toSpecies = ctx.speciesById.get(input.toSpeciesId);
  const ms = input.moveset;
  const secondMove = ms?.totals.secondMove && toSpecies ? secondMoveCost(toSpecies) : null;

  const needs = emptyNeeds();
  needs.stardust = (powerUp?.stardust ?? 0) + (secondMove?.stardust ?? 0);
  needs.candy = (powerUp?.candy ?? 0) + (evo?.candy ?? 0) + (secondMove?.candy ?? 0);
  needs.xlCandy = powerUp?.xlCandy ?? 0;
  needs.eliteFastTm = ms?.totals.eliteFastTm ?? 0;
  needs.eliteChargedTm = ms?.totals.eliteChargedTm ?? 0;

  const familyId = from?.family.id ?? null;
  return {
    powerUp, evolution: evo, secondMove,
    eliteFastTm: needs.eliteFastTm, eliteChargedTm: needs.eliteChargedTm,
    needs, afford: affordability(needs, input.inventory, familyId), familyId, notes,
  };
}
