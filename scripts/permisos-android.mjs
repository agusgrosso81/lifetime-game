// permisos-android.mjs — Agrega al AndroidManifest los permisos que la app necesita.
//
// Por qué es un script y no un archivo editado a mano: la carpeta android/ la genera
// Capacitor durante la compilación y no está en el repositorio, así que no hay un
// manifiesto fijo para editar. Este script corre después de `cap add/sync` y es
// idempotente: se puede ejecutar todas las veces que haga falta sin duplicar nada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFIESTO = path.join(RAIZ, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

const PERMISOS = [
  ['android.permission.INTERNET', 'hablar con el servidor'],
  ['android.permission.ACCESS_FINE_LOCATION', 'recorridos GPS precisos'],
  ['android.permission.ACCESS_COARSE_LOCATION', 'ubicación aproximada'],
  ['android.permission.RECORD_AUDIO', 'audios de clase y notas de voz'],
  ['android.permission.POST_NOTIFICATIONS', 'alarmas y recordatorios'],
  ['android.permission.WAKE_LOCK', 'mantener el registro de recorridos activo'],
];

if (!fs.existsSync(MANIFIESTO)) {
  console.error(`  No encontré el AndroidManifest en ${MANIFIESTO}.`);
  console.error('  Corré antes:  npx cap add android');
  process.exit(1);
}

let xml = fs.readFileSync(MANIFIESTO, 'utf8');
let agregados = 0;

const nuevos = PERMISOS
  .filter(([p]) => !xml.includes(`android:name="${p}"`))
  .map(([p, para]) => `    <uses-permission android:name="${p}" />  <!-- ${para} -->`);

if (nuevos.length) {
  // Van justo antes de </manifest>, que es donde Android los espera.
  xml = xml.replace('</manifest>', nuevos.join('\n') + '\n</manifest>');
  agregados = nuevos.length;
}

// Sin esto la app no puede hablarle a un servidor por HTTP simple (el caso de Tailscale
// o de la red de casa). Android bloquea el tráfico en claro desde Android 9 en adelante.
if (!/android:usesCleartextTraffic/.test(xml)) {
  xml = xml.replace(/<application\s/, '<application android:usesCleartextTraffic="true" ');
  console.log('  Habilitado el tráfico HTTP hacia el servidor propio.');
}

fs.writeFileSync(MANIFIESTO, xml);
console.log(`  AndroidManifest listo (${agregados} permiso(s) agregado(s), ${PERMISOS.length - agregados} ya estaban).`);
