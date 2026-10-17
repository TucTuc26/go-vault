import { useEffect, useState } from 'react';
import { loadManifest } from '../data/loader';
import type { Manifest } from '../data/schemas';

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setError(String(e.message ?? e)));
  }, []);
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-3 p-4">
      <h1 className="text-2xl font-bold">GO Vault</h1>
      {error && <p role="alert" className="text-[var(--bad)]">Error cargando datos: {error}</p>}
      {!manifest && !error && <p className="text-[var(--muted)]">Cargando datos…</p>}
      {manifest && (
        <p data-testid="data-date" className="text-sm text-[var(--muted)]">
          Datos al: {new Date(manifest.builtAt).toLocaleString('es')}
        </p>
      )}
      {manifest?.warnings.map((w) => (
        <p key={w} className="rounded bg-[var(--panel)] p-2 text-sm text-[var(--warn)]">⚠ {w}</p>
      ))}
    </main>
  );
}
