import { z } from 'zod';

/** Esquema ÚNICO que devuelven todos los proveedores de ingreso (manual, OCR, Drive, Claude, API). */

const conf = z.number().min(0).max(1);
const field = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t.nullable(), confidence: conf });

export const OriginEnum = z.enum([
  'unknown', 'wild', 'weather', 'egg', 'raid', 'research', 'rocket', 'giovanni',
  'trade_good', 'trade_great', 'trade_ultra', 'trade_best', 'lucky_trade', 'purified',
]);

const ivInt = z.number().int().min(0).max(15);
const StatEnum = z.enum(['atk', 'def', 'hp']);

export const ScanFlagsSchema = z.object({
  shadow: z.boolean().nullable().default(null),
  purified: z.boolean().nullable().default(null),
  lucky: z.boolean().nullable().default(null),
  shiny: z.boolean().nullable().default(null),
  bestBuddy: z.boolean().nullable().default(null),
  xxl: z.boolean().nullable().default(null),
  xxs: z.boolean().nullable().default(null),
  costume: z.boolean().nullable().default(null),
  /** Fondo especial (evento/lugar). */
  background: z.boolean().nullable().default(null),
});

export const ScanAppraisalSchema = z.object({
  overall: field(z.number().int().min(1).max(4)),
  bestStats: field(z.array(StatEnum)),
  bestStatTier: field(z.number().int().min(1).max(4)),
  bars: z.object({
    atk: field(z.number().int().min(0).max(3)),
    def: field(z.number().int().min(0).max(3)),
    hp: field(z.number().int().min(0).max(3)),
  }),
});

export const ScanResultSchema = z.object({
  /** Nombre tal como se leyó (español o inglés, con forma si se ve: "Raichu de Alola"). */
  species: field(z.string().min(1)),
  nickname: z.string().nullable().default(null),
  cp: field(z.number().int().min(10).max(20000)),
  hp: field(z.number().int().min(1).max(1000)),
  level: field(z.number().min(1).max(51)),
  /** Polvo estelar que pide la siguiente mejora. */
  powerUpDust: field(z.number().int().min(0).max(100000)),
  /** Nombre de la familia en el texto "Caramelo <Especie>". */
  candyFamily: field(z.string()),
  /** IVs exactos (si el usuario los conoce); en ese caso NO se infiere. */
  ivs: z.object({ atk: ivInt, def: ivInt, hp: ivInt }).nullable().default(null),
  appraisal: ScanAppraisalSchema.nullable().default(null),
  flags: ScanFlagsSchema.default({ shadow: null, purified: null, lucky: null, shiny: null, bestBuddy: null, xxl: null, xxs: null, costume: null, background: null }),
  origin: OriginEnum.nullable().default(null),
  moves: z
    .object({ fast: field(z.string()), charged: z.array(field(z.string())).max(3) })
    .default({ fast: { value: null, confidence: 0 }, charged: [] }),
  /** Identificador opaco del origen (nombre de archivo, id de Drive…). Nunca el contenido. */
  sourceId: z.string().nullable().default(null),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
export type ScanFlags = z.infer<typeof ScanFlagsSchema>;

/** Construye un campo con valor y confianza (por defecto 1: dato introducido por el usuario). */
export const fv = <T>(value: T | null, confidence = 1): { value: T | null; confidence: number } => ({ value, confidence: value === null ? 0 : confidence });
export const noValue = { value: null, confidence: 0 } as const;

export function emptyScan(): ScanResult {
  return ScanResultSchema.parse({
    species: noValue, cp: noValue, hp: noValue, level: noValue, powerUpDust: noValue, candyFamily: noValue,
  });
}

// ---- Entradas para los proveedores ----
export type ScanInput =
  | { kind: 'images'; images: { id: string; blob: Blob }[] }
  | { kind: 'text'; text: string }
  | { kind: 'form'; form: ManualForm };

export interface ScanProvider {
  id: 'manual' | 'ocr' | 'drive' | 'claude-import' | 'api';
  label: string;
  /** Devuelve los campos extraídos (mismo esquema para todos). */
  scan(input: ScanInput): Promise<ScanResult[]>;
}

export interface ManualForm {
  species: string;
  nickname?: string;
  cp?: number | null;
  hp?: number | null;
  level?: number | null;
  powerUpDust?: number | null;
  ivs?: { atk: number; def: number; hp: number } | null;
  appraisal?: {
    overall?: number | null;
    bestStats?: ('atk' | 'def' | 'hp')[];
    bestStatTier?: number | null;
    bars?: { atk?: number | null; def?: number | null; hp?: number | null };
  } | null;
  origin?: z.infer<typeof OriginEnum> | null;
  flags?: Partial<Record<keyof ScanFlags, boolean | null>>;
  fast?: string | null;
  charged?: string[];
}
