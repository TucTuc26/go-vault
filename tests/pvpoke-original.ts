/**
 * Ejecuta el simulador ORIGINAL de PvPoke (JavaScript, MIT; copia en tests/vendor/pvpoke) dentro de un contexto `vm`
 * para usarlo como oráculo del port a TypeScript. Solo para tests.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameData, Move, Species } from '../src/data/schemas';

const V = join(__dirname, 'vendor', 'pvpoke');
const read = (f: string) => readFileSync(join(V, f), 'utf8');

export interface OriginalSpec {
  cp: number;
  levelCap?: number;
  a: OriginalMon;
  b: OriginalMon;
}
export interface OriginalMon {
  id: string;
  ivs: { atk: number; def: number; hp: number };
  level: number;
  fast: string;
  charged: string[];
  shields: number;
  bait?: number;
}
export interface OriginalResult {
  hp: [number, number];
  energy: [number, number];
  shields: [number, number];
  buffs: [number[], number[]];
  stats: [{ atk: number; def: number; hp: number }, { atk: number; def: number; hp: number }];
  ratings: [number, number];
  turns: number;
  turnsToWin: [number, number];
  winner: 0 | 1 | -1;
  /** Orden de movimientos cargados activos (para comprobar el ordenamiento de PvPoke). */
  activeCharged: [string[], string[]];
  bestCharged: [string, string];
  timeline: { type: string; name: string; actor: number; turn: number }[];
}

const toPvPokeMove = (m: Move) => ({
  moveId: m.id, name: m.name, type: m.type, power: m.power, energy: m.energy, energyGain: m.energyGain, cooldown: m.cooldown, turns: m.turns,
  ...(m.buffs ? { buffs: m.buffs, buffTarget: m.buffTarget, buffApplyChance: m.buffApplyChance } : {}),
  ...(m.category ? { category: m.category } : {}), ...(m.damageMethod ? { damageMethod: m.damageMethod } : {}),
  ...(m.buffsSelf ? { buffsSelf: m.buffsSelf } : {}), ...(m.buffsOpponent ? { buffsOpponent: m.buffsOpponent } : {}),
  ...(m.tags ? { tags: m.tags } : {}), ...(m.isMegaMove ? { isMegaMove: true } : {}),
});

const toPvPokePokemon = (s: Species) => ({
  dex: s.dex, speciesName: s.name, speciesId: s.id, baseStats: { atk: s.atk, def: s.def, hp: s.hp },
  types: s.types.length > 1 ? s.types : [s.types[0], 'none'], fastMoves: s.fast, chargedMoves: s.charged, tags: s.tags,
  buddyDistance: 1, thirdMoveCost: 50000, released: s.released, level25CP: 0, defaultIVs: { cp500: [1, 0, 0, 0], cp1500: [1, 0, 0, 0], cp2500: [1, 0, 0, 0] },
  ...(s.levelFloor ? { levelFloor: s.levelFloor } : {}),
});

export function createOriginal(data: { species: Species[]; moves: Move[]; game: GameData }) {
  const DATA = {
    pokemon: data.species.map(toPvPokePokemon),
    moves: data.moves.map(toPvPokeMove),
    settings: { maxBuffStages: data.game.simulator.maxBuffStages, buffDivisor: data.game.simulator.buffDivisor, partySize: data.game.simulator.partySize },
    cups: [], formats: [],
  };
  const noop = () => {};
  const sandbox: Record<string, unknown> = {
    console: { log: noop, error: noop, warn: noop, info: noop },
    DATA: JSON.parse(JSON.stringify(DATA)),
    Math, JSON, Map, Set, Array, Object, parseInt, parseFloat, String, Number, Date, Infinity, isNaN,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    window: {}, interface: undefined,
  };
  const ctx = vm.createContext(sandbox);
  const run = (code: string, name: string) => vm.runInContext(code, ctx, { filename: name });
  for (const f of ['TimelineEvent.js', 'TimelineAction.js', 'DamageCalculator.js', 'ActionLogic.js', 'Pokemon.js', 'Battle.js']) run(read(f), f);
  run(
    `var GameMaster = (function(){ var inst; function create(){ var object = {}; object.data = DATA;
      object.pokemonMap = new Map(DATA.pokemon.map(function(p){ return [p.speciesId, p]; }));
      object.moveMap = new Map(DATA.moves.map(function(m){ return [m.moveId, m]; }));
      ${read('getMoveById.snippet.js')}
      object.getPokemonById = function(id){ id = id.replace("_xl", ""); return object.pokemonMap.get(id); };
      return object; }
      return { getInstance: function(){ if(!inst){ inst = create(); } return inst; } }; })();`,
    'GameMasterStub',
  );
  run(
    `function __run(SPEC){
      var battle = new Battle(); battle.setCP(SPEC.cp);
      if (SPEC.levelCap) battle.setLevelCap(SPEC.levelCap);
      function mk(p, i){
        var poke = new Pokemon(p.id, i, battle);
        poke.initialize(battle.getCP());
        poke.ivs.atk = p.ivs.atk; poke.ivs.def = p.ivs.def; poke.ivs.hp = p.ivs.hp;
        poke.setLevel(p.level);
        poke.selectMove("fast", p.fast);
        poke.selectMove("charged", p.charged[0], 0);
        if (p.charged[1]) poke.selectMove("charged", p.charged[1], 1);
        poke.startingShields = p.shields;
        if (p.bait !== undefined) poke.baitShields = p.bait;
        return poke;
      }
      var a = mk(SPEC.a, 0), b = mk(SPEC.b, 1);
      battle.setNewPokemon(a, 0, false); battle.setNewPokemon(b, 1, false);
      var tl = battle.simulate();
      var r = battle.getBattleRatings();
      var w = battle.getWinner();
      return JSON.stringify({
        hp: [a.hp, b.hp], energy: [a.energy, b.energy], shields: [a.shields, b.shields],
        buffs: [a.statBuffs, b.statBuffs],
        stats: [a.stats, b.stats], ratings: r, turns: battle.getTurns(), turnsToWin: battle.getTurnsToWin(),
        winner: w.pokemon === false ? -1 : w.pokemon.index,
        activeCharged: [a.activeChargedMoves.map(function(m){return m.moveId;}), b.activeChargedMoves.map(function(m){return m.moveId;})],
        bestCharged: [a.bestChargedMove ? a.bestChargedMove.moveId : '', b.bestChargedMove ? b.bestChargedMove.moveId : ''],
        timeline: tl.map(function(e){ return { type: e.type, name: e.name, actor: e.actor, turn: e.turn }; })
      });
    }`,
    'runner',
  );
  return {
    simulate(spec: OriginalSpec): OriginalResult {
      (sandbox as { __spec?: unknown }).__spec = spec;
      return JSON.parse(vm.runInContext('__run(__spec)', ctx)) as OriginalResult;
    },
    /** Constantes de cpm hard-codeadas en Pokemon.js. */
    cpms: (): number[] => JSON.parse(vm.runInContext('(function(){ var p = new Pokemon("pidgey", 0, { getLevelCap: function(){return 50;}, getCP: function(){return 1500;}, getOpponent: function(){return null;} }); return JSON.stringify([0.5]); })()', ctx)) as number[],
    ctx,
  };
}

/** Lee la tabla de cpm literal del archivo original (Pokemon.js). */
export function originalCpmTable(): number[] {
  const m = read('Pokemon.js').match(/var cpms = \[([^\]]+)\]/);
  if (!m) throw new Error('No se encontró la tabla de cpm en Pokemon.js');
  return m[1].split(',').map((x) => Number(x.trim()));
}
