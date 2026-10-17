import type { Format } from '../data/schemas';
import type { Role } from '../db/types';
import { SHOWCASE_LABEL } from '../engine/verdict';

export const TYPE_ES: Record<string, string> = {
  normal: 'Normal', fighting: 'Lucha', flying: 'Volador', poison: 'Veneno', ground: 'Tierra', rock: 'Roca', bug: 'Bicho', ghost: 'Fantasma',
  steel: 'Acero', fire: 'Fuego', water: 'Agua', grass: 'Planta', electric: 'Eléctrico', psychic: 'Psíquico', ice: 'Hielo', dragon: 'Dragón',
  dark: 'Siniestro', fairy: 'Hada',
};

const BASE_TITLES: Record<string, string> = {
  'all-500': 'Copa Little (todos)', 'all-1500': 'Súper Liga', 'all-2500': 'Ultra Liga', 'all-10000': 'Liga Máster',
};

const WORDS: [RegExp, string][] = [
  [/Mega Great League/i, 'Súper Liga Mega'], [/Mega Ultra League/i, 'Ultra Liga Mega'], [/Mega Master League/i, 'Liga Máster Mega'],
  [/Great League/i, 'Súper Liga'], [/Ultra League/i, 'Ultra Liga'], [/Master League/i, 'Liga Máster'],
  [/\bCup\b/i, 'Copa'], [/\bLittle\b/i, 'Little'], [/\bAll Pokemon\b/i, 'todos'], [/\bSeries\b/i, 'Serie'],
];

/** Título en español de un ranking/copa (los nombres propios de copas se conservan). */
export function leagueTitleEs(key: string, formats: Format[]): string {
  if (BASE_TITLES[key]) return BASE_TITLES[key];
  const f = formats.find((x) => x.rankingKey === key);
  let t = f?.title ?? key;
  for (const [re, to] of WORDS) t = t.replace(re, to);
  if (/10000|master|máster/i.test(t) === false && f?.cp === 10000 && !/Máster/.test(t)) t += ' (Máster)';
  return t;
}

export const FLAG_LABEL: Record<string, string> = {
  shadow: 'Sombra', purified: 'Purificado', lucky: 'De suerte', shiny: 'Brillante', bestBuddy: 'Mejor amigo',
  xxl: 'XXL', xxs: 'XXS', costume: 'Disfraz', background: 'Fondo especial',
};

export const ORIGIN_LABEL: Record<string, string> = {
  unknown: 'No lo sé', wild: 'Salvaje', weather: 'Salvaje con clima', egg: 'Huevo', raid: 'Incursión', research: 'Investigación',
  rocket: 'Team GO Rocket (recluta/líder)', giovanni: 'Giovanni / incursión sombra', trade_good: 'Intercambio (Buenos amigos)',
  trade_great: 'Intercambio (Grandes amigos)', trade_ultra: 'Intercambio (Ultra amigos)', trade_best: 'Intercambio (Mejores amigos)',
  lucky_trade: 'Intercambio de suerte', purified: 'Purificado',
};

export const MOVE_STATUS_LABEL = {
  have: 'Ya lo tiene',
  tm: 'Requiere MT',
  second_move: 'Requiere 2.º ataque',
  elite_tm: 'Requiere MT Élite',
} as const;

export const ROLE_KIND_LABEL: Record<Role['kind'], string> = { pvp: 'PvP', gym: 'Gimnasio', raid: 'Raid / ataque', showcase: 'Exhibición', manual: 'Manual' };

export const showcaseLabel = (r: Extract<Role, { kind: 'showcase' }>['reason']) => SHOWCASE_LABEL[r];

export const OVERALL_LABEL = ['', 'Frase 1 (la más baja)', 'Frase 2', 'Frase 3', 'Frase 4 (la más alta)'];
export const BAR_LABEL = ['Vacía–1/3 (0–5)', '1/3–2/3 (6–10)', 'Casi llena (11–14)', 'Completa (15)'];
export const TIER_LABEL = ['', 'Baja (0–7)', 'Buena (8–12)', 'Muy buena (13–14)', 'Máxima (15)'];

export const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('es', { maximumFractionDigits: d }));

/** Títulos en español de todos los rankings (para guardarlos en los roles). */
export const leagueTitles = (formats: Format[]): Record<string, string> =>
  Object.fromEntries(formats.filter((f) => f.rankingKey).map((f) => [f.rankingKey!, leagueTitleEs(f.rankingKey!, formats)]));
