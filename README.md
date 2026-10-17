# GO Vault

Gestor de Pokémon GO (PWA, 100 % en español). *El README completo, paso a paso para no técnicos, se termina en la Fase 8.*

## Google Drive (opcional, gratis)

La pestaña **Agregar → Carpeta de Drive** lee imágenes de una carpeta tuya, **solo lectura** (no modifica, mueve ni borra nada, y no copia las imágenes).
Para activarla necesitas un *cliente OAuth* gratuito:

1. Entra a <https://console.cloud.google.com/> con tu cuenta de Google y crea un proyecto (p. ej. "GO Vault").
2. Menú **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** → tipo **Externo** → nombre "GO Vault", tu correo → en **Alcances** añade solo `.../auth/drive.readonly` → en **Usuarios de prueba** añade tu propio correo → guardar.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo **Aplicación web** → en **Orígenes de JavaScript autorizados** pon la URL de tu app (p. ej. `https://go-vault.pages.dev`) y, para pruebas, `http://localhost:5173` → crear.
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y guárdalo como variable `VITE_GOOGLE_CLIENT_ID` en Cloudflare Pages (o en un archivo `.env.local` para pruebas).
6. En la app pega el **ID de tu carpeta** (la parte final de la URL de la carpeta de Drive, o la URL completa).

**Aviso de "app no verificada"**: como la app es tuya y no está publicada en Google, al conectar verás *"Google no verificó esta aplicación"*. Es normal: pulsa **Configuración avanzada → Ir a GO Vault (no seguro)**. Solo concede el permiso de lectura de Drive. Mientras la pantalla de consentimiento esté en modo "Pruebas", Google caduca la autorización cada 7 días y tendrás que volver a conectar.
