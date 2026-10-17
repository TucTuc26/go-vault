# GO Vault

Gestor de Pokémon GO para iPhone (app web instalable, 100 % en español, modo oscuro).
Registras tus Pokémon (con capturas, a mano, desde una carpeta de Drive o desde un chat de Claude); la app calcula sus IVs y decide si **sirven** (PvP en cualquier liga o copa, gimnasio, incursión, exhibición). **Solo si sirven** guarda sus datos como texto con un sprite de referencia; si no, no guarda nada. **Nunca se guarda ninguna imagen.**

Además: calculadora de polvo y caramelos hacia la liga que elijas, mejores ataques (con alternativa si el mejor es legacy), Top 100 por liga/copa, y mejores equipos de 3 simulados con tus Pokémon reales.

> Pokémon y Pokémon GO son marcas de Nintendo, Creatures, GAME FREAK y Niantic. Este proyecto no está afiliado a ellas, no maneja credenciales de Niantic ni automatiza el juego. Fuentes y licencias: ver [NOTICE.md](NOTICE.md).

---

## Guía rápida (para alguien no técnico)

La app funciona completa, **sin servidor y sin costo**. Solo necesitas una cuenta gratuita de GitHub y otra de Cloudflare para publicarla en internet y poder instalarla en tu iPhone.

### 1. Crear las cuentas (gratis)
1. **GitHub**: entra a <https://github.com/signup> y crea una cuenta.
2. **Cloudflare**: entra a <https://dash.cloudflare.com/sign-up> y crea una cuenta (no pide tarjeta para Pages).
3. *(Opcional)* **Anthropic**: solo si más adelante quieres la lectura de capturas con la API de Claude de pago (ver «API opcional»).

### 2. Subir el proyecto a GitHub
1. En GitHub pulsa **New repository**, nómbralo `go-vault` y créalo vacío (privado o público).
2. Desde la carpeta del proyecto, en una terminal:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/go-vault.git
   git push -u origin main
   ```
3. En el repositorio ve a **Actions** y habilita los workflows. «Actualizar datos» se ejecuta solo cada 6 horas y trae los datos nuevos del juego y los rankings.

### 3. Publicar en Cloudflare Pages
**Opción A — automática (recomendada, cada cambio se publica solo):**
1. En Cloudflare: **My Profile → API Tokens → Create Token → plantilla «Edit Cloudflare Workers»** (o permisos *Cloudflare Pages: Edit*). Copia el token.
2. Copia también tu **Account ID** (en el panel de Cloudflare, barra lateral derecha de «Workers & Pages»).
3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea:
   - `CLOUDFLARE_API_TOKEN` = el token
   - `CLOUDFLARE_ACCOUNT_ID` = tu Account ID
4. En Cloudflare crea el proyecto una vez: **Workers & Pages → Create → Pages → Upload assets**, nombre `go-vault` (sube cualquier carpeta; luego lo reemplaza el workflow).
5. En GitHub: **Actions → CI → Run workflow** (o haz cualquier `git push`). Al terminar, tu app queda en `https://go-vault.pages.dev`.

**Opción B — conectando GitHub desde Cloudflare:** *Workers & Pages → Create → Pages → Connect to Git*, elige el repositorio; comando de build `npm run build`, carpeta de salida `dist`, variable `NODE_VERSION` = `24`.

La app construye, despliega y funciona **sin ninguna variable opcional**. Las opcionales (se añaden en *Settings → Variables* de Cloudflare o como secretos de GitHub) son:

| Variable | Para qué sirve |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Activar la carpeta de Google Drive (ver más abajo). Secreto de GitHub o variable de build de Cloudflare. |
| `ANTHROPIC_API_KEY`, `APP_PASSCODE`, `MODEL`, `DAILY_SCAN_LIMIT` | API de Claude de pago (opcional; ver «API opcional»). |

### 4. Instalar en el iPhone
1. Abre tu URL (`https://go-vault.pages.dev`) en **Safari**.
2. Toca **Compartir** → **Añadir a pantalla de inicio**. Ábrela desde el ícono.
3. Importante: iOS puede borrar los datos de los sitios web que no se usan durante semanas. Instalarla en la pantalla de inicio reduce el riesgo, y la app pide almacenamiento persistente. **Haz respaldos** (Ajustes → Respaldo): la app te lo recuerda si pasan más de 14 días.
4. La primera vez ábrela con internet: así guarda todo para usarla **sin conexión**.

---

## Cómo se usa cada pestaña

- **Agregar**: elige un método.
  - *Manual*: especie (español o inglés), PC, PS, nivel o polvo de la siguiente mejora, IVs exactos (si los das no se infieren) o datos de la valoración, origen, etiquetas y ataques. «Guardar y agregar otro» agiliza el ingreso.
  - *Texto masivo*: una línea por Pokémon, p. ej. `Medicham 1496 15/15/14 nivel 24`; hay vista previa editable.
  - *Capturas (OCR)*: sube la pantalla del Pokémon (y la de su valoración). El texto se lee **en tu dispositivo, gratis**; la imagen se procesa en memoria y se descarta. Lo dudoso va a **Por revisar** (solo texto).
  - *Carpeta de Drive*: lee las imágenes nuevas de una carpeta de tu Drive (solo lectura). Ver «Google Drive».
  - *Importar de Claude*: «Copiar prompt», adjunta tus capturas en un chat de Claude (tu suscripción, sin API), pega el JSON que responde.
  - Cada Pokémon muestra su veredicto: **Guardado ✓** (con «Deshacer»), **No sirve** (no se escribe nada; hay «Guardar de todos modos»), **Redundante** (ya tienes 3 copias iguales o mejores), **Duplicado** o **Por revisar**.
- **Colección**: busca (español/inglés/apodo), filtra por liga o copa, rol, etiquetas y rango de IV; ordena por IV rank, IV %, PC o fecha. Al tocar un Pokémon: «para qué sirve», **calculadora** (polvo, caramelos, XL, evolución, 2.º ataque y MT élite hacia la liga elegida, con «te alcanza / te falta» si cargaste tu inventario), mejores ataques (opción A la mejor, opción B sin legacy) y editar/eliminar.
- **Top 100**: todas las ligas y copas vigentes con puntaje, moveset recomendado, «lo tengo / no lo tengo», tu mejor IV rank y la ficha con matchups y counters.
- **Equipos**: mejores equipos de 3 simulando tus Pokémon (IVs, nivel y ataques exactos) contra el meta con 0, 1 y 2 escudos; alternativas; «¿qué me falta?» y el costo de dejar cada Pokémon en su nivel óptimo. También mejores atacantes de incursión (estimación) y defensores de gimnasio.
- **Ajustes**: nivel de cuenta, equipo, inventario, umbrales del veredicto, interruptores de exhibición, método de ingreso, estado de los datos (**«Datos al: …»**) y respaldo.

### Si los datos no se actualizan
1. En **Ajustes → Datos del juego → Buscar actualización**.
2. En GitHub, pestaña **Actions → Actualizar datos**: si está en rojo, abre la ejecución: la descarga o la validación falló y se conservaron los datos anteriores (es normal que falle un día si una fuente cae). Pulsa **Run workflow** para reintentar.
3. Si el rojo persiste, mira el aviso que muestra la app (cabecera) y el archivo `DECISIONS.md`.
4. Para forzar la recarga de la app: cierra la app por completo y ábrela con internet; si aparece «Hay una versión nueva», pulsa **Actualizar la app**.

---

## Google Drive (opcional, gratis)

La pestaña **Agregar → Carpeta de Drive** lee imágenes de una carpeta tuya, **solo lectura** (no modifica, mueve ni borra nada, y no copia las imágenes).
Necesitas un *cliente OAuth* gratuito:

1. Entra a <https://console.cloud.google.com/> con tu cuenta de Google y crea un proyecto (p. ej. «GO Vault»).
2. Menú **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** → tipo **Externo** → nombre «GO Vault», tu correo → en **Alcances** añade solo `.../auth/drive.readonly` → en **Usuarios de prueba** añade tu propio correo → guardar.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → **Aplicación web** → en **Orígenes de JavaScript autorizados** pon la URL de tu app (p. ej. `https://go-vault.pages.dev`) y, para pruebas, `http://localhost:5173` → crear.
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y guárdalo como secreto/variable `VITE_GOOGLE_CLIENT_ID` (GitHub Secrets, o variable de build en Cloudflare). Vuelve a desplegar.
6. En la app pega el **ID de tu carpeta** (la parte final de la URL de la carpeta de Drive, o la URL completa).

**Aviso de «app no verificada»**: como la app es tuya y no está publicada en Google, al conectar verás *«Google no verificó esta aplicación»*. Es normal: pulsa **Configuración avanzada → Ir a GO Vault (no seguro)**. Solo concede el permiso de lectura de Drive. Mientras la pantalla de consentimiento esté en modo «Pruebas», Google caduca la autorización cada 7 días y tendrás que volver a conectar.

---

## API de Claude (opcional, de pago, apagada por defecto)

Lee las capturas con visión de Claude (más precisa que el OCR local). Es una función de Cloudflare (`/api/scan`) que solo se activa si defines:

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Tu clave de <https://console.anthropic.com/> (secreto). |
| `APP_PASSCODE` | Código de acceso que tú inventas; se escribe en Ajustes. Sin él nadie más puede usar tu clave. |
| `MODEL` | Opcional. Por defecto `claude-sonnet-5-5`. |
| `DAILY_SCAN_LIMIT` | Opcional. Máximo de escaneos por día (por defecto 100). |

Pasos: Cloudflare → tu proyecto Pages → **Settings → Variables and secrets** → añade las variables (la clave como *Secret*) → vuelve a desplegar. En la app: **Ajustes → Activar API de Claude** y escribe el código de acceso.

Protecciones: código de acceso, límite diario, tamaño máximo (≤6 imágenes de ≤2 MB), límite por IP, `Cache-Control: no-store`; no se guardan ni se registran las imágenes ni su contenido.
**Costo aproximado**: con Sonnet cada captura cuesta del orden de 1–3 centavos de dólar (depende del tamaño y del precio vigente de Anthropic); con el límite diario de 100 el máximo es de unos pocos dólares al día. Revisa los precios en <https://www.anthropic.com/pricing>.

---

## Para desarrolladores

```bash
npm install
npm run data:fetch     # descarga y normaliza los datos (PvPoke, PokeMiners, PokeAPI) en public/data
npm run dev            # servidor local (http://localhost:5173)
npm test               # pruebas (motor, proveedores, simulador vs PvPoke original, interfaz)
npm run build          # compila a dist/
```

- `src/engine`: lógica pura (CP, IVs, ligas, costos, ataques, veredicto) · `src/sim`: port del simulador de PvPoke · `src/teams`, `src/raids`: equipos, incursiones y gimnasios · `src/providers`: métodos de ingreso · `src/db`: IndexedDB (Dexie, solo texto) · `src/ui`: interfaz · `functions/`: API opcional · `scripts/`: datos.
- Ninguna regla del juego está escrita en la lógica: salen de `public/data` (Game Master del juego); las constantes inevitables viven en `src/engine/constants.ts` con su fuente y su prueba.
- Decisiones y reglas pendientes de verificar: [DECISIONS.md](DECISIONS.md). Progreso: [PROGRESS.md](PROGRESS.md).
