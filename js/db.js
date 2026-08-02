// db.js — Capa de datos: wrapper de IndexedDB.
// Todos los módulos guardan y leen datos EXCLUSIVAMENTE a través de este objeto.
// Uso:  import { db } from '../db.js';
//   await db.put('materias', { nombre: 'Matemática', ... })  // genera id si falta, devuelve el registro
//   await db.get('materias', id)
//   await db.getAll('materias')                              // array completo
//   await db.getBy('examenes', 'materiaId', id)              // por índice
//   await db.del('materias', id)
//   await db.clear('materias')
//   await db.setSetting('clave', valor) / db.getSetting('clave', porDefecto)

// El nombre interno queda como 'organizador' aunque la app pasó a llamarse Lifetime Game:
// cambiarlo crearía una base vacía y los datos ya cargados quedarían inaccesibles.
const DB_NAME = 'organizador';
const DB_VERSION = 1;

// Definición central de stores. keyPath siempre 'id' (string uuid) salvo settings.
// indices: [nombreCampo, ...]
const STORES = {
  settings:        { keyPath: 'clave', indices: [] },
  // ---- Estudio ----
  materias:        { keyPath: 'id', indices: [] },                       // {id,nombre,tipo:'teorica'|'practica'|'mixta',color,profesor,dias,notas}
  examenes:        { keyPath: 'id', indices: ['materiaId', 'fecha'] },   // {id,materiaId,fecha,tema,tipo,estado:'pendiente'|'rendido',nota}
  calificaciones:  { keyPath: 'id', indices: ['materiaId'] },            // {id,materiaId,fecha,descripcion,nota,peso}
  audiosClase:     { keyPath: 'id', indices: ['materiaId'] },            // {id,materiaId,fecha,titulo,blob,duracion,mime}
  sesionesEstudio: { keyPath: 'id', indices: ['materiaId', 'fecha'] },   // {id,materiaId,fecha,inicio,fin,metodo,minutos,notas}
  // ---- Tiempo / agenda ----
  bloquesHorario:  { keyPath: 'id', indices: ['dia'] },                  // plantilla semanal {id,dia:0-6,horaInicio,'HH:MM',horaFin,categoria,titulo,color}
  registroTiempo:  { keyPath: 'id', indices: ['fecha', 'categoria'] },   // real {id,fecha:'YYYY-MM-DD',categoria,inicio,fin,minutos,notas}
  categoriasTiempo:{ keyPath: 'id', indices: [] },                       // {id,nombre,color,icono,objetivoMinDia}
  // ---- Dieta ----
  alimentos:       { keyPath: 'id', indices: ['nombre'] },               // {id,nombre,porcion,unidad,kcal,prot,carb,grasa,fibra}
  comidas:         { keyPath: 'id', indices: ['fecha'] },                // {id,fecha,tipo,hora,items:[{nombre,cantidad,kcal,prot,carb,grasa}]}
  envases:         { keyPath: 'id', indices: [] },                       // {id,nombre,ml,icono}
  agua:            { keyPath: 'id', indices: ['fecha'] },                // {id,fecha,hora,ml,envaseId}
  // ---- Notas ----
  notas:           { keyPath: 'id', indices: ['fecha', 'fechaLimite'] }, // {id,titulo,tipo:'texto'|'audio'|'checklist',contenido,items:[{texto,hecho}],audioBlob,mime,imagenes:[blob],fecha,fechaLimite,alarma,etiquetas:[],fijada,lugarId,creada,modificada}
  // ---- Alarmas (globales, usadas por varios módulos) ----
  alarmas:         { keyPath: 'id', indices: ['fecha'] },                // {id,fecha:'YYYY-MM-DDTHH:MM',mensaje,refTipo,refId,disparada:bool,repetir:null|'diaria'|'semanal'}
  // ---- Economía ----
  transacciones:   { keyPath: 'id', indices: ['fecha', 'categoria'] },   // {id,fecha,tipo:'gasto'|'ingreso',monto,categoria,descripcion,metodo}
  categoriasEco:   { keyPath: 'id', indices: [] },                       // {id,nombre,tipo,color,icono,presupuestoMensual}
  metasAhorro:     { keyPath: 'id', indices: [] },                       // {id,nombre,objetivo,ahorrado,fechaLimite,notas}
  // ---- Ubicación ----
  trayectos:       { keyPath: 'id', indices: ['fecha'] },                // {id,fecha,inicio,fin,puntos:[{lat,lng,t,vel,acc}],modo,distanciaM,velMediaKmh,duracionMin,notas}
  lugares:         { keyPath: 'id', indices: [] },                       // {id,nombre,lat,lng,notas,color,visitas:[{fecha,hora}]}
  // ---- Música ----
  musicaRegistro:  { keyPath: 'id', indices: ['playedAt'] },             // {id,trackId,nombre,artista,album,imagen,durMs,playedAt,trayectoId}
  musicaCache:     { keyPath: 'clave', indices: [] },                    // cache de tokens/stats spotify {clave,valor}
};

let _dbPromise = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      for (const [nombre, def] of Object.entries(STORES)) {
        let store;
        if (!idb.objectStoreNames.contains(nombre)) {
          store = idb.createObjectStore(nombre, { keyPath: def.keyPath });
        } else {
          store = e.target.transaction.objectStore(nombre);
        }
        for (const idx of def.indices) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, idx);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return open().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out.__result !== undefined ? out.__result : out.result);
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

export const db = {
  STORES: Object.keys(STORES),

  async get(store, key) {
    return tx(store, 'readonly', s => s.get(key));
  },

  async getAll(store) {
    return tx(store, 'readonly', s => s.getAll());
  },

  // Todos los registros cuyo índice === valor
  async getBy(store, indice, valor) {
    return tx(store, 'readonly', s => s.index(indice).getAll(valor));
  },

  // Registros con índice dentro de [desde, hasta] (strings ISO funcionan bien)
  async getRango(store, indice, desde, hasta) {
    const range = IDBKeyRange.bound(desde, hasta);
    return tx(store, 'readonly', s => s.index(indice).getAll(range));
  },

  // Inserta o actualiza. Genera id si falta. Devuelve el registro guardado.
  async put(store, obj) {
    const def = STORES[store];
    if (def.keyPath === 'id' && !obj.id) obj.id = uuid();
    await tx(store, 'readwrite', s => s.put(obj));
    return obj;
  },

  async putMany(store, objs) {
    const def = STORES[store];
    for (const o of objs) if (def.keyPath === 'id' && !o.id) o.id = uuid();
    await tx(store, 'readwrite', s => { objs.forEach(o => s.put(o)); return { __result: true }; });
    return objs;
  },

  async del(store, key) {
    return tx(store, 'readwrite', s => s.delete(key));
  },

  async clear(store) {
    return tx(store, 'readwrite', s => s.clear());
  },

  async count(store) {
    return tx(store, 'readonly', s => s.count());
  },

  // ---- Settings (clave/valor) ----
  async getSetting(clave, porDefecto = null) {
    const r = await this.get('settings', clave);
    return r ? r.valor : porDefecto;
  },
  async setSetting(clave, valor) {
    await tx('settings', 'readwrite', s => s.put({ clave, valor }));
    return valor;
  },

  // ---- Export / import global (sin blobs: los audios/imágenes se exportan aparte) ----
  async exportarJSON(incluirBlobs = false) {
    const data = { _version: DB_VERSION, _fecha: new Date().toISOString() };
    for (const store of Object.keys(STORES)) {
      let regs = await this.getAll(store);
      if (!incluirBlobs) {
        regs = regs.map(r => {
          const c = { ...r };
          delete c.blob; delete c.audioBlob; delete c.imagenes;
          return c;
        });
      }
      data[store] = regs;
    }
    return data;
  },

  async importarJSON(data, reemplazar = false) {
    for (const store of Object.keys(STORES)) {
      if (!Array.isArray(data[store])) continue;
      if (reemplazar) await this.clear(store);
      for (const reg of data[store]) await this.put(store, reg);
    }
  },
};
