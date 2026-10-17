import type { ScanInput, ScanProvider, ScanResult } from './schema';

/**
 * Carpeta de Google Drive (gratis): SOLO LECTURA.
 * - Alcance mínimo: drive.readonly (lista y descarga; no puede modificar, mover ni borrar nada).
 * - Las imágenes se descargan en memoria, se procesan con el proveedor activo y se descartan.
 * - Solo se recuerdan localmente los IDs ya procesados (texto).
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';

export interface DriveFile { id: string; name: string; mimeType: string; createdTime: string }

export interface SeenStore {
  has(id: string): Promise<boolean> | boolean;
  add(ids: string[]): Promise<void> | void;
}

export function memorySeenStore(initial: string[] = []): SeenStore & { ids: Set<string> } {
  const ids = new Set(initial);
  return { ids, has: (id) => ids.has(id), add: (xs) => xs.forEach((x) => ids.add(x)) };
}

/** Acepta el ID o una URL de carpeta ("…/folders/<id>?…"). */
export function parseFolderId(input: string): string | null {
  const t = input.trim();
  const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? t.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

export interface DriveClientOptions {
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
}

/** Cliente de solo lectura: únicamente peticiones GET. */
export function createDriveClient(opts: DriveClientOptions) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const get = async (url: string): Promise<Response> => {
    const token = await opts.getToken();
    const res = await doFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Carpeta no encontrada o sin acceso' : res.status === 401 || res.status === 403 ? 'Google rechazó el acceso (revisa permisos)' : `Drive respondió ${res.status}`);
    return res;
  };
  return {
    async listImages(folderId: string): Promise<DriveFile[]> {
      const id = parseFolderId(folderId);
      if (!id) throw new Error('ID de carpeta inválido');
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const q = encodeURIComponent(`'${id}' in parents and trashed=false and mimeType contains 'image/'`);
        const url = `${API}/files?q=${q}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,createdTime)')}&orderBy=createdTime&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const body = (await (await get(url)).json()) as { files?: DriveFile[]; nextPageToken?: string };
        out.push(...(body.files ?? []));
        pageToken = body.nextPageToken;
      } while (pageToken);
      return out;
    },
    /** Descarga el contenido en memoria (Blob). */
    async download(fileId: string): Promise<Blob> {
      return (await get(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).blob();
    },
  };
}

export interface DriveProviderOptions {
  folderId: string;
  client: ReturnType<typeof createDriveClient>;
  seen: SeenStore;
  /** Proveedor activo que procesa imágenes (OCR local o API). */
  inner: ScanProvider;
  onProgress?: (done: number, total: number) => void;
}

export function createDriveProvider(opts: DriveProviderOptions): ScanProvider & { listNew(): Promise<DriveFile[]> } {
  async function listNew(): Promise<DriveFile[]> {
    const all = await opts.client.listImages(opts.folderId);
    const fresh: DriveFile[] = [];
    for (const f of all) if (!(await opts.seen.has(f.id))) fresh.push(f);
    return fresh;
  }
  return {
    id: 'drive',
    label: 'Carpeta de Google Drive',
    listNew,
    async scan(_input?: ScanInput): Promise<ScanResult[]> {
      const fresh = await listNew();
      if (!fresh.length) return [];
      const images: { id: string; blob: Blob }[] = [];
      for (const f of fresh) {
        images.push({ id: f.id, blob: await opts.client.download(f.id) });
        opts.onProgress?.(images.length, fresh.length);
      }
      const results = await opts.inner.scan({ kind: 'images', images });
      // recordar solo los IDs, después de procesarlos
      await opts.seen.add(fresh.map((f) => f.id));
      return results;
    },
  };
}

// ---- Google Identity Services (navegador) ----
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient(cfg: unknown): { requestAccessToken(o?: unknown): void } } } };
  }
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gisPromise ??= new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('No se pudo cargar Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Token de acceso de corta duración (solo lectura) mediante Google Identity Services. */
export function createGisTokenGetter(clientId: string): () => Promise<string> {
  let cached: { token: string; exp: number } | null = null;
  return async () => {
    if (cached && cached.exp > Date.now() + 30_000) return cached.token;
    await loadGis();
    return new Promise<string>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (r: { access_token?: string; expires_in?: number; error?: string }) => {
          if (r.error || !r.access_token) return reject(new Error(r.error ?? 'Acceso denegado'));
          cached = { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3000) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e: { type?: string }) => reject(new Error(e.type ?? 'Acceso cancelado')),
      });
      client.requestAccessToken({ prompt: cached ? '' : 'consent' });
    });
  };
}
