/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Port de ActionLogic.js de PvPoke (MIT): decisiones de la IA por defecto (cuándo lanzar un ataque cargado y cuándo usar escudo).
 * Se conserva la estructura original (incluida la semántica de `var` de JavaScript: algunas variables intermedias
 * mantienen su valor entre iteraciones), porque el resultado debe coincidir con el simulador de PvPoke.
 */
import { damage, type SimMove, type SimPokemon } from './model';

export interface SimAction {
  type: 'fast' | 'charged' | 'wait' | 'switch';
  actor: number;
  turn: number;
  value: number;
  settings: { shielded: boolean; buffs: boolean; priority: number; charge?: number };
  processed: boolean;
  valid: boolean;
}

export const newAction = (type: SimAction['type'], actor: number, turn: number, value: number, settings: SimAction['settings']): SimAction =>
  ({ type, actor, turn, value, settings, processed: false, valid: false });

/** Lo que la lógica necesita saber de la batalla en curso. */
export interface BattleView {
  getTurns(): number;
  getQueuedActions(): SimAction[];
  getMode(): 'simulate';
}

export class BattleState {
  constructor(
    public energy: any, public oppHealth: any, public turn: any, public oppShields: any,
    public moves: SimMove[], public buffs: any, public chance: number,
  ) {}
}

export interface ShieldDecision { value: boolean; shieldWeight: number; noShieldWeight: number }

export function wouldShield(battle: BattleView, attacker: SimPokemon, defender: SimPokemon, move: SimMove): ShieldDecision {
  let useShield = false;
  let shieldWeight = 1;
  const noShieldWeight = 2;
  const dmg = damage(attacker, defender, move);
  move.damage = dmg;

  const postMoveHP = defender.hp - dmg;
  let currentBuffs: number[];
  let moveBuffs = [0, 0];
  if (move.buffs) moveBuffs = move.buffs;

  if (moveBuffs[0] > 0) {
    currentBuffs = [attacker.statBuffs[0], attacker.statBuffs[1]];
    attacker.applyStatBuffs(moveBuffs);
  } else {
    currentBuffs = [defender.statBuffs[0], defender.statBuffs[1]];
    defender.applyStatBuffs(moveBuffs);
  }

  const fastDamage = damage(attacker, defender, attacker.fastMove);
  const fastAttacks = Math.ceil((move.energy - Math.max(attacker.energy - move.energy, 0)) / attacker.fastMove.energyGain) + 1;
  const fastAttackDamage = fastAttacks * fastDamage;
  const cycleDamage = (fastAttackDamage + 1) * defender.shields;

  if (postMoveHP <= cycleDamage) {
    useShield = true;
    shieldWeight = 2;
  }

  if (moveBuffs[0] > 0) attacker.statBuffs = [currentBuffs[0], currentBuffs[1]];
  else defender.statBuffs = [currentBuffs[0], currentBuffs[1]];

  const fastDPT = fastDamage / attacker.fastMove.turns;
  for (let i = 0; i < attacker.chargedMoves.length; i++) {
    if (!attacker.chargedMoves[i]) continue;
    const chargedMove = attacker.chargedMoves[i];
    if (attacker.energy + chargedMove.energy >= chargedMove.energy) {
      const chargedDamage = damage(attacker, defender, chargedMove);
      if (chargedDamage >= defender.hp / 1.4 && fastDPT > 1.5) { useShield = true; shieldWeight = 4; }
      if (chargedDamage >= defender.hp - cycleDamage) { useShield = true; shieldWeight = 4; }
      if (chargedDamage >= defender.hp / 2 && fastDPT > 2) shieldWeight = 12;
    }
  }

  if (move.selfAttackDebuffing && move.damage / defender.hp > 0.55) { useShield = true; shieldWeight = 4; }
  if (battle.getMode() === 'simulate' && attacker.baitShields === 2) useShield = true;

  return { value: useShield, shieldWeight, noShieldWeight };
}

/** Devuelve la acción de ataque cargado a realizar este turno, o undefined para usar el ataque rápido. */
export function decideAction(battle: BattleView, poke: SimPokemon, opponent: SimPokemon): SimAction | undefined {
  const turns = battle.getTurns();
  let action: SimAction;
  const chargedMoveReady: number[] = [];
  const winsCMP = poke.stats.atk >= opponent.stats.atk;

  const fastDamage = damage(poke, opponent, poke.fastMove);
  const oppFastDamage = damage(opponent, poke, opponent.fastMove);
  let hasNonDebuff = false;

  if (poke.activeChargedMoves.length < 1) return;
  if (poke.energy < poke.fastestChargedMove.energy || poke.farmEnergy) return;

  for (let n = 0; n < poke.activeChargedMoves.length; n++) {
    if (!poke.activeChargedMoves[n].selfDebuffing) hasNonDebuff = true;
    if (poke.energy >= poke.activeChargedMoves[n].energy) chargedMoveReady.push(0);
    else chargedMoveReady.push(Math.ceil((poke.activeChargedMoves[n].energy - poke.energy) / poke.fastMove.energyGain) * poke.fastMove.turns);
  }

  let turnsToLive: number = Infinity;
  const queue: any[] = [];

  if (opponent.cooldown !== 0) {
    queue.unshift({ hp: poke.hp - oppFastDamage, opEnergy: opponent.energy + opponent.fastMove.energyGain, turn: opponent.cooldown / 500, shields: poke.shields });
  } else {
    queue.unshift({ hp: poke.hp, opEnergy: opponent.energy, turn: 0, shields: poke.shields });
  }

  while (queue.length !== 0) {
    const currState = queue.shift();

    if (currState.hp > oppFastDamage) {
      if (winsCMP) {
        if (currState.turn > poke.fastMove.turns) continue;
      } else if (currState.turn > poke.fastMove.turns + 1) continue;
    }

    if (currState.shields !== 0) {
      if (currState.opEnergy >= opponent.fastestChargedMove.energy) {
        queue.unshift({ hp: currState.hp - 1, opEnergy: currState.opEnergy - opponent.fastestChargedMove.energy, turn: currState.turn + 1, shields: currState.shields - 1 });
      }
    } else {
      for (let n = 0; n < opponent.activeChargedMoves.length; n++) {
        if (currState.opEnergy >= opponent.activeChargedMoves[n].energy) {
          const moveDamage = damage(opponent, poke, opponent.activeChargedMoves[n]);
          if (moveDamage >= currState.hp) {
            turnsToLive = Math.min(currState.turn, turnsToLive);
            if (poke.stats.atk > opponent.stats.atk && opponent.fastMove.cooldown % poke.fastMove.cooldown === 0) turnsToLive++;
            break;
          }
          queue.unshift({ hp: currState.hp - moveDamage, opEnergy: currState.opEnergy - opponent.activeChargedMoves[n].energy, turn: currState.turn + 1, shields: currState.shields });
        }
      }
    }

    if (currState.hp - oppFastDamage <= 0) {
      turnsToLive = Math.min(currState.turn + opponent.fastMove.turns, turnsToLive);
      break;
    } else {
      queue.unshift({ hp: currState.hp - oppFastDamage, opEnergy: currState.opEnergy + opponent.fastMove.energyGain, turn: currState.turn + opponent.fastMove.turns, shields: currState.shields });
    }
  }

  // Si no puede lanzar un ataque rápido y vivir, lanza el cargado de más daño
  if (turnsToLive !== -1) {
    if (poke.hp <= opponent.fastMove.damage * 2 && opponent.fastMove.cooldown === 500) turnsToLive--;

    if (poke.hp <= opponent.fastMove.damage && opponent.cooldown > 0 && opponent.fastMove.cooldown > 500) {
      turnsToLive = opponent.cooldown / 500;
      if (opponent.hp > poke.fastMove.damage) turnsToLive--;
    }

    if (poke.hp <= opponent.fastMove.damage && opponent.cooldown === 0 && opponent.fastMove.cooldown <= poke.fastMove.cooldown + 500) {
      if (opponent.hp > poke.fastMove.damage) turnsToLive--;
    }

    if (turnsToLive * 500 < poke.fastMove.cooldown || (turnsToLive * 500 === poke.fastMove.cooldown && !winsCMP) || (turnsToLive * 500 === poke.fastMove.cooldown && poke.hp <= opponent.fastMove.damage)) {
      let maxDamageMoveIndex = 0;
      let prevMoveDamage = -1;

      for (let n = poke.activeChargedMoves.length; n >= 0; n--) {
        if (chargedMoveReady[n] === 0) {
          const moveDamage = damage(poke, opponent, poke.activeChargedMoves[n]);
          if (moveDamage > prevMoveDamage) {
            maxDamageMoveIndex = poke.chargedMoves.indexOf(poke.activeChargedMoves[n]);
            prevMoveDamage = moveDamage;
          }
          if (poke.energy >= poke.activeChargedMoves[n].energy * 2 && poke.stats.atk > opponent.stats.atk && moveDamage * 2 > prevMoveDamage) {
            maxDamageMoveIndex = poke.chargedMoves.indexOf(poke.activeChargedMoves[n]);
            prevMoveDamage = moveDamage * 2;
          }
        }
      }

      if (prevMoveDamage === -1) return;
      return newAction('charged', poke.index, turns, maxDamageMoveIndex, { shielded: false, buffs: false, priority: poke.priority });
    }
  }

  // Lanza un ataque cargado letal si desmaya al rival
  if (!poke.farmEnergy && opponent.shields === 0) {
    for (let n = 0; n < poke.activeChargedMoves.length; n++) {
      const move = poke.activeChargedMoves[n];
      const moveIndex = poke.chargedMoves.indexOf(poke.activeChargedMoves[n]);
      if (poke.energy >= move.energy) {
        const moveDamage = damage(poke, opponent, poke.activeChargedMoves[n]);
        if (opponent.hp <= moveDamage && !move.selfDebuffing && (n === 0 || (n === 1 && !poke.baitShields)) && opponent.hp > poke.fastMove.damage) {
          return newAction('charged', poke.index, turns, moveIndex, { shielded: false, buffs: false, priority: poke.priority });
        }
      }
    }
  }

  // Optimiza el momento del ataque para reducir turnos libres
  if (poke.optimizeMoveTiming) {
    let targetCooldown = 500;
    if (poke.fastMove.cooldown >= 2000) targetCooldown = 1000;
    if (poke.fastMove.cooldown >= 1500 && opponent.fastMove.cooldown === 2500) targetCooldown = 1000;
    if (poke.fastMove.cooldown === 1000 && opponent.fastMove.cooldown === 2000) targetCooldown = 1000;
    if (poke.fastMove.cooldown === opponent.fastMove.cooldown) targetCooldown = 0;
    if (poke.fastMove.cooldown % opponent.fastMove.cooldown === 0 && poke.fastMove.cooldown > opponent.fastMove.cooldown) targetCooldown = 0;

    if ((opponent.cooldown === 0 || opponent.cooldown > targetCooldown) && targetCooldown > 0) {
      let optimizeTiming = true;
      if (poke.hp <= opponent.fastMove.damage) optimizeTiming = false;

      let queuedFastMoves = 0;
      const queuedActions = battle.getQueuedActions();
      for (let i = 0; i < queuedActions.length; i++) {
        if (queuedActions[i].actor === poke.index && queuedActions[i].type === 'fast') queuedFastMoves++;
      }
      queuedFastMoves++;
      if (poke.energy + poke.fastMove.energyGain * queuedFastMoves > 100) optimizeTiming = false;

      let turnsPlanned = poke.fastMove.turns + Math.floor(poke.energy / poke.activeChargedMoves[0].energy);
      if (poke.stats.atk < opponent.stats.atk) turnsPlanned++;
      if (turnsPlanned > turnsToLive) optimizeTiming = false;

      if (opponent.shields === 0) {
        for (let n = 0; n < poke.activeChargedMoves.length; n++) {
          poke.activeChargedMoves[n].damage = damage(poke, opponent, poke.activeChargedMoves[n]);
          if (poke.energy >= poke.activeChargedMoves[n].energy && poke.activeChargedMoves[n].damage >= opponent.hp) {
            optimizeTiming = false;
            break;
          }
        }
      }

      for (let n = 0; n < opponent.activeChargedMoves.length; n++) {
        const fastMovesFromCharged = Math.ceil((opponent.activeChargedMoves[n].energy - opponent.energy) / opponent.fastMove.energyGain);
        const fastMovesInFastMove = Math.floor(poke.fastMove.cooldown / opponent.fastMove.cooldown);
        const turnsFromMove = fastMovesFromCharged * opponent.fastMove.turns + 1;
        opponent.activeChargedMoves[n].damage = damage(opponent, poke, opponent.activeChargedMoves[n]);
        let moveDamage = opponent.activeChargedMoves[n].damage + opponent.fastMove.damage * fastMovesInFastMove;
        if (poke.shields > 0) moveDamage = 1 + opponent.fastMove.damage * fastMovesInFastMove;
        if (turnsFromMove <= poke.fastMove.turns && moveDamage >= poke.hp) {
          optimizeTiming = false;
          break;
        }
      }

      const fastMovesInFastMove2 = Math.floor((poke.fastMove.cooldown + 500) / opponent.fastMove.cooldown);
      if (poke.hp <= opponent.fastMove.damage * fastMovesInFastMove2) optimizeTiming = false;

      if (optimizeTiming) return;
    }
  }

  // Si el rival no se puede desmayar en pocos ciclos, simplifica la selección
  const bestChargedDamage = damage(poke, opponent, poke.bestChargedMove!);
  const bestCycleDamage = bestChargedDamage + fastDamage * Math.ceil(poke.bestChargedMove!.energy / poke.fastMove.energyGain);
  let minimumCycleThreshold = 2;

  if (poke.bestChargedMove!.selfDebuffing && poke.bestChargedMove!.energy > poke.fastestChargedMove.energy && poke.bestChargedMove!.dpe / poke.fastestChargedMove.dpe < 2) minimumCycleThreshold = 1.1;

  if (opponent.hp / bestCycleDamage > minimumCycleThreshold) {
    let selectedMove = poke.bestChargedMove!;
    if (poke.activeChargedMoves.length > 1) {
      for (let i = 0; i < poke.activeChargedMoves.length; i++) {
        if (poke.bestChargedMove!.selfDebuffing && !poke.activeChargedMoves[i].selfDebuffing && selectedMove.dpe / poke.activeChargedMoves[i].dpe < 2) selectedMove = poke.activeChargedMoves[i];
        if (poke.baitShields && opponent.shields > 0 && !poke.activeChargedMoves[0].selfDebuffing && wouldShield(battle, poke, opponent, poke.activeChargedMoves[i]).value) selectedMove = poke.activeChargedMoves[0];
      }
    }
    if (poke.energy < selectedMove.energy) return;
    if (selectedMove.selfDebuffing) {
      const energyToReach = poke.energy + Math.floor((100 - poke.energy) / poke.fastMove.energyGain) * poke.fastMove.energyGain;
      if (poke.energy < energyToReach) return;
    }
    return newAction('charged', poke.index, turns, poke.chargedMoves.indexOf(selectedMove), { shielded: false, buffs: false, priority: poke.priority });
  }

  // Cálculo del camino más eficiente para vencer al rival (cola de programación dinámica)
  let stateCount = 0;
  const DPQueue: BattleState[] = [new BattleState(poke.energy, opponent.hp, 0, opponent.shields, [], 0, 1)];
  const stateList: BattleState[] = [];
  let finalState: BattleState;

  // Las `var` de JavaScript conservan su valor entre iteraciones; se replica declarándolas fuera del bucle.
  let newEnergy: any;
  let newOppHealth: any;
  let newTurn: any;
  let newShields: any;
  let insertElement: boolean;
  let i: number;

  while (DPQueue.length !== 0) {
    if (stateCount >= 500) return;
    stateCount++;

    const currState = DPQueue.shift()!;
    const DPchargedMoveReady: number[] = [];

    currState.buffs = Math.min(4, currState.buffs);
    currState.buffs = Math.max(-4, currState.buffs);

    if (currState.oppHealth <= 0) {
      stateList.push(currState);
      if (currState.chance === 1) break;
      else continue;
    }

    for (let n = 0; n < poke.activeChargedMoves.length; n++) {
      if (currState.energy >= poke.activeChargedMoves[n].energy) DPchargedMoveReady.push(0);
      else DPchargedMoveReady.push(Math.ceil((poke.activeChargedMoves[n].energy - currState.energy) / poke.fastMove.energyGain) * poke.fastMove.turns);
    }

    for (let n = 0; n < poke.activeChargedMoves.length; n++) {
      const currentStatBuffs = [poke.statBuffs[0], poke.statBuffs[1]];
      poke.applyStatBuffs([currState.buffs, 0]);

      const moveDamage = damage(poke, opponent, poke.activeChargedMoves[n]);
      const fastSimulatedDamage = damage(poke, opponent, poke.fastMove);

      poke.statBuffs = [currentStatBuffs[0], currentStatBuffs[1]];

      if (hasNonDebuff && poke.speciesName === 'Melmetal' && opponent.speciesName === 'Cresselia') {
        if (poke.activeChargedMoves[n].selfDebuffing && poke.activeChargedMoves[n].buffs![1] < 1 && opponent.hp > moveDamage * (1 + 4 / (4 - poke.activeChargedMoves[n].buffs![0]))) continue;
      }

      const movesToFarmDown = Math.ceil(currState.oppHealth / fastSimulatedDamage);

      i = 0;
      insertElement = true;
      if (DPQueue.length === 0) {
        DPQueue.unshift(new BattleState(currState.energy + poke.fastMove.energyGain * movesToFarmDown, 0, currState.turn + movesToFarmDown * poke.fastMove.turns, currState.oppShields, currState.moves, currState.buffs, currState.chance));
      } else {
        while (DPQueue[i].turn <= currState.turn + movesToFarmDown * poke.fastMove.turns) {
          if ((DPQueue[i] as any).hp < 0) { insertElement = false; break; }
          i++;
          if (i === DPQueue.length) break;
        }
        if (insertElement) {
          DPQueue.splice(i, 0, new BattleState(currState.energy + poke.fastMove.energyGain * movesToFarmDown, 0, currState.turn + movesToFarmDown * poke.fastMove.turns, currState.oppShields, currState.moves, currState.buffs, currState.chance));
        }
      }

      let attackMult = currState.buffs;
      let changeTTKChance = 0;
      let possibleAttackMult = attackMult;
      const acm = poke.activeChargedMoves[n];

      if (acm.buffApplyChance && acm.buffTarget === 'self') {
        if (acm.buffApplyChance === 1) attackMult += acm.buffs![0];
        else { possibleAttackMult += acm.buffs![0]; changeTTKChance = acm.buffApplyChance; }
      }
      if (acm.buffApplyChance && acm.buffTarget === 'opponent') {
        if (acm.buffApplyChance === 1) attackMult -= acm.buffs![1];
        else { possibleAttackMult -= acm.buffs![1]; changeTTKChance = acm.buffApplyChance; }
      }
      changeTTKChance = 0; // sistema de buffs no garantizados desactivado en el original

      if (DPchargedMoveReady[n] === 0) {
        newOppHealth = currState.oppHealth - moveDamage;
        if (currState.oppShields > 0) newOppHealth = currState.oppHealth - 1;

        newShields = currState.oppShields;
        if (newShields > 0) newShields--;

        i = 0;
        insertElement = true;
        while (i < DPQueue.length && DPQueue[i].turn === currState.turn + 1) {
          if (DPQueue[i].oppHealth === newOppHealth && DPQueue[i].buffs === attackMult) {
            if (DPQueue[i].energy === currState.energy - acm.energy) {
              let DPDebuffs = 0;
              let currDebuffs = 0;
              for (let x = 0; x < DPQueue[i].moves.length; x++) {
                if (DPQueue[i].moves[x].selfDebuffing) DPDebuffs++;
                if (DPQueue[i].moves[x].buffApplyChance === 1 && DPQueue[i].moves[x].buffTarget === 'self' && DPQueue[i].moves[x].buffs![0] + DPQueue[i].moves[x].buffs![1] > 0) DPDebuffs--;
              }
              const tempState = currState.moves.concat([acm]);
              for (let x = 0; x < tempState.length; x++) {
                if (tempState[x].selfDebuffing) currDebuffs++;
                if (tempState[x].buffApplyChance === 1 && tempState[x].buffTarget === 'self' && tempState[x].buffs![0] + tempState[x].buffs![1] > 0) currDebuffs--;
              }
              if (DPDebuffs > currDebuffs) {
                DPQueue.splice(i, 1);
              } else {
                insertElement = false;
                i++;
              }
            } else {
              insertElement = false;
              i++;
            }
          } else {
            i++;
          }
        }
        if (insertElement) {
          i = 0;
          let insert = true;
          if (DPQueue.length === 0) {
            DPQueue.unshift(new BattleState(newEnergy, newOppHealth, currState.turn + 1, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
            if (changeTTKChance !== 0) DPQueue.unshift(new BattleState(newEnergy, newOppHealth, currState.turn + 1, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
          } else {
            while (DPQueue[i].turn <= currState.turn + 1) {
              if ((DPQueue[i] as any).hp <= newOppHealth && DPQueue[i].energy >= newEnergy && DPQueue[i].buffs >= attackMult && (DPQueue[i] as any).shields <= newShields) { insert = false; break; }
              i++;
              if (i === DPQueue.length) break;
            }
            if (insert) {
              DPQueue.splice(i, 0, new BattleState(currState.energy - acm.energy, newOppHealth, currState.turn + 1, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
            }
            if (changeTTKChance !== 0) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, currState.turn + 1, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
          }
        }

        // Si el ataque baja el ataque propio, calcula el caso de acumular dos antes de lanzarlos
        if (acm.selfDebuffing && acm.buffs![0] < 0 && acm.energy * 2 <= 100) {
          newTurn = Math.ceil((acm.energy * 2 - currState.energy) / poke.fastMove.energyGain) * poke.fastMove.turns;
          newEnergy = Math.floor(newTurn / poke.fastMove.turns) * poke.fastMove.energyGain + currState.energy - acm.energy;

          if (newTurn !== 0) {
            newOppHealth = currState.oppHealth - fastSimulatedDamage * (newTurn / poke.fastMove.turns);
            if (currState.oppShields > 0) newOppHealth = newOppHealth - 1;
            else newOppHealth = newOppHealth - moveDamage;
            newTurn += currState.turn + 1;

            i = 0;
            insertElement = true;
            if (DPQueue.length === 0) {
              DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
              if (changeTTKChance !== 0) DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
            } else {
              while (DPQueue[i].turn <= newTurn) {
                if ((DPQueue[i] as any).hp <= newOppHealth && DPQueue[i].energy >= newEnergy && DPQueue[i].buffs >= attackMult && (DPQueue[i] as any).shields <= newShields) { insertElement = false; break; }
                i++;
                if (i === DPQueue.length) break;
              }
              if (insertElement) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
              if (changeTTKChance !== 0) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
            }
          }
        }
      } else {
        newEnergy = currState.energy - acm.energy + poke.fastMove.energyGain * (DPchargedMoveReady[n] / poke.fastMove.turns);
        newOppHealth = currState.oppHealth - moveDamage - fastSimulatedDamage * (DPchargedMoveReady[n] / poke.fastMove.turns);
        if (currState.oppShields > 0) newOppHealth = currState.oppHealth - fastSimulatedDamage * (DPchargedMoveReady[n] / poke.fastMove.turns) - 1;
        newTurn = currState.turn + DPchargedMoveReady[n] + 1;
        newShields = currState.oppShields;
        if (newShields > 0) newShields--;

        i = 0;
        insertElement = true;
        if (DPQueue.length === 0) {
          DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
          if (changeTTKChance !== 0) DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
        } else {
          while (DPQueue[i].turn < newTurn) {
            if ((DPQueue[i] as any).hp <= newOppHealth && DPQueue[i].energy >= newEnergy && DPQueue[i].buffs >= attackMult && (DPQueue[i] as any).shields <= newShields) { insertElement = false; break; }
            i++;
            if (i === DPQueue.length) break;
          }
          if (insertElement) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
          if (changeTTKChance !== 0) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
        }

        if (acm.selfDebuffing && acm.buffs![0] < 0 && acm.energy * 2 <= 100) {
          newTurn = Math.ceil((acm.energy * 2 - currState.energy) / poke.fastMove.energyGain) * poke.fastMove.turns;
          newEnergy = Math.floor(newTurn / poke.fastMove.turns) * poke.fastMove.energyGain + currState.energy - acm.energy;
          newOppHealth = currState.oppHealth - fastSimulatedDamage * (newTurn / poke.fastMove.turns);
          if (currState.oppShields > 0) newOppHealth = newOppHealth - 1;
          else newOppHealth = newOppHealth - moveDamage;
          newTurn += currState.turn + 1;

          i = 0;
          insertElement = true;
          if (DPQueue.length === 0) {
            DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
            if (changeTTKChance !== 0) DPQueue.unshift(new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
          } else {
            while (DPQueue[i].turn < newTurn) {
              if ((DPQueue[i] as any).hp <= newOppHealth && DPQueue[i].energy >= newEnergy && DPQueue[i].buffs >= attackMult && (DPQueue[i] as any).shields <= newShields) { insertElement = false; break; }
              i++;
              if (i === DPQueue.length) break;
            }
            if (insertElement) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), attackMult, currState.chance));
            if (changeTTKChance !== 0) DPQueue.splice(i, 0, new BattleState(newEnergy, newOppHealth, newTurn, newShields, currState.moves.concat([acm]), possibleAttackMult, currState.chance * changeTTKChance));
          }
        }
      }
    }
  }

  if (stateList.length > 0) poke.turnsToKO = turns + stateList[stateList.length - 1].turn;
  else return;

  const needsBoost = false;
  if (stateList.length === 1) {
    finalState = stateList[0];
  } else if (opponent.turnsToKO !== -1 && poke.turnsToKO > opponent.turnsToKO) {
    let bestPlan = stateList[0];
    for (let k = 1; k < stateList.length; k++) {
      if (stateList[k].chance > (bestPlan as any)) bestPlan = stateList[k];
    }
    finalState = bestPlan;
  } else {
    finalState = stateList[stateList.length - 1];
  }

  if (finalState.moves.length === 0) {
    if (!poke.getBoostMove()) return;
    finalState.moves.push(poke.getBoostMove() as SimMove);
  }

  let debuffingMove = false;
  let mostExpensiveMove = finalState.moves[0];
  for (let moveInd = 0; moveInd < finalState.moves.length; moveInd++) {
    if (finalState.moves[moveInd].selfDebuffing) debuffingMove = true;
    if (finalState.moves[moveInd].energy > mostExpensiveMove.energy) mostExpensiveMove = finalState.moves[moveInd];
  }
  void mostExpensiveMove;

  const acms = poke.activeChargedMoves;

  if (poke.baitShields && opponent.shields > 0 && acms.length > 1) {
    for (let k = 1; k < acms.length; k++) {
      if (poke.energy < acms[k].energy && acms[k].dpe > finalState.moves[0].dpe) {
        let bait = true;
        if (acms[k].dpe / acms[0].dpe <= 1.5 && acms[0].selfBuffing) bait = false;
        if (bait) return;
      }
    }
  }

  if (poke.baitShields && opponent.shields > 0 && acms.length > 1) {
    for (let k = 1; k < acms.length; k++) {
      const dpeRatio = acms[k].damage / acms[k].energy / (finalState.moves[0].damage / finalState.moves[0].energy);
      if (poke.energy >= acms[k].energy && dpeRatio > 1.5) {
        if (!wouldShield(battle, poke, opponent, acms[k]).value) finalState.moves[0] = acms[k];
      }
    }
  }

  if (!needsBoost) {
    if (!poke.baitShields || (opponent.shields === 0 && debuffingMove === false)) {
      finalState.moves.sort((a, b) => damage(poke, opponent, b) - damage(poke, opponent, a));
    }
  }

  if (opponent.shields > 0 && acms.length > 1 && acms[0].energy <= finalState.moves[0].energy && acms[0].dpe > finalState.moves[0].dpe && !acms[0].selfDebuffing) finalState.moves[0] = acms[0];

  if (opponent.shields === 0 && acms.length > 1 && finalState.moves[0].selfDebuffing && finalState.moves[0].energy > 50 && poke.hp / poke.stats.hp > 0.5 && finalState.moves[0].damage / opponent.hp < 0.8) finalState.moves[0] = acms[0];

  if (acms.length > 1 && acms[0].energy === finalState.moves[0].energy && acms[0].dpe > finalState.moves[0].dpe && !acms[0].selfDebuffing) finalState.moves[0] = acms[0];

  if (acms.length > 1 && acms[0].energy - 10 <= finalState.moves[0].energy && acms[0].dpe > finalState.moves[0].dpe && finalState.moves[0].selfDebuffing && !acms[0].selfDebuffing) finalState.moves[0] = acms[0];

  if (acms.length > 1 && acms[0].energy - finalState.moves[0].energy <= 5 && acms[0].dpe > finalState.moves[0].dpe && acms[0].selfBuffing) finalState.moves[0] = acms[0];

  if (poke.baitShields && opponent.shields > 0 && acms.length > 1) {
    for (let k = 1; k < acms.length; k++) {
      if (poke.energy >= acms[k].energy && acms[k].dpe > finalState.moves[0].dpe) {
        if (finalState.moves[0].selfDebuffing && !acms[k].selfDebuffing) finalState.moves[0] = acms[k];
      }
    }
  }

  if (opponent.shields === 0 && acms.length > 1 && finalState.moves[0].selfDebuffing) {
    for (let k = 1; k < acms.length; k++) {
      if (acms[k].dpe > finalState.moves[0].dpe && !acms[k].selfDebuffing) finalState.moves[0] = acms[k];
    }
  }

  if (opponent.shields > 0 && acms.length > 1) {
    for (let k = 1; k < acms.length; k++) {
      if (acms[0].selfDebuffing && !acms[k].selfDebuffing) {
        if (poke.baitShields || opponent.hp - acms[0].damage > 10) {
          if (acms[k].energy - acms[0].energy <= 10 && acms[k].dpe / acms[0].dpe > 0.7) finalState.moves[0] = acms[k];
        }
      }
    }
  }

  if (finalState.moves[0].selfDebuffing && poke.shields === 0 && poke.energy < 100 && opponent.bestChargedMove) {
    if (opponent.energy >= opponent.bestChargedMove.energy && !wouldShield(battle, opponent, poke, opponent.bestChargedMove).value && !acms[0].selfBuffing) return;
  }

  if (finalState.moves[0].selfDebuffing) {
    const targetEnergy = Math.floor(100 / finalState.moves[0].energy) * finalState.moves[0].energy;
    if (poke.energy < targetEnergy) {
      const moveDamage = damage(poke, opponent, finalState.moves[0]);
      if ((opponent.hp > moveDamage || opponent.shields !== 0) && (poke.hp > opponent.fastMove.damage * 2 || opponent.fastMove.cooldown - poke.fastMove.cooldown > 500)) return;
    } else if (poke.baitShields && opponent.shields > 0 && acms[0].energy - finalState.moves[0].energy <= 10 && !acms[0].selfDebuffing) {
      if (acms[0].selfBuffing || wouldShield(battle, poke, opponent, finalState.moves[0]).value) finalState.moves[0] = acms[0];
    }
  }

  if (poke.energy >= finalState.moves[0].energy) {
    // se usa el ataque elegido
  } else {
    return;
  }

  action = newAction('charged', poke.index, turns, poke.chargedMoves.indexOf(finalState.moves[0]), { shielded: false, buffs: false, priority: poke.priority });
  return action;
}
