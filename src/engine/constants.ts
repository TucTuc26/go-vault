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

/**
 * Valoración (apreciación) del juego. Fuentes: Bulbapedia "Appraisal" y HowToGeek/iMore
 * (suma de IVs sobre 45): tramo 1 = 0–22 (≤48.9 %), 2 = 23–29 (51.1–64.4 %), 3 = 30–36 (66.7–80 %), 4 = 37–45 (82.2–100 %).
 */
export const APPRAISAL_OVERALL_BANDS: readonly (readonly [number, number])[] = [
  [0, 22], [23, 29], [30, 36], [37, 45],
];
/** Frase del stat destacado según el valor del mejor IV: 0–7, 8–12, 13–14, 15 (Bulbapedia "Appraisal"). */
export const APPRAISAL_BEST_STAT_BANDS: readonly (readonly [number, number])[] = [
  [0, 7], [8, 12], [13, 14], [15, 15],
];
/** Barras de cada stat: 0–5, 6–10, 11–14, 15 (PokéCommunity/Bulbapedia; segmento completo en 15). */
export const APPRAISAL_BAR_BANDS: readonly (readonly [number, number])[] = [
  [0, 5], [6, 10], [11, 14], [15, 15],
];

/**
 * Piso de IV según el origen. Los valores marcados GM también están en game.json (WEATHER_BONUS_SETTINGS)
 * y se prefieren cuando existen. Fuentes: Dittobase "IV floors", Pokémon GO Hub "IV floors", Dexerto
 * (verificadas 2026-10): huevo/incursión/investigación 10; intercambio Bueno/Genial/Ultra/Mejor 1/2/3/5;
 * intercambio de suerte 12; Giovanni/incursión sombra 6; Rocket (reclutas/líderes) 0; purificado +2 a cada IV.
 * ⚠ Los valores de Rocket y de intercambio pueden cambiar con eventos: ver DECISIONS.md.
 */
export const IV_FLOOR_BY_ORIGIN: Record<string, number> = {
  unknown: 0, wild: 0, weather: 4, egg: 10, raid: 10, research: 10, rocket: 0, giovanni: 6,
  trade_good: 1, trade_great: 2, trade_ultra: 3, trade_best: 5, lucky_trade: 12, purified: 2,
};
/** Purificar suma 2 a cada IV (máx. 15). Fuente: Pokémon GO Hub / Bulbapedia "Purification". */
export const PURIFY_IV_BONUS = 2;

/**
 * Tamaños XXS/XXL: son solo visuales; no alteran CP, stats ni rendimiento en combate.
 * Fuente: Serebii "Pokémon Size Variance" / Niantic (oct-2022). Se guardan como etiqueta.
 */
export const SIZE_AFFECTS_STATS = false;

/**
 * Redondeo de costos con multiplicadores (sombra ×1.2, purificado ×0.9, suerte ×0.5):
 * el juego redondea al entero más cercano por paso. ⚠ Sin fuente oficial; ver DECISIONS.md.
 */
export const roundCost = (x: number): number => Math.round(x);

/**
 * Fórmula de daño del juego (PvE y PvP): daño = floor(0.5 · poder · atk/def · STAB · efectividad) + 1.
 * Fuente: Bulbapedia "Damage" (Pokémon GO) / PvPoke DamageCalculator. El STAB y la efectividad salen de datos (game.json).
 */
export const DAMAGE_HALF = 0.5;
export const DAMAGE_BONUS = 1;

/**
 * Parámetros de la ESTIMACIÓN propia de ataque/resistencia en raids (no oficial; se etiqueta "estimación").
 * defensa del jefe de referencia y exponente que da más peso al DPS que al TDO (puntaje = DPS^0.75 · TDO^0.25).
 */
export const RAID_ESTIMATE = { bossDefense: 160, dpsWeight: 0.75, tdoWeight: 0.25, incomingDpsScale: 1 } as const;
