import Dexie, { type Table } from 'dexie';
import { SavedPokemonSchema, type SavedPokemon } from './types';
import type { SeenStore } from '../providers/drive';

/** Elemento de la cola "Por revisar": SOLO texto (el borrador interpretado). Nunca la imagen. */
export interface ReviewItem {
  id?: number;
  createdAt: string;
  sourceId: string | null;
  reasons: string[];
  /** Borrador serializable (PokemonDraft + scan) — JSON puro. */
  draft: unknown;
  scan: unknown;
}

export interface KV { key: string; value: unknown }

export class GoVaultDB extends Dexie {
  pokemon!: Table<SavedPokemon, number>;
  review!: Table<ReviewItem, number>;
  kv!: Table<KV, string>;
  driveSeen!: Table<{ id: string }, string>;

  constructor(name = 'go-vault') {
    super(name);
    this.version(1).stores({
      pokemon: '++id, speciesId, createdAt, *roleKeys',
      review: '++id, createdAt',
      kv: 'key',
      driveSeen: 'id',
    });
  }
}

export const db = new GoVaultDB();

// ---------------- repositorio ----------------

/** Guarda validando con el esquema estricto (rechaza cualquier campo extra, p. ej. de imagen). */
export async function addPokemon(d: GoVaultDB, rec: SavedPokemon): Promise<number> {
  const clean = SavedPokemonSchema.parse(rec);
  const { id: _id, ...rest } = clean;
  return d.pokemon.add(rest as SavedPokemon);
}

export async function updatePokemon(d: GoVaultDB, id: number, patch: Partial<SavedPokemon>): Promise<void> {
  const cur = await d.pokemon.get(id);
  if (!cur) throw new Error(`No existe el Pokémon ${id}`);
  const next = SavedPokemonSchema.parse({ ...cur, ...patch, id, updatedAt: new Date().toISOString() });
  await d.pokemon.put(next);
}

export const deletePokemon = (d: GoVaultDB, id: number) => d.pokemon.delete(id);
export const listPokemon = (d: GoVaultDB) => d.pokemon.toArray();

/** "Deshacer" del último guardado automático: borra ese registro. */
export function undoHandle(d: GoVaultDB, id: number) {
  return { id, undo: () => d.pokemon.delete(id) };
}

export async function getKV<T>(d: GoVaultDB, key: string, fallback: T): Promise<T> {
  const row = await d.kv.get(key);
  return row ? (row.value as T) : fallback;
}
export const setKV = (d: GoVaultDB, key: string, value: unknown) => d.kv.put({ key, value });

export async function addReview(d: GoVaultDB, item: Omit<ReviewItem, 'id' | 'createdAt'>): Promise<number> {
  return d.review.add({ ...item, createdAt: new Date().toISOString() });
}

/** IDs de Drive ya procesados (solo texto). */
export function dbSeenStore(d: GoVaultDB): SeenStore {
  return {
    has: async (id) => !!(await d.driveSeen.get(id)),
    add: async (ids) => { await d.driveSeen.bulkPut(ids.map((id) => ({ id }))); },
  };
}
