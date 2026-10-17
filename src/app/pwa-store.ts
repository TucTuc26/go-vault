import { useSyncExternalStore } from 'react';

/** Estado del service worker (sin importar el módulo virtual de vite-plugin-pwa: así se puede probar sin navegador). */
export interface PwaState { needRefresh: boolean; offlineReady: boolean }

let state: PwaState = { needRefresh: false, offlineReady: false };
let updater: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export const getPwaState = (): PwaState => state;
export const subscribePwa = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function setPwaState(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const setPwaUpdater = (fn: typeof updater) => { updater = fn; };
export const applyPwaUpdate = async (): Promise<void> => { await updater?.(true); };
export const usePwaState = (): PwaState => useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
