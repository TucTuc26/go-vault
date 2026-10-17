import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { loadBundle, type DataBundle } from '../data/loader';
import { displayName } from '../data/names';
import type { RankingFile, Species } from '../data/schemas';
import { db as defaultDb, getKV, setKV, type GoVaultDB } from '../db/db';
import type { SavedPokemon } from '../db/types';
import type { Inventory } from '../engine/cost';
import { buildLeagues, DEFAULT_VERDICT_SETTINGS, type VerdictEnv, type VerdictSettings } from '../engine/verdict';
import { buildSpeciesIndex, type PipelineDeps } from '../providers';
import type { IntakeEnv } from '../app/intake';
import type { ProviderId } from '../providers';

export interface AppSettings {
  playerLevel: number;
  team: 'mystic' | 'valor' | 'instinct' | null;
  provider: ProviderId;
  apiEnabled: boolean;
  apiPasscode: string;
  driveFolderId: string;
  inventory: Inventory;
  verdict: VerdictSettings;
  lastBackupAt: string | null;
  dataVersionSeen: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playerLevel: 40,
  team: null,
  provider: 'manual',
  apiEnabled: false,
  apiPasscode: '',
  driveFolderId: '',
  inventory: {},
  verdict: DEFAULT_VERDICT_SETTINGS,
  lastBackupAt: null,
  dataVersionSeen: null,
};

/** Mezcla ajustes guardados (posiblemente de una versión anterior) con los valores por defecto. */
export function mergeSettings(saved: Partial<AppSettings> | null | undefined): AppSettings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS, ...s,
    verdict: {
      ...DEFAULT_VERDICT_SETTINGS, ...(s.verdict ?? {}),
      pvp: { ...DEFAULT_VERDICT_SETTINGS.pvp, ...(s.verdict?.pvp ?? {}) },
      gym: { ...DEFAULT_VERDICT_SETTINGS.gym, ...(s.verdict?.gym ?? {}) },
      raid: { ...DEFAULT_VERDICT_SETTINGS.raid, ...(s.verdict?.raid ?? {}) },
      showcase: { ...DEFAULT_VERDICT_SETTINGS.showcase, ...(s.verdict?.showcase ?? {}) },
    },
  };
}

export interface AppCtx {
  bundle: DataBundle;
  rankings: Record<string, RankingFile | undefined>;
  env: VerdictEnv;
  deps: PipelineDeps;
  db: GoVaultDB;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings> | ((s: AppSettings) => AppSettings)) => void;
  /** Ajustes del veredicto con el nivel de cuenta aplicado. */
  verdictSettings: VerdictSettings;
  intakeEnv: IntakeEnv;
  pokemon: SavedPokemon[];
  nameOf: (speciesId: string) => string;
  species: (id: string) => Species | undefined;
  reloadData: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
};

/** Suscripción reactiva a la colección. */
function usePokemonList(db: GoVaultDB): SavedPokemon[] {
  const [list, setList] = useState<SavedPokemon[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.pokemon.toArray()).subscribe({ next: setList, error: () => setList([]) });
    return () => sub.unsubscribe();
  }, [db]);
  return list;
}

export function AppProvider({ children, db = defaultDb, fetcher }: { children: ReactNode; db?: GoVaultDB; fetcher?: Parameters<typeof loadBundle>[0] }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string; bundle?: DataBundle; rankings?: Record<string, RankingFile> }>({ status: 'loading' });
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const pokemon = usePokemonList(db);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const bundle = await loadBundle(fetcher);
      const entries = await Promise.all(bundle.manifest.rankings.map(async (r) => [r.key, await bundle.loadRanking(r.key)] as const));
      setState({ status: 'ready', bundle, rankings: Object.fromEntries(entries) });
    } catch (e) {
      setState({ status: 'error', error: String((e as Error).message ?? e) });
    }
  }, [fetcher]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    getKV<Partial<AppSettings> | null>(db, 'settings', null).then((s) => { setSettingsState(mergeSettings(s)); setSettingsLoaded(true); }).catch(() => setSettingsLoaded(true));
  }, [db]);

  const updateSettings = useCallback((patch: Partial<AppSettings> | ((s: AppSettings) => AppSettings)) => {
    setSettingsState((cur) => {
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void setKV(db, 'settings', next); }, 200);
      return next;
    });
  }, [db]);

  const value = useMemo<AppCtx | null>(() => {
    if (state.status !== 'ready' || !state.bundle || !state.rankings || !settingsLoaded) return null;
    const { bundle, rankings } = state;
    const env: VerdictEnv = { game: bundle.game, speciesById: bundle.speciesById, rankings, movesById: bundle.movesById, leagues: buildLeagues(bundle.formats, bundle.cups) };
    const deps: PipelineDeps = { ctx: env, names: bundle.names, speciesIndex: buildSpeciesIndex(bundle.species, bundle.names), moves: bundle.moves };
    const verdictSettings: VerdictSettings = { ...settings.verdict, playerLevel: settings.playerLevel };
    const nameOf = (id: string) => { const s = bundle.speciesById.get(id); return s ? displayName(s, bundle.names) : id; };
    return {
      bundle, rankings, env, deps, db, settings, updateSettings, verdictSettings,
      intakeEnv: { deps, verdictEnv: env, settings: verdictSettings, dataVersion: bundle.manifest.dataVersion, db },
      pokemon, nameOf, species: (id) => bundle.speciesById.get(id), reloadData: load,
    };
  }, [state, settings, settingsLoaded, db, pokemon, updateSettings, load]);

  if (state.status === 'error') return <p role="alert" className="p-4 text-[var(--bad)]">No se pudieron cargar los datos: {state.error}. Si es la primera vez, ejecuta <code>npm run data:fetch</code>.</p>;
  if (!value) return <p className="p-4 text-[var(--muted)]" aria-live="polite">Cargando datos del juego…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
