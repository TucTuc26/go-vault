import { addPokemon, addReview, undoHandle, updatePokemon, type GoVaultDB } from '../db/db';
import { buildRecord } from '../db/record';
import type { SavedPokemon } from '../db/types';
import { computeRoles, evaluateVerdict, type EvalInput, type Verdict, type VerdictEnv, type VerdictSettings } from '../engine/verdict';
import type { IVs } from '../engine/types';
import { processScan, type PipelineDeps, type PipelineOptions, type ProcessedEntry } from '../providers/pipeline';
import type { ScanResult } from '../providers/schema';

export interface IntakeEnv {
  deps: PipelineDeps;
  verdictEnv: VerdictEnv;
  settings: VerdictSettings;
  dataVersion: string;
  db: GoVaultDB;
  pipelineOptions?: PipelineOptions;
}

export type IntakeOutcome =
  | { kind: 'saved'; entry: ProcessedEntry; verdict: Verdict; id: number; undo: () => Promise<void> }
  | { kind: 'skipped'; entry: ProcessedEntry; verdict: Verdict }
  | { kind: 'maybe'; entry: ProcessedEntry; verdict: Verdict }
  | { kind: 'review'; entry: ProcessedEntry; reviewId: number };

/** IVs a evaluar: exactos, o los distintos de los candidatos. */
export function ivSetsOf(entry: ProcessedEntry): IVs[] {
  const d = entry.draft;
  if (d.ivs) return [d.ivs];
  const seen = new Map<string, IVs>();
  for (const c of d.candidates) seen.set(`${c.ivs.atk}/${c.ivs.def}/${c.ivs.hp}`, c.ivs);
  return [...seen.values()];
}

export function evalInputOf(entry: ProcessedEntry): EvalInput {
  const d = entry.draft;
  return { speciesId: d.speciesId, ivSets: ivSetsOf(entry), flags: d.flags, moves: d.moves, cp: d.cp, question: entry.inference?.question ?? null };
}

/**
 * Flujo común a todos los proveedores: lectura → coherencia (motor) → veredicto → guardar (con "Deshacer") o descartar
 * sin escribir nada, o a la cola "Por revisar" (solo texto).
 */
export async function ingest(env: IntakeEnv, scan: ScanResult): Promise<IntakeOutcome> {
  const entry = processScan(env.deps, scan, { playerLevel: env.settings.playerLevel, ...env.pipelineOptions });
  if (entry.status === 'review') {
    const reviewId = await addReview(env.db, { sourceId: scan.sourceId, reasons: entry.reasons, draft: entry.draft, scan });
    return { kind: 'review', entry, reviewId };
  }
  const collection = await env.db.pokemon.toArray();
  const verdict = evaluateVerdict(env.verdictEnv, evalInputOf(entry), collection, env.settings, entry.draft.level);
  if (verdict.status === 'save') {
    const species = env.deps.ctx.speciesById.get(entry.draft.speciesId)!;
    const id = await addPokemon(env.db, buildRecord({ draft: entry.draft, species, roles: verdict.roles, dataVersion: env.dataVersion }));
    const h = undoHandle(env.db, id);
    return { kind: 'saved', entry, verdict, id, undo: h.undo };
  }
  return verdict.status === 'maybe' ? { kind: 'maybe', entry, verdict } : { kind: 'skipped', entry, verdict };
}

/** "Guardar de todos modos": registro con el rol manual, aunque no sirva. */
export async function forceSave(env: IntakeEnv, entry: ProcessedEntry, existingRoles: SavedPokemon['roles'] = []): Promise<number> {
  const species = env.deps.ctx.speciesById.get(entry.draft.speciesId);
  if (!species) throw new Error('Falta la especie');
  return addPokemon(env.db, buildRecord({ draft: entry.draft, species, roles: [...existingRoles, { kind: 'manual' }], dataVersion: env.dataVersion }));
}

/**
 * Edición de un registro existente: reinterpreta el formulario, recalcula roles (conservando los manuales)
 * y actualiza el mismo registro (id y fecha de creación se mantienen).
 */
export async function editRecord(env: IntakeEnv, id: number, scan: ScanResult): Promise<{ ok: true; entry: ProcessedEntry } | { ok: false; reasons: string[] }> {
  const cur = await env.db.pokemon.get(id);
  if (!cur) return { ok: false, reasons: ['El registro ya no existe'] };
  const entry = processScan(env.deps, scan, { playerLevel: env.settings.playerLevel, ...env.pipelineOptions });
  if (!entry.draft.speciesId || entry.doubtful) return { ok: false, reasons: entry.reasons.length ? entry.reasons : ['No se pudo interpretar'] };
  const species = env.deps.ctx.speciesById.get(entry.draft.speciesId)!;
  const others = (await env.db.pokemon.toArray()).filter((p) => p.id !== id);
  const input = evalInputOf(entry);
  const { sure } = computeRoles(env.verdictEnv, input, input.ivSets, env.settings, others);
  const manual = cur.roles.filter((r) => r.kind === 'manual');
  const rec = buildRecord({ draft: entry.draft, species, roles: [...sure, ...manual], dataVersion: env.dataVersion, nowIso: cur.createdAt, notes: cur.notes });
  await updatePokemon(env.db, id, { ...rec, id, createdAt: cur.createdAt });
  return { ok: true, entry };
}
