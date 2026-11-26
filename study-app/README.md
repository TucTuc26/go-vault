# Cuaderno de Estudio

App web para estudiar: subes el material de la clase (PDF, Word `.docx`, PowerPoint `.pptx`, texto o fotos de apuntes) y genera:

- **Guía de estudio**: resumen, temas con puntos clave y ejemplos, glosario, preguntas de repaso y consejos.
- **Quizzes**: opción múltiple y verdadero/falso, con explicación de cada respuesta y la nota final.
- **Tarjetas de memoria**: se voltean con un toque; las que cuestan se repiten, y puedes repasar "solo las difíciles".

Todo (materias, archivos y resultados) se guarda **solo en el navegador** del dispositivo donde se usa.

## Formas de usarla

**Publicada en:** https://tuctuc26.github.io/go-vault/estudio/ (rama `gh-pages`; para actualizarla, copia `dist/index.html` a `estudio/index.html` en esa rama).

### 1. Enlace de claude.ai (lo más fácil, sin Claude Pro)
La app está publicada como artifact en claude.ai. Al compartir el enlace, ella entra con **su propia cuenta de Claude (sirve la gratuita)** y cada generación usa su límite de mensajes. Arriba a la derecha debe decir **"Claude · tu cuenta"**. La primera vez, claude.ai le pide permiso para que la página use Claude.

### 2. Enlace público para alguien sin Claude (recomendado para compartir)
`dist/index.html` es la app completa en un solo archivo. Se publica gratis así:

1. **Saca una clave gratis de Gemini**: entra a https://aistudio.google.com con una cuenta de Google → **Get API key** → **Create API key** y cópiala.
2. **Publica la app**: entra a https://app.netlify.com/drop, crea una cuenta gratis y arrastra el archivo `cuaderno-de-estudio.zip` (o la carpeta `dist`). Netlify te da un enlace del tipo `https://algo.netlify.app`. Si quieres, en *Site configuration → Change site name* le pones un nombre más bonito.
3. **Configúrala una vez**: abre tu enlace, toca el botón de arriba a la derecha, elige **Google Gemini con tu clave** y pega la clave.
4. **Compártela ya configurada**: en ese mismo panel aparece **"Copiar enlace de configuración"**. Mándale ese enlace: al abrirlo, la app queda lista en su celular sin que tenga que hacer nada. Después puede abrir el enlace normal o agregarlo a la pantalla de inicio (Safari → Compartir → *Agregar a inicio*).

El enlace de configuración lleva tu clave dentro: mándaselo solo a ella. Si algún día se filtra, borra la clave en AI Studio y crea otra.

También puedes usar la **API de Claude** (de pago por uso, clave de https://console.anthropic.com) en vez de Gemini; el enlace de configuración funciona igual.

Para regenerar `dist/index.html` después de editar `cuaderno.html`:

```sh
./build.sh
```

## Notas
- Los PDF escaneados (sin texto) se convierten en imágenes de sus primeras 20 páginas para que la IA las lea.
- Los formatos antiguos `.doc` y `.ppt` no se pueden leer: guárdalos como `.docx`, `.pptx` o PDF.
- Si el material marcado pasa de 150 000 caracteres, solo se usa el comienzo y la app avisa; conviene generar por unidades (desmarcando archivos o usando "Enfocarse en").
