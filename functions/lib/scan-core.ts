/**
 * Núcleo de /api/scan (Cloudflare Pages Function). Sin dependencias de Cloudflare para poder probarlo en Node.
 *
 * Garantías (CLAUDE.md, regla 2): las imágenes llegan en el cuerpo, se reenvían a Anthropic y se descartan.
 * No se guardan, no se registran ni sus contenidos ni lo que Claude extrae; solo contadores numéricos.
 */
import { z } from 'zod';
import { ImportItemSchema, itemToScan } from '../../src/providers/claude-import';
import type { ScanResult } from '../../src/providers/schema';

export interface Env {
  ANTHROPIC_API_KEY?: string;
  APP_PASSCODE?: string;
  MODEL?: string;
  DAILY_SCAN_LIMIT?: string;
  /** Opcional: KV de Cloudflare para que el límite diario sea global entre isolates. */
  SCAN_KV?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 2_000_000; // por imagen, ya reducida en el cliente (≤1568 px)
export const MAX_BODY_BYTES = 9_000_000;
export const RATE_LIMIT_PER_MIN = 12;
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RequestSchema = z.object({
  images: z
    .array(z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(16) }))
    .min(1)
    .max(MAX_IMAGES),
});

const ToolInputSchema = z.object({ pokemon: z.array(ImportItemSchema).max(20) });

export const TOOL_NAME = 'report_pokemon';

export function toolSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(ToolInputSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export const SYSTEM_PROMPT = `Eres un lector de capturas de pantalla de Pokémon GO. Extrae SOLO lo que se ve; usa null cuando no se vea o tengas duda. Está PROHIBIDO adivinar, deducir o calcular valores (IVs, niveles). Agrupa varias capturas del mismo Pokémon (pantalla principal + valoración) en un solo elemento. "hp" es el PS máximo; "power_up_stardust" es el costo de polvo de la siguiente mejora (no el polvo total del jugador). Valoración: overall 1–4 (frase general, 4 = la más alta), best_stat_tier 1–4, bars 0–3 (0 = hasta un tercio, 3 = completa/roja). Responde llamando a la herramienta ${TOOL_NAME}. Asigna "confidence" baja (<0.6) si la imagen es borrosa o parcial.`;

// --- límites en memoria (por isolate; con SCAN_KV el diario es global) ---
const hits = new Map<string, number[]>();
const daily = new Map<string, number>();

export function resetLimits(): void {
  hits.clear();
  daily.clear();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export interface ScanDeps {
  fetch: typeof fetch;
  now: () => number;
}

const realDeps = (): ScanDeps => ({ fetch: (...a) => fetch(...a), now: () => Date.now() });

export async function handleScan(request: Request, env: Env, deps: ScanDeps = realDeps()): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json(405, { error: 'Método no permitido' }, { allow: 'POST' });
  if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE) return json(503, { error: 'La API opcional está desactivada en este despliegue' });

  const pass = request.headers.get('x-app-passcode') ?? '';
  if (!timingSafeEqual(pass, env.APP_PASSCODE)) return json(401, { error: 'Código de acceso incorrecto' });

  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'desconocida';
  const now = deps.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_LIMIT_PER_MIN) return json(429, { error: 'Demasiadas solicitudes; espera un minuto' }, { 'retry-after': '60' });
  recent.push(now);
  hits.set(ip, recent);

  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) return json(413, { error: 'Cuerpo demasiado grande' });

  const limit = Number(env.DAILY_SCAN_LIMIT ?? '100');
  const dayKey = `scan:${new Date(now).toISOString().slice(0, 10)}`;
  const used = env.SCAN_KV ? Number((await env.SCAN_KV.get(dayKey)) ?? '0') : daily.get(dayKey) ?? 0;
  if (Number.isFinite(limit) && used >= limit) return json(429, { error: 'Límite diario de escaneos alcanzado' });

  let parsed: z.infer<typeof RequestSchema>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Cuerpo demasiado grande' });
    parsed = RequestSchema.parse(JSON.parse(text));
  } catch {
    return json(400, { error: 'Solicitud inválida' });
  }
  for (const img of parsed.images) {
    // longitud base64 → bytes aproximados
    if (Math.floor((img.data.length * 3) / 4) > MAX_IMAGE_BYTES) return json(413, { error: 'Imagen demasiado grande (reduce a ≤1568 px)' });
  }

  if (env.SCAN_KV) await env.SCAN_KV.put(dayKey, String(used + 1), { expirationTtl: 172_800 });
  else daily.set(dayKey, used + 1);

  let upstream: Response;
  try {
    upstream = await deps.fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.MODEL || DEFAULT_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [{ name: TOOL_NAME, description: 'Registra los Pokémon leídos de las capturas.', input_schema: toolSchema() }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [
          {
            role: 'user',
            content: [
              ...parsed.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })),
              { type: 'text', text: 'Extrae los datos de los Pokémon de estas capturas.' },
            ],
          },
        ],
      }),
    });
  } catch {
    return json(502, { error: 'No se pudo contactar con el servicio de visión' });
  }
  if (!upstream.ok) return json(502, { error: `El servicio de visión respondió ${upstream.status}` });

  try {
    const body = (await upstream.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const block = body.content?.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
    const input = ToolInputSchema.parse(block?.input);
    const results: ScanResult[] = input.pokemon.map((p, i) => itemToScan(p, `api-${i + 1}`));
    return json(200, { results });
  } catch {
    return json(502, { error: 'La respuesta del servicio no tiene el formato esperado' });
  }
}
