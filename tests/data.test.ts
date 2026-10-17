import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle } from '../src/data/loader';

const DIR = join(__dirname, '..', 'public', 'data');
const fileFetcher = async (p: string) => JSON.parse(readFileSync(join(DIR, p), 'utf8'));
const has = existsSync(join(DIR, 'manifest.json'));

describe('public/data (generado por data:fetch)', () => {
  it.skipIf(!has)('todos los JSON validan contra sus esquemas Zod', async () => {
    const b = await loadBundle(fileFetcher);
    expect(b.species.length).toBeGreaterThan(900);
    expect(b.game.cpmWhole.length).toBeGreaterThanOrEqual(51);
    for (const r of b.manifest.rankings) {
      const rk = await b.loadRanking(r.key);
      expect(rk.entries.length).toBe(r.count);
      expect(rk.entries.filter((e) => !b.speciesById.has(e.id)).length).toBe(0);
    }
  });
  it.skipIf(!has)('hay rankings de las 4 ligas base y datos coherentes', async () => {
    const b = await loadBundle(fileFetcher);
    const keys = b.manifest.rankings.map((r) => r.key);
    for (const k of ['all-500', 'all-1500', 'all-2500', 'all-10000']) expect(keys).toContain(k);
    expect(b.game.leagues.map((l) => l.cpCap).sort((a, c) => a - c)).toEqual([1500, 2500, 10000]);
    const medicham = b.speciesById.get('medicham')!;
    expect([medicham.atk, medicham.def, medicham.hp]).toEqual([121, 152, 155]);
  });
});
