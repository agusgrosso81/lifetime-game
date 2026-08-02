// base.js — Capa SQLite del servidor. Usa node:sqlite, que viene incluido en Node 22+,
// así el servidor no necesita ninguna dependencia externa: nada de npm install, nada de
// módulos nativos que compilar en la notebook.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const DIR_DATOS = process.env.DATOS || path.join(AQUI, 'datos');
export const DIR_BLOBS = path.join(DIR_DATOS, 'blobs');
const ARCHIVO_DB = path.join(DIR_DATOS, 'lifetime.db');

fs.mkdirSync(DIR_BLOBS, { recursive: true });

const db = new DatabaseSync(ARCHIVO_DB);
// WAL permite leer mientras se escribe y aguanta mucho mejor un corte de luz.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
-- La clave incluye usuario_id a propósito: cada usuario tiene su propio espacio de ids.
-- Si fuera (store, id) global, dos personas que importen el mismo backup tendrían
-- registros con el mismo uuid y el segundo se perdería en silencio.
CREATE TABLE IF NOT EXISTS registros (
  store       TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  usuario_id  TEXT    NOT NULL,
  datos       TEXT    NOT NULL,
  actualizado INTEGER NOT NULL,
  borrado     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usuario_id, store, id)
);
CREATE INDEX IF NOT EXISTS idx_reg_sync ON registros (usuario_id, actualizado);

CREATE TABLE IF NOT EXISTS usuarios (
  id      TEXT PRIMARY KEY,
  usuario TEXT UNIQUE NOT NULL,
  nombre  TEXT,
  hash    TEXT NOT NULL,
  salt    TEXT NOT NULL,
  rol     TEXT NOT NULL DEFAULT 'usuario',
  creado  INTEGER NOT NULL,
  activo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invitaciones (
  codigo     TEXT PRIMARY KEY,
  creado_por TEXT,
  creado     INTEGER NOT NULL,
  expira     INTEGER,
  usado_por  TEXT,
  usado      INTEGER
);

CREATE TABLE IF NOT EXISTS sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL,
  dispositivo TEXT,
  creado      INTEGER NOT NULL,
  expira      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ses_usuario ON sesiones (usuario_id);

CREATE TABLE IF NOT EXISTS blobs (
  usuario_id  TEXT NOT NULL,
  store       TEXT NOT NULL,
  id          TEXT NOT NULL,
  campo       TEXT NOT NULL,
  archivo     TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  mime        TEXT,
  actualizado INTEGER NOT NULL,
  borrado     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usuario_id, store, id, campo)
);
CREATE INDEX IF NOT EXISTS idx_blob_sync ON blobs (usuario_id, actualizado);

CREATE TABLE IF NOT EXISTS intentos_login (
  usuario TEXT NOT NULL,
  cuando  INTEGER NOT NULL
);
`);

export function uuid() {
  return randomBytes(16).toString('hex');
}

// ---------- Usuarios ----------
export const usuarios = {
  cantidad: () => db.prepare('SELECT COUNT(*) c FROM usuarios').get().c,
  porNombre: (usuario) => db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario).toLowerCase()),
  porId: (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id),
  crear: ({ usuario, nombre, hash, salt, rol }) => {
    const u = { id: uuid(), usuario: String(usuario).toLowerCase(), nombre: nombre || usuario, hash, salt, rol, creado: Date.now(), activo: 1 };
    db.prepare('INSERT INTO usuarios (id,usuario,nombre,hash,salt,rol,creado,activo) VALUES (?,?,?,?,?,?,?,1)')
      .run(u.id, u.usuario, u.nombre, u.hash, u.salt, u.rol, u.creado);
    return u;
  },
  listar: () => db.prepare('SELECT id,usuario,nombre,rol,creado,activo FROM usuarios ORDER BY creado').all(),
  actualizar: (id, campos) => {
    const permitidos = ['nombre', 'rol', 'activo', 'hash', 'salt'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(campos)) {
      if (!permitidos.includes(k)) continue;
      sets.push(`${k} = ?`); vals.push(v);
    }
    if (!sets.length) return;
    db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  },
  // Cuenta cuántos registros y blobs tiene, para mostrar en el panel de admin.
  resumen: (id) => ({
    registros: db.prepare('SELECT COUNT(*) c FROM registros WHERE usuario_id = ? AND borrado = 0').get(id).c,
    blobs: db.prepare('SELECT COUNT(*) c, COALESCE(SUM(bytes),0) b FROM blobs WHERE usuario_id = ? AND borrado = 0').get(id),
  }),
};

// ---------- Sesiones ----------
export const sesiones = {
  crear: (usuarioId, dispositivo, dias = 90) => {
    const token = randomBytes(32).toString('hex');
    const ahora = Date.now();
    db.prepare('INSERT INTO sesiones (token,usuario_id,dispositivo,creado,expira) VALUES (?,?,?,?,?)')
      .run(token, usuarioId, dispositivo || null, ahora, ahora + dias * 86400000);
    return token;
  },
  resolver: (token) => {
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sesiones WHERE token = ?').get(token);
    if (!s) return null;
    if (s.expira < Date.now()) { db.prepare('DELETE FROM sesiones WHERE token = ?').run(token); return null; }
    const u = usuarios.porId(s.usuario_id);
    if (!u || !u.activo) return null;
    return u;
  },
  borrar: (token) => db.prepare('DELETE FROM sesiones WHERE token = ?').run(token),
  borrarDeUsuario: (usuarioId) => db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(usuarioId),
  limpiarVencidas: () => db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now()),
};

// ---------- Invitaciones ----------
// Códigos fáciles de dictar en voz alta: sin caracteres ambiguos (0/O, 1/I/L).
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const invitaciones = {
  crear: (creadoPor, diasValidez = 30) => {
    let codigo;
    do {
      const parte = (n) => Array.from(randomBytes(n)).map(b => ALFABETO[b % ALFABETO.length]).join('');
      codigo = `${parte(4)}-${parte(4)}`;
    } while (db.prepare('SELECT 1 FROM invitaciones WHERE codigo = ?').get(codigo));
    const creado = Date.now();
    db.prepare('INSERT INTO invitaciones (codigo,creado_por,creado,expira) VALUES (?,?,?,?)')
      .run(codigo, creadoPor, creado, diasValidez ? creado + diasValidez * 86400000 : null);
    return { codigo, creado, expira: diasValidez ? creado + diasValidez * 86400000 : null };
  },
  buscar: (codigo) => db.prepare('SELECT * FROM invitaciones WHERE codigo = ?').get(String(codigo || '').toUpperCase().trim()),
  usar: (codigo, usuarioId) => db.prepare('UPDATE invitaciones SET usado_por = ?, usado = ? WHERE codigo = ?')
    .run(usuarioId, Date.now(), String(codigo).toUpperCase().trim()),
  listar: () => db.prepare(`
    SELECT i.*, u.usuario AS usado_por_nombre
    FROM invitaciones i LEFT JOIN usuarios u ON u.id = i.usado_por
    ORDER BY i.creado DESC`).all(),
  borrar: (codigo) => db.prepare('DELETE FROM invitaciones WHERE codigo = ? AND usado_por IS NULL').run(codigo),
};

// ---------- Intentos de login (freno a la fuerza bruta) ----------
export const intentos = {
  registrar: (usuario) => db.prepare('INSERT INTO intentos_login (usuario,cuando) VALUES (?,?)').run(String(usuario).toLowerCase(), Date.now()),
  contar: (usuario, ventanaMs = 15 * 60000) =>
    db.prepare('SELECT COUNT(*) c FROM intentos_login WHERE usuario = ? AND cuando > ?')
      .get(String(usuario).toLowerCase(), Date.now() - ventanaMs).c,
  limpiar: (usuario) => db.prepare('DELETE FROM intentos_login WHERE usuario = ?').run(String(usuario).toLowerCase()),
  purgar: () => db.prepare('DELETE FROM intentos_login WHERE cuando < ?').run(Date.now() - 86400000),
};

// ---------- Sincronización ----------
const MAX_FUTURO = 24 * 3600 * 1000; // tolerancia de reloj adelantado

export const registros = {
  // Aplica los cambios que manda un cliente y devuelve cuántos entraron.
  // Todo en una transacción: si algo falla, no queda a medias.
  aplicar: (usuarioId, cambios) => {
    const tope = Date.now() + MAX_FUTURO;
    const leer = db.prepare('SELECT actualizado FROM registros WHERE usuario_id = ? AND store = ? AND id = ?');
    const escribir = db.prepare(`
      INSERT INTO registros (store,id,usuario_id,datos,actualizado,borrado)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(usuario_id,store,id) DO UPDATE SET
        datos = excluded.datos,
        actualizado = excluded.actualizado,
        borrado = excluded.borrado`);
    let aplicados = 0, rechazados = 0;
    db.exec('BEGIN');
    try {
      for (const c of cambios) {
        if (!c || typeof c.store !== 'string' || typeof c.id !== 'string') { rechazados++; continue; }
        // Un reloj adelantado no puede ganar para siempre: se recorta al momento actual.
        const actualizado = Math.min(Number(c.actualizado) || Date.now(), tope);
        const previo = leer.get(usuarioId, c.store, c.id);
        if (previo && previo.actualizado >= actualizado) { rechazados++; continue; }
        escribir.run(c.store, c.id, usuarioId, JSON.stringify(c.datos ?? {}), actualizado, c.borrado ? 1 : 0);
        aplicados++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { aplicados, rechazados };
  },

  // Todo lo que cambió después de 'desde', incluidas las lápidas de borrado.
  desde: (usuarioId, desde, limite = 5000) =>
    db.prepare('SELECT store,id,datos,actualizado,borrado FROM registros WHERE usuario_id = ? AND actualizado > ? ORDER BY actualizado LIMIT ?')
      .all(usuarioId, Number(desde) || 0, limite)
      .map(r => ({ store: r.store, id: r.id, datos: JSON.parse(r.datos), actualizado: r.actualizado, borrado: r.borrado })),

  cantidad: (usuarioId) => db.prepare('SELECT COUNT(*) c FROM registros WHERE usuario_id = ? AND borrado = 0').get(usuarioId).c,
};

// ---------- Blobs ----------
export const blobs = {
  ruta: (usuarioId, store, id, campo) => {
    const limpio = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dir = path.join(DIR_BLOBS, limpio(usuarioId), limpio(store));
    return { dir, archivo: path.join(dir, `${limpio(id)}-${limpio(campo)}`) };
  },
  guardar: (usuarioId, store, id, campo, buffer, mime) => {
    const { dir, archivo } = blobs.ruta(usuarioId, store, id, campo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(archivo, buffer);
    const rel = path.relative(DIR_BLOBS, archivo);
    db.prepare(`
      INSERT INTO blobs (usuario_id,store,id,campo,archivo,bytes,mime,actualizado,borrado)
      VALUES (?,?,?,?,?,?,?,?,0)
      ON CONFLICT(usuario_id,store,id,campo) DO UPDATE SET
        archivo=excluded.archivo, bytes=excluded.bytes, mime=excluded.mime,
        actualizado=excluded.actualizado, borrado=0`)
      .run(usuarioId, store, id, campo, rel, buffer.length, mime || null, Date.now());
    return { bytes: buffer.length };
  },
  leer: (usuarioId, store, id, campo) => {
    const row = db.prepare('SELECT * FROM blobs WHERE usuario_id=? AND store=? AND id=? AND campo=? AND borrado=0')
      .get(usuarioId, store, id, campo);
    if (!row) return null;
    const abs = path.join(DIR_BLOBS, row.archivo);
    if (!fs.existsSync(abs)) return null;
    return { buffer: fs.readFileSync(abs), mime: row.mime, bytes: row.bytes };
  },
  listar: (usuarioId, desde = 0) =>
    db.prepare('SELECT store,id,campo,bytes,mime,actualizado,borrado FROM blobs WHERE usuario_id=? AND actualizado > ? ORDER BY actualizado')
      .all(usuarioId, Number(desde) || 0),
};

// ---------- Backup ----------
export function backup(diasAConservar = 14) {
  const dir = path.join(DIR_DATOS, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const destino = path.join(dir, `lifetime-${fecha}.db`);
  // VACUUM INTO deja una copia consistente aunque el servidor esté atendiendo pedidos.
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  const corte = Date.now() - diasAConservar * 86400000;
  let borrados = 0;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (f.startsWith('lifetime-') && fs.statSync(full).mtimeMs < corte) { fs.unlinkSync(full); borrados++; }
  }
  return { destino, borrados };
}

export function cerrar() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ya cerrada */ }
  try { db.close(); } catch { /* ya cerrada */ }
}

export { ARCHIVO_DB };
