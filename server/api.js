// api.js — Endpoints. Todo lo que entra se valida; el usuario sale SIEMPRE del token,
// nunca del cuerpo del pedido, así un cliente no puede escribir en la cuenta de otro.
import { usuarios, sesiones, invitaciones, registros, blobs } from './base.js';
import { registrar, login, cambiarContrasena, usuarioDelPedido, tokenDelPedido, publico, ErrorHttp } from './auth.js';

export const VERSION = '1.0.0';
const MAX_JSON = 25 * 1024 * 1024;   // los lotes de sync pueden ser grandes
const MAX_BLOB = 100 * 1024 * 1024;

function leerCuerpo(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new ErrorHttp(413, `El contenido supera el máximo permitido (${Math.round(maxBytes / 1048576)} MB).`));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function leerJSON(req) {
  const buf = await leerCuerpo(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw new ErrorHttp(400, 'El cuerpo del pedido no es JSON válido.'); }
}

function exigirUsuario(req) {
  const u = usuarioDelPedido(req);
  if (!u) throw new ErrorHttp(401, 'Necesitás iniciar sesión.');
  return u;
}

function exigirAdmin(req) {
  const u = exigirUsuario(req);
  if (u.rol !== 'admin') throw new ErrorHttp(403, 'Esta acción es solo para el administrador del servidor.');
  return u;
}

// Devuelve null si la ruta no es de la API (para que el servidor sirva un archivo).
export async function manejar(req, res, url, responder) {
  const ruta = url.pathname;
  if (!ruta.startsWith('/api/')) return false;
  const metodo = req.method;

  // ---------- Públicos ----------
  if (ruta === '/api/estado' && metodo === 'GET') {
    return responder(200, {
      ok: true,
      version: VERSION,
      app: 'Lifetime Game',
      hayAdmin: usuarios.cantidad() > 0,
      requiereInvitacion: usuarios.cantidad() > 0,
      ahora: Date.now(),
    });
  }

  if (ruta === '/api/registro' && metodo === 'POST') {
    const body = await leerJSON(req);
    const u = registrar(body);
    const token = sesiones.crear(u.id, body.dispositivo);
    return responder(201, { token, usuario: publico(u) });
  }

  if (ruta === '/api/login' && metodo === 'POST') {
    const body = await leerJSON(req);
    const { usuario, token } = login(body);
    return responder(200, { token, usuario: publico(usuario) });
  }

  // ---------- Con sesión ----------
  if (ruta === '/api/yo' && metodo === 'GET') {
    const u = exigirUsuario(req);
    return responder(200, { usuario: publico(u), resumen: usuarios.resumen(u.id) });
  }

  if (ruta === '/api/logout' && metodo === 'POST') {
    const t = tokenDelPedido(req);
    if (t) sesiones.borrar(t);
    return responder(200, { ok: true });
  }

  if (ruta === '/api/contrasena' && metodo === 'POST') {
    const u = exigirUsuario(req);
    const { actual, nueva } = await leerJSON(req);
    const token = cambiarContrasena(u.id, actual, nueva);
    return responder(200, { ok: true, token });
  }

  if (ruta === '/api/sync' && metodo === 'POST') {
    const u = exigirUsuario(req);
    const body = await leerJSON(req);
    const cambios = Array.isArray(body.cambios) ? body.cambios : [];
    if (cambios.length > 5000) throw new ErrorHttp(413, 'Demasiados cambios en un solo envío. Mandalos de a tandas.');
    const resultado = registros.aplicar(u.id, cambios);
    const desde = Number(body.desde) || 0;
    // 'ahora' se calcula DESPUÉS de aplicar, para no dejar afuera nada escrito recién.
    const salientes = registros.desde(u.id, desde);
    return responder(200, {
      ahora: Date.now(),
      cambios: salientes,
      aplicados: resultado.aplicados,
      rechazados: resultado.rechazados,
      hayMas: salientes.length >= 5000,
    });
  }

  if (ruta === '/api/blobs' && metodo === 'GET') {
    const u = exigirUsuario(req);
    return responder(200, { blobs: blobs.listar(u.id, url.searchParams.get('desde') || 0) });
  }

  const mBlob = /^\/api\/blob\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(ruta);
  if (mBlob) {
    const u = exigirUsuario(req);
    const [, store, id, campo] = mBlob.map(decodeURIComponent);
    if (metodo === 'PUT') {
      const buf = await leerCuerpo(req, MAX_BLOB);
      if (!buf.length) throw new ErrorHttp(400, 'El archivo llegó vacío.');
      const r = blobs.guardar(u.id, store, id, campo, buf, req.headers['x-mime'] || 'application/octet-stream');
      return responder(200, { ok: true, bytes: r.bytes });
    }
    if (metodo === 'GET') {
      const b = blobs.leer(u.id, store, id, campo);
      if (!b) throw new ErrorHttp(404, 'Ese archivo no está en el servidor.');
      res.writeHead(200, {
        'Content-Type': b.mime || 'application/octet-stream',
        'Content-Length': b.buffer.length,
        'Cache-Control': 'private, max-age=31536000',
      });
      res.end(b.buffer);
      return true;
    }
  }

  // ---------- Admin ----------
  if (ruta === '/api/invitaciones' && metodo === 'POST') {
    const u = exigirAdmin(req);
    const body = await leerJSON(req).catch(() => ({}));
    return responder(201, invitaciones.crear(u.id, body.dias === null ? null : (Number(body.dias) || 30)));
  }

  if (ruta === '/api/invitaciones' && metodo === 'GET') {
    exigirAdmin(req);
    return responder(200, { invitaciones: invitaciones.listar() });
  }

  const mInv = /^\/api\/invitaciones\/([^/]+)$/.exec(ruta);
  if (mInv && metodo === 'DELETE') {
    exigirAdmin(req);
    invitaciones.borrar(decodeURIComponent(mInv[1]).toUpperCase());
    return responder(200, { ok: true });
  }

  if (ruta === '/api/usuarios' && metodo === 'GET') {
    exigirAdmin(req);
    const lista = usuarios.listar().map(u => ({ ...u, resumen: usuarios.resumen(u.id) }));
    return responder(200, { usuarios: lista });
  }

  const mUsr = /^\/api\/usuarios\/([^/]+)$/.exec(ruta);
  if (mUsr && metodo === 'PATCH') {
    const admin = exigirAdmin(req);
    const id = decodeURIComponent(mUsr[1]);
    const body = await leerJSON(req);
    // Que el admin no pueda dejarse afuera de su propio servidor.
    if (id === admin.id && (body.activo === 0 || body.activo === false || body.rol === 'usuario')) {
      throw new ErrorHttp(400, 'No podés desactivarte ni sacarte el rol de admin a vos mismo.');
    }
    const campos = {};
    if (body.activo !== undefined) campos.activo = body.activo ? 1 : 0;
    if (body.rol === 'admin' || body.rol === 'usuario') campos.rol = body.rol;
    if (typeof body.nombre === 'string') campos.nombre = body.nombre.slice(0, 60);
    usuarios.actualizar(id, campos);
    if (campos.activo === 0) sesiones.borrarDeUsuario(id);
    return responder(200, { ok: true });
  }

  throw new ErrorHttp(404, 'Ese endpoint no existe.');
}
