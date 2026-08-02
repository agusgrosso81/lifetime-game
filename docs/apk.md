# El APK: cómo compilarlo e instalarlo

La app se empaqueta como aplicación Android con Capacitor. El contenido web viaja
**adentro** del APK, así que el GPS, el micrófono y las notificaciones funcionan aunque
el servidor esté en HTTP dentro de Tailscale o de tu red.

No hace falta instalar nada en tu PC ni en la notebook: compila GitHub.

## Compilarlo

Se dispara solo cada vez que subís cambios a `main`. Para hacerlo a mano:

1. Entrá a https://github.com/agusgrosso81/lifetime-game
2. Pestaña **Actions** → **Compilar APK** → botón **Run workflow** → **Run workflow**.
3. Tarda entre 5 y 10 minutos la primera vez (después es más rápido por la caché).

## Bajarlo

1. En **Actions**, entrá a la ejecución que terminó (tilde verde).
2. Abajo de todo, en **Artifacts**, bajá **lifetime-game-apk**.
3. Es un `.zip`. Descomprimilo: adentro está `app-debug.apk`.

Pasalo al celular por cable, Drive, Telegram o como te quede cómodo.

## Instalarlo en el POCO X7 Pro

1. Abrí el archivo `.apk` desde el celular.
2. Android te va a decir que **no se permite instalar apps de esta fuente**. Tocá
   **Configuración** y activá el permiso para la app desde la que lo abriste (Archivos,
   Chrome, el que sea). Volvé atrás y tocá **Instalar**.
3. Puede aparecer un aviso de **Play Protect** diciendo que es una app desconocida.
   Es normal: lo dice de cualquier app que no venga de Play Store. Tocá **Instalar igual**.
4. MIUI/HyperOS a veces suma un paso extra de "verificación": esperá unos segundos.

## Permisos

Cuando la app te los pida, aceptalos. Cada uno habilita una función:

| Permiso | Sin él no anda |
|---|---|
| Ubicación | Los recorridos del mapa y los lugares |
| Micrófono | Los audios de clase y las notas de voz |
| Notificaciones | Las alarmas de exámenes y recordatorios |

Para que el registro de recorridos no se corte, en MIUI conviene además:
**Ajustes → Aplicaciones → Lifetime Game → Ahorro de batería → Sin restricciones**.

## Sobre la firma

Es un APK de **depuración**, firmado con la clave de debug de Android. Para uso personal
está perfecto: se instala y funciona igual. Lo que no podés hacer es publicarlo en Play
Store, y si más adelante querés distribuirlo, hay que generar una clave propia y firmar
una versión de release.

Ojo con una consecuencia práctica: si en el futuro firmás el APK con otra clave, Android
lo va a tratar como una app distinta y vas a tener que desinstalar la anterior (perdiendo
los datos guardados en el celular). Antes de hacer eso, exportá tus datos desde
**Ajustes → Exportar datos**, o tenelos sincronizados con el servidor.

## Actualizarlo

Cada vez que se compile una versión nueva, bajala e instalala encima: Android la reconoce
como actualización y **respeta los datos** que ya tenías, siempre que esté firmada con la
misma clave (lo está, mientras compile en GitHub).

## Si algo falla

- **La compilación falla en Actions**: entrá al paso que quedó en rojo y leé el error. Lo
  más común es que falte algún archivo o que haya un error de sintaxis en el JavaScript.
- **El APK instala pero queda en blanco**: es que la carpeta `www/` se armó incompleta.
  Fijate en el log del paso "Armar la carpeta web" cuántos archivos copió.
- **La app no conecta con el servidor**: revisá que Tailscale esté activo en el celular y
  que la dirección cargada en Cuenta sea la que empieza con `100.`. Probá esa misma
  dirección en el navegador del celular; si tampoco responde ahí, el problema es del
  servidor o de la red, no del APK.
