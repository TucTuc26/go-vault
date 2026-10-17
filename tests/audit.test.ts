import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;
const STRING_LITERAL = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g;
/** Quita comentarios y literales de texto para buscar solo números en código. */
const code = (src: string) => src.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '').replace(STRING_LITERAL, '""');

describe('auditoría final', () => {
  const files = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'functions')));

  it('ninguna regla del juego hardcodeada fuera de src/engine/constants.ts (multiplicadores, costos, cpm)', () => {
    const banned = /\b(0\.8333\d*|0\.7903|0\.8403|0\.8453|0\.094|0\.625|0\.390625|1\.6|50000|270000|250000|296)\b/;
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === 'src/engine/constants.ts') continue;
      code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (banned.test(l)) offenders.push(`${rel(f)}:${i + 1}: ${l.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });

  it('los topes de CP de las ligas no se escriben en la lógica (salen de los datos)', () => {
    const allowed = new Set([
      'src/sim/action-logic.ts', // umbrales en ms de la IA de PvPoke (duración de ataques rápidos), no CP
      'src/ui/i18n.ts', // etiqueta de presentación
      'src/providers/claude-import.ts', // ejemplo de JSON dentro del prompt
      'src/sim/battle.ts', // 10 000 ms: duración del minijuego de ataque cargado (PvPoke), no un CP
    ]);
    const offenders: string[] = [];
    for (const f of files) {
      if (allowed.has(rel(f)) || rel(f) === 'src/engine/constants.ts') continue;
      code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (/\b(1500|2500|10000)\b/.test(l)) offenders.push(`${rel(f)}:${i + 1}: ${l.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });

  it('ninguna ruta, registro ni log guarda imágenes (sin console.* en la función, esquema estricto)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/console\.(log|info|debug|warn|error)\(/.test(src) && rel(f).startsWith('functions/')) offenders.push(`${rel(f)} usa console`);
      if (/createObjectURL/.test(src) && !['src/app/backup.ts', 'src/ui/SettingsPage.tsx'].includes(rel(f))) offenders.push(`${rel(f)} usa createObjectURL`);
    }
    expect(offenders).toEqual([]);
    const db = readFileSync(join(ROOT, 'src/db/types.ts'), 'utf8');
    expect(db).toContain('z.strictObject');
    expect(code(db)).not.toMatch(/image|blob|screenshot|photo/i);
  });

  it('licencias y decisiones documentadas', () => {
    const notice = readFileSync(join(ROOT, 'NOTICE.md'), 'utf8');
    for (const w of ['PvPoke', 'MIT', 'PokeMiners', 'PokeAPI']) expect(notice).toContain(w);
    const dec = readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8');
    for (let n = 1; n <= 8; n++) expect(dec).toMatch(new RegExp(`## Fase ${n}\\b`));
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const w of ['GitHub', 'Cloudflare', 'iPhone', 'Google Drive', 'respaldo', 'ANTHROPIC_API_KEY', 'VITE_GOOGLE_CLIENT_ID']) expect(readme).toContain(w);
  });

  it('el despliegue no exige ninguna variable opcional (workflows y configuración)', () => {
    const deploy = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toMatch(/Sin secretos de Cloudflare/);
    expect(existsSync(join(ROOT, 'public/_headers'))).toBe(true);
    expect(existsSync(join(ROOT, 'wrangler.toml'))).toBe(true);
  });
});
