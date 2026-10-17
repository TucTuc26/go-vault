import { useId, useMemo, useState } from 'react';
import type { ManualForm } from '../providers/schema';
import { Btn, Chip, Field, NumInput, Select, TextInput } from './components';
import { useApp } from './state';
import { BAR_LABEL, FLAG_LABEL, ORIGIN_LABEL, OVERALL_LABEL, TIER_LABEL } from './i18n';

const FLAG_KEYS = ['shadow', 'purified', 'lucky', 'shiny', 'bestBuddy', 'xxl', 'xxs', 'costume', 'background'] as const;
const STAT_LABEL = { atk: 'Ataque', def: 'Defensa', hp: 'PS' } as const;

export interface PokemonFormProps {
  initial?: Partial<ManualForm>;
  submitLabel?: string;
  /** Muestra "Guardar y agregar otro". */
  allowAnother?: boolean;
  onSubmit: (f: ManualForm, another: boolean) => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  /** Avisos (p. ej. motivos de "Por revisar"). */
  notes?: string[];
}

export function PokemonForm({ initial, submitLabel = 'Guardar', allowAnother = false, onSubmit, onCancel, busy, notes }: PokemonFormProps) {
  const { deps, bundle } = useApp();
  const listId = useId();
  const [f, setF] = useState<ManualForm>(() => ({ species: '', flags: {}, charged: [], ...initial }));
  const set = <K extends keyof ManualForm>(k: K, v: ManualForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setFlag = (k: (typeof FLAG_KEYS)[number], v: boolean) => setF((x) => ({ ...x, flags: { ...x.flags, [k]: v } }));
  const setIv = (k: 'atk' | 'def' | 'hp', v: number | null) =>
    setF((x) => {
      const cur = x.ivs ?? { atk: NaN, def: NaN, hp: NaN };
      const next = { ...cur, [k]: v ?? NaN };
      return { ...x, ivs: Object.values(next).every((n) => Number.isNaN(n)) ? null : (next as ManualForm['ivs']) };
    });

  const suggestions = useMemo(() => (f.species.trim().length >= 2 ? deps.speciesIndex.search(f.species, 8) : []), [f.species, deps.speciesIndex]);
  const resolved = useMemo(() => (f.species.trim() ? deps.speciesIndex.best(f.species) : null), [f.species, deps.speciesIndex]);
  const sp = resolved ? bundle.speciesById.get(resolved.speciesId) : undefined;
  const moveName = (id: string) => bundle.names.moves[id] ?? bundle.movesById.get(id)?.name ?? id;
  const moveLabel = (id: string) => moveName(id) + (sp?.elite.includes(id) ? ' (élite)' : '');

  const ivComplete = f.ivs && ![f.ivs.atk, f.ivs.def, f.ivs.hp].some((n) => Number.isNaN(n));
  const ivPartial = !!f.ivs && !ivComplete;
  const ivRange = ivComplete && [f.ivs!.atk, f.ivs!.def, f.ivs!.hp].some((n) => n < 0 || n > 15);
  const canSubmit = f.species.trim().length >= 2 && !ivPartial && !ivRange && (f.cp || ivComplete);

  const submit = (another: boolean) => {
    const clean: ManualForm = { ...f, ivs: ivComplete ? f.ivs : null };
    void onSubmit(clean, another);
    if (another) setF({ species: '', flags: {}, charged: [], origin: f.origin });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(false); }} aria-label="Datos del Pokémon">
      {notes && notes.length > 0 && (
        <ul className="rounded-xl bg-[var(--panel)] p-3 text-sm text-[var(--warn)]">{notes.map((n) => <li key={n}>⚠ {n}</li>)}</ul>
      )}
      <Field label="Especie (español o inglés)" hint={sp ? `Reconocido: ${resolved!.label}` : f.species.length > 2 ? 'Elige una sugerencia de la lista' : undefined}>
        <TextInput value={f.species} list={listId} autoComplete="off" autoCapitalize="words" placeholder="Medicham, Raichu de Alola…" onChange={(e) => set('species', e.target.value)} />
        <datalist id={listId}>{suggestions.map((s) => <option key={s.speciesId} value={s.label} />)}</datalist>
      </Field>
      <Field label="Apodo (opcional)"><TextInput value={f.nickname ?? ''} onChange={(e) => set('nickname', e.target.value)} /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="PC / CP"><NumInput value={f.cp} onChange={(v) => set('cp', v)} /></Field>
        <Field label="PS / HP"><NumInput value={f.hp} onChange={(v) => set('hp', v)} /></Field>
        <Field label="Nivel (si lo sabes)"><NumInput value={f.level} onChange={(v) => set('level', v)} /></Field>
        <Field label="Polvo de la siguiente mejora" hint="Acota el nivel"><NumInput value={f.powerUpDust} onChange={(v) => set('powerUpDust', v)} /></Field>
      </div>

      <fieldset className="rounded-xl border border-[#3a4468] p-3">
        <legend className="px-1 text-sm text-[var(--muted)]">IVs exactos (si los das, no se infiere)</legend>
        <div className="grid grid-cols-3 gap-3">
          {(['atk', 'def', 'hp'] as const).map((k) => (
            <Field key={k} label={STAT_LABEL[k]}>
              <NumInput value={f.ivs && !Number.isNaN(f.ivs[k]) ? f.ivs[k] : null} onChange={(v) => setIv(k, v)} aria-label={`IV de ${STAT_LABEL[k]}`} />
            </Field>
          ))}
        </div>
        {ivPartial && <p role="alert" className="mt-2 text-sm text-[var(--warn)]">Completa los tres IVs o déjalos vacíos.</p>}
        {ivRange && <p role="alert" className="mt-2 text-sm text-[var(--bad)]">Los IVs van de 0 a 15.</p>}
      </fieldset>

      <details className="rounded-xl border border-[#3a4468] p-3">
        <summary className="min-h-[44px] cursor-pointer py-2">Datos de la valoración (opcional)</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Field label="Frase general (suma de IVs)">
            <Select value={f.appraisal?.overall ?? ''} onChange={(e) => set('appraisal', { ...f.appraisal, overall: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{OVERALL_LABEL[n]}</option>)}
            </Select>
          </Field>
          <div>
            <p className="mb-1 text-sm text-[var(--muted)]">Stat(s) destacado(s)</p>
            <div className="flex flex-wrap gap-2">
              {(['atk', 'def', 'hp'] as const).map((k) => {
                const on = !!f.appraisal?.bestStats?.includes(k);
                return <Chip key={k} on={on} onClick={() => { const cur = f.appraisal?.bestStats ?? []; set('appraisal', { ...f.appraisal, bestStats: on ? cur.filter((x) => x !== k) : [...cur, k] }); }}>{STAT_LABEL[k]}</Chip>;
              })}
            </div>
          </div>
          <Field label="Cómo califica a su mejor stat">
            <Select value={f.appraisal?.bestStatTier ?? ''} onChange={(e) => set('appraisal', { ...f.appraisal, bestStatTier: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{TIER_LABEL[n]}</option>)}
            </Select>
          </Field>
          {(['atk', 'def', 'hp'] as const).map((k) => (
            <Field key={k} label={`Barra de ${STAT_LABEL[k]}`}>
              <Select value={f.appraisal?.bars?.[k] ?? ''} onChange={(e) => set('appraisal', { ...f.appraisal, bars: { ...f.appraisal?.bars, [k]: e.target.value === '' ? null : Number(e.target.value) } })}>
                <option value="">—</option>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{BAR_LABEL[n]}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </details>

      <Field label="Origen (define el piso de IV)">
        <Select value={f.origin ?? 'unknown'} onChange={(e) => set('origin', e.target.value as ManualForm['origin'])}>
          {Object.entries(ORIGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>

      <div>
        <p className="mb-1 text-sm text-[var(--muted)]">Etiquetas</p>
        <div className="flex flex-wrap gap-2">
          {FLAG_KEYS.map((k) => <Chip key={k} on={!!f.flags?.[k]} onClick={() => setFlag(k, !f.flags?.[k])}>{FLAG_LABEL[k]}</Chip>)}
        </div>
      </div>

      <details className="rounded-xl border border-[#3a4468] p-3">
        <summary className="min-h-[44px] cursor-pointer py-2">Ataques actuales (opcional)</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Field label="Ataque rápido">
            <Select value={f.fast ?? ''} onChange={(e) => set('fast', e.target.value || null)} disabled={!sp}>
              <option value="">—</option>{sp?.fast.map((m) => <option key={m} value={m}>{moveLabel(m)}</option>)}
            </Select>
          </Field>
          {[0, 1].map((i) => (
            <Field key={i} label={`Ataque cargado ${i + 1}`}>
              <Select value={f.charged?.[i] ?? ''} disabled={!sp}
                onChange={(e) => { const c = [...(f.charged ?? [])]; if (e.target.value) c[i] = e.target.value; else c.splice(i, 1); set('charged', c.filter(Boolean)); }}>
                <option value="">—</option>{sp?.charged.map((m) => <option key={m} value={m}>{moveLabel(m)}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" type="submit" disabled={!canSubmit || busy}>{busy ? 'Procesando…' : submitLabel}</Btn>
        {allowAnother && <Btn type="button" disabled={!canSubmit || busy} onClick={() => submit(true)}>Guardar y agregar otro</Btn>}
        {onCancel && <Btn type="button" onClick={onCancel}>Cancelar</Btn>}
      </div>
      {!canSubmit && <p className="text-xs text-[var(--muted)]">Necesito la especie y el CP (o los IVs exactos).</p>}
    </form>
  );
}
