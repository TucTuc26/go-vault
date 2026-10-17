import { emptyScan, fv, ScanResultSchema, type ManualForm, type ScanInput, type ScanProvider, type ScanResult } from './schema';

/** Formulario manual → resultado estándar (confianza 1: lo escribió el usuario). */
export function formToScan(f: ManualForm): ScanResult {
  const a = f.appraisal;
  return ScanResultSchema.parse({
    species: fv(f.species.trim() || null),
    nickname: f.nickname?.trim() || null,
    cp: fv(f.cp ?? null),
    hp: fv(f.hp ?? null),
    level: fv(f.level ?? null),
    powerUpDust: fv(f.powerUpDust ?? null),
    candyFamily: fv(null),
    ivs: f.ivs ?? null,
    appraisal: a
      ? {
          overall: fv(a.overall ?? null),
          bestStats: fv(a.bestStats?.length ? a.bestStats : null),
          bestStatTier: fv(a.bestStatTier ?? null),
          bars: { atk: fv(a.bars?.atk ?? null), def: fv(a.bars?.def ?? null), hp: fv(a.bars?.hp ?? null) },
        }
      : null,
    origin: f.origin ?? null,
    flags: { shadow: null, purified: null, lucky: null, shiny: null, bestBuddy: null, xxl: null, xxs: null, costume: null, ...(f.flags ?? {}) },
    moves: { fast: fv(f.fast ?? null), charged: (f.charged ?? []).map((c) => fv(c)) },
  });
}

export const manualProvider: ScanProvider = {
  id: 'manual',
  label: 'Manual',
  async scan(input: ScanInput): Promise<ScanResult[]> {
    if (input.kind !== 'form') throw new Error('El proveedor manual solo acepta formularios');
    return [formToScan(input.form)];
  },
};

// ---------------------------------------------------------------------------
// Modo texto masivo: "Medicham 1496 15/15/14 nivel 24"
// ---------------------------------------------------------------------------

export interface ParsedLine {
  raw: string;
  lineNo: number;
  scan: ScanResult;
  warnings: string[];
  /** Tiene al menos especie y (CP+PS o IVs exactos o CP). */
  usable: boolean;
}

const FLAG_WORDS: [RegExp, keyof ScanResult['flags']][] = [
  [/\b(sombra|sombrio|oscuro|shadow)\b/i, 'shadow'],
  [/\b(purificad[oa]|purified)\b/i, 'purified'],
  [/\b(lucky|suerte|de suerte|afortunad[oa])\b/i, 'lucky'],
  [/\b(shiny|brillante|variocolor|cromad[oa])\b/i, 'shiny'],
  [/\b(xxl)\b/i, 'xxl'],
  [/\b(xxs)\b/i, 'xxs'],
  [/\b(disfraz(?:ad[oa])?|costume|gorra|sombrero)\b/i, 'costume'],
  [/\b(mejor amigo|best buddy|buddy|bff)\b/i, 'bestBuddy'],
];

const num = (s: string) => Number(s.replace(',', '.'));

export function parseBulkLine(raw: string, lineNo = 1): ParsedLine | null {
  let s = raw.trim();
  if (!s || s.startsWith('#') || s.startsWith('//')) return null;
  const warnings: string[] = [];
  const scan = emptyScan();
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = s.match(re);
    if (m) s = (s.slice(0, m.index) + ' ' + s.slice((m.index ?? 0) + m[0].length)).trim();
    return m;
  };

  // ataques: "ataques: Contraataque, Puño dinámico, Psíquico"
  const mv = take(/\b(?:ataques?|movs?|moves?|moveset)\s*[:=]\s*(.+)$/i);
  if (mv) {
    const names = mv[1].split(/[,+;/|]/).map((x) => x.trim()).filter(Boolean);
    if (names[0]) scan.moves.fast = fv(names[0], 0.9);
    scan.moves.charged = names.slice(1, 4).map((n) => fv(n, 0.9));
  }

  // IVs exactos "15/15/14" (cada uno 0..15)
  const iv = take(/(?<![\d.])(\d{1,2})\s*[\/\-–]\s*(\d{1,2})\s*[\/\-–]\s*(\d{1,2})(?![\d.])/);
  if (iv) {
    const [a, d, h] = [Number(iv[1]), Number(iv[2]), Number(iv[3])];
    if (a <= 15 && d <= 15 && h <= 15) scan.ivs = { atk: a, def: d, hp: h };
    else warnings.push(`IVs fuera de rango (0–15): ${iv[0]}`);
  }
  const pct = take(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
  if (pct) warnings.push(`Se ignoró el porcentaje ${pct[0]} (usa IVs A/D/PS o la valoración)`);

  const lv = take(/\b(?:nivel|niv|level|lvl|lv|nv)\s*\.?\s*[:=]?\s*(\d{1,2}(?:[.,]5)?)\b/i) ?? take(/(?<![\w])n\.?\s*(\d{1,2}(?:[.,]5)?)\b/i);
  if (lv) {
    const n = num(lv[1]);
    if (n >= 1 && n <= 51) scan.level = fv(n);
    else warnings.push(`Nivel fuera de rango: ${lv[1]}`);
  }
  const dust = take(/\b(?:polvo(?: estelar)?|dust|stardust)\s*[:=]?\s*(\d{3,6})\b/i);
  if (dust) scan.powerUpDust = fv(Number(dust[1]));
  const hpm = take(/\b(?:ps|hp)\s*[:=]?\s*(\d{1,4})\b/i);
  if (hpm) scan.hp = fv(Number(hpm[1]));
  const cpm = take(/\b(?:cp|pc)\s*[:=]?\s*(\d{2,5})\b/i);
  if (cpm) scan.cp = fv(Number(cpm[1]));

  for (const [re, key] of FLAG_WORDS) if (take(re)) scan.flags[key] = true;

  // números sueltos restantes (tokens separados): el primero ≥10 es el CP si falta
  const toks = s.split(/\s+/).filter(Boolean);
  const nameToks: string[] = [];
  for (const t of toks) {
    if (/^\d{2,5}$/.test(t) && Number(t) >= 10) {
      if (scan.cp.value === null) scan.cp = fv(Number(t), 0.9);
      else if (scan.hp.value === null) scan.hp = fv(Number(t), 0.8);
      else warnings.push(`Número sobrante ignorado: ${t}`);
    } else nameToks.push(t);
  }
  const name = nameToks.join(' ').replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (name) scan.species = fv(name, 0.95);
  else warnings.push('No se encontró el nombre de la especie');

  const usable = !!name && (scan.cp.value !== null || scan.ivs !== null);
  if (!usable && name) warnings.push('Falta el CP o los IVs exactos');
  return { raw, lineNo, scan: ScanResultSchema.parse(scan), warnings, usable };
}

export function parseBulkText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const p = parseBulkLine(line, i + 1);
    if (p) out.push(p);
  });
  return out;
}

export const bulkTextProvider: ScanProvider = {
  id: 'manual',
  label: 'Texto masivo',
  async scan(input: ScanInput): Promise<ScanResult[]> {
    if (input.kind !== 'text') throw new Error('El modo masivo solo acepta texto');
    return parseBulkText(input.text).filter((p) => p.usable).map((p) => p.scan);
  },
};
