import { z } from 'zod';

/** Esquemas Zod de los JSON normalizados que genera scripts/fetch-data.ts y lee la app. */

export const TypeId = z.string(); // 'fire', 'water', ... (minúsculas)

export const GameDataSchema = z.object({
  /** cpm de niveles enteros: índice 0 = nivel 1 (fuente: PLAYER_LEVEL_SETTINGS). */
  cpmWhole: z.array(z.number().positive()).min(51),
  powerUp: z.object({
    /** Un valor por cada medio nivel de mejora (índice 0 = 1 → 1.5). */
    candy: z.array(z.number()),
    stardust: z.array(z.number()),
    /** Caramelos XL; se aplican desde `xlCandyMinPokemonLevel`. */
    xlCandy: z.array(z.number()),
    upgradesPerLevel: z.number(),
    maxNormalUpgradeLevel: z.number(),
    allowedLevelsAbovePlayer: z.number(),
    xlCandyMinPlayerLevel: z.number(),
    xlCandyMinPokemonLevel: z.number(),
    defaultCpBoostAdditionalLevel: z.number().optional(),
    shadowStardustMultiplier: z.number(),
    shadowCandyMultiplier: z.number(),
    purifiedStardustMultiplier: z.number(),
    purifiedCandyMultiplier: z.number(),
    luckyStardustMultiplier: z.number(),
  }),
  combat: z.object({
    shadowAttackMultiplier: z.number(),
    shadowDefenseMultiplier: z.number(),
    stab: z.number(),
    fastAttackBonus: z.number().optional(),
    chargeAttackBonus: z.number().optional(),
  }),
  weather: z.object({
    attackBonus: z.number(),
    guaranteedIvs: z.number(),
    raidGuaranteedIvs: z.number(),
    cpBaseLevelBonus: z.number(),
    raidCpBaseLevelBonus: z.number(),
    byWeather: z.record(z.string(), z.array(z.string())),
  }),
  friendship: z.array(z.object({ level: z.number(), attackBonus: z.number() })),
  /** Orden de tipos del juego y matriz [atacante][defensor] de multiplicadores. */
  typeOrder: z.array(z.string()),
  typeChart: z.record(z.string(), z.array(z.number())),
  /** Topes de CP de las ligas estándar según COMBAT_LEAGUE_DEFAULT_*. */
  leagues: z.array(z.object({ id: z.string(), cpCap: z.number(), title: z.string() })),
  /** Parámetros del simulador de PvPoke (gamemaster/base.json). */
  simulator: z.object({
    partySize: z.number(),
    maxBuffStages: z.number(),
    buffDivisor: z.number(),
  }),
});
export type GameData = z.infer<typeof GameDataSchema>;

export const EvolutionSchema = z.object({
  to: z.string(),
  candy: z.number().nullable(),
  candyPurified: z.number().nullable(),
  item: z.string().nullable(),
  buddyKm: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type Evolution = z.infer<typeof EvolutionSchema>;

export const SpeciesSchema = z.object({
  id: z.string(),
  dex: z.number().int(),
  name: z.string(),
  /** speciesId sin sufijo _shadow */
  baseId: z.string(),
  shadow: z.boolean(),
  shadowEligible: z.boolean(),
  types: z.array(z.string()).min(1).max(2),
  atk: z.number().positive(),
  def: z.number().positive(),
  hp: z.number().positive(),
  fast: z.array(z.string()),
  charged: z.array(z.string()),
  /** Ataques que requieren TM Élite / ya no se obtienen normalmente. */
  elite: z.array(z.string()),
  /** Costo de desbloquear el 2.º ataque cargado. */
  thirdMove: z.object({ stardust: z.number(), candy: z.number().nullable() }).nullable(),
  family: z.object({
    id: z.string().nullable(),
    parent: z.string().nullable(),
    evolutions: z.array(EvolutionSchema),
  }),
  tags: z.array(z.string()),
  released: z.boolean(),
  levelFloor: z.number().optional(),
  /** Mínimo CP requerido para ligas "Little" y similares viene del ranking, no de aquí. */
  buddyKm: z.number().nullable().optional(),
});
export type Species = z.infer<typeof SpeciesSchema>;

export const MoveSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  power: z.number(),
  energy: z.number(),
  energyGain: z.number(),
  cooldown: z.number(),
  turns: z.number().optional(),
  buffs: z.array(z.number()).optional(),
  buffTarget: z.string().optional(),
  buffApplyChance: z.string().optional(),
  archetype: z.string().optional(),
  /** Datos PvE (raids/gimnasios) del Game Master del juego, si existen. */
  pve: z
    .object({ power: z.number(), durationMs: z.number(), energy: z.number(), windowStartMs: z.number().optional() })
    .optional(),
});
export type Move = z.infer<typeof MoveSchema>;

export const FormatSchema = z.object({
  title: z.string(),
  cup: z.string(),
  cp: z.number(),
  meta: z.string().optional(),
  rules: z.array(z.string()).optional(),
  hideRankings: z.boolean().optional(),
  /** Slug del archivo de ranking (`rankings/<key>.json`) o null si no existe. */
  rankingKey: z.string().nullable(),
});
export type Format = z.infer<typeof FormatSchema>;

export const RankingEntrySchema = z.object({
  id: z.string(),
  rating: z.number(),
  score: z.number(),
  moveset: z.array(z.string()),
  product: z.number(),
  atk: z.number(),
  def: z.number(),
  hp: z.number(),
  /** Solo para los primeros N: matchups y counters. */
  matchups: z.array(z.object({ id: z.string(), rating: z.number() })).optional(),
  counters: z.array(z.object({ id: z.string(), rating: z.number() })).optional(),
  /** Ataques más usados (para alternativas sin legacy). */
  fastUse: z.array(z.string()).optional(),
  chargedUse: z.array(z.string()).optional(),
});
export type RankingEntry = z.infer<typeof RankingEntrySchema>;

export const RankingFileSchema = z.object({
  key: z.string(),
  cup: z.string(),
  cp: z.number(),
  entries: z.array(RankingEntrySchema).min(1),
});
export type RankingFile = z.infer<typeof RankingFileSchema>;

export const CupSchema = z.object({
  name: z.string(),
  title: z.string(),
  levelCap: z.number().optional(),
  include: z.array(z.any()).optional(),
  exclude: z.array(z.any()).optional(),
});
export type Cup = z.infer<typeof CupSchema>;

export const NamesSchema = z.object({
  /** dex → nombre en español (especie base). */
  species: z.record(z.string(), z.string()),
  /** MOVE_ID → nombre en español. */
  moves: z.record(z.string(), z.string()),
});
export type Names = z.infer<typeof NamesSchema>;

export const SourceInfoSchema = z.object({
  name: z.string(),
  url: z.string(),
  license: z.string(),
  version: z.string(),
  fetchedAt: z.string(),
});

export const ManifestSchema = z.object({
  schema: z.literal(1),
  builtAt: z.string(),
  /** Hash combinado de todos los archivos: cambia si cambia cualquier dato. */
  dataVersion: z.string(),
  sources: z.array(SourceInfoSchema),
  files: z.record(z.string(), z.object({ hash: z.string(), bytes: z.number() })),
  rankings: z.array(z.object({ key: z.string(), cup: z.string(), cp: z.number(), title: z.string(), count: z.number() })),
  warnings: z.array(z.string()),
});
export type Manifest = z.infer<typeof ManifestSchema>;
