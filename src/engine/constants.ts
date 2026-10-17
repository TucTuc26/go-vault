/**
 * Constantes inevitables (regla 3: nada de reglas del juego hardcodeadas en la lógica).
 * Cada una documenta su fuente y tiene un test en tests/constants.test.ts.
 */

/**
 * Orden de los tipos en los arreglos `attackScalar` de POKEMON_TYPE_* del Game Master.
 * Fuente: enum PokemonType del juego (NORMAL=1 … FAIRY=18); verificado contra la matriz
 * (p. ej. FUEGO vs PLANTA = 1.6, NORMAL vs FANTASMA = 0.390625) en tests/constants.test.ts.
 */
export const GM_TYPE_ORDER = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const;

/**
 * Los niveles con medio paso no vienen en el Game Master (solo enteros). El juego y PvPoke
 * los interpolan: cpm(L+0.5) = sqrt((cpm(L)^2 + cpm(L+1)^2) / 2).
 * Fuente: src/js/pokemon/Pokemon.js de PvPoke (MIT) y tabla de niveles de GamePress/Bulbapedia;
 * test: cpm(1.5)=0.1351374318, cpm(40.5)=0.7953000, cpm(50.5)=0.8428.
 */
export function halfLevelCpm(cpmLow: number, cpmHigh: number): number {
  return Math.sqrt((cpmLow * cpmLow + cpmHigh * cpmHigh) / 2);
}

/** Niveles son múltiplos de 0.5; el índice en la tabla de cpm es (nivel-1)*2. */
export const LEVEL_STEP = 0.5;
export const MIN_LEVEL = 1;
/** Valores de IV posibles: 0..15 (4096 combinaciones). Regla del juego, no cambia con parches. */
export const IV_MAX = 15;
export const IV_COUNT = 16;
/** Piso de CP y PS (fórmula del juego: max(10, …)). Fuente: CLAUDE.md fase 2 / Bulbapedia "CP". */
export const MIN_CP = 10;
export const MIN_HP = 10;
/** Divisor de la fórmula de CP. Fuente: Bulbapedia "Combat Power" (CP = atk·√def·√sta·cpm²/10). */
export const CP_DIVISOR = 10;

/**
 * Valoración (apreciación) en español/inglés — umbrales oficiales del juego.
 * Fuente: Bulbapedia "Appraisal" / GamePress. Se declaran en src/engine/appraisal.ts.
 */
