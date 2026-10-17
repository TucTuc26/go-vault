import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'ok' };
export function Btn({ variant = 'ghost', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-[var(--accent)] text-[#0b1020] font-semibold',
    ok: 'bg-[var(--ok)] text-[#06210f] font-semibold',
    danger: 'bg-[#7f1d1d] text-white',
    ghost: 'bg-[var(--panel2)] text-[var(--text)]',
  }[variant];
  return <button type="button" {...p} className={`min-h-[44px] min-w-[44px] rounded-xl px-4 py-2 text-base disabled:opacity-50 ${v} ${className}`} />;
}

export function Card({ children, className = '', ...p }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={`rounded-2xl bg-[var(--panel)] p-3 ${className}`}>{children}</div>;
}

const TONES = {
  ok: 'bg-[#14532d] text-[#bbf7d0]', warn: 'bg-[#713f12] text-[#fde68a]', bad: 'bg-[#7f1d1d] text-[#fecaca]',
  info: 'bg-[#1e3a8a] text-[#dbeafe]', muted: 'bg-[var(--panel2)] text-[var(--muted)]', shadow: 'bg-[#3b0764] text-[#e9d5ff]',
} as const;
export function Badge({ tone = 'muted', children, title }: { tone?: keyof typeof TONES; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Sprite({ src, alt, size = 56 }: { src: string; alt: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div role="img" aria-label={alt} style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-[var(--panel2)] text-xs text-[var(--muted)]">?</div>;
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" onError={() => setBroken(true)} style={{ width: size, height: size, imageRendering: 'pixelated' }} />;
}

/** Hoja modal inferior accesible (Esc cierra, foco al abrir). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--bg)] p-4 pb-8 outline-none">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={id} className="text-xl font-bold">{title}</h2>
          <Btn onClick={onClose} aria-label="Cerrar">✕</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

const inputCls = 'min-h-[44px] w-full rounded-xl border border-[#3a4468] bg-[var(--panel)] px-3 text-base text-[var(--text)] placeholder:text-[#7d86a6]';
export function TextInput(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />; }
export function NumInput({ value, onChange, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <input {...p} inputMode="decimal" value={value ?? ''} className={`${inputCls} ${p.className ?? ''}`}
      onChange={(e) => { const t = e.target.value.replace(',', '.'); onChange(t === '' || Number.isNaN(Number(t)) ? null : Number(t)); }} />
  );
}
export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={`${inputCls} ${p.className ?? ''}`}>{children}</select>; }

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-[44px] rounded-full border px-3 text-sm ${on ? 'border-[var(--accent)] bg-[#27345f] text-white' : 'border-[#3a4468] bg-[var(--panel)] text-[var(--muted)]'}`}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-[#3a4468] p-6 text-center text-[var(--muted)]">{children}</div>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-3">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-6 w-11 accent-[var(--accent)]" />
    </label>
  );
}
