// estudio.js — Módulo Estudio: materias con promedio ponderado, exámenes con
// countdown/alarmas/plan, sesiones pomodoro y audios de clase.
import { db } from '../db.js';
import { ui } from '../ui.js';

// ---------- Constantes ----------
const TIPOS_MATERIA = [
  { v: 'teorica', t: 'Teórica' },
  { v: 'practica', t: 'Práctica' },
  { v: 'mixta', t: 'Mixta' },
];
const TIPOS_EXAMEN = [
  { v: 'escrito', t: 'Escrito' },
  { v: 'oral', t: 'Oral' },
  { v: 'practico', t: 'Práctico' },
];

const METODOS_TEORICA = [
  { nombre: 'Repaso espaciado', desc: 'Repasá el mismo tema varias veces con días de separación (hoy, en 2 días, en una semana). Cada repaso corto refuerza la memoria mucho más que una maratón la noche anterior.' },
  { nombre: 'Active recall', desc: 'Cerrá la carpeta y tratá de recordar lo que estudiaste: escribite preguntas y respondelas sin mirar. Recién después fijate qué te faltó. Recordar cuesta, y justamente por eso funciona.' },
  { nombre: 'Técnica Feynman', desc: 'Explicá el tema con tus palabras, como si se lo contaras a alguien de primaria. Donde te trabás está lo que no entendés: volvé a la carpeta y repetí hasta que salga fácil.' },
  { nombre: 'Mapas conceptuales', desc: 'Poné el tema central en el medio de una hoja y armá ramas con las ideas conectadas por flechas. Te obliga a pensar cómo se relaciona todo y de un vistazo repasás la unidad entera.' },
];
const METODOS_PRACTICA = [
  { nombre: 'Ejercicios progresivos', desc: 'Arrancá por los ejercicios fáciles para agarrar confianza y subí la dificultad de a poco. Si te trabás, mirá la solución, entendela y resolvé otro parecido vos solo.' },
  { nombre: 'Pomodoro', desc: 'Estudiá 25 minutos con el celu lejos y descansá 5. Repetí el ciclo 3 o 4 veces. Los bloques cortos con descanso mantienen la concentración alta sin fundirte.' },
  { nombre: 'Resolver exámenes viejos', desc: 'Conseguí parciales o pruebas de años anteriores y resolvelos con tiempo y sin apuntes, como si fuera el día del examen. Es la forma más real de saber si estás listo.' },
  { nombre: 'Explicarle a otro', desc: 'Juntate con un compañero (o alguien de tu familia) y explicale paso a paso cómo se resuelve un ejercicio. Enseñar te ordena las ideas y te muestra al toque lo que no dominás.' },
];

function metodosPara(tipo) {
  if (tipo === 'practica') return METODOS_PRACTICA;
  if (tipo === 'mixta') return [
    METODOS_TEORICA[0], METODOS_TEORICA[1], METODOS_PRACTICA[0],
    METODOS_PRACTICA[2], METODOS_TEORICA[2], METODOS_PRACTICA[1],
  ];
  return METODOS_TEORICA;
}
function todosLosMetodos() {
  const lista = [];
  for (const m of [...METODOS_TEORICA, ...METODOS_PRACTICA]) {
    if (!lista.includes(m.nombre)) lista.push(m.nombre);
  }
  return lista;
}
function tipoMateriaTexto(v) { return (TIPOS_MATERIA.find(t => t.v === v) || TIPOS_MATERIA[0]).t; }
function tipoExamenTexto(v) { return (TIPOS_EXAMEN.find(t => t.v === v) || TIPOS_EXAMEN[0]).t; }

// ---------- Helpers ----------
const fmtNota = v => Number(Math.round(v * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });

function fmtBytes(b) {
  if (!Number.isFinite(b)) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtSegundos(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
function extAudio(mime = '') {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}
function chipUrgencia(iso) {
  const d = ui.diasHasta(iso);
  if (d < 0) return ui.el('span', { class: 'chip' }, 'Ya pasó');
  if (d === 0) return ui.el('span', { class: 'chip chip-peligro' }, '¡Hoy!');
  if (d === 1) return ui.el('span', { class: 'chip chip-peligro' }, '¡Mañana!');
  if (d <= 3) return ui.el('span', { class: 'chip chip-peligro' }, `En ${d} días`);
  if (d <= 7) return ui.el('span', { class: 'chip chip-alerta' }, `En ${d} días`);
  return ui.el('span', { class: 'chip' }, `En ${d} días`);
}

async function cfgNotas() {
  return {
    escala: Number(await db.getSetting('escalaNotas', 10)) || 10,
    aprobado: Number(await db.getSetting('notaAprobado', 6)) || 6,
  };
}

// Promedio ponderado: cada calificación pesa según su campo peso (default 1).
function promedioPonderado(califs) {
  let sp = 0, sn = 0;
  for (const c of califs) {
    const p = Number(c.peso) > 0 ? Number(c.peso) : 1;
    sp += p; sn += (Number(c.nota) || 0) * p;
  }
  return { prom: sp ? sn / sp : null, sumaPesos: sp, sumaNotaPeso: sn, cant: califs.length };
}

// El cálculo clave: qué necesitás en la próxima nota (peso 1) para llegar a aprobado.
function nodoCalculoProxima(cant, sumaPesos, sumaNotaPeso, escala, aprobado) {
  if (!cant) {
    return ui.el('p', { class: 'texto-chico texto-suave sin-margen' },
      `Todavía no hay notas: con ${fmtNota(aprobado)} o más en la primera arrancás aprobando.`);
  }
  const x = aprobado * (sumaPesos + 1) - sumaNotaPeso;
  if (x <= 0) {
    return ui.el('p', { class: 'texto-chico texto-ok sin-margen' },
      `Aprobado asegurado: incluso con un 0 en la próxima nota el promedio queda en ${fmtNota(aprobado)} o más.`);
  }
  const xr = Math.ceil(x * 10) / 10;
  if (xr <= escala) {
    return ui.el('p', { class: 'texto-chico sin-margen' },
      `Necesitás sacarte ${fmtNota(xr)} en la próxima nota para llegar a ${fmtNota(aprobado)}.`);
  }
  if (escala <= aprobado) {
    return ui.el('p', { class: 'texto-chico texto-peligro sin-margen' },
      'Revisá los Ajustes: la nota de aprobado no puede ser mayor o igual a la escala máxima.');
  }
  const n = Math.max(1, Math.ceil((aprobado * sumaPesos - sumaNotaPeso) / (escala - aprobado)));
  return ui.el('p', { class: 'texto-chico texto-peligro sin-margen' },
    `Con una sola nota no alcanza: necesitarías un ${fmtNota(xr)} y el máximo es ${fmtNota(escala)}. ` +
    `Te harían falta ${n} nota${n > 1 ? 's' : ''} perfecta${n > 1 ? 's' : ''} de ${fmtNota(escala)} para levantar el promedio.`);
}

// Toast + notificación del sistema (si hay permiso), con try/catch.
function avisar(titulo, cuerpo = '') {
  ui.toast(titulo + (cuerpo ? ' — ' + cuerpo : ''), 'info', 5000);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(titulo, { body: cuerpo });
    }
  } catch (e) { /* navegador sin soporte: alcanza con el toast */ }
}

// ---------- Seeds ----------
async function sembrarSiHaceFalta() {
  if (await db.getSetting('estudio.seed', false)) return;
  if ((await db.count('materias')) === 0) {
    await db.putMany('materias', [
      { nombre: 'Matemática', tipo: 'practica', color: '#4f8ef7', profesor: '', notas: '' },
      { nombre: 'Lengua y Literatura', tipo: 'teorica', color: '#f7734f', profesor: '', notas: '' },
      { nombre: 'Historia', tipo: 'teorica', color: '#f2c14e', profesor: '', notas: '' },
      { nombre: 'Física', tipo: 'mixta', color: '#42c98d', profesor: '', notas: '' },
    ]);
  }
  await db.setSetting('estudio.seed', true);
}

// ---------- Pomodoro (estado a nivel módulo: sigue corriendo al cambiar de pestaña) ----------
const pomo = {
  activo: false, pausado: false, fase: null,          // 'trabajo' | 'descanso'
  materiaId: '', metodo: '', trabajoMin: 25, descansoMin: 5,
  ciclos: 0, inicioFaseTs: 0, finTs: 0, restanteMs: 0,
  timer: null, alTick: null, alGuardarSesion: null,
};

function fmtMMSS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function pomoRestanteMs() {
  if (!pomo.activo) return pomo.trabajoMin * 60000;
  return pomo.pausado ? pomo.restanteMs : Math.max(0, pomo.finTs - Date.now());
}
function pomoIniciar({ materiaId, metodo, trabajo, descanso }) {
  pomoDetener();
  Object.assign(pomo, {
    activo: true, pausado: false, fase: 'trabajo',
    materiaId, metodo, trabajoMin: trabajo, descansoMin: descanso,
    ciclos: 0, inicioFaseTs: Date.now(), finTs: Date.now() + trabajo * 60000,
  });
  pomo.timer = setInterval(pomoTick, 500);
}
function pomoTick() {
  if (pomo.activo && !pomo.pausado && Date.now() >= pomo.finTs) pomoCompletarFase();
  if (typeof pomo.alTick === 'function') { try { pomo.alTick(); } catch (e) { /* DOM viejo */ } }
}
async function pomoCompletarFase() {
  if (pomo.fase === 'trabajo') {
    const fin = new Date();
    const sesion = {
      materiaId: pomo.materiaId || '', fecha: ui.hoyISO(fin),
      inicio: ui.ahoraHM(new Date(pomo.inicioFaseTs)), fin: ui.ahoraHM(fin),
      metodo: pomo.metodo || 'Pomodoro', minutos: pomo.trabajoMin, planificada: false,
    };
    // Primero cambiamos de fase para que el tick no dispare dos veces.
    pomo.ciclos++;
    pomo.fase = 'descanso';
    pomo.finTs = Date.now() + pomo.descansoMin * 60000;
    try { await db.put('sesionesEstudio', sesion); } catch (e) { ui.toast('No pude guardar la sesión: ' + e.message, 'error'); }
    avisar('Pomodoro completo', `Descansá ${pomo.descansoMin} min. Llevás ${pomo.ciclos} ciclo${pomo.ciclos > 1 ? 's' : ''}.`);
    if (typeof pomo.alGuardarSesion === 'function') { try { pomo.alGuardarSesion(); } catch (e) {} }
  } else {
    pomo.fase = 'trabajo';
    pomo.inicioFaseTs = Date.now();
    pomo.finTs = Date.now() + pomo.trabajoMin * 60000;
    avisar('Fin del descanso', 'A estudiar de nuevo. ¡Vos podés!');
  }
}
function pomoPausar() {
  if (!pomo.activo || pomo.pausado) return;
  pomo.pausado = true;
  pomo.restanteMs = Math.max(0, pomo.finTs - Date.now());
}
function pomoReanudar() {
  if (!pomo.activo || !pomo.pausado) return;
  pomo.pausado = false;
  pomo.finTs = Date.now() + pomo.restanteMs;
}
async function pomoTerminar() {
  if (pomo.activo && pomo.fase === 'trabajo') {
    // Minutos efectivos trabajados en la fase actual (sin contar pausas).
    const min = Math.round(pomo.trabajoMin - pomoRestanteMs() / 60000);
    if (min >= 1) {
      const fin = new Date();
      try {
        await db.put('sesionesEstudio', {
          materiaId: pomo.materiaId || '', fecha: ui.hoyISO(fin),
          inicio: ui.ahoraHM(new Date(pomo.inicioFaseTs)), fin: ui.ahoraHM(fin),
          metodo: pomo.metodo || 'Pomodoro', minutos: min, planificada: false,
        });
        ui.toast(`Sesión guardada: ${ui.fmtDuracion(min)}`);
      } catch (e) { ui.toast('No pude guardar la sesión: ' + e.message, 'error'); }
    }
  }
  pomoDetener();
  if (typeof pomo.alGuardarSesion === 'function') { try { pomo.alGuardarSesion(); } catch (e) {} }
}
function pomoDetener() {
  if (pomo.timer) clearInterval(pomo.timer);
  Object.assign(pomo, { activo: false, pausado: false, fase: null, timer: null, restanteMs: 0 });
}

// ==================================================================
// PESTAÑA 1: MATERIAS
// ==================================================================
function modalMateria(materia, alGuardar) {
  const esNueva = !materia;
  const m = materia || { nombre: '', tipo: 'teorica', color: '#4f8ef7', profesor: '', notas: '' };
  const fNombre = ui.campo({ etiqueta: 'Nombre', valor: m.nombre, placeholder: 'Ej: Matemática' });
  const fTipo = ui.campo({ tipo: 'select', etiqueta: 'Tipo', valor: m.tipo, opciones: TIPOS_MATERIA });
  const fColor = ui.campo({ tipo: 'color', etiqueta: 'Color', valor: m.color || '#4f8ef7' });
  const fProfe = ui.campo({ etiqueta: 'Profesor/a (opcional)', valor: m.profesor || '' });
  const fNotas = ui.campo({ tipo: 'textarea', etiqueta: 'Notas (opcional)', valor: m.notas || '', placeholder: 'Aula, horarios, qué toma en los exámenes…' });
  ui.modal({
    titulo: esNueva ? 'Nueva materia' : 'Editar materia',
    cuerpo: ui.el('div', {}, fNombre, ui.el('div', { class: 'fila-campos' }, fTipo, fColor), fProfe, fNotas),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const nombre = fNombre.input.value.trim();
        if (!nombre) return ui.toast('Poné un nombre a la materia', 'error');
        Object.assign(m, {
          nombre, tipo: fTipo.input.value, color: fColor.input.value,
          profesor: fProfe.input.value.trim(), notas: fNotas.input.value.trim(),
        });
        await db.put('materias', m);
        cerrar(); ui.toast(esNueva ? 'Materia creada' : 'Materia actualizada');
        alGuardar();
      } },
    ],
  });
}

async function borrarMateria(m, alBorrar) {
  const ok = await ui.confirmar(`¿Borrar "${m.nombre}"? Se borran también sus calificaciones, exámenes, sesiones y audios.`);
  if (!ok) return;
  for (const store of ['calificaciones', 'examenes', 'sesionesEstudio', 'audiosClase']) {
    const regs = await db.getBy(store, 'materiaId', m.id);
    for (const r of regs) await db.del(store, r.id);
  }
  await db.del('materias', m.id);
  ui.toast('Materia borrada');
  alBorrar();
}

function modalCalificacion(materia, calif, escala, alGuardar) {
  const esNueva = !calif;
  const c = calif || { materiaId: materia.id, fecha: ui.hoyISO(), descripcion: '', nota: '', peso: 1 };
  const fFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha', valor: c.fecha });
  const fDesc = ui.campo({ etiqueta: 'Descripción', valor: c.descripcion, placeholder: 'Ej: Trabajo práctico 2, Oral, Carpeta…' });
  const fNota = ui.campo({ tipo: 'number', etiqueta: `Nota (0 a ${fmtNota(escala)})`, valor: c.nota, min: 0, max: escala, step: '0.25' });
  const fPeso = ui.campo({ tipo: 'number', etiqueta: 'Peso (cuánto vale en el promedio)', valor: c.peso ?? 1, min: 0.25, step: '0.25' });
  ui.modal({
    titulo: esNueva ? `Nueva nota en ${materia.nombre}` : 'Editar nota',
    cuerpo: ui.el('div', {}, fFecha, fDesc, ui.el('div', { class: 'fila-campos' }, fNota, fPeso)),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const nota = Number(fNota.input.value);
        if (!Number.isFinite(nota) || nota < 0 || nota > escala) return ui.toast(`La nota tiene que estar entre 0 y ${fmtNota(escala)}`, 'error');
        const peso = Number(fPeso.input.value) > 0 ? Number(fPeso.input.value) : 1;
        Object.assign(c, {
          fecha: fFecha.input.value || ui.hoyISO(),
          descripcion: fDesc.input.value.trim(), nota, peso,
        });
        await db.put('calificaciones', c);
        cerrar(); alGuardar();
      } },
    ],
  });
}

function tabMaterias(cont) {
  let detalleId = null;

  const pintar = async () => {
    cont.innerHTML = '';
    if (detalleId) return pintarDetalle();

    const [materias, califs, cfg] = await Promise.all([
      db.getAll('materias'), db.getAll('calificaciones'), cfgNotas(),
    ]);
    materias.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const porMat = {};
    for (const c of califs) (porMat[c.materiaId] = porMat[c.materiaId] || []).push(c);

    cont.append(ui.el('div', { class: 'fila espaciado mb' },
      ui.el('span', { class: 'texto-suave texto-chico' }, `Aprobás con ${fmtNota(cfg.aprobado)} (escala de ${fmtNota(cfg.escala)}, se cambia en Ajustes)`),
      ui.el('button', { class: 'btn btn-primario btn-chico', onClick: () => modalMateria(null, pintar) }, ui.icon('mas'), 'Nueva materia')));

    if (!materias.length) {
      cont.append(ui.estadoVacio('Sin materias todavía. Creá la primera para arrancar.', 'libro'));
      return;
    }

    for (const m of materias) {
      const { prom, sumaPesos, sumaNotaPeso, cant } = promedioPonderado(porMat[m.id] || []);
      const chipEstado = prom === null
        ? ui.el('span', { class: 'chip' }, 'Sin notas')
        : (prom >= cfg.aprobado
          ? ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), 'Aprobando')
          : ui.el('span', { class: 'chip chip-peligro' }, 'En riesgo'));

      cont.append(ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' },
          ui.el('h3', {},
            ui.el('span', { class: 'punto-color', style: { background: m.color || '#888' } }),
            m.nombre),
          ui.el('div', { class: 'fila' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalMateria(m, pintar) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: () => borrarMateria(m, pintar) }, ui.icon('basura')))),
        ui.el('div', { class: 'fila mb' },
          ui.el('span', { class: 'chip chip-acento' }, tipoMateriaTexto(m.tipo)),
          chipEstado,
          m.profesor ? ui.el('span', { class: 'texto-suave texto-chico' }, m.profesor) : null),
        ui.el('p', { class: 'sin-margen mb', style: { marginBottom: '6px' } },
          'Promedio ponderado: ',
          ui.el('strong', {}, prom === null ? '—' : fmtNota(prom)),
          ui.el('span', { class: 'texto-suave texto-chico' }, ` · ${cant} nota${cant === 1 ? '' : 's'}`)),
        nodoCalculoProxima(cant, sumaPesos, sumaNotaPeso, cfg.escala, cfg.aprobado),
        ui.el('button', { class: 'btn btn-chico mt', onClick: () => { detalleId = m.id; pintar(); } },
          ui.icon('flecha_der'), 'Notas y cómo estudiarla')));
    }
  };

  const pintarDetalle = async () => {
    const m = await db.get('materias', detalleId);
    if (!m) { detalleId = null; return pintar(); }
    const [califs, cfg] = await Promise.all([db.getBy('calificaciones', 'materiaId', m.id), cfgNotas()]);
    califs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const { prom, sumaPesos, sumaNotaPeso, cant } = promedioPonderado(califs);

    cont.append(ui.el('div', { class: 'fila mb' },
      ui.el('button', { class: 'btn-icono', 'aria-label': 'Volver', onClick: () => { detalleId = null; pintar(); } }, ui.icon('flecha_izq')),
      ui.el('h3', { class: 'sin-margen', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        ui.el('span', { class: 'punto-color', style: { background: m.color || '#888' } }), m.nombre)));

    // Resumen
    cont.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'fila mb' },
        ui.el('span', { class: 'chip chip-acento' }, tipoMateriaTexto(m.tipo)),
        prom === null ? ui.el('span', { class: 'chip' }, 'Sin notas')
          : (prom >= cfg.aprobado ? ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), 'Aprobando')
            : ui.el('span', { class: 'chip chip-peligro' }, 'En riesgo')),
        m.profesor ? ui.el('span', { class: 'texto-suave texto-chico' }, m.profesor) : null),
      ui.el('p', { style: { marginBottom: '6px' } },
        'Promedio ponderado: ', ui.el('strong', {}, prom === null ? '—' : fmtNota(prom))),
      nodoCalculoProxima(cant, sumaPesos, sumaNotaPeso, cfg.escala, cfg.aprobado),
      m.notas ? ui.el('p', { class: 'texto-suave texto-chico mt sin-margen' }, m.notas) : null));

    // Calificaciones
    const tarjCal = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, 'Calificaciones'),
        ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => modalCalificacion(m, null, cfg.escala, pintar) }, ui.icon('mas'), 'Agregar')));
    if (!califs.length) {
      tarjCal.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Todavía no cargaste notas de esta materia.'));
    } else {
      for (const c of califs) {
        tarjCal.append(ui.el('div', { class: 'lista-item' },
          ui.el('span', { class: 'chip ' + (Number(c.nota) >= cfg.aprobado ? 'chip-ok' : 'chip-peligro') }, fmtNota(Number(c.nota))),
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo' }, c.descripcion || 'Nota'),
            ui.el('div', { class: 'sub' }, `${ui.fmtFecha(c.fecha)} · peso ${fmtNota(Number(c.peso) || 1)}`)),
          ui.el('div', { class: 'acciones' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalCalificacion(m, c, cfg.escala, pintar) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
              if (!(await ui.confirmar('¿Borrar esta nota?'))) return;
              await db.del('calificaciones', c.id); pintar();
            } }, ui.icon('basura')))));
      }
    }
    cont.append(tarjCal);

    // Cómo estudiar
    const intro = m.tipo === 'practica'
      ? 'Materia práctica: la clave es hacer, no releer. Estos métodos te sirven:'
      : m.tipo === 'mixta'
        ? 'Materia mixta: combiná memoria y práctica. Estos métodos te sirven:'
        : 'Materia teórica: lo importante es entender y recordar. Estos métodos te sirven:';
    const tarjMet = ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, 'Cómo estudiar esta materia'),
      ui.el('p', { class: 'texto-suave texto-chico' }, intro));
    for (const met of metodosPara(m.tipo)) {
      const esPref = m.metodoPreferido === met.nombre;
      tarjMet.append(ui.el('div', { class: 'lista-item' },
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo', style: { display: 'flex', alignItems: 'center', gap: '7px' } },
            met.nombre, esPref ? ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), 'Preferido') : null),
          ui.el('div', { class: 'sub', style: { whiteSpace: 'normal' } }, met.desc)),
        ui.el('div', { class: 'acciones' },
          ui.el('button', {
            class: 'btn btn-chico' + (esPref ? ' btn-ok' : ''),
            onClick: async () => {
              m.metodoPreferido = esPref ? '' : met.nombre;
              await db.put('materias', m); pintar();
            },
          }, esPref ? 'Quitar' : 'Elegir'))));
    }
    cont.append(tarjMet);
  };

  pintar();
}

// ==================================================================
// PESTAÑA 2: EXÁMENES
// ==================================================================
function modalExamen(examen, materias, alGuardar) {
  if (!materias.length) return ui.toast('Primero creá una materia en la pestaña Materias', 'error');
  const esNuevo = !examen;
  const ex = examen || { materiaId: materias[0].id, fecha: ui.hoyISO(), tema: '', tipo: 'escrito', estado: 'pendiente', nota: null };
  const fMat = ui.campo({ tipo: 'select', etiqueta: 'Materia', valor: ex.materiaId, opciones: materias.map(m => ({ v: m.id, t: m.nombre })) });
  const fFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha', valor: ex.fecha });
  const fTema = ui.campo({ etiqueta: 'Tema', valor: ex.tema, placeholder: 'Ej: Ecuaciones de segundo grado' });
  const fTipo = ui.campo({ tipo: 'select', etiqueta: 'Tipo', valor: ex.tipo, opciones: TIPOS_EXAMEN });
  const fEstado = ui.campo({ tipo: 'select', etiqueta: 'Estado', valor: ex.estado, opciones: [{ v: 'pendiente', t: 'Pendiente' }, { v: 'rendido', t: 'Rendido' }] });
  const fNota = ui.campo({ tipo: 'number', etiqueta: 'Nota (si ya lo rendiste)', valor: ex.nota ?? '', min: 0, step: '0.25' });
  ui.modal({
    titulo: esNuevo ? 'Nuevo examen' : 'Editar examen',
    cuerpo: ui.el('div', {}, fMat, ui.el('div', { class: 'fila-campos' }, fFecha, fTipo), fTema,
      esNuevo ? null : ui.el('div', { class: 'fila-campos' }, fEstado, fNota)),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const tema = fTema.input.value.trim();
        if (!tema) return ui.toast('Poné el tema del examen', 'error');
        if (!fFecha.input.value) return ui.toast('Poné la fecha', 'error');
        Object.assign(ex, {
          materiaId: fMat.input.value, fecha: fFecha.input.value, tema, tipo: fTipo.input.value,
        });
        if (!esNuevo) {
          ex.estado = fEstado.input.value;
          const n = Number(fNota.input.value);
          ex.nota = fNota.input.value !== '' && Number.isFinite(n) ? n : ex.nota;
        }
        await db.put('examenes', ex);
        cerrar(); alGuardar();
      } },
    ],
  });
}

function modalRendido(ex, mat, cfg, alGuardar) {
  const fNota = ui.campo({ tipo: 'number', etiqueta: `¿Qué nota te sacaste? (0 a ${fmtNota(cfg.escala)})`, valor: '', min: 0, max: cfg.escala, step: '0.25' });
  ui.modal({
    titulo: 'Marcar rendido',
    cuerpo: ui.el('div', {},
      ui.el('p', { class: 'texto-suave texto-chico' },
        `${mat ? mat.nombre : 'Examen'} — ${ex.tema}. La nota se guarda también como calificación de la materia (peso 1).`),
      fNota),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const n = Number(fNota.input.value);
        if (!Number.isFinite(n) || fNota.input.value === '' || n < 0 || n > cfg.escala) {
          return ui.toast(`La nota tiene que estar entre 0 y ${fmtNota(cfg.escala)}`, 'error');
        }
        ex.estado = 'rendido'; ex.nota = n;
        await db.put('examenes', ex);
        await db.put('calificaciones', {
          materiaId: ex.materiaId, fecha: ex.fecha,
          descripcion: 'Examen: ' + ex.tema, nota: n, peso: 1,
        });
        cerrar();
        ui.toast(n >= cfg.aprobado ? `Un ${fmtNota(n)}, ¡bien ahí! Quedó en el promedio.` : `Nota guardada (${fmtNota(n)}). Mirá cuánto necesitás en Materias.`);
        alGuardar();
      } },
    ],
  });
}

function modalAlarmaExamen(ex, mat) {
  // Por defecto: la víspera a las 19:00, editable.
  const d = ui.desdeISO(ex.fecha); d.setDate(d.getDate() - 1);
  const fCuando = ui.campo({ tipo: 'datetime-local', etiqueta: 'Cuándo avisarte', valor: `${ui.hoyISO(d)}T19:00` });
  const fMsj = ui.campo({ etiqueta: 'Mensaje', valor: `Estudiar ${mat ? mat.nombre : ''}: ${ex.tema} (examen ${ui.fmtFecha(ex.fecha)})`.trim() });
  ui.modal({
    titulo: 'Crear alarma',
    cuerpo: ui.el('div', {},
      ui.el('p', { class: 'texto-suave texto-chico' }, 'La alarma suena mientras la app esté abierta (mirá Ajustes para más info).'),
      fCuando, fMsj),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Crear', clase: 'btn-primario', onClick: async (cerrar) => {
        const cuando = fCuando.input.value;
        if (!cuando) return ui.toast('Elegí fecha y hora', 'error');
        await db.put('alarmas', {
          fecha: cuando.slice(0, 16), mensaje: fMsj.input.value.trim() || 'Estudiar',
          refTipo: 'examen', refId: ex.id, disparada: false, repetir: null,
        });
        cerrar();
        ui.toast(`Alarma creada: ${ui.fmtFecha(cuando.slice(0, 10))} a las ${cuando.slice(11, 16)}`);
      } },
    ],
  });
}

async function generarPlanEstudio(ex, mat) {
  if (!mat) return ui.toast('El examen no tiene materia asignada', 'error');
  const previas = (await db.getBy('sesionesEstudio', 'materiaId', mat.id))
    .filter(s => s.planificada && s.examenId === ex.id);
  if (previas.length) {
    const ok = await ui.confirmar(`Ya hay ${previas.length} sesiones planificadas para este examen. ¿Las reemplazo por un plan nuevo?`, 'Reemplazar');
    if (!ok) return;
    for (const s of previas) await db.del('sesionesEstudio', s.id);
  }
  // Días antes del examen según tipo de materia.
  const offsets = mat.tipo === 'practica' ? [-6, -4, -2, -1] : [-7, -5, -3, -1];
  const metodos = metodosPara(mat.tipo);
  const nuevas = [];
  offsets.forEach((off, i) => {
    const d = ui.desdeISO(ex.fecha); d.setDate(d.getDate() + off);
    const fecha = ui.hoyISO(d);
    if (ui.diasHasta(fecha) < 0) return; // no planificamos en el pasado
    nuevas.push({
      materiaId: mat.id, fecha, inicio: '', fin: '',
      metodo: metodos[i % metodos.length].nombre, minutos: 0,
      planificada: true, examenId: ex.id, notas: 'Plan para examen ' + ex.tema,
    });
  });
  if (!nuevas.length) return ui.toast('El examen está muy cerca o ya pasó: no quedan días para planificar', 'error', 4000);
  await db.putMany('sesionesEstudio', nuevas);
  ui.toast(`Creé ${nuevas.length} sesiones de estudio. Las ves en la pestaña Sesiones.`, 'ok', 4000);
}

function tabExamenes(cont) {
  const pintar = async () => {
    cont.innerHTML = '';
    const [examenes, materias, cfg] = await Promise.all([
      db.getAll('examenes'), db.getAll('materias'), cfgNotas(),
    ]);
    materias.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const matPor = Object.fromEntries(materias.map(m => [m.id, m]));

    cont.append(ui.el('div', { class: 'fila espaciado mb' },
      ui.el('span', { class: 'texto-suave texto-chico' }, 'Anotá los exámenes apenas los avisan'),
      ui.el('button', { class: 'btn btn-primario btn-chico', onClick: () => modalExamen(null, materias, pintar) }, ui.icon('mas'), 'Nuevo examen')));

    const pendientes = examenes.filter(e => e.estado !== 'rendido').sort((a, b) => a.fecha.localeCompare(b.fecha));
    const rendidos = examenes.filter(e => e.estado === 'rendido').sort((a, b) => b.fecha.localeCompare(a.fecha));

    if (!examenes.length) {
      cont.append(ui.estadoVacio('Sin exámenes cargados. Ojalá dure.', 'calendario'));
      return;
    }

    for (const ex of pendientes) {
      const mat = matPor[ex.materiaId];
      cont.append(ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' },
          ui.el('h3', {},
            ui.el('span', { class: 'punto-color', style: { background: (mat && mat.color) || '#888' } }),
            ex.tema),
          ui.el('div', { class: 'fila' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalExamen(ex, materias, pintar) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
              if (!(await ui.confirmar('¿Borrar este examen?'))) return;
              await db.del('examenes', ex.id); pintar();
            } }, ui.icon('basura')))),
        ui.el('div', { class: 'fila mb' },
          ui.el('span', { class: 'chip chip-acento' }, mat ? mat.nombre : 'Sin materia'),
          ui.el('span', { class: 'chip' }, tipoExamenTexto(ex.tipo)),
          chipUrgencia(ex.fecha),
          ui.el('span', { class: 'texto-suave texto-chico' }, ui.fmtFecha(ex.fecha, true))),
        ui.el('div', { class: 'fila' },
          ui.el('button', { class: 'btn btn-chico btn-ok', onClick: () => modalRendido(ex, mat, cfg, pintar) }, ui.icon('check'), 'Rendido'),
          ui.el('button', { class: 'btn btn-chico', onClick: () => modalAlarmaExamen(ex, mat) }, ui.icon('campana'), 'Alarma'),
          ui.el('button', { class: 'btn btn-chico', onClick: () => generarPlanEstudio(ex, mat) }, ui.icon('calendario'), 'Plan de estudio'))));
    }

    if (rendidos.length) {
      const tarj = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Rendidos'));
      for (const ex of rendidos) {
        const mat = matPor[ex.materiaId];
        const tieneNota = Number.isFinite(Number(ex.nota)) && ex.nota !== null && ex.nota !== '';
        tarj.append(ui.el('div', { class: 'lista-item' },
          ui.el('span', { class: 'punto-color', style: { background: (mat && mat.color) || '#888' } }),
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo' }, ex.tema),
            ui.el('div', { class: 'sub' }, `${mat ? mat.nombre : 'Sin materia'} · ${tipoExamenTexto(ex.tipo)} · ${ui.fmtFecha(ex.fecha)}`)),
          tieneNota
            ? ui.el('span', { class: 'chip ' + (Number(ex.nota) >= cfg.aprobado ? 'chip-ok' : 'chip-peligro') }, fmtNota(Number(ex.nota)))
            : ui.el('span', { class: 'chip' }, 'Sin nota'),
          ui.el('div', { class: 'acciones' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalExamen(ex, materias, pintar) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
              if (!(await ui.confirmar('¿Borrar este examen?'))) return;
              await db.del('examenes', ex.id); pintar();
            } }, ui.icon('basura')))));
      }
      cont.append(tarj);
    }
  };
  pintar();
}

// ==================================================================
// PESTAÑA 3: SESIONES (pomodoro + historial + gráfico)
// ==================================================================
function modalSesion(sesion, materias, alGuardar) {
  const esNueva = !sesion;
  const s = sesion || { materiaId: materias[0] ? materias[0].id : '', fecha: ui.hoyISO(), inicio: '', fin: '', metodo: 'Libre', minutos: '', planificada: false, notas: '' };
  const opcionesMat = [{ v: '', t: 'Sin materia' }, ...materias.map(m => ({ v: m.id, t: m.nombre }))];
  const metodos = todosLosMetodos(); metodos.push('Libre');
  if (s.metodo && !metodos.includes(s.metodo)) metodos.unshift(s.metodo);

  const fMat = ui.campo({ tipo: 'select', etiqueta: 'Materia', valor: s.materiaId || '', opciones: opcionesMat });
  const fFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha', valor: s.fecha });
  const fMetodo = ui.campo({ tipo: 'select', etiqueta: 'Método', valor: s.metodo || 'Libre', opciones: metodos.map(n => ({ v: n, t: n })) });
  const fIni = ui.campo({ tipo: 'time', etiqueta: 'Inicio (opcional)', valor: s.inicio || '' });
  const fFin = ui.campo({ tipo: 'time', etiqueta: 'Fin (opcional)', valor: s.fin || '' });
  const fMin = ui.campo({ tipo: 'number', etiqueta: 'Minutos estudiados', valor: s.minutos || '', min: 1, step: '1' });
  const aMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const calc = () => {
    if (fIni.input.value && fFin.input.value) {
      let d = aMin(fFin.input.value) - aMin(fIni.input.value);
      if (d <= 0) d += 1440; // cruzó la medianoche
      fMin.input.value = d;
    }
  };
  fIni.input.addEventListener('change', calc);
  fFin.input.addEventListener('change', calc);

  ui.modal({
    titulo: esNueva ? 'Cargar sesión de estudio' : 'Editar sesión',
    cuerpo: ui.el('div', {},
      fMat, ui.el('div', { class: 'fila-campos' }, fFecha, fMetodo),
      ui.el('div', { class: 'fila-campos' }, fIni, fFin), fMin,
      s.planificada ? ui.el('p', { class: 'texto-suave texto-chico' }, 'Esta sesión estaba planificada: al ponerle minutos queda como hecha.') : null),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const minutos = Math.round(Number(fMin.input.value));
        if (!(minutos > 0)) return ui.toast('Indicá cuántos minutos estudiaste (o cargá inicio y fin)', 'error');
        if (!fFecha.input.value) return ui.toast('Poné la fecha', 'error');
        Object.assign(s, {
          materiaId: fMat.input.value, fecha: fFecha.input.value,
          inicio: fIni.input.value || '', fin: fFin.input.value || '',
          metodo: fMetodo.input.value, minutos,
        });
        s.planificada = false; // con minutos cargados ya no es solo un plan
        await db.put('sesionesEstudio', s);
        cerrar(); alGuardar();
      } },
    ],
  });
}

function tabSesiones(cont) {
  let filtroMat = '';

  const pintar = async () => {
    cont.innerHTML = '';
    const [materias, trabajoCfg, descansoCfg] = await Promise.all([
      db.getAll('materias'),
      db.getSetting('estudio.pomodoroTrabajo', 25),
      db.getSetting('estudio.pomodoroDescanso', 5),
    ]);
    materias.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const matPor = Object.fromEntries(materias.map(m => [m.id, m]));

    // ---------- Pomodoro ----------
    const fTrabajo = ui.campo({ tipo: 'number', etiqueta: 'Trabajo (min)', valor: trabajoCfg, min: 1, max: 180 });
    const fDescanso = ui.campo({ tipo: 'number', etiqueta: 'Descanso (min)', valor: descansoCfg, min: 1, max: 60 });
    fTrabajo.input.addEventListener('change', async () => {
      const v = Math.max(1, Math.min(180, Number(fTrabajo.input.value) || 25));
      fTrabajo.input.value = v;
      await db.setSetting('estudio.pomodoroTrabajo', v);
      if (!pomo.activo) { pomo.trabajoMin = v; actualizarDisplay(); }
    });
    fDescanso.input.addEventListener('change', async () => {
      const v = Math.max(1, Math.min(60, Number(fDescanso.input.value) || 5));
      fDescanso.input.value = v;
      await db.setSetting('estudio.pomodoroDescanso', v);
    });

    const selMat = ui.campo({ tipo: 'select', etiqueta: 'Materia', valor: pomo.activo ? pomo.materiaId : '', opciones: [{ v: '', t: 'Sin materia' }, ...materias.map(m => ({ v: m.id, t: m.nombre }))] });
    const selMet = ui.campo({ tipo: 'select', etiqueta: 'Método', valor: '', opciones: [] });
    const llenarMetodos = () => {
      const mat = matPor[selMat.input.value];
      const lista = mat ? metodosPara(mat.tipo).map(x => x.nombre) : todosLosMetodos();
      if (!lista.includes('Libre')) lista.push('Libre');
      const preferido = mat && mat.metodoPreferido && lista.includes(mat.metodoPreferido) ? mat.metodoPreferido : null;
      const actual = pomo.activo ? pomo.metodo : null;
      selMet.input.innerHTML = '';
      for (const n of lista) {
        selMet.input.append(ui.el('option', { value: n, selected: (actual ? n === actual : n === preferido) || null }, n));
      }
    };
    selMat.input.addEventListener('change', llenarMetodos);
    llenarMetodos();

    const display = ui.el('div', { class: 'grabadora-tiempo' }, '00:00');
    const faseTxt = ui.el('div', { class: 'grabadora-estado' }, '');
    const zonaControles = ui.el('div', { class: 'fila', style: { justifyContent: 'center', marginTop: '10px' } });

    const bloquearInputs = () => {
      const b = pomo.activo;
      selMat.input.disabled = b; selMet.input.disabled = b;
      fTrabajo.input.disabled = b; fDescanso.input.disabled = b;
    };
    const actualizarDisplay = () => {
      if (!display.isConnected) return;
      if (!pomo.activo) {
        const v = Number(fTrabajo.input.value) || 25;
        display.textContent = fmtMMSS(v * 60000);
        faseTxt.textContent = 'Listo para arrancar';
        faseTxt.classList.remove('grabando');
        return;
      }
      display.textContent = fmtMMSS(pomoRestanteMs());
      const base = pomo.fase === 'trabajo'
        ? `Estudiando · ciclo ${pomo.ciclos + 1}`
        : `Descanso · ${pomo.ciclos} ciclo${pomo.ciclos === 1 ? '' : 's'} hecho${pomo.ciclos === 1 ? '' : 's'}`;
      faseTxt.textContent = base + (pomo.pausado ? ' · EN PAUSA' : '');
      faseTxt.classList.toggle('grabando', pomo.fase === 'trabajo' && !pomo.pausado);
    };
    const pintarControles = () => {
      zonaControles.innerHTML = '';
      if (!pomo.activo) {
        zonaControles.append(ui.el('button', { class: 'btn btn-primario', onClick: () => {
          const trabajo = Math.max(1, Number(fTrabajo.input.value) || 25);
          const descanso = Math.max(1, Number(fDescanso.input.value) || 5);
          pomoIniciar({ materiaId: selMat.input.value, metodo: selMet.input.value || 'Pomodoro', trabajo, descanso });
          bloquearInputs(); pintarControles(); actualizarDisplay();
        } }, ui.icon('play'), 'Iniciar'));
      } else {
        zonaControles.append(
          ui.el('button', { class: 'btn', onClick: () => {
            pomo.pausado ? pomoReanudar() : pomoPausar();
            pintarControles(); actualizarDisplay();
          } }, ui.icon(pomo.pausado ? 'play' : 'pausa'), pomo.pausado ? 'Reanudar' : 'Pausar'),
          ui.el('button', { class: 'btn btn-peligro', onClick: async () => {
            await pomoTerminar();
            bloquearInputs(); pintarControles(); actualizarDisplay();
          } }, ui.icon('stop'), 'Terminar'));
      }
    };
    pomo.alTick = actualizarDisplay;
    pomo.alGuardarSesion = () => { if (cont.isConnected) pintarHistorial(); };
    bloquearInputs(); pintarControles(); actualizarDisplay();

    cont.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('reloj'), 'Pomodoro')),
      ui.el('div', { class: 'fila-campos' }, fTrabajo, fDescanso),
      ui.el('div', { class: 'fila-campos' }, selMat, selMet),
      ui.el('div', { class: 'grabadora', style: { paddingTop: '4px' } }, display, faseTxt, zonaControles),
      ui.el('p', { class: 'texto-suave texto-chico texto-centrado sin-margen mt' },
        'Cada ciclo de trabajo completado se guarda solo en el historial.')));

    // ---------- Historial ----------
    const selFiltro = ui.el('select', { class: 'input', style: { width: 'auto' } },
      ui.el('option', { value: '' }, 'Todas las materias'),
      materias.map(m => ui.el('option', { value: m.id, selected: filtroMat === m.id || null }, m.nombre)));
    selFiltro.addEventListener('change', () => { filtroMat = selFiltro.value; pintarHistorial(); });

    const listaHist = ui.el('div', {});
    const tarjHist = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, 'Historial'),
        ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => modalSesion(null, materias, () => { pintarHistorial(); pintarGrafico(); }) }, ui.icon('mas'), 'Cargar sesión')),
      selFiltro, ui.el('div', { class: 'mt' }, listaHist));
    cont.append(tarjHist);

    // ---------- Gráfico últimos 7 días ----------
    const zonaGraf = ui.el('div', {});
    cont.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, ui.icon('grafico'), ' Minutos por materia (últimos 7 días)'), zonaGraf));

    async function pintarHistorial() {
      if (!listaHist.isConnected) return;
      listaHist.innerHTML = '';
      let sesiones = filtroMat
        ? await db.getBy('sesionesEstudio', 'materiaId', filtroMat)
        : await db.getAll('sesionesEstudio');
      sesiones.sort((a, b) => `${b.fecha}T${b.inicio || ''}`.localeCompare(`${a.fecha}T${a.inicio || ''}`));
      if (!sesiones.length) {
        listaHist.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Sin sesiones todavía. Arrancá un pomodoro o cargá una a mano.'));
        return;
      }
      for (const s of sesiones) {
        const mat = matPor[s.materiaId];
        const esPlan = s.planificada && !(Number(s.minutos) > 0);
        const partes = [ui.fmtFecha(s.fecha)];
        if (s.inicio) partes.push(`${s.inicio}${s.fin ? '–' + s.fin : ''}`);
        partes.push(esPlan ? (s.notas || 'Planificada') : ui.fmtDuracion(Number(s.minutos) || 0));
        listaHist.append(ui.el('div', { class: 'lista-item' },
          ui.el('span', { class: 'punto-color', style: { background: (mat && mat.color) || '#888' } }),
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo' }, `${mat ? mat.nombre : 'Sin materia'} · ${s.metodo || 'Libre'}`),
            ui.el('div', { class: 'sub' }, partes.join(' · '))),
          esPlan ? ui.el('span', { class: 'chip chip-alerta' }, 'Plan') : null,
          ui.el('div', { class: 'acciones' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalSesion(s, materias, () => { pintarHistorial(); pintarGrafico(); }) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
              if (!(await ui.confirmar('¿Borrar esta sesión?'))) return;
              await db.del('sesionesEstudio', s.id);
              pintarHistorial(); pintarGrafico();
            } }, ui.icon('basura')))));
      }
    }

    async function pintarGrafico() {
      if (!zonaGraf.isConnected) return;
      zonaGraf.innerHTML = '';
      const d = new Date(); d.setDate(d.getDate() - 6);
      const desde = ui.hoyISO(d);
      const sesiones = (await db.getAll('sesionesEstudio'))
        .filter(s => s.fecha >= desde && Number(s.minutos) > 0);
      if (!sesiones.length) {
        zonaGraf.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Sin sesiones esta semana. El gráfico aparece cuando estudies.'));
        return;
      }
      const suma = {};
      for (const s of sesiones) suma[s.materiaId || ''] = (suma[s.materiaId || ''] || 0) + Number(s.minutos);
      const datos = Object.entries(suma)
        .map(([id, min]) => {
          const mat = matPor[id];
          const nom = mat ? mat.nombre : 'Libre';
          return { etiqueta: nom.length > 8 ? nom.slice(0, 7) + '…' : nom, valor: min, color: (mat && mat.color) || '#95a5a6' };
        })
        .sort((a, b) => b.valor - a.valor);
      const canvas = ui.el('canvas', { class: 'grafico' });
      zonaGraf.append(canvas);
      ui.alPintar(() => ui.graficoBarras(canvas, datos, { formato: v => ui.fmtDuracion(v) }));
    }

    pintarHistorial();
    pintarGrafico();
  };

  pintar();
}

// ==================================================================
// PESTAÑA 4: AUDIOS DE CLASE
// ==================================================================
function tabAudios(cont) {
  const pintar = async () => {
    cont.innerHTML = '';
    const [materias, audios] = await Promise.all([db.getAll('materias'), db.getAll('audiosClase')]);
    materias.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const matPor = Object.fromEntries(materias.map(m => [m.id, m]));

    cont.append(ui.el('div', { class: 'fila espaciado mb' },
      ui.el('span', { class: 'texto-suave texto-chico' }, 'Grabá la clase y escuchala cuando estudies'),
      ui.el('button', { class: 'btn btn-primario btn-chico', onClick: () => modalGrabar() }, ui.icon('mic'), 'Grabar clase')));

    if (!audios.length) {
      cont.append(ui.estadoVacio('Sin audios todavía. Grabá tu primera clase con el botón de arriba.', 'mic'));
      return;
    }

    // Agrupar por materia (y "Sin materia" al final).
    const grupos = new Map();
    for (const m of materias) grupos.set(m.id, []);
    grupos.set('', []);
    for (const a of audios) {
      const clave = matPor[a.materiaId] ? a.materiaId : '';
      grupos.get(clave).push(a);
    }

    for (const [matId, lista] of grupos) {
      if (!lista.length) continue;
      lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
      const mat = matPor[matId];
      const tarj = ui.el('div', { class: 'tarjeta' },
        ui.el('h3', {},
          ui.el('span', { class: 'punto-color', style: { background: (mat && mat.color) || '#888', display: 'inline-block', marginRight: '7px' } }),
          mat ? mat.nombre : 'Sin materia'));
      for (const a of lista) tarj.append(itemAudio(a, mat));
      cont.append(tarj);
    }
  };

  const itemAudio = (a, mat) => {
    const tieneBlob = a.blob instanceof Blob;
    const principal = ui.el('div', { class: 'principal' },
      ui.el('div', { class: 'titulo' }, a.titulo || 'Audio de clase'),
      ui.el('div', { class: 'sub' },
        [ui.fmtFecha(a.fecha), fmtSegundos(a.duracion), tieneBlob ? fmtBytes(a.blob.size) : 'sin archivo (backup sin audios)']
          .filter(Boolean).join(' · ')));
    let repro = null;
    const btnPlay = ui.el('button', { class: 'btn-icono', 'aria-label': 'Escuchar', onClick: () => {
      if (!tieneBlob) return ui.toast('Este audio no tiene archivo (se importó de un backup sin audios)', 'error');
      if (repro) { repro.pause?.(); repro.remove(); repro = null; return; }
      repro = ui.reproductorAudio(a.blob);
      principal.append(repro);
      try { repro.play(); } catch (e) { /* el usuario le da play a mano */ }
    } }, ui.icon('play'));
    return ui.el('div', { class: 'lista-item' },
      btnPlay, principal,
      ui.el('div', { class: 'acciones' },
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Renombrar', onClick: () => modalRenombrar(a) }, ui.icon('editar')),
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Descargar', onClick: () => {
          if (!tieneBlob) return ui.toast('Este audio no tiene archivo para descargar', 'error');
          const nombre = (a.titulo || 'clase').replace(/[^\wáéíóúñü \-]/gi, '').trim() || 'clase';
          ui.descargarArchivo(`${nombre}.${extAudio(a.mime)}`, a.blob);
          ui.toast('Audio descargado');
        } }, ui.icon('descargar')),
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
          if (!(await ui.confirmar(`¿Borrar el audio "${a.titulo || 'sin título'}"?`))) return;
          await db.del('audiosClase', a.id); pintar();
        } }, ui.icon('basura'))));
  };

  const modalGrabar = async () => {
    const materias = (await db.getAll('materias')).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const fMat = ui.campo({ tipo: 'select', etiqueta: 'Materia', valor: materias[0] ? materias[0].id : '', opciones: [...materias.map(m => ({ v: m.id, t: m.nombre })), { v: '', t: 'Sin materia' }] });
    const fTitulo = ui.campo({ etiqueta: 'Título', valor: `Clase ${ui.fmtFecha(ui.hoyISO())}`, placeholder: 'Ej: Repaso para el parcial' });
    ui.modal({
      titulo: 'Grabar audio de clase',
      cuerpo: ui.el('div', {}, fMat, fTitulo,
        ui.el('p', { class: 'texto-suave texto-chico' }, 'Al tocar Grabar se abre la grabadora. Necesita permiso de micrófono.')),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Grabar', clase: 'btn-primario', onClick: async (cerrar) => {
          const materiaId = fMat.input.value;
          const titulo = fTitulo.input.value.trim() || 'Audio de clase';
          cerrar();
          try {
            const r = await ui.grabarAudio('Grabando: ' + titulo);
            if (!r) return ui.toast('Grabación cancelada', 'info');
            await db.put('audiosClase', {
              materiaId, fecha: ui.hoyISO(), titulo,
              blob: r.blob, mime: r.mime, duracion: r.duracion,
            });
            ui.toast(`Audio guardado (${fmtSegundos(r.duracion)}, ${fmtBytes(r.blob.size)})`);
            pintar();
          } catch (e) {
            ui.toast('No se pudo grabar: ' + e.message + '. Revisá el permiso de micrófono.', 'error', 4500);
          }
        } },
      ],
    });
  };

  const modalRenombrar = async (a) => {
    const materias = (await db.getAll('materias')).sort((x, y) => x.nombre.localeCompare(y.nombre));
    const fTitulo = ui.campo({ etiqueta: 'Título', valor: a.titulo || '' });
    const fMat = ui.campo({ tipo: 'select', etiqueta: 'Materia', valor: a.materiaId || '', opciones: [{ v: '', t: 'Sin materia' }, ...materias.map(m => ({ v: m.id, t: m.nombre }))] });
    ui.modal({
      titulo: 'Editar audio',
      cuerpo: ui.el('div', {}, fTitulo, fMat),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          a.titulo = fTitulo.input.value.trim() || 'Audio de clase';
          a.materiaId = fMat.input.value;
          await db.put('audiosClase', a);
          cerrar(); pintar();
        } },
      ],
    });
  };

  pintar();
}

// ==================================================================
// Render principal
// ==================================================================
async function render(cont) {
  cont.append(ui.el('div', { class: 'cabecera-modulo' },
    ui.el('h2', {}, ui.icon('libro'), 'Estudio')));
  await sembrarSiHaceFalta();
  ui.tabs([
    { id: 'materias', texto: 'Materias', render: c => tabMaterias(c) },
    { id: 'examenes', texto: 'Exámenes', render: c => tabExamenes(c) },
    { id: 'sesiones', texto: 'Sesiones', render: c => tabSesiones(c) },
    { id: 'audios', texto: 'Audios', render: c => tabAudios(c) },
  ], cont);
}

export default { id: 'estudio', nombre: 'Estudio', icono: 'libro', render };
