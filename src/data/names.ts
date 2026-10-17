import type { Names, Species } from './schemas';

/** minúsculas, sin acentos ni signos: base para comparar nombres es/en. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/♀/g, ' f')
    .replace(/♂/g, ' m')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const REGION_ES: Record<string, string> = { alolan: 'de Alola', galarian: 'de Galar', hisuian: 'de Hisui', paldean: 'de Paldea' };

/** Nombre en español para mostrar (la forma sombra va aparte: es una insignia, no parte del nombre). */
export function displayName(s: Pick<Species, 'dex' | 'name' | 'tags' | 'id'>, names: Names): string {
  const base = names.species[String(s.dex)] ?? s.name.replace(/\s*\(.*\)$/, '');
  const paren = s.name.match(/\(([^)]+)\)/)?.[1]?.replace(/\s*Shadow$/i, '').trim();
  for (const t of s.tags) if (REGION_ES[t]) return `${base} ${REGION_ES[t]}${paren && !/alolan|galarian|hisuian|paldean/i.test(paren) ? ` (${paren})` : ''}`;
  if (s.tags.includes('mega') || s.tags.includes('primal')) return `${base} (${paren ?? 'Mega'})`;
  return paren ? `${base} (${paren})` : base;
}

export const spriteUrl = (dex: number): string =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
export const shinySpriteUrl = (dex: number): string =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${dex}.png`;
