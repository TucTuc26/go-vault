import { useMemo, useState } from 'react';
import { evaluateStage, evolutionLine, recommendMoveset, sortedRanking } from '../engine';
import type { RankingEntry } from '../data/schemas';
import { ivSetsOfRecord } from '../engine/reevaluate';
import type { IVs } from '../engine/types';
import { Badge, Card, Chip, Empty, Field, Select, Sheet, Sprite, TextInput } from './components';
import { TYPE_ES, fmt, leagueTitleEs } from './i18n';
import { spriteUrl, normalizeText } from '../data/names';
import { useApp } from './state';

interface Row {
  entry: RankingEntry;
  pos: number;
  baseId: string;
  shadow: boolean;
  owned: number;
  bestIvRank: number | null;
}

export default function Top100Page() {
  const { env, bundle, pokemon, nameOf, settings } = useApp();
  const options = useMemo(() => bundle.formats.filter((f) => f.rankingKey && !f.hideRankings), [bundle]);
  const [key, setKey] = useState(options.find((o) => o.rankingKey === 'all-1500')?.rankingKey ?? options[0]?.rankingKey ?? 'all-1500');
  const [shadowOnly, setShadowOnly] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Row | null>(null);

  const league = env.leagues.find((l) => l.key === key);
  const ranking = env.rankings[key];
  const meta = bundle.manifest.rankings.find((r) => r.key === key);

  const rows = useMemo<Row[]>(() => {
    if (!ranking || !league) return [];
    const top = sortedRanking(ranking).slice(0, 100);
    return top.map((entry, i) => {
      const sp = env.speciesById.get(entry.id);
      const baseId = sp?.baseId ?? entry.id;
      const shadow = !!sp?.shadow;
      const line = evolutionLine(env, baseId);
      const lineIds = new Set([line.self, ...line.ancestors]);
      const mine = pokemon.filter((p) => lineIds.has(p.speciesId) && !!p.flags.shadow === shadow);
      let best: number | null = null;
      for (const p of mine) {
        const sets: IVs[] = p.ivs ? [p.ivs] : ivSetsOfRecord(p);
        for (const ivs of sets.length > 6 ? [sets[0], sets[sets.length - 1]] : sets) {
          const e = evaluateStage(env, entry.id, ivs, league, { playerLevel: settings.playerLevel, bestBuddy: p.flags.bestBuddy });
          if (e.eligible && e.ivRank && (best === null || e.ivRank < best)) best = e.ivRank;
        }
      }
      return { entry, pos: i + 1, baseId, shadow, owned: mine.length, bestIvRank: best };
    });
  }, [ranking, league, env, pokemon, settings.playerLevel]);

  const nq = normalizeText(q);
  const shown = rows.filter((r) => {
    const sp = env.speciesById.get(r.entry.id);
    if (shadowOnly && !r.shadow) return false;
    if (missingOnly && r.owned > 0) return false;
    if (type && !sp?.types.includes(type)) return false;
    if (nq && !normalizeText(`${nameOf(r.baseId)} ${sp?.name ?? ''}`).includes(nq)) return false;
    return true;
  });
  const types = Object.keys(TYPE_ES);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Liga o copa">
        <Select value={key} onChange={(e) => setKey(e.target.value)}>
          {options.map((f) => <option key={f.rankingKey!} value={f.rankingKey!}>{leagueTitleEs(f.rankingKey!, bundle.formats)}</option>)}
        </Select>
      </Field>
      <p className="text-xs text-[var(--muted)]" data-testid="top-date">
        Rankings de PvPoke · Datos al: {new Date(bundle.manifest.builtAt).toLocaleString('es')} · {meta ? `${meta.count} especies clasificadas` : ''}
      </p>
      <TextInput type="search" aria-label="Buscar en el Top 100" placeholder="Buscar especie (es/en)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Chip on={shadowOnly} onClick={() => setShadowOnly(!shadowOnly)}>Solo sombra</Chip>
        <Chip on={missingOnly} onClick={() => setMissingOnly(!missingOnly)}>Solo los que me faltan</Chip>
      </div>
      <Field label="Tipo">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos</option>{types.map((t) => <option key={t} value={t}>{TYPE_ES[t]}</option>)}
        </Select>
      </Field>

      {!ranking ? <Empty>Este ranking no está disponible.</Empty> : shown.length === 0 ? <Empty>Ninguno coincide con los filtros.</Empty> : (
        <ol className="flex flex-col gap-2" aria-label="Top 100">
          {shown.map((r) => {
            const sp = env.speciesById.get(r.entry.id)!;
            const mv = (id: string) => bundle.names.moves[id] ?? bundle.movesById.get(id)?.name ?? id;
            const rec = recommendMoveset(sp, r.entry, { charged: [] });
            return (
              <li key={r.entry.id}>
                <button type="button" onClick={() => setOpen(r)} className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl bg-[var(--panel)] p-3 text-left">
                  <span className="w-8 shrink-0 pt-1 text-center text-sm font-bold text-[var(--accent)]">#{r.pos}</span>
                  <Sprite src={spriteUrl(sp.dex)} alt="" size={48} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong>{nameOf(r.baseId)}</strong>{r.shadow && <Badge tone="shadow">Sombra</Badge>}
                      <span className="text-sm text-[var(--muted)]">{fmt(r.entry.score, 1)} pts</span>
                    </span>
                    <span className="flex flex-wrap gap-1">{sp.types.map((t) => <Badge key={t}>{TYPE_ES[t] ?? t}</Badge>)}</span>
                    <span className="text-xs text-[var(--muted)]">{r.entry.moveset.map(mv).join(' · ')}</span>
                    {rec.b && <span className="text-xs text-[var(--muted)]">Sin legacy: {[rec.b.fast, ...rec.b.charged].map(mv).join(' · ')}</span>}
                    {r.owned > 0
                      ? <Badge tone="ok">Lo tengo ✓{r.bestIvRank ? ` · mi mejor IV rank ${r.bestIvRank}` : ''}</Badge>
                      : <Badge tone="warn">No lo tengo</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {open && (
        <Sheet title={`#${open.pos} ${nameOf(open.baseId)}${open.shadow ? ' (sombra)' : ''}`} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-3">
            <Card>
              <p className="text-sm">Puntaje {fmt(open.entry.score, 1)} · Stat product del rank 1: {fmt(open.entry.product)}k (ATK {fmt(open.entry.atk, 1)} · DEF {fmt(open.entry.def, 1)} · PS {fmt(open.entry.hp)})</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Ataques usados con más frecuencia: {(open.entry.fastUse ?? []).slice(0, 2).map((m) => bundle.names.moves[m] ?? m).join(', ')} · {(open.entry.chargedUse ?? []).slice(0, 4).map((m) => bundle.names.moves[m] ?? m).join(', ')}</p>
              {open.bestIvRank && <p className="mt-1 text-sm text-[var(--ok)]">Tu mejor ejemplar: IV rank {open.bestIvRank}/4096.</p>}
            </Card>
            <Card>
              <h3 className="mb-1 font-bold">Mejores enfrentamientos</h3>
              <ul className="text-sm">{(open.entry.matchups ?? []).map((m) => <li key={m.id}>✅ {nameOf(env.speciesById.get(m.id)?.baseId ?? m.id)}{env.speciesById.get(m.id)?.shadow ? ' (sombra)' : ''} — {m.rating}</li>)}</ul>
            </Card>
            <Card>
              <h3 className="mb-1 font-bold">Counters (le ganan)</h3>
              <ul className="text-sm">{(open.entry.counters ?? []).map((m) => <li key={m.id}>⚠ {nameOf(env.speciesById.get(m.id)?.baseId ?? m.id)}{env.speciesById.get(m.id)?.shadow ? ' (sombra)' : ''} — {m.rating}</li>)}</ul>
            </Card>
            <p className="text-xs text-[var(--muted)]">Valoraciones de PvPoke (0–1000): más de 500 gana este Pokémon; menos de 500 pierde.</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
