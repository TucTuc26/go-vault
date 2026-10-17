import { lazy, Suspense, useState } from 'react';
import AddPage from './AddPage';
import CollectionPage from './CollectionPage';
import SettingsPage from './SettingsPage';
import { AppProvider, useApp } from './state';
import { Empty } from './components';
import { Banners } from './Banners';

const Top100Page = lazy(() => import('./Top100Page'));
const TeamsPage = lazy(() => import('./TeamsPage'));

type Tab = 'add' | 'collection' | 'top' | 'teams' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'add', label: 'Agregar', icon: '➕' },
  { id: 'collection', label: 'Colección', icon: '📚' },
  { id: 'top', label: 'Top 100', icon: '🏆' },
  { id: 'teams', label: 'Equipos', icon: '⚔️' },
  { id: 'settings', label: 'Ajustes', icon: '⚙️' },
];

function Header() {
  const { bundle } = useApp();
  const m = bundle.manifest;
  return (
    <header className="sticky top-0 z-10 bg-[var(--bg)]/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-xl items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">GO Vault</h1>
        <p data-testid="data-date" className="text-xs text-[var(--muted)]">Datos al: {new Date(m.builtAt).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>
      {m.warnings.length > 0 && <p className="mx-auto max-w-xl text-xs text-[var(--warn)]" role="note">⚠ {m.warnings[0]}{m.warnings.length > 1 ? ` (+${m.warnings.length - 1} más en Ajustes)` : ''}</p>}
    </header>
  );
}

export function Shell() {
  const [tab, setTab] = useState<Tab>('add');
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <Banners />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-2" id="main">
        {tab === 'add' && <AddPage />}
        {tab === 'collection' && <CollectionPage />}
        {tab === 'top' && <Suspense fallback={<Empty>Cargando…</Empty>}><Top100Page /></Suspense>}
        {tab === 'teams' && <Suspense fallback={<Empty>Cargando…</Empty>}><TeamsPage /></Suspense>}
        {tab === 'settings' && <SettingsPage />}
      </main>
      <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-20 border-t border-[#2a3355] bg-[var(--panel)] pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-xl">
          {TABS.map((t) => (
            <li key={t.id} className="flex-1">
              <button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-xs ${tab === t.id ? 'font-bold text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
                <span aria-hidden="true" className="text-lg leading-none">{t.icon}</span>{t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
