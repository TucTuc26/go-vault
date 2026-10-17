import { useMemo, useState } from 'react';
import { editRecord } from '../app/intake';
import { deletePokemon, updatePokemon } from '../db/db';
import type { SavedPokemon } from '../db/types';
import { affordability, describeRole, evaluateForLeague, ivPercent, planUpgrade, recommendMoveset, sortedRanking, type MovesetOption, type Needs } from '../engine';
import { ivSetsOfRecord } from '../engine/reevaluate';
import { formToScan, type ManualForm } from '../providers';
import { Badge, Btn, Card, Field, Select, Sheet, Sprite } from './components';
import { FlagBadges, RoleBadges, ivText } from './PokemonCard';
import { PokemonForm } from './PokemonForm';
import { MOVE_STATUS_LABEL, ORIGIN_LABEL, fmt, leagueTitleEs } from './i18n';
import { useApp } from './state';

function MoveRow({ n }: { n: MovesetOption['needs'][number] }) {
  const { bundle } = useApp();
  const name = bundle.names.moves[n.moveId] ?? bundle.movesById.get(n.moveId)?.name ?? n.moveId;
  const tone = n.status === 'have' ? 'ok' : n.status === 'elite_tm' ? 'bad' : n.status === 'second_move' ? 'warn' : 'info';
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span>{n.kind === 'fast' ? '⚡' : '💥'} {name}{n.elite && ' ★'}</span>
      <Badge tone={tone}>{MOVE_STATUS_LABEL[n.status]}</Badge>
    </li>
  );
}

const NEED_LABEL: Record<keyof Needs, string> = { stardust: 'Polvo estelar', candy: 'Caramelos', xlCandy: 'Caramelos XL', eliteFastTm: 'MT Élite rápida', eliteChargedTm: 'MT Élite cargada' };

export function DetailSheet({ p, onClose }: { p: SavedPokemon; onClose: () => void }) {
  const app = useApp();
  const { env, bundle, settings, nameOf, intakeEnv, db } = app;
  const sp = env.speciesById.get(p.speciesId);
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState<string[] | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const firstPvp = p.roles.find((r) => r.kind === 'pvp');
  const [leagueKey, setLeagueKey] = useState<string>(firstPvp && firstPvp.kind === 'pvp' ? firstPvp.leagueKey : 'all-1500');
  const [option, setOption] = useState<'a' | 'b'>('b');
  const [stageSel, setStageSel] = useState<string | null>(null);

  const league = env.leagues.find((l) => l.key === leagueKey) ?? env.leagues[0];
  // IVs para calcular: exactos, o el candidato mediano si son inciertos
  const calcIv = useMemo(() => {
    if (p.ivs) return p.ivs;
    const sets = ivSetsOfRecord(p).sort((a, b) => ivPercent(a) - ivPercent(b));
    return sets.length ? sets[Math.floor(sets.length / 2)] : null;
  }, [p]);
  const uncertain = !p.ivs;

  const evals = useMemo(
    () => (calcIv && league ? evaluateForLeague(env, p.speciesId, calcIv, league, { playerLevel: settings.playerLevel, bestBuddy: p.flags.bestBuddy, shadow: p.flags.shadow }) : []),
    [env, p, calcIv, league, settings.playerLevel],
  );
  const bestStage = useMemo(() => {
    const ok = evals.filter((e) => e.eligible && e.rankingPos !== null).sort((a, b) => a.rankingPos! - b.rankingPos!);
    return ok[0]?.stageId ?? evals.find((e) => e.relation === 'actual')?.stageId ?? null;
  }, [evals]);
  const stageId = stageSel ?? bestStage;
  const ev = evals.find((e) => e.stageId === stageId) ?? null;

  const ranking = env.rankings[leagueKey];
  const entry = ranking && stageId ? sortedRanking(ranking).find((e) => e.id === stageId) ?? null : null;
  const stageSpecies = stageId ? env.speciesById.get(stageId) : undefined;
  const rec = useMemo(
    () => (stageSpecies ? recommendMoveset(stageSpecies, entry, { fast: p.moves.fast, charged: p.moves.charged, secondUnlocked: p.moves.charged.length >= 2 }) : null),
    [stageSpecies, entry, p.moves],
  );
  const chosen: MovesetOption | null = rec ? (option === 'b' && rec.b ? rec.b : rec.a) : null;

  const fromLevel = p.level ?? p.levelRange?.[0] ?? null;
  const plan = useMemo(
    () => (ev && ev.level && fromLevel !== null && stageId
      ? planUpgrade(env, {
          fromSpeciesId: p.speciesId, toSpeciesId: stageId, fromLevel, toLevel: ev.level,
          mods: { shadow: p.flags.shadow, purified: p.flags.purified, lucky: p.flags.lucky }, bestBuddy: p.flags.bestBuddy,
          playerLevel: settings.playerLevel, moveset: chosen, inventory: Object.keys(settings.inventory).length ? settings.inventory : undefined,
        })
      : null),
    [env, ev, fromLevel, stageId, p, settings, chosen],
  );

  const familyName = plan?.familyId ? nameOf(plan.familyId.replace(/^FAMILY_/, '').toLowerCase()) : '';
  const initialForm: Partial<ManualForm> = {
    species: p.name, nickname: p.nickname ?? '', cp: p.cp, hp: p.hp, level: p.level, ivs: p.ivs,
    appraisal: p.appraisal ? { overall: p.appraisal.overall ?? null, bestStats: p.appraisal.bestStats, bestStatTier: p.appraisal.bestStatTier ?? null, bars: p.appraisal.bars ? { atk: p.appraisal.bars.atk ?? null, def: p.appraisal.bars.def ?? null, hp: p.appraisal.bars.hp ?? null } : undefined } : null,
    origin: p.origin, flags: { ...p.flags }, fast: p.moves.fast, charged: p.moves.charged,
  };

  if (editing) {
    return (
      <Sheet title={`Editar ${p.name}`} onClose={() => setEditing(false)}>
        {editErr && <ul role="alert" className="mb-2 text-[var(--bad)]">{editErr.map((e) => <li key={e}>{e}</li>)}</ul>}
        <PokemonForm initial={initialForm} submitLabel="Guardar cambios" onCancel={() => setEditing(false)}
          onSubmit={async (f) => { const r = await editRecord(intakeEnv, p.id!, formToScan(f)); if (r.ok) { setEditing(false); setEditErr(null); } else setEditErr(r.reasons); }} />
      </Sheet>
    );
  }

  return (
    <Sheet title={p.nickname ? `${p.nickname} (${p.name})` : p.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Sprite src={p.spriteUrl} alt={p.name} size={96} />
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold">PC {fmt(p.cp)} · PS {fmt(p.hp)}</span>
            <span className="text-sm text-[var(--muted)]">{ivText(p)}{p.level ? ` · Nivel ${p.level}` : p.levelRange ? ` · Nivel ${p.levelRange[0]}–${p.levelRange[1]}` : ''}</span>
            <span className="flex flex-wrap gap-1"><FlagBadges flags={p.flags} /></span>
          </div>
        </div>

        <Card>
          <h3 className="mb-1 font-bold">Stats e IVs</h3>
          {sp && <p className="text-sm text-[var(--muted)]">Base ataque {sp.atk} · defensa {sp.def} · PS {sp.hp} · {sp.types.join('/')}</p>}
          {p.ivs ? <p className="text-sm">IVs: <strong>{p.ivs.atk}/{p.ivs.def}/{p.ivs.hp}</strong> ({fmt(p.ivPercent, 1)} %)</p>
            : <p className="text-sm text-[var(--warn)]">IVs inciertos: {p.ivCandidates.length} combinaciones posibles ({ivText(p)}). Edita con la valoración para afinar.</p>}
          <p className="text-sm text-[var(--muted)]">Origen: {ORIGIN_LABEL[p.origin]}{p.appraisal ? ' · con datos de valoración' : ''}</p>
        </Card>

        <Card>
          <h3 className="mb-1 font-bold">Para qué sirve</h3>
          {p.roles.length === 0 ? <p className="text-sm text-[var(--muted)]">Sin roles registrados.</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {p.roles.map((r, i) => <li key={i}>• {describeRole(r, nameOf)}{r.kind === 'pvp' && r.moveset.length ? ` · ${r.moveset.map((m) => bundle.names.moves[m] ?? m).join(' / ')}` : ''}</li>)}
            </ul>
          )}
          <div className="mt-2"><RoleBadges roles={p.roles} max={12} /></div>
        </Card>

        <Card aria-label="Calculadora">
          <h3 className="mb-2 font-bold">Calculadora hacia una liga</h3>
          <Field label="Liga objetivo">
            <Select value={leagueKey} onChange={(e) => { setLeagueKey(e.target.value); setStageSel(null); }}>
              {env.leagues.map((l) => <option key={l.key} value={l.key}>{leagueTitleEs(l.key, bundle.formats)}</option>)}
            </Select>
          </Field>
          {!calcIv && <p className="mt-2 text-sm text-[var(--warn)]">Sin IVs posibles no puedo calcular. Edita el Pokémon.</p>}
          {uncertain && calcIv && <p className="mt-2 text-xs text-[var(--warn)]">IVs inciertos: el cálculo usa una combinación intermedia ({calcIv.atk}/{calcIv.def}/{calcIv.hp}).</p>}
          {evals.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Etapas evolutivas en la liga elegida</caption>
                <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-2">Etapa</th><th className="pr-2">Nivel</th><th className="pr-2">PC</th><th className="pr-2">IV rank</th><th className="pr-2">% mejor</th><th>Ranking</th></tr></thead>
                <tbody>
                  {evals.map((e) => (
                    <tr key={e.stageId} className={e.stageId === stageId ? 'bg-[#27345f]' : ''}>
                      <td className="py-1 pr-2"><button type="button" className="min-h-[44px] text-left underline" onClick={() => setStageSel(e.stageId)} aria-pressed={e.stageId === stageId}>{nameOf(e.stageId.replace(/_shadow$/, ''))}{e.relation === 'actual' ? ' (actual)' : e.relation === 'previa' ? ' (previa)' : ''}</button></td>
                      <td className="pr-2">{fmt(e.level, 1)}</td><td className="pr-2">{fmt(e.cp)}</td><td className="pr-2">{e.ivRank ? `${e.ivRank}/4096` : '—'}</td>
                      <td className="pr-2">{e.percentOfBest ? `${e.percentOfBest.toFixed(1)} %` : '—'}</td><td>{e.rankingPos ? `#${e.rankingPos}` : 'fuera'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ev && plan ? (
            <div className="mt-3 flex flex-col gap-1 text-sm" data-testid="plan">
              <p>Objetivo: <strong>{nameOf(stageId!.replace(/_shadow$/, ''))}</strong> a nivel <strong>{fmt(ev.level, 1)}</strong> (PC {fmt(ev.cp)}).</p>
              {plan.powerUp ? <p>Mejorar de nivel {fromLevel} a {fmt(ev.level, 1)}: <strong>{fmt(plan.powerUp.stardust)}</strong> polvo · <strong>{fmt(plan.powerUp.candy)}</strong> caramelos{plan.powerUp.xlCandy ? <> · <strong>{fmt(plan.powerUp.xlCandy)}</strong> caramelos XL</> : null}</p> : <p>No hace falta mejorar de nivel.</p>}
              {plan.evolution && <p>Evolución: <strong>{plan.evolution.candy === null ? '¿?' : fmt(plan.evolution.candy)}</strong> caramelos{plan.evolution.items.length ? ` + ${plan.evolution.items.join(', ')}` : ''}</p>}
              {plan.secondMove && <p>2.º ataque: <strong>{fmt(plan.secondMove.stardust)}</strong> polvo · <strong>{fmt(plan.secondMove.candy)}</strong> caramelos</p>}
              {(plan.eliteFastTm > 0 || plan.eliteChargedTm > 0) && <p>MT Élite: {plan.eliteFastTm ? `${plan.eliteFastTm} rápida` : ''} {plan.eliteChargedTm ? `${plan.eliteChargedTm} cargada` : ''}</p>}
              <p className="text-[var(--muted)]">Total: {fmt(plan.needs.stardust)} polvo · {fmt(plan.needs.candy)} caramelos{plan.needs.xlCandy ? ` · ${fmt(plan.needs.xlCandy)} XL` : ''} ({familyName ? `Caramelo ${familyName}` : 'caramelos de la familia'})</p>
              {plan.afford.known ? (
                plan.afford.ok ? <p role="status" className="font-semibold text-[var(--ok)]">Te alcanza ✓</p>
                  : <p role="status" className="font-semibold text-[var(--warn)]">Te falta: {(Object.keys(plan.afford.missing) as (keyof Needs)[]).filter((k) => plan.afford.missing[k] > 0).map((k) => `${fmt(plan.afford.missing[k])} ${NEED_LABEL[k]}`).join(' · ')}</p>
              ) : <p className="text-xs text-[var(--muted)]">Carga tu inventario en Ajustes para ver si te alcanza.</p>}
              {plan.notes.map((n) => <p key={n} className="text-xs text-[var(--warn)]">⚠ {n}</p>)}
            </div>
          ) : ev && fromLevel === null ? <p className="mt-2 text-sm text-[var(--warn)]">Falta el nivel actual para calcular costos: edítalo.</p>
            : ev && !ev.eligible ? <p className="mt-2 text-sm text-[var(--muted)]">Esta etapa no entra en la liga con esos IVs.</p> : null}
        </Card>

        {rec && chosen && (
          <Card aria-label="Mejores ataques">
            <h3 className="mb-1 font-bold">Mejores ataques ({nameOf(stageId!.replace(/_shadow$/, ''))})</h3>
            {!rec.fromRanking && <p className="text-xs text-[var(--warn)]">Esta especie no aparece en el ranking de la liga; se muestran ataques genéricos.</p>}
            <div className="mb-2 flex gap-2">
              <Btn variant={option === 'a' ? 'primary' : 'ghost'} onClick={() => setOption('a')} aria-pressed={option === 'a'}>Opción A: la mejor</Btn>
              {rec.b ? <Btn variant={option === 'b' ? 'primary' : 'ghost'} onClick={() => setOption('b')} aria-pressed={option === 'b'}>Opción B: sin legacy</Btn> : <Badge tone="ok">La mejor ya no es legacy</Badge>}
            </div>
            <ul>{chosen.needs.map((n) => <MoveRow key={n.moveId} n={n} />)}</ul>
            {rec.b && option === 'a' && <p className="mt-1 text-xs text-[var(--muted)]">★ = ataque élite/legacy (requiere MT Élite).</p>}
          </Card>
        )}

        <Card>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Notas</span>
            <textarea defaultValue={p.notes} rows={2} className="w-full rounded-xl border border-[#3a4468] bg-[var(--bg)] p-2 text-base"
              onBlur={(e) => { if (e.target.value !== p.notes) void updatePokemon(db, p.id!, { notes: e.target.value }); }} />
          </label>
          <p className="mt-1 text-xs text-[var(--muted)]">Guardado el {new Date(p.createdAt).toLocaleDateString('es')} · datos {p.dataVersion.slice(0, 8)}</p>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => { setEditErr(null); setEditing(true); }}>Editar</Btn>
          {confirmDel ? (
            <>
              <Btn variant="danger" onClick={async () => { await deletePokemon(db, p.id!); onClose(); }}>Sí, eliminar</Btn>
              <Btn onClick={() => setConfirmDel(false)}>Cancelar</Btn>
            </>
          ) : <Btn variant="danger" onClick={() => setConfirmDel(true)}>Eliminar</Btn>}
        </div>
      </div>
    </Sheet>
  );
}
