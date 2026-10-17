# Progreso

## Hecho
- **Fase 1 — Esqueleto y datos** ✓ (scaffold Vite+React+TS+Tailwind+PWA, `npm run data:fetch`, `public/data/*.json` + `manifest.json`, workflow `update-data.yml`, la app muestra "Datos al: …"). Tests en verde.

- **Fase 2 — Motor de cálculo** ✓ (src/engine: stats, niveles, orígenes, inferIVs, evaluateForLeague, powerUpCost/plan, recommendMoveset; 42 tests, incluida la comparación con la lógica de PvPoke en 30 casos × 3 ligas).

- **Fase 3 — Ingreso** ✓ (manual, texto masivo, OCR local con Tesseract + lectura de barras por color, Drive de solo lectura, importación de Claude, API opcional en `functions/api/scan.ts`; 68 tests).

- **Fase 4 — Veredicto y guardado** ✓ (PvP/gimnasio/raid/exhibición, redundancia, duplicados, Dexie solo texto, deshacer, reevaluación en Web Worker; 83 tests en total).

- **Fase 5 — Interfaz** ✓ (Agregar/Colección/Detalle+calculadora/Ajustes; Top 100 y Equipos son marcadores hasta las Fases 6–7; test de flujo completo; Lighthouse accesibilidad/PWA 100).

- **Fase 6 — Top 100** ✓ (todas las ligas/copas, filtros, lo tengo/me falta, ficha con matchups y counters; test de UI).

- **Fase 7 — Equipos** ✓ (port del simulador de PvPoke verificado contra el original en 210 combates; equipos de 3 por liga/copa con matriz en caché, alternativas, ¿qué me falta?, costos; incursiones y gimnasios; Dynamax no implementado: ver DECISIONS).

- **Fase 8 — PWA, actualización, respaldo y despliegue** ✓ en el código (datos versionados + caché offline, aviso y reevaluación al cambiar la versión, respaldo con recordatorio, aviso iOS, workflows CI/deploy/update-data, README completo, auditoría automatizada). Falta lo que solo puede hacer el usuario (ver abajo).

## Pendiente
- Despliegue real, instalación en iPhone y prueba de actualización en producción (requieren tus cuentas/dispositivo).
- Calibrar el OCR con capturas reales.

## Dudas / verificar
- Rendimiento en iPhone real (meta <5 s con 30+ Pokémon): en escritorio 1.1 s para 38 candidatos.
- Valores de jefes de incursión (`RAID_TIERS`) tomados de fuentes de la comunidad.
- Ver ⚠ en DECISIONS.md.
- **OCR sin capturas reales**: las zonas de `src/providers/ocr/layout.ts` son una estimación; hay que probar con capturas reales del iPhone y ajustar.

## Necesito de ti
1. **Subir a GitHub**: crea un repositorio vacío `go-vault` y ejecuta `git remote add origin https://github.com/TU_USUARIO/go-vault.git` y `git push -u origin main`.
2. **Cloudflare** (gratis): crea un token de API (plantilla «Edit Cloudflare Workers» / permiso *Cloudflare Pages: Edit*) y copia tu *Account ID*. En GitHub → Settings → Secrets and variables → Actions crea `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. En Cloudflare → Workers & Pages → Create → Pages → Upload assets crea el proyecto `go-vault`. Luego Actions → CI → Run workflow. Resultado: `https://go-vault.pages.dev`.
3. **iPhone**: abre la URL en Safari → Compartir → Añadir a pantalla de inicio; ábrela una vez con internet; confirma que funciona en modo avión.
4. **Google Drive (opcional)**: crea el cliente OAuth (README, sección «Google Drive») y guarda `VITE_GOOGLE_CLIENT_ID` como secreto de GitHub; vuelve a desplegar.
5. **API de Claude (opcional, de pago)**: añade `ANTHROPIC_API_KEY` (secreto) y `APP_PASSCODE` en Cloudflare → Settings → Variables and secrets; actívala en Ajustes.
6. **Probar el OCR** con 2–3 capturas reales de tu iPhone (pantalla del Pokémon y de valoración) y avisar si falla la lectura: las zonas de `src/providers/ocr/layout.ts` están calibradas «a ojo».
7. **Probar la actualización de datos**: Actions → «Actualizar datos» → Run workflow; en la app, Ajustes → Buscar actualización.
