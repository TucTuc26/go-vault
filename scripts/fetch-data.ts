/**
 * Descarga PvPoke (MIT) + Game Master de PokeMiners + nombres de PokeAPI, valida con Zod y
 * escribe public/data/*.json + manifest.json. Solo escribe si cambió el hash; si algo falla,
 * conserva los datos anteriores y termina con código 1 (falla visible).
 *
 * Uso: npm run data:fetch   (DATA_CACHE_DIR=ruta reutiliza descargas crudas en desarrollo)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ManifestSchema, FormatSchema, RankingFileSchema, CupSchema, NamesSchema,
  type Manifest, type Cup,
} from '../src/data/schemas';
import {
  buildGame, buildSpecies, buildMoves, compactRanking, planFormats, buildFormat, buildNames, checkTypeChart,
  type GmTemplate,
} from './lib/build';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = process.env.DATA_CACHE_DIR ? resolve(process.env.DATA_CACHE_DIR) : null;

const PVPOKE = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data';
const POKEMINERS = 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest';
const POKEAPI_CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function getText(url: string, opts: { allow404?: boolean } = {}): Promise<string | null> {
  const cacheFile = CACHE ? join(CACHE, sha(url) + '.txt') : null;
  if (cacheFile && existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'go-vault-data-fetch' } });
      if (res.status === 404 && opts.allow404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (cacheFile) { mkdirSync(CACHE!, { recursive: true }); writeFileSync(cacheFile, text); }
      return text;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`No se pudo descargar ${url}: ${(lastErr as Error)?.message}`);
}
const getJson = async (url: string) => JSON.parse((await getText(url))!);

async function main() {
  const warnings: string[] = [];
  const fetchedAt = new Date().toISOString();

  // --- descargas ---
  const [pokemonRaw, movesRaw, formatsRaw, baseRaw] = await Promise.all([
    getText(`${PVPOKE}/gamemaster/pokemon.json`),
    getText(`${PVPOKE}/gamemaster/moves.json`),
    getText(`${PVPOKE}/gamemaster/formats.json`),
    getText(`${PVPOKE}/gamemaster/base.json`),
  ]);
  const pvpokePokemon = JSON.parse(pokemonRaw!);
  const pvpokeMoves = JSON.parse(movesRaw!);
  const pvpokeFormats = JSON.parse(formatsRaw!);
  const pvpokeBase = JSON.parse(baseRaw!);

  const gmText = await getText(`${POKEMINERS}/latest.json`);
  const gm: GmTemplate[] = JSON.parse(gmText!);
  const gmTimestamp = (await getText(`${POKEMINERS}/timestamp.txt`))!.trim();
  if (!Array.isArray(gm) || gm.length < 5000) throw new Error('El Game Master de PokeMiners parece incompleto');
  const gmDate = /^\d+$/.test(gmTimestamp) ? new Date(Number(gmTimestamp)).toISOString() : gmTimestamp;
  // Aviso si el Game Master lleva más de 60 días sin actualizar (¿proyecto abandonado?).
  if (/^\d+$/.test(gmTimestamp) && Date.now() - Number(gmTimestamp) > 60 * 864e5) {
    warnings.push(`El Game Master de PokeMiners no se actualiza desde ${gmDate}; los datos del juego podrían estar desactualizados.`);
  }

  // --- normalización ---
  const game = buildGame(gm, pvpokeBase, warnings);
  checkTypeChart(game, warnings);
  const { species } = buildSpecies(pvpokePokemon, gm, warnings);
  const moves = buildMoves(pvpokeMoves, gm);
  if (species.length < 900) throw new Error(`Solo ${species.length} especies: validación fallida`);
  if (game.cpmWhole.length < 51) throw new Error('Tabla de cpm incompleta');

  // nombres en español (PokeAPI, CSV de datos abiertos)
  let names = { species: {} as Record<string, string>, moves: {} as Record<string, string> };
  try {
    const [sp, mv, mn] = await Promise.all([
      getText(`${POKEAPI_CSV}/pokemon_species_names.csv`),
      getText(`${POKEAPI_CSV}/moves.csv`),
      getText(`${POKEAPI_CSV}/move_names.csv`),
    ]);
    names = NamesSchema.parse(buildNames(sp!, mv!, mn!, pvpokeMoves));
  } catch (e) {
    warnings.push(`Nombres en español no disponibles (${(e as Error).message}); se usarán los nombres en inglés.`);
    const prev = join(OUT, 'names-es.json');
    if (existsSync(prev)) names = JSON.parse(readFileSync(prev, 'utf8'));
  }
  if (Object.keys(names.species).length < 800) warnings.push('Pocos nombres de especie en español.');

  // rankings por formato (categoría "overall")
  const plan = planFormats(pvpokeFormats);
  const rankingFiles: Record<string, string> = {};
  const rankingMeta: Manifest['rankings'] = [];
  const formats = [];
  const cups: Record<string, Cup> = {};
  const speciesIds = new Set(species.map((s) => s.id));
  for (const p of plan) {
    const url = `${PVPOKE}/rankings/${p.cup}/overall/rankings-${p.cp}.json`;
    const txt = await getText(url, { allow404: true });
    if (!txt) {
      if (!p.hide && p.cup !== 'custom') warnings.push(`Sin ranking para ${p.cup} ${p.cp} (${p.title}).`);
      formats.push(FormatSchema.parse(buildFormat(p, false)));
      continue;
    }
    const entries = compactRanking(JSON.parse(txt));
    const unknown = entries.filter((e) => !speciesIds.has(e.id)).length;
    if (unknown) warnings.push(`Ranking ${p.cup}-${p.cp}: ${unknown} entradas con especie desconocida.`);
    const key = `${p.cup}-${p.cp}`;
    const file = RankingFileSchema.parse({ key, cup: p.cup, cp: p.cp, entries });
    rankingFiles[key] = JSON.stringify(file);
    rankingMeta.push({ key, cup: p.cup, cp: p.cp, title: p.title, count: entries.length });
    formats.push(FormatSchema.parse(buildFormat(p, true)));
    if (p.cup !== 'all' && !cups[p.cup]) {
      const ct = await getText(`${PVPOKE}/gamemaster/cups/${p.cup}.json`, { allow404: true });
      if (ct) cups[p.cup] = CupSchema.parse(JSON.parse(ct));
    }
  }
  if (rankingMeta.length < 4) throw new Error('Faltan rankings base (500/1500/2500/10000)');

  // --- archivos de salida ---
  const files: Record<string, string> = {
    'game.json': JSON.stringify(game),
    'species.json': JSON.stringify(species),
    'moves.json': JSON.stringify(moves),
    'formats.json': JSON.stringify(formats),
    'cups.json': JSON.stringify(cups),
    'names-es.json': JSON.stringify(names),
  };
  for (const [k, v] of Object.entries(rankingFiles)) files[`rankings/${k}.json`] = v;

  const fileInfo: Manifest['files'] = {};
  for (const [name, content] of Object.entries(files)) fileInfo[name] = { hash: sha(content), bytes: Buffer.byteLength(content) };
  const dataVersion = sha(Object.keys(fileInfo).sort().map((k) => `${k}:${fileInfo[k].hash}`).join('|'));

  const manifestPath = join(OUT, 'manifest.json');
  const prevManifest: Manifest | null = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (prevManifest && prevManifest.dataVersion === dataVersion) {
    console.log(`Sin cambios (dataVersion ${dataVersion}). No se escribe nada.`);
    return;
  }

  const manifest = ManifestSchema.parse({
    schema: 1,
    builtAt: new Date().toISOString(),
    dataVersion,
    sources: [
      { name: 'PvPoke', url: 'https://github.com/pvpoke/pvpoke', license: 'MIT', version: sha(pokemonRaw! + movesRaw! + formatsRaw! + baseRaw! + Object.values(rankingFiles).join('')), fetchedAt },
      { name: 'PokeMiners game_masters', url: 'https://github.com/PokeMiners/game_masters', license: 'Datos del juego (sin licencia explícita)', version: gmDate, fetchedAt },
      { name: 'PokeAPI', url: 'https://github.com/PokeAPI/pokeapi', license: 'BSD-3-Clause (datos)', version: 'master', fetchedAt },
      { name: 'PokeAPI sprites', url: 'https://github.com/PokeAPI/sprites', license: 'CC0 (sprites; por URL)', version: 'master', fetchedAt },
    ],
    files: fileInfo,
    rankings: rankingMeta,
    warnings,
  });

  // escritura (solo archivos que cambiaron)
  mkdirSync(join(OUT, 'rankings'), { recursive: true });
  let written = 0;
  for (const [name, content] of Object.entries(files)) {
    if (prevManifest?.files[name]?.hash === fileInfo[name].hash && existsSync(join(OUT, name))) continue;
    writeFileSync(join(OUT, name), content);
    written++;
  }
  for (const f of readdirSync(join(OUT, 'rankings'))) if (!(`rankings/${f}` in files)) rmSync(join(OUT, 'rankings', f));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`OK: ${written} archivos escritos, dataVersion ${dataVersion}, ${warnings.length} avisos.`);
  for (const w of warnings) console.log(' · ' + w);
}

main().catch((e) => {
  console.error('FALLO en data:fetch — se conservan los datos anteriores.\n', e);
  process.exit(1);
});
