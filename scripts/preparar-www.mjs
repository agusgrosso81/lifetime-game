// preparar-www.mjs — Arma la carpeta www/ que empaqueta Capacitor dentro del APK.
//
// Por qué existe: Capacitor espera una carpeta que contenga SOLO el contenido web
// (como el dist/ de un proyecto con build). Acá el index.html vive en la raíz, mezclado
// con el servidor, la documentación y la configuración. En vez de reordenar todo el
// repositorio, se copia lo que corresponde a www/, que está ignorada por git.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'www');

// Lo que va adentro del APK. El servidor, docs, scripts y .github quedan afuera a propósito.
const INCLUIR = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'vendor'];

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

let archivos = 0;
function copiar(origen, destino) {
  const st = fs.statSync(origen);
  if (st.isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const f of fs.readdirSync(origen)) copiar(path.join(origen, f), path.join(destino, f));
  } else {
    fs.copyFileSync(origen, destino);
    archivos++;
  }
}

for (const item of INCLUIR) {
  const origen = path.join(RAIZ, item);
  if (!fs.existsSync(origen)) {
    console.error(`  Falta ${item}: no se puede armar el APK sin eso.`);
    process.exit(1);
  }
  copiar(origen, path.join(DESTINO, item));
}

console.log(`  www/ armada con ${archivos} archivos.`);
