// sync.js — Motor de sincronización con el servidor.
//
// Reglas de oro:
//  - Nunca bloquea la interfaz ni tira excepciones hacia afuera: siempre devuelve un
//    objeto con el resultado y avisa por alCambiar().
//  - Sin servidor configurado, no hace absolutamente nada (la app anda igual).
//  - Los binarios (audios e imágenes) viajan aparte, después de los datos.
import { db } from './db.js';

const TANDA = 500;                 // registros por envío
const MAX_BLOB_AUTO = 25 * 1048576; // arriba de esto, el binario se baja recién cuando se abre
const ESPERAS = [5000, 15000, 45000, 120000, 300000];

let _estado = { estado: 'sin-configurar', ultima: null, pendientes: 0, mensaje: '' };
let _suscriptores = [];
let _sincronizando = false;
let _fallos = 0;
let _timerReintento = null;
let _timerDebounce = null;

function avisar(cambios) {
  _estado = { ..._estado, ...cambios };
  for (const fn of _suscriptores) { try { fn(_estado); } catch { /* un suscriptor roto no frena al resto */ } }
}

async function url() { return db._getSettingCrudo('servidor.url', null); }
async function token() { return db._getSettingCrudo('servidor.token', null); }

function normalizarUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

async function pedir(ruta, { metodo = 'GET', cuerpo = null, binario = null, mime = null, base = null, sinToken = false } = {}) {
  const raiz = base || await url();
  if (!raiz) throw new ErrorSync('sin-configurar', 'No hay servidor configurado.');
  const headers = {};
  if (!sinToken) {
    const t = await token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
  }
  let body;
  if (binario) { body = binario; if (mime) headers['X-Mime'] = mime; }
  else if (cuerpo !== null) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(cuerpo); }

  let res;
  try {
    res = await fetch(raiz + ruta, { method: metodo, headers, body });
  } catch {
    // fetch solo falla así cuando no se pudo llegar al servidor.
    throw new ErrorSync('sin-conexion', 'No se pudo llegar al servidor. ¿Está prendido y estás conectado a la red o a Tailscale?');
  }
  if (res.status === 401) throw new ErrorSync('sesion-vencida', 'Tu sesión venció. Volvé a iniciar sesión.');
  const esJson = (res.headers.get('content-type') || '').includes('json');
  const datos = esJson ? await res.json().catch(() => ({})) : res;
  if (!res.ok) throw new ErrorSync('error', (datos && datos.error) || `El servidor respondió ${res.status}.`);
  return datos;
}

class ErrorSync extends Error {
  constructor(tipo, mensaje) { super(mensaje); this.tipo = tipo; }
}

async function guardarSesion(raiz, token, usuario) {
  await db._setSettingCrudo('servidor.url', raiz);
  await db._setSettingCrudo('servidor.token', token);
  await db.usarUsuario(usuario);
}

export const sync = {
  MAX_BLOB_AUTO,

  async configurado() { return !!(await url()) && !!(await token()); },

  estado() { return _estado; },

  alCambiar(fn) {
    _suscriptores.push(fn);
    fn(_estado);
    return () => { _suscriptores = _suscriptores.filter(x => x !== fn); };
  },

  // Prueba la dirección antes de pedir usuario y contraseña.
  async probar(direccion) {
    const raiz = normalizarUrl(direccion);
    if (!raiz) return { ok: false, mensaje: 'Escribí la dirección del servidor.' };
    try {
      const r = await pedir('/api/estado', { base: raiz, sinToken: true });
      if (!r || !r.ok) return { ok: false, mensaje: 'Esa dirección respondió, pero no parece un servidor de Lifetime Game.' };
      return { ok: true, raiz, version: r.version, hayAdmin: r.hayAdmin, requiereInvitacion: r.requiereInvitacion };
    } catch (e) {
      return { ok: false, mensaje: e.message };
    }
  },

  async registrar({ direccion, usuario, contrasena, nombre, codigo }) {
    const raiz = normalizarUrl(direccion);
    try {
      const r = await pedir('/api/registro', {
        base: raiz, sinToken: true, metodo: 'POST',
        cuerpo: { usuario, contrasena, nombre, codigo, dispositivo: navigator.userAgent.slice(0, 80) },
      });
      await guardarSesion(raiz, r.token, r.usuario);
      avisar({ estado: 'ok', mensaje: '' });
      return { ok: true, usuario: r.usuario };
    } catch (e) { return { ok: false, mensaje: e.message }; }
  },

  async login({ direccion, usuario, contrasena }) {
    const raiz = normalizarUrl(direccion);
    try {
      const r = await pedir('/api/login', {
        base: raiz, sinToken: true, metodo: 'POST',
        cuerpo: { usuario, contrasena, dispositivo: navigator.userAgent.slice(0, 80) },
      });
      await guardarSesion(raiz, r.token, r.usuario);
      avisar({ estado: 'ok', mensaje: '' });
      return { ok: true, usuario: r.usuario };
    } catch (e) { return { ok: false, mensaje: e.message }; }
  },

  async logout() {
    try { await pedir('/api/logout', { metodo: 'POST' }); } catch { /* si no hay red, se cierra igual */ }
    await db._delSettingCrudo('servidor.token');
    await db._delSettingCrudo('servidor.ultimaSync');
    await db.usarUsuario(null);
    avisar({ estado: 'sin-configurar', ultima: null, pendientes: 0, mensaje: '' });
  },

  // Llamado por db.js en cada escritura. Agenda una sincronización sin apurarse.
  avisarCambio() {
    clearTimeout(_timerDebounce);
    _timerDebounce = setTimeout(() => { sync.sincronizar(); }, 10000);
  },

  async sincronizar({ forzado = false } = {}) {
    if (_sincronizando) return { ok: false, mensaje: 'Ya hay una sincronización en curso.' };
    if (!(await this.configurado())) return { ok: false, mensaje: 'No hay servidor configurado.' };

    _sincronizando = true;
    clearTimeout(_timerReintento);
    avisar({ estado: 'sincronizando', mensaje: '' });
    try {
      let desde = Number(await db._getSettingCrudo('servidor.ultimaSync', 0)) || 0;
      const pendientes = await db.cambiosDesde(desde);
      let subidos = 0, bajados = 0;

      // Se manda de a tandas para que un lote grande no reviente la memoria ni el límite
      // del servidor. La última respuesta define el nuevo punto de corte.
      const tandas = [];
      for (let i = 0; i < pendientes.length; i += TANDA) tandas.push(pendientes.slice(i, i + TANDA));
      if (!tandas.length) tandas.push([]);

      let ahora = desde;
      for (const tanda of tandas) {
        const r = await pedir('/api/sync', { metodo: 'POST', cuerpo: { desde, cambios: tanda } });
        subidos += tanda.length;
        bajados += await db.aplicarCambios(r.cambios || []);
        ahora = r.ahora;
      }
      await db._setSettingCrudo('servidor.ultimaSync', ahora);

      const blobs = await this._sincronizarBlobs().catch(() => ({ subidos: 0, bajados: 0 }));
      _fallos = 0;
      avisar({ estado: 'ok', ultima: Date.now(), pendientes: 0, mensaje: '' });
      return { ok: true, subidos, bajados, blobs };
    } catch (e) {
      const tipo = e.tipo || 'error';
      _fallos++;
      avisar({ estado: tipo, mensaje: e.message, pendientes: await db.pendientesDeSync().catch(() => 0) });
      // La sesión vencida no se reintenta sola: hace falta que la persona entre de nuevo.
      if (tipo !== 'sesion-vencida') {
        const espera = ESPERAS[Math.min(_fallos - 1, ESPERAS.length - 1)];
        _timerReintento = setTimeout(() => sync.sincronizar(), espera);
      }
      return { ok: false, mensaje: e.message, tipo };
    } finally {
      _sincronizando = false;
    }
  },

  // Sube los binarios que el servidor no tiene y baja los que faltan en este aparato.
  async _sincronizarBlobs() {
    const enServidor = (await pedir('/api/blobs?desde=0')).blobs || [];
    const clave = (b) => `${b.store}|${b.id}|${b.campo}`;
    const mapaServidor = new Map(enServidor.map(b => [clave(b), b]));
    const locales = await db.blobsLocales();
    const mapaLocal = new Map(locales.map(b => [clave(b), b]));
    let subidos = 0, bajados = 0;

    for (const b of locales) {
      if (mapaServidor.has(clave(b))) continue;
      try {
        await pedir(`/api/blob/${encodeURIComponent(b.store)}/${encodeURIComponent(b.id)}/${encodeURIComponent(b.campo)}`,
          { metodo: 'PUT', binario: b.blob, mime: b.blob.type || 'application/octet-stream' });
        subidos++;
      } catch { break; } // si falla uno, se corta y se reintenta en la próxima vuelta
    }

    for (const b of enServidor) {
      if (b.borrado || mapaLocal.has(clave(b))) continue;
      if (b.bytes > MAX_BLOB_AUTO) continue; // los pesados se bajan a pedido
      try {
        const res = await this.bajarBlob(b.store, b.id, b.campo);
        if (res) bajados++;
      } catch { break; }
    }
    return { subidos, bajados };
  },

  // Baja un binario puntual (por ejemplo al abrir un audio que se grabó en otro aparato).
  async bajarBlob(store, id, campo) {
    const raiz = await url(), t = await token();
    if (!raiz || !t) return false;
    const res = await fetch(`${raiz}/api/blob/${encodeURIComponent(store)}/${encodeURIComponent(id)}/${encodeURIComponent(campo)}`,
      { headers: { Authorization: 'Bearer ' + t } });
    if (!res.ok) return false;
    const blob = await res.blob();
    return db.guardarBlob(store, id, campo, blob);
  },

  async admin(ruta, opciones) { return pedir('/api' + ruta, opciones); },

  async cambiarContrasena(actual, nueva) {
    try {
      const r = await pedir('/api/contrasena', { metodo: 'POST', cuerpo: { actual, nueva } });
      if (r.token) await db._setSettingCrudo('servidor.token', r.token);
      return { ok: true };
    } catch (e) { return { ok: false, mensaje: e.message }; }
  },

  // Arranca los disparadores automáticos. Lo llama app.js una sola vez.
  async iniciar() {
    db.registrarAvisoDeCambio(() => sync.avisarCambio());
    if (!(await this.configurado())) { avisar({ estado: 'sin-configurar' }); return; }
    avisar({ pendientes: await db.pendientesDeSync().catch(() => 0) });
    this.sincronizar();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.sincronizar();
    });
    window.addEventListener('online', () => this.sincronizar());
    setInterval(async () => {
      if ((await db.pendientesDeSync().catch(() => 0)) > 0) this.sincronizar();
    }, 5 * 60000);
  },
};
