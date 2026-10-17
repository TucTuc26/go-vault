import type { RawImage } from '../image';

export type ZoneKind = 'digits' | 'ratio' | 'text' | 'line';

export interface Recognition { text: string; confidence: number }

/** Motor de OCR intercambiable: Tesseract en el navegador, o un doble de prueba. */
export interface TextRecognizer {
  recognize(img: RawImage, kind: ZoneKind): Promise<Recognition>;
  dispose?(): Promise<void>;
}

/**
 * Tesseract.js local (gratis, sin servidor). Solo se descargan los datos de idioma y el worker (nunca se sube la imagen).
 * Carga perezosa para no inflar el bundle inicial.
 */
export function createTesseractRecognizer(langs: string[] = ['spa', 'eng']): TextRecognizer {
  let workerP: Promise<any> | null = null;
  const get = () => {
    workerP ??= import('tesseract.js').then((T) => T.createWorker(langs));
    return workerP;
  };
  const toCanvas = (img: RawImage): HTMLCanvasElement | OffscreenCanvas => {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    (c.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    return c;
  };
  return {
    async recognize(img, kind) {
      const w = await get();
      const params: Record<string, string> =
        kind === 'digits' ? { tessedit_char_whitelist: '0123456789CPcpsPS ', tessedit_pageseg_mode: '7' }
        : kind === 'ratio' ? { tessedit_char_whitelist: '0123456789/PSHpsh ', tessedit_pageseg_mode: '7' }
        : kind === 'line' ? { tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' }
        : { tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' };
      await w.setParameters(params);
      const { data } = await w.recognize(toCanvas(img));
      return { text: String(data.text ?? '').trim(), confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) };
    },
    async dispose() {
      if (workerP) { const w = await workerP; await w.terminate(); workerP = null; }
    },
  };
}
