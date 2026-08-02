// servidor.js — Punto de entrada. Sirve la API y también los archivos de la app,
// para poder usarla desde el navegador de cualquier dispositivo de la red o de Tailscale.
//
//   node servidor.js            arranca el servidor
//   node servidor.js --backup   hace una copia de la base y sale
//
// Variables de entorno: PORT (8770), HOST (0.0.0.0), DATOS (carpeta de la base).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { manejar, VERSION } from './api.js';
import { ErrorHttp } from './auth.js';
import { usuarios, sesiones, intentos, backup, cerrar, ARCHIVO_DB, DIR_DATOS } from './base.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = path.join(AQUI, '..');
const PUERTO = Number(process.env.PORT) || 8770;
const HOST = process.env.HOST || '0.0.0.0';

// node:sqlite existe recién desde Node 22. Sin esto el error sería críptico.
const mayor = Number(process.versions.node.split('.')[0]);
if (mayor < 22) {
  console.error(`\n  Este servidor necesita Node 22 o superior (tenés ${process.versions.node}).`);
  console.error('  La base de datos usa node:sqlite, que no existe en versiones anteriores.');
  console.error('  Instalá la versión LTS desde https://nodejs.org y volvé a intentar.\n');
  process.exit(1);
}

if (process.argv.includes('--backup')) {
  const r = backup();
  console.log(`Copia guardada en: ${r.destino}`);
  if (r.borrados) console.log(`Se borraron ${r.borrados} copias viejas.`);
  cerrar();
  process.exit(0);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.webm': 'audio/webm', '.mp4': 'video/mp4',
};

function servirArchivo(res, rutaPedida) {
  // Normalizar y verificar que no se escape de la carpeta de la app (path traversal).
  const limpio = decodeURIComponent(rutaPedida.split('?')[0]);
  const destino = path.normalize(path.join(RAIZ_APP, limpio === '/' ? 'index.html' : limpio));
  if (!destino.startsWith(RAIZ_APP)) { res.writeHead(403).end('Prohibido'); return true; }
  if (!fs.existsSync(destino) || fs.statSync(destino).isDirectory()) return false;
  const ext = path.extname(destino).toLowerCase();
  const cuerpo = fs.readFileSync(destino);
  res.writeHead(200, {
    'Content-Type': TIPOS[ext] || 'application/octet-stream',
    'Content-Length': cuerpo.length,
    // El service worker de la app ya maneja su propio cache; que el navegador revalide.
    'Cache-Control': 'no-cache',
  });
  res.end(cuerpo);
  return true;
}

const servidor = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let codigo = 200;

  // CORS: el APK y otros orígenes tienen que poder hablarle al servidor.
  const origen = req.headers.origin;
  if (origen) res.setHeader('Access-Control-Allow-Origin', origen);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Mime');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');

  const responder = (cod, obj) => {
    codigo = cod;
    const cuerpo = Buffer.from(JSON.stringify(obj));
    res.writeHead(cod, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': cuerpo.length });
    res.end(cuerpo);
    return true;
  };

  try {
    if (req.method === 'OPTIONS') { codigo = 204; res.writeHead(204).end(); return; }
    const atendido = await manejar(req, res, url, responder);
    if (!atendido) {
      if (!servirArchivo(res, url.pathname)) {
        codigo = 404;
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      }
    }
  } catch (e) {
    if (e instanceof ErrorHttp) {
      if (!res.headersSent) responder(e.codigo, { error: e.message });
      else codigo = e.codigo;
    } else {
      console.error('Error no previsto:', e);
      codigo = 500;
      if (!res.headersSent) responder(500, { error: 'Error interno del servidor. Mirá los logs para más detalle.' });
    }
  } finally {
    const usuario = (req.headers['authorization'] ? '·' : '');
    const hora = new Date().toLocaleTimeString('es-AR', { hour12: false });
    console.log(`${hora} ${String(req.method).padEnd(6)} ${url.pathname.padEnd(28)} ${codigo} ${String(Date.now() - t0).padStart(4)}ms ${usuario}`);
  }
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PUERTO} ya está ocupado por otro programa.`);
    console.error(`  Cerrá ese programa, o arrancá este servidor en otro puerto:`);
    console.error(`      PORT=8771 node servidor.js\n`);
    process.exit(1);
  }
  console.error('Error del servidor:', e);
  process.exit(1);
});

function direcciones() {
  const salida = [];
  for (const [nombre, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const esTailscale = i.address.startsWith('100.') || /tailscale/i.test(nombre);
      salida.push({ nombre, ip: i.address, esTailscale });
    }
  }
  // Tailscale primero: es la dirección que va a usar el celular desde afuera de casa.
  return salida.sort((a, b) => Number(b.esTailscale) - Number(a.esTailscale));
}

servidor.listen(PUERTO, HOST, () => {
  const n = usuarios.cantidad();
  console.log('');
  console.log(`  Lifetime Game — servidor ${VERSION}`);
  console.log(`  Node ${process.versions.node}`);
  console.log(`  Base de datos: ${ARCHIVO_DB}`);
  console.log('');
  console.log('  Escuchando en:');
  console.log(`    http://127.0.0.1:${PUERTO}        (esta misma máquina)`);
  for (const d of direcciones()) {
    const etiqueta = d.esTailscale ? '  ← usá esta desde el celular (Tailscale)' : `  (${d.nombre})`;
    console.log(`    http://${d.ip}:${PUERTO}${' '.repeat(Math.max(0, 12 - d.ip.length))}${etiqueta}`);
  }
  console.log('');
  if (n === 0) {
    console.log('  ┌─────────────────────────────────────────────────────────────┐');
    console.log('  │  Todavía no hay ningún usuario.                             │');
    console.log('  │  El PRIMERO que se registre queda como administrador y no   │');
    console.log('  │  necesita código de invitación. Registrate desde la app,    │');
    console.log('  │  en Cuenta → Conectarme a un servidor → Crear cuenta.       │');
    console.log('  └─────────────────────────────────────────────────────────────┘');
  } else {
    console.log(`  ${n} usuario(s) registrado(s). Para sumar a alguien, generá una invitación desde la app.`);
  }
  console.log('');
  console.log('  Para cortar: Ctrl+C');
  console.log('');
});

// Mantenimiento liviano cada 6 horas: sesiones vencidas e intentos de login viejos.
setInterval(() => { sesiones.limpiarVencidas(); intentos.purgar(); }, 6 * 3600 * 1000).unref();

// Apagado prolijo: cerrar la base para no dejar el WAL a medias.
let cerrando = false;
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    if (cerrando) return;
    cerrando = true;
    console.log('\n  Cerrando…');
    servidor.close(() => { cerrar(); console.log('  Listo, base cerrada.\n'); process.exit(0); });
    setTimeout(() => { cerrar(); process.exit(0); }, 3000).unref();
  });
}

export { servidor, DIR_DATOS };
