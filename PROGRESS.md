# Progreso

## Hecho
- **Fase 1 — Esqueleto y datos** ✓ (scaffold Vite+React+TS+Tailwind+PWA, `npm run data:fetch`, `public/data/*.json` + `manifest.json`, workflow `update-data.yml`, la app muestra "Datos al: …"). Tests en verde.

- **Fase 2 — Motor de cálculo** ✓ (src/engine: stats, niveles, orígenes, inferIVs, evaluateForLeague, powerUpCost/plan, recommendMoveset; 42 tests, incluida la comparación con la lógica de PvPoke en 30 casos × 3 ligas).

- **Fase 3 — Ingreso** ✓ (manual, texto masivo, OCR local con Tesseract + lectura de barras por color, Drive de solo lectura, importación de Claude, API opcional en `functions/api/scan.ts`; 68 tests).

- **Fase 4 — Veredicto y guardado** ✓ (PvP/gimnasio/raid/exhibición, redundancia, duplicados, Dexie solo texto, deshacer, reevaluación en Web Worker; 83 tests en total).

- **Fase 5 — Interfaz** ✓ (Agregar/Colección/Detalle+calculadora/Ajustes; Top 100 y Equipos son marcadores hasta las Fases 6–7; test de flujo completo; Lighthouse accesibilidad/PWA 100).

- **Fase 6 — Top 100** ✓ (todas las ligas/copas, filtros, lo tengo/me falta, ficha con matchups y counters; test de UI).

- **Fase 7 — Equipos** ✓ (port del simulador de PvPoke verificado contra el original en 210 combates; equipos de 3 por liga/copa con matriz en caché, alternativas, ¿qué me falta?, costos; incursiones y gimnasios; Dynamax no implementado: ver DECISIONS).

## Pendiente
- Fase 8 (PWA, actualización, respaldo, despliegue).

## Dudas / verificar
- Rendimiento en iPhone real (meta <5 s con 30+ Pokémon): en escritorio 1.1 s para 38 candidatos.
- Valores de jefes de incursión (`RAID_TIERS`) tomados de fuentes de la comunidad.
- Ver ⚠ en DECISIONS.md.
- **OCR sin capturas reales**: las zonas de `src/providers/ocr/layout.ts` son una estimación; hay que probar con capturas reales del iPhone y ajustar.

## Necesito de ti
- Cliente OAuth de Google Drive (opcional): pasos en README.md, sección "Google Drive".
- (Más pasos en las Fases 5–8: cuentas de GitHub/Cloudflare, despliegue.)
