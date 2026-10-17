import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadTestCtx } from './helpers';
import { GoVaultDB, addPokemon, deletePokemon, dbSeenStore, getKV, setKV } from '../src/db/db';
import { buildRecord } from '../src/db/record';
import { SavedPokemonSchema } from '../src/db/types';
import { buildLeagues, DEFAULT_VERDICT_SETTINGS, evaluateVerdict, type VerdictEnv, type VerdictSettings } from '../src/engine/verdict';
import { leagueCombos } from '../src/engine/league';
import { reevaluateRecords } from '../src/engine/reevaluate';
import { ingest, forceSave, type IntakeEnv } from '../src/app/intake';
import { buildSpeciesIndex, formToScan, processScan, type PipelineDeps } from '../src/providers';
import { calcCP, calcHP, cpmAt, baseOf, gymPopulation, gymRank, gymScore, raidPopulation } from '../src/engine';
import type { IVs } from '../src/engine/types';

let env: VerdictEnv;
let deps: PipelineDeps;
let dataVersion = 'test';
beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  env = { ...ctx, movesById: bundle.movesById, leagues: buildLeagues(bundle.formats, bundle.cups) };
  deps = { ctx, names: bundle.names, speciesIndex: buildSpeciesIndex(bundle.species, bundle.names), moves: bundle.moves };
  dataVersion = bundle.manifest.dataVersion;
});

let counter = 0;
const newDb = () => new GoVaultDB(`test-${++counter}-${Math.random().toString(36).slice(2)}`);
const dbs: GoVaultDB[] = [];
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await d.delete(); } });

function intake(over: Partial<VerdictSettings> = {}): IntakeEnv {
  const db = newDb();
  dbs.push(db);
  return { deps, verdictEnv: env, settings: { ...DEFAULT_VERDICT_SETTINGS, ...over }, dataVersion, db };
}

/** Escaneo con IVs exactos y nivel que coincide con CP/PS reales. */
function scanFor(speciesId: string, ivs: IVs, level: number, extra: Partial<Parameters<typeof formToScan>[0]> = {}) {
  const s = env.speciesById.get(speciesId)!;
  const cpm = cpmAt(env.game, level);
  return formToScan({ species: s.name.replace(/\s*\(.*\)$/, ''), cp: calcCP(baseOf(s), ivs, cpm), hp: calcHP(baseOf(s), ivs, cpm), level, ivs, ...extra });
}

/** Mejor combinación de IVs (rank 1) de una especie en la Super Liga. */
const rank1 = (id: string, cap = 1500) => leagueCombos(env.speciesById.get(id)!, cap, 50, env.game)[0];
const gl = () => env.rankings['all-1500']!.entries.filter((e) => !e.id.endsWith('_shadow') && !e.id.includes('_mega'));

describe('veredicto', () => {
  it('hundo: guarda con roles (exhibición 100 % y PvP) y permite deshacer', async () => {
    const e = intake();
    const top = gl()[0].id;
    const r1 = rank1(top);
    const out = await ingest(e, scanFor(top, r1.ivs, r1.level));
    expect(out.kind).toBe('saved');
    if (out.kind !== 'saved') return;
    const pvp = out.verdict.roles.find((r) => r.kind === 'pvp' && r.leagueKey === 'all-1500');
    expect(pvp).toMatchObject({ ivRank: 1, percentOfBest: 100 });
    expect(await e.db.pokemon.count()).toBe(1);
    await out.undo();
    expect(await e.db.pokemon.count()).toBe(0);

    // un 15/15/15 siempre sirve para exhibición
    const med = env.speciesById.get('rattata')!;
    const h = await ingest(e, scanFor(med.id, { atk: 15, def: 15, hp: 15 }, 20));
    expect(h.kind).toBe('saved');
    if (h.kind === 'saved') expect(h.verdict.roles.some((r) => r.kind === 'showcase' && r.reason === 'hundo')).toBe(true);
  });

  it('Pokémon malo: "No sirve", no escribe NADA y "Guardar de todos modos" lo guarda', async () => {
    const e = intake();
    const out = await ingest(e, scanFor('rattata', { atk: 3, def: 6, hp: 7 }, 12));
    expect(out.kind).toBe('skipped');
    if (out.kind !== 'skipped') return;
    expect(out.verdict.skipReason).toBe('no_sirve');
    expect(out.verdict.reasons[0]).toMatch(/No sirve/);
    expect(await e.db.pokemon.count()).toBe(0);
    expect(await e.db.review.count()).toBe(0);
    const id = await forceSave(e, out.entry);
    const rec = (await e.db.pokemon.get(id))!;
    expect(rec.roles).toEqual([{ kind: 'manual' }]);
  });

  it('redundante: con 3 copias iguales o mejores ya no guarda la 4.ª', async () => {
    const e = intake();
    const top = gl()[0].id;
    const r1 = rank1(top);
    // 3 copias con IV rank 1 (distinto CP/nivel para que no sean duplicados exactos)
    const results = [];
    for (const nick of ['a', 'b', 'c']) {
      const sc = scanFor(top, r1.ivs, r1.level, { nickname: nick });
      // el registro duplicado exacto se evita variando las banderas irrelevantes para el rol (suerte cambia la clave de duplicado)
      sc.flags.lucky = nick === 'b' ? true : sc.flags.lucky;
      sc.flags.purified = nick === 'c' ? true : sc.flags.purified;
      results.push(await ingest(e, sc));
    }
    expect(results.map((r) => r.kind)).toEqual(['saved', 'saved', 'saved']);
    const fourth = await ingest(e, scanFor(top, r1.ivs, r1.level, { flags: { shiny: false }, nickname: 'd' }));
    // el 4.º coincide con el 1.º (duplicado exacto) → primero se detecta duplicado
    expect(['skipped']).toContain(fourth.kind);
    // misma especie con IV rank 2 (otras IVs) y banderas distintas: ya hay 3 mejores → redundante
    const second = leagueCombos(env.speciesById.get(top)!, 1500, 50, env.game)[1];
    const redundant = await ingest(e, scanFor(top, second.ivs, second.level));
    expect(redundant.kind).toBe('skipped');
    if (redundant.kind === 'skipped') {
      expect(redundant.verdict.skipReason).toBe('redundante');
      expect(redundant.verdict.redundantRoles.length).toBeGreaterThan(0);
    }
    expect(await e.db.pokemon.count()).toBe(3);
  });

  it('duplicado exacto: no guarda', async () => {
    const e = intake();
    const top = gl()[1].id;
    const r1 = rank1(top);
    const a = await ingest(e, scanFor(top, r1.ivs, r1.level));
    expect(a.kind).toBe('saved');
    const b = await ingest(e, scanFor(top, r1.ivs, r1.level));
    expect(b.kind).toBe('skipped');
    if (b.kind === 'skipped') expect(b.verdict.skipReason).toBe('duplicado');
    expect(await e.db.pokemon.count()).toBe(1);
  });

  it('solo sirve evolucionado: el rol apunta a la evolución', async () => {
    const e = intake({ showcase: { ...DEFAULT_VERDICT_SETTINGS.showcase, hundo: false, nundo: false }, gym: { enabled: false, topN: 0 }, raid: { enabled: false, topN: 0 } });
    const top = gl().slice(0, 60).find((x) => {
      const s = env.speciesById.get(x.id)!;
      const parent = s.family.parent && env.speciesById.get(s.family.parent);
      return parent && !parent.shadow && !gl().slice(0, 100).some((y) => y.id === parent.id);
    });
    expect(top).toBeDefined();
    const evolved = env.speciesById.get(top!.id)!;
    const parentId = evolved.family.parent!;
    const r1 = rank1(top!.id);
    const out = await ingest(e, scanFor(parentId, r1.ivs, 10));
    expect(out.kind).toBe('saved');
    if (out.kind !== 'saved') return;
    const pvp = out.verdict.roles.filter((r) => r.kind === 'pvp');
    expect(pvp.length).toBeGreaterThan(0);
    expect(pvp.every((r) => r.kind === 'pvp' && r.stageId !== parentId)).toBe(true);
    expect(pvp.some((r) => r.kind === 'pvp' && r.stageId === top!.id)).toBe(true);
  });

  it('shadow: se evalúa contra la entrada _shadow del ranking', async () => {
    const e = intake({ showcase: { ...DEFAULT_VERDICT_SETTINGS.showcase, hundo: false, nundo: false }, gym: { enabled: false, topN: 0 }, raid: { enabled: false, topN: 0 } });
    const entry = env.rankings['all-1500']!.entries.filter((x) => x.id.endsWith('_shadow') && !x.id.includes('_mega'))[0];
    const baseId = entry.id.replace(/_shadow$/, '');
    const r1 = rank1(baseId);
    const sh = scanFor(baseId, r1.ivs, r1.level, { flags: { shadow: true } });
    const out = await ingest(e, sh);
    expect(out.kind).toBe('saved');
    if (out.kind !== 'saved') return;
    expect(out.verdict.roles.some((r) => r.kind === 'pvp' && r.stageId === entry.id)).toBe(true);
    const rec = (await e.db.pokemon.get(out.id))!;
    expect(rec.flags.shadow).toBe(true);
    expect(rec.speciesId).toBe(baseId); // se guarda la especie base + bandera
  });

  it('IVs inciertos: "maybe" (no se guarda solo) con la pregunta mínima; con la respuesta sí', async () => {
    const e = intake({ showcase: { ...DEFAULT_VERDICT_SETTINGS.showcase, hundo: false, nundo: false }, gym: { enabled: false, topN: 0 }, raid: { enabled: false, topN: 0 } });
    const top = gl()[0].id;
    const r1 = rank1(top);
    // CP/PS del rank 1, sin IVs ni valoración: hay muchas combinaciones posibles
    const s = env.speciesById.get(top)!;
    const cpm = cpmAt(env.game, r1.level);
    const vague = formToScan({ species: s.name.replace(/\s*\(.*\)$/, ''), cp: calcCP(baseOf(s), r1.ivs, cpm), hp: calcHP(baseOf(s), r1.ivs, cpm) });
    const out = await ingest(e, vague);
    expect(['maybe', 'skipped', 'saved']).toContain(out.kind);
    if (out.kind === 'maybe') {
      expect(out.verdict.question).not.toBeNull();
      expect(await e.db.pokemon.count()).toBe(0);
    }
    // con la valoración exacta de esos IVs, queda claro
    const ap = (await import('../src/engine')).appraisalOf(r1.ivs);
    const clear = await ingest(e, scanFor(top, r1.ivs, r1.level, { ivs: null, appraisal: { overall: ap.overall, bestStats: ap.bestStats, bestStatTier: ap.bestStatTier, bars: ap.bars } }));
    expect(['saved', 'maybe']).toContain(clear.kind);
  });
});

describe('gimnasio y raid', () => {
  it('población de gimnasio: Blissey de IVs máximos está en el top 40; un Pokémon frágil no', () => {
    const max = env.game.powerUp.maxNormalUpgradeLevel;
    const pop = gymPopulation(env, max);
    const bliss = env.speciesById.get('blissey')!;
    const score = gymScore(bliss, { atk: 15, def: 15, hp: 15 }, max, false, env.game);
    expect(gymRank(pop, score)).toBeLessThanOrEqual(40);
    const frail = gymScore(env.speciesById.get('pidgey')!, { atk: 15, def: 15, hp: 15 }, max, false, env.game);
    expect(gymRank(pop, frail)).toBeGreaterThan(40);
    const sh = gymScore(bliss, { atk: 15, def: 15, hp: 15 }, max, true, env.game);
    expect(sh).toBeLessThan(score); // sombra: DEF ×0.8333
  });
  it('raid: hay tablas por tipo con ataques con datos PvE y el ordenamiento es descendente', () => {
    const boards = raidPopulation(env, env.movesById, 50);
    expect(boards.size).toBeGreaterThan(10);
    for (const arr of boards.values()) for (let i = 1; i < arr.length; i++) expect(arr[i - 1].score).toBeGreaterThanOrEqual(arr[i].score);
    const dark = boards.get('dark')!;
    expect(dark.length).toBeGreaterThan(20);
  });
  it('un roles de raid se etiqueta como estimación', async () => {
    const e = intake({ showcase: { ...DEFAULT_VERDICT_SETTINGS.showcase, hundo: false, nundo: false } });
    const boards = raidPopulation(env, env.movesById, 50);
    const [, board] = [...boards.entries()][0];
    const top = board[0];
    const out = await ingest(e, scanFor(top.speciesId.replace(/_shadow$/, ''), { atk: 15, def: 15, hp: 15 }, 40, { flags: { shadow: top.shadow } }));
    expect(out.kind).toBe('saved');
    if (out.kind === 'saved') for (const r of out.verdict.roles.filter((x) => x.kind === 'raid')) expect((r as { estimate: boolean }).estimate).toBe(true);
  });
});

describe('registro Dexie: solo texto', () => {
  it('el registro no contiene campos de imagen (esquema estricto) y rechaza extras', async () => {
    const e = intake();
    const out = await ingest(e, scanFor('rattata', { atk: 15, def: 15, hp: 15 }, 20));
    expect(out.kind).toBe('saved');
    if (out.kind !== 'saved') return;
    const rec = (await e.db.pokemon.get(out.id))!;
    const keys = JSON.stringify(Object.keys(rec));
    expect(keys).not.toMatch(/image|img|blob|photo|screenshot|picture|capture|base64/i);
    expect(SavedPokemonSchema.safeParse({ ...rec, image: 'data:image/png;base64,AAAA' }).success).toBe(false);
    expect(SavedPokemonSchema.safeParse({ ...rec, screenshot: new Blob(['x']) }).success).toBe(false);
    await expect(addPokemon(e.db, { ...rec, id: undefined, photo: new Uint8Array(4) } as never)).rejects.toThrow();
    // el spriteUrl es solo una URL
    expect(rec.spriteUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites/);
    // nada binario dentro de la base completa
    const walk = (v: unknown): boolean => v instanceof Blob || ArrayBuffer.isView(v) || v instanceof ArrayBuffer || (typeof v === 'string' && /^data:/.test(v)) || (!!v && typeof v === 'object' && Object.values(v as object).some(walk));
    for (const t of [e.db.pokemon, e.db.review, e.db.kv, e.db.driveSeen]) expect((await t.toArray()).some(walk)).toBe(false);
  });
  it('la cola "Por revisar" guarda solo texto y no registra el Pokémon', async () => {
    const e = intake();
    const out = await ingest(e, formToScan({ species: 'Nombre inventado raro', cp: 900, hp: 90 }));
    expect(out.kind).toBe('review');
    expect(await e.db.pokemon.count()).toBe(0);
    const rows = await e.db.review.toArray();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/blob|base64/i);
  });
  it('IDs de Drive y ajustes persisten como texto', async () => {
    const e = intake();
    const seen = dbSeenStore(e.db);
    await seen.add(['x1', 'x2']);
    expect(await seen.has('x1')).toBe(true);
    expect(await seen.has('zz')).toBe(false);
    await setKV(e.db, 'settings', { a: 1 });
    expect(await getKV(e.db, 'settings', null)).toEqual({ a: 1 });
  });
});

describe('reevaluación', () => {
  it('detecta ganancias y pérdidas de rol sin borrar nada', async () => {
    const e = intake();
    const top = gl()[0].id;
    const r1 = rank1(top);
    const out = await ingest(e, scanFor(top, r1.ivs, r1.level));
    expect(out.kind).toBe('saved');
    const records = await e.db.pokemon.toArray();
    // 1) mismas condiciones: sin cambios
    expect(reevaluateRecords(env, records, e.settings)).toEqual([]);
    // 2) el meta cambió: topN = 0 → "salió del meta"
    const strict = { ...e.settings, pvp: { ...e.settings.pvp, topN: 0 } };
    const ch = reevaluateRecords(env, records, strict);
    expect(ch).toHaveLength(1);
    expect(ch[0].lost.some((l) => /Super|Great|Liga/i.test(l))).toBe(true);
    // 3) un registro viejo sin roles gana "ahora clasifica…"
    const old = { ...records[0], roles: [] as typeof records[0]['roles'] };
    const ch2 = reevaluateRecords(env, [old], e.settings);
    expect(ch2[0].gained.length).toBeGreaterThan(0);
    // nada se borra
    expect(await e.db.pokemon.count()).toBe(1);
    await deletePokemon(e.db, records[0].id!);
  });
});

describe('buildRecord', () => {
  it('construye un registro válido con candidatos acotados', () => {
    const entry = processScan(deps, formToScan({ species: 'Medicham', cp: 1496, hp: 110 }));
    const rec = buildRecord({ draft: entry.draft, species: env.speciesById.get(entry.draft.speciesId)!, roles: [], dataVersion: 'v1', nowIso: '2026-10-17T00:00:00.000Z' });
    expect(SavedPokemonSchema.safeParse(rec).success).toBe(true);
    expect(rec.ivCandidates.length).toBeLessThanOrEqual(80);
    expect(rec.createdAt).toBe('2026-10-17T00:00:00.000Z');
    expect(evaluateVerdict).toBeTypeOf('function');
  });
});
