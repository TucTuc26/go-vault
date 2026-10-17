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

## Fase 2 — Motor
- **Orden de empate del ranking de IVs = el de PvPoke** (generación hp↓, def↓, atk↓, orden estable; producto calculado como `hp·atk·def` para reproducir sus redondeos en flotantes). Verificado contra una transcripción de `generateIVCombinations` en `tests/pvpoke-reference.ts` y contra los atk/def/hp publicados en los rankings (PvPoke los trunca a 1 decimal).
- **Mejor Amigo**: el nivel mostrado es real+1 (`defaultCpBoostAdditionalLevel` del GM). Las mejoras solo llegan a 50 (`maxNormalUpgradeLevel`); el nivel 51 existe solo con la bandera `bestBuddy`. En ligas, el tope de nivel es 50, o 51 si el Pokémon tiene Mejor Amigo.
- **Tope de nivel de cuenta** = min(nivel de cuenta + 10, 50) (`allowedLevelsAbovePlayer`, `maxNormalUpgradeLevel` del GM). Sin nivel de cuenta se asume 50.
- **Costos**: cada paso de 0.5 usa `stardust[floor(nivel)-1]`; XL desde el nivel 40 con `xlCandy[floor(nivel)-40]`. Verificado: 40→50 = 250 000 polvo + 296 XL; 1→40 = 270 000 polvo. ⚠ Redondeo con multiplicadores (sombra/purificado/suerte): se redondea al entero más cercano por paso; no encontré fuente oficial.
- **Suerte**: −50 % solo al polvo de mejoras (`LUCKY_POKEMON_SETTINGS`). ⚠ No se aplica descuento al 2.º ataque (no hay dato del GM).
- **Pisos de IV por origen**: ver `IV_FLOOR_BY_ORIGIN` (Dittobase/PoGo Hub/Dexerto). Clima (4) y Raid (10) se leen del GM. ⚠ Rocket (reclutas/líderes) = 0 (conservador: no descarta candidatos); Giovanni/incursión sombra = 6; purificado = 2 (suma +2 a cada IV, máx. 15).
- **Valoración**: suma de IVs 0–22 / 23–29 / 30–36 / 37–45; mejor stat 0–7 / 8–12 / 13–14 / 15; barras 0–5 / 6–10 / 11–14 / 15 (Bulbapedia "Appraisal", HowToGeek, iMore). ⚠ Los tramos de las barras no están en una fuente oficial única.
- **Tamaños XXS/XXL**: solo visuales, no afectan stats (Serebii/Niantic); se guardan como etiqueta (`SIZE_AFFECTS_STATS = false`).
- **Shadow en rankings**: la sombra se evalúa con la entrada `_shadow` del ranking (entrada distinta). El orden de IVs por stat product no cambia (atk×1.2 · def×0.8333 ≈ 1).
- **Ataques**: Opción A = moveset del ranking aunque sea élite; Opción B = sustituye los ataques élite por los siguientes más usados en las simulaciones de PvPoke (`fastUse`/`chargedUse`). Estados por ataque: ya lo tiene / TM / 2.º ataque / TM Élite.
- **Megas**: se evalúan como etapas extra solo cuando la liga (ranking) las incluye.
- **Inventario**: caramelos y XL por familia (`family.id` del GM). TM Élite como cantidades.
