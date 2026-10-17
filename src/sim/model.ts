/**
 * Port a TypeScript del simulador de combate de PvPoke (https://github.com/pvpoke/pvpoke, licencia MIT; ver NOTICE.md).
 * Modelo de Pokémon/ataques y cálculo de daño. Solo modo "simulate" (sin emulador, UI ni cambios de forma).
 * La lógica sigue línea a línea a Pokemon.js / DamageCalculator.js; tests/sim.test.ts la compara con el original.
 */
import type { GameData, Move, Species } from '../data/schemas';
import { cpmAt } from '../engine/stats';
import type { IVs } from '../engine/types';

export interface SimEnv {
  game: GameData;
  speciesById: Map<string, Species>;
  movesById: Map<string, Move>;
}

/** Ataque listo para simular (equivale al objeto que devuelve GameMaster.getMoveById). */
export interface SimMove {
  moveId: string;
  name: string;
  category: 'fast' | 'charged';
  type: string;
  power: number;
  energy: number;
  energyGain: number;
  cooldown: number;
  turns: number;
  damageMethod: string;
  selfDebuffing: boolean;
  selfBuffing: boolean;
  selfAttackDebuffing: boolean;
  selfDefenseDebuffing: boolean;
  buffs?: number[];
  buffApplyChance: number;
  buffTarget?: string;
  buffsSelf?: number[];
  buffsOpponent?: number[];
  buffApplyMeter?: number;
  tags: string[];
  isMegaMove: boolean;
  stab: number;
  damage: number;
  dpe: number;
  dps: number;
  eps: number;
  deps: number;
  hasTag(tag: string): boolean;
}

/** Constantes de daño. Se derivan de los datos del juego como float32 (así las guarda el cliente y PvPoke). */
export interface DamageConsts {
  bonus: number;
  stab: number;
  shadowAtk: number;
  shadowDef: number;
  /** Matriz [tipo de ataque][tipo defensor] en float32. */
  chart: Record<string, Record<string, number>>;
}

const constsCache = new WeakMap<GameData, DamageConsts>();
export function damageConsts(game: GameData): DamageConsts {
  let c = constsCache.get(game);
  if (c) return c;
  const chart: DamageConsts['chart'] = {};
  for (const [atk, row] of Object.entries(game.typeChart)) {
    chart[atk] = {};
    game.typeOrder.forEach((def, i) => { chart[atk][def] = Math.fround(row[i]); });
  }
  c = {
    bonus: Math.fround(game.combat.chargeAttackBonus ?? 1.3),
    stab: Math.fround(game.combat.stab),
    shadowAtk: game.combat.shadowAttackMultiplier,
    shadowDef: game.combat.shadowDefenseMultiplier,
    chart,
  };
  constsCache.set(game, c);
  return c;
}

export function makeMove(m: Move): SimMove {
  const move: SimMove = {
    moveId: m.id,
    name: m.name,
    category: (m.category as 'fast' | 'charged' | undefined) ?? (m.energyGain > 0 ? 'fast' : 'charged'),
    type: m.type,
    power: m.power,
    energy: m.energy,
    energyGain: m.energyGain,
    cooldown: m.cooldown,
    turns: m.turns ?? m.cooldown / 500,
    damageMethod: m.damageMethod ?? 'default',
    selfDebuffing: false,
    selfBuffing: false,
    selfAttackDebuffing: false,
    selfDefenseDebuffing: false,
    buffApplyChance: NaN,
    tags: m.tags ? [...m.tags] : [],
    isMegaMove: !!m.isMegaMove,
    stab: 1, damage: 0, dpe: 0, dps: 0, eps: 0, deps: 0,
    hasTag(tag) { return this.tags.includes(tag); },
  };
  if (m.buffs) {
    move.buffs = [...m.buffs];
    move.buffApplyChance = parseFloat(m.buffApplyChance ?? 'NaN');
    move.buffTarget = m.buffTarget;
    if (move.buffTarget === 'both') {
      move.buffsSelf = m.buffsSelf ? [...m.buffsSelf] : undefined;
      move.buffsOpponent = m.buffsOpponent ? [...m.buffsOpponent] : undefined;
    }
    if (move.buffTarget === 'self' && move.buffApplyChance >= 0.5 && move.moveId !== 'DRAGON_ASCENT' && (move.buffs[0] < 0 || move.buffs[1] < 0)) {
      move.selfDebuffing = true;
      if (move.buffs[0] < 0) move.selfAttackDebuffing = true;
      if (move.buffs[1] < 0) move.selfDefenseDebuffing = true;
    }
    if (move.buffApplyChance === 1 && (move.buffTarget === 'opponent' || (move.buffTarget === 'self' && (move.buffs[0] > 0 || move.buffs[1] > 0)) || (move.buffTarget === 'both' && !!move.buffsSelf && (move.buffsSelf[0] > 0 || move.buffsSelf[1] > 0)))) {
      move.selfBuffing = true;
    }
  }
  return move;
}

export interface SimMonSpec {
  speciesId: string;
  ivs: IVs;
  level: number;
  fast: string;
  charged: string[];
  shields: number;
  /** 0 = no cebar, 1 = cebar selectivamente (por defecto), 2 = siempre cebar. */
  baitShields?: number;
  farmEnergy?: boolean;
  optimizeMoveTiming?: boolean;
  startEnergy?: number;
  startHp?: number;
}

export interface BattleLike { getOpponent(index: number): SimPokemon | null }

export class SimPokemon {
  speciesId: string;
  speciesName: string;
  dex: number;
  tags: string[];
  types: string[];
  baseStats: { atk: number; def: number; hp: number };
  stats = { atk: 0, def: 0, hp: 0 };
  ivs: IVs;
  level: number;
  cpm = 0;
  cp = 0;
  hp = 0;
  startHp = 0;
  energy = 0;
  startEnergy = 0;
  cooldown = 0;
  startCooldown = 0;
  shields = 0;
  startingShields: number;
  statBuffs = [0, 0];
  startStatBuffs = [0, 0];
  nativeStatBuffs = [0, 0];
  shadowType: 'normal' | 'shadow' = 'normal';
  shadowAtkMult = 1;
  shadowDefMult = 1;
  fastMovePool: SimMove[] = [];
  chargedMovePool: SimMove[] = [];
  fastMove!: SimMove;
  chargedMoves: SimMove[] = [];
  activeChargedMoves: SimMove[] = [];
  fastestChargedMove!: SimMove;
  bestChargedMove: SimMove | null = null;
  typeEffectiveness: Record<string, number> = {};
  index: number;
  priority = 0;
  hasActed = false;
  baitShields: number;
  farmEnergy: boolean;
  chargedMovesOnly = false;
  optimizeMoveTiming: boolean;
  turnsToKO = -1;
  faintSource = '';
  damageWindow = 0;
  // Los cambios de forma no se modelan
  formChange: undefined = undefined;
  activeFormId: string;

  battle: BattleLike | null = null;
  readonly game: GameData;
  readonly consts: DamageConsts;

  constructor(env: SimEnv, spec: SimMonSpec, index: number) {
    const sp = env.speciesById.get(spec.speciesId);
    if (!sp) throw new Error(`Especie desconocida: ${spec.speciesId}`);
    this.game = env.game;
    this.consts = damageConsts(env.game);
    this.speciesId = sp.id;
    this.activeFormId = sp.id;
    this.speciesName = sp.name;
    this.dex = sp.dex;
    this.tags = [...sp.tags];
    this.types = sp.types.length > 1 ? [sp.types[0], sp.types[1]] : [sp.types[0], 'none'];
    this.baseStats = { atk: sp.atk, def: sp.def, hp: sp.hp };
    this.ivs = { ...spec.ivs };
    this.level = spec.level;
    this.index = index;
    this.startingShields = spec.shields;
    this.baitShields = spec.baitShields ?? 1;
    this.farmEnergy = spec.farmEnergy ?? false;
    this.optimizeMoveTiming = spec.optimizeMoveTiming ?? true;
    if (sp.nativeStatBuffs) this.nativeStatBuffs = [...sp.nativeStatBuffs];
    this.startEnergy = spec.startEnergy ?? 0;

    // Efectividad contra este Pokémon, por tipo de ataque
    for (const atkType of env.game.typeOrder) {
      let e = 1;
      for (const t of this.types) if (t !== 'none') e *= this.consts.chart[atkType]?.[t] ?? 1;
      this.typeEffectiveness[atkType] = e;
    }

    const mk = (id: string) => {
      const m = env.movesById.get(id);
      if (!m) throw new Error(`Ataque desconocido: ${id}`);
      return makeMove(m);
    };
    this.fastMovePool = sp.fast.map(mk);
    this.chargedMovePool = sp.charged.map(mk);
    const byId = (a: SimMove, b: SimMove) => (a.moveId > b.moveId ? 1 : b.moveId > a.moveId ? -1 : 0);
    this.fastMovePool.sort(byId);
    this.chargedMovePool.sort(byId);

    // Estadísticas (Pokemon.initialize)
    this.setLevel(spec.level);
    if (sp.tags.includes('shadow') || sp.shadow) this.setShadow();
    const f = this.fastMovePool.find((m) => m.moveId === spec.fast);
    if (!f) throw new Error(`${sp.id} no puede usar ${spec.fast}`);
    this.fastMove = f;
    this.chargedMoves = [];
    spec.charged.slice(0, 2).forEach((id, i) => {
      const m = this.chargedMovePool.find((x) => x.moveId === id);
      if (!m) throw new Error(`${sp.id} no puede usar ${id}`);
      this.chargedMoves[i] = m;
    });
    if (this.chargedMoves.length === 2 && this.chargedMoves[0].moveId === this.chargedMoves[1].moveId) this.chargedMoves.pop();
    if (spec.startHp !== undefined) this.startHp = Math.min(spec.startHp, this.stats.hp);
  }

  /** Pokemon.setLevel + initialize (stats y PS). */
  setLevel(level: number): void {
    this.level = level;
    this.cpm = cpmAt(this.game, level);
    this.stats.atk = this.cpm * (this.baseStats.atk + this.ivs.atk);
    this.stats.def = this.cpm * (this.baseStats.def + this.ivs.def);
    this.stats.hp = Math.max(Math.floor(this.cpm * (this.baseStats.hp + this.ivs.hp)), 10);
    if (this.dex === 292) this.stats.hp = 10; // Shedinja
    this.hp = this.stats.hp;
    this.startHp = this.hp;
  }

  setShadow(): void {
    this.shadowType = 'shadow';
    this.shadowAtkMult = this.consts.shadowAtk;
    this.shadowDefMult = this.consts.shadowDef;
  }

  hasTag(tag: string): boolean { return this.tags.includes(tag); }

  getStab(move: SimMove): number {
    return move.type === this.types[0] || move.type === this.types[1] ? this.consts.stab : 1;
  }

  /** Pokemon.reset */
  reset(): void {
    this.hp = this.startHp;
    this.energy = this.startEnergy;
    this.cooldown = this.startCooldown;
    this.damageWindow = 0;
    this.shields = this.startingShields;
    this.statBuffs = [this.startStatBuffs[0], this.startStatBuffs[1]];
    this.faintSource = '';
    this.applyStatBuffs(this.nativeStatBuffs);
    this.resetMoves();
  }

  applyStatBuffs(buffs: number[]): void {
    const max = this.game.simulator.maxBuffStages;
    for (let i = 0; i < buffs.length; i++) {
      this.statBuffs[i] += buffs[i];
      this.statBuffs[i] = Math.min(this.statBuffs[i], max);
      this.statBuffs[i] = Math.max(this.statBuffs[i], -max);
    }
  }

  getStatBuffMultiplier(index: number, useStartStatBuffs = false): number {
    const div = this.game.simulator.buffDivisor;
    const src = useStartStatBuffs ? this.startStatBuffs : this.statBuffs;
    return src[index] > 0 ? (div + src[index]) / div : div / (div - src[index]);
  }

  getEffectiveStat(index: 0 | 1, useStartStatBuffs = false): number {
    let m = this.getStatBuffMultiplier(index, useStartStatBuffs);
    if (this.shadowType === 'shadow') m *= index === 0 ? this.shadowAtkMult : this.shadowDefMult;
    return index === 0 ? this.stats.atk * m : this.stats.def * m;
  }

  getBattleRating(): number {
    const opp = this.battle?.getOpponent(this.index);
    if (!opp) return 0;
    return Math.floor(500 * ((opp.stats.hp - opp.hp) / opp.stats.hp) + 500 * (this.hp / this.stats.hp));
  }

  getBoostMove(): SimMove | false {
    let boost: SimMove | false = false;
    for (const m of this.chargedMoves) {
      if (!m) continue;
      if (m.buffs && m.buffApplyChance >= 0.5 && !m.selfDebuffing) boost = m;
    }
    return boost;
  }

  /** Pokemon.initializeMove */
  initializeMove(move: SimMove): void {
    const opponent = this.battle?.getOpponent(this.index) ?? null;
    move.stab = this.getStab(move);
    if (opponent) move.damage = damage(this, opponent, move);
    else move.damage = Math.floor(move.power * move.stab);
    move.dps = move.damage / (move.cooldown / 500);
    if (move.energy > 0) {
      move.dpe = move.damage / move.energy;
      if (move.buffs) {
        let buffEffect = 0;
        if (move.buffTarget === 'self' && move.buffs[0] > 0) buffEffect = move.buffs[0] * (80 / move.energy);
        else if (move.buffTarget === 'opponent' && move.buffs[1] < 0) buffEffect = Math.abs(move.buffs[1]) * (80 / move.energy);
        let multiplier = 1;
        if (buffEffect > 0) multiplier = (this.game.simulator.buffDivisor + buffEffect * move.buffApplyChance) / this.game.simulator.buffDivisor;
        move.dpe *= multiplier;
      }
    } else {
      move.eps = move.energyGain / (move.cooldown / 500);
      move.deps = move.dps * move.eps;
    }
  }

  /** Pokemon.resetMoves: inicializa daños y ordena los ataques cargados como PvPoke. */
  resetMoves(): void {
    for (const m of this.fastMovePool) this.initializeMove(m);
    for (const m of this.chargedMovePool) this.initializeMove(m);

    this.activeChargedMoves = [];
    if (this.chargedMoves.filter((m) => m != null).length > 0) {
      for (let i = 0; i < this.chargedMoves.length; i++) {
        const cm = this.chargedMoves[i];
        if (!cm) continue;
        if (cm.buffs && cm.buffApplyChance < 1) {
          cm.buffApplyMeter = cm.buffApplyChance;
          if (cm.buffApplyChance === 0.5) cm.buffApplyMeter = 0;
        }
        this.activeChargedMoves.push(cm);
      }
      const acm = this.activeChargedMoves;
      acm.sort((a, b) => (a.energy > b.energy ? 1 : b.energy > a.energy ? -1 : 0));
      this.fastestChargedMove = acm[0];

      if (acm.length > 1) {
        for (let i = 1; i < acm.length; i++) {
          if (acm[i].energy === acm[0].energy && !acm[i].selfDebuffing) {
            if (acm[i].buffs || acm[i].damage > acm[0].damage) {
              const move = acm[0];
              acm.splice(0, 1);
              acm.push(move);
            }
          }
          if (acm[i].energy === acm[0].energy && acm[0].buffs && acm[i].buffs && !acm[i].selfDebuffing && acm[0].buffs && acm[i].buffApplyChance > acm[0].buffApplyChance) {
            const move = acm[0];
            acm.splice(0, 1);
            acm.push(move);
          }
          // La cláusula del Registeel con Zap Cannon: trata Focus Blast como si tuviera efecto negativo
          if (acm[0].moveId === 'FOCUS_BLAST' && acm[i].moveId === 'ZAP_CANNON') {
            if (acm[i].dpe - acm[0].dpe > -0.3) {
              acm[0].buffs = [0, 0];
              acm[0].buffTarget = 'self';
              acm[0].selfDebuffing = true;
            } else {
              delete acm[0].buffs;
              delete acm[0].buffTarget;
              acm[0].selfDebuffing = false;
            }
          }
          if (acm[i].energy - acm[0].energy <= 10 && !acm[i].selfDebuffing) {
            if (acm[i].selfBuffing && acm[0].dpe - acm[i].dpe < 0.3) {
              const move = acm[0];
              acm.splice(0, 1);
              acm.push(move);
            }
          }
          if (acm[i].energy - acm[0].energy <= 10 && acm[0].selfAttackDebuffing && !acm[i].selfDebuffing) {
            const move = acm[0];
            acm.splice(0, 1);
            acm.push(move);
          }
          if (acm[i].energy - acm[0].energy <= 10 && acm[0].selfDebuffing && acm[0].energy > 50 && !acm[i].selfDebuffing) {
            const move = acm[0];
            acm.splice(0, 1);
            acm.push(move);
          }
          if (acm[i].energy - acm[0].energy <= 5 && acm[i].selfBuffing) {
            const move = acm[0];
            acm.splice(0, 1);
            acm.push(move);
          }
        }
      }

      this.bestChargedMove = acm[0];
      this.bestChargedMove.dpe = this.bestChargedMove.damage / this.bestChargedMove.energy;
      for (let i = 0; i < acm.length; i++) {
        const move = acm[i];
        move.dpe = move.damage / move.energy;
        if ((move.dpe - this.bestChargedMove.dpe > 0.03 && move.moveId !== 'SUPER_POWER') || move.dpe - this.bestChargedMove.dpe > 0.3) {
          if (!this.bestChargedMove.selfBuffing || (this.bestChargedMove.selfBuffing && move.dpe - this.bestChargedMove.dpe > 0.3)) this.bestChargedMove = acm[i];
        }
        if (Math.abs(move.dpe - this.bestChargedMove.dpe) < 0.03 && this.bestChargedMove.buffs && move.buffs && move.buffApplyChance > this.bestChargedMove.buffApplyChance && !move.selfDebuffing) {
          this.bestChargedMove = acm[i];
        }
        if (acm[i].moveId === 'OBSTRUCT') this.bestChargedMove = acm[i];
      }
      if (acm[0].moveId === 'OBSTRUCT' && acm[0].energy - this.bestChargedMove.energy <= 5 && acm[0].dpe / this.bestChargedMove.dpe > 0.2) this.bestChargedMove = acm[0];
    } else {
      this.bestChargedMove = null;
    }
  }
}

/** DamageCalculator.damage (modo simulate). */
export function damage(attacker: SimPokemon, defender: SimPokemon, move: SimMove, charge = 1): number {
  const c = attacker.consts;
  const effectiveness = defender.typeEffectiveness[move.type];
  const attackStat = attacker.getEffectiveStat(0);
  const defenseStat = defender.getEffectiveStat(1);
  const isMegaMove = attacker.hasTag('mega') && move.isMegaMove;
  const megaMultiplier = isMegaMove ? MEGA_BONUS[(attacker.hasTag('supermega') ? 4 : 3) - 1] : 1;
  if (move.damageMethod === 'percentMaxHP') return Math.floor((move.power / 100) * defender.stats.hp) + 1;
  return Math.floor(move.power * move.stab * (attackStat / defenseStat) * effectiveness * charge * megaMultiplier * 0.5 * c.bonus) + 1;
}

/** Bono de los ataques mega según nivel de mega (DamageMultiplier.MEGA_BONUS de PvPoke). */
const MEGA_BONUS = [1, 1.10000002384185791015625, 1.2000000476837158203125, 1.2999999523162841796875];
