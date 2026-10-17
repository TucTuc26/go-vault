/**
 * Transcripción fiel (en lo que afecta al ranking de IVs) de `generateIVCombinations` de
 * PvPoke (src/js/pokemon/Pokemon.js, licencia MIT, ver NOTICE.md). Se usa SOLO en tests como
 * referencia independiente: no comparte código con src/engine.
 */
export interface RefCombo {
  level: number;
  ivs: { atk: number; def: number; hp: number };
  atk: number; def: number; hp: number; overall: number; cp: number;
}

import { originalCpmTable } from './pvpoke-original';

/** Tabla de cpm literal de PvPoke (Pokemon.js), niveles 1–51 de 0.5 en 0.5. */
export function pvpokeCpms(_cpmsWhole?: number[]): number[] {
  return originalCpmTable();
}

export function pvpokeGenerateIVCombinations(
  base: { atk: number; def: number; hp: number },
  cpms: number[],
  targetCP: number,
  levelCap: number,
  baseLevelFloor = 1,
): RefCombo[] {
  const calculateCP = (cpm: number, a: number, d: number, h: number) => {
    const cp = Math.floor(((base.atk + a) * Math.pow(base.def + d, 0.5) * Math.pow(base.hp + h, 0.5) * Math.pow(cpm, 2)) / 10);
    return Math.max(cp, 10);
  };
  const combinations: RefCombo[] = [];
  let level = levelCap;
  let cpm = 0;
  let calcCP = 0;
  for (let hpIV = 15; hpIV >= 0; hpIV--) {
    for (let defIV = 15; defIV >= 0; defIV--) {
      for (let atkIV = 15; atkIV >= 0; atkIV--) {
        if (targetCP > 500) level = baseLevelFloor;
        else level = 0.5;
        calcCP = 0;
        while (level < levelCap && calcCP < targetCP) {
          level += 0.5;
          cpm = cpms[(level - 1) * 2];
          calcCP = calculateCP(cpm, atkIV, defIV, hpIV);
        }
        if (calcCP > targetCP) {
          level -= 0.5;
          cpm = cpms[(level - 1) * 2];
          calcCP = calculateCP(cpm, atkIV, defIV, hpIV);
        }
        if (calcCP <= targetCP) {
          const atk = cpm * (base.atk + atkIV);
          const def = cpm * (base.def + defIV);
          const hp = Math.floor(cpm * (base.hp + hpIV));
          combinations.push({ level, ivs: { atk: atkIV, def: defIV, hp: hpIV }, atk, def, hp, overall: hp * atk * def, cp: calcCP });
        }
      }
    }
  }
  // sort descendente por "overall" (comparador de PvPoke, sortDirection=1; estable)
  combinations.sort((a, b) => (a.overall > b.overall ? -1 : b.overall > a.overall ? 1 : 0));
  return combinations;
}
