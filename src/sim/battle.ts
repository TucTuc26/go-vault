/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Port de Battle.js de PvPoke (MIT) — modo "simulate": bucle de turnos de 500 ms, cola de acciones, ataques rápidos
 * "flotantes", prioridad de ataques cargados, escudos, buffs y cálculo de la calificación de batalla.
 * No incluye el emulador (animaciones, jugadores, cambios) ni los cambios de forma (Aegislash, Mimikyu, Cramorant).
 */
import { decideAction, newAction, wouldShield, type BattleView, type SimAction } from './action-logic';
import { damage, SimPokemon, type SimEnv, type SimMonSpec, type SimMove } from './model';

const DELTA = 500;
const CHARGED_MINIGAME_TIME = 10000;
const MAX_TIME = 240000;

export interface SimEvent { type: string; name: string; actor: number; turn: number }

export interface SimResult {
  /** PS restantes de cada Pokémon. */
  hp: [number, number];
  energy: [number, number];
  shields: [number, number];
  buffs: [number[], number[]];
  /** Calificación de batalla (0–1000) de cada uno; > 500 = victoria. */
  ratings: [number, number];
  turns: number;
  turnsToWin: [number, number];
  /** 0 / 1 = índice del ganador; -1 = empate. */
  winner: 0 | 1 | -1;
  timeline: SimEvent[];
}

export class SimBattle implements BattleView {
  pokemon: [SimPokemon, SimPokemon];
  private timeline: SimEvent[] = [];
  private time = 0;
  private turns = 1;
  private lastProcessedTurn = 0;
  private turnsToWin: [number, number] = [0, 0];
  private queuedActions: SimAction[] = [];
  private turnActions: SimAction[] = [];
  private previousTurnActions: SimAction[] = [];
  private actionIndex = 0;
  private usePriority = false;
  private roundChargedMoveUsed = 0;
  private roundChargedMovesInitiated = 0;
  private roundShieldUsed = false;
  private buffChanceModifier = -1;
  private recordEvents: boolean;

  constructor(a: SimPokemon, b: SimPokemon, opts: { timeline?: boolean } = {}) {
    this.pokemon = [a, b];
    this.recordEvents = opts.timeline ?? false;
    a.battle = this;
    b.battle = this;
  }

  getOpponent(index: number): SimPokemon { return index === 0 ? this.pokemon[1] : this.pokemon[0]; }
  getTurns(): number { return this.turns; }
  getQueuedActions(): SimAction[] { return this.queuedActions; }
  getMode(): 'simulate' { return 'simulate'; }

  private log(type: string, name: string, actor: number): void {
    if (this.recordEvents) this.timeline.push({ type, name, actor, turn: this.turns });
  }

  private start(): void {
    for (const p of this.pokemon) p.reset();
    this.usePriority = this.pokemon[0].stats.atk !== this.pokemon[1].stats.atk || (this.pokemon[0].speciesId === 'cramorant' && this.pokemon[1].speciesId === 'cramorant');
    this.time = 0;
    this.turns = 1;
    this.lastProcessedTurn = 0;
    this.turnsToWin = [0, 0];
    this.timeline = [];
    this.queuedActions = [];
    this.turnActions = [];
    this.previousTurnActions = [];
  }

  private getTurnAction(poke: SimPokemon, opponent: SimPokemon): SimAction | undefined {
    let action: SimAction | undefined;
    if (poke.cooldown === 0 && !poke.hasActed) {
      poke.hasActed = true;
      action = decideAction(this, poke, opponent);
      if (!action) action = newAction('fast', poke.index, this.turns, 0, { priority: poke.priority } as SimAction['settings']);
      if (action.type === 'charged') {
        this.roundChargedMovesInitiated++;
        action.settings.priority += 10;
        if (poke.stats.atk > opponent.stats.atk) action.settings.priority++;
      }
      if (action.type === 'switch') action.settings.priority += 20;
    }
    return action;
  }

  private step(): void {
    const pokemon = this.pokemon;
    this.roundChargedMoveUsed = 0;
    this.roundChargedMovesInitiated = 0;
    this.roundShieldUsed = false;

    if (this.turns > this.lastProcessedTurn) this.turnActions = [];

    for (let i = 0; i < 2; i++) {
      const poke = pokemon[i];
      poke.cooldown = Math.max(0, poke.cooldown - DELTA);
      poke.chargedMovesOnly = false;
      if (this.turns > this.lastProcessedTurn) poke.hasActed = false;
    }

    const chargedMoveLastTurn = this.previousTurnActions.find((a) => a.type === 'charged');
    const cooldownsToSet = [pokemon[0].cooldown, pokemon[1].cooldown];

    if (this.turns > this.lastProcessedTurn) {
      for (let i = 0; i < 2; i++) {
        const poke = pokemon[i];
        const opponent = this.getOpponent(i);
        const action = this.getTurnAction(poke, opponent);
        if (action) {
          if (chargedMoveLastTurn && action.type !== 'switch') continue;
          if (action.type === 'switch' || (poke.hp > 0 && opponent.hp > 0)) {
            let valid = true;
            if (action.type === 'fast') {
              if (poke.chargedMovesOnly) valid = false;
              if (valid) cooldownsToSet[i] += poke.fastMove.cooldown;
            }
            if (action.type === 'charged' && valid) cooldownsToSet[i] += 500;
            if (valid) this.queuedActions.push(action);
          }
        }
      }
    }

    pokemon[0].cooldown = cooldownsToSet[0];
    pokemon[1].cooldown = cooldownsToSet[1];

    const chargedLast2 = this.previousTurnActions.find((a) => a.type === 'charged');
    for (let i = 0; i < this.queuedActions.length; i++) {
      const action = this.queuedActions[i];
      let valid = false;
      if (action.type === 'fast' || action.type === 'charged') {
        const timeSinceActivated = (this.turns - action.turn) * 500;
        const requiredTimeToPass = action.type === 'fast' ? pokemon[action.actor].fastMove.cooldown - 500 : 0;
        if (timeSinceActivated >= requiredTimeToPass || (action.type === 'fast' && chargedLast2 && action.turn < this.turns)) valid = true;
      }
      if (action.type === 'wait') valid = true;
      if (action.type === 'switch') {
        valid = true;
        if (chargedLast2) action.settings.priority -= 40;
      }
      if (valid) {
        this.turnActions.push(action);
        this.queuedActions.splice(i, 1);
        i--;
      }
    }

    this.turnActions.sort((a, b) => (a.settings.priority > b.settings.priority ? -1 : b.settings.priority > a.settings.priority ? 1 : 0));

    this.actionIndex = 0;
    while (this.actionIndex < this.turnActions.length) {
      const action = this.turnActions[this.actionIndex++];
      const poke = pokemon[action.actor];
      const opponent = pokemon[action.actor === 0 ? 1 : 0];

      switch (action.type) {
        case 'fast':
          action.valid = true;
          if (opponent.hp < 1) action.valid = false;
          if (poke.hp < 1 && poke.faintSource === 'charged') action.valid = false;
          break;
        case 'charged': {
          const move = poke.chargedMoves[action.value];
          if (move && poke.energy >= move.energy) action.valid = true;
          if (move && this.usePriority && poke.hp <= 0 && poke.faintSource === 'charged' && !move.hasTag('ignoresFaint')) action.valid = false;
          break;
        }
        case 'wait':
          action.valid = true;
          break;
      }
      this.processAction(action, poke, opponent);
    }

    this.previousTurnActions = this.turnActions;
    this.turnActions = [];

    if (this.roundChargedMoveUsed === 0) {
      this.time += DELTA;
    } else if (this.roundShieldUsed) {
      this.time += CHARGED_MINIGAME_TIME * (this.roundChargedMoveUsed - 1);
    } else {
      this.time += CHARGED_MINIGAME_TIME;
    }

    this.lastProcessedTurn = this.turns;
    this.turns++;

    for (let i = 0; i < 2; i++) {
      const poke = pokemon[i];
      if (poke.hp <= 0) {
        this.log('faint', 'Faint', poke.index);
        const opponentIndex = i === 0 ? 0 : 1;
        if (this.turnsToWin[opponentIndex] === 0) this.turnsToWin[opponentIndex] = this.turns;
      }
      if (this.roundChargedMoveUsed) poke.cooldown = 500;
    }
  }

  private processAction(action: SimAction, poke: SimPokemon, opponent: SimPokemon): void {
    if (!action.valid || action.processed) return;
    action.processed = true;
    switch (action.type) {
      case 'fast':
        this.useMove(poke, opponent, poke.fastMove);
        break;
      case 'charged': {
        const move = poke.chargedMoves[action.value];
        if (poke.energy >= move.energy) {
          this.useMove(poke, opponent, move, action.settings.shielded, action.settings.buffs, action.settings.charge);
          this.roundChargedMoveUsed++;
        }
        break;
      }
      case 'wait':
        break;
    }
  }

  private useMove(attacker: SimPokemon, defender: SimPokemon, move: SimMove, _forceShields?: boolean, forceBuff?: boolean, charge = 1): void {
    let type = `fast ${move.type}`;
    let dmg = damage(attacker, defender, move, charge);
    move.damage = dmg;
    let shieldBuffModifier = 0;

    if (move.category === 'charged') {
      type = `charged ${move.type}`;
      attacker.energy -= move.energy;
      const chargedMoveTime = move.hasTag('instant') ? 3000 : CHARGED_MINIGAME_TIME;
      if (this.usePriority && this.roundChargedMoveUsed > 0 && !this.roundShieldUsed) this.time += chargedMoveTime;

      const canShield = defender.shields > 0 && !move.hasTag('instant');
      if (canShield) {
        let useShield = true;
        const shieldDecision = wouldShield(this, attacker, defender, move);

        // No usar escudo contra ataques que mejoran al atacante o bajan la defensa del rival (si el cálculo dice que no hace falta)
        if (move.buffs && move.selfBuffing) {
          if ((move.buffTarget === 'self' && move.buffs[0] > 0) || (move.buffTarget === 'opponent' && move.buffs[1] < 0)) useShield = shieldDecision.value;
          if (move.buffTarget === 'both' && move.buffsSelf && move.buffsOpponent && (move.buffsSelf[0] > 0 || move.buffsOpponent[1] < 0)) useShield = shieldDecision.value;
        }

        // No usar escudo temprano si el defensor tiene un ataque que baja su propia defensa
        if (defender.bestChargedMove && defender.bestChargedMove.selfDefenseDebuffing) {
          if (attacker.shields > 0) {
            useShield = shieldDecision.value;
          } else if (defender.bestChargedMove && attacker.bestChargedMove) {
            const fastToNextCharged = Math.ceil((defender.bestChargedMove.energy - defender.energy) / defender.fastMove.energyGain);
            const turnsToNextCharged = fastToNextCharged * defender.fastMove.turns;
            const cycleDamage = fastToNextCharged * defender.fastMove.damage + defender.bestChargedMove.damage;
            let attackerTurnsToNextCharged = Math.ceil((attacker.activeChargedMoves[0].energy - attacker.energy) / attacker.fastMove.energyGain) * attacker.fastMove.turns;
            if (attacker.stats.atk > defender.stats.atk) attackerTurnsToNextCharged--;
            if (turnsToNextCharged >= attackerTurnsToNextCharged && attacker.hp <= cycleDamage) useShield = shieldDecision.value;
          }
        }

        if (useShield) {
          dmg = 1;
          defender.shields--;
          this.roundShieldUsed = true;
          if (move.buffs && move.buffTarget === 'opponent') shieldBuffModifier = 0;
          this.log('shield', 'Shield', defender.index);
          if (this.roundChargedMoveUsed === 0) this.time += CHARGED_MINIGAME_TIME;
        }
      }
    } else if (move.category === 'fast') {
      attacker.energy += attacker.fastMove.energyGain;
      if (attacker.energy > 100) attacker.energy = 100;
    }

    defender.hp = Math.max(0, defender.hp - dmg);

    // Efectos de mejora/reducción de estadísticas
    let buffApplied = false;
    if (move.buffs) {
      let buffRoll = Math.random() + this.buffChanceModifier + shieldBuffModifier;
      if (forceBuff) buffRoll += 2;
      if (move.buffApplyChance === 1) buffRoll += 1;

      // Los ataques con probabilidad < 1 se aplican de forma determinista acumulando la probabilidad
      if (move.buffApplyChance < 1 && move.buffApplyMeter !== undefined && this.buffChanceModifier === -1) {
        const startApplyCount = Math.floor(move.buffApplyMeter);
        move.buffApplyMeter += move.buffApplyChance;
        if (startApplyCount < Math.floor(move.buffApplyMeter)) buffRoll += 2;
      }

      if (move.buffApplyChance === 1 || buffRoll > 1 - move.buffApplyChance) {
        const buffTargets: { target: SimPokemon; buffs: number[] }[] = [];
        if (move.buffTarget === 'opponent' || move.buffTarget === 'both') {
          buffTargets.push({ target: defender, buffs: move.buffTarget === 'both' ? move.buffsOpponent! : move.buffs });
        }
        if (move.buffTarget === 'self' || move.buffTarget === 'both') {
          buffTargets.push({ target: attacker, buffs: move.buffTarget === 'both' ? move.buffsSelf! : move.buffs });
        }
        for (const bt of buffTargets) bt.target.applyStatBuffs(bt.buffs);
        buffApplied = true;
        type += (move.buffs[0] > 0 || move.buffs[1] > 0) ? ' buff' : ' debuff';
      }
    }
    void buffApplied;

    this.log(type, move.name, attacker.index);
    if (defender.hp <= 0) defender.faintSource = move.category;
  }

  /** Ejecuta la batalla completa. */
  simulate(): SimResult {
    this.start();
    let continueBattle = true;
    while (continueBattle) {
      this.step();
      continueBattle = this.pokemon[0].hp > 0 && this.pokemon[1].hp > 0;
      if (this.time > MAX_TIME) continueBattle = false;
    }
    const [a, b] = this.pokemon;
    const ratings: [number, number] = [a.getBattleRating(), b.getBattleRating()];
    const winner: 0 | 1 | -1 = ratings[0] > ratings[1] ? 0 : ratings[1] > ratings[0] ? 1 : -1;
    return {
      hp: [a.hp, b.hp], energy: [a.energy, b.energy], shields: [a.shields, b.shields],
      buffs: [[...a.statBuffs], [...b.statBuffs]], ratings, turns: this.turns, turnsToWin: this.turnsToWin, winner, timeline: this.timeline,
    };
  }
}

/** Atajo: crea los dos Pokémon y simula 1 contra 1. */
export function simulateBattle(env: SimEnv, a: SimMonSpec, b: SimMonSpec, opts: { timeline?: boolean } = {}): SimResult {
  const pa = new SimPokemon(env, a, 0);
  const pb = new SimPokemon(env, b, 1);
  return new SimBattle(pa, pb, opts).simulate();
}
