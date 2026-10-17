export * from './schema';
export * from './manual';
export * from './pipeline';
export * from './species-match';
export * from './claude-import';
export * from './drive';
export * from './api-client';
export * from './image';
export { createOcrProvider } from './ocr/provider';
export { createTesseractRecognizer, type TextRecognizer } from './ocr/recognizer';

export type ProviderId = 'manual' | 'ocr' | 'drive' | 'claude-import' | 'api';

/** Orden y valores por defecto: gratis primero. La API de pago empieza APAGADA. */
export const PROVIDER_ORDER: { id: ProviderId; label: string; free: boolean; defaultEnabled: boolean }[] = [
  { id: 'manual', label: 'Manual', free: true, defaultEnabled: true },
  { id: 'ocr', label: 'Capturas con OCR (local)', free: true, defaultEnabled: true },
  { id: 'drive', label: 'Carpeta de Google Drive', free: true, defaultEnabled: true },
  { id: 'claude-import', label: 'Importar de un chat de Claude', free: true, defaultEnabled: true },
  { id: 'api', label: 'API de Claude (opcional, de pago)', free: false, defaultEnabled: false },
];
