import type { Rect } from '../image';

/**
 * Zonas (en proporción del ancho/alto) de las capturas de Pokémon GO en vertical (iPhone).
 * Son valores por defecto generosos; se pueden sobreescribir desde Ajustes si tu captura difiere.
 * ⚠ Calibrados a partir de la disposición típica de la pantalla de detalle; verificar con capturas reales
 * (ver PROGRESS.md "Dudas"). El lector usa recortes amplios + regex tolerantes para compensar.
 */
export interface MainLayout {
  cp: Rect;
  name: Rect;
  hp: Rect;
  /** Polvo estelar de la siguiente mejora (debajo del botón "Mejorar"). */
  dust: Rect;
  /** Caramelos (texto "Caramelo <Especie>") */
  candy: Rect;
}

export const DEFAULT_MAIN_LAYOUT: MainLayout = {
  cp: { x: 0.18, y: 0.035, w: 0.64, h: 0.12 },
  name: { x: 0.12, y: 0.47, w: 0.76, h: 0.09 },
  hp: { x: 0.2, y: 0.555, w: 0.6, h: 0.075 },
  dust: { x: 0.04, y: 0.875, w: 0.46, h: 0.08 },
  candy: { x: 0.04, y: 0.72, w: 0.92, h: 0.08 },
};

export interface AppraisalLayout {
  /** Globo de texto del líder (frases). */
  speech: Rect;
  /** Una banda por barra (ataque, defensa, PS). */
  bars: { atk: Rect; def: Rect; hp: Rect };
}

export const DEFAULT_APPRAISAL_LAYOUT: AppraisalLayout = {
  speech: { x: 0.06, y: 0.56, w: 0.88, h: 0.2 },
  bars: {
    atk: { x: 0.3, y: 0.795, w: 0.62, h: 0.02 },
    def: { x: 0.3, y: 0.835, w: 0.62, h: 0.02 },
    hp: { x: 0.3, y: 0.875, w: 0.62, h: 0.02 },
  },
};
