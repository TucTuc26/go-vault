import { useEffect, useState } from 'react';
import { backupAgeDays, downloadBackup } from '../app/backup';
import { applyPwaUpdate, usePwaState } from '../app/pwa-store';
import { Btn } from './components';
import { useApp } from './state';

/** Máximo de días sin respaldo antes de recordarlo (CLAUDE.md fase 8). */
export const BACKUP_REMINDER_DAYS = 14;

const isIOS = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isStandalone = () => typeof window !== 'undefined' && (((navigator as unknown as { standalone?: boolean }).standalone === true) || window.matchMedia?.('(display-mode: standalone)').matches);
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

function Notice({ tone = 'info', children, actions }: { tone?: 'info' | 'warn'; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div role="status" className={`flex flex-col gap-2 rounded-2xl p-3 text-sm ${tone === 'warn' ? 'bg-[#3b2a0a]' : 'bg-[#16264d]'}`}>
      <div>{children}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Avisos: versión nueva de la app/datos, reevaluación, instalación en iPhone, almacenamiento persistente y respaldo. */
export function Banners() {
  const app = useApp();
  const pwa = usePwaState();
  const { update, applyUpdate, pendingChanges, reevaluating, applyChanges, dismissChanges, db, pokemon, updateSettings } = app;
  const [showChanges, setShowChanges] = useState(false);
  const [backupDays, setBackupDays] = useState<number | null>(null);
  const [backupHidden, setBackupHidden] = useState(false);
  const [installHidden, setInstallHidden] = useState(() => safe(() => localStorage.getItem('govault.installTipHidden') === '1', false));
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [offlineHidden, setOfflineHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  // almacenamiento persistente: iOS puede borrar los datos de sitios sin uso
  useEffect(() => {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) { setPersisted(null); return; }
    s.persist().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  useEffect(() => {
    let alive = true;
    backupAgeDays(db).then((d) => { if (alive) setBackupDays(d); }).catch(() => {});
    return () => { alive = false; };
  }, [db, pokemon.length]);

  const needInstall = isIOS() && !isStandalone() && !installHidden;
  const backupDue = !backupHidden && pokemon.length > 0 && backupDays !== null && backupDays >= BACKUP_REMINDER_DAYS;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-2 px-4 pb-1" aria-label="Avisos">
      {pwa.needRefresh && (
        <Notice actions={<Btn variant="primary" onClick={() => void applyPwaUpdate()}>Actualizar la app</Btn>}>Hay una versión nueva de GO Vault.</Notice>
      )}
      {pwa.offlineReady && !offlineHidden && (
        <Notice actions={<Btn onClick={() => setOfflineHidden(true)}>Entendido</Btn>}>La app ya funciona sin conexión.</Notice>
      )}
      {update && (
        <Notice actions={<Btn variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await applyUpdate(); } finally { setBusy(false); } }}>Actualizar datos</Btn>}>
          Hay datos nuevos del juego ({new Date(update.builtAt).toLocaleDateString('es')}). Al actualizar se reevalúa tu colección; no se borra nada.
        </Notice>
      )}
      {reevaluating && <Notice>Reevaluando tu colección con los datos nuevos…</Notice>}
      {pendingChanges && pendingChanges.length > 0 && (
        <Notice tone="warn" actions={
          <>
            <Btn variant="primary" onClick={() => void applyChanges()}>Aplicar cambios</Btn>
            <Btn onClick={() => setShowChanges(!showChanges)}>{showChanges ? 'Ocultar' : 'Ver cambios'}</Btn>
            <Btn onClick={dismissChanges}>Ahora no</Btn>
          </>
        }>
          Con los datos nuevos, {pendingChanges.length} Pokémon cambian de rol (no se borra nada).
          {showChanges && (
            <ul className="mt-2 flex flex-col gap-1">
              {pendingChanges.map((c) => (
                <li key={c.id}><strong>{c.name}</strong>: {[...c.gained.map((g) => `ahora sirve → ${g}`), ...c.lost.map((l) => `ya no: ${l}`)].join('; ')}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {needInstall && (
        <Notice actions={<Btn onClick={() => { safe(() => localStorage.setItem('govault.installTipHidden', '1'), undefined); setInstallHidden(true); }}>Entendido</Btn>}>
          <strong>Instálala en tu iPhone:</strong> en Safari toca el botón Compartir y luego «Añadir a pantalla de inicio». Así iOS conserva tus datos: si no usas la app durante semanas, Safari puede borrar los datos de los sitios web.
        </Notice>
      )}
      {persisted === false && isIOS() && isStandalone() && (
        <Notice tone="warn">Tu dispositivo no garantizó el almacenamiento permanente. Haz respaldos con frecuencia (Ajustes → Respaldo).</Notice>
      )}
      {backupDue && (
        <Notice tone="warn" actions={
          <>
            <Btn variant="primary" onClick={async () => { const at = await downloadBackup(db); updateSettings({ lastBackupAt: at }); setBackupDays(0); }}>Respaldar ahora</Btn>
            <Btn onClick={() => setBackupHidden(true)}>Más tarde</Btn>
          </>
        }>
          Hace {backupDays} días que no haces un respaldo. Tus datos solo viven en este dispositivo.
        </Notice>
      )}
    </div>
  );
}
