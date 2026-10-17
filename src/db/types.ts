import { z } from 'zod';
import { OriginEnum } from '../providers/schema';

/**
 * Registro guardado: SOLO texto y números. Esquema estricto: cualquier campo de imagen (o desconocido) se rechaza.
 */

export const ShowcaseReasonEnum = z.enum(['hundo', 'nundo', 'shiny', 'lucky', 'xxl', 'xxs', 'costume', 'legacy', 'bestBuddy', 'background', 'first']);
export type ShowcaseReason = z.infer<typeof ShowcaseReasonEnum>;

export const RoleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pvp'),
    leagueKey: z.string(),
    leagueTitle: z.string(),
    stageId: z.string(),
    rankingPos: z.number().int().nullable(),
    ivRank: z.number().int(),
    percentOfBest: z.number(),
    level: z.number(),
    cp: z.number().int(),
    moveset: z.array(z.string()),
    uncertain: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('gym'),
    stageId: z.string(),
    rank: z.number().int(),
    score: z.number(),
    level: z.number(),
    uncertain: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('raid'),
    type: z.string(),
    stageId: z.string(),
    rank: z.number().int(),
    score: z.number(),
    fast: z.string(),
    charged: z.string(),
    /** Siempre true: es una estimación propia, no un dato oficial. */
    estimate: z.literal(true),
    uncertain: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('showcase'), reason: ShowcaseReasonEnum }),
  z.strictObject({ kind: z.literal('manual') }),
]);
export type Role = z.infer<typeof RoleSchema>;

export const IVsSchema = z.strictObject({ atk: z.number().int().min(0).max(15), def: z.number().int().min(0).max(15), hp: z.number().int().min(0).max(15) });

export const SavedPokemonSchema = z.strictObject({
  id: z.number().int().optional(),
  speciesId: z.string(),
  name: z.string(),
  nickname: z.string().nullable(),
  /** URL del sprite de referencia (no es una imagen guardada). */
  spriteUrl: z.string().url(),
  cp: z.number().int().nullable(),
  hp: z.number().int().nullable(),
  level: z.number().nullable(),
  levelRange: z.tuple([z.number(), z.number()]).nullable(),
  ivs: IVsSchema.nullable(),
  ivsExact: z.boolean(),
  /** Candidatos de IV si no son exactos (acotado). */
  ivCandidates: z.array(z.strictObject({ level: z.number(), atk: z.number(), def: z.number(), hp: z.number() })).max(80),
  ivPercent: z.number().nullable(),
  ivPercentRange: z.tuple([z.number(), z.number()]).nullable(),
  appraisal: z
    .strictObject({
      overall: z.number().optional(),
      bestStats: z.array(z.enum(['atk', 'def', 'hp'])).optional(),
      bestStatTier: z.number().optional(),
      bars: z.strictObject({ atk: z.number().optional(), def: z.number().optional(), hp: z.number().optional() }).optional(),
    })
    .nullable(),
  flags: z.strictObject({
    shadow: z.boolean(), purified: z.boolean(), lucky: z.boolean(), shiny: z.boolean(), bestBuddy: z.boolean(),
    xxl: z.boolean(), xxs: z.boolean(), costume: z.boolean(), background: z.boolean(),
  }),
  moves: z.strictObject({ fast: z.string().nullable(), charged: z.array(z.string()) }),
  origin: OriginEnum,
  roles: z.array(RoleSchema),
  /** Claves de roles para filtrar/redundancia (`pvp:all-1500:medicham`, …). */
  roleKeys: z.array(z.string()),
  notes: z.string(),
  dataVersion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedPokemon = z.infer<typeof SavedPokemonSchema>;

export function roleKey(r: Role, speciesBaseId: string): string {
  switch (r.kind) {
    case 'pvp': return `pvp:${r.leagueKey}:${r.stageId}`;
    case 'gym': return `gym:${r.stageId}`;
    case 'raid': return `raid:${r.type}:${r.stageId}`;
    case 'showcase': return `showcase:${r.reason}:${speciesBaseId}`;
    case 'manual': return 'manual';
  }
}
