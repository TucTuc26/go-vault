import type { SimMonSpec } from '../sim';

/** Escenarios de escudos simulados (propio vs rival): 0v0, 1v1, 2v2 — el orden es el índice en las filas de la matriz. */
export const SHIELD_SCENARIOS = [0, 1, 2] as const;
/** Peso de cada escenario al colapsar la matriz (0 escudos, 1 escudo, 2 escudos). */
export const SCENARIO_WEIGHTS = [0.25, 0.5, 0.25] as const;

export type MoveMode = 'current' | 'recommended';

export interface Candidate {
  /** Id único (registro + etapa). */
  key: string;
  recordId: number | null;
  /** Id de especie simulada (con _shadow si corresponde). */
  speciesId: string;
  /** Especie base (sin sombra): evita repetir especie en un equipo. */
  baseId: string;
  dex: number;
  shadow: boolean;
  label: string;
  nickname: string | null;
  ivs: { atk: number; def: number; hp: number };
  level: number;
  cp: number;
  fast: string;
  charged: string[];
  /** Nombre de la liga evaluada (clave del ranking). */
  leagueKey: string;
  /** Costo (texto estructurado) para llegar a este nivel/etapa/ataques desde el estado actual. */
  cost: CandidateCost;
  /** Aviso (p. ej. IVs inciertos, ataques recomendados que requieren MT élite). */
  notes: string[];
  /** Firma para la caché de la matriz. */
  sig: string;
}

export interface CandidateCost {
  stardust: number;
  candy: number;
  xlCandy: number;
  eliteTm: number;
  secondMove: boolean;
  needsEvolution: boolean;
  alreadyOptimal: boolean;
}

export interface Opponent {
  speciesId: string;
  pos: number;
  weight: number;
  spec: Omit<SimMonSpec, 'shields'>;
}

/** Fila de la matriz de un candidato: ratings (0–1000) por oponente y escenario: índice = o*3 + s. */
export type MatrixRow = number[];

export interface TeamResult {
  members: Candidate[];
  score: number;
  /** Cobertura ponderada: fracción de amenazas que algún miembro vence (calificación > 500). */
  coverage: number;
  roles: { lead: Candidate; swap: Candidate; closer: Candidate };
  uncovered: { speciesId: string; best: number }[];
  sharedWeaknesses: { type: string; members: number }[];
  explanation: string;
}

export interface MissingAdvice {
  speciesId: string;
  pos: number;
  delta: number;
  replaces: string;
  newScore: number;
}
