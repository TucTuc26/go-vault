import type { Names, Species } from '../data/schemas';
import { displayName, normalizeText } from '../data/names';

export interface SpeciesMatch {
  speciesId: string;
  score: number; // 0..1
  label: string;
  plain?: boolean;
}

interface Entry { id: string; dex: number; keys: string[]; label: string; formTokens: string[]; plain: boolean }

const FORM_WORDS: Record<string, string> = {
  alola: 'alolan', alolan: 'alolan', galar: 'galarian', galarian: 'galarian', hisui: 'hisuian', hisuian: 'hisuian',
  paldea: 'paldean', paldean: 'paldean', mega: 'mega', primal: 'primal', primigenio: 'primal',
};
const SHADOW_WORDS = new Set(['sombra', 'sombrio', 'oscuro', 'shadow']);

export function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre bigramas (0..1). */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const m = new Map<string, number>();
  for (const x of A) m.set(x, (m.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of B) {
    const c = m.get(x);
    if (c) { inter++; m.set(x, c - 1); }
  }
  return (2 * inter) / (A.length + B.length);
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const similarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(lev, dice(a, b) * 0.95);
};

export interface SpeciesIndex {
  match(text: string, limit?: number): SpeciesMatch[];
  /** Mejor coincidencia sin ambigüedad evidente, o null. */
  best(text: string): SpeciesMatch | null;
  search(text: string, limit?: number): SpeciesMatch[];
}

/** Índice de nombres es/en de las especies no-sombra liberadas (las sombras son una bandera, no otra especie). */
export function buildSpeciesIndex(species: Species[], names: Names): SpeciesIndex {
  const entries: Entry[] = [];
  for (const s of species) {
    if (s.shadow || !s.released) continue;
    const es = displayName(s, names);
    const baseEs = names.species[String(s.dex)];
    const baseEn = s.name.replace(/\s*\(.*\)$/, '');
    const keys = new Set([normalizeText(es), normalizeText(s.name), normalizeText(baseEs ?? ''), normalizeText(baseEn)]);
    keys.delete('');
    const formTokens = s.tags.filter((t) => ['alolan', 'galarian', 'hisuian', 'paldean', 'mega', 'primal'].includes(t));
    entries.push({ id: s.id, dex: s.dex, keys: [...keys], label: es, formTokens, plain: formTokens.length === 0 && !/\(/.test(s.name) });
  }
  const run = (raw: string, limit: number): SpeciesMatch[] => {
    const toks = normalizeText(raw).split(' ').filter(Boolean);
    const wantForm = new Set<string>();
    const rest: string[] = [];
    for (const t of toks) {
      if (FORM_WORDS[t]) wantForm.add(FORM_WORDS[t]);
      else if (SHADOW_WORDS.has(t) || t === 'de' || t === 'del') continue;
      else rest.push(t);
    }
    const q = rest.join(' ');
    if (!q) return [];
    const scored: SpeciesMatch[] = [];
    for (const e of entries) {
      let best = 0;
      for (const k of e.keys) {
        best = Math.max(best, similarity(q, k));
        if (k.startsWith(q) && q.length >= 3) best = Math.max(best, 0.9);
      }
      if (best < 0.5) continue;
      // preferencia de forma: coincide con la pedida; sin forma pedida, la forma "plana"
      if (wantForm.size) best *= e.formTokens.some((f) => wantForm.has(f)) ? 1 : 0.8;
      else if (!e.plain) best *= 0.97;
      scored.push({ speciesId: e.id, score: Math.min(1, best), label: e.label, plain: e.plain });
    }
    scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
    return scored.slice(0, limit);
  };
  return {
    match: (t, limit = 5) => run(t, limit),
    search: (t, limit = 8) => run(t, limit),
    best(text) {
      const r = run(text, 3);
      if (!r.length || r[0].score < 0.75) return null;
      if (r[0].plain && r[0].score >= 0.99) return r[0];
      if (r[1] && r[1].score > r[0].score - 0.03 && r[1].score > 0.9) return null; // ambiguo
      return r[0];
    },
  };
}
