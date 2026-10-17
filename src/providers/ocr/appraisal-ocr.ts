import { normalizeText } from '../../data/names';
import { cropRel, type RawImage, type Rect } from '../image';
import type { AppraisalLayout } from './layout';

/** Banda de la barra: 0 = 0–5, 1 = 6–10, 2 = 11–14, 3 = 15 (ver constants.ts APPRAISAL_BAR_BANDS). */
export interface BarReading {
  band: 0 | 1 | 2 | 3 | null;
  /** Fracción de la barra rellena (0..1). */
  fill: number;
  confidence: number;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

/**
 * Lee una barra de valoración por análisis de color (sin OCR). Cada columna se clasifica como
 * "rellena" (saturada, tono cálido) o "vacía" (gris claro/blanco). La fracción rellena se convierte a banda
 * con los cortes de 5/15, 10/15 y 14/15; una barra completa de color rojo es 15.
 */
export function readBar(strip: RawImage): BarReading {
  let filled = 0, empty = 0, redFilled = 0;
  for (let x = 0; x < strip.width; x++) {
    let f = 0, e = 0, red = 0;
    for (let y = 0; y < strip.height; y++) {
      const i = (y * strip.width + x) * 4;
      const [h, s, v] = rgbToHsv(strip.data[i], strip.data[i + 1], strip.data[i + 2]);
      if (s > 0.35 && v > 0.45 && (h < 70 || h > 340)) { f++; if (h < 15 || h > 345) red++; }
      else if (s < 0.25 && v > 0.55) e++;
    }
    const h2 = strip.height / 2;
    if (f >= h2) { filled++; if (red >= h2) redFilled++; }
    else if (e >= h2) empty++;
  }
  const total = filled + empty;
  if (total < strip.width * 0.5) return { band: null, fill: 0, confidence: 0 }; // no hay barra
  const fill = filled / total;
  let band: 0 | 1 | 2 | 3;
  if (fill >= 0.97 || (fill >= 0.9 && redFilled / Math.max(1, filled) > 0.8)) band = 3;
  else if (fill > 0.68) band = 2;
  else if (fill > 0.34) band = 1;
  else band = 0;
  // cerca de un corte → menos confianza
  const cuts = [0.34, 0.68, 0.96];
  const nearest = Math.min(...cuts.map((c) => Math.abs(fill - c)));
  return { band, fill, confidence: nearest < 0.03 ? 0.6 : 0.9 };
}

export function readBars(img: RawImage, layout: AppraisalLayout): Record<'atk' | 'def' | 'hp', BarReading> {
  const cut = (r: Rect) => readBar(cropRel(img, r));
  return { atk: cut(layout.bars.atk), def: cut(layout.bars.def), hp: cut(layout.bars.hp) };
}

// ---------------------------------------------------------------------------
// Frases del líder de equipo (es/en): coincidencia aproximada por palabras clave.
// ⚠ Las frases exactas varían por líder/idioma/versión; se comparan por vocabulario distintivo.
// ---------------------------------------------------------------------------

type Tier = 1 | 2 | 3 | 4;

const OVERALL: Record<Tier, string[]> = {
  4: ['wonder', 'breathtaking', 'amazes me', 'accomplish anything', 'best of them', 'maravilla', 'impresionante', 'me asombra', 'cualquier cosa', 'los mejores', 'deja sin aliento'],
  3: ['caught my attention', 'strong pokemon', 'really strong', 'proud', 'llamado mi atencion', 'llamado la atencion', 'pokemon fuerte', 'muy fuerte', 'orgullo', 'orgulloso'],
  2: ['pretty decent', 'decent', 'not bad', 'bastante bien', 'decente', 'nada mal', 'buen pokemon'],
  1: ['not be great', 'may not be great', 'doesn t seem like much', 'still like it', 'no es muy bueno', 'no parece gran cosa', 'aun asi me gusta', 'no es gran cosa'],
};

const STAT_TIER: Record<Tier, string[]> = {
  4: ['exceed my calculations', 'incredible', 'blown away', 'wow', 'supera mis calculos', 'increible', 'alucinado', 'me deja sin palabras'],
  3: ['impressive', 'really strong', 'impresionantes', 'muy buenas', 'estadisticas muy'],
  2: ['some good stats', 'good stats', 'buenas estadisticas', 'algunas buenas'],
  1: ['don t point to greatness', 'not likely', 'no apuntan a la grandeza', 'no apuntan a algo grande', 'no auguran'],
};

const STAT_WORDS: Record<'atk' | 'def' | 'hp', string[]> = {
  atk: ['attack', 'ataque'],
  def: ['defense', 'defence', 'defensa'],
  hp: ['hp', 'stamina', 'ps', 'resistencia', 'vitalidad'],
};

export interface PhraseReading<T> { value: T | null; confidence: number }

function scoreTiers(text: string, table: Record<Tier, string[]>): PhraseReading<Tier> {
  const t = ` ${normalizeText(text)} `;
  let best: { tier: Tier; hits: number } | null = null;
  let second = 0;
  for (const tier of [4, 3, 2, 1] as Tier[]) {
    const hits = table[tier].filter((k) => t.includes(` ${normalizeText(k)} `) || t.includes(normalizeText(k))).length;
    if (!best || hits > best.hits) { if (best) second = best.hits; best = { tier, hits }; }
    else second = Math.max(second, hits);
  }
  if (!best || best.hits === 0 || best.hits === second) return { value: null, confidence: 0 };
  return { value: best.tier, confidence: second === 0 ? 0.85 : 0.6 };
}

export const matchOverallPhrase = (text: string) => scoreTiers(text, OVERALL);
export const matchStatTierPhrase = (text: string) => scoreTiers(text, STAT_TIER);

/** Stat(s) nombrados en la frase del mejor atributo ("... Ataque y Defensa"). */
export function matchBestStats(text: string): PhraseReading<('atk' | 'def' | 'hp')[]> {
  const t = normalizeText(text);
  const idx = t.search(/best attribute|mejor atributo|mejor cualidad|best stat|destaca/);
  const tail = idx >= 0 ? t.slice(idx) : t;
  const found = (Object.keys(STAT_WORDS) as ('atk' | 'def' | 'hp')[]).filter((k) => STAT_WORDS[k].some((w) => new RegExp(`\\b${w}\\b`).test(tail)));
  if (!found.length) return { value: null, confidence: 0 };
  return { value: found, confidence: idx >= 0 ? 0.8 : 0.5 };
}
