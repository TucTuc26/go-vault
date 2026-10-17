/** Interpreta el texto crudo del OCR de cada zona (tolerante a confusiones típicas de dígitos). */

const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', g: '9', T: '7' };

/** Corrige letras que el OCR suele confundir con dígitos dentro de una racha numérica. */
export function fixDigits(s: string): string {
  return s.replace(/[0-9OoDQIl|iZzSsBGgT]{2,}/g, (run) => (/[0-9]/.test(run) ? run.replace(/[OoDQIl|iZzSsBGgT]/g, (c) => DIGIT_FIX[c] ?? c) : run));
}

export interface Read<T> { value: T | null; confidence: number }

const none = <T,>(): Read<T> => ({ value: null, confidence: 0 });

/** "PC 1496", "CP1496", "1496". La confianza baja si no hay prefijo reconocible. */
export function parseCp(text: string, ocrConf = 1): Read<number> {
  const t = fixDigits(text.replace(/\s+/g, ' '));
  const m = t.match(/(?:cp|pc|c\s?p)\s*[:.]?\s*(\d{2,5})/i) ?? t.match(/\b(\d{2,5})\b/);
  if (!m) return none();
  const v = Number(m[1]);
  if (v < 10 || v > 20000) return none();
  const prefixed = /(?:cp|pc)/i.test(t);
  return { value: v, confidence: Math.min(1, ocrConf) * (prefixed ? 1 : 0.9) };
}

/** "PS 110/110" → PS máximo (segundo número). Tolera '/' leída como '7', 'I' o '1'. */
export function parseHp(text: string, ocrConf = 1): Read<number> {
  const t = fixDigits(text.replace(/\s+/g, ' '));
  let m = t.match(/(\d{1,4})\s*[\/\\|]\s*(\d{1,4})/);
  if (m) {
    const cur = Number(m[1]);
    const max = Number(m[2]);
    if (max >= 10 && cur <= max) return { value: max, confidence: Math.min(1, ocrConf) };
    return { value: null, confidence: 0 };
  }
  // "/" perdida: "110 110" o "110110"
  m = t.match(/\b(\d{2,4})\s+(\d{2,4})\b/);
  if (m && m[1] === m[2]) return { value: Number(m[2]), confidence: Math.min(1, ocrConf) * 0.85 };
  const odd = t.match(/\b(\d{2})(\d)(\d{2})\b/) ?? t.match(/\b(\d{3})(\d)(\d{3})\b/) ?? t.match(/\b(\d{4})(\d)(\d{4})\b/);
  if (odd && odd[1] === odd[3]) return { value: Number(odd[3]), confidence: Math.min(1, ocrConf) * 0.75 };
  const run = t.match(/\b(\d{4,8})\b/)?.[1];
  if (run && run.length % 2 === 0 && run.slice(0, run.length / 2) === run.slice(run.length / 2)) {
    return { value: Number(run.slice(run.length / 2)), confidence: Math.min(1, ocrConf) * 0.8 };
  }
  return none();
}

/** Polvo de mejora: 3–6 dígitos (200…15000). */
export function parseDust(text: string, ocrConf = 1): Read<number> {
  const t = fixDigits(text.replace(/[.,\s](?=\d{3}\b)/g, ''));
  const nums = [...t.matchAll(/\b(\d{3,6})\b/g)].map((m) => Number(m[1]));
  if (!nums.length) return none();
  return { value: nums[0], confidence: Math.min(1, ocrConf) * 0.95 };
}

/** "Caramelo MEDITITE" / "MEDITITE CANDY" → nombre de familia. */
export function parseCandy(text: string, ocrConf = 1): Read<string> {
  const m = text.match(/(?:caramelos?|candy)\s+([A-Za-zÀ-ÿ'.\- ]{3,30}?)(?:\s+\d|$)/i) ?? text.match(/([A-Za-zÀ-ÿ'.\-]{3,24})\s+(?:caramelos?|candy)/i);
  if (!m) return none();
  return { value: m[1].trim(), confidence: Math.min(1, ocrConf) * 0.85 };
}

/** Nombre: solo letras; descarta símbolos del lápiz/íconos y dígitos. */
export function parseName(text: string, ocrConf = 1): Read<string> {
  const cleaned = text.replace(/[^A-Za-zÀ-ÿ'.\-♀♂ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return none();
  return { value: cleaned, confidence: Math.min(1, ocrConf) * 0.9 };
}
