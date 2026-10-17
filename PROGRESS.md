# Progreso

## Hecho
- **Fase 1 — Esqueleto y datos** ✓ (scaffold Vite+React+TS+Tailwind+PWA, `npm run data:fetch`, `public/data/*.json` + `manifest.json`, workflow `update-data.yml`, la app muestra "Datos al: …"). Tests en verde.

- **Fase 2 — Motor de cálculo** ✓ (src/engine: stats, niveles, orígenes, inferIVs, evaluateForLeague, powerUpCost/plan, recommendMoveset; 42 tests, incluida la comparación con la lógica de PvPoke en 30 casos × 3 ligas).

- **Fase 3 — Ingreso** ✓ (manual, texto masivo, OCR local con Tesseract + lectura de barras por color, Drive de solo lectura, importación de Claude, API opcional en `functions/api/scan.ts`; 68 tests).

## Pendiente
- Fases 4 a 8 (ver CLAUDE.md).

## Dudas / verificar
- Ver ⚠ en DECISIONS.md.
- **OCR sin capturas reales**: las zonas de `src/providers/ocr/layout.ts` son una estimación; hay que probar con capturas reales del iPhone y ajustar.

## Necesito de ti
- Cliente OAuth de Google Drive (opcional): pasos en README.md, sección "Google Drive".
- (Más pasos en las Fases 5–8: cuentas de GitHub/Cloudflare, despliegue.)
