import type { DataBundle } from '../data/loader';
import type { GameData, RankingFile, Species } from '../data/schemas';

export interface IVs { atk: number; def: number; hp: number }
export type StatKey = keyof IVs;
export const STAT_KEYS: StatKey[] = ['atk', 'def', 'hp'];

/** Cómo se obtuvo el Pokémon (determina el piso de IV). */
export type Origin =
  | 'unknown' | 'wild' | 'weather' | 'egg' | 'raid' | 'research' | 'rocket' | 'giovanni'
  | 'trade_good' | 'trade_great' | 'trade_ultra' | 'trade_best' | 'lucky_trade' | 'purified';

export interface PokemonFlags {
  shadow?: boolean;
  purified?: boolean;
  lucky?: boolean;
  shiny?: boolean;
  /** El nivel mostrado incluye el +1 de Mejor Amigo (nivel 51). */
  bestBuddy?: boolean;
  xxl?: boolean;
  xxs?: boolean;
  costume?: boolean;
}

/** Contexto de datos que necesita el motor (puro, sin red). */
export interface EngineCtx {
  game: GameData;
  speciesById: Map<string, Species>;
  /** Rankings ya cargados, por clave (`all-1500`, `mega-1500`…). */
  rankings: Record<string, RankingFile | undefined>;
}

export type DataLike = Pick<DataBundle, 'game' | 'speciesById'>;

export interface LeagueSpec {
  /** Clave del ranking: `all-1500`, `little-500`… */
  key: string;
  cpCap: number;
  /** Tope de nivel propio de la copa (por defecto el de la cuenta). */
  levelCap?: number;
  title?: string;
}

export interface Appraisal {
  /** 1..4 según la suma de IVs (frase general). */
  overall?: 1 | 2 | 3 | 4;
  /** Stats señalados como mejores en la frase (empates posibles). */
  bestStats?: StatKey[];
  /** 1..4 según el valor del mejor stat (frase del stat destacado). */
  bestStatTier?: 1 | 2 | 3 | 4;
  /** Banda de cada barra: 0 (0–5), 1 (6–10), 2 (11–14), 3 (15). */
  bars?: Partial<Record<StatKey, 0 | 1 | 2 | 3>>;
}

export interface Candidate {
  level: number;
  ivs: IVs;
}
