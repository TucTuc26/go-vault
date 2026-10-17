# Decisiones

Formato: **[Fase] Decisión** — razón / fuente. Las marcadas ⚠ están pendientes de verificar.

## Fase 1 — Datos
- **Especies y rankings usan los `speciesId` de PvPoke** (p. ej. `ninetales_alolan_shadow`): así rankings, ataques recomendados y simulador comparten clave. Los stats base, costos de 2.º ataque, ataques élite y evoluciones con costo se toman del Game Master de PokeMiners cuando la plantilla coincide (normalización `squash`: minúsculas, sin `_`, `alolan→alola`, etc.); si no hay plantilla (megas, formas cosméticas) se usan los de PvPoke. Diferencias de stats se anotan como aviso en el manifest.
- **Game Master de PokeMiners sigue activo** (último push verificado: 2026-08-29; timestamp 1787902550208). `fetch-data` avisa si pasan >60 días sin actualización.
- **Plantillas del GM tienen forma `{templateId, data:{…}}`** (no `data.` plano en algunas): siempre se lee `t.data ?? t`.
- **cpm**: el GM solo trae niveles enteros (1–55); los medios niveles se interpolan con `sqrt((a²+b²)/2)` (constante inevitable en `src/engine/constants.ts`, validada con la tabla oficial en tests).
- **Multiplicadores shadow** (ataque ×1.2, defensa ×0.8333333) vienen de `COMBAT_SETTINGS`; polvo/caramelos shadow ×1.2 y purificado ×0.9 de `POKEMON_UPGRADE_SETTINGS`; lucky −50 % polvo de `LUCKY_POKEMON_SETTINGS`; IV mínimos de clima (4) y raid (10) de `WEATHER_BONUS_SETTINGS`.
- **Tipos**: el orden de los arreglos `attackScalar` es el enum del juego (constante verificada en tests).
- **Rankings**: se guarda solo la categoría `overall` (la app calcula roles propios con su simulador). Para cada formato de `formats.json` (más las 4 ligas base `all-500/1500/2500/10000`) se intenta `rankings/<cup>/overall/rankings-<cp>.json`; matchups/counters solo para los primeros 100 (resto: solo moveset, puntaje, stats y uso de ataques) para limitar el tamaño (~3 MB en total).
- **Nombres en español**: CSV de PokeAPI (`pokemon_species_names.csv`, `move_names.csv`, idioma 7) — una sola descarga, sin una petición por especie. Los nombres de ataque en español de PokeAPI pueden diferir de los del juego en pocos casos; se usa como alias de búsqueda además del nombre inglés.
- **Escritura condicional**: `dataVersion` = hash de los hashes de todos los archivos; si no cambia, no se escribe nada (ni `builtAt`). Si algo falla (red, Zod, conteos mínimos) el proceso sale con código 1 sin tocar `public/data`.
- **Iconos PNG** generados con `scripts/make-icons.ts` (sin dependencias).
