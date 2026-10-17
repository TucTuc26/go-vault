import { z } from 'zod';
import { SavedPokemonSchema, type SavedPokemon } from '../db/types';
import { getKV, setKV, type GoVaultDB } from '../db/db';

/** Respaldo de la colección y los ajustes en JSON (solo texto). */
export const BackupSchema = z.object({
  app: z.literal('go-vault'),
  version: z.literal(1),
  exportedAt: z.string(),
  settings: z.unknown().optional(),
  pokemon: z.array(z.unknown()),
});

export async function exportBackup(db: GoVaultDB, nowIso = new Date().toISOString()) {
  const pokemon = await db.pokemon.toArray();
  const settings = await getKV<unknown>(db, 'settings', null);
  await setKV(db, 'lastBackupAt', nowIso);
  return { app: 'go-vault' as const, version: 1 as const, exportedAt: nowIso, settings, pokemon };
}

export interface ImportReport { added: number; skipped: number; invalid: number; errors: string[] }

const sig = (p: SavedPokemon) => `${p.speciesId}|${p.cp}|${p.hp}|${p.ivs ? `${p.ivs.atk}/${p.ivs.def}/${p.ivs.hp}` : 'x'}|${p.level}|${p.flags.shadow}|${p.flags.lucky}|${p.flags.purified}|${p.createdAt}`;

/** Importa un respaldo: valida cada registro (esquema estricto) y no duplica los que ya existen. */
export async function importBackup(db: GoVaultDB, text: string, opts: { replace?: boolean } = {}): Promise<ImportReport> {
  const report: ImportReport = { added: 0, skipped: 0, invalid: 0, errors: [] };
  let parsed: z.infer<typeof BackupSchema>;
  try {
    parsed = BackupSchema.parse(JSON.parse(text));
  } catch {
    report.errors.push('El archivo no es un respaldo válido de GO Vault.');
    return report;
  }
  if (opts.replace) await db.pokemon.clear();
  const have = new Set((await db.pokemon.toArray()).map(sig));
  for (const raw of parsed.pokemon) {
    const r = SavedPokemonSchema.safeParse(raw);
    if (!r.success) { report.invalid++; if (report.errors.length < 5) report.errors.push(`Registro inválido: ${r.error.issues[0]?.message}`); continue; }
    const { id: _id, ...rest } = r.data;
    if (have.has(sig(r.data))) { report.skipped++; continue; }
    await db.pokemon.add(rest as SavedPokemon);
    have.add(sig(r.data));
    report.added++;
  }
  if (parsed.settings && typeof parsed.settings === 'object') await setKV(db, 'settings', parsed.settings);
  return report;
}

/** Días desde el último respaldo (null si nunca). */
export async function daysSinceBackup(db: GoVaultDB, now = Date.now()): Promise<number | null> {
  const last = await getKV<string | null>(db, 'lastBackupAt', null);
  return last ? Math.floor((now - Date.parse(last)) / 864e5) : null;
}
