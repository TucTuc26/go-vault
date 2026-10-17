# GO Vault — gestor de Pokémon GO (PWA)

## Misión
El usuario ingresa sus Pokémon de Pokémon GO (capturas con OCR gratis, carpeta de Google Drive, importación desde un chat de Claude, o a mano). La app lee los datos, calcula IVs y decide si el Pokémon sirve (PvP en cualquier liga/copa, gimnasio, raid, exhibición). SOLO si sirve, guarda sus datos como TEXTO con un sprite de referencia; si no sirve, no guarda nada. Nunca se guarda la imagen. Al tocar un Pokémon: calculadora de polvo/caramelos hacia la liga elegida y mejores ataques (con alternativa si el mejor es legacy). Extras: mejores equipos con lo registrado y Top 100 por liga, siempre alineado al meta vigente.

## Usuario
Hispanohablante, iPhone. UI 100% en español (nombres de Pokémon en español, inglés como alias de búsqueda). Mobile-first, modo oscuro.

## Stack (decidido, no reabrir)
Vite + React + TypeScript + Tailwind, PWA (vite-plugin-pwa), Dexie (IndexedDB), Zod, Vitest, Web Workers. Backend mínimo: Cloudflare Pages Functions (solo para el proveedor de API opcional; la app debe funcionar completa sin servidor ni costo). Scripts de datos con tsx. CI: GitHub Actions. Hosting: Cloudflare Pages.

## Reglas inquebrantables
1. Nunca manejar credenciales de Niantic ni automatizar el juego. Solo datos que el usuario ingresa o capturas que él mismo proporciona.
2. Nunca guardar imágenes (disco, logs, IndexedDB, servidor). Se procesan en memoria y se descartan.
3. Ninguna regla del juego hardcodeada en la lógica (costos de polvo/caramelos, multiplicadores, topes de nivel, CP de ligas, costo del 2º ataque). Todo sale de datos. Constantes inevitables: src/engine/constants.ts con fuente y test.
4. Si una regla actual es dudosa, investígala en la web, anótala con fuente en DECISIONS.md y sigue. No me preguntes.
5. Licencias: PvPoke es MIT (conservar aviso en NOTICE.md). No hacer scraping de sitios sin permiso (ni Pokebattler, GamePress, LeekDuck). Revisa la licencia de cada fuente.
6. Todo el motor con tests; valida contra el código de PvPoke cuando se pueda.

## Fuentes (confirma rutas exactas explorando los repos)
- PvPoke (MIT): https://github.com/pvpoke/pvpoke — gamemaster.json, rankings por liga/copa en src/data, simulador en src/js/battle.
- Game Master de PokeMiners: https://github.com/PokeMiners/game_masters (latest/latest.json + timestamp.txt). Verifica que siga activo; si no, usa PvPoke y busca alternativa abierta y vigente.
- Sprites: https://github.com/PokeAPI/sprites (por URL, cacheados). Nombres en español: https://pokeapi.co, descargados una vez al construir.
- API de Claude: https://docs.claude.com — verifica el id de modelo vigente; por defecto "claude-sonnet-5-5", configurable por variable de entorno.

## Cómo trabajar
No hagas plan previo ni preguntas: las decisiones ya están tomadas; si algo es ambiguo, elige lo razonable y regístralo en DECISIONS.md. Ejecuta las 8 fases EN ORDEN. Al terminar cada fase: tests en verde, commit, y actualiza PROGRESS.md (fase hecha / pendiente / dudas). Si se corta la sesión, retoma desde PROGRESS.md. Código en inglés; UI, README y resúmenes en español (máx. 10 líneas por fase).

---

## FASE 1 — Esqueleto y datos
- Scaffold del proyecto: src/engine (lógica pura), src/data, src/db, src/ui, functions/, scripts/, public/data/.
- scripts/fetch-data.ts: descarga gamemaster y rankings de PvPoke para Little (500), Super (1500), Ultra (2500), Maestra (10000) y TODAS las copas/formatos vigentes (categorías overall y las que existan). Del Game Master del juego extrae: stats base de GO por especie/forma, cpm por nivel, costos de subir nivel (polvo, caramelos, XL), multiplicadores shadow/purificado, costo de desbloqueo del 2º ataque, ataques elite (legacy) por especie, datos de movimientos, evoluciones con costo.
- Normaliza a public/data/*.json con Zod + manifest.json (builtAt, hash/versión por fuente, advertencias de inconsistencias). Si falla la descarga o validación, conserva los datos anteriores y falla visiblemente. Escribe solo si cambió el hash.
- .github/workflows/update-data.yml: cron cada 6 h + manual; commit automático si hay cambios (dispara el deploy).
- La app muestra "Datos al: <fecha>" y avisos del manifest.
Hecho cuando: data:fetch genera JSON válidos, tests pasan, la app abre mostrando la fecha.

## FASE 2 — Motor de cálculo (src/engine, puro, con tests)
- CP = max(10, floor((atk+ivA)·√(def+ivD)·√(sta+ivS)·cpm²/10)); HP = max(10, floor((sta+ivS)·cpm)). Niveles 1–51 de 0.5 en 0.5.
- Modificadores (de datos o investigados con fuente): shadow, purificado (piso de IV, Return), lucky, origen y piso de IV (salvaje, huevo, raid, investigación, Rocket, intercambio, lucky, purificado), mejor amigo (nivel 51), tope de nivel según nivel de cuenta (verifica regla vigente), tamaños XXS/XXL (verifica si afectan stats; si no, solo etiqueta).
- inferIVs: entrada = especie/forma, CP, HP, polvo de la siguiente mejora (acota el nivel), nivel si se conoce, valoración (comentario general, stat destacado, barras), origen/estado. Salida = candidatos (nivel, ivA, ivD, ivS), rango IV%, ambigüedad y la pregunta mínima que la resolvería. Investiga los umbrales oficiales de la valoración y cítalos.
- evaluateForLeague: para CADA etapa de la línea evolutiva: nivel máximo bajo el tope de CP (respetando tope de cuenta), stat product, rank entre las 4096 combinaciones y % del rank 1, posición en el ranking vigente (shadow = entrada distinta), costo desde el nivel actual.
- powerUpCost: polvo, caramelos y XL de nivel A a B con modificadores; costo de evolución; costo del 2º ataque; costo de Elite TM si el moveset necesita legacy que no tiene. Si hay inventario en Ajustes: "te alcanza / te falta X".
- recommendMoveset: moveset del ranking de PvPoke. Opción A (mejor, aunque sea legacy) y Opción B (mejor sin legacy). Comparar con los ataques actuales: ya los tiene / requiere TM / requiere 2º ataque / requiere Elite TM.
Hecho cuando: tests con casos borde (CP mínimo, nivel 51, shadow, lucky, purificado, evoluciones) y un test que ejecute la lógica de PvPoke y compare rank/stat product en ≥20 casos de las 3 ligas principales.

## FASE 3 — Ingreso de Pokémon (proveedores intercambiables, gratis primero)
Define una interfaz ScanProvider que devuelve los campos extraídos con confidence, con el MISMO esquema Zod para todos. Todos pasan por la misma validación de coherencia del motor (Fase 2), el mismo veredicto (Fase 4) y la misma hoja editable. El usuario elige el proveedor activo en Ajustes. Orden y defaults: gratis primero.
1. MANUAL (de primera clase): formulario rápido con autocompletado de especie (es/en); CP, PS, nivel o polvo de la siguiente mejora; IVs exactos A/D/PS (si los da, NO inferir) o datos de valoración; origen; etiquetas (shadow, purificado, lucky, brillante, XXL, XXS, mejor amigo, disfraz); ataques. Botón "guardar y agregar otro". Modo texto masivo: pegar varias líneas tipo "Medicham 1496 15/15/14 nivel 24" con parser tolerante y vista previa editable antes de procesar.
2. OCR LOCAL GRATIS (Tesseract.js en el navegador, sin servidor ni costo): preprocesar (grises/umbral), recortar zonas por posición relativa y leer CP, PS, polvo, caramelos y nombre. Barras de valoración por análisis de color de píxeles (no OCR). Comentario general por coincidencia aproximada con las frases conocidas (es/en). Especie por coincidencia aproximada contra la lista de especies; si hay ambigüedad, elegir la especie cuyo CP/PS sean coherentes con el motor. Auto-guardar solo si todo es confiable y coherente; si no, ir a una cola "Por revisar" (solo texto, nunca la imagen) con hoja editable.
3. CARPETA DE GOOGLE DRIVE (gratis): el usuario pega el ID de su carpeta. La app (Google Identity Services, SOLO LECTURA, alcance mínimo) lista las imágenes nuevas, las descarga en memoria, las procesa con el proveedor activo (OCR local, importación o API) y recuerda localmente los IDs ya procesados. NUNCA modificar, mover ni borrar nada en Drive. La imagen no se copia ni se guarda en la app. Documenta en el README la creación del cliente OAuth (gratis) y el aviso de "app no verificada".
4. IMPORTAR DESDE UN CHAT DE CLAUDE (usa la suscripción del usuario, sin API): botón "Copiar prompt" que genera un prompt con el esquema JSON exacto y las reglas (solo lo visible, null si hay duda, sin adivinar). El usuario adjunta las capturas en Claude (app o web), pega el JSON resultante en "Importar"; la app lo valida con Zod y sigue el flujo normal. Aceptar un JSON con varios Pokémon.
5. API DE CLAUDE (opcional, de pago, APAGADA por defecto): functions/api/scan.ts con visión y salida estructurada validada con Zod. Variables ANTHROPIC_API_KEY, APP_PASSCODE, MODEL, DAILY_SCAN_LIMIT. Protecciones: código de acceso, límite diario, tamaño máximo, rate limit por IP, Cache-Control: no-store; no guardar ni loguear imágenes ni su contenido. Extraer SOLO lo visible (null con confianza baja si no; prohibido adivinar); agrupar varias imágenes del mismo Pokémon (pantalla principal + valoración).
Común a todos: reducir la imagen (lado mayor ≤1568 px) y quitar EXIF en el cliente; validar coherencia con el motor y, si ningún candidato de IV encaja, marcar "lectura dudosa" y abrir la hoja editable; la imagen nunca se guarda en ningún almacenamiento ni log.
Hecho cuando: hay tests de cada proveedor con entradas simuladas (manual, texto masivo, OCR con 3 capturas de ejemplo, JSON importado válido e inválido, Drive simulado) y un test que verifique que no se guarda ninguna imagen.

## FASE 4 — Veredicto y guardado
- Roles con motivo explícito: PvP por liga/copa (especie o evolución en el top configurable del ranking vigente Y IV rank bajo umbral; defaults ajustables: top 100, rank ≤200 o ≥97% del stat product en Little/Super/Ultra/copas, Maestra con IVs mínimos 14/14/14); Gimnasio (puntaje de resistencia DEF×PS al nivel alcanzable, con shadow; default top 40); Raid/Ataque (estimación propia DPS/TDO desde el Game Master, etiquetada "estimación"; default top 5 por tipo); Exhibición (interruptores: 100%, 0%, brillante, lucky, XXL, XXS, disfraz/forma especial, legacy, mejor amigo, fondo especial, primer ejemplar de la especie). Documenta las fórmulas en DECISIONS.md.
- Redundancia: si ya hay N copias (default 3) iguales o mejores para el rol → no guardar. Duplicado exacto → no guardar.
- Si hay ≥1 rol válido → guarda automático con "Deshacer". Si no → "No sirve, no se guardó nada" sin escribir registro; botón "Guardar de todos modos".
- Registro Dexie solo texto: especie, forma, nombre, apodo, sprite (URL), CP, PS, nivel/rango, IVs o candidatos, valoración, banderas, ataques actuales, origen, fecha, roles con liga/rank/%/moveset, notas, versión de datos, createdAt.
- Reevaluación automática al cambiar la versión de datos (Web Worker): avisa cambios ("ahora clasifica para Ultra", "salió del meta"). Nunca borrar nada solo.
Hecho cuando: tests (hundo, Pokémon malo, redundante, duplicado, solo sirve evolucionado, shadow) y el registro no contiene campos de imagen.

## FASE 5 — Interfaz
Pestañas inferiores: Agregar · Colección · Top 100 · Equipos · Ajustes.
- Agregar: selector de método (Manual, Capturas con OCR, Carpeta de Drive, Importar de Claude, API opcional); cola con progreso; tarjeta por Pokémon (sprite, CP, IV%, insignias por liga, motivo, Guardado ✓ / No sirve); hoja editable; cola "Por revisar"; resumen del lote.
- Colección: filtros (liga/copa, rol, etiquetas, especie, rango de IV), orden (rank, IV%, CP, fecha), búsqueda es/en.
- Detalle: stats e IVs, "para qué sirve" por liga, CALCULADORA (liga objetivo → nivel/CP, polvo, caramelos, XL, evolución, 2º ataque, te falta/te alcanza), mejores ataques (A y B, marcando Elite TM/2º ataque), editar/eliminar.
- Ajustes: nivel de cuenta, equipo, inventario opcional, umbrales, interruptores de exhibición, estado de datos y "buscar actualización", respaldo.
- Contraste AA, objetivos táctiles ≥44 px, estados de carga/vacío/error.
Hecho cuando: flujo completo con datos de prueba (agregar → veredicto → guardar → detalle → calculadora), sin errores de consola, Lighthouse PWA/accesibilidad ≥90.

## FASE 6 — Top 100
Selector de TODAS las ligas/copas vigentes con fecha de datos. Lista de 100: posición, sprite, nombre, tipos, puntaje, moveset recomendado (y alternativa sin legacy), shadow. Filtros (shadow, tipo, búsqueda). Marca "Lo tengo / No lo tengo" y mi mejor IV rank; opción "solo los que me faltan". Tocar abre ficha con matchups y counters. Misma fuente de datos que el motor. Funciona offline con la última caché.

## FASE 7 — Equipos
PvP (3 por liga/copa):
- Porta el simulador de PvPoke (MIT) a TypeScript en un Web Worker, con atribución, y compara resultados con el original.
- Simula cada Pokémon elegible con sus IVs/nivel/ataques exactos (interruptor: ataques actuales vs recomendados) contra el top N del meta (default 100, ponderado) con 0/1/2 escudos; guarda la matriz.
- Mejor equipo de 3: victorias ponderadas, cobertura de amenazas, penalización por debilidades compartidas, roles (apertura/cambio/cierre). Exhaustivo si ≤40 candidatos; búsqueda por haz si hay más. Explicación breve y 2.ª/3.ª alternativas.
- "¿Qué me falta?": qué Pokémon del top mejoraría más el equipo y cuánto costaría llevar uno mío a su nivel óptimo.
- Respetar shadow/purificado como entradas distintas, no repetir especie, nivel de cuenta, mejor amigo, 2º ataque, legacy ya poseídos.
Raids y gimnasios: elegir jefe (especie y tier) → mis 6 mejores atacantes (estimación DPS/TDO, debilidades, shadow, mega, clima, amistad/party como interruptores, etiquetado "estimación"); mejores defensores de gimnasio. Si el Game Master trae datos de Dynamax/Max Battles, modo equivalente; si no, déjalo anotado en DECISIONS.md.
Hecho cuando: con 30+ Pokémon de prueba devuelve equipos en <5 s en iPhone de gama media y el simulador coincide con PvPoke.

## FASE 8 — PWA, actualización, respaldo, despliegue
- Service worker: datos stale-while-revalidate; al abrir consulta manifest.json, si hay versión nueva descarga, avisa y dispara la reevaluación. Funciona offline.
- iOS: navigator.storage.persist(); aviso de primer uso para instalar en pantalla de inicio (iOS puede borrar datos de sitios sin uso). Exportar/importar colección en JSON; recordatorio si pasan >14 días sin respaldo.
- Cloudflare Pages (+ Functions solo si se activa la API). Variables opcionales: ANTHROPIC_API_KEY, APP_PASSCODE, MODEL, DAILY_SCAN_LIMIT (API) y VITE_GOOGLE_CLIENT_ID (Drive). La app debe construir, desplegar y funcionar completa sin ninguna de ellas. CI: tests + build + deploy en cada push.
- README.md en español, paso a paso para alguien no técnico: crear cuentas (GitHub y Cloudflare; Anthropic solo si usa la API opcional), configurar Google Drive (opcional, cliente OAuth gratis), secretos, desplegar, instalar en iPhone, uso de cada pestaña, respaldo, qué hacer si los datos no se actualizan, costo de la API opcional.
- Auditoría final: todos los tests, Lighthouse, ninguna ruta/log guarda imágenes, ninguna regla del juego hardcodeada fuera de constants.ts, NOTICE.md con PvPoke (MIT) y demás fuentes, y DECISIONS.md con cada decisión y cada regla pendiente de verificar.
Hecho cuando: URL desplegada, instalación en iPhone verificada, actualización de datos probada forzando un manifest nuevo, resumen final en español.
