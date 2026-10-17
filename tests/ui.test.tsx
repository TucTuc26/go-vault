// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GoVaultDB } from '../src/db/db';
import { AppProvider } from '../src/ui/state';
import { Shell } from '../src/ui/App';
import { fileFetcher } from './helpers';
import { calcCP, calcHP, cpmAt, baseOf } from '../src/engine';
import type { Species } from '../src/data/schemas';

let rattata: Species;
beforeAll(async () => { rattata = (await fileFetcher('species.json') as Species[]).find((s) => s.id === 'rattata')!; });
afterEach(cleanup);

const setup = () => {
  const db = new GoVaultDB(`ui-${Math.random().toString(36).slice(2)}`);
  render(<AppProvider db={db} fetcher={fileFetcher}><Shell /></AppProvider>);
  return db;
};
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('flujo completo de la interfaz', () => {
  it('agregar → veredicto → guardar → colección → detalle → calculadora, sin errores de consola', async () => {
    const errors: unknown[][] = [];
    const spyE = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    const spyW = vi.spyOn(console, 'warn').mockImplementation((...a) => { errors.push(a); });
    setup();

    // carga y fecha de datos
    expect(await screen.findByTestId('data-date', {}, { timeout: 15000 })).toHaveTextContent(/Datos al:/);

    // Rattata 15/15/15 nivel 20 (siempre sirve para exhibición 100 %)
    const ivs = { atk: 15, def: 15, hp: 15 };
    const cpm = cpmAt((await fileFetcher('game.json')) as never, 20);
    type(/Especie/, 'Rattata');
    type(/PC \/ CP/, String(calcCP(baseOf(rattata), ivs, cpm)));
    type(/PS \/ HP/, String(calcHP(baseOf(rattata), ivs, cpm)));
    type(/^Nivel/, '20');
    type(/IV de Ataque/, '15'); type(/IV de Defensa/, '15'); type(/IV de PS/, '15');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    const card = await screen.findByTestId('outcome', {}, { timeout: 15000 });
    expect(within(card).getByText(/Guardado ✓/)).toBeInTheDocument();
    expect(screen.getByTestId('batch-summary')).toHaveTextContent(/Guardados 1/);

    // un Pokémon malo: no sirve y no se guarda
    type(/Especie/, 'Rattata');
    type(/PC \/ CP/, String(calcCP(baseOf(rattata), { atk: 4, def: 6, hp: 7 }, cpmAt((await fileFetcher('game.json')) as never, 12))));
    type(/PS \/ HP/, String(calcHP(baseOf(rattata), { atk: 4, def: 6, hp: 7 }, cpmAt((await fileFetcher('game.json')) as never, 12))));
    type(/IV de Ataque/, '4'); type(/IV de Defensa/, '6'); type(/IV de PS/, '7');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getAllByTestId('outcome').length).toBe(2), { timeout: 15000 });
    expect(screen.getByText('No sirve')).toBeInTheDocument();
    expect(screen.getByTestId('batch-summary')).toHaveTextContent(/Guardados 1 · No sirven 1/);

    // colección
    fireEvent.click(screen.getByRole('button', { name: /Colección/ }));
    await waitFor(() => expect(screen.getByTestId('collection-count')).toHaveTextContent('1 de 1'));
    fireEvent.click(screen.getByText('Rattata'));

    // detalle + calculadora
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Para qué sirve/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/100 % de IVs/).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText('Calculadora')).toBeInTheDocument();
    await within(dialog).findByTestId('plan', {}, { timeout: 15000 });
    expect(within(dialog).getByText(/Carga tu inventario/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Mejores ataques/)).toBeInTheDocument();

    expect(errors).toEqual([]);
    spyE.mockRestore(); spyW.mockRestore();
  }, 90000);

  it('las pestañas inferiores existen y Ajustes muestra la fecha de datos', async () => {
    setup();
    await screen.findByTestId('data-date', {}, { timeout: 15000 });
    for (const n of ['Agregar', 'Colección', 'Top 100', 'Equipos', 'Ajustes']) expect(screen.getByRole('button', { name: new RegExp(n) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ajustes/ }));
    expect(await screen.findByTestId('settings-data-date')).toHaveTextContent(/Datos al:/);
  }, 60000);
});
