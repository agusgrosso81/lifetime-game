# Instrucciones para montar el servidor de Lifetime Game

> **Para el asistente que lea esto:** este documento es tu tarea. La persona que te lo dio
> es Agus, estudiante de secundaria, autor de la app. Esta notebook va a ser el servidor
> de su app personal. Seguí los pasos en orden, verificá cada uno antes de seguir, y al
> final entregale el resumen que se pide en la última sección. Escribile en español
> rioplatense, sin tecnicismos innecesarios: explicale qué hiciste y qué tiene que hacer él.
>
> Si algo falla, **no lo escondas ni sigas de largo**: contale qué pasó, qué probaste y
> qué opciones hay. Si un paso te pide una decisión que es suya (por ejemplo qué contraseña
> poner), preguntale en vez de inventar.

---

## 1. Qué es esto

**Lifetime Game** es una app personal de organización: estudio, tiempo, dieta, notas,
finanzas, recorridos en mapa y música. Funciona en el celular (un POCO X7 Pro, como APK) y
en la computadora (navegador).

La app es **local-first**: guarda todo en el dispositivo y anda perfecto sin internet. Este
servidor es un **espejo** que cumple dos funciones:

1. Que los datos de una persona estén en todos sus dispositivos.
2. Que varias personas usen la app, cada una con sus datos completamente separados.

Repositorio: https://github.com/agusgrosso81/lifetime-game

**El contrato técnico completo está en `docs/arquitectura.md` del repo. Leelo antes de
tocar código.** Define el modelo de datos, el protocolo de sincronización y toda la API.

## 2. Decisiones ya tomadas (no las cambies)

- **Acceso remoto por Tailscale.** Es una VPN privada y gratuita. Nada se expone a
  internet público, no se abren puertos del router. Si te parece que hay una forma "mejor"
  de exponer el servidor, no la implementes: preguntá primero.
- **Cuentas por invitación.** El admin genera un código y se lo pasa a quien quiera sumar.
- **Aislamiento total entre usuarios.** Nadie ve los datos de nadie.
- **Servidor sin dependencias externas.** Usa solo módulos nativos de Node
  (`node:http`, `node:sqlite`, `node:crypto`). No agregues librerías, ni Express, ni un
  gestor de paquetes. Es a propósito: en una notebook casera, cada dependencia es algo más
  que se puede romper o desactualizar.

## 3. Requisitos

- **Node.js 22 o superior.** Es obligatorio: el servidor usa `node:sqlite`, que existe
  desde Node 22. Verificalo con `node --version`. Si hay una versión más vieja, instalá la
  LTS actual desde https://nodejs.org
- **Git**, para clonar el repo y bajar actualizaciones.
- Sistema operativo: da igual Windows, macOS o Linux. Más abajo hay instrucciones para
  dejarlo corriendo solo en Windows y en Linux.

## 4. Instalación

```bash
git clone https://github.com/agusgrosso81/lifetime-game.git
cd lifetime-game/server
node servidor.js
```

No hace falta `npm install`: el servidor no tiene dependencias.

Al arrancar tiene que imprimir la versión de Node, dónde quedó la base de datos y en qué
direcciones está escuchando. **Verificá que responda** antes de seguir:

```bash
curl http://127.0.0.1:8770/api/estado
```

Tiene que devolver un JSON con `"ok": true`. Si no responde, revisá:
- ¿La versión de Node es 22+?
- ¿El puerto 8770 está ocupado por otro programa?
- ¿El firewall bloquea Node? En Windows suele aparecer un cartel la primera vez: hay que
  permitir el acceso en redes privadas.

La base de datos se crea sola en `server/datos/lifetime.db`. Esa carpeta contiene **todos
los datos de todos los usuarios**: es lo único que hay que respaldar.

## 5. Tailscale

Sirve para que el celular llegue al servidor desde cualquier lado (la escuela, la calle)
sin abrir el router.

1. Instalá Tailscale en esta notebook desde https://tailscale.com/download e iniciá sesión.
2. Anotá la dirección que le asigna, que empieza con `100.` (la ves con `tailscale ip -4`
   o en la app). Esa es la dirección del servidor.
3. Agus tiene que instalar Tailscale en el celular y entrar con **la misma cuenta**.
4. Cada persona que use la app tiene dos opciones:
   - Que Agus la invite a su red de Tailscale (desde el panel de Tailscale, opción de
     compartir dispositivo), o
   - Usar la app solo dentro de la red WiFi de la casa.

Probá desde el celular, con Tailscale conectado, entrando a `http://100.x.x.x:8770/api/estado`
en el navegador. Si ves el JSON, está todo bien.

> Verificá que el servidor escuche en `0.0.0.0` y no solo en `127.0.0.1`, porque si no,
> Tailscale no puede alcanzarlo. El servidor ya viene configurado así, pero confirmalo.

## 6. Primer usuario (el admin)

**El primer registro se convierte automáticamente en admin y no necesita código de
invitación.** Todos los demás sí lo van a necesitar.

Que lo haga Agus desde la app (Cuenta → Conectarme a un servidor → Crear cuenta), o
directamente:

```bash
curl -X POST http://127.0.0.1:8770/api/registro \
  -H "Content-Type: application/json" \
  -d "{\"usuario\":\"agus\",\"contrasena\":\"LA-QUE-ELIJA-EL\",\"nombre\":\"Agus\"}"
```

**No inventes vos la contraseña ni uses una de ejemplo.** Pedísela a Agus, o mejor,
guialo para que la cargue él desde la app y nunca pase por tus manos.

Después, para sumar a alguien, el admin genera un código desde la app (Cuenta → Admin →
Generar invitación) y se lo pasa. Esa persona se registra con ese código.

## 7. Dejarlo corriendo solo

Si cerrás la terminal, el servidor se apaga. Para que arranque con la notebook:

### Windows (Programador de tareas)

Creá una tarea que ejecute `node` con argumento `servidor.js`, con directorio de trabajo
en la carpeta `server`, disparada "Al iniciar sesión", y marcada para ejecutarse aunque
la notebook esté con batería.

```powershell
$node = (Get-Command node).Source
$carpeta = "C:\ruta\a\lifetime-game\server"
$accion = New-ScheduledTaskAction -Execute $node -Argument "servidor.js" -WorkingDirectory $carpeta
$disparador = New-ScheduledTaskTrigger -AtLogOn
$opciones = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "LifetimeGame" -Action $accion -Trigger $disparador -Settings $opciones
```

Ajustá `$carpeta` a la ruta real antes de ejecutarlo.

### Linux (systemd)

```ini
# /etc/systemd/system/lifetime-game.service
[Unit]
Description=Lifetime Game
After=network.target

[Service]
WorkingDirectory=/ruta/a/lifetime-game/server
ExecStart=/usr/bin/node servidor.js
Restart=always
User=TU-USUARIO

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now lifetime-game
sudo systemctl status lifetime-game
```

### Importante sobre la suspensión

Una notebook cerrada se suspende y deja de responder. Avisale a Agus que para que el
servidor esté siempre disponible tiene que configurar el equipo para que **no se suspenda
al cerrar la tapa** (Windows: Configuración → Sistema → Inicio/apagado; Linux: según el
escritorio). Si prefiere que se suspenda, la app igual funciona: guarda los cambios y
sincroniza cuando el servidor vuelve.

## 8. Copias de seguridad

Los datos de todos los usuarios viven en `server/datos/`. Si se pierde esa carpeta, se
pierde todo lo que no esté en los dispositivos.

El servidor incluye un comando de backup que copia la base a `datos/backups/` y conserva
los últimos 14 días:

```bash
node servidor.js --backup
```

Programalo para que corra una vez por día (Programador de tareas o cron). Además,
recomendale a Agus copiar `server/datos/` de vez en cuando a otro lado (un pendrive, su
Drive), porque un backup en el mismo disco no protege contra que se rompa el disco.

## 9. Actualizar el servidor

Cuando Agus publique cambios:

```bash
cd lifetime-game
git pull
# reiniciá el servicio (systemd) o la tarea programada
```

Si `git pull` da conflictos, es porque se editaron archivos en la notebook. No fuerces
nada que pueda perder trabajo: mostrale el conflicto a Agus y resolvelo con él.

## 10. Seguridad

Cosas que ya están resueltas y **no hay que aflojar**:

- Contraseñas guardadas con `scrypt` y salt por usuario. Nunca en texto plano.
- El `usuario_id` sale siempre del token de sesión, nunca del cuerpo del pedido: un
  cliente no puede escribir en la cuenta de otro aunque lo intente a propósito.
- Límite de intentos de login para frenar fuerza bruta.
- Los tokens viven en la base, así que cerrar sesión los invalida de verdad.

Cosas para tener presentes:

- **No expongas el puerto 8770 a internet** (nada de port forwarding en el router, ni
  DMZ). Tailscale ya resuelve el acceso remoto de forma privada.
- No pongas contraseñas, tokens ni la carpeta `datos/` en el repositorio de GitHub. El
  `.gitignore` ya excluye `server/datos/`, pero verificalo con `git status` antes de
  cualquier commit.
- Si Agus te pide exponerlo públicamente, explicale el riesgo (queda accesible para
  cualquiera de internet, y es una app hecha en casa con datos personales suyos y de sus
  amigos) y proponele Cloudflare Tunnel con autenticación en vez de abrir el router.

## 11. Diagnóstico de problemas

| Síntoma | Qué mirar |
|---|---|
| `Cannot find module 'node:sqlite'` | Node es anterior a la 22. Actualizalo. |
| `EADDRINUSE` | El puerto 8770 ya está en uso. Cambialo con la variable `PORT` o cerrá el otro programa. |
| El celular no conecta | ¿Tailscale activo en ambos? ¿La dirección es la `100.x`? ¿El firewall de la notebook deja pasar Node en redes privadas? |
| Conecta pero no sincroniza | Mirá los logs del servidor: cada pedido imprime una línea. Fijate si llegan los `POST /api/sync` y con qué código responden. |
| "Sesión vencida" en la app | El token venció (duran 90 días) o se borró la base. Que vuelva a iniciar sesión. |
| Datos que reaparecen después de borrarlos | Los borrados son lógicos (`borrado = 1`). Si un registro vuelve, es que un dispositivo desactualizado lo resucitó: sincronizá ese dispositivo. |
| La base parece corrupta | Parar el servidor, restaurar el backup más reciente de `datos/backups/`. Nunca borres `datos/` sin tener copia. |

Para ver qué está pasando, los logs son la primera parada: el servidor imprime una línea
por pedido con fecha, método, ruta, código de respuesta, duración y usuario.

## 12. Qué entregar cuando termines

Escribile a Agus un resumen corto con:

1. **La dirección del servidor**, la de Tailscale (`http://100.x.x.x:8770`), que es la que
   tiene que cargar en la app, en Cuenta → Conectarme a un servidor.
2. **Si ya existe el usuario admin** o si tiene que crearlo él (y cómo).
3. **Si el servidor arranca solo** con la notebook, y qué pasa cuando se cierra la tapa.
4. **Cómo y cuándo se hacen los backups**, y qué carpeta tendría que copiar a otro lado.
5. **Cualquier cosa que haya quedado sin resolver**, dicha derecho, sin adornar.

Si algo no se pudo hacer, decilo explícitamente en vez de dejarlo pasar. Es preferible que
sepa que algo falta a que se entere cuando pierda datos.
