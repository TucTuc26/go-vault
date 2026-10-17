import type { ReactNode } from 'react';
import type { Role, SavedPokemon } from '../db/types';
import { spriteUrl } from '../data/names';
import { Badge, Sprite } from './components';
import { FLAG_LABEL, TYPE_ES, fmt, leagueTitleEs, showcaseLabel } from './i18n';
import { useApp } from './state';

export function RoleBadges({ roles, max = 6 }: { roles: Role[]; max?: number }) {
  const { bundle } = useApp();
  const shown = roles.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((r, i) => {
        const dub = 'uncertain' in r && r.uncertain ? '?' : '';
        switch (r.kind) {
          case 'pvp': return <Badge key={i} tone="info" title={`${leagueTitleEs(r.leagueKey, bundle.formats)}: IV rank ${r.ivRank}, ${r.percentOfBest.toFixed(1)} %`}>{leagueTitleEs(r.leagueKey, bundle.formats).replace('Liga ', '')} #{r.ivRank}{dub}</Badge>;
          case 'gym': return <Badge key={i} tone="ok" title="Resistencia DEF×PS">Gimnasio #{r.rank}{dub}</Badge>;
          case 'raid': return <Badge key={i} tone="warn" title="Estimación propia">Ataque {TYPE_ES[r.type] ?? r.type} #{r.rank} (est.){dub}</Badge>;
          case 'showcase': return <Badge key={i} tone="shadow">{showcaseLabel(r.reason)}</Badge>;
          case 'manual': return <Badge key={i}>Manual</Badge>;
        }
      })}
      {roles.length > max && <Badge>+{roles.length - max}</Badge>}
    </span>
  );
}

export function FlagBadges({ flags: f }: { flags: object }) {
  const flags = f as Record<string, boolean | undefined>;
  const on = Object.keys(FLAG_LABEL).filter((k) => flags[k]);
  return <>{on.map((k) => <Badge key={k} tone={k === 'shadow' ? 'shadow' : 'muted'}>{FLAG_LABEL[k]}</Badge>)}</>;
}

export function ivText(p: Pick<SavedPokemon, 'ivs' | 'ivPercent' | 'ivPercentRange'>): string {
  if (p.ivs) return `${p.ivs.atk}/${p.ivs.def}/${p.ivs.hp} · ${fmt(p.ivPercent, 0)} %`;
  if (p.ivPercentRange) return `IV ${fmt(p.ivPercentRange[0], 0)}–${fmt(p.ivPercentRange[1], 0)} %`;
  return 'IV sin determinar';
}

export function SavedCard({ p, onOpen, extra }: { p: SavedPokemon; onOpen?: () => void; extra?: ReactNode }) {
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})} className="flex w-full min-h-[44px] items-start gap-3 rounded-2xl bg-[var(--panel)] p-3 text-left">
      <Sprite src={p.spriteUrl || spriteUrl(1)} alt="" size={56} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <strong className="truncate text-base">{p.nickname ? `${p.nickname} (${p.name})` : p.name}</strong>
          <span className="text-sm text-[var(--muted)]">PC {fmt(p.cp)}</span>
        </span>
        <span className="text-sm text-[var(--muted)]">{ivText(p)}{p.level ? ` · Nivel ${p.level}` : p.levelRange ? ` · Nivel ${p.levelRange[0]}–${p.levelRange[1]}` : ''}</span>
        <span className="flex flex-wrap gap-1"><FlagBadges flags={p.flags} /></span>
        <RoleBadges roles={p.roles} />
        {extra}
      </span>
    </Tag>
  );
}
