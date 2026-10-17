import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { loadBundle, loadManifest, type DataBundle } from '../data/loader';
import { displayName } from '../data/names';
import type { Manifest, RankingFile, Species } from '../data/schemas';
import { db as defaultDb, getKV, setKV, type GoVaultDB } from '../db/db';
import type { SavedPokemon } from '../db/types';
import type { Inventory } from '../engine/cost';
import type { RoleChange } from '../engine/reevaluate';
import { buildLeagues, DEFAULT_VERDICT_SETTINGS, type VerdictEnv, type VerdictSettings } from '../engine/verdict';
import { buildSpeciesIndex, type PipelineDeps } from '../providers';
import type { IntakeEnv } from '../app/intake';
import { leagueTitles } from './i18n';
import { applyRoleChanges, reevaluateAsync } from '../app/reevaluate-run';
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
  /** Versión de datos con la que se reevaluó la colección por última vez. */
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
  /** Manifest más nuevo que el cargado (hay datos nuevos en el servidor), si lo hay. */
  update: Manifest | null;
  /** Consulta el manifest; devuelve true si hay datos nuevos. */
  checkUpdate: () => Promise<boolean>;
  /** Descarga los datos nuevos, recarga y dispara la reevaluación. */
  applyUpdate: () => Promise<void>;
  /** Cambios de rol detectados al cambiar la versión de datos (pendientes de aplicar). */
  pendingChanges: RoleChange[] | null;
  reevaluating: boolean;
  applyChanges: () => Promise<void>;
  dismissChanges: () => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
};

/** Suscripción reactiva a la colección (y si ya llegó la primera lectura). */
function usePokemonList(db: GoVaultDB): { list: SavedPokemon[]; loaded: boolean } {
  const [state, setState] = useState<{ list: SavedPokemon[]; loaded: boolean }>({ list: [], loaded: false });
  useEffect(() => {
    const sub = liveQuery(() => db.pokemon.toArray()).subscribe({
      next: (list) => setState({ list, loaded: true }),
      error: () => setState({ list: [], loaded: true }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return state;
}

export function AppProvider({ children, db = defaultDb, fetcher }: { children: ReactNode; db?: GoVaultDB; fetcher?: Parameters<typeof loadBundle>[0] }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string; bundle?: DataBundle; rankings?: Record<string, RankingFile> }>({ status: 'loading' });
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const { list: pokemon, loaded: pokemonLoaded } = usePokemonList(db);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [update, setUpdate] = useState<Manifest | null>(null);
  const [pendingChanges, setPendingChanges] = useState<RoleChange[] | null>(null);
  const [reevaluating, setReevaluating] = useState(false);
  const reevaluatedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const bundle = await loadBundle(fetcher);
      const entries = await Promise.all(bundle.manifest.rankings.map(async (r) => [r.key, await bundle.loadRanking(r.key)] as const));
      setState({ status: 'ready', bundle, rankings: Object.fromEntries(entries) });
      setUpdate(null);
    } catch (e) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error', error: String((e as Error).message ?? e) }));
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

  const currentVersion = state.bundle?.manifest.dataVersion ?? null;

  const checkUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const m = await loadManifest(fetcher);
      const newer = currentVersion !== null && m.dataVersion !== currentVersion;
      setUpdate(newer ? m : null);
      return newer;
    } catch {
      return false; // sin conexión: se sigue con los datos guardados
    }
  }, [fetcher, currentVersion]);

  // Consulta el manifest al abrir, al volver a la app y cada 30 min
  useEffect(() => {
    if (!currentVersion) return;
    void checkUpdate();
    const onVis = () => { if (document.visibilityState === 'visible') void checkUpdate(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => void checkUpdate(), 30 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [currentVersion, checkUpdate]);

  const value = useMemo<AppCtx | null>(() => {
    if (state.status !== 'ready' || !state.bundle || !state.rankings || !settingsLoaded) return null;
    const { bundle, rankings } = state;
    const env: VerdictEnv = { game: bundle.game, speciesById: bundle.speciesById, rankings, movesById: bundle.movesById, leagues: buildLeagues(bundle.formats, bundle.cups, leagueTitles(bundle.formats)) };
    const deps: PipelineDeps = { ctx: env, names: bundle.names, speciesIndex: buildSpeciesIndex(bundle.species, bundle.names), moves: bundle.moves };
    const verdictSettings: VerdictSettings = { ...settings.verdict, playerLevel: settings.playerLevel };
    const nameOf = (id: string) => { const s = bundle.speciesById.get(id); return s ? displayName(s, bundle.names) : id; };
    return {
      bundle, rankings, env, deps, db, settings, updateSettings, verdictSettings,
      intakeEnv: { deps, verdictEnv: env, settings: verdictSettings, dataVersion: bundle.manifest.dataVersion, db },
      pokemon, nameOf, species: (id) => bundle.speciesById.get(id), reloadData: load,
      update, checkUpdate,
      applyUpdate: async () => { await load(); },
      pendingChanges, reevaluating,
      applyChanges: async () => {
        if (pendingChanges) await applyRoleChanges(db, pendingChanges, bundle.manifest.dataVersion);
        setPendingChanges(null);
        updateSettings({ dataVersionSeen: bundle.manifest.dataVersion });
      },
      dismissChanges: () => { setPendingChanges(null); updateSettings({ dataVersionSeen: bundle.manifest.dataVersion }); },
    };
  }, [state, settings, settingsLoaded, db, pokemon, updateSettings, load, update, checkUpdate, pendingChanges, reevaluating]);

  // Reevaluación automática (Web Worker) cuando cambia la versión de datos respecto a la última evaluada
  const ready = !!value;
  useEffect(() => {
    if (!ready || !pokemonLoaded || !state.bundle || !currentVersion) return;
    if (settings.dataVersionSeen === currentVersion || reevaluatedFor.current === currentVersion) return;
    reevaluatedFor.current = currentVersion;
    if (settings.dataVersionSeen === null || pokemon.length === 0) { updateSettings({ dataVersionSeen: currentVersion }); return; }
    setReevaluating(true);
    const b = state.bundle;
    const env: VerdictEnv = { game: b.game, speciesById: b.speciesById, rankings: state.rankings!, movesById: b.movesById, leagues: buildLeagues(b.formats, b.cups, leagueTitles(b.formats)) };
    const nameOf = (id: string) => { const s = b.speciesById.get(id); return s ? displayName(s, b.names) : id; };
    reevaluateAsync(env, pokemon, { ...settings.verdict, playerLevel: settings.playerLevel }, nameOf)
      .then((ch) => {
        if (ch.length) setPendingChanges(ch);
        else updateSettings({ dataVersionSeen: currentVersion });
      })
      .catch(() => updateSettings({ dataVersionSeen: currentVersion }))
      .finally(() => setReevaluating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pokemonLoaded, currentVersion, settings.dataVersionSeen]);

  if (state.status === 'error') return <p role="alert" className="p-4 text-[var(--bad)]">No se pudieron cargar los datos: {state.error}. Si es la primera vez, ejecuta <code>npm run data:fetch</code>; si usas la app sin conexión, ábrela una vez con internet.</p>;
  if (!value) return <p className="p-4 text-[var(--muted)]" aria-live="polite">Cargando datos del juego…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
