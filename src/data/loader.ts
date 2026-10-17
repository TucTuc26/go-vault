import {
  GameDataSchema, SpeciesSchema, MoveSchema, FormatSchema, CupSchema, NamesSchema, ManifestSchema, RankingFileSchema,
  type GameData, type Species, type Move, type Format, type Cup, type Names, type Manifest, type RankingFile,
} from './schemas';
import { z } from 'zod';

/**
 * `version`: los archivos de datos se piden como `data/<archivo>?v=<dataVersion>`. Así cada versión tiene su propia
 * entrada en la caché del service worker (stale-while-revalidate) y la app siempre usa un conjunto coherente, también sin conexión.
 * `manifest.json` va por red primero (NetworkFirst en el service worker) para detectar versiones nuevas.
 */
export type JsonFetcher = (path: string, opts?: { version?: string }) => Promise<unknown>;

const defaultFetcher: JsonFetcher = async (path, opts) => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/${path}${opts?.version ? `?v=${encodeURIComponent(opts.version)}` : ''}`);
  if (!res.ok) throw new Error(`No se pudo cargar data/${path} (HTTP ${res.status})`);
  return res.json();
};

export interface DataBundle {
  manifest: Manifest;
  game: GameData;
  species: Species[];
  speciesById: Map<string, Species>;
  moves: Move[];
  movesById: Map<string, Move>;
  formats: Format[];
  cups: Record<string, Cup>;
  names: Names;
  loadRanking: (key: string) => Promise<RankingFile>;
}

export async function loadManifest(fetcher: JsonFetcher = defaultFetcher): Promise<Manifest> {
  return ManifestSchema.parse(await fetcher('manifest.json'));
}

/** Carga y valida todos los datos base (los rankings se cargan bajo demanda y se cachean). */
export async function loadBundle(fetcher: JsonFetcher = defaultFetcher): Promise<DataBundle> {
  const manifest = await loadManifest(fetcher);
  const v = { version: manifest.dataVersion };
  const [game, species, moves, formats, cups, names] = await Promise.all([
    fetcher('game.json', v).then((j) => GameDataSchema.parse(j)),
    fetcher('species.json', v).then((j) => z.array(SpeciesSchema).parse(j)),
    fetcher('moves.json', v).then((j) => z.array(MoveSchema).parse(j)),
    fetcher('formats.json', v).then((j) => z.array(FormatSchema).parse(j)),
    fetcher('cups.json', v).then((j) => z.record(z.string(), CupSchema).parse(j)),
    fetcher('names-es.json', v).then((j) => NamesSchema.parse(j)),
  ]);
  const rankingCache = new Map<string, Promise<RankingFile>>();
  return {
    manifest, game, species, moves, formats, cups, names,
    speciesById: new Map(species.map((s) => [s.id, s])),
    movesById: new Map(moves.map((m) => [m.id, m])),
    loadRanking: (key) => {
      let p = rankingCache.get(key);
      if (!p) {
        p = fetcher(`rankings/${key}.json`, v).then((j) => RankingFileSchema.parse(j));
        rankingCache.set(key, p);
      }
      return p;
    },
  };
}

/**
 * Carga mínima para los workers de simulación (game, especies y ataques) SIN revalidar con Zod:
 * son los mismos archivos que ya validó la app y validar 1751 especies en cada worker cuesta más que simular.
 */
export async function loadSimData(version?: string, fetcher: JsonFetcher = defaultFetcher) {
  const v = version ? { version } : undefined;
  const [game, species, moves] = (await Promise.all([fetcher('game.json', v), fetcher('species.json', v), fetcher('moves.json', v)])) as [GameData, Species[], Move[]];
  return { game, speciesById: new Map(species.map((s) => [s.id, s])), movesById: new Map(moves.map((m) => [m.id, m])) };
}
