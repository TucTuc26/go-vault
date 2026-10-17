import {
  GameDataSchema, SpeciesSchema, MoveSchema, FormatSchema, CupSchema, NamesSchema, ManifestSchema, RankingFileSchema,
  type GameData, type Species, type Move, type Format, type Cup, type Names, type Manifest, type RankingFile,
} from './schemas';
import { z } from 'zod';

export type JsonFetcher = (path: string) => Promise<unknown>;

const defaultFetcher: JsonFetcher = async (path) => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/${path}`);
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
  const [manifest, game, species, moves, formats, cups, names] = await Promise.all([
    loadManifest(fetcher),
    fetcher('game.json').then((j) => GameDataSchema.parse(j)),
    fetcher('species.json').then((j) => z.array(SpeciesSchema).parse(j)),
    fetcher('moves.json').then((j) => z.array(MoveSchema).parse(j)),
    fetcher('formats.json').then((j) => z.array(FormatSchema).parse(j)),
    fetcher('cups.json').then((j) => z.record(z.string(), CupSchema).parse(j)),
    fetcher('names-es.json').then((j) => NamesSchema.parse(j)),
  ]);
  const rankingCache = new Map<string, Promise<RankingFile>>();
  return {
    manifest, game, species, moves, formats, cups, names,
    speciesById: new Map(species.map((s) => [s.id, s])),
    movesById: new Map(moves.map((m) => [m.id, m])),
    loadRanking: (key) => {
      let p = rankingCache.get(key);
      if (!p) {
        p = fetcher(`rankings/${key}.json`).then((j) => RankingFileSchema.parse(j));
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
export async function loadSimData(fetcher: JsonFetcher = defaultFetcher) {
  const [game, species, moves] = await Promise.all([fetcher('game.json'), fetcher('species.json'), fetcher('moves.json')]) as [GameData, Species[], Move[]];
  return { game, speciesById: new Map(species.map((s) => [s.id, s])), movesById: new Map(moves.map((m) => [m.id, m])) };
}
