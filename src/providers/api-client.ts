import { z } from 'zod';
import { blobToCleanJpeg } from './image';
import { ScanResultSchema, type ScanInput, type ScanProvider, type ScanResult } from './schema';

/** Proveedor de pago opcional (APAGADO por defecto): envía imágenes reducidas a /api/scan. */

export interface ApiProviderOptions {
  endpoint?: string;
  passcode: string;
  fetch?: typeof fetch;
  /** Reduce y limpia (sin EXIF) cada imagen; inyectable para pruebas. */
  prepare?: (blob: Blob) => Promise<{ mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const defaultPrepare: NonNullable<ApiProviderOptions['prepare']> = async (blob) => {
  const jpeg = await blobToCleanJpeg(blob);
  return { mediaType: 'image/jpeg', base64: await blobToBase64(jpeg) };
};

const ResponseSchema = z.object({ results: z.array(ScanResultSchema) });

export function createApiProvider(opts: ApiProviderOptions): ScanProvider {
  const endpoint = opts.endpoint ?? '/api/scan';
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const prepare = opts.prepare ?? defaultPrepare;
  return {
    id: 'api',
    label: 'API de Claude (opcional, de pago)',
    async scan(input: ScanInput): Promise<ScanResult[]> {
      if (input.kind !== 'images') throw new Error('La API acepta solo imágenes');
      const images = [];
      for (const im of input.images) {
        const p = await prepare(im.blob);
        images.push({ mediaType: p.mediaType, data: p.base64 });
      }
      const res = await doFetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-app-passcode': opts.passcode },
        body: JSON.stringify({ images }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
      return ResponseSchema.parse(body).results;
    },
  };
}
