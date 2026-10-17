import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadTestCtx } from './helpers';
import {
  appraisalOf, calcCP, calcHP, cpmAt, baseOf, dustForNextPowerUp, inferIVs,
} from '../src/engine';
import {
  buildImportPrompt, buildSpeciesIndex, bulkTextProvider, claudeImportProvider, createApiProvider, createDriveClient, createDriveProvider,
  createOcrProvider, formToScan, makeImage, manualProvider, memorySeenStore, parseBulkLine, parseBulkText, parseFolderId, parseImport,
  processScan, resizeMaxSide, ScanResultSchema, DRIVE_SCOPE, IMPORT_EXAMPLE,
  type PipelineDeps, type RawImage, type TextRecognizer,
} from '../src/providers';
import { DEFAULT_APPRAISAL_LAYOUT, DEFAULT_MAIN_LAYOUT } from '../src/providers/ocr/layout';
import { cropRel, preprocessForOcr } from '../src/providers/image';
import { readBar } from '../src/providers/ocr/appraisal-ocr';
import { parseCandy, parseCp, parseDust, parseHp, parseName } from '../src/providers/ocr/parse';
import { handleScan, resetLimits, type Env } from '../functions/lib/scan-core';

let deps: PipelineDeps;
beforeAll(async () => {
  const { bundle, ctx } = await loadTestCtx();
  deps = { ctx, names: bundle.names, speciesIndex: buildSpeciesIndex(bundle.species, bundle.names), moves: bundle.moves };
});

/** CP/PS/polvo reales para IVs y nivel dados (coherentes con el motor). */
function realStats(speciesId: string, ivs: { atk: number; def: number; hp: number }, level: number, flags = {}) {
  const s = deps.ctx.speciesById.get(speciesId)!;
  const cpm = cpmAt(deps.ctx.game, level);
  return { cp: calcCP(baseOf(s), ivs, cpm), hp: calcHP(baseOf(s), ivs, cpm), dust: dustForNextPowerUp(deps.ctx.game, level, flags)! };
}

describe('reconocimiento de especie (es/en)', () => {
  it('encuentra por nombre en español, inglés, con errores y con forma', () => {
    const idx = deps.speciesIndex;
    expect(idx.best('Medicham')?.speciesId).toBe('medicham');
    expect(idx.best('medicham')?.speciesId).toBe('medicham');
    expect(idx.best('Medichan')?.speciesId).toBe('medicham');
    expect(idx.best('Raichu de Alola')?.speciesId).toBe('raichu_alolan');
    expect(idx.best('Alolan Raichu')?.speciesId).toBe('raichu_alolan');
    expect(idx.best('Raichu')?.speciesId).toBe('raichu');
    expect(idx.best('Mr. Mime')?.speciesId).toBe('mr_mime');
    expect(idx.best('zzzzqq')).toBeNull();
  });
  it('un nombre en español (de PokeAPI) también funciona', () => {
    const es = deps.names.species['6']; // Charizard
    expect(es).toBeTruthy();
    expect(deps.speciesIndex.best(es)?.speciesId).toBe('charizard');
  });
});

describe('proveedor MANUAL y texto masivo', () => {
  it('formulario → ScanResult válido → pipeline OK con IVs exactos', async () => {
    const st = realStats('medicham', { atk: 15, def: 15, hp: 14 }, 24);
    const [r] = await manualProvider.scan({
      kind: 'form',
      form: { species: 'Medicham', cp: st.cp, hp: st.hp, level: 24, ivs: { atk: 15, def: 15, hp: 14 }, flags: { shiny: true }, fast: 'Counter', charged: ['Dynamic Punch'] },
    });
    expect(ScanResultSchema.safeParse(r).success).toBe(true);
    const out = processScan(deps, r);
    expect(out.status).toBe('ok');
    expect(out.draft.ivs).toEqual({ atk: 15, def: 15, hp: 14 });
    expect(out.draft.ivsExact).toBe(true);
    expect(out.draft.moves).toEqual({ fast: 'COUNTER', charged: ['DYNAMIC_PUNCH'] });
    expect(out.draft.flags.shiny).toBe(true);
  });
  it('IVs exactos que no encajan con CP/PS → lectura dudosa', () => {
    const r = formToScan({ species: 'Medicham', cp: 1496, hp: 110, level: 24, ivs: { atk: 0, def: 0, hp: 0 } });
    const out = processScan(deps, r);
    expect(out.status).toBe('review');
    expect(out.doubtful).toBe(true);
  });
  it('parser masivo tolerante', () => {
    const l = parseBulkLine('Medicham 1496 15/15/14 nivel 24')!;
    expect(l.scan.species.value).toBe('Medicham');
    expect(l.scan.cp.value).toBe(1496);
    expect(l.scan.ivs).toEqual({ atk: 15, def: 15, hp: 14 });
    expect(l.scan.level.value).toBe(24);
    expect(l.usable).toBe(true);
    const b = parseBulkLine('Raichu de Alola sombra PC 2100 PS 140 lvl 30.5 polvo 4500 lucky ataques: Spark, Wild Charge, Surf')!;
    expect(b.scan.species.value).toBe('Raichu de Alola');
    expect(b.scan.flags.shadow).toBe(true);
    expect(b.scan.flags.lucky).toBe(true);
    expect([b.scan.cp.value, b.scan.hp.value, b.scan.level.value, b.scan.powerUpDust.value]).toEqual([2100, 140, 30.5, 4500]);
    expect(b.scan.moves.fast.value).toBe('Spark');
    expect(b.scan.moves.charged.map((m) => m.value)).toEqual(['Wild Charge', 'Surf']);
    expect(parseBulkLine('# comentario')).toBeNull();
    expect(parseBulkLine('')).toBeNull();
    const bad = parseBulkLine('Medicham 99/2/3')!;
    expect(bad.warnings.join()).toContain('fuera de rango');
    expect(bad.usable).toBe(false);
    const pct = parseBulkLine('Gible 480 96%')!;
    expect(pct.warnings.join()).toContain('porcentaje');
  });
  it('varias líneas y el proveedor devuelve solo las usables', async () => {
    const text = 'Medicham 1496 15/15/14 nivel 24\n\nGible\nAltaria 1400 14 15 15\n# nada';
    expect(parseBulkText(text)).toHaveLength(3);
    const res = await bulkTextProvider.scan({ kind: 'text', text });
    expect(res.length).toBe(2);
  });
  it('caso común: el pipeline infiere IVs desde CP/PS/nivel y los marca ambiguos o únicos', () => {
    const iv = { atk: 3, def: 14, hp: 15 };
    const st = realStats('medicham', iv, 30);
    const out = processScan(deps, formToScan({ species: 'Medicham', cp: st.cp, hp: st.hp, level: 30, powerUpDust: st.dust }));
    expect(out.status).toBe('ok');
    expect(out.draft.candidates.some((c) => c.ivs.atk === 3 && c.ivs.def === 14 && c.ivs.hp === 15)).toBe(true);
  });
  it('especie no reconocida → por revisar con alternativas', () => {
    const out = processScan(deps, formToScan({ species: 'Medicgam raro', cp: 1000, hp: 100 }));
    expect(out.status).toBe('review');
    expect(out.reasons.join()).toMatch(/Especie/);
  });
});

describe('proveedor OCR local (entradas simuladas)', () => {
  const W = 400, H = 800;
  function paintBar(img: RawImage, rect: { x: number; y: number; w: number; h: number }, fraction: number, color: [number, number, number]) {
    const x0 = Math.round(rect.x * W), x1 = Math.round((rect.x + rect.w) * W);
    const y0 = Math.round(rect.y * H), y1 = Math.round((rect.y + rect.h) * H) + 1;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const filled = x - x0 < fraction * (x1 - x0);
        const c = filled ? color : [225, 225, 225];
        const i = (y * W + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
      }
  }
  const fractionOfBand = [0.2, 0.5, 0.8, 1];
  function appraisalImage(ivs: { atk: number; def: number; hp: number }): RawImage {
    const img = makeImage(W, H);
    const a = appraisalOf(ivs);
    (['atk', 'def', 'hp'] as const).forEach((k) => paintBar(img, DEFAULT_APPRAISAL_LAYOUT.bars[k], fractionOfBand[a.bars[k]!], a.bars[k] === 3 ? [220, 40, 40] : [240, 150, 30]));
    return img;
  }

  /** Reconocedor falso: devuelve el texto de cada zona según el tamaño del recorte y la captura actual. */
  function makeFake(script: Record<string, Record<string, { text: string; confidence: number }>>) {
    const state = { current: 0 };
    const key = (rect: { x: number; y: number; w: number; h: number }) => {
      const z = preprocessForOcr(cropRel(makeImage(W, H), rect));
      return `${z.width}x${z.height}`;
    };
    const sizes: Record<string, string> = {
      [key(DEFAULT_MAIN_LAYOUT.cp)]: 'cp', [key(DEFAULT_MAIN_LAYOUT.hp)]: 'hp', [key(DEFAULT_MAIN_LAYOUT.name)]: 'name',
      [key(DEFAULT_MAIN_LAYOUT.dust)]: 'dust', [key(DEFAULT_MAIN_LAYOUT.candy)]: 'candy', [key(DEFAULT_APPRAISAL_LAYOUT.speech)]: 'speech',
    };
    const recognizer: TextRecognizer = {
      async recognize(img) {
        const zone = sizes[`${img.width}x${img.height}`];
        return script[String(state.current)]?.[zone] ?? { text: '', confidence: 0 };
      },
    };
    return { state, recognizer };
  }

  it('lee 3 capturas: principal + valoración (agrupadas), especie ambigua resuelta por el motor, y una dudosa', async () => {
    const ivs = { atk: 12, def: 13, hp: 14 };
    const st = realStats('medicham', ivs, 24);
    // "Pidgeoto" (falta una t) es ambiguo entre Pidgeot y Pidgeotto: solo Pidgeot es coherente con ese CP/PS
    const vul = realStats('pidgeot', { atk: 10, def: 12, hp: 14 }, 40);
    expect(inferIVs(deps.ctx.game, { species: deps.ctx.speciesById.get('pidgeotto')!, cp: vul.cp, hp: vul.hp, powerUpDust: vul.dust }).inconsistent).toBe(true);
    expect(deps.speciesIndex.match('Pidgeoto', 3).map((m) => m.speciesId)).toEqual(expect.arrayContaining(['pidgeot', 'pidgeotto']));
    const fake = makeFake({
      '0': {
        cp: { text: `PC ${st.cp}`, confidence: 0.96 }, hp: { text: `PS ${st.hp}/${st.hp}`, confidence: 0.93 },
        name: { text: 'Medicham ✎', confidence: 0.95 }, dust: { text: String(st.dust), confidence: 0.94 }, candy: { text: 'Caramelo MEDITITE 12', confidence: 0.9 },
      },
      '1': {
        cp: { text: `PC ${st.cp}`, confidence: 0.9 },
        speech: { text: 'Overall, your Medicham is a wonder! What a breathtaking Pokémon! Its best attribute is HP. Its stats are impressive.', confidence: 0.8 },
      },
      '2': {
        cp: { text: `PC ${vul.cp}`, confidence: 0.95 }, hp: { text: `PS ${vul.hp}/${vul.hp}`, confidence: 0.95 },
        name: { text: 'Pidgeoto', confidence: 0.95 }, dust: { text: String(vul.dust), confidence: 0.95 }, candy: { text: 'PIDGEY CANDY', confidence: 0.9 },
      },
      '3': {
        cp: { text: 'PC 1O96', confidence: 0.42 }, hp: { text: 'PS 11O/11O', confidence: 0.4 },
        name: { text: 'Medicham', confidence: 0.45 }, dust: { text: '2500', confidence: 0.4 },
      },
    });
    const images = [makeImage(W, H), appraisalImage(ivs), makeImage(W, H), makeImage(W, H)];
    const ocr = createOcrProvider({
      recognizer: fake.recognizer,
      decode: async (b) => { const idx = Number(await b.text()); fake.state.current = idx; return images[idx]; },
      deps,
    });
    const results = await ocr.scan({ kind: 'images', images: [0, 1, 2, 3].map((i) => ({ id: `img${i}`, blob: new Blob([String(i)]) })) });
    expect(results).toHaveLength(3); // 0+1 agrupadas, 2, 3
    expect(results.every((r) => ScanResultSchema.safeParse(r).success)).toBe(true);

    const [a, v, d] = results;
    expect(a.sourceId).toBe('img0+img1');
    expect(a.species.value).toBe('Medicham');
    expect(a.cp.value).toBe(st.cp);
    expect(a.hp.value).toBe(st.hp);
    expect(a.powerUpDust.value).toBe(st.dust);
    expect(a.candyFamily.value).toBe('MEDITITE');
    const exp = appraisalOf(ivs);
    expect(a.appraisal!.bars.atk.value).toBe(exp.bars.atk);
    expect(a.appraisal!.bars.def.value).toBe(exp.bars.def);
    expect(a.appraisal!.bars.hp.value).toBe(exp.bars.hp);
    expect(a.appraisal!.overall.value).toBe(exp.overall);
    expect(a.appraisal!.bestStats.value).toEqual(['hp']);

    const okEntry = processScan(deps, a);
    expect(okEntry.reasons).toEqual([]);
    expect(okEntry.status).toBe('ok');
    expect(okEntry.draft.candidates.some((c) => c.ivs.atk === 12 && c.ivs.def === 13 && c.ivs.hp === 14 && c.level === 24)).toBe(true);

    expect(processScan(deps, v).draft.speciesId).toBe('pidgeot');
    expect(processScan(deps, v).status).toBe('ok');

    // confianza baja → a "Por revisar" (solo texto)
    expect(d.cp.confidence).toBeLessThan(0.8);
    const review = processScan(deps, d);
    expect(review.status).toBe('review');
    expect(review.reasons.join()).toMatch(/poco seguro|dudosa/);
  });

  it('las barras se leen por color (no OCR) en todos los tramos', () => {
    const strip = (fraction: number, color: [number, number, number]) => {
      const img = makeImage(200, 8, [225, 225, 225]);
      for (let x = 0; x < Math.round(fraction * 200); x++)
        for (let y = 0; y < 8; y++) { const i = (y * 200 + x) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; }
      return img;
    };
    expect(readBar(strip(0, [240, 150, 30])).band).toBe(0);
    expect(readBar(strip(0.3, [240, 150, 30])).band).toBe(0);
    expect(readBar(strip(0.5, [240, 150, 30])).band).toBe(1);
    expect(readBar(strip(0.85, [240, 150, 30])).band).toBe(2);
    expect(readBar(strip(1, [220, 40, 40])).band).toBe(3);
    expect(readBar(makeImage(200, 8, [20, 20, 60])).band).toBeNull(); // fondo oscuro = no hay barra
  });

  it('parsers de texto OCR toleran confusiones de dígitos', () => {
    expect(parseCp('PC 1496').value).toBe(1496);
    expect(parseCp('CP l496').value).toBe(1496);
    expect(parseCp('PC 1O96').value).toBe(1096);
    expect(parseCp('basura').value).toBeNull();
    expect(parseHp('PS 110/110').value).toBe(110);
    expect(parseHp('PS 85/110').value).toBe(110);
    expect(parseHp('PS 110 110').value).toBe(110);
    expect(parseHp('PS 110I110').value).toBe(110);
    expect(parseDust('2 500').value).toBe(2500);
    expect(parseDust('1300').value).toBe(1300);
    expect(parseCandy('Caramelo MEDITITE 12').value).toBe('MEDITITE');
    expect(parseCandy('VULPIX CANDY').value).toBe('VULPIX');
    expect(parseName('✎ Medicham 123').value).toBe('Medicham');
  });
  it('preprocesado: la imagen se reduce a ≤1568 px y se binariza', () => {
    const big = makeImage(3136, 1000);
    const r = resizeMaxSide(big);
    expect(Math.max(r.width, r.height)).toBe(1568);
    const p = preprocessForOcr(cropRel(makeImage(100, 20, [10, 10, 10]), { x: 0, y: 0, w: 1, h: 1 }));
    expect(new Set(Array.from(p.data.filter((_, i) => i % 4 === 0))).size).toBeLessThanOrEqual(2);
  });
});

describe('Importar desde un chat de Claude', () => {
  const valid = JSON.stringify({
    pokemon: [
      { species: 'Medicham', cp: 1496, hp: 110, power_up_stardust: 2500, appraisal: { overall: 4, best_stats: ['attack'], best_stat_tier: 4, bars: { attack: 3, defense: 3, hp: 2 } }, shadow: false, confidence: 0.9 },
      { species: 'Gible', cp: 480, hp: 90, level: null, ivs: { attack: 15, defense: 15, hp: 15 } },
    ],
  });
  it('el prompt incluye el esquema exacto y las reglas', () => {
    const p = buildImportPrompt();
    expect(p).toContain(JSON.stringify(IMPORT_EXAMPLE, null, 2));
    expect(p).toMatch(/null/);
    expect(p).toMatch(/adivinar/);
  });
  it('JSON válido (varios Pokémon, con o sin ```json) → ScanResult', async () => {
    const out = parseImport('Aquí tienes:\n```json\n' + valid + '\n```');
    expect(out.errors).toEqual([]);
    expect(out.results).toHaveLength(2);
    expect(out.results[0].appraisal!.bars.atk.value).toBe(3);
    expect(out.results[1].ivs).toEqual({ atk: 15, def: 15, hp: 15 });
    const viaProvider = await claudeImportProvider.scan({ kind: 'text', text: valid });
    expect(viaProvider).toHaveLength(2);
    expect(processScan(deps, out.results[1]).draft.speciesId).toBe('gible');
  });
  it('acepta un arreglo o un objeto suelto', () => {
    expect(parseImport(JSON.stringify([{ species: 'Gible', cp: 480 }])).results).toHaveLength(1);
    expect(parseImport(JSON.stringify({ species: 'Gible', cp: 480 })).results).toHaveLength(1);
  });
  it('JSON inválido o con valores fuera de rango → errores claros, sin romper el lote', async () => {
    expect(parseImport('esto no es json').errors[0]).toMatch(/JSON inválido/);
    const mixed = parseImport(JSON.stringify({ pokemon: [{ species: 'Gible', cp: 480 }, { species: 'X', cp: -5 }, { cp: 100 }] }));
    expect(mixed.results).toHaveLength(1);
    expect(mixed.errors).toHaveLength(2);
    expect(parseImport(JSON.stringify({ otra: 1 })).errors[0]).toMatch(/forma esperada/);
    expect(parseImport(JSON.stringify({ pokemon: [] })).errors[0]).toMatch(/vacía/);
    await expect(claudeImportProvider.scan({ kind: 'text', text: '{' })).rejects.toThrow();
  });
});

describe('Carpeta de Google Drive (simulada, solo lectura)', () => {
  function fakeDrive() {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const files = [
      { id: 'f1aaaaaaaaaa', name: 'a.png', mimeType: 'image/png', createdTime: '2026-10-01T10:00:00Z' },
      { id: 'f2aaaaaaaaaa', name: 'b.png', mimeType: 'image/png', createdTime: '2026-10-01T10:01:00Z' },
    ];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') });
      if (String(url).includes('alt=media')) return new Response(new Blob(['binario']), { status: 200 });
      return new Response(JSON.stringify({ files }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }
  it('lista, descarga en memoria, procesa y recuerda solo los IDs; nunca escribe', async () => {
    const { calls, fetchFn } = fakeDrive();
    const seen = memorySeenStore();
    const inner = { id: 'ocr' as const, label: 'x', scan: vi.fn(async () => [formToScan({ species: 'Gible', cp: 480 })]) };
    const provider = createDriveProvider({ folderId: '1AbCdEfGhIjKlMnOp', client: createDriveClient({ getToken: async () => 'tok', fetch: fetchFn }), seen, inner });
    const r1 = await provider.scan({ kind: 'images', images: [] });
    expect(r1).toHaveLength(1);
    expect(inner.scan).toHaveBeenCalledTimes(1);
    const input = (inner.scan.mock.calls as unknown as [{ kind: string; images: { id: string; blob: Blob }[] }][])[0][0];
    expect(input.images.map((i) => i.id)).toEqual(['f1aaaaaaaaaa', 'f2aaaaaaaaaa']);
    expect([...seen.ids]).toEqual(['f1aaaaaaaaaa', 'f2aaaaaaaaaa']);
    expect(calls.every((c) => c.method === 'GET' && c.auth === 'Bearer tok')).toBe(true);
    expect(calls.every((c) => c.url.startsWith('https://www.googleapis.com/drive/v3/files'))).toBe(true);
    // segunda pasada: nada nuevo
    const r2 = await provider.scan({ kind: 'images', images: [] });
    expect(r2).toEqual([]);
    expect(inner.scan).toHaveBeenCalledTimes(1);
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly');
  });
  it('acepta URL de carpeta e ID; rechaza basura', () => {
    expect(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseFolderId('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseFolderId("x' or '1'='1")).toBeNull();
  });
  it('errores de acceso se explican', async () => {
    const client = createDriveClient({ getToken: async () => 't', fetch: (async () => new Response('', { status: 403 })) as unknown as typeof fetch });
    await expect(client.listImages('1AbCdEfGhIjKlMnOp')).rejects.toThrow(/rechaz/);
  });
});

describe('API de Claude (opcional) — función de Cloudflare', () => {
  const env: Env = { ANTHROPIC_API_KEY: 'sk-test', APP_PASSCODE: 'secreto', DAILY_SCAN_LIMIT: '3' };
  const b64 = Buffer.from('x'.repeat(100)).toString('base64');
  const req = (over: { pass?: string; body?: unknown; method?: string; ip?: string } = {}) =>
    new Request('https://x.test/api/scan', {
      method: over.method ?? 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': over.pass ?? 'secreto', 'cf-connecting-ip': over.ip ?? '1.1.1.1' },
      body: over.method === 'GET' ? undefined : JSON.stringify(over.body ?? { images: [{ mediaType: 'image/jpeg', data: b64 }] }),
    });
  const upstreamOk = () => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'report_pokemon', input: { pokemon: [{ species: 'Medicham', cp: 1496, hp: 110, confidence: 0.9 }] } }] }), { status: 200 }));

  it('apagada sin clave; 401 con código incorrecto; 405 con GET', async () => {
    resetLimits();
    expect((await handleScan(req(), {})).status).toBe(503);
    expect((await handleScan(req({ pass: 'malo' }), env, { fetch: upstreamOk() as never, now: () => 1 })).status).toBe(401);
    expect((await handleScan(req({ method: 'GET' }), env)).status).toBe(405);
  });
  it('éxito: valida con Zod, Cache-Control: no-store, y reenvía la imagen sin guardarla ni registrarla', async () => {
    resetLimits();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const up = upstreamOk();
    const res = await handleScan(req(), env, { fetch: up as never, now: () => 1000 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { results: unknown[] };
    expect(ScanResultSchema.safeParse(body.results[0]).success).toBe(true);
    const sent = JSON.parse((up.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'report_pokemon' });
    expect(sent.messages[0].content[0].type).toBe('image');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    logSpy.mockRestore(); errSpy.mockRestore();
  });
  it('MODEL configurable, límite diario, rate limit por IP y tamaño máximo', async () => {
    resetLimits();
    const up = upstreamOk();
    const d = { fetch: up as never, now: () => Date.UTC(2026, 9, 17, 12) };
    await handleScan(req(), { ...env, MODEL: 'otro-modelo' }, d);
    expect(JSON.parse((up.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe('otro-modelo');
    await handleScan(req(), env, d);
    await handleScan(req(), env, d);
    expect((await handleScan(req(), env, d)).status).toBe(429); // 4.º del día (límite 3)
    resetLimits();
    let last = 200;
    for (let i = 0; i < 14; i++) last = (await handleScan(req(), { ...env, DAILY_SCAN_LIMIT: '1000' }, d)).status;
    expect(last).toBe(429);
    resetLimits();
    const big = 'A'.repeat(3_000_000);
    expect((await handleScan(req({ body: { images: [{ mediaType: 'image/jpeg', data: big }] } }), env, d)).status).toBe(413);
    expect((await handleScan(req({ body: { images: [] } }), env, d)).status).toBe(400);
  });
  it('si el servicio responde mal, 502 genérico (sin filtrar contenido)', async () => {
    resetLimits();
    const bad = vi.fn(async () => new Response('{"content":[]}', { status: 200 }));
    const res = await handleScan(req(), env, { fetch: bad as never, now: () => 5 });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('Medicham');
  });
  it('el cliente agrupa imágenes, envía el código y valida la respuesta', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ results: [formToScan({ species: 'Gible', cp: 480 })] }), { status: 200 }));
    const p = createApiProvider({ passcode: 'secreto', fetch: f as never, prepare: async () => ({ mediaType: 'image/jpeg', base64: 'QUJD' }) });
    const out = await p.scan({ kind: 'images', images: [{ id: 'a', blob: new Blob(['x']) }, { id: 'b', blob: new Blob(['y']) }] });
    expect(out).toHaveLength(1);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-app-passcode']).toBe('secreto');
    expect(JSON.parse(init.body as string).images).toHaveLength(2);
    expect(init.cache).toBe('no-store');
    const failing = createApiProvider({ passcode: 'x', fetch: (async () => new Response(JSON.stringify({ error: 'Código de acceso incorrecto' }), { status: 401 })) as never, prepare: async () => ({ mediaType: 'image/jpeg', base64: 'QUJD' }) });
    await expect(failing.scan({ kind: 'images', images: [{ id: 'a', blob: new Blob(['x']) }] })).rejects.toThrow(/Código/);
  });
});

describe('NINGUNA imagen se guarda', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  const containsBinary = (v: unknown, seen = new Set<unknown>()): boolean => {
    if (v === null || typeof v !== 'object') return typeof v === 'string' && /^data:(image|application)\//.test(v);
    if (seen.has(v)) return false;
    seen.add(v);
    if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return true;
    return Object.values(v as Record<string, unknown>).some((x) => containsBinary(x, seen));
  };
  it('los resultados de los proveedores y los borradores no contienen datos binarios', async () => {
    const results = [formToScan({ species: 'Gible', cp: 480 }), ...parseImport(JSON.stringify({ pokemon: [{ species: 'Gible', cp: 480 }] })).results];
    for (const r of results) {
      expect(containsBinary(r)).toBe(false);
      expect(containsBinary(processScan(deps, r))).toBe(false);
    }
  });
  it('el código de proveedores y de la función no usa almacenamiento persistente ni URLs de objeto', () => {
    const files = [...walk(join(__dirname, '..', 'src', 'providers')), ...walk(join(__dirname, '..', 'functions'))];
    expect(files.length).toBeGreaterThan(5);
    const banned = [/localStorage/, /sessionStorage/, /indexedDB/i, /\bDexie\b/, /caches\.(put|open)/, /createObjectURL/, /showSaveFilePicker/, /FileSystemFileHandle/, /writeFile/, /console\.(log|info|debug|warn|error)/, /\.add\(\{/];
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('drive.ts')) continue; // usa SeenStore (solo IDs de texto); revisado abajo
      const src = readFileSync(f, 'utf8');
      for (const b of banned) if (b.test(src)) offenders.push(`${f}: ${b}`);
    }
    expect(offenders).toEqual([]);
    // la función solo escribe en KV el contador diario (nunca imágenes ni resultados)
    const core = readFileSync(join(__dirname, '..', 'functions', 'lib', 'scan-core.ts'), 'utf8');
    const puts = core.match(/SCAN_KV\.put\([^\n]*/g) ?? [];
    expect(puts).toEqual(['SCAN_KV.put(dayKey, String(used + 1), { expirationTtl: 172_800 });']);
    const drive = readFileSync(join(__dirname, '..', 'src', 'providers', 'drive.ts'), 'utf8');
    expect(drive).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(drive).toMatch(/seen\.add\(fresh\.map\(\(f\) => f\.id\)\)/);
  });
});
