// tiempo.js — Módulo Tiempo: cronómetro de actividades, plantilla semanal de bloques,
// historial de registros y estadísticas (plan vs real, sueño, objetivos).
// Stores: categoriasTiempo, bloquesHorario, registroTiempo.
// Settings propios: 'tiempo.sembrado', 'tiempo.enCurso', 'tiempo.ultimaCat'.
import { db } from '../db.js';
import { ui } from '../ui.js';

// ---------- Estado del módulo (persiste mientras la app está abierta) ----------
let cats = [];                       // cache de categorías
let tabsRef = null;                  // API de ui.tabs para refrescar la pestaña activa
let diaSel = new Date().getDay();    // día elegido en SEMANA (0=domingo … 6=sábado)
let regRango = 'semana';             // filtros de REGISTRO
let regCat = '';
let statRango = 'semana';            // período de ESTADÍSTICAS

const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo

// Iconos disponibles para categorías (todos existen en ui.icon)
const ICONOS_CAT = ['reloj', 'luna', 'sol', 'libro', 'transporte', 'vehiculo', 'caminar',
  'ejercicio', 'ocio', 'comida', 'gota', 'musica', 'mic', 'nota', 'dinero', 'mapa',
  'pin', 'home', 'fuego', 'objetivo', 'campana', 'etiqueta'];

const SEED_CATS = [
  { nombre: 'Sueño',      icono: 'luna',       color: '#7a4ff7', objetivoMinDia: 480 },
  { nombre: 'Estudio',    icono: 'libro',      color: '#4f8ef7', objetivoMinDia: 120 },
  { nombre: 'Clases',     icono: 'libro',      color: '#4fd0e0', objetivoMinDia: null },
  { nombre: 'Transporte', icono: 'transporte', color: '#f2c14e', objetivoMinDia: null },
  { nombre: 'Ejercicio',  icono: 'ejercicio',  color: '#42c98d', objetivoMinDia: 45 },
  { nombre: 'Ocio',       icono: 'ocio',       color: '#f75f8f', objetivoMinDia: null },
  { nombre: 'Comida',     icono: 'comida',     color: '#f7734f', objetivoMinDia: null },
  { nombre: 'Otro',       icono: 'reloj',      color: '#95a5a6', objetivoMinDia: null },
];

// ---------- Helpers ----------
const hmAMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

// Duración en minutos entre dos 'HH:MM'; si fin < inicio, cruza la medianoche (+24 h)
function durMin(ini, fin) {
  let d = hmAMin(fin) - hmAMin(ini);
  if (d < 0) d += 1440;
  return d;
}

// '#rrggbb' + alfa hex → '#rrggbbaa' (si el color no es hex de 6, lo devuelve tal cual)
const conAlfa = (hex, a) => /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex + a : hex;

function fmtCrono(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isoSumar(iso, dias) {
  const d = ui.desdeISO(iso);
  d.setDate(d.getDate() + dias);
  return ui.hoyISO(d);
}

function lunesDe(iso) {
  const d = ui.desdeISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ui.hoyISO(d);
}

async function cargarCats() {
  cats = (await db.getAll('categoriasTiempo')).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function catDe(id) {
  return cats.find(c => c.id === id) ||
    { id: null, nombre: '(sin categoría)', color: '#95a5a6', icono: 'reloj', objetivoMinDia: null };
}

// Categoría "Sueño" (por nombre, sin importar tildes ni mayúsculas)
function catSueno() {
  const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // saca tildes
  return cats.find(c => norm(c.nombre) === 'sueno');
}

// Siembra inicial: solo si el store está vacío y nunca se sembró antes
async function sembrarSiHaceFalta() {
  if (await db.count('categoriasTiempo') > 0) return;
  if (await db.getSetting('tiempo.sembrado', false)) return; // el usuario las borró a propósito
  await db.putMany('categoriasTiempo', SEED_CATS.map(s => ({ ...s })));
  await db.setSetting('tiempo.sembrado', true);
}

// Pares de bloques que se pisan entre sí (dentro del mismo día)
function solapados(bloques) {
  const iv = bloques.map(b => {
    const i = hmAMin(b.horaInicio);
    let f = hmAMin(b.horaFin);
    if (f <= i) f += 1440;
    return { i, f, b };
  }).sort((a, b) => a.i - b.i);
  const pares = [];
  for (let x = 0; x < iv.length; x++)
    for (let y = x + 1; y < iv.length; y++)
      if (iv[y].i < iv[x].f) pares.push([iv[x].b, iv[y].b]);
  return pares;
}

function refrescarTab() {
  if (tabsRef) tabsRef.ir(tabsRef.activa);
}

// ---------- CRUD de categorías ----------
function modalCategoria(c, alGuardar) {
  const inNombre = ui.campo({ tipo: 'text', etiqueta: 'Nombre', valor: c?.nombre || '', placeholder: 'ej: Lectura' });
  const inColor = ui.campo({ tipo: 'color', etiqueta: 'Color', valor: c?.color || '#4f8ef7' });
  const inObj = ui.campo({ tipo: 'number', etiqueta: 'Objetivo diario en minutos (opcional)', valor: c?.objetivoMinDia || '', min: 0, placeholder: 'ej: 60' });

  let icoSel = c?.icono || 'reloj';
  const botonesIco = ICONOS_CAT.map(n => {
    const b = ui.el('button', { type: 'button', class: 'btn-icono', title: n, onClick: () => { icoSel = n; pintarSel(); } }, ui.icon(n));
    b.dataset.ico = n;
    return b;
  });
  function pintarSel() {
    for (const b of botonesIco) {
      const on = b.dataset.ico === icoSel;
      b.style.background = on ? 'var(--acento-suave)' : 'transparent';
      b.style.color = on ? 'var(--acento)' : 'var(--texto-suave)';
    }
  }
  pintarSel();

  ui.modal({
    titulo: c ? 'Editar categoría' : 'Nueva categoría',
    cuerpo: ui.el('div', {},
      inNombre,
      ui.el('div', { class: 'fila-campos' }, inColor, inObj),
      ui.el('div', { class: 'campo' },
        ui.el('span', { class: 'campo-etiqueta' }, 'Icono'),
        ui.el('div', { class: 'fila' }, botonesIco))),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const nombre = inNombre.input.value.trim();
        if (!nombre) return ui.toast('Poné un nombre para la categoría', 'error');
        const obj = Number(inObj.input.value);
        await db.put('categoriasTiempo', {
          ...(c || {}), nombre,
          color: inColor.input.value,
          icono: icoSel,
          objetivoMinDia: obj > 0 ? Math.round(obj) : null,
        });
        cerrar();
        ui.toast('Categoría guardada');
        alGuardar();
      } },
    ],
  });
}

function modalCategorias() {
  const lista = ui.el('div');
  const cambio = async () => { await pintar(); refrescarTab(); };

  async function pintar() {
    await cargarCats();
    lista.innerHTML = '';
    if (!cats.length) {
      lista.append(ui.estadoVacio('Sin categorías. Creá la primera con el botón de abajo.', 'etiqueta'));
      return;
    }
    for (const c of cats) {
      lista.append(ui.el('div', { class: 'lista-item' },
        ui.el('span', { style: { color: c.color, display: 'inline-flex' } }, ui.icon(c.icono)),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, c.nombre),
          ui.el('div', { class: 'sub' }, c.objetivoMinDia > 0 ? `Objetivo: ${ui.fmtDuracion(c.objetivoMinDia)} por día` : 'Sin objetivo diario')),
        ui.el('div', { class: 'acciones' },
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalCategoria(c, cambio) }, ui.icon('editar')),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
            if (!(await ui.confirmar(`¿Eliminar la categoría "${c.nombre}"? Los registros y bloques que la usan van a quedar como "(sin categoría)".`))) return;
            await db.del('categoriasTiempo', c.id);
            ui.toast('Categoría eliminada');
            cambio();
          } }, ui.icon('basura')))));
    }
  }
  pintar();

  ui.modal({
    titulo: 'Categorías de tiempo',
    cuerpo: ui.el('div', {}, lista,
      ui.el('button', { class: 'btn btn-primario mt', onClick: () => modalCategoria(null, cambio) }, ui.icon('mas'), 'Nueva categoría')),
    alCerrar: refrescarTab,
  });
}

// ---------- Registro manual (alta / edición) ----------
function modalRegistro(reg, alGuardar) {
  if (!cats.length) return ui.toast('Primero creá una categoría (botón "Categorías")', 'error');
  const selCat = ui.campo({ tipo: 'select', etiqueta: 'Categoría', valor: reg?.categoria || cats[0].id, opciones: cats.map(c => ({ v: c.id, t: c.nombre })) });
  const inFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha (del inicio)', valor: reg?.fecha || ui.hoyISO() });
  const inIni = ui.campo({ tipo: 'time', etiqueta: 'Desde', valor: reg?.inicio || '' });
  const inFin = ui.campo({ tipo: 'time', etiqueta: 'Hasta', valor: reg?.fin || '' });
  const inNotas = ui.campo({ tipo: 'text', etiqueta: 'Notas (opcional)', valor: reg?.notas || '' });

  ui.modal({
    titulo: reg ? 'Editar registro' : 'Cargar registro',
    cuerpo: ui.el('div', {},
      selCat, inFecha,
      ui.el('div', { class: 'fila-campos' }, inIni, inFin),
      inNotas,
      ui.el('p', { class: 'texto-suave texto-chico' }, 'Si "hasta" es menor que "desde", se asume que la actividad cruzó la medianoche.')),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const fecha = inFecha.input.value, hi = inIni.input.value, hf = inFin.input.value;
        if (!fecha || !hi || !hf) return ui.toast('Completá fecha, desde y hasta', 'error');
        const minutos = durMin(hi, hf);
        if (minutos === 0) return ui.toast('El fin no puede ser igual al inicio', 'error');
        await db.put('registroTiempo', {
          ...(reg || {}), fecha, categoria: selCat.input.value,
          inicio: hi, fin: hf, minutos, notas: inNotas.input.value.trim(),
        });
        cerrar();
        ui.toast('Registro guardado');
        alGuardar();
      } },
    ],
  });
}

// ---------- Pestaña HOY ----------
async function tabHoy(cont) {
  cont.innerHTML = '';
  await cargarCats();
  const repintar = () => tabHoy(cont);
  const hoy = ui.hoyISO();
  const enCurso = await db.getSetting('tiempo.enCurso', null);

  // --- Cronómetro ---
  const cardCrono = ui.el('div', { class: 'tarjeta' },
    ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('play'), 'Actividad')));

  if (enCurso && enCurso.inicio && enCurso.categoriaId) {
    // Actividad en curso (sobrevive recargas gracias al setting)
    const c = catDe(enCurso.categoriaId);
    const iniD = new Date(enCurso.inicio);
    const lbl = ui.el('div', { class: 'grabadora-tiempo' }, fmtCrono(Date.now() - enCurso.inicio));
    const int = setInterval(() => {
      if (!lbl.isConnected) { clearInterval(int); return; } // se limpia solo al salir de la vista
      lbl.textContent = fmtCrono(Date.now() - enCurso.inicio);
    }, 1000);

    cardCrono.append(
      ui.el('div', { class: 'fila', style: { justifyContent: 'center', color: c.color, fontWeight: '600' } },
        ui.icon(c.icono), c.nombre),
      ui.el('div', { class: 'texto-centrado' }, lbl,
        ui.el('div', { class: 'texto-suave texto-chico' },
          'desde las ' + ui.ahoraHM(iniD) + (ui.hoyISO(iniD) !== hoy ? ` (${ui.fmtFecha(ui.hoyISO(iniD))})` : ''))),
      ui.el('div', { class: 'fila mt', style: { justifyContent: 'center' } },
        ui.el('button', { class: 'btn btn-primario', onClick: async () => {
          const ahora = new Date();
          const minutos = Math.max(1, Math.round((ahora - iniD) / 60000));
          await db.put('registroTiempo', {
            fecha: ui.hoyISO(iniD), categoria: enCurso.categoriaId,
            inicio: ui.ahoraHM(iniD), fin: ui.ahoraHM(ahora), minutos, notas: '',
          });
          await db.setSetting('tiempo.enCurso', null);
          ui.toast(`Registrado: ${c.nombre} · ${ui.fmtDuracion(minutos)}`);
          repintar();
        } }, ui.icon('stop'), 'Parar'),
        ui.el('button', { class: 'btn btn-sec', onClick: async () => {
          if (!(await ui.confirmar('¿Descartar la actividad en curso sin guardarla?', 'Descartar'))) return;
          await db.setSetting('tiempo.enCurso', null);
          ui.toast('Actividad descartada');
          repintar();
        } }, 'Descartar')));
  } else if (!cats.length) {
    cardCrono.append(
      ui.estadoVacio('No hay categorías todavía. Creá una para empezar a medir tu tiempo.', 'etiqueta'),
      ui.el('div', { class: 'texto-centrado' },
        ui.el('button', { class: 'btn btn-primario', onClick: () => modalCategorias() }, ui.icon('mas'), 'Crear categorías')));
  } else {
    const ultima = await db.getSetting('tiempo.ultimaCat', '');
    const sel = ui.campo({ tipo: 'select', etiqueta: '¿Qué vas a hacer?', valor: ultima, opciones: cats.map(c => ({ v: c.id, t: c.nombre })) });
    cardCrono.append(sel,
      ui.el('button', { class: 'btn btn-primario', style: { width: '100%' }, onClick: async () => {
        const catId = sel.input.value;
        if (!catId) return ui.toast('Elegí una categoría', 'error');
        await db.setSetting('tiempo.enCurso', { categoriaId: catId, inicio: Date.now() });
        await db.setSetting('tiempo.ultimaCat', catId);
        ui.toast('¡Actividad iniciada!');
        repintar();
      } }, ui.icon('play'), 'Iniciar'));
  }

  // --- Datos del día ---
  const dow = new Date().getDay();
  const bloques = (await db.getBy('bloquesHorario', 'dia', dow)).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  const regs = (await db.getBy('registroTiempo', 'fecha', hoy)).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const totalReal = regs.reduce((s, r) => s + (r.minutos || 0), 0);
  const totalPlan = bloques.reduce((s, b) => s + durMin(b.horaInicio, b.horaFin), 0);

  const met = (valor, etiqueta) => ui.el('div', { class: 'tarjeta metrica', style: { marginBottom: 0 } },
    ui.el('div', { class: 'valor' }, valor), ui.el('div', { class: 'etiqueta' }, etiqueta));
  const metricas = ui.el('div', { class: 'grilla grilla-3 mb' },
    met(ui.fmtDuracion(totalReal), 'registrado hoy'),
    met(ui.fmtDuracion(totalPlan), 'planificado hoy'),
    met(String(regs.length), 'actividades'));

  // --- Línea de tiempo: plan (borde) + real (relleno) ---
  const items = [
    ...bloques.map(b => ({ tipo: 'plan', inicio: b.horaInicio, fin: b.horaFin, catId: b.categoria, titulo: b.titulo || '' })),
    ...regs.map(r => ({ tipo: 'real', inicio: r.inicio, fin: r.fin, catId: r.categoria, titulo: r.notas || '', reg: r })),
  ].sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.tipo === 'plan' ? -1 : 1));

  const cardLinea = ui.el('div', { class: 'tarjeta' },
    ui.el('div', { class: 'tarjeta-titulo' },
      ui.el('h3', {}, ui.icon('calendario'), 'Tu día'),
      ui.el('button', { class: 'btn btn-chico', onClick: () => modalRegistro(null, repintar) }, ui.icon('mas'), 'Cargar registro')));

  if (!items.length) {
    cardLinea.append(ui.estadoVacio('Nada por acá todavía. Iniciá una actividad o cargá un registro pasado.', 'reloj'));
  } else {
    for (const it of items) {
      const c = catDe(it.catId);
      const esReal = it.tipo === 'real';
      const estilo = esReal
        ? { border: '1px solid transparent', borderLeft: '4px solid ' + c.color, background: conAlfa(c.color, '2e') }
        : { border: '1.5px dashed ' + c.color, background: 'transparent' };
      cardLinea.append(ui.el('div', {
        style: { ...estilo, borderRadius: '10px', padding: '8px 12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' },
      },
        ui.el('strong', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, `${it.inicio}–${it.fin}`),
        ui.el('div', { style: { flex: 1, minWidth: 0 } },
          ui.el('div', { class: 'fila', style: { gap: '6px' } },
            ui.el('span', { style: { color: c.color, display: 'inline-flex' } }, ui.icon(c.icono)),
            ui.el('span', { style: { fontWeight: '600' } }, c.nombre),
            it.titulo ? ui.el('span', { class: 'texto-suave texto-chico' }, it.titulo) : null),
          ui.el('div', { class: 'texto-suave texto-chico' }, ui.fmtDuracion(durMin(it.inicio, it.fin)))),
        ui.el('span', { class: 'chip' + (esReal ? ' chip-ok' : '') }, esReal ? 'real' : 'plan'),
        esReal ? ui.el('div', { class: 'acciones', style: { display: 'flex', gap: '2px' } },
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalRegistro(it.reg, repintar) }, ui.icon('editar')),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
            if (!(await ui.confirmar('¿Eliminar este registro?'))) return;
            await db.del('registroTiempo', it.reg.id);
            ui.toast('Registro eliminado');
            repintar();
          } }, ui.icon('basura'))) : null));
    }
    cardLinea.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' },
      'Con borde punteado: lo planificado en tu plantilla semanal. Relleno: lo que registraste de verdad.'));
  }

  cont.append(cardCrono, metricas, cardLinea);
}

// ---------- Pestaña SEMANA (plantilla) ----------
function modalBloque(b, alGuardar) {
  if (!cats.length) return ui.toast('Primero creá una categoría (botón "Categorías")', 'error');
  const dia = b ? Number(b.dia) : Number(diaSel);
  const inIni = ui.campo({ tipo: 'time', etiqueta: 'Desde', valor: b?.horaInicio || '' });
  const inFin = ui.campo({ tipo: 'time', etiqueta: 'Hasta', valor: b?.horaFin || '' });
  const selCat = ui.campo({ tipo: 'select', etiqueta: 'Categoría', valor: b?.categoria || cats[0].id, opciones: cats.map(c => ({ v: c.id, t: c.nombre })) });
  const inTit = ui.campo({ tipo: 'text', etiqueta: 'Título (opcional)', valor: b?.titulo || '', placeholder: 'ej: Matemática, gimnasio…' });

  ui.modal({
    titulo: `${b ? 'Editar' : 'Nuevo'} bloque · ${ui.DIAS[dia]}`,
    cuerpo: ui.el('div', {},
      ui.el('div', { class: 'fila-campos' }, inIni, inFin),
      selCat, inTit,
      ui.el('p', { class: 'texto-suave texto-chico' }, 'Si "hasta" es menor que "desde", el bloque cruza la medianoche.')),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
        const hi = inIni.input.value, hf = inFin.input.value;
        if (!hi || !hf) return ui.toast('Completá las dos horas', 'error');
        if (hi === hf) return ui.toast('El inicio y el fin no pueden ser iguales', 'error');
        await db.put('bloquesHorario', {
          ...(b || {}), dia, horaInicio: hi, horaFin: hf,
          categoria: selCat.input.value, titulo: inTit.input.value.trim(),
        });
        cerrar();
        ui.toast('Bloque guardado');
        alGuardar();
      } },
    ],
  });
}

function modalCopiarDia(bloquesDia, alGuardar) {
  if (!bloquesDia.length) return ui.toast(`El ${ui.DIAS[diaSel]} no tiene bloques para copiar`, 'error');
  const checks = ORDEN_DIAS.filter(d => d !== diaSel).map(d => {
    const ch = ui.campo({ tipo: 'checkbox', etiqueta: ui.DIAS[d] });
    ch.dia = d;
    return ch;
  });
  const selModo = ui.campo({
    tipo: 'select', etiqueta: '¿Qué hacer con los bloques que ya existan en los días de destino?', valor: 'agregar',
    opciones: [{ v: 'agregar', t: 'Mantenerlos y agregar' }, { v: 'reemplazar', t: 'Reemplazarlos' }],
  });

  ui.modal({
    titulo: `Copiar ${ui.DIAS[diaSel]} a…`,
    cuerpo: ui.el('div', {}, checks, selModo),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Copiar', clase: 'btn-primario', onClick: async (cerrar) => {
        const dest = checks.filter(ch => ch.input.checked).map(ch => ch.dia);
        if (!dest.length) return ui.toast('Elegí al menos un día de destino', 'error');
        for (const d of dest) {
          if (selModo.input.value === 'reemplazar') {
            const existentes = await db.getBy('bloquesHorario', 'dia', d);
            for (const ex of existentes) await db.del('bloquesHorario', ex.id);
          }
          // copias sin id: db.put les genera uno nuevo
          await db.putMany('bloquesHorario', bloquesDia.map(b => ({
            dia: d, horaInicio: b.horaInicio, horaFin: b.horaFin, categoria: b.categoria, titulo: b.titulo || '',
          })));
        }
        cerrar();
        ui.toast(`Copiado a ${dest.length} día${dest.length > 1 ? 's' : ''}`);
        alGuardar();
      } },
    ],
  });
}

async function tabSemana(cont) {
  cont.innerHTML = '';
  await cargarCats();
  const repintar = () => tabSemana(cont);
  const bloques = (await db.getBy('bloquesHorario', 'dia', Number(diaSel)))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  const filaDias = ui.el('div', { class: 'fila mb' }, ORDEN_DIAS.map(d =>
    ui.el('button', {
      class: 'btn btn-chico' + (d === diaSel ? ' btn-primario' : ''),
      onClick: () => { diaSel = d; repintar(); },
    }, ui.DIAS_CORTO[d])));

  const total = bloques.reduce((s, b) => s + durMin(b.horaInicio, b.horaFin), 0);
  const pares = solapados(bloques);
  const filaInfo = ui.el('div', { class: 'fila mb' },
    ui.el('span', { class: 'chip chip-acento' }, ui.icon('reloj'), 'Planificado: ' + ui.fmtDuracion(total)),
    pares.length ? ui.el('span', {
      class: 'chip chip-alerta',
      title: pares.map(p => `${p[0].horaInicio} se pisa con ${p[1].horaInicio}`).join(' · '),
    }, ui.icon('info'), `${pares.length} solapamiento${pares.length > 1 ? 's' : ''}`) : null);

  const lista = ui.el('div');
  if (!bloques.length) {
    lista.append(ui.estadoVacio(`Sin bloques para el ${ui.DIAS[diaSel]}. Agregá el primero.`, 'calendario'));
  } else {
    for (const b of bloques) {
      const c = catDe(b.categoria);
      lista.append(ui.el('div', { class: 'lista-item' },
        ui.el('span', { class: 'punto-color', style: { background: c.color } }),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, `${b.horaInicio}–${b.horaFin} · ${c.nombre}`),
          ui.el('div', { class: 'sub' }, [b.titulo, ui.fmtDuracion(durMin(b.horaInicio, b.horaFin))].filter(Boolean).join(' · '))),
        ui.el('div', { class: 'acciones' },
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalBloque(b, repintar) }, ui.icon('editar')),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
            if (!(await ui.confirmar('¿Eliminar este bloque?'))) return;
            await db.del('bloquesHorario', b.id);
            ui.toast('Bloque eliminado');
            repintar();
          } }, ui.icon('basura')))));
    }
  }

  cont.append(ui.el('div', { class: 'tarjeta' },
    ui.el('h3', {}, 'Plantilla semanal'),
    ui.el('p', { class: 'texto-suave texto-chico' }, 'Armá el horario ideal de cada día. En "Hoy" lo vas a ver junto a lo que realmente hiciste.'),
    filaDias, filaInfo, lista,
    ui.el('div', { class: 'fila mt' },
      ui.el('button', { class: 'btn btn-primario', onClick: () => modalBloque(null, repintar) }, ui.icon('mas'), 'Agregar bloque'),
      ui.el('button', { class: 'btn', onClick: () => modalCopiarDia(bloques, repintar) }, ui.icon('copiar'), 'Copiar este día a…'))));
}

// ---------- Pestaña REGISTRO ----------
function rangoRegistro(tipo) {
  const hoy = ui.hoyISO();
  if (tipo === 'semana') { const l = lunesDe(hoy); return [l, isoSumar(l, 6)]; }
  if (tipo === 'semanaPasada') { const l = lunesDe(hoy); return [isoSumar(l, -7), isoSumar(l, -1)]; }
  if (tipo === 'mes') {
    const d = new Date();
    return [ui.hoyISO(new Date(d.getFullYear(), d.getMonth(), 1)), ui.hoyISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  }
  return null; // todo
}

async function tabRegistro(cont) {
  cont.innerHTML = '';
  await cargarCats();
  const repintar = () => tabRegistro(cont);
  const hoy = ui.hoyISO();

  const selRango = ui.campo({
    tipo: 'select', etiqueta: 'Período', valor: regRango,
    opciones: [{ v: 'semana', t: 'Esta semana' }, { v: 'semanaPasada', t: 'Semana pasada' }, { v: 'mes', t: 'Este mes' }, { v: 'todo', t: 'Todo' }],
  });
  const selCat = ui.campo({
    tipo: 'select', etiqueta: 'Categoría', valor: regCat,
    opciones: [{ v: '', t: 'Todas' }, ...cats.map(c => ({ v: c.id, t: c.nombre }))],
  });
  selRango.input.addEventListener('change', () => { regRango = selRango.input.value; repintar(); });
  selCat.input.addEventListener('change', () => { regCat = selCat.input.value; repintar(); });

  const r = rangoRegistro(regRango);
  let regs = r ? await db.getRango('registroTiempo', 'fecha', r[0], r[1]) : await db.getAll('registroTiempo');
  if (regCat) regs = regs.filter(x => x.categoria === regCat);
  const total = regs.reduce((s, x) => s + (x.minutos || 0), 0);

  cont.append(ui.el('div', { class: 'tarjeta' },
    ui.el('div', { class: 'fila-campos' }, selRango, selCat),
    ui.el('div', { class: 'fila espaciado' },
      ui.el('span', { class: 'chip chip-acento' }, ui.icon('reloj'), 'Total: ' + ui.fmtDuracion(total)),
      ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => modalRegistro(null, repintar) }, ui.icon('mas'), 'Agregar registro'))));

  if (!regs.length) {
    cont.append(ui.estadoVacio('No hay registros en este período. Cargá uno o usá el cronómetro en "Hoy".', 'reloj'));
    return;
  }

  // Agrupar por fecha (más reciente primero), con subtotal por día
  const grupos = {};
  for (const reg of regs) (grupos[reg.fecha] = grupos[reg.fecha] || []).push(reg);
  const fechas = Object.keys(grupos).sort().reverse();

  for (const fecha of fechas) {
    const delDia = grupos[fecha].sort((a, b) => a.inicio.localeCompare(b.inicio));
    const sub = delDia.reduce((s, x) => s + (x.minutos || 0), 0);
    const card = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, ui.fmtFecha(fecha), fecha === hoy ? ui.el('span', { class: 'chip chip-acento' }, 'hoy') : null),
        ui.el('span', { class: 'chip' }, ui.fmtDuracion(sub))));
    for (const reg of delDia) {
      const c = catDe(reg.categoria);
      card.append(ui.el('div', { class: 'lista-item' },
        ui.el('span', { class: 'punto-color', style: { background: c.color } }),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, c.nombre),
          ui.el('div', { class: 'sub' }, [`${reg.inicio}–${reg.fin} · ${ui.fmtDuracion(reg.minutos)}`, reg.notas].filter(Boolean).join(' · '))),
        ui.el('div', { class: 'acciones' },
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalRegistro(reg, repintar) }, ui.icon('editar')),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
            if (!(await ui.confirmar('¿Eliminar este registro?'))) return;
            await db.del('registroTiempo', reg.id);
            ui.toast('Registro eliminado');
            repintar();
          } }, ui.icon('basura')))));
    }
    cont.append(card);
  }
}

// ---------- Pestaña ESTADÍSTICAS ----------
function diasDeRango(tipo) {
  const hoy = ui.hoyISO();
  if (tipo === 'hoy') return [hoy];
  if (tipo === 'ayer') return [isoSumar(hoy, -1)];
  const l = lunesDe(hoy);
  const ini = tipo === 'semana' ? l : isoSumar(l, -7);
  return Array.from({ length: 7 }, (_, i) => isoSumar(ini, i));
}

async function tabStats(cont) {
  cont.innerHTML = '';
  await cargarCats();
  const hoy = ui.hoyISO();

  const selRango = ui.campo({
    tipo: 'select', etiqueta: 'Período', valor: statRango,
    opciones: [{ v: 'hoy', t: 'Hoy' }, { v: 'ayer', t: 'Ayer' }, { v: 'semana', t: 'Esta semana' }, { v: 'semanaPasada', t: 'Semana pasada' }],
  });
  selRango.input.addEventListener('change', () => { statRango = selRango.input.value; tabStats(cont); });
  cont.append(ui.el('div', { class: 'tarjeta' }, selRango));

  const dias = diasDeRango(statRango);
  const regs = await db.getRango('registroTiempo', 'fecha', dias[0], dias[dias.length - 1]);
  const bloques = await db.getAll('bloquesHorario');

  const realMin = {}, planMin = {};
  for (const reg of regs) realMin[reg.categoria] = (realMin[reg.categoria] || 0) + (reg.minutos || 0);
  for (const dISO of dias) {
    const dow = ui.desdeISO(dISO).getDay();
    for (const b of bloques) if (Number(b.dia) === dow)
      planMin[b.categoria] = (planMin[b.categoria] || 0) + durMin(b.horaInicio, b.horaFin);
  }

  // --- Torta: distribución real por categoría ---
  const datosTorta = Object.entries(realMin).filter(([, v]) => v > 0)
    .map(([id, v]) => { const c = catDe(id); return { etiqueta: c.nombre, valor: v, color: c.color }; })
    .sort((a, b) => b.valor - a.valor);
  const cardTorta = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('grafico'), ' Distribución real'));
  if (datosTorta.length) {
    const cv = ui.el('canvas', { class: 'grafico' });
    cardTorta.append(cv);
    ui.alPintar(() => ui.graficoTorta(cv, datosTorta));
  } else {
    cardTorta.append(ui.estadoVacio('Sin registros en este período.', 'grafico'));
  }

  // --- Barras: plan vs real por categoría (dos barras contiguas por categoría) ---
  const idsConDatos = [...new Set([...Object.keys(planMin), ...Object.keys(realMin)])]
    .filter(id => (planMin[id] || 0) > 0 || (realMin[id] || 0) > 0)
    .sort((a, b) => catDe(a).nombre.localeCompare(catDe(b).nombre, 'es'));
  const cardPvR = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('objetivo'), ' Plan vs. real'));
  if (idsConDatos.length) {
    const aHoras = m => Math.round((m / 60) * 10) / 10;
    const leyenda = ui.el('div', { class: 'fila mb' }, idsConDatos.map(id => {
      const c = catDe(id);
      return ui.el('span', { class: 'chip' }, ui.el('span', { class: 'punto-color', style: { background: c.color } }), c.nombre);
    }));
    const datos = idsConDatos.flatMap(id => {
      const c = catDe(id);
      return [
        { etiqueta: 'plan', valor: aHoras(planMin[id] || 0), color: conAlfa(c.color, '73') },
        { etiqueta: 'real', valor: aHoras(realMin[id] || 0), color: c.color },
      ];
    });
    const cv = ui.el('canvas', { class: 'grafico' });
    cardPvR.append(leyenda, cv,
      ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Barra clarita: planificado · barra llena: real (en horas, mismo orden que las etiquetas de arriba).'));
    ui.alPintar(() => ui.graficoBarras(cv, datos, { formato: v => v + 'h' }));
  } else {
    cardPvR.append(ui.estadoVacio('Sin plan ni registros en este período.', 'objetivo'));
  }

  // --- Línea: horas de sueño de los últimos 14 días ---
  const cardSueno = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('luna'), ' Sueño · últimos 14 días'));
  const cs = catSueno();
  if (!cs) {
    cardSueno.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' },
      'Creá una categoría llamada "Sueño" (y registrá cuánto dormís) para ver este gráfico.'));
  } else {
    const desde = isoSumar(hoy, -13);
    const regsS = (await db.getRango('registroTiempo', 'fecha', desde, hoy)).filter(x => x.categoria === cs.id);
    if (!regsS.length) {
      cardSueno.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' },
        'Todavía no hay registros de sueño. Usá el cronómetro al acostarte o cargalos a mano.'));
    } else {
      const porDia = {};
      for (const x of regsS) porDia[x.fecha] = (porDia[x.fecha] || 0) + (x.minutos || 0);
      const datos = Array.from({ length: 14 }, (_, i) => {
        const f = isoSumar(desde, i);
        const d = ui.desdeISO(f);
        return { etiqueta: `${d.getDate()}/${d.getMonth() + 1}`, valor: Math.round(((porDia[f] || 0) / 60) * 10) / 10 };
      });
      const cv = ui.el('canvas', { class: 'grafico' });
      cardSueno.append(cv, ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Horas dormidas por día (según la fecha de inicio del registro).'));
      ui.alPintar(() => ui.graficoLinea(cv, datos, { color: cs.color }));
    }
  }

  // --- Cumplimiento de objetivos diarios ---
  const cardObj = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('check'), ' Objetivos diarios'));
  const conObj = cats.filter(c => Number(c.objetivoMinDia) > 0);
  const diasTrans = Math.max(1, dias.filter(d => d <= hoy).length); // promedio sobre días ya transcurridos
  if (!conObj.length) {
    cardObj.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' },
      'Ninguna categoría tiene objetivo diario. Editá una desde "Categorías" y ponele uno.'));
  } else {
    for (const c of conObj) {
      const prom = Math.round((realMin[c.id] || 0) / diasTrans);
      const pct = Math.round((prom / c.objetivoMinDia) * 100);
      cardObj.append(ui.el('div', { class: 'mb' },
        ui.el('div', { class: 'fila espaciado', style: { marginBottom: '4px' } },
          ui.el('span', { class: 'fila', style: { gap: '6px' } },
            ui.el('span', { class: 'punto-color', style: { background: c.color } }), c.nombre),
          ui.el('span', { class: 'texto-chico ' + (pct >= 100 ? 'texto-ok' : 'texto-suave') }, pct + '%')),
        ui.barraProgreso(prom, c.objetivoMinDia, {
          color: c.color,
          texto: `${ui.fmtDuracion(prom)} / ${ui.fmtDuracion(c.objetivoMinDia)} por día`,
        })));
    }
    if (diasTrans > 1) cardObj.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' },
      `Promedio calculado sobre ${diasTrans} día${diasTrans > 1 ? 's' : ''} del período.`));
  }

  cont.append(cardTorta, cardPvR, cardSueno, cardObj);
}

// ---------- Render principal ----------
async function render(cont) {
  await sembrarSiHaceFalta();
  await cargarCats();

  cont.append(ui.el('div', { class: 'cabecera-modulo' },
    ui.el('h2', {}, ui.icon('reloj'), 'Tiempo'),
    ui.el('button', { class: 'btn btn-chico', onClick: () => modalCategorias() }, ui.icon('etiqueta'), 'Categorías')));

  tabsRef = ui.tabs([
    { id: 'hoy', texto: 'Hoy', render: c => tabHoy(c) },
    { id: 'semana', texto: 'Semana', render: c => tabSemana(c) },
    { id: 'registro', texto: 'Registro', render: c => tabRegistro(c) },
    { id: 'stats', texto: 'Estadísticas', render: c => tabStats(c) },
  ], cont);
}

export default { id: 'tiempo', nombre: 'Tiempo', icono: 'reloj', render };
