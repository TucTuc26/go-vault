# Cuaderno de Estudio

App web para estudiar: subes el material de la clase (PDF, Word `.docx`, PowerPoint `.pptx`, texto o fotos de apuntes) y genera:

- **Guía de estudio**: resumen, temas con puntos clave y ejemplos, glosario, preguntas de repaso y consejos.
- **Quizzes**: opción múltiple y verdadero/falso, con explicación de cada respuesta y la nota final.
- **Tarjetas de memoria**: se voltean con un toque; las que cuestan se repiten, y puedes repasar "solo las difíciles".

Todo (materias, archivos y resultados) se guarda **solo en el navegador** del dispositivo donde se usa.

## Formas de usarla

### 1. Enlace de claude.ai (lo más fácil, sin Claude Pro)
La app está publicada como artifact en claude.ai. Al compartir el enlace, ella entra con **su propia cuenta de Claude (sirve la gratuita)** y cada generación usa su límite de mensajes. Arriba a la derecha debe decir **"Claude · tu cuenta"**. La primera vez, claude.ai le pide permiso para que la página use Claude.

### 2. Versión independiente con clave propia
`dist/index.html` es la misma app en un solo archivo. Se puede subir gratis a cualquier hosting estático (Netlify Drop, Cloudflare Pages, GitHub Pages). En **Ajustes** (botón arriba a la derecha) se elige el motor:

- **Google Gemini**: clave gratuita en https://aistudio.google.com → "Get API key". El nivel gratuito tiene límites por minuto y por día.
- **API de Claude**: clave de https://console.anthropic.com (de pago por uso).

La clave se guarda solo en ese dispositivo y se envía directo al proveedor.

Para regenerar `dist/index.html` después de editar `cuaderno.html`:

```sh
./build.sh
```

## Notas
- Los PDF escaneados (sin texto) se convierten en imágenes de sus primeras 20 páginas para que la IA las lea.
- Los formatos antiguos `.doc` y `.ppt` no se pueden leer: guárdalos como `.docx`, `.pptx` o PDF.
- Si el material marcado pasa de 150 000 caracteres, solo se usa el comienzo y la app avisa; conviene generar por unidades (desmarcando archivos o usando "Enfocarse en").
