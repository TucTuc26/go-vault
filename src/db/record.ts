import { spriteUrl } from '../data/names';
import { roleKey, SavedPokemonSchema, type Role, type SavedPokemon } from './types';
import { ivPercent } from '../engine/stats';
import type { PokemonDraft } from '../providers/pipeline';
import type { Species } from '../data/schemas';

export interface BuildRecordInput {
  draft: PokemonDraft;
  species: Species;
  roles: Role[];
  dataVersion: string;
  nowIso?: string;
  notes?: string;
}

/** Convierte el borrador + roles en un registro de solo texto listo para IndexedDB. */
export function buildRecord(inp: BuildRecordInput): SavedPokemon {
  const { draft, species } = inp;
  const now = inp.nowIso ?? new Date().toISOString();
  const ap = draft.appraisal;
  const levels = draft.candidates.map((c) => c.level);
  const percent = draft.ivs ? ivPercent(draft.ivs) : draft.ivPercentRange ? (draft.ivPercentRange[0] + draft.ivPercentRange[1]) / 2 : null;
  const f = draft.flags;
  const rec: SavedPokemon = {
    speciesId: species.baseId,
    name: draft.speciesName || species.name,
    nickname: draft.nickname,
    spriteUrl: spriteUrl(species.dex),
    cp: draft.cp,
    hp: draft.hp,
    level: draft.level,
    levelRange: levels.length ? [Math.min(...levels), Math.max(...levels)] : null,
    ivs: draft.ivs,
    ivsExact: draft.ivsExact,
    ivCandidates: draft.ivs ? [] : draft.candidates.slice(0, 80).map((c) => ({ level: c.level, atk: c.ivs.atk, def: c.ivs.def, hp: c.ivs.hp })),
    ivPercent: percent,
    ivPercentRange: draft.ivPercentRange,
    appraisal: ap
      ? {
          ...(ap.overall !== undefined ? { overall: ap.overall } : {}),
          ...(ap.bestStats ? { bestStats: ap.bestStats } : {}),
          ...(ap.bestStatTier !== undefined ? { bestStatTier: ap.bestStatTier } : {}),
          ...(ap.bars ? { bars: Object.fromEntries(Object.entries(ap.bars).filter(([, v]) => v !== undefined)) as { atk?: number; def?: number; hp?: number } } : {}),
        }
      : null,
    flags: {
      shadow: !!f.shadow, purified: !!f.purified, lucky: !!f.lucky, shiny: !!f.shiny, bestBuddy: !!f.bestBuddy,
      xxl: !!f.xxl, xxs: !!f.xxs, costume: !!f.costume, background: !!f.background,
    },
    moves: { fast: draft.moves.fast, charged: draft.moves.charged },
    origin: draft.origin,
    roles: inp.roles,
    roleKeys: inp.roles.map((r) => roleKey(r, species.baseId)),
    notes: inp.notes ?? '',
    dataVersion: inp.dataVersion,
    createdAt: now,
    updatedAt: now,
  };
  return SavedPokemonSchema.parse(rec);
}
