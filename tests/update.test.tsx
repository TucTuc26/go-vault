// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GoVaultDB, addPokemon, getKV, setKV } from '../src/db/db';
import { AppProvider } from '../src/ui/state';
import { Shell } from '../src/ui/App';
import { fileFetcher, loadTestCtx } from './helpers';
import { testCollection } from './records';
import { backupAgeDays, importBackup, exportBackup } from '../src/app/backup';
import type { SavedPokemon } from '../src/db/types';

let rec: SavedPokemon;
let versionA = '';
beforeAll(async () => {
  const { ctx, bundle } = await loadTestCtx();
  versionA = bundle.manifest.dataVersion;
  rec = testCollection(ctx, versionA, 1)[0];
});
afterEach(cleanup);

const newDb = () => new GoVaultDB(`upd-${Math.random().toString(36).slice(2)}`);

describe('actualización de datos', () => {
  it('detecta un manifest nuevo, descarga, reevalúa en segundo plano, avisa los cambios y solo aplica si el usuario acepta (sin borrar nada)', async () => {
    const db = newDb();
    const { id: _id, ...rest } = rec;
    await addPokemon(db, { ...rest, roles: [], roleKeys: [] } as SavedPokemon); // registro viejo sin roles
    await setKV(db, 'settings', { dataVersionSeen: versionA });
    let served: 'A' | 'B' = 'A';
    const fetcher = async (path: string, opts?: { version?: string }) => {
      const j = (await fileFetcher(path)) as Record<string, unknown>;
      if (path === 'manifest.json' && served === 'B') return { ...j, dataVersion: 'nueva-version-123', builtAt: new Date(Date.now() + 86400e3).toISOString() };
      void opts;
      return j;
    };
    render(<AppProvider db={db} fetcher={fetcher}><Shell /></AppProvider>);
    await screen.findByTestId('data-date', {}, { timeout: 15000 });
    expect(screen.queryByText(/Hay datos nuevos del juego/)).toBeNull();

    // el servidor publica una versión nueva y la app vuelve a primer plano
    served = 'B';
    document.dispatchEvent(new Event('visibilitychange'));
    const btn = await screen.findByRole('button', { name: 'Actualizar datos' }, { timeout: 10000 });
    fireEvent.click(btn);
    // reevaluación → cambios pendientes
    const apply = await screen.findByRole('button', { name: 'Aplicar cambios' }, { timeout: 30000 });
    expect(screen.getByText(/cambian de rol \(no se borra nada\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver cambios' }));
    expect(screen.getByText(/ahora sirve/)).toBeInTheDocument();
    expect((await db.pokemon.toArray())[0].roles).toHaveLength(0); // todavía no se aplicó
    fireEvent.click(apply);
    await waitFor(async () => expect((await db.pokemon.toArray())[0].roles.length).toBeGreaterThan(0), { timeout: 10000 });
    expect(await db.pokemon.count()).toBe(1); // nunca se borra nada
    await waitFor(async () => expect(((await getKV<{ dataVersionSeen?: string }>(db, 'settings', {})).dataVersionSeen)).toBe('nueva-version-123'));
  }, 120000);

  it('"Ahora no" conserva los roles anteriores y no vuelve a preguntar por esa versión', async () => {
    const db = newDb();
    const { id: _id, ...rest } = rec;
    await addPokemon(db, { ...rest, roles: [], roleKeys: [] } as SavedPokemon);
    await setKV(db, 'settings', { dataVersionSeen: 'version-vieja' });
    render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
    const no = await screen.findByRole('button', { name: 'Ahora no' }, { timeout: 30000 });
    fireEvent.click(no);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ahora no' })).toBeNull());
    expect((await db.pokemon.toArray())[0].roles).toHaveLength(0);
  }, 90000);
});

describe('respaldo', () => {
  it('exportar/importar es ida y vuelta, no duplica y rechaza archivos inválidos', async () => {
    const a = newDb();
    const { id: _id, ...rest } = rec;
    await addPokemon(a, rest as SavedPokemon);
    const file = JSON.stringify(await exportBackup(a));
    const b = newDb();
    const r1 = await importBackup(b, file);
    expect(r1).toMatchObject({ added: 1, skipped: 0, invalid: 0 });
    const r2 = await importBackup(b, file);
    expect(r2).toMatchObject({ added: 0, skipped: 1 });
    expect((await importBackup(b, '{"x":1}')).errors[0]).toMatch(/no es un respaldo/);
    const bad = JSON.stringify({ app: 'go-vault', version: 1, exportedAt: 'x', pokemon: [{ ...rest, imagen: 'data:image/png;base64,AAA' }] });
    const r3 = await importBackup(newDb(), bad);
    expect(r3.invalid).toBe(1); // un campo de imagen invalida el registro
  });

  it('recordatorio cuando pasan más de 14 días sin respaldo; al respaldar desaparece', async () => {
    const db = newDb();
    const old = new Date(Date.now() - 20 * 864e5).toISOString();
    const { id: _id, ...rest } = rec;
    await addPokemon(db, { ...rest, createdAt: old, updatedAt: old } as SavedPokemon);
    expect(await backupAgeDays(db)).toBeGreaterThanOrEqual(20);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
    const btn = await screen.findByRole('button', { name: 'Respaldar ahora' }, { timeout: 20000 });
    expect(screen.getByText(/días que no haces un respaldo/)).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Respaldar ahora' })).toBeNull());
    expect(click).toHaveBeenCalled();
    expect(await backupAgeDays(db)).toBe(0);
    click.mockRestore();
  }, 60000);
});
