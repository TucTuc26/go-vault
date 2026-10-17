import { registerSW } from 'virtual:pwa-register';
import { setPwaState, setPwaUpdater } from './pwa-store';

/** Registra el service worker (solo en producción): app y datos disponibles sin conexión. */
export function initPwa(): void {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() { setPwaState({ needRefresh: true }); },
    onOfflineReady() { setPwaState({ offlineReady: true }); },
  });
  setPwaUpdater(update);
}
