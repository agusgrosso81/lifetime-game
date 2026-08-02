# Lifetime Game

El juego que dura toda la vida: estudio, tiempo, dieta, notas, plata, mapas y música.
Funciona en la compu y en el celular (POCO X7 Pro), sin depender de ninguna app externa.

Repositorio: https://github.com/agusgrosso81/lifetime-game

Todos los datos se guardan **en tu dispositivo** (IndexedDB del navegador). Nada viaja a
ningún servidor salvo que vos actives las integraciones de Spotify o Google.

---

## Cómo abrirla en la compu

```bash
python -m http.server 8765 --directory "C:\Users\agusi\OneDrive\Documentos\GitHub\lifetime game"
```

Y entrá a **http://127.0.0.1:8765**

> Usá siempre `127.0.0.1`, no `localhost`. Son dos direcciones distintas para el navegador:
> cada una guarda **su propia base de datos**, así que lo que cargues en una no aparece en
> la otra. Y Spotify no acepta `localhost` (ver más abajo).
>
> Si ya venías cargando datos en `localhost:8765`, pasalos así: abrí `http://localhost:8765`,
> **Ajustes → Exportar datos**, después abrí `http://127.0.0.1:8765` y **Ajustes → Importar datos**.

> Tampoco sirve abrir el `index.html` con doble clic: el navegador bloquea la base de datos
> y el modo offline en archivos locales.

---

## Cómo publicarla e instalarla en el celular

Android exige **HTTPS** para permitir GPS, micrófono, notificaciones e instalación.
Por eso `http://192.168.x.x:8765` desde el celu **no sirve**: la app abre, pero sin
esas funciones y sin poder instalarse. La solución gratis es GitHub Pages.

El repo local está en `C:\Users\agusi\OneDrive\Documentos\GitHub\lifetime game`
y ya está subido a GitHub. Para que quede accesible desde el celular faltan dos
cosas que se hacen una sola vez en github.com:

1. **Hacer el repo público** (GitHub Pages gratis no funciona en repos privados):
   entrá al repo → **Settings** → abajo de todo, **Danger Zone** →
   **Change repository visibility** → **Change to public**.
2. **Activar Pages**: **Settings → Pages → Source: Deploy from a branch →
   Branch: main / carpeta `/ (root)` → Save**.

A los ~2 minutos queda publicado en:
**https://agusgrosso81.github.io/lifetime-game/**

Abrí esa dirección en Chrome del celular → menú (⋮) → **Agregar a pantalla de inicio**.

Para subir cambios más adelante, en GitHub Desktop: escribí un resumen abajo a la
izquierda, **Commit to main** y después **Push origin**.

Queda como una app más: ícono propio, pantalla completa, sin barra del navegador y
funcionando sin internet.

Para actualizarla: hacé los cambios, **Commit to main** y **Push origin** en GitHub Desktop.
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
**Google → Descargar lifetime-game.ics** y abrí el archivo en el celu.

---

## Conectar Spotify (opcional)

**Spotify no acepta `localhost`**: lo rechaza al guardarlo. Solo acepta direcciones
HTTPS o de loopback por IP (`http://127.0.0.1:PUERTO`). Por eso:

- En el **celular**, con la app publicada en GitHub Pages (HTTPS), anda directo.
- En la **compu**, abrí la app en `http://127.0.0.1:8765` y registrá esa dirección.

Pasos:

1. Entrá a https://developer.spotify.com/dashboard e iniciá sesión con tu cuenta.
2. **Create app**. Nombre y descripción, lo que quieras.
3. En **Redirect URIs** pegá la dirección exacta desde donde vas a usar la app.
   La pestaña Música te la muestra con un botón para copiar, y te avisa si no sirve.
   Podés agregar las dos (la de la compu y la del celular) en la misma app.
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
   (`https://agusgrosso81.github.io` y/o `http://127.0.0.1:8765`).
   La pestaña Google te lo muestra.
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

Detalles a tener en cuenta al modificarla:

- Si agregás o cambiás archivos, sumalos a la lista `ARCHIVOS` de `sw.js` y subile
  el número a `CACHE` (`lifetime-game-v3` → `v4`) para que se actualice en los
  dispositivos que ya la tengan instalada.
- Si agregás un store nuevo en `db.js`, subí también `DB_VERSION`.
- Para dibujar en canvas usá `ui.alPintar()`, no `requestAnimationFrame`: los
  navegadores no lo disparan con la página oculta y los gráficos quedarían en blanco.
- Las fechas se sacan siempre con `ui.hoyISO()` (hora local). Con `toISOString()` de
  noche el día UTC ya cambió y todos los "hoy" saldrían mal.
- `ui.confirmar` resuelve la promesa en un único lugar (`alCerrar`): si cada botón
  resolviera por su cuenta, el cierre ganaría de mano y todos los borrados fallarían.
- El nombre interno de la base sigue siendo `organizador` a propósito: cambiarlo
  crearía una base vacía y los datos ya cargados quedarían inaccesibles.
