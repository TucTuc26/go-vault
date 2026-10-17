// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GoVaultDB, addPokemon } from '../src/db/db';
import { AppProvider } from '../src/ui/state';
import { Shell } from '../src/ui/App';
import { fileFetcher, loadTestCtx } from './helpers';
import { testCollection } from './records';
import type { SavedPokemon } from '../src/db/types';

let col: SavedPokemon[];
beforeAll(async () => {
  const { ctx, bundle } = await loadTestCtx();
  col = testCollection(ctx, bundle.manifest.dataVersion, 10);
});
afterEach(cleanup);

describe('pestaña Equipos', () => {
  it('PvP: calcula equipos con la colección, muestra roles/explicación y "¿Qué me falta?"; raids y gimnasios', async () => {
    const db = new GoVaultDB(`teams-${Math.random().toString(36).slice(2)}`);
    for (const r of col) { const { id: _id, ...rest } = r; await addPokemon(db, rest as SavedPokemon); }
    render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
    await screen.findByTestId('data-date', {}, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /Equipos/ }));
    fireEvent.change(await screen.findByLabelText('Amenazas del meta a simular'), { target: { value: '50' } });
    const btn = await screen.findByRole('button', { name: 'Calcular mejores equipos' });
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 10000 });
    fireEvent.click(btn);
    const results = await screen.findByLabelText('Resultados', {}, { timeout: 60000 });
    const teams = within(results).getAllByTestId('team');
    expect(teams.length).toBeGreaterThanOrEqual(1);
    expect(within(teams[0]).getByText(/Apertura/)).toBeInTheDocument();
    expect(within(teams[0]).getByText(/Cierre/)).toBeInTheDocument();
    expect(within(teams[0]).getByText(/Cubre el/)).toBeInTheDocument();
    expect(screen.getByTestId('teams-stats')).toHaveTextContent(/combates nuevos/);
    expect(within(results).getByText('¿Qué me falta?')).toBeInTheDocument();

    // incursiones: marcado como estimación
    fireEvent.click(screen.getByRole('tab', { name: 'Incursiones' }));
    const list = await screen.findByRole('list', { name: 'Mejores atacantes' });
    expect(within(list).getAllByText('estimación').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('note').some((n) => /estimación/.test(n.textContent ?? ''))).toBe(true);

    // gimnasios
    fireEvent.click(screen.getByRole('tab', { name: 'Gimnasios' }));
    expect(await screen.findByRole('list', { name: 'Mejores defensores' })).toBeInTheDocument();
  }, 120000);

  it('PvP: con menos de 3 Pokémon avisa y no calcula', async () => {
    const db = new GoVaultDB(`teams-${Math.random().toString(36).slice(2)}`);
    render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
    await screen.findByTestId('data-date', {}, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /Equipos/ }));
    expect(await screen.findByText(/Registra al menos 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calcular mejores equipos' })).toBeDisabled();
  }, 60000);
});
