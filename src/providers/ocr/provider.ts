import { blobToRawImage, cropRel, preprocessForOcr, resizeMaxSide, type RawImage } from '../image';
import { coherentSpecies, type PipelineDeps } from '../pipeline';
import { emptyScan, fv, ScanResultSchema, type ScanInput, type ScanProvider, type ScanResult } from '../schema';
import { matchBestStats, matchOverallPhrase, matchStatTierPhrase, readBars } from './appraisal-ocr';
import { DEFAULT_APPRAISAL_LAYOUT, DEFAULT_MAIN_LAYOUT, type AppraisalLayout, type MainLayout } from './layout';
import { parseCandy, parseCp, parseDust, parseHp, parseName, type Read } from './parse';
import type { TextRecognizer } from './recognizer';

export interface OcrProviderOptions {
  recognizer: TextRecognizer;
  /** Decodifica el Blob a píxeles (por defecto, navegador). Inyectable para pruebas. */
  decode?: (blob: Blob) => Promise<RawImage>;
  mainLayout?: MainLayout;
  appraisalLayout?: AppraisalLayout;
  /** Si se da, desambigua la especie con el motor (CP/PS coherentes). */
  deps?: PipelineDeps;
  playerLevel?: number;
}

type Kind = 'main' | 'appraisal' | 'unknown';

interface Reading {
  id: string;
  kind: Kind;
  cp: Read<number>;
  hp: Read<number>;
  name: Read<string>;
  dust: Read<number>;
  candy: Read<string>;
  bars: ReturnType<typeof readBars> | null;
  overall: ReturnType<typeof matchOverallPhrase>;
  bestStats: ReturnType<typeof matchBestStats>;
  tier: ReturnType<typeof matchStatTierPhrase>;
}

/** Cuántas barras tienen lectura válida. */
const barCount = (b: Reading['bars']) => (b ? Object.values(b).filter((x) => x.band !== null).length : 0);

export function createOcrProvider(opts: OcrProviderOptions): ScanProvider {
  const decode = opts.decode ?? ((b: Blob) => blobToRawImage(b));
  const ml = opts.mainLayout ?? DEFAULT_MAIN_LAYOUT;
  const al = opts.appraisalLayout ?? DEFAULT_APPRAISAL_LAYOUT;
  const { recognizer } = opts;

  async function ocrZone(img: RawImage, rect: MainLayout[keyof MainLayout], kind: 'digits' | 'ratio' | 'text' | 'line') {
    const z = preprocessForOcr(cropRel(img, rect));
    return recognizer.recognize(z, kind);
  }

  async function read(id: string, img0: RawImage): Promise<Reading> {
    const img = resizeMaxSide(img0);
    const bars = readBars(img, al);
    // al menos 2 barras con pista y alguna con relleno (una zona lisa/blanca no cuenta como valoración)
    const hasBars = barCount(bars) >= 2 && Object.values(bars).some((b) => b.fill > 0.02);
    const [cpR, hpR, nameR, dustR, candyR, speechR] = await Promise.all([
      ocrZone(img, ml.cp, 'digits'),
      ocrZone(img, ml.hp, 'ratio'),
      ocrZone(img, ml.name, 'line'),
      ocrZone(img, ml.dust, 'digits'),
      ocrZone(img, ml.candy, 'line'),
      hasBars ? ocrZone(img, al.speech, 'text') : Promise.resolve({ text: '', confidence: 0 }),
    ]);
    const cp = parseCp(cpR.text, cpR.confidence);
    const hp = parseHp(hpR.text, hpR.confidence);
    const name = parseName(nameR.text, nameR.confidence);
    const kind: Kind = hasBars ? 'appraisal' : cp.value !== null && hp.value !== null ? 'main' : cp.value !== null || name.value ? 'main' : 'unknown';
    return {
      id, kind, cp, hp, name,
      dust: parseDust(dustR.text, dustR.confidence),
      candy: parseCandy(candyR.text, candyR.confidence),
      bars: hasBars ? bars : null,
      overall: matchOverallPhrase(speechR.text),
      bestStats: matchBestStats(speechR.text),
      tier: matchStatTierPhrase(speechR.text),
    };
  }

  /** Junta capturas del mismo Pokémon: la valoración se une a la pantalla principal con el mismo CP. */
  function group(readings: Reading[]): { main: Reading | null; appraisal: Reading | null }[] {
    const groups: { main: Reading | null; appraisal: Reading | null }[] = [];
    for (const r of readings) {
      if (r.kind === 'appraisal') {
        const g = [...groups].reverse().find((x) => x.main && !x.appraisal && (r.cp.value === null || x.main.cp.value === r.cp.value));
        if (g) g.appraisal = r;
        else groups.push({ main: null, appraisal: r });
      } else groups.push({ main: r, appraisal: null });
    }
    return groups;
  }

  function toScan(g: { main: Reading | null; appraisal: Reading | null }): ScanResult {
    const m = g.main;
    const a = g.appraisal;
    const scan = emptyScan();
    const src = m ?? a!;
    scan.sourceId = [m?.id, a?.id].filter(Boolean).join('+');
    const take = <T,>(r: Read<T> | undefined) => (r && r.value !== null ? fv(r.value, r.confidence) : fv<T>(null));
    scan.species = take(m?.name);
    scan.cp = take(m?.cp ?? a?.cp);
    scan.hp = take(m?.hp);
    scan.powerUpDust = take(m?.dust);
    scan.candyFamily = take(m?.candy);
    void src;
    if (a?.bars) {
      scan.appraisal = {
        overall: take(a.overall),
        bestStats: take(a.bestStats),
        bestStatTier: take(a.tier),
        bars: {
          atk: a.bars.atk.band === null ? fv<number>(null) : fv(a.bars.atk.band, a.bars.atk.confidence),
          def: a.bars.def.band === null ? fv<number>(null) : fv(a.bars.def.band, a.bars.def.confidence),
          hp: a.bars.hp.band === null ? fv<number>(null) : fv(a.bars.hp.band, a.bars.hp.confidence),
        },
      };
    }
    // Desambiguar la especie con el motor: elegir la que hace coherentes CP y PS.
    if (opts.deps && scan.cp.value !== null && scan.hp.value !== null && scan.species.value) {
      const cands = opts.deps.speciesIndex.match(scan.species.value, 6).filter((c) => c.score >= 0.6);
      if (cands.length > 1) {
        const top = cands[0].score;
        const near = cands.filter((c) => c.score >= top - 0.12).map((c) => c.speciesId);
        const ok = coherentSpecies(opts.deps, near, scan.cp.value, scan.hp.value, { level: scan.level.value ?? undefined, powerUpDust: scan.powerUpDust.value ?? undefined, playerLevel: opts.playerLevel });
        if (ok.length === 1 && ok[0] !== cands[0].speciesId) {
          const s = opts.deps.ctx.speciesById.get(ok[0])!;
          scan.species = fv(s.name.replace(/\s*\(.*\)$/, '') + (s.name.includes('(') ? ' ' + s.name.match(/\(([^)]+)\)/)![1] : ''), Math.min(0.9, scan.species.confidence));
        }
      }
    }
    return ScanResultSchema.parse(scan);
  }

  return {
    id: 'ocr',
    label: 'Capturas con OCR (local)',
    async scan(input: ScanInput): Promise<ScanResult[]> {
      if (input.kind !== 'images') throw new Error('El OCR solo acepta imágenes');
      const readings: Reading[] = [];
      for (const im of input.images) {
        // La imagen se decodifica en memoria, se lee y se descarta; nada se persiste.
        const raw = await decode(im.blob);
        readings.push(await read(im.id, raw));
      }
      return group(readings).filter((g) => g.main || g.appraisal).map(toScan);
    },
  };
}
