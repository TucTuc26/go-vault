import { z } from 'zod';
import { emptyScan, fv, noValue, OriginEnum, ScanResultSchema, type ScanInput, type ScanProvider, type ScanResult } from './schema';

/**
 * Importar desde un chat de Claude (usa la suscripción del usuario, sin API):
 * 1) "Copiar prompt" → 2) adjuntar capturas en Claude → 3) pegar el JSON aquí.
 */

const nullableBool = z.boolean().nullable().optional();
const iv = z.number().int().min(0).max(15);

export const ImportItemSchema = z.object({
  species: z.string().min(1),
  nickname: z.string().nullable().optional(),
  cp: z.number().int().min(10).max(20000).nullable().optional(),
  hp: z.number().int().min(1).max(1000).nullable().optional(),
  level: z.number().min(1).max(51).nullable().optional(),
  power_up_stardust: z.number().int().min(0).max(100000).nullable().optional(),
  candy_name: z.string().nullable().optional(),
  ivs: z.object({ attack: iv, defense: iv, hp: iv }).nullable().optional(),
  appraisal: z
    .object({
      overall: z.number().int().min(1).max(4).nullable().optional(),
      best_stats: z.array(z.enum(['attack', 'defense', 'hp'])).nullable().optional(),
      best_stat_tier: z.number().int().min(1).max(4).nullable().optional(),
      bars: z
        .object({
          attack: z.number().int().min(0).max(3).nullable().optional(),
          defense: z.number().int().min(0).max(3).nullable().optional(),
          hp: z.number().int().min(0).max(3).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  shadow: nullableBool,
  purified: nullableBool,
  lucky: nullableBool,
  shiny: nullableBool,
  best_buddy: nullableBool,
  xxl: nullableBool,
  xxs: nullableBool,
  costume: nullableBool,
  background: nullableBool,
  origin: OriginEnum.nullable().optional(),
  fast_move: z.string().nullable().optional(),
  charged_moves: z.array(z.string()).max(3).nullable().optional(),
  /** Confianza global 0..1 que Claude asigna a la lectura. */
  confidence: z.number().min(0).max(1).nullable().optional(),
});
export type ImportItem = z.infer<typeof ImportItemSchema>;

export const ImportPayloadSchema = z.object({ pokemon: z.array(z.unknown()) });

/** Ejemplo de JSON (se incrusta en el prompt para fijar el esquema exacto). */
export const IMPORT_EXAMPLE = {
  pokemon: [
    {
      species: 'Medicham', nickname: null, cp: 1496, hp: 110, level: null, power_up_stardust: 2500, candy_name: 'Meditite',
      ivs: null,
      appraisal: { overall: 4, best_stats: ['attack', 'defense'], best_stat_tier: 4, bars: { attack: 3, defense: 3, hp: 2 } },
      shadow: false, purified: false, lucky: false, shiny: false, best_buddy: false, xxl: false, xxs: false, costume: false,
      origin: null, fast_move: 'Counter', charged_moves: ['Dynamic Punch', 'Psychic'], confidence: 0.9,
    },
  ],
};

export function buildImportPrompt(): string {
  return `Voy a adjuntar capturas de pantalla de Pokémon GO (pantalla del Pokémon y, si existe, su pantalla de valoración). Extrae los datos de CADA Pokémon y respóndeme SOLO con un bloque JSON (sin texto antes ni después) con este esquema exacto:

${JSON.stringify(IMPORT_EXAMPLE, null, 2)}

REGLAS ESTRICTAS:
- Incluye únicamente lo que se VE en las capturas. Si no se ve o tienes duda, pon null. Prohibido adivinar o deducir (no calcules IVs ni niveles).
- "species": nombre exacto del Pokémon tal como aparece (en español o inglés); añade la forma si se ve (p. ej. "Raichu de Alola"). "cp" y "hp": los números de PC/CP y PS/HP máximo (el segundo número de "PS 110/110").
- "power_up_stardust": el polvo estelar que cuesta la siguiente mejora (número bajo el botón "Mejorar"), no el polvo total del jugador.
- "appraisal" (solo si hay captura de valoración): "overall" 1–4 según la frase general (1 = la más baja, 4 = la más alta); "best_stats": stats que el líder destaca ("attack", "defense", "hp"); "best_stat_tier" 1–4 según lo que dice del mejor stat; "bars": cuánto llena cada barra: 0 = hasta 1/3, 1 = hasta 2/3, 2 = casi llena, 3 = completa/roja. Si no hay valoración, pon "appraisal": null.
- "ivs": solo si la captura muestra IVs exactos (p. ej. de otra app); si no, null.
- Banderas (shadow, purified, lucky, shiny, best_buddy, xxl, xxs, costume): true solo si se ve claramente; si no, null.
- Si dos capturas son del mismo Pokémon (pantalla principal + valoración), únelas en UN solo objeto.
- Todas las claves deben existir en cada objeto. No incluyas imágenes ni enlaces. La respuesta debe ser JSON válido.`;
}

export interface ImportOutcome {
  results: ScanResult[];
  /** Errores por elemento o globales (texto para mostrar al usuario). */
  errors: string[];
}

/** Extrae el JSON de un texto pegado (acepta ```json … ``` y texto alrededor). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.search(/[\[{]/);
    const lastObj = candidate.lastIndexOf('}');
    const lastArr = candidate.lastIndexOf(']');
    const last = Math.max(lastObj, lastArr);
    if (first >= 0 && last > first) return JSON.parse(candidate.slice(first, last + 1));
    throw new SyntaxError('No se encontró JSON válido en el texto pegado');
  }
}

const BAND_STAT = { attack: 'atk', defense: 'def', hp: 'hp' } as const;

export function itemToScan(it: ImportItem, sourceId: string | null = null): ScanResult {
  const conf = it.confidence ?? 0.9;
  const v = <T,>(x: T | null | undefined) => (x === null || x === undefined ? noValue : fv(x, conf));
  const a = it.appraisal;
  const scan = emptyScan();
  return ScanResultSchema.parse({
    ...scan,
    species: fv(it.species, conf),
    nickname: it.nickname ?? null,
    cp: v(it.cp), hp: v(it.hp), level: v(it.level), powerUpDust: v(it.power_up_stardust), candyFamily: v(it.candy_name),
    ivs: it.ivs ? { atk: it.ivs.attack, def: it.ivs.defense, hp: it.ivs.hp } : null,
    appraisal: a
      ? {
          overall: v(a.overall),
          bestStats: v(a.best_stats?.length ? a.best_stats.map((s) => BAND_STAT[s]) : null),
          bestStatTier: v(a.best_stat_tier),
          bars: { atk: v(a.bars?.attack), def: v(a.bars?.defense), hp: v(a.bars?.hp) },
        }
      : null,
    flags: {
      shadow: it.shadow ?? null, purified: it.purified ?? null, lucky: it.lucky ?? null, shiny: it.shiny ?? null,
      bestBuddy: it.best_buddy ?? null, xxl: it.xxl ?? null, xxs: it.xxs ?? null, costume: it.costume ?? null, background: it.background ?? null,
    },
    origin: it.origin ?? null,
    moves: { fast: v(it.fast_move), charged: (it.charged_moves ?? []).map((m) => fv(m, conf)) },
    sourceId,
  });
}

/** Valida el JSON pegado con Zod. Acepta {pokemon:[…]}, un arreglo o un solo objeto. */
export function parseImport(text: string): ImportOutcome {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { results: [], errors: [`JSON inválido: ${(e as Error).message}`] };
  }
  let items: unknown[];
  if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === 'object' && Array.isArray((raw as { pokemon?: unknown }).pokemon)) items = (raw as { pokemon: unknown[] }).pokemon;
  else if (raw && typeof raw === 'object' && 'species' in raw) items = [raw];
  else return { results: [], errors: ['El JSON no tiene la forma esperada: usa {"pokemon": [ … ]}'] };
  if (!items.length) return { results: [], errors: ['La lista "pokemon" está vacía'] };
  const results: ScanResult[] = [];
  items.forEach((item, i) => {
    const p = ImportItemSchema.safeParse(item);
    if (p.success) results.push(itemToScan(p.data, `claude-${i + 1}`));
    else errors.push(`Elemento ${i + 1}: ${p.error.issues.slice(0, 3).map((x) => `${x.path.join('.') || '(raíz)'}: ${x.message}`).join('; ')}`);
  });
  return { results, errors };
}

export const claudeImportProvider: ScanProvider = {
  id: 'claude-import',
  label: 'Importar de Claude',
  async scan(input: ScanInput): Promise<ScanResult[]> {
    if (input.kind !== 'text') throw new Error('La importación acepta solo texto JSON');
    const out = parseImport(input.text);
    if (!out.results.length) throw new Error(out.errors.join(' | ') || 'Sin resultados');
    return out.results;
  },
};
