import { useMemo, useState } from 'react';
import { normalizeText } from '../data/names';
import type { SavedPokemon } from '../db/types';
import { Chip, Empty, Field, NumInput, Select, TextInput } from './components';
import { DetailSheet } from './DetailSheet';
import { SavedCard } from './PokemonCard';
import { FLAG_LABEL, ROLE_KIND_LABEL, leagueTitleEs } from './i18n';
import { useApp } from './state';

type Sort = 'rank' | 'iv' | 'cp' | 'date';
const FLAG_FILTERS = ['shadow', 'purified', 'lucky', 'shiny', 'xxl', 'xxs', 'bestBuddy', 'costume'] as const;

function ivMid(p: SavedPokemon): number {
  return p.ivPercent ?? (p.ivPercentRange ? (p.ivPercentRange[0] + p.ivPercentRange[1]) / 2 : -1);
}

export default function CollectionPage() {
  const { pokemon, bundle, species, nameOf } = useApp();
  const [q, setQ] = useState('');
  const [league, setLeague] = useState('');
  const [role, setRole] = useState('');
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [ivMin, setIvMin] = useState<number | null>(null);
  const [ivMax, setIvMax] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>('date');
  const [openId, setOpenId] = useState<number | null>(null);

  const leagues = useMemo(() => bundle.formats.filter((f) => f.rankingKey).map((f) => ({ key: f.rankingKey!, title: leagueTitleEs(f.rankingKey!, bundle.formats) })), [bundle]);

  const list = useMemo(() => {
    const nq = normalizeText(q);
    const out = pokemon.filter((p) => {
      if (nq) {
        const sp = species(p.speciesId);
        const hay = normalizeText(`${p.name} ${p.nickname ?? ''} ${nameOf(p.speciesId)} ${sp?.name ?? ''}`);
        if (!hay.includes(nq)) return false;
      }
      if (league && !p.roles.some((r) => r.kind === 'pvp' && r.leagueKey === league)) return false;
      if (role && !p.roles.some((r) => r.kind === role)) return false;
      for (const f of flags) if (!(p.flags as Record<string, boolean>)[f]) return false;
      const iv = ivMid(p);
      if (ivMin !== null && iv < ivMin) return false;
      if (ivMax !== null && iv > ivMax) return false;
      return true;
    });
    const bestRank = (p: SavedPokemon) => Math.min(...p.roles.filter((r) => r.kind === 'pvp' && (!league || r.leagueKey === league)).map((r) => (r.kind === 'pvp' ? r.ivRank : 9999)), 9999);
    out.sort((a, b) =>
      sort === 'rank' ? bestRank(a) - bestRank(b)
      : sort === 'iv' ? ivMid(b) - ivMid(a)
      : sort === 'cp' ? (b.cp ?? 0) - (a.cp ?? 0)
      : b.createdAt.localeCompare(a.createdAt));
    return out;
  }, [pokemon, q, league, role, flags, ivMin, ivMax, sort, species, nameOf]);

  const toggleFlag = (f: string) => setFlags((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const open = pokemon.find((p) => p.id === openId);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Buscar (español o inglés, apodo)"><TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Medicham, Mr. Mime…" /></Field>
      <details className="rounded-2xl bg-[var(--panel)] p-3">
        <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">Filtros y orden</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Field label="Liga o copa">
            <Select value={league} onChange={(e) => setLeague(e.target.value)}><option value="">Todas</option>{leagues.map((l) => <option key={l.key} value={l.key}>{l.title}</option>)}</Select>
          </Field>
          <Field label="Rol">
            <Select value={role} onChange={(e) => setRole(e.target.value)}><option value="">Todos</option>{Object.entries(ROLE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <div>
            <p className="mb-1 text-sm text-[var(--muted)]">Etiquetas</p>
            <div className="flex flex-wrap gap-2">{FLAG_FILTERS.map((f) => <Chip key={f} on={flags.has(f)} onClick={() => toggleFlag(f)}>{FLAG_LABEL[f]}</Chip>)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IV mínimo (%)"><NumInput value={ivMin} onChange={setIvMin} /></Field>
            <Field label="IV máximo (%)"><NumInput value={ivMax} onChange={setIvMax} /></Field>
          </div>
          <Field label="Ordenar por">
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="date">Más recientes</option><option value="rank">Mejor IV rank (liga)</option><option value="iv">IV %</option><option value="cp">PC</option>
            </Select>
          </Field>
        </div>
      </details>

      <p className="text-sm text-[var(--muted)]" aria-live="polite" data-testid="collection-count">{list.length} de {pokemon.length} Pokémon</p>
      {pokemon.length === 0 ? <Empty>Tu colección está vacía. Ve a «Agregar» para registrar tu primer Pokémon: solo se guardan los que sirven.</Empty>
        : list.length === 0 ? <Empty>Ningún Pokémon coincide con los filtros.</Empty>
        : <div className="flex flex-col gap-2">{list.map((p) => <SavedCard key={p.id} p={p} onOpen={() => setOpenId(p.id!)} />)}</div>}

      {open && <DetailSheet p={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
