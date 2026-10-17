import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { forceSave, ingest, type IntakeOutcome } from '../app/intake';
import type { ReviewItem } from '../db/db';
import { spriteUrl } from '../data/names';
import { buildImportPrompt, bulkTextProvider, createApiProvider, createDriveClient, createDriveProvider, createOcrProvider, createTesseractRecognizer, formToScan, parseBulkText, parseImport, type ManualForm, type ScanResult } from '../providers';
import { createGisTokenGetter, parseFolderId } from '../providers/drive';
import { dbSeenStore } from '../db/db';
import { Badge, Btn, Card, Empty, Field, NumInput, Sheet, Sprite, TextInput } from './components';
import { FlagBadges, RoleBadges, ivText } from './PokemonCard';
import { PokemonForm } from './PokemonForm';
import { fmt } from './i18n';
import { useApp } from './state';
import type { ParsedLine } from '../providers/manual';
import type { PokemonDraft } from '../providers/pipeline';

type Method = 'manual' | 'bulk' | 'ocr' | 'drive' | 'claude' | 'api';

interface Item { key: number; label: string; outcome: IntakeOutcome; dismissed?: boolean; savedAnyway?: boolean; undone?: boolean }

/** Pasa un borrador (+ lectura original) al formulario editable. */
export function draftToForm(draft: PokemonDraft, scan?: ScanResult | null): Partial<ManualForm> {
  const ap = draft.appraisal ?? null;
  return {
    species: draft.speciesName || scan?.species.value || '',
    nickname: draft.nickname ?? '',
    cp: draft.cp, hp: draft.hp, level: draft.level, powerUpDust: draft.powerUpDust,
    ivs: draft.ivsExact ? draft.ivs : null,
    appraisal: ap ? { overall: ap.overall ?? null, bestStats: ap.bestStats, bestStatTier: ap.bestStatTier ?? null, bars: ap.bars ? { atk: ap.bars.atk ?? null, def: ap.bars.def ?? null, hp: ap.bars.hp ?? null } : undefined } : null,
    origin: draft.origin,
    flags: { ...draft.flags },
    fast: draft.moves.fast, charged: draft.moves.charged,
  };
}

export default function AddPage() {
  const app = useApp();
  const { intakeEnv, settings, deps, bundle, db } = app;
  const [method, setMethod] = useState<Method>(settings.provider === 'ocr' ? 'ocr' : settings.provider === 'drive' ? 'drive' : settings.provider === 'claude-import' ? 'claude' : settings.provider === 'api' && settings.apiEnabled ? 'api' : 'manual');
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item?: Item; review?: ReviewItem; form: Partial<ManualForm>; notes: string[] } | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);

  useEffect(() => {
    const sub = liveQuery(() => db.review.toArray()).subscribe({ next: setReview, error: () => setReview([]) });
    return () => sub.unsubscribe();
  }, [db]);

  const keyRef = useMemo(() => ({ n: 0 }), []);

  async function run(scans: ScanResult[], label: string, reviewId?: number) {
    setError(null);
    setProgress({ done: 0, total: scans.length, label });
    const added: Item[] = [];
    for (let i = 0; i < scans.length; i++) {
      try {
        const outcome = await ingest(intakeEnv, scans[i]);
        const it = { key: ++keyRef.n, label: `${label} ${i + 1}`, outcome };
        added.push(it);
        setItems((cur) => [it, ...cur]);
      } catch (e) {
        setError(`No se pudo procesar el elemento ${i + 1}: ${(e as Error).message}`);
      }
      setProgress({ done: i + 1, total: scans.length, label });
    }
    if (reviewId !== undefined) await db.review.delete(reviewId);
    setProgress(null);
    return added;
  }

  const summary = useMemo(() => {
    const s = { saved: 0, notUseful: 0, redundant: 0, duplicate: 0, review: 0, maybe: 0 };
    for (const it of items) {
      if (it.dismissed) continue;
      const o = it.outcome;
      if (o.kind === 'saved' && !it.undone) s.saved++;
      else if (o.kind === 'skipped') { if (o.verdict.skipReason === 'redundante') s.redundant++; else if (o.verdict.skipReason === 'duplicado') s.duplicate++; else s.notUseful++; }
      else if (o.kind === 'review') s.review++;
      else if (o.kind === 'maybe') s.maybe++;
    }
    return s;
  }, [items]);

  const openEdit = (it: Item) => {
    const o = it.outcome;
    setEditing({ item: it, form: draftToForm(o.entry.draft), notes: o.kind === 'review' ? o.entry.reasons : o.kind === 'maybe' && o.verdict.question ? [o.verdict.question.text] : [] });
  };

  const methods: [Method, string][] = [
    ['manual', 'Manual'], ['bulk', 'Texto masivo'], ['ocr', 'Capturas (OCR)'], ['drive', 'Carpeta de Drive'], ['claude', 'Importar de Claude'],
    ...(settings.apiEnabled ? ([['api', 'API de Claude']] as [Method, string][]) : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Método de ingreso" className="flex gap-2 overflow-x-auto pb-1">
        {methods.map(([m, label]) => (
          <button key={m} role="tab" aria-selected={method === m} onClick={() => setMethod(m)}
            className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm ${method === m ? 'bg-[var(--accent)] font-semibold text-[#0b1020]' : 'bg-[var(--panel2)]'}`}>{label}</button>
        ))}
      </div>

      {method === 'manual' && (
        <PokemonForm key={items.length} allowAnother busy={!!progress}
          onSubmit={async (f) => { await run([formToScan(f)], 'Manual'); }} />
      )}
      {method === 'bulk' && <BulkPanel onRun={(scans) => run(scans, 'Línea')} busy={!!progress} />}
      {method === 'ocr' && <ImagesPanel kind="ocr" onRun={run} onError={setError} busy={!!progress} />}
      {method === 'api' && <ImagesPanel kind="api" onRun={run} onError={setError} busy={!!progress} />}
      {method === 'drive' && <DrivePanel onRun={run} onError={setError} busy={!!progress} />}
      {method === 'claude' && <ClaudePanel onRun={(scans) => run(scans, 'Claude')} busy={!!progress} />}

      {progress && (
        <div role="status" aria-live="polite" className="rounded-xl bg-[var(--panel)] p-3">
          <p className="text-sm">Procesando {progress.label}: {progress.done} de {progress.total}</p>
          <progress className="mt-2 w-full" value={progress.done} max={progress.total} />
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-[#3b1219] p-3 text-[var(--bad)]">{error}</p>}

      {items.length > 0 && (
        <section aria-label="Resumen del lote" className="flex flex-col gap-2">
          <Card>
            <h2 className="font-bold">Resumen del lote</h2>
            <p className="text-sm text-[var(--muted)]" data-testid="batch-summary">
              Guardados {summary.saved} · No sirven {summary.notUseful} · Redundantes {summary.redundant} · Duplicados {summary.duplicate} · Por revisar {summary.review} · Dudosos {summary.maybe}
            </p>
          </Card>
          {items.filter((i) => !i.dismissed).map((it) => (
            <OutcomeCard key={it.key} it={it}
              onUndo={async () => { if (it.outcome.kind === 'saved') { await it.outcome.undo(); setItems((c) => c.map((x) => (x.key === it.key ? { ...x, undone: true } : x))); } }}
              onForce={async () => { await forceSave(intakeEnv, it.outcome.entry); setItems((c) => c.map((x) => (x.key === it.key ? { ...x, savedAnyway: true } : x))); }}
              onEdit={() => openEdit(it)}
              onDismiss={() => setItems((c) => c.map((x) => (x.key === it.key ? { ...x, dismissed: true } : x)))} />
          ))}
        </section>
      )}

      <section aria-label="Por revisar" className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Por revisar ({review.length})</h2>
        {review.length === 0 ? <Empty>No hay lecturas pendientes. Aquí aparecen las que el lector no pudo confirmar (solo texto, nunca la imagen).</Empty> : review.map((r) => {
          const d = r.draft as PokemonDraft;
          return (
            <Card key={r.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <strong className="block truncate">{d.speciesName || 'Especie sin reconocer'}{d.cp ? ` · PC ${d.cp}` : ''}</strong>
                <span className="block text-sm text-[var(--warn)]">{r.reasons.join(' · ')}</span>
              </span>
              <span className="flex gap-2">
                <Btn onClick={() => setEditing({ review: r, form: draftToForm(d, r.scan as ScanResult), notes: r.reasons })}>Revisar</Btn>
                <Btn variant="danger" aria-label="Descartar" onClick={() => db.review.delete(r.id!)}>✕</Btn>
              </span>
            </Card>
          );
        })}
      </section>

      {editing && (
        <Sheet title="Revisar y corregir" onClose={() => setEditing(null)}>
          <PokemonForm initial={editing.form} notes={editing.notes} submitLabel="Evaluar y guardar" busy={!!progress}
            onCancel={() => setEditing(null)}
            onSubmit={async (f) => {
              const ed = editing;
              setEditing(null);
              if (ed.item) setItems((c) => c.map((x) => (x.key === ed.item!.key ? { ...x, dismissed: true } : x)));
              await run([formToScan(f)], 'Corregido', ed.review?.id);
            }} />
        </Sheet>
      )}
    </div>
  );
}

function OutcomeCard({ it, onUndo, onForce, onEdit, onDismiss }: { it: Item; onUndo: () => void; onForce: () => void; onEdit: () => void; onDismiss: () => void }) {
  const { species } = useApp();
  const o = it.outcome;
  const d = o.entry.draft;
  const sp = species(d.speciesId);
  const sprite = sp ? spriteUrl(sp.dex) : spriteUrl(0);
  let status: React.ReactNode;
  if (o.kind === 'saved') status = it.undone ? <Badge tone="muted">Deshecho</Badge> : <Badge tone="ok">Guardado ✓</Badge>;
  else if (o.kind === 'skipped') status = it.savedAnyway ? <Badge tone="ok">Guardado ✓ (manual)</Badge> : <Badge tone="bad">{o.verdict.skipReason === 'redundante' ? 'Redundante' : o.verdict.skipReason === 'duplicado' ? 'Duplicado' : 'No sirve'}</Badge>;
  else if (o.kind === 'maybe') status = <Badge tone="warn">Podría servir</Badge>;
  else status = <Badge tone="warn">Por revisar</Badge>;
  const roles = o.kind === 'saved' || o.kind === 'maybe' ? o.verdict.roles : [];
  const reason = o.kind === 'review' ? o.entry.reasons.join(' · ') : o.verdict.reasons[0];
  const ivs = d.ivs ?? null;
  return (
    <Card className="flex items-start gap-3" data-testid="outcome">
      <Sprite src={sprite} alt="" size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{d.speciesName || 'Sin especie'}</strong><span className="text-sm text-[var(--muted)]">PC {fmt(d.cp)}</span>{status}
        </div>
        <span className="text-sm text-[var(--muted)]">{ivText({ ivs, ivPercent: ivs ? ((ivs.atk + ivs.def + ivs.hp) / 45) * 100 : null, ivPercentRange: d.ivPercentRange })}</span>
        <span className="flex flex-wrap gap-1"><FlagBadges flags={d.flags} /></span>
        {roles.length > 0 && <RoleBadges roles={roles} />}
        {reason && <p className="text-sm">{reason}</p>}
        {o.kind === 'maybe' && o.verdict.question && <p className="text-sm text-[var(--warn)]">Para decidir: {o.verdict.question.text}</p>}
        <div className="mt-1 flex flex-wrap gap-2">
          {o.kind === 'saved' && !it.undone && <Btn onClick={onUndo}>Deshacer</Btn>}
          {o.kind === 'skipped' && !it.savedAnyway && <Btn onClick={onForce}>Guardar de todos modos</Btn>}
          {(o.kind === 'maybe' || o.kind === 'review') && <Btn variant="primary" onClick={onEdit}>{o.kind === 'maybe' ? 'Completar datos' : 'Revisar'}</Btn>}
          {o.kind === 'maybe' && <Btn onClick={onForce}>Guardar de todos modos</Btn>}
          <Btn onClick={onDismiss} aria-label="Ocultar">Ocultar</Btn>
        </div>
      </div>
    </Card>
  );
}

function BulkPanel({ onRun, busy }: { onRun: (s: ScanResult[]) => Promise<unknown>; busy: boolean }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedLine[] | null>(null);
  const preview = () => setRows(parseBulkText(text));
  const patch = (i: number, fn: (l: ParsedLine) => ParsedLine) => setRows((r) => r && r.map((x, j) => (j === i ? fn(x) : x)));
  const usable = rows?.filter((r) => r.usable) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Field label="Una línea por Pokémon" hint="Ej.: Medicham 1496 15/15/14 nivel 24 · Raichu de Alola sombra PC 2100 PS 140 · ataques: Spark, Wild Charge">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full rounded-xl border border-[#3a4468] bg-[var(--panel)] p-3 text-base" placeholder={'Medicham 1496 15/15/14 nivel 24\nAltaria 1400 14/15/15'} />
      </Field>
      <Btn variant="primary" onClick={preview} disabled={!text.trim()}>Vista previa</Btn>
      {rows && (
        <div className="flex flex-col gap-2" aria-label="Vista previa editable">
          {rows.length === 0 && <Empty>No encontré líneas.</Empty>}
          {rows.map((r, i) => (
            <Card key={i} className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Especie"><TextInput value={r.scan.species.value ?? ''} onChange={(e) => patch(i, (l) => ({ ...l, usable: !!e.target.value && (l.scan.cp.value !== null || l.scan.ivs !== null), scan: { ...l.scan, species: { value: e.target.value || null, confidence: 1 } } }))} /></Field>
                <Field label="CP"><NumInput value={r.scan.cp.value} onChange={(v) => patch(i, (l) => ({ ...l, usable: !!l.scan.species.value && v !== null, scan: { ...l.scan, cp: { value: v, confidence: v === null ? 0 : 1 } } }))} /></Field>
                <Field label="PS"><NumInput value={r.scan.hp.value} onChange={(v) => patch(i, (l) => ({ ...l, scan: { ...l.scan, hp: { value: v, confidence: v === null ? 0 : 1 } } }))} /></Field>
              </div>
              <p className="text-xs text-[var(--muted)]">Línea {r.lineNo}: {r.raw}{r.scan.ivs ? ` · IVs ${r.scan.ivs.atk}/${r.scan.ivs.def}/${r.scan.ivs.hp}` : ''}{r.scan.level.value ? ` · nivel ${r.scan.level.value}` : ''}</p>
              {r.warnings.map((w) => <p key={w} className="text-xs text-[var(--warn)]">⚠ {w}</p>)}
              {!r.usable && <Badge tone="bad">No se procesará</Badge>}
            </Card>
          ))}
          <Btn variant="primary" disabled={!usable.length || busy} onClick={() => { void onRun(usable.map((r) => r.scan)); setRows(null); setText(''); }}>Procesar {usable.length} Pokémon</Btn>
        </div>
      )}
    </div>
  );
}

function ImagesPanel({ kind, onRun, onError, busy }: { kind: 'ocr' | 'api'; onRun: (s: ScanResult[], label: string) => Promise<unknown>; onError: (m: string | null) => void; busy: boolean }) {
  const { deps, settings } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const go = async () => {
    onError(null);
    try {
      const images = files.map((f, i) => ({ id: `captura-${i + 1}`, blob: f as Blob }));
      let scans: ScanResult[];
      if (kind === 'ocr') {
        const recognizer = createTesseractRecognizer();
        try { scans = await createOcrProvider({ recognizer, deps, playerLevel: settings.playerLevel }).scan({ kind: 'images', images }); } finally { await recognizer.dispose?.(); }
      } else {
        scans = await createApiProvider({ passcode: settings.apiPasscode }).scan({ kind: 'images', images });
      }
      setFiles([]);
      await onRun(scans, kind === 'ocr' ? 'Captura' : 'API');
    } catch (e) {
      onError(`No se pudieron leer las capturas: ${(e as Error).message}`);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">
        {kind === 'ocr'
          ? 'El texto se lee en tu dispositivo (gratis). La imagen se procesa en memoria y se descarta: nunca se guarda. Sube la pantalla del Pokémon y, si quieres, la de su valoración.'
          : 'Las imágenes se reducen, se envían a tu función /api/scan (de pago) y se descartan. Requiere código de acceso en Ajustes.'}
      </p>
      <Field label="Capturas de pantalla">
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} className="min-h-[44px] text-base" />
      </Field>
      {files.length > 0 && <p className="text-sm">{files.length} imagen(es) lista(s)</p>}
      <Btn variant="primary" disabled={!files.length || busy} onClick={go}>Leer capturas</Btn>
    </div>
  );
}

function DrivePanel({ onRun, onError, busy }: { onRun: (s: ScanResult[], label: string) => Promise<unknown>; onError: (m: string | null) => void; busy: boolean }) {
  const { deps, settings, updateSettings, db } = useApp();
  const clientId = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID;
  const go = async () => {
    onError(null);
    const id = parseFolderId(settings.driveFolderId);
    if (!id) return onError('Pega el ID o la URL de tu carpeta de Drive.');
    try {
      const recognizer = createTesseractRecognizer();
      const inner = settings.provider === 'api' && settings.apiEnabled ? createApiProvider({ passcode: settings.apiPasscode }) : createOcrProvider({ recognizer, deps, playerLevel: settings.playerLevel });
      const provider = createDriveProvider({ folderId: id, client: createDriveClient({ getToken: createGisTokenGetter(clientId!) }), seen: dbSeenStore(db), inner });
      try {
        const scans = await provider.scan({ kind: 'images', images: [] });
        if (!scans.length) onError('No hay imágenes nuevas en la carpeta.');
        else await onRun(scans, 'Drive');
      } finally { await recognizer.dispose?.(); }
    } catch (e) {
      onError(`Drive: ${(e as Error).message}`);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">Solo lectura: la app lista las imágenes nuevas de tu carpeta, las lee en memoria y recuerda sus IDs. No modifica, mueve ni borra nada en Drive.</p>
      {!clientId && <p role="note" className="rounded-xl bg-[var(--panel)] p-3 text-sm text-[var(--warn)]">Falta configurar <code>VITE_GOOGLE_CLIENT_ID</code> (cliente OAuth gratis). Mira el README, sección «Google Drive».</p>}
      <Field label="ID o URL de la carpeta"><TextInput value={settings.driveFolderId} onChange={(e) => updateSettings({ driveFolderId: e.target.value })} placeholder="https://drive.google.com/drive/folders/…" /></Field>
      <Btn variant="primary" disabled={!clientId || busy || !settings.driveFolderId} onClick={go}>Conectar y leer imágenes nuevas</Btn>
    </div>
  );
}

function ClaudePanel({ onRun, busy }: { onRun: (s: ScanResult[]) => Promise<unknown>; busy: boolean }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(buildImportPrompt()); setMsg({ ok: true, text: 'Prompt copiado. Pégalo en un chat de Claude junto con tus capturas.' }); }
    catch { setMsg({ ok: false, text: 'No pude copiar automáticamente: selecciona el texto de abajo y cópialo.' }); }
  };
  const doImport = async () => {
    const out = parseImport(text);
    if (out.errors.length) setMsg({ ok: !!out.results.length, text: out.errors.join(' | ') });
    else setMsg(null);
    if (out.results.length) { await onRun(out.results); setText(''); }
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="list-decimal pl-5 text-sm text-[var(--muted)]">
        <li>Pulsa «Copiar prompt» y pégalo en un chat de Claude (app o web).</li>
        <li>Adjunta tus capturas en ese mensaje y envíalo.</li>
        <li>Copia el JSON que responde y pégalo aquí abajo.</li>
      </ol>
      <Btn onClick={copy}>Copiar prompt</Btn>
      <Field label="JSON de Claude"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="w-full rounded-xl border border-[#3a4468] bg-[var(--panel)] p-3 font-mono text-sm" placeholder='{"pokemon":[{"species":"Medicham","cp":1496, …}]}' /></Field>
      <Btn variant="primary" disabled={!text.trim() || busy} onClick={doImport}>Importar</Btn>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}>{msg.text}</p>}
    </div>
  );
}
