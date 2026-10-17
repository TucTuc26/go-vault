import type { SavedPokemon } from '../db/types';
import { computeRoles, describeRole, diffRoles, type EvalInput, type VerdictEnv, type VerdictSettings } from './verdict';
import type { IVs } from './types';

export interface RoleChange {
  id: number;
  speciesId: string;
  name: string;
  gained: string[];
  lost: string[];
  newRoles: SavedPokemon['roles'];
}

export function ivSetsOfRecord(r: SavedPokemon): IVs[] {
  if (r.ivs) return [r.ivs];
  const seen = new Map<string, IVs>();
  for (const c of r.ivCandidates) seen.set(`${c.atk}/${c.def}/${c.hp}`, { atk: c.atk, def: c.def, hp: c.hp });
  return [...seen.values()];
}

/**
 * Reevalúa registros con los datos/ajustes vigentes. NUNCA borra nada: solo informa cambios
 * ("ahora clasifica para Ultra", "salió del meta"). Los roles manuales se conservan.
 */
export function reevaluateRecords(env: VerdictEnv, records: SavedPokemon[], settings: VerdictSettings, nameOf: (id: string) => string = (x) => x): RoleChange[] {
  const out: RoleChange[] = [];
  for (const r of records) {
    if (r.id === undefined) continue;
    const input: EvalInput = {
      speciesId: r.speciesId,
      ivSets: ivSetsOfRecord(r),
      flags: { ...r.flags },
      moves: { fast: r.moves.fast, charged: r.moves.charged },
      cp: r.cp,
    };
    const others = records.filter((x) => x.id !== r.id);
    const { sure } = computeRoles(env, input, input.ivSets, settings, others);
    const keepManual = r.roles.filter((x) => x.kind === 'manual');
    const newRoles = [...sure, ...keepManual];
    const label = (x: SavedPokemon['roles'][number]) => describeRole(x, nameOf);
    const { gained, lost } = diffRoles(r.roles, newRoles, r.speciesId, label);
    if (gained.length || lost.length) out.push({ id: r.id, speciesId: r.speciesId, name: r.name, gained, lost, newRoles });
  }
  return out;
}
