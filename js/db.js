// db.js — Capa de datos: IndexedDB, multiusuario y preparada para sincronizar.
//
// La API pública NO cambió: los módulos siguen llamando get/getAll/getBy/getRango/
// put/putMany/del/clear/count/getSetting/setSetting igual que siempre. Todo lo de
// usuarios y sincronización se resuelve acá adentro.
//
//   await db.put('materias', { nombre: 'Matemática' })   // estampa usuario y fecha
//   await db.getAll('materias')                          // solo del usuario activo
//   await db.del('materias', id)                         // borrado lógico (se sincroniza)
//
// Tres campos se agregan solos a cada registro:
//   usuarioId    dueño del dato ('local' si se usa sin cuenta)
//   actualizado  Date.now() de la última escritura, resuelve conflictos
//   borrado      0 | 1, lápida para que el borrado llegue a los otros dispositivos

// El nombre interno queda como 'organizador' aunque la app pasó a llamarse Lifetime Game:
// cambiarlo crearía una base vacía y los datos ya cargados quedarían inaccesibles.
const DB_NAME = 'organizador';
const DB_VERSION = 2;

export const USUARIO_LOCAL = 'local';

// Claves de settings que son de ESTE aparato y no viajan al servidor.
export const SETTINGS_LOCALES = [
  'tiempo.enCurso',      // cronómetro corriendo acá
  'ubicacion.enCurso',   // recorrido GPS en curso acá
  'servidor.url',
  'servidor.token',
  'servidor.usuario',
  'servidor.ultimaSync',
  'servidor.modoElegido',
];

// Stores que no se sincronizan nunca.
export const STORES_LOCALES = ['musicaCache'];

const STORES = {
  settings:        { keyPath: 'clave', indices: [] },
  materias:        { keyPath: 'id', indices: [] },
  examenes:        { keyPath: 'id', indices: ['materiaId', 'fecha'] },
  calificaciones:  { keyPath: 'id', indices: ['materiaId'] },
  audiosClase:     { keyPath: 'id', indices: ['materiaId'] },
  sesionesEstudio: { keyPath: 'id', indices: ['materiaId', 'fecha'] },
  bloquesHorario:  { keyPath: 'id', indices: ['dia'] },
  registroTiempo:  { keyPath: 'id', indices: ['fecha', 'categoria'] },
  categoriasTiempo:{ keyPath: 'id', indices: [] },
  alimentos:       { keyPath: 'id', indices: ['nombre'] },
  comidas:         { keyPath: 'id', indices: ['fecha'] },
  envases:         { keyPath: 'id', indices: [] },
  agua:            { keyPath: 'id', indices: ['fecha'] },
  notas:           { keyPath: 'id', indices: ['fecha', 'fechaLimite'] },
  alarmas:         { keyPath: 'id', indices: ['fecha'] },
  transacciones:   { keyPath: 'id', indices: ['fecha', 'categoria'] },
  categoriasEco:   { keyPath: 'id', indices: [] },
  metasAhorro:     { keyPath: 'id', indices: [] },
  trayectos:       { keyPath: 'id', indices: ['fecha'] },
  lugares:         { keyPath: 'id', indices: [] },
  musicaRegistro:  { keyPath: 'id', indices: ['playedAt'] },
  musicaCache:     { keyPath: 'clave', indices: [] },
};

// Campos con contenido binario: no viajan en el JSON de sync, van por su propio endpoint.
const CAMPOS_BLOB = { audiosClase: ['blob'], notas: ['audioBlob', 'imagenes'] };

let _dbPromise = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      const tx = e.target.transaction;
      for (const [nombre, def] of Object.entries(STORES)) {
        let store;
        if (!idb.objectStoreNames.contains(nombre)) {
          store = idb.createObjectStore(nombre, { keyPath: def.keyPath });
        } else {
          store = tx.objectStore(nombre);
        }
        for (const idx of def.indices) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, idx);
        }
        if (def.keyPath === 'id' && !store.indexNames.contains('usuarioId')) store.createIndex('usuarioId', 'usuarioId');
        if (def.keyPath === 'id' && !store.indexNames.contains('actualizado')) store.createIndex('actualizado', 'actualizado');
      }
      // Migración v1 → v2: lo que ya estaba cargado pasa a ser del usuario 'local'.
      // Nadie puede perder datos por actualizar la app.
      if (e.oldVersion < 2) {
        const ahora = Date.now();
        for (const [nombre, def] of Object.entries(STORES)) {
          const store = tx.objectStore(nombre);
          if (def.keyPath === 'clave') {
            // settings: la clave pasa a ser 'usuario|clave'
            store.getAll().onsuccess = (ev) => {
              for (const reg of ev.target.result || []) {
                if (String(reg.clave).includes('|')) continue;
                const local = SETTINGS_LOCALES.includes(reg.clave);
                store.delete(reg.clave);
                store.put({ ...reg, clave: local ? reg.clave : `${USUARIO_LOCAL}|${reg.clave}` });
              }
            };
          } else {
            store.getAll().onsuccess = (ev) => {
              for (const reg of ev.target.result || []) {
                if (reg.usuarioId) continue;
                store.put({ ...reg, usuarioId: USUARIO_LOCAL, actualizado: reg.actualizado || ahora, borrado: 0 });
              }
            };
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Hay otra pestaña de la app abierta con una versión distinta. Cerrala y recargá.'));
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return open().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.__result !== undefined ? out.__result : (out ? out.result : undefined));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function uuid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

// ---------- Usuario activo ----------
let _usuario = null;          // { id, usuario, nombre, rol } o null = modo local
let _avisarCambio = null;     // lo engancha sync.js para enterarse de las escrituras

function uid() { return _usuario ? _usuario.id : USUARIO_LOCAL; }

function esVisible(reg) {
  return reg && !reg.borrado && (reg.usuarioId || USUARIO_LOCAL) === uid();
}

function sinBlobs(store, reg) {
  const campos = CAMPOS_BLOB[store];
  if (!campos) return reg;
  const copia = { ...reg };
  for (const c of campos) delete copia[c];
  return copia;
}

function marcarCambio(store) {
  if (STORES_LOCALES.includes(store)) return;
  if (_avisarCambio) { try { _avisarCambio(); } catch { /* sync todavía no listo */ } }
}

export const db = {
  STORES: Object.keys(STORES),
  SETTINGS_LOCALES,
  STORES_LOCALES,
  CAMPOS_BLOB,

  // Promesa que se resuelve cuando la base está lista y el usuario cargado.
  listo: null,

  usuarioActual() { return _usuario; },

  async usarUsuario(u) {
    _usuario = u || null;
    if (u) await this._setSettingCrudo('servidor.usuario', u);
    else await this._delSettingCrudo('servidor.usuario');
  },

  // ---------- Lectura ----------
  async get(store, key) {
    const r = await tx(store, 'readonly', s => s.get(key));
    if (STORES[store].keyPath === 'clave') return r;
    return esVisible(r) ? r : undefined;
  },

  async getAll(store) {
    const todos = await tx(store, 'readonly', s => s.getAll());
    if (STORES[store].keyPath === 'clave') return todos;
    return todos.filter(esVisible);
  },

  async getBy(store, indice, valor) {
    const r = await tx(store, 'readonly', s => s.index(indice).getAll(valor));
    return r.filter(esVisible);
  },

  async getRango(store, indice, desde, hasta) {
    const range = IDBKeyRange.bound(desde, hasta);
    const r = await tx(store, 'readonly', s => s.index(indice).getAll(range));
    return r.filter(esVisible);
  },

  async count(store) {
    return (await this.getAll(store)).length;
  },

  // ---------- Escritura ----------
  async put(store, obj) {
    const def = STORES[store];
    if (def.keyPath === 'id') {
      if (!obj.id) obj.id = uuid();
      obj.usuarioId = obj.usuarioId || uid();
      obj.actualizado = Date.now();
      if (obj.borrado === undefined) obj.borrado = 0;
    }
    await tx(store, 'readwrite', s => s.put(obj));
    marcarCambio(store);
    return obj;
  },

  async putMany(store, objs) {
    const def = STORES[store];
    const ahora = Date.now();
    for (const o of objs) {
      if (def.keyPath !== 'id') continue;
      if (!o.id) o.id = uuid();
      o.usuarioId = o.usuarioId || uid();
      o.actualizado = ahora;
      if (o.borrado === undefined) o.borrado = 0;
    }
    await tx(store, 'readwrite', s => { objs.forEach(o => s.put(o)); return { __result: true }; });
    marcarCambio(store);
    return objs;
  },

  // Borrado LÓGICO: se marca la lápida para que el borrado llegue a los otros
  // dispositivos. Si se borrara de verdad, el otro aparato no tendría cómo enterarse
  // y en la próxima sincronización el registro volvería a aparecer.
  async del(store, key) {
    if (STORES[store].keyPath === 'clave') return tx(store, 'readwrite', s => s.delete(key));
    const reg = await tx(store, 'readonly', s => s.get(key));
    if (!reg) return;
    const lapida = { ...reg, borrado: 1, actualizado: Date.now() };
    // Los binarios se sueltan al borrar: no tiene sentido ocupar espacio con basura.
    for (const c of (CAMPOS_BLOB[store] || [])) delete lapida[c];
    await tx(store, 'readwrite', s => s.put(lapida));
    marcarCambio(store);
  },

  async clear(store) {
    if (STORES[store].keyPath === 'clave') return tx(store, 'readwrite', s => s.clear());
    const mios = await this.getAll(store);
    const ahora = Date.now();
    const lapidas = mios.map(r => {
      const l = { ...r, borrado: 1, actualizado: ahora };
      for (const c of (CAMPOS_BLOB[store] || [])) delete l[c];
      return l;
    });
    await tx(store, 'readwrite', s => { lapidas.forEach(l => s.put(l)); return { __result: true }; });
    marcarCambio(store);
  },

  // Borra de verdad, sin dejar lápidas. Solo para "borrar todos los datos" de Ajustes.
  async vaciarDeVerdad(store) {
    return tx(store, 'readwrite', s => s.clear());
  },

  // ---------- Settings ----------
  // La clave real es 'usuarioId|clave', salvo las de SETTINGS_LOCALES que van sueltas.
  _claveSetting(clave) {
    return SETTINGS_LOCALES.includes(clave) ? clave : `${uid()}|${clave}`;
  },
  async getSetting(clave, porDefecto = null) {
    const r = await tx('settings', 'readonly', s => s.get(this._claveSetting(clave)));
    return r ? r.valor : porDefecto;
  },
  async setSetting(clave, valor) {
    const real = this._claveSetting(clave);
    await tx('settings', 'readwrite', s => s.put({ clave: real, valor, actualizado: Date.now() }));
    if (!SETTINGS_LOCALES.includes(clave)) marcarCambio('settings');
    return valor;
  },
  async _setSettingCrudo(clave, valor) {
    return tx('settings', 'readwrite', s => s.put({ clave, valor, actualizado: Date.now() }));
  },
  async _getSettingCrudo(clave, porDefecto = null) {
    const r = await tx('settings', 'readonly', s => s.get(clave));
    return r ? r.valor : porDefecto;
  },
  async _delSettingCrudo(clave) {
    return tx('settings', 'readwrite', s => s.delete(clave));
  },

  // ---------- Sincronización ----------
  registrarAvisoDeCambio(fn) { _avisarCambio = fn; },

  // Todo lo que cambió después de 'desde', listo para mandar al servidor (sin binarios).
  async cambiosDesde(desde = 0) {
    const salida = [];
    const yo = uid();
    for (const [store, def] of Object.entries(STORES)) {
      if (STORES_LOCALES.includes(store)) continue;
      if (def.keyPath === 'clave') {
        const todos = await tx('settings', 'readonly', s => s.getAll());
        for (const r of todos) {
          const clave = String(r.clave);
          if (!clave.startsWith(yo + '|')) continue;
          if ((r.actualizado || 0) <= desde) continue;
          salida.push({ store: 'settings', id: clave.slice(yo.length + 1), datos: { valor: r.valor }, actualizado: r.actualizado || Date.now(), borrado: 0 });
        }
        continue;
      }
      const todos = await tx(store, 'readonly', s => s.getAll());
      for (const r of todos) {
        if ((r.usuarioId || USUARIO_LOCAL) !== yo) continue;
        if ((r.actualizado || 0) <= desde) continue;
        salida.push({ store, id: r.id, datos: sinBlobs(store, r), actualizado: r.actualizado, borrado: r.borrado ? 1 : 0 });
      }
    }
    return salida;
  },

  // Aplica lo que vino del servidor. Gana el más reciente; lo local nunca se pisa con algo viejo.
  async aplicarCambios(cambios) {
    const yo = uid();
    let aplicados = 0;
    for (const c of cambios) {
      if (!c || !c.store || !STORES[c.store]) continue;
      if (c.store === 'settings') {
        const claveReal = `${yo}|${c.id}`;
        const previo = await tx('settings', 'readonly', s => s.get(claveReal));
        if (previo && (previo.actualizado || 0) >= c.actualizado) continue;
        await tx('settings', 'readwrite', s => s.put({ clave: claveReal, valor: c.datos.valor, actualizado: c.actualizado }));
        aplicados++;
        continue;
      }
      const previo = await tx(c.store, 'readonly', s => s.get(c.id));
      if (previo && (previo.actualizado || 0) >= c.actualizado) continue;
      // Los binarios que ya estén en este aparato se conservan: el servidor no los manda.
      const nuevo = { ...(previo || {}), ...c.datos, id: c.id, usuarioId: yo, actualizado: c.actualizado, borrado: c.borrado ? 1 : 0 };
      if (nuevo.borrado) for (const campo of (CAMPOS_BLOB[c.store] || [])) delete nuevo[campo];
      await tx(c.store, 'readwrite', s => s.put(nuevo));
      aplicados++;
    }
    return aplicados;
  },

  async pendientesDeSync() {
    const desde = Number(await this._getSettingCrudo('servidor.ultimaSync', 0)) || 0;
    return (await this.cambiosDesde(desde)).length;
  },

  // Registros del usuario activo que tienen un binario guardado en este aparato.
  async blobsLocales() {
    const salida = [];
    for (const [store, campos] of Object.entries(CAMPOS_BLOB)) {
      for (const r of await this.getAll(store)) {
        for (const campo of campos) {
          const v = r[campo];
          if (!v) continue;
          if (Array.isArray(v)) v.forEach((b, i) => { if (b) salida.push({ store, id: r.id, campo: `${campo}.${i}`, blob: b, actualizado: r.actualizado }); });
          else salida.push({ store, id: r.id, campo, blob: v, actualizado: r.actualizado });
        }
      }
    }
    return salida;
  },

  async guardarBlob(store, id, campo, blob) {
    const reg = await tx(store, 'readonly', s => s.get(id));
    if (!reg) return false;
    const m = /^(.+)\.(\d+)$/.exec(campo);
    if (m) {
      const arr = Array.isArray(reg[m[1]]) ? [...reg[m[1]]] : [];
      arr[Number(m[2])] = blob;
      reg[m[1]] = arr;
    } else {
      reg[campo] = blob;
    }
    // No se toca 'actualizado': bajar un binario no es un cambio del usuario y no debe
    // reenviarse al servidor como si lo fuera.
    await tx(store, 'readwrite', s => s.put(reg));
    return true;
  },

  // Pasa a la cuenta indicada todo lo que estaba guardado en modo local. Se usa cuando
  // alguien que venía usando la app sin cuenta inicia sesión y quiere llevarse sus datos.
  async adoptarLocales(usuarioId) {
    let movidos = 0;
    const ahora = Date.now();
    for (const [store, def] of Object.entries(STORES)) {
      if (STORES_LOCALES.includes(store)) continue;
      if (def.keyPath === 'clave') {
        const todos = await tx('settings', 'readonly', s => s.getAll());
        for (const r of todos) {
          const clave = String(r.clave);
          if (!clave.startsWith(USUARIO_LOCAL + '|')) continue;
          const nueva = `${usuarioId}|${clave.slice(USUARIO_LOCAL.length + 1)}`;
          await tx('settings', 'readwrite', s => { s.delete(clave); s.put({ clave: nueva, valor: r.valor, actualizado: ahora }); return { __result: 1 }; });
          movidos++;
        }
        continue;
      }
      const todos = await tx(store, 'readonly', s => s.getAll());
      const mover = todos.filter(r => (r.usuarioId || USUARIO_LOCAL) === USUARIO_LOCAL);
      if (!mover.length) continue;
      await tx(store, 'readwrite', s => {
        mover.forEach(r => s.put({ ...r, usuarioId, actualizado: ahora }));
        return { __result: true };
      });
      movidos += mover.length;
    }
    return movidos;
  },

  async hayDatosLocales() {
    for (const [store, def] of Object.entries(STORES)) {
      if (def.keyPath === 'clave' || STORES_LOCALES.includes(store)) continue;
      const todos = await tx(store, 'readonly', s => s.getAll());
      if (todos.some(r => (r.usuarioId || USUARIO_LOCAL) === USUARIO_LOCAL && !r.borrado)) return true;
    }
    return false;
  },

  // ---------- Export / import ----------
  async exportarJSON(incluirBlobs = false) {
    const data = { _version: DB_VERSION, _fecha: new Date().toISOString(), _usuario: _usuario ? _usuario.usuario : 'local' };
    for (const store of Object.keys(STORES)) {
      if (STORES[store].keyPath === 'clave') {
        if (store !== 'settings') { data[store] = []; continue; }
        const yo = uid();
        const todos = await tx('settings', 'readonly', s => s.getAll());
        data.settings = todos
          .filter(r => String(r.clave).startsWith(yo + '|'))
          .map(r => ({ clave: String(r.clave).slice(yo.length + 1), valor: r.valor }));
        continue;
      }
      let regs = await this.getAll(store);
      if (!incluirBlobs) regs = regs.map(r => sinBlobs(store, r));
      data[store] = regs;
    }
    return data;
  },

  async importarJSON(data, reemplazar = false) {
    for (const store of Object.keys(STORES)) {
      if (!Array.isArray(data[store])) continue;
      if (store === 'settings') {
        if (reemplazar) { /* las settings se pisan una por una */ }
        for (const s of data[store]) if (s && s.clave) await this.setSetting(s.clave, s.valor);
        continue;
      }
      if (reemplazar) await this.clear(store);
      for (const reg of data[store]) {
        // Ids nuevos al importar en otra cuenta evitarían choques, pero perderíamos las
        // relaciones entre registros (materiaId, categoria, etc.). Se conservan los ids:
        // el servidor le da a cada usuario su propio espacio, así que no hay conflicto.
        const copia = { ...reg, usuarioId: uid(), actualizado: Date.now(), borrado: 0 };
        await this.put(store, copia);
      }
    }
  },
};

// Al arrancar, recuperar el usuario que quedó guardado en este dispositivo.
db.listo = (async () => {
  try {
    await open();
    const guardado = await db._getSettingCrudo('servidor.usuario', null);
    if (guardado && guardado.id) _usuario = guardado;
  } catch (e) {
    console.error('No se pudo abrir la base:', e);
  }
  return true;
})();
