// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GoVaultDB, addPokemon } from '../src/db/db';
import { buildRecord } from '../src/db/record';
import { AppProvider } from '../src/ui/state';
import { Shell } from '../src/ui/App';
import { fileFetcher, loadTestCtx } from './helpers';
import { processScan, buildSpeciesIndex, formToScan, type PipelineDeps } from '../src/providers';
import { leagueCombos, calcCP, calcHP, cpmAt, baseOf } from '../src/engine';

let deps: PipelineDeps;
let topId = '';
beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  deps = { ctx, names: bundle.names, speciesIndex: buildSpeciesIndex(bundle.species, bundle.names), moves: bundle.moves };
  topId = ctx.rankings['all-1500']!.entries.slice().sort((a, b) => b.score - a.score).find((e) => !e.id.endsWith('_shadow') && !e.id.includes('_mega'))!.id;
});
afterEach(cleanup);

describe('Top 100', () => {
  it('muestra 100 con fecha, filtra, marca "lo tengo" con mi mejor IV rank y abre matchups/counters', async () => {
    const db = new GoVaultDB(`top-${Math.random().toString(36).slice(2)}`);
    render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
    await screen.findByTestId('data-date', {}, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /Top 100/ }));
    const list = await screen.findByRole('list', { name: 'Top 100' }, { timeout: 15000 });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByTestId('top-date')).toHaveTextContent(/Datos al:/);
    expect(within(list).getAllByText('No lo tengo').length).toBe(100);

    // registrar mi mejor ejemplar del #1 → aparece "Lo tengo" con su IV rank
    const sp = deps.ctx.speciesById.get(topId)!;
    const c1 = leagueCombos(sp, 1500, 50, deps.ctx.game)[0];
    const cpm = cpmAt(deps.ctx.game, c1.level);
    const entry = processScan(deps, formToScan({ species: sp.name.replace(/\s*\(.*\)$/, ''), cp: calcCP(baseOf(sp), c1.ivs, cpm), hp: calcHP(baseOf(sp), c1.ivs, cpm), level: c1.level, ivs: c1.ivs }));
    await addPokemon(db, buildRecord({ draft: entry.draft, species: sp, roles: [{ kind: 'manual' }], dataVersion: 'x' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Top 100' })).getAllByText(/Lo tengo ✓/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/mi mejor IV rank 1\b/).length).toBeGreaterThan(0);

    // solo los que me faltan
    fireEvent.click(screen.getByRole('button', { name: 'Solo los que me faltan' }));
    const missing = within(screen.getByRole('list', { name: 'Top 100' })).getAllByRole('listitem').length;
    expect(missing).toBeLessThan(100);
    fireEvent.click(screen.getByRole('button', { name: 'Solo los que me faltan' }));

    // filtro de sombra y búsqueda
    fireEvent.click(screen.getByRole('button', { name: 'Solo sombra' }));
    const shadows = within(screen.getByRole('list', { name: 'Top 100' })).queryAllByRole('listitem');
    for (const li of shadows) expect(within(li).getByText('Sombra')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Solo sombra' }));
    fireEvent.change(screen.getByLabelText('Buscar en el Top 100'), { target: { value: 'zzzzqqq' } });
    expect(screen.getByText(/Ninguno coincide/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar en el Top 100'), { target: { value: '' } });

    // ficha con matchups y counters
    fireEvent.click(within(screen.getByRole('list', { name: 'Top 100' })).getAllByRole('listitem')[0].querySelector('button')!);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Mejores enfrentamientos')).toBeInTheDocument();
    expect(within(dlg).getByText(/Counters/)).toBeInTheDocument();
    expect(within(dlg).getAllByRole('listitem').length).toBeGreaterThanOrEqual(6);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cerrar' }));

    // otra copa
    const sel = screen.getByLabelText('Liga o copa') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'all-2500' } });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Top 100' })).getAllByRole('listitem')).toHaveLength(100));
    expect(sel.options.length).toBeGreaterThan(5);
  }, 90000);
});
