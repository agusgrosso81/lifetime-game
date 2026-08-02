# Arquitectura — Lifetime Game

Documento de referencia. Define el modelo de datos, el protocolo de sincronización y la
API del servidor. **Todo el código (servidor, cliente y APK) tiene que respetar esto.**

## Idea general

La app sigue siendo **local-first**: todo se guarda primero en el dispositivo y funciona
sin conexión. El servidor es un **espejo** que permite tener varios usuarios y que cada
uno tenga sus datos en todos sus dispositivos.

```
  Celular (APK)  ─┐
                  ├─► IndexedDB local ──► cola de sync ──► servidor (SQLite)
  PC (navegador) ─┘                                              │
                                                    cada usuario ve solo lo suyo
```

Reglas que no se negocian:

1. **Sin servidor la app funciona igual.** Si no hay cuenta configurada, los datos se
   guardan con `usuarioId = 'local'` y nunca sale nada del dispositivo.
2. **Los 10 módulos de `js/modules/` no se modifican.** `js/db.js` mantiene exactamente
   la misma API pública (`get/getAll/getBy/getRango/put/putMany/del/clear/count/
   getSetting/setSetting`) y resuelve usuario y sincronización por dentro.
3. **Aislamiento total entre usuarios.** Toda consulta filtra por `usuarioId`. El
   servidor nunca devuelve datos de otro usuario, aunque el cliente los pida.

## Modelo de datos

Todo registro sincronizable lleva estos campos, agregados automáticamente por `db.js`:

| Campo | Tipo | Para qué |
|---|---|---|
| `id` | string (uuid) | Lo genera el cliente. Único global. |
| `usuarioId` | string | Dueño del registro. `'local'` si no hay cuenta. |
| `actualizado` | number | `Date.now()` en cada escritura. Resuelve conflictos. |
| `borrado` | 0 \| 1 | Borrado lógico (lápida), necesario para propagar borrados. |

**Los borrados son lógicos.** `db.del()` marca `borrado = 1` y actualiza `actualizado`;
no elimina la fila. Si se borrara de verdad, el otro dispositivo no tendría forma de
enterarse y el registro volvería a aparecer en la próxima sincronización.

Las lecturas (`get`, `getAll`, `getBy`, `getRango`, `count`) filtran **siempre** por
`usuarioId` actual y por `borrado = 0`.

### Stores que sincronizan

Todos los de `db.js` menos:

- `musicaCache` — tokens de Spotify: son del dispositivo, no del usuario.
- Las claves de `settings` listadas en `SETTINGS_LOCALES` (abajo).

### Settings

Los settings sincronizan (tema, moneda, objetivos de dieta, escala de notas, etc.),
salvo estas claves que son propias de cada dispositivo:

```js
const SETTINGS_LOCALES = [
  'tiempo.enCurso',      // cronómetro corriendo en este aparato
  'ubicacion.enCurso',   // recorrido GPS en curso
  'servidor.url',        // a qué servidor apunta este dispositivo
  'servidor.token',      // sesión de este dispositivo
  'servidor.ultimaSync',
];
```

La clave primaria de `settings` pasa a ser `usuarioId + '|' + clave`.

## Base de datos del servidor (SQLite)

Una sola tabla genérica para todos los stores. Así el servidor no necesita migraciones
cuando la app agrega campos o stores nuevos.

```sql
CREATE TABLE IF NOT EXISTS registros (
  store       TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  usuario_id  TEXT    NOT NULL,
  datos       TEXT    NOT NULL,          -- JSON del registro (sin blobs)
  actualizado INTEGER NOT NULL,
  borrado     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store, id)
);
CREATE INDEX IF NOT EXISTS idx_reg_sync ON registros (usuario_id, actualizado);

CREATE TABLE IF NOT EXISTS usuarios (
  id       TEXT PRIMARY KEY,
  usuario  TEXT UNIQUE NOT NULL,         -- nombre de login, en minúsculas
  nombre   TEXT,                         -- nombre para mostrar
  hash     TEXT NOT NULL,                -- scrypt
  salt     TEXT NOT NULL,
  rol      TEXT NOT NULL DEFAULT 'usuario',   -- 'admin' | 'usuario'
  creado   INTEGER NOT NULL,
  activo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invitaciones (
  codigo     TEXT PRIMARY KEY,
  creado_por TEXT,
  creado     INTEGER NOT NULL,
  expira     INTEGER,                    -- null = no vence
  usado_por  TEXT,                       -- null = sin usar
  usado      INTEGER
);

CREATE TABLE IF NOT EXISTS sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL,
  dispositivo TEXT,
  creado      INTEGER NOT NULL,
  expira      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  usuario_id  TEXT NOT NULL,
  store       TEXT NOT NULL,
  id          TEXT NOT NULL,
  campo       TEXT NOT NULL,             -- 'blob' | 'audioBlob' | 'imagenes.0' ...
  archivo     TEXT NOT NULL,             -- ruta relativa dentro de datos/blobs/
  bytes       INTEGER NOT NULL,
  mime        TEXT,
  actualizado INTEGER NOT NULL,
  borrado     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usuario_id, store, id, campo)
);
```

Seguridad de contraseñas: `scrypt` de `node:crypto`, salt aleatorio de 16 bytes por
usuario, comparación con `timingSafeEqual`. Nunca se guarda la contraseña en claro ni
se devuelve el hash en ninguna respuesta.

## API

Todo JSON con `Content-Type: application/json`, salvo los blobs. Autenticación con
`Authorization: Bearer <token>`. Los errores devuelven `{ error: "mensaje en español" }`
con el código HTTP correcto.

### Públicos (sin token)

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| GET | `/api/estado` | — | `{ ok: true, version, hayAdmin, requiereInvitacion }` |
| POST | `/api/registro` | `{ usuario, contrasena, nombre, codigo }` | `{ token, usuario: {...} }` |
| POST | `/api/login` | `{ usuario, contrasena, dispositivo }` | `{ token, usuario: {...} }` |

`/api/estado` sirve para el botón "Probar conexión" del cliente.

**Primer usuario:** si la tabla `usuarios` está vacía, `/api/registro` acepta sin código
de invitación y ese usuario queda como `admin`. Después, el código es obligatorio.

### Con token

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| GET | `/api/yo` | — | `{ usuario: {...} }` |
| POST | `/api/logout` | — | `{ ok: true }` |
| POST | `/api/sync` | `{ desde, cambios: [...] }` | `{ ahora, cambios: [...] }` |
| PUT | `/api/blob/:store/:id/:campo` | binario, header `X-Mime` | `{ ok, bytes }` |
| GET | `/api/blob/:store/:id/:campo` | — | binario |
| GET | `/api/blobs?desde=N` | — | `{ blobs: [{store,id,campo,bytes,mime,actualizado}] }` |
| POST | `/api/contrasena` | `{ actual, nueva }` | `{ ok: true }` |

### Solo admin

| Método | Ruta | Devuelve |
|---|---|---|
| POST | `/api/invitaciones` | `{ codigo }` — genera un código nuevo |
| GET | `/api/invitaciones` | `{ invitaciones: [...] }` |
| DELETE | `/api/invitaciones/:codigo` | `{ ok: true }` |
| GET | `/api/usuarios` | `{ usuarios: [...] }` (sin hashes) |
| PATCH | `/api/usuarios/:id` | activar/desactivar, cambiar rol |

### El endpoint de sincronización

Es el corazón del sistema.

**Pedido:** `POST /api/sync`

```json
{
  "desde": 1785600000000,
  "cambios": [
    { "store": "materias", "id": "uuid", "datos": { }, "actualizado": 1785600001234, "borrado": 0 }
  ]
}
```

**Procesamiento en el servidor, dentro de una transacción:**

1. Para cada cambio entrante: si no existe el registro, insertarlo. Si existe y el
   `actualizado` entrante es **mayor** que el guardado, pisarlo. Si es menor o igual,
   ignorarlo (gana el más nuevo).
2. `usuario_id` se toma **siempre del token**, nunca del cuerpo del pedido. Un cliente
   no puede escribir datos de otro usuario aunque lo intente.
3. Devolver todos los registros del usuario con `actualizado > desde`, incluidas las
   lápidas (`borrado = 1`), para que el otro dispositivo borre lo que corresponde.

**Respuesta:**

```json
{ "ahora": 1785600002000, "cambios": [ { "store": "...", "id": "...", "datos": {}, "actualizado": 0, "borrado": 0 } ] }
```

El cliente guarda `ahora` como `servidor.ultimaSync` y lo manda como `desde` la próxima vez.

**Conflictos:** gana la escritura más reciente por `actualizado` (last-write-wins). Es
suficiente acá: los conflictos reales son rarísimos porque cada usuario usa sus propios
datos, casi siempre desde un dispositivo por vez.

**Relojes desfasados:** si el reloj del celular está adelantado, sus cambios ganan
siempre. El servidor rechaza timestamps más de 24 h en el futuro y los recorta a su
hora actual.

### Blobs (audios e imágenes)

No viajan en `/api/sync` porque pesan. Se suben y bajan aparte, en segundo plano:

- El cliente sube los blobs nuevos de a uno, después de sincronizar los datos.
- El cliente baja un blob cuando el usuario abre el elemento que lo contiene, o en
  segundo plano si el archivo pesa menos que `sync.maxBlobAuto` (por defecto 25 MB).
- El servidor los guarda en `datos/blobs/<usuario_id>/<store>/<id>-<campo>`.
- Límite por archivo: 100 MB. Devuelve 413 si se pasa.

## Cliente

### `js/db.js`

Mantiene la API pública actual y agrega:

```js
db.usuarioActual()            // { id, usuario, nombre, rol } | null (null = modo local)
db.usarUsuario(usuario|null)  // cambia el usuario activo (login / logout)
db.pendientesDeSync()         // cantidad de registros con actualizado > ultimaSync
db.exportarJSON()             // ya existe; ahora exporta solo lo del usuario actual
```

`DB_VERSION` sube a **2**. En la migración, todo registro existente sin `usuarioId`
recibe `usuarioId: 'local'`, `actualizado: Date.now()` y `borrado: 0`. Así nadie pierde
lo que ya tenía cargado.

Al iniciar sesión por primera vez en un dispositivo que venía usándose en modo local, se
le ofrece al usuario **adoptar** los datos locales (reasignarlos a su cuenta y subirlos)
o dejarlos aparte.

### `js/sync.js`

```js
sync.configurado()        // hay url y token
sync.probar(url)          // GET /api/estado — para el botón "Probar conexión"
sync.registrar({url, usuario, contrasena, nombre, codigo})
sync.login({url, usuario, contrasena})
sync.logout()
sync.sincronizar({forzado})   // resuelve { subidos, bajados, error }
sync.estado()             // { estado: 'sin-configurar'|'ok'|'sincronizando'|'error'|'sin-conexion', ultima, pendientes }
sync.alCambiar(fn)        // suscripción para que la UI muestre el estado
```

Cuándo sincroniza solo: al abrir la app, al volver de segundo plano
(`visibilitychange`), cada 5 minutos si hay cambios pendientes, y 10 segundos después de
una escritura (con debounce). Nunca bloquea la interfaz: si falla, guarda el error y
reintenta más tarde con espera creciente.

### `js/cuenta.js`

Pantalla de bienvenida en el primer arranque (elegir entre usar solo en el dispositivo o
conectarse a un servidor), login, registro con código, estado de sincronización, cambio
de contraseña y panel de admin (invitaciones y usuarios).

## APK

El APK envuelve la misma app web con **Capacitor**. El contenido se sirve desde adentro
del APK, así que es contexto seguro: GPS, micrófono y notificaciones funcionan aunque el
servidor esté en HTTP dentro de la red o de Tailscale.

Se compila solo en **GitHub Actions** (`.github/workflows/apk.yml`): cada push a `main`
genera el APK y lo deja como artefacto descargable. No hace falta instalar el Android SDK
en ninguna máquina.

## Decisiones y por qué

- **SQLite con `node:sqlite`** (viene incluido en Node 22+): el servidor no necesita
  ninguna dependencia externa. En una notebook casera eso significa que no hay `npm
  install` que pueda fallar, ni módulos nativos que compilar, ni actualizaciones de
  seguridad de terceros que seguir.
- **Una sola tabla `registros` para los 22 stores**: el servidor no conoce la forma de
  los datos, solo los guarda y los reparte. Cuando la app cambie, el servidor no se toca.
- **Local-first con last-write-wins**: es una app personal, no un sistema colaborativo.
  Que ande sin internet importa mucho más que resolver conflictos complejos.
- **Tokens en la base, no JWT**: permite cerrar sesión de verdad en un dispositivo
  perdido, borrando la fila.
