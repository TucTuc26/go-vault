import { useMemo, useState } from 'react';
import { exportBackup, importBackup, type ImportReport } from '../app/backup';
import { reevaluateAsync } from '../app/reevaluate-run';
import { loadManifest } from '../data/loader';
import { updatePokemon } from '../db/db';
import type { RoleChange } from '../engine/reevaluate';
import { SHOWCASE_LABEL } from '../engine/verdict';
import { PROVIDER_ORDER } from '../providers';
import { Btn, Card, Field, NumInput, Select, TextInput, Toggle } from './components';
import { useApp, type AppSettings } from './state';
import type { ShowcaseReason } from '../db/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="flex flex-col gap-3"><h2 className="text-lg font-bold">{title}</h2>{children}</Card>;
}

export default function SettingsPage() {
  const { settings, updateSettings, bundle, pokemon, db, env, verdictSettings, nameOf, reloadData } = useApp();
  const v = settings.verdict;
  const setVerdict = (fn: (x: AppSettings['verdict']) => AppSettings['verdict']) => updateSettings((s) => ({ ...s, verdict: fn(s.verdict) }));
  const [msg, setMsg] = useState<string | null>(null);
  const [changes, setChanges] = useState<RoleChange[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const families = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of bundle.species) if (s.family.id && !s.shadow && !m.has(s.family.id) && !s.family.parent) m.set(s.family.id, nameOf(s.id));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [bundle, nameOf]);
  const [fam, setFam] = useState('');
  const inv = settings.inventory;
  const setInv = (patch: Partial<typeof inv>) => updateSettings((s) => ({ ...s, inventory: { ...s.inventory, ...patch } }));

  const checkUpdate = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`, { cache: 'no-store' });
      const remote = await res.json();
      const m = await loadManifest(async () => remote);
      if (m.dataVersion === bundle.manifest.dataVersion) { setMsg('Ya tienes los datos más recientes.'); return; }
      await reloadData();
      setMsg('Hay datos nuevos: se cargaron. Reevaluando tu colección…');
      const ch = await reevaluateAsync(env, pokemon, verdictSettings, nameOf);
      setChanges(ch);
      setMsg(ch.length ? `Datos actualizados. ${ch.length} Pokémon cambian de rol.` : 'Datos actualizados. Tu colección no cambia de rol.');
    } catch (e) {
      setMsg(`No pude buscar actualizaciones: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const applyChanges = async () => {
    for (const c of changes ?? []) {
      const roleKeys = c.newRoles.map((r, i) => `${r.kind}:${i}`);
      void roleKeys;
      await updatePokemon(db, c.id, { roles: c.newRoles, roleKeys: c.newRoles.map((r) => (r.kind === 'pvp' ? `pvp:${r.leagueKey}:${r.stageId}` : r.kind === 'gym' ? `gym:${r.stageId}` : r.kind === 'raid' ? `raid:${r.type}:${r.stageId}` : r.kind === 'showcase' ? `showcase:${r.reason}:${c.speciesId}` : 'manual')), dataVersion: bundle.manifest.dataVersion });
    }
    setChanges(null); setMsg('Roles actualizados.');
  };

  const doExport = async () => {
    const data = await exportBackup(db);
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `go-vault-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    updateSettings({ lastBackupAt: data.exportedAt });
    setMsg('Respaldo descargado.');
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Cuenta">
        <Field label="Nivel de cuenta" hint="Limita hasta qué nivel puedes mejorar (nivel de cuenta + 10, máx. 50)"><NumInput value={settings.playerLevel} onChange={(n) => updateSettings({ playerLevel: Math.max(1, Math.min(80, n ?? 40)) })} /></Field>
        <Field label="Equipo">
          <Select value={settings.team ?? ''} onChange={(e) => updateSettings({ team: (e.target.value || null) as AppSettings['team'] })}>
            <option value="">—</option><option value="mystic">Sabiduría (Mystic)</option><option value="valor">Valor</option><option value="instinct">Instinto</option>
          </Select>
        </Field>
      </Section>

      <Section title="Método de ingreso">
        <Field label="Proveedor activo (gratis primero)">
          <Select value={settings.provider} onChange={(e) => updateSettings({ provider: e.target.value as AppSettings['provider'] })}>
            {PROVIDER_ORDER.filter((p) => p.free || settings.apiEnabled).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Toggle label="Activar API de Claude (de pago)" checked={settings.apiEnabled} onChange={(on) => updateSettings({ apiEnabled: on, provider: !on && settings.provider === 'api' ? 'manual' : settings.provider })} />
        {settings.apiEnabled && <Field label="Código de acceso de la API"><TextInput type="password" autoComplete="off" value={settings.apiPasscode} onChange={(e) => updateSettings({ apiPasscode: e.target.value })} /></Field>}
      </Section>

      <Section title="Inventario (opcional)">
        <p className="text-sm text-[var(--muted)]">Sirve para decirte «te alcanza / te falta» en la calculadora.</p>
        <Field label="Polvo estelar"><NumInput value={inv.stardust} onChange={(n) => setInv({ stardust: n ?? undefined })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MT Élite rápidas"><NumInput value={inv.eliteFastTm} onChange={(n) => setInv({ eliteFastTm: n ?? undefined })} /></Field>
          <Field label="MT Élite cargadas"><NumInput value={inv.eliteChargedTm} onChange={(n) => setInv({ eliteChargedTm: n ?? undefined })} /></Field>
        </div>
        <Field label="Caramelos por familia">
          <Select value={fam} onChange={(e) => setFam(e.target.value)}><option value="">Elige una familia…</option>{families.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        </Field>
        {fam && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Caramelos"><NumInput value={inv.candy?.[fam]} onChange={(n) => setInv({ candy: { ...inv.candy, [fam]: n ?? 0 } })} /></Field>
            <Field label="Caramelos XL"><NumInput value={inv.xlCandy?.[fam]} onChange={(n) => setInv({ xlCandy: { ...inv.xlCandy, [fam]: n ?? 0 } })} /></Field>
          </div>
        )}
      </Section>

      <Section title="Umbrales del veredicto">
        <div className="grid grid-cols-2 gap-3">
          <Field label="PvP: top del ranking"><NumInput value={v.pvp.topN} onChange={(n) => setVerdict((x) => ({ ...x, pvp: { ...x.pvp, topN: n ?? 100 } }))} /></Field>
          <Field label="PvP: IV rank máx."><NumInput value={v.pvp.maxIvRank} onChange={(n) => setVerdict((x) => ({ ...x, pvp: { ...x.pvp, maxIvRank: n ?? 200 } }))} /></Field>
          <Field label="PvP: % mín. del mejor"><NumInput value={v.pvp.minPercentOfBest} onChange={(n) => setVerdict((x) => ({ ...x, pvp: { ...x.pvp, minPercentOfBest: n ?? 97 } }))} /></Field>
          <Field label="Máster: IV mínimo"><NumInput value={v.pvp.masterMinIv} onChange={(n) => setVerdict((x) => ({ ...x, pvp: { ...x.pvp, masterMinIv: n ?? 14 } }))} /></Field>
          <Field label="Gimnasio: top"><NumInput value={v.gym.topN} onChange={(n) => setVerdict((x) => ({ ...x, gym: { ...x.gym, topN: n ?? 40 } }))} /></Field>
          <Field label="Raid: top por tipo"><NumInput value={v.raid.topN} onChange={(n) => setVerdict((x) => ({ ...x, raid: { ...x.raid, topN: n ?? 5 } }))} /></Field>
          <Field label="Copias iguales o mejores para no guardar"><NumInput value={v.redundantCopies} onChange={(n) => setVerdict((x) => ({ ...x, redundantCopies: n ?? 3 }))} /></Field>
        </div>
        <Toggle label="Guardar defensores de gimnasio" checked={v.gym.enabled} onChange={(on) => setVerdict((x) => ({ ...x, gym: { ...x.gym, enabled: on } }))} />
        <Toggle label="Guardar atacantes de raid (estimación)" checked={v.raid.enabled} onChange={(on) => setVerdict((x) => ({ ...x, raid: { ...x.raid, enabled: on } }))} />
      </Section>

      <Section title="Exhibición (guardar por colección)">
        {(Object.keys(SHOWCASE_LABEL) as ShowcaseReason[]).map((k) => (
          <Toggle key={k} label={SHOWCASE_LABEL[k]} checked={v.showcase[k]} onChange={(on) => setVerdict((x) => ({ ...x, showcase: { ...x.showcase, [k]: on } }))} />
        ))}
      </Section>

      <Section title="Datos del juego">
        <p className="text-sm" data-testid="settings-data-date">Datos al: {new Date(bundle.manifest.builtAt).toLocaleString('es')} · versión {bundle.manifest.dataVersion.slice(0, 8)}</p>
        <ul className="text-xs text-[var(--muted)]">{bundle.manifest.sources.map((s) => <li key={s.name}>{s.name} ({s.license}) · {s.version.slice(0, 24)}</li>)}</ul>
        {bundle.manifest.warnings.map((w) => <p key={w} className="text-xs text-[var(--warn)]">⚠ {w}</p>)}
        <Btn onClick={checkUpdate} disabled={busy}>Buscar actualización</Btn>
        {changes && changes.length > 0 && (
          <div className="flex flex-col gap-2" aria-label="Cambios de rol">
            {changes.map((c) => (
              <p key={c.id} className="text-sm"><strong>{c.name}</strong>: {c.gained.map((g) => `ahora sirve → ${g}`).join('; ')}{c.gained.length && c.lost.length ? '; ' : ''}{c.lost.map((l) => `ya no: ${l}`).join('; ')}</p>
            ))}
            <Btn variant="primary" onClick={applyChanges}>Aplicar cambios (no se borra nada)</Btn>
          </div>
        )}
      </Section>

      <Section title="Respaldo">
        <p className="text-sm text-[var(--muted)]">{settings.lastBackupAt ? `Último respaldo: ${new Date(settings.lastBackupAt).toLocaleDateString('es')}` : 'Aún no has hecho un respaldo.'} Tus datos viven solo en este dispositivo.</p>
        <Btn onClick={doExport}>Exportar colección (JSON)</Btn>
        <Field label="Importar respaldo">
          <input type="file" accept="application/json,.json" className="min-h-[44px] text-base"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setReport(await importBackup(db, await f.text())); e.target.value = ''; }} />
        </Field>
        {report && <p role="status" className="text-sm">Importados {report.added} · ya existentes {report.skipped} · inválidos {report.invalid}{report.errors.length ? ` · ${report.errors[0]}` : ''}</p>}
      </Section>
      {msg && <p role="status" className="rounded-xl bg-[var(--panel)] p-3 text-sm">{msg}</p>}
    </div>
  );
}
