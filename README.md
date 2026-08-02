# Organizador

App personal de estudio, tiempo, dieta, notas, plata, mapas y música.
Funciona en la compu y en el celular (POCO X7 Pro), sin depender de ninguna app externa.

Todos los datos se guardan **en tu dispositivo** (IndexedDB del navegador). Nada viaja a
ningún servidor salvo que vos actives las integraciones de Spotify o Google.

---

## Cómo abrirla en la compu

```bash
python -m http.server 8765 --directory C:\Users\agusi\organizador
```

Y entrá a http://localhost:8765

> Tiene que ser por `http://localhost`, no abriendo el `index.html` con doble clic:
> el navegador bloquea la base de datos y el modo offline en archivos locales.

---

## Cómo instalarla en el POCO X7 Pro

Android exige **HTTPS** para permitir GPS, micrófono, notificaciones e instalación.
Por eso `http://192.168.x.x:8765` desde el celu **no sirve**: la app abre, pero sin
esas funciones y sin poder instalarse.

La forma gratis y definitiva es GitHub Pages:

1. Creá una cuenta en github.com (si no tenés).
2. Creá un repositorio nuevo, por ejemplo `organizador`. Podés dejarlo público.
3. Desde esta carpeta, subí el proyecto:

```bash
git remote add origin https://github.com/TU-USUARIO/organizador.git
git branch -M main
git push -u origin main
```

4. En el repo: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save**.
5. A los ~2 minutos queda publicado en `https://TU-USUARIO.github.io/organizador/`.
6. Abrí esa dirección en Chrome del celular → menú (⋮) → **Agregar a pantalla de inicio**.

Queda como una app más: ícono propio, pantalla completa, sin barra del navegador y
funcionando sin internet.

Para actualizarla más adelante: `git add -A && git commit -m "cambios" && git push`.
La app avisa sola cuando hay versión nueva y te ofrece recargar.

---

## Permisos que te va a pedir el celular

Aceptalos cuando aparezcan, cada uno habilita una función:

| Permiso | Para qué |
|---|---|
| Ubicación | Registrar recorridos y crear lugares en el mapa |
| Micrófono | Grabar audios de clase y notas de voz |
| Notificaciones | Alarmas de exámenes y recordatorios |

Las alarmas suenan mientras la app esté abierta o recién usada. Para recordatorios
con el celular guardado, exportá los exámenes a Google Calendar desde la pestaña
**Google → Descargar organizador.ics** y abrí el archivo en el celu.

---

## Conectar Spotify (opcional)

1. Entrá a https://developer.spotify.com/dashboard e iniciá sesión con tu cuenta.
2. **Create app**. Nombre y descripción, lo que quieras.
3. En **Redirect URI** pegá la dirección exacta de tu app
   (por ejemplo `https://TU-USUARIO.github.io/organizador/`).
   La pestaña Música te la muestra con un botón para copiar.
4. Marcá **Web API** y guardá.
5. Copiá el **Client ID** y pegalo en **Ajustes → Spotify Client ID**.
6. Volvé a Música y tocá conectar.

No hace falta el Client Secret: usa PKCE, que es el método seguro para apps sin servidor.

## Conectar Google (opcional)

Sirve para backup en Drive, exportar a Sheets y preparar archivos para NotebookLM.

1. Entrá a https://console.cloud.google.com y creá un proyecto.
2. **APIs y servicios → Biblioteca**: habilitá **Google Drive API** y **Google Sheets API**.
3. **Pantalla de consentimiento OAuth**: tipo External, y agregá tu Gmail como usuario de prueba.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
5. En **Orígenes de JavaScript autorizados** poné el origen de tu app
   (por ejemplo `https://TU-USUARIO.github.io`). La pestaña Google te lo muestra.
6. Copiá el **Client ID** y pegalo en **Ajustes → Google OAuth Client ID**.

El calendario (.ics) y el resumen por Gmail funcionan sin configurar nada de esto.

---

## Copias de seguridad

Los datos viven en el navegador del dispositivo. Si borrás los datos del sitio, se pierden.

- **Ajustes → Exportar datos** baja un `.json` con todo (menos audios e imágenes, que pesan).
- **Ajustes → Importar datos** lo restaura, o lo combina con lo que ya tengas.
- Con Google conectado, **Google → Backup en Drive** hace lo mismo contra tu Drive.

Es la forma de pasar tus datos de la compu al celular y al revés.

---

## Cómo está hecho

JavaScript puro, sin frameworks ni compilación. Se edita y se ve el cambio recargando.

```
index.html            arranque
manifest.webmanifest  datos de instalación (nombre, ícono, colores)
sw.js                 service worker: guarda la app para usarla sin internet
css/app.css           estilos y temas (variables CSS)
js/db.js              base de datos (IndexedDB): todos los módulos guardan acá
js/ui.js              piezas de interfaz: modales, gráficos, fechas, grabador de audio
js/app.js             navegación, temas, alarmas
js/modules/*.js       un archivo por sección
vendor/leaflet/       mapas (copia local, funciona sin internet salvo los mosaicos)
```

Cada módulo de `js/modules/` es independiente y exporta
`{ id, nombre, icono, render }`. Para agregar una sección nueva: creá el archivo,
importalo en `js/app.js` y sumalo al array `MODULOS`. Aparece sola en el menú.

Si agregás o cambiás archivos, sumalos a la lista `ARCHIVOS` de `sw.js` y subile
el número a `CACHE` (`organizador-v2` → `organizador-v3`) para que se actualice
en los dispositivos que ya la tengan instalada.
