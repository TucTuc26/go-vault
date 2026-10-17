/**
 * Utilidades de imagen EN MEMORIA. Nada de esto toca disco, bases de datos locales, red ni logs:
 * las imágenes se decodifican, se reducen, se leen y se descartan.
 */

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel. */
  data: Uint8ClampedArray;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Tamaño máximo del lado mayor antes de procesar/enviar (CLAUDE.md fase 3). */
export const MAX_SIDE = 1568;

export function makeImage(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Reduce (área/box) para que el lado mayor sea ≤ max. Si ya cabe, devuelve la misma imagen. */
export function resizeMaxSide(img: RawImage, max = MAX_SIDE): RawImage {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y / h) * img.height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) / h) * img.height));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x / w) * img.width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) / w) * img.width));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Recorta una zona dada en proporciones (0..1) de la imagen. */
export function cropRel(img: RawImage, r: Rect): RawImage {
  const x0 = Math.max(0, Math.floor(r.x * img.width));
  const y0 = Math.max(0, Math.floor(r.y * img.height));
  const x1 = Math.min(img.width, Math.ceil((r.x + r.w) * img.width));
  const y1 = Math.min(img.height, Math.ceil((r.y + r.h) * img.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + (x0 + x)) * 4;
      const o = (y * w + x) * 4;
      out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = 255;
    }
  return { width: w, height: h, data: out };
}

export function toGray(img: RawImage): Uint8Array {
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
  return g;
}

/** Umbral de Otsu sobre un histograma de grises. */
export function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Preprocesado para OCR: grises → umbral (Otsu) → texto oscuro sobre fondo claro (invierte si el texto es claro)
 * → ampliación entera si la zona es pequeña.
 */
export function preprocessForOcr(img: RawImage, opts: { minHeight?: number } = {}): RawImage {
  const gray = toGray(img);
  const thr = otsu(gray);
  let dark = 0;
  for (const v of gray) if (v <= thr) dark++;
  // la clase minoritaria suele ser el texto; si es la clara, invertir
  const invert = dark > gray.length / 2;
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < gray.length; i++) {
    const isInk = invert ? gray[i] > thr : gray[i] <= thr;
    const v = isInk ? 0 : 255;
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  let res: RawImage = { width: img.width, height: img.height, data: out };
  const minH = opts.minHeight ?? 64;
  if (res.height < minH) res = upscale(res, Math.ceil(minH / res.height));
  return res;
}

export function upscale(img: RawImage, k: number): RawImage {
  if (k <= 1) return img;
  const w = img.width * k, h = img.height * k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      const o = (y * w + x) * 4;
      out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = 255;
    }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// Navegador: Blob → RawImage reducido. El canvas descarta EXIF (solo se copian píxeles).
// ---------------------------------------------------------------------------

export async function blobToRawImage(blob: Blob, max = MAX_SIDE): Promise<RawImage> {
  // imageOrientation 'from-image' aplica la rotación EXIF y después el EXIF desaparece al pasar por el canvas.
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const c2d = (canvas as OffscreenCanvas).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    c2d.drawImage(bmp, 0, 0, w, h);
    const d = c2d.getImageData(0, 0, w, h);
    return { width: w, height: h, data: d.data };
  } finally {
    bmp.close();
  }
}

/** Reduce y limpia (sin EXIF) una imagen para enviarla a la API: devuelve JPEG en memoria. */
export async function blobToCleanJpeg(blob: Blob, max = MAX_SIDE, quality = 0.85): Promise<Blob> {
  const img = await blobToRawImage(blob, max);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const c2d = (canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
  c2d.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('No se pudo codificar la imagen'))), 'image/jpeg', quality));
}
