import { useEffect, useMemo, useState } from 'react';
import { prewarmTeamWorkers, runTeamAnalysis } from '../app/teams-run';
import { spriteUrl } from '../data/names';
import { RAID_TIERS, type RaidTierKey } from '../engine/constants';
import { rankGymDefenders, rankRaidAttackers, type RaidOptions } from '../raids/raid';
import type { AnalyzeResult, Candidate, MoveMode, TeamResult } from '../teams';
import { Badge, Btn, Card, Chip, Empty, Field, Select, Sprite, TextInput } from './components';
import { TYPE_ES, fmt, leagueTitleEs } from './i18n';
import { useApp } from './state';

type Mode = 'pvp' | 'raid' | 'gym';

export default function TeamsPage() {
  const [mode, setMode] = useState<Mode>('pvp');
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Tipo de equipo" className="flex gap-2 overflow-x-auto pb-1">
        {([['pvp', 'PvP (equipos de 3)'], ['raid', 'Incursiones'], ['gym', 'Gimnasios']] as [Mode, string][]).map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm ${mode === m ? 'bg-[var(--accent)] font-semibold text-[#0b1020]' : 'bg-[var(--panel2)]'}`}>{l}</button>
        ))}
      </div>
      {mode === 'pvp' && <PvpTeams />}
      {mode === 'raid' && <RaidPanel />}
      {mode === 'gym' && <GymPanel />}
    </div>
  );
}

function costText(c: Candidate['cost']): string {
  if (c.alreadyOptimal) return 'Ya está en su nivel óptimo';
  const parts: string[] = [];
  if (c.needsEvolution) parts.push('evolucionar');
  if (c.stardust) parts.push(`${fmt(c.stardust)} polvo`);
  if (c.candy) parts.push(`${fmt(c.candy)} caramelos`);
  if (c.xlCandy) parts.push(`${fmt(c.xlCandy)} XL`);
  if (c.secondMove) parts.push('2.º ataque');
  if (c.eliteTm) parts.push(`${c.eliteTm} MT Élite`);
  return parts.length ? parts.join(' · ') : 'Sin costo';
}

function Member({ c, role }: { c: Candidate; role?: string }) {
  const { species, bundle } = useApp();
  const sp = species(c.speciesId);
  const mv = (id: string) => bundle.names.moves[id] ?? bundle.movesById.get(id)?.name ?? id;
  return (
    <li className="flex items-start gap-3 rounded-xl bg-[var(--panel2)] p-2">
      <Sprite src={spriteUrl(sp?.dex ?? 0)} alt="" size={48} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <strong>{c.nickname ? `${c.nickname} (${c.label})` : c.label}</strong>{role && <Badge tone="info">{role}</Badge>}
        </span>
        <span className="text-[var(--muted)]">Nivel {fmt(c.level, 1)} · PC {fmt(c.cp)} · IV {c.ivs.atk}/{c.ivs.def}/{c.ivs.hp}</span>
        <span className="text-[var(--muted)]">{[c.fast, ...c.charged].map(mv).join(' · ')}</span>
        <span className="text-xs text-[var(--muted)]">Para llegar aquí: {costText(c.cost)}</span>
        {c.notes.map((n) => <span key={n} className="text-xs text-[var(--warn)]">⚠ {n}</span>)}
      </span>
    </li>
  );
}

function TeamCard({ t, title, nameOf }: { t: TeamResult; title: string; nameOf: (id: string) => string }) {
  const total = t.members.reduce((a, m) => ({ s: a.s + m.cost.stardust, c: a.c + m.cost.candy, x: a.x + m.cost.xlCandy }), { s: 0, c: 0, x: 0 });
  const roleOf = (m: Candidate) => (m.key === t.roles.lead.key ? 'Apertura' : m.key === t.roles.closer.key ? 'Cierre' : 'Cambio');
  return (
    <Card className="flex flex-col gap-2" data-testid="team">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        <span className="text-sm text-[var(--muted)]">Puntaje {fmt(t.score, 1)} · cobertura {Math.round(t.coverage * 100)} %</span>
      </div>
      <ul className="flex flex-col gap-2">{[t.roles.lead, t.roles.swap, t.roles.closer].map((m) => <Member key={m.key} c={m} role={roleOf(m)} />)}</ul>
      <p className="text-sm">{t.explanation}</p>
      {t.uncovered.length > 0 && <p className="text-xs text-[var(--muted)]">Amenazas sin cubrir: {t.uncovered.map((u) => nameOf(u.speciesId)).join(', ')}</p>}
      <p className="text-xs text-[var(--muted)]">Costo total de dejarlo óptimo: {fmt(total.s)} polvo · {fmt(total.c)} caramelos{total.x ? ` · ${fmt(total.x)} XL` : ''}</p>
    </Card>
  );
}

function PvpTeams() {
  const app = useApp();
  const { env, bundle, pokemon, db, settings, nameOf } = app;
  const options = useMemo(() => bundle.formats.filter((f) => f.rankingKey && !f.hideRankings), [bundle]);
  const [key, setKey] = useState('all-1500');
  const [mode, setMode] = useState<MoveMode>('recommended');
  const [topN, setTopN] = useState(100);
  const [busy, setBusy] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [res, setRes] = useState<AnalyzeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // arranca los workers de simulación al abrir la pestaña
  useEffect(() => { if (pokemon.length >= 3) prewarmTeamWorkers(bundle.manifest.dataVersion); }, [pokemon.length >= 3]);

  const go = async () => {
    setErr(null); setRes(null);
    const f = bundle.formats.find((x) => x.rankingKey === key)!;
    setBusy({ stage: 'preparando', done: 0, total: 1 });
    try {
      const r = await runTeamAnalysis({
        env: { ...env, movesById: bundle.movesById }, db, leagueKey: key, cpCap: f.cp, levelCap: bundle.cups[f.cup]?.levelCap, mode, topN, adviceLimit: 12,
        collection: pokemon, playerLevel: settings.playerLevel, dataVersion: bundle.manifest.dataVersion, nameOf,
        onProgress: (stage, done, total) => setBusy({ stage, done, total }),
      });
      setRes(r);
    } catch (e) { setErr(`No se pudieron calcular los equipos: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">Simula tus Pokémon registrados (con sus IVs y ataques exactos) contra el meta de la liga con 0, 1 y 2 escudos, y elige el mejor equipo de 3. Sombra y purificado cuentan como entradas distintas; no se repite especie.</p>
      <Field label="Liga o copa"><Select value={key} onChange={(e) => setKey(e.target.value)}>{options.map((f) => <option key={f.rankingKey!} value={f.rankingKey!}>{leagueTitleEs(f.rankingKey!, bundle.formats)}</option>)}</Select></Field>
      <Field label="Ataques a simular">
        <Select value={mode} onChange={(e) => setMode(e.target.value as MoveMode)}>
          <option value="recommended">Recomendados (los mejores sin legacy, o legacy si ya lo tienes)</option>
          <option value="current">Ataques actuales registrados</option>
        </Select>
      </Field>
      <Field label="Amenazas del meta a simular"><Select value={topN} onChange={(e) => setTopN(Number(e.target.value))}><option value={50}>Top 50 (rápido)</option><option value={100}>Top 100</option><option value={150}>Top 150</option></Select></Field>
      <Btn variant="primary" onClick={go} disabled={!!busy || pokemon.length < 3}>Calcular mejores equipos</Btn>
      {pokemon.length < 3 && <Empty>Registra al menos 3 Pokémon para armar equipos.</Empty>}
      {busy && <div role="status" aria-live="polite"><p className="text-sm">Simulando ({busy.stage}): {busy.done} de {busy.total}</p><progress className="w-full" value={busy.done} max={busy.total} /></div>}
      {err && <p role="alert" className="text-[var(--bad)]">{err}</p>}
      {res && (
        <div className="flex flex-col gap-3" aria-label="Resultados">
          <p className="text-xs text-[var(--muted)]" data-testid="teams-stats">{res.candidates.length} candidatos · {res.opponents.length} amenazas · {res.stats.battles} combates nuevos en {(res.stats.ms / 1000).toFixed(1)} s ({res.stats.cachedRows} filas desde caché)</p>
          {res.teams.length === 0 ? <Empty>Necesitas al menos 3 especies distintas que entren en esta liga (con el tope de CP y de nivel de tu cuenta).</Empty> : (
            <>
              <TeamCard t={res.teams[0]} title="Mejor equipo" nameOf={nameOf} />
              {res.teams.slice(1).map((t, i) => <details key={i}><summary className="min-h-[44px] cursor-pointer py-2">Alternativa {i + 2} (puntaje {fmt(t.score, 1)})</summary><TeamCard t={t} title={`Alternativa ${i + 2}`} nameOf={nameOf} /></details>)}
            </>
          )}
          {res.advice.length > 0 && (
            <Card>
              <h3 className="mb-1 font-bold">¿Qué me falta?</h3>
              <p className="mb-2 text-xs text-[var(--muted)]">Especies del top que no tienes y cuánto subirían el puntaje del mejor equipo.</p>
              <ol className="flex flex-col gap-1 text-sm">
                {res.advice.slice(0, 5).map((a) => (
                  <li key={a.speciesId}><strong>{nameOf(a.speciesId.replace(/_shadow$/, ''))}{a.speciesId.endsWith('_shadow') ? ' (sombra)' : ''}</strong> (#{a.pos} del meta): {a.delta >= 0 ? '+' : ''}{a.delta} puntos, junto a {a.replaces}</li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function RaidPanel() {
  const { env, bundle, pokemon, deps, settings, nameOf } = useApp();
  const [q, setQ] = useState('Mewtwo');
  const [tier, setTier] = useState<RaidTierKey>('tier5');
  const [weather, setWeather] = useState('');
  const [friendship, setFriendship] = useState(0);
  const [megaType, setMegaType] = useState('');
  const [party, setParty] = useState(false);
  const [levelMode, setLevelMode] = useState<'max' | 'current'>('max');
  const boss = useMemo(() => deps.speciesIndex.best(q), [q, deps.speciesIndex]);
  const opts: RaidOptions = { tier, weather: weather || null, friendship, megaType: megaType || null, party, levelMode, playerLevel: settings.playerLevel, megaBoost: bundle.game.mega ?? { sameType: 1.3, otherType: 1.1 } };
  const list = useMemo(
    () => (boss ? rankRaidAttackers({ ...env, movesById: bundle.movesById }, pokemon, boss.speciesId, opts, 6) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boss, pokemon, tier, weather, friendship, megaType, levelMode, settings.playerLevel],
  );
  const mv = (id: string) => bundle.names.moves[id] ?? bundle.movesById.get(id)?.name ?? id;
  const bossSp = boss ? env.speciesById.get(boss.speciesId) : null;
  return (
    <div className="flex flex-col gap-3">
      <p role="note" className="rounded-xl bg-[var(--panel)] p-2 text-xs text-[var(--warn)]">Todos los números de esta pestaña son una <strong>estimación</strong> propia (DPS/TDO del Game Master), no un dato oficial.</p>
      <Field label="Jefe (especie)" hint={boss ? `Reconocido: ${boss.label}${bossSp ? ` · ${bossSp.types.map((t) => TYPE_ES[t] ?? t).join('/')}` : ''}` : 'Escribe el nombre del jefe'}><TextInput value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Field label="Nivel de la incursión"><Select value={tier} onChange={(e) => setTier(e.target.value as RaidTierKey)}>{Object.entries(RAID_TIERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Clima"><Select value={weather} onChange={(e) => setWeather(e.target.value)}><option value="">Sin clima</option>{Object.keys(bundle.game.weather.byWeather).map((w) => <option key={w} value={w}>{w}</option>)}</Select></Field>
        <Field label="Amistad"><Select value={friendship} onChange={(e) => setFriendship(Number(e.target.value))}>{['Ninguna', 'Buena', 'Genial', 'Ultra', 'Mejores'].map((l, i) => <option key={l} value={i}>{l}</option>)}</Select></Field>
        <Field label="Mega activo (tipo)"><Select value={megaType} onChange={(e) => setMegaType(e.target.value)}><option value="">Ninguno</option>{Object.keys(TYPE_ES).map((t) => <option key={t} value={t}>{TYPE_ES[t]}</option>)}</Select></Field>
        <Field label="Nivel de tus Pokémon"><Select value={levelMode} onChange={(e) => setLevelMode(e.target.value as 'max' | 'current')}><option value="max">Máximo de tu cuenta</option><option value="current">Nivel actual</option></Select></Field>
      </div>
      <Chip on={party} onClick={() => setParty(!party)}>Party Play</Chip>
      {party && <p className="text-xs text-[var(--muted)]">Según el Game Master, Party Play no cambia el daño en incursiones (solo bonos de captura); no altera la estimación.</p>}
      {!boss ? <Empty>No reconozco ese jefe.</Empty> : list.length === 0 ? <Empty>No tengo datos de ataques para este jefe o no hay Pokémon registrados.</Empty> : (
        <ol className="flex flex-col gap-2" aria-label="Mejores atacantes">
          {list.map((a, i) => (
            <li key={a.record.id} className="rounded-2xl bg-[var(--panel)] p-3">
              <div className="flex items-center gap-3">
                <span className="w-6 text-center font-bold text-[var(--accent)]">{i + 1}</span>
                <Sprite src={spriteUrl(env.speciesById.get(a.stageId)?.dex ?? 0)} alt="" size={48} />
                <div className="flex min-w-0 flex-1 flex-col text-sm">
                  <strong>{nameOf(a.stageId.replace(/_shadow$/, ''))} {a.shadow && <Badge tone="shadow">Sombra</Badge>} {a.needsEvolution && <Badge tone="warn">Evolucionar</Badge>} {a.weakToBoss && <Badge tone="bad">Débil al jefe</Badge>}</strong>
                  <span className="text-[var(--muted)]">{mv(a.fast)} · {mv(a.charged)} · nivel {fmt(a.level, 1)}</span>
                  <span>DPS ≈ {fmt(a.dps, 1)} · TDO ≈ {fmt(a.tdo, 0)} <Badge tone="warn">estimación</Badge></span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GymPanel() {
  const { env, pokemon, settings, nameOf } = useApp();
  const list = useMemo(() => rankGymDefenders(env, pokemon, settings.playerLevel, 6), [env, pokemon, settings.playerLevel]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">Resistencia = DEF × PS al nivel que tu cuenta permite (con la penalización de defensa de las sombras).</p>
      {list.length === 0 ? <Empty>Registra Pokémon para ver tus mejores defensores.</Empty> : (
        <ol className="flex flex-col gap-2" aria-label="Mejores defensores">
          {list.map((d, i) => (
            <li key={d.record.id} className="flex items-center gap-3 rounded-2xl bg-[var(--panel)] p-3">
              <span className="w-6 text-center font-bold text-[var(--accent)]">{i + 1}</span>
              <Sprite src={spriteUrl(env.speciesById.get(d.stageId)?.dex ?? 0)} alt="" size={48} />
              <span className="flex min-w-0 flex-1 flex-col text-sm">
                <strong>{nameOf(d.stageId.replace(/_shadow$/, ''))} {d.shadow && <Badge tone="shadow">Sombra</Badge>} {d.needsEvolution && <Badge tone="warn">Evolucionar</Badge>}</strong>
                <span className="text-[var(--muted)]">Resistencia {fmt(d.score / 1000, 1)}k a nivel {fmt(d.level, 1)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
