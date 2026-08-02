// auth.js — Registro, login, sesiones e invitaciones.
// Contraseñas con scrypt de node:crypto: salt aleatorio por usuario y comparación en
// tiempo constante. Nunca se guarda ni se devuelve la contraseña en claro.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { usuarios, sesiones, invitaciones, intentos } from './base.js';

const SCRYPT = { N: 16384, r: 8, p: 1, largo: 64 };
const MAX_INTENTOS = 10;
const VENTANA_MS = 15 * 60000;

function hashear(contrasena, salt) {
  return scryptSync(contrasena, salt, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
}

function contrasenaValida(usuario, contrasena) {
  const esperado = Buffer.from(usuario.hash, 'hex');
  const recibido = Buffer.from(hashear(contrasena, usuario.salt), 'hex');
  if (esperado.length !== recibido.length) return false;
  return timingSafeEqual(esperado, recibido);
}

export function publico(u) {
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, creado: u.creado };
}

export class ErrorHttp extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

function validarUsuario(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  if (u.length < 3) throw new ErrorHttp(400, 'El nombre de usuario necesita al menos 3 caracteres.');
  if (u.length > 30) throw new ErrorHttp(400, 'El nombre de usuario no puede pasar de 30 caracteres.');
  if (!/^[a-z0-9._-]+$/.test(u)) throw new ErrorHttp(400, 'El usuario solo puede tener letras, números, punto, guion y guion bajo (sin espacios ni acentos).');
  return u;
}

function validarContrasena(c) {
  const s = String(c || '');
  if (s.length < 8) throw new ErrorHttp(400, 'La contraseña necesita al menos 8 caracteres.');
  if (s.length > 200) throw new ErrorHttp(400, 'Esa contraseña es demasiado larga.');
  return s;
}

// El primer usuario del servidor queda como admin y no necesita invitación:
// es la única forma de arrancar un servidor recién instalado.
export function registrar({ usuario, contrasena, nombre, codigo }) {
  const nom = validarUsuario(usuario);
  const pass = validarContrasena(contrasena);
  if (usuarios.porNombre(nom)) throw new ErrorHttp(409, 'Ese nombre de usuario ya está ocupado. Probá con otro.');

  const primero = usuarios.cantidad() === 0;
  let invitacion = null;
  if (!primero) {
    if (!codigo) throw new ErrorHttp(403, 'Para crear una cuenta necesitás un código de invitación. Pedíselo a quien administra el servidor.');
    invitacion = invitaciones.buscar(codigo);
    if (!invitacion) throw new ErrorHttp(403, 'Ese código de invitación no existe. Revisá que esté bien escrito.');
    if (invitacion.usado_por) throw new ErrorHttp(403, 'Ese código ya fue usado. Pedí uno nuevo.');
    if (invitacion.expira && invitacion.expira < Date.now()) throw new ErrorHttp(403, 'Ese código venció. Pedí uno nuevo.');
  }

  const salt = randomBytes(16).toString('hex');
  const u = usuarios.crear({ usuario: nom, nombre: String(nombre || nom).slice(0, 60), hash: hashear(pass, salt), salt, rol: primero ? 'admin' : 'usuario' });
  if (invitacion) invitaciones.usar(invitacion.codigo, u.id);
  return u;
}

export function login({ usuario, contrasena, dispositivo }) {
  const nom = String(usuario || '').trim().toLowerCase();
  if (!nom || !contrasena) throw new ErrorHttp(400, 'Faltan el usuario o la contraseña.');

  if (intentos.contar(nom, VENTANA_MS) >= MAX_INTENTOS) {
    throw new ErrorHttp(429, 'Demasiados intentos fallidos. Esperá 15 minutos y probá de nuevo.');
  }
  const u = usuarios.porNombre(nom);
  // Mismo mensaje para usuario inexistente y contraseña incorrecta: no le regalamos a
  // nadie la información de qué usuarios existen en el servidor.
  if (!u || !contrasenaValida(u, contrasena)) {
    intentos.registrar(nom);
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos.');
  }
  if (!u.activo) throw new ErrorHttp(403, 'Esta cuenta está desactivada. Hablá con quien administra el servidor.');
  intentos.limpiar(nom);
  return { usuario: u, token: sesiones.crear(u.id, dispositivo) };
}

export function cambiarContrasena(usuarioId, actual, nueva) {
  const u = usuarios.porId(usuarioId);
  if (!u) throw new ErrorHttp(404, 'No encontramos tu usuario.');
  if (!contrasenaValida(u, String(actual || ''))) throw new ErrorHttp(401, 'La contraseña actual no es correcta.');
  const pass = validarContrasena(nueva);
  const salt = randomBytes(16).toString('hex');
  usuarios.actualizar(usuarioId, { hash: hashear(pass, salt), salt });
  // Al cambiar la contraseña se cierran las sesiones abiertas en otros dispositivos.
  sesiones.borrarDeUsuario(usuarioId);
  return sesiones.crear(usuarioId, 'después de cambiar contraseña');
}

export function usuarioDelPedido(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  return sesiones.resolver(m[1]);
}

export function tokenDelPedido(req) {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers['authorization'] || '').trim());
  return m ? m[1] : null;
}
