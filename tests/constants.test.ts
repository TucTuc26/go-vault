import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GM_TYPE_ORDER, halfLevelCpm } from '../src/engine/constants';

const gamePath = join(__dirname, '..', 'public', 'data', 'game.json');

describe('constants.ts', () => {
  it('halfLevelCpm reproduce los cpm de medio nivel conocidos', () => {
    // cpm(1)=0.094, cpm(2)=0.16639787 → cpm(1.5)=0.1351374318 (tabla oficial)
    expect(halfLevelCpm(0.094, 0.16639787)).toBeCloseTo(0.1351374318, 8);
    // cpm(40)=0.7903, cpm(41)=0.7953 → 40.5 = 0.7928 (tabla de niveles)
    expect(halfLevelCpm(0.7903, 0.7953)).toBeCloseTo(0.79280, 4);
  });
  it('GM_TYPE_ORDER coincide con la matriz del Game Master', () => {
    expect(GM_TYPE_ORDER.length).toBe(18);
    if (!existsSync(gamePath)) return;
    const g = JSON.parse(readFileSync(gamePath, 'utf8'));
    const at = (a: string, d: string) => g.typeChart[a][GM_TYPE_ORDER.indexOf(d as never)];
    expect(at('fire', 'grass')).toBeCloseTo(1.6);
    expect(at('normal', 'ghost')).toBeCloseTo(0.390625);
    expect(at('ground', 'flying')).toBeCloseTo(0.390625);
    expect(at('ice', 'dragon')).toBeCloseTo(1.6);
    expect(at('steel', 'fairy')).toBeCloseTo(1.6);
  });
});
