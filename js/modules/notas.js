// notas.js — Notas MIXTAS: cada nota combina libremente las partes que quieras
// (texto, lista de ítems, audio, imágenes) más etiquetas, fecha límite con
// urgencia, alarma y fijado.
//
// Modelo: todas las partes son opcionales e independientes. Una parte "está
// presente" si tiene contenido real (contenido no vacío / items.length / audioBlob
// / imagenes.length). Las notas viejas (con campo 'tipo') se leen igual porque sus
// datos ya viven en esos mismos campos; al guardar seguimos escribiendo un 'tipo'
// derivado para no romper a otros módulos que lo lean.
import { db } from '../db.js';
import { ui } from '../ui.js';

// Partes disponibles. ORDEN_PARTES es el orden fijo en el modal y en los chips.
const PARTES = {
  texto:    { t: 'Texto',    ic: 'nota' },
  lista:    { t: 'Lista',    ic: 'check' },
  audio:    { t: 'Audio',    ic: 'mic' },
  imagenes: { t: 'Imágenes', ic: 'copiar' },
};
const ORDEN_PARTES = ['texto', 'lista', 'audio', 'imagenes'];

// Filtros de contenido: acumulables (se piden TODAS las partes tildadas).
const FILTROS = [
  { id: 'texto',    t: 'Con texto',         ic: 'nota' },
  { id: 'lista',    t: 'Con lista',         ic: 'check' },
  { id: 'audio',    t: 'Con audio',         ic: 'mic' },
  { id: 'imagenes', t: 'Con imágenes',      ic: 'copiar' },
  { id: 'limite',   t: 'Con fecha límite',  ic: 'calendario' },
  { id: 'fijadas',  t: 'Fijadas',           ic: 'pin' },
];

// ---------- Presencia de partes ----------
const TIENE = {
  texto:    (n) => !!String(n.contenido || '').trim(),
  lista:    (n) => (n.items || []).length > 0,
  audio:    (n) => !!n.audioBlob,
  imagenes: (n) => (n.imagenes || []).length > 0,
};
function partesDe(n) { return ORDEN_PARTES.filter(p => TIENE[p](n)); }

// 'tipo' derivado, solo por compatibilidad con módulos que todavía lo leen.
function derivarTipo(n) {
  if ((n.items || []).length) return 'checklist';
  if (n.audioBlob) return 'audio';
  return 'texto';
}

// ---------- Helpers chicos ----------
function iconoMini(nombre, px) {
  const i = ui.icon(nombre);
  i.style.width = px + 'px'; i.style.height = px + 'px';
  return i;
}

function fmtSeg(s) { // 62 → '1:02'
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtFechaHora(isoCompleta) { // ISO completa → 'sáb 1 ago 14:30' (hora local)
  const d = new Date(isoCompleta);
  if (isNaN(d)) return '';
  return `${ui.fmtFecha(ui.hoyISO(d))} ${ui.ahoraHM(d)}`;
}

function extracto(txt, max = 140) { // primeras 2 líneas, recortadas
  if (!txt) return '';
  const lineas = txt.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).join(' · ');
  return lineas.length > max ? lineas.slice(0, max) + '…' : lineas;
}

function chipVencimiento(fechaLimite) {
  const d = ui.diasHasta(fechaLimite);
  let clase = 'chip', texto;
  if (d < 0)       { clase += ' chip-peligro'; texto = `Venció hace ${-d} ${-d === 1 ? 'día' : 'días'}`; }
  else if (d === 0){ clase += ' chip-peligro'; texto = 'Vence hoy'; }
  else if (d === 1){ clase += ' chip-peligro'; texto = 'Vence mañana'; }
  else if (d <= 3) { clase += ' chip-alerta';  texto = `Vence en ${d} días`; }
  else             { texto = ui.fmtFecha(fechaLimite); }
  return ui.el('span', { class: clase }, ui.icon('calendario'), texto);
}

// Chip de la parte "lista": muestra el progreso y se pone verde si está completa.
function chipLista(items) {
  const total = (items || []).length;
  if (!total) return null;
  const hechos = items.filter(i => i.hecho).length;
  return hechos === total
    ? ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), `Lista ${hechos}/${total} completa`)
    : ui.el('span', { class: 'chip' }, ui.icon('check'), `Lista ${hechos}/${total}`);
}

// Chips de todas las partes que tiene la nota (orden fijo).
function chipsPartes(nt) {
  const out = [];
  for (const p of partesDe(nt)) {
    if (p === 'texto') {
      out.push(ui.el('span', { class: 'chip' }, ui.icon('nota'), 'Texto'));
    } else if (p === 'lista') {
      const c = chipLista(nt.items); if (c) out.push(c);
    } else if (p === 'audio') {
      out.push(ui.el('span', { class: 'chip' }, ui.icon('mic'), nt.duracionAudio ? fmtSeg(nt.duracionAudio) : 'Audio'));
    } else {
      const cant = (nt.imagenes || []).length;
      out.push(ui.el('span', { class: 'chip' }, ui.icon('copiar'), `${cant} ${cant === 1 ? 'imagen' : 'imágenes'}`));
    }
  }
  return out;
}

// Si al cerrar un ui.confirmar todavía queda un modal abierto, hay que volver a
// trabar el scroll del body (cerrar() saca la clase para el modal que él abrió).
function reTrabarScroll() {
  if (document.querySelector('.modal-overlay')) document.body.classList.add('modal-abierto');
}

// Alarmas asociadas a una nota (el store solo indexa por fecha, filtramos por refId)
async function alarmasDeNota(idNota) {
  const todas = await db.getAll('alarmas');
  return todas.filter(a => a.refTipo === 'nota' && a.refId === idNota);
}

// Crea/actualiza/borra el registro del store alarmas según nota.alarma
async function sincronizarAlarma(nota) {
  const asociadas = await alarmasDeNota(nota.id);
  if (nota.alarma) {
    const reg = asociadas.shift() || { refTipo: 'nota', refId: nota.id, disparada: false, repetir: null };
    const cambioFecha = reg.fecha !== nota.alarma;
    reg.fecha = nota.alarma;
    reg.mensaje = nota.titulo || 'Nota';
    if (cambioFecha) {
      const ahoraStr = `${ui.hoyISO()}T${ui.ahoraHM()}`;
      reg.disparada = nota.alarma <= ahoraStr; // en el pasado: no la hacemos sonar
      if (reg.disparada) ui.toast('Ojo: esa alarma quedó en el pasado, no va a sonar.', 'info', 3500);
    }
    await db.put('alarmas', reg);
    for (const extra of asociadas) await db.del('alarmas', extra.id); // limpiar duplicadas
  } else {
    for (const a of asociadas) await db.del('alarmas', a.id);
  }
}

// Datos iniciales (solo la primera vez; si el usuario los borra no se re-siembran)
async function sembrar() {
  try {
    if (await db.getSetting('notas.sembrado', false)) return;
    if ((await db.count('notas')) === 0) {
      const iso = new Date().toISOString();
      const en5 = new Date(); en5.setDate(en5.getDate() + 5);
      const base = {
        contenido: '', items: [], audioBlob: null, mime: null, duracionAudio: null,
        imagenes: [], fecha: ui.hoyISO(), fechaLimite: null, alarma: null,
        etiquetas: [], fijada: false, creada: iso, modificada: iso,
      };
      await db.putMany('notas', [
        {
          ...base, titulo: 'Cómo usar Notas', tipo: 'texto', fijada: true, etiquetas: ['ideas'],
          contenido: 'Las notas son mixtas: con los chips "+ Texto", "+ Lista", "+ Audio" y "+ Imágenes" \n' +
            'armás cada nota con las partes que necesites, y las combinás como quieras.\n' +
            'Podés sumarles etiquetas, fecha límite y alarma, y fijar las importantes arriba.\n' +
            'Esta nota es de ejemplo: editala o borrala tranquilo.',
        },
        {
          ...base, titulo: 'Pendientes de la semana', tipo: 'checklist',
          etiquetas: ['escuela'], fechaLimite: ui.hoyISO(en5),
          contenido: 'Ejemplo de nota mixta: texto arriba y lista abajo.',
          items: [
            { texto: 'Terminar el TP de Historia', hecho: false },
            { texto: 'Comprar hojas rayadas', hecho: true },
            { texto: 'Pedir los apuntes de Física', hecho: false },
          ],
        },
      ]);
    }
    await db.setSetting('notas.sembrado', true);
  } catch (e) { console.warn('No se pudieron sembrar las notas:', e); }
}

// ---------- Render principal ----------
async function render(cont) {
  await sembrar();

  // Estado de la pantalla
  let cacheNotas = [];
  let busqueda = '';
  const filtros = new Set(); // vacío = "Todas"
  let filtroEtiqueta = null;
  let orden = 'recientes'; // 'recientes' | 'limite'
  let urlsLista = [];      // object URLs de la lista (se revocan en cada repintado)

  // Cabecera
  cont.append(ui.el('div', { class: 'cabecera-modulo' }, ui.el('h2', {}, ui.icon('nota'), 'Notas')));

  // Búsqueda
  const inBusca = ui.el('input', {
    class: 'input', type: 'search',
    placeholder: 'Buscar en títulos, contenido, ítems y etiquetas…',
    'aria-label': 'Buscar notas',
  });
  inBusca.addEventListener('input', () => { busqueda = inBusca.value; pintarLista(); });
  const icBusca = ui.icon('buscar'); icBusca.style.color = 'var(--texto-suave)';
  cont.append(ui.el('div', { class: 'fila mb', style: { gap: '8px', flexWrap: 'nowrap' } }, icBusca, inBusca));

  // Filtros + lista
  const contFiltros = ui.el('div');
  const contLista = ui.el('div', { class: 'mt' });
  cont.append(contFiltros, contLista);

  // Botón flotante crear
  cont.append(ui.el('button', {
    class: 'btn-flotante', 'aria-label': 'Nueva nota',
    onClick: () => abrirEditor(null),
  }, ui.icon('mas')));

  function chipBtn(texto, activo, onClick, icono) {
    return ui.el('span', {
      class: 'chip' + (activo ? ' chip-acento' : ''),
      role: 'button', tabindex: '0',
      style: { cursor: 'pointer', userSelect: 'none' },
      onClick,
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
    }, icono ? ui.icon(icono) : null, texto);
  }

  function pintarFiltros() {
    contFiltros.innerHTML = '';
    // Contenido (acumulables)
    const filaTipos = ui.el('div', { class: 'fila', style: { gap: '6px' } });
    filaTipos.append(chipBtn('Todas', filtros.size === 0, () => {
      filtros.clear(); pintarFiltros(); pintarLista();
    }));
    for (const f of FILTROS) {
      filaTipos.append(chipBtn(f.t, filtros.has(f.id), () => {
        if (filtros.has(f.id)) filtros.delete(f.id); else filtros.add(f.id);
        pintarFiltros(); pintarLista();
      }, f.ic));
    }
    contFiltros.append(filaTipos);
    // Orden
    contFiltros.append(ui.el('div', { class: 'fila', style: { gap: '6px', marginTop: '8px' } },
      ui.el('span', { class: 'texto-suave texto-chico' }, 'Ordenar:'),
      chipBtn('Recientes', orden === 'recientes', () => { orden = 'recientes'; pintarFiltros(); pintarLista(); }, 'reloj'),
      chipBtn('Fecha límite', orden === 'limite', () => { orden = 'limite'; pintarFiltros(); pintarLista(); }, 'calendario')));
    // Etiquetas existentes
    const tags = [...new Set(cacheNotas.flatMap(x => x.etiquetas || []))].sort((a, b) => a.localeCompare(b));
    if (filtroEtiqueta && !tags.includes(filtroEtiqueta)) filtroEtiqueta = null;
    if (tags.length) {
      const filaTags = ui.el('div', { class: 'fila', style: { gap: '6px', marginTop: '8px' } },
        ui.el('span', { class: 'texto-suave texto-chico' }, 'Etiquetas:'));
      for (const t of tags) {
        filaTags.append(chipBtn(t, filtroEtiqueta === t, () => {
          filtroEtiqueta = filtroEtiqueta === t ? null : t;
          pintarFiltros(); pintarLista();
        }, 'etiqueta'));
      }
      contFiltros.append(filaTags);
    }
  }

  function pasaFiltros(nt) {
    for (const f of filtros) {
      if (f === 'limite') { if (!nt.fechaLimite) return false; }
      else if (f === 'fijadas') { if (!nt.fijada) return false; }
      else if (!TIENE[f](nt)) return false;
    }
    return true;
  }

  function pintarLista() {
    urlsLista.forEach(u => URL.revokeObjectURL(u));
    urlsLista = [];
    contLista.innerHTML = '';

    let lista = cacheNotas.filter(pasaFiltros);
    if (filtroEtiqueta) lista = lista.filter(x => (x.etiquetas || []).includes(filtroEtiqueta));
    const q = busqueda.trim().toLowerCase();
    if (q) {
      const hay = t => String(t || '').toLowerCase().includes(q);
      lista = lista.filter(x => hay(x.titulo) || hay(x.contenido) ||
        (x.etiquetas || []).some(hay) || (x.items || []).some(i => hay(i.texto)));
    }

    if (!lista.length) {
      contLista.append(ui.estadoVacio(cacheNotas.length
        ? 'Ninguna nota coincide con la búsqueda o los filtros.'
        : 'Todavía no tenés notas. Tocá el + para crear la primera.', 'nota'));
      return;
    }

    lista.sort((a, b) => {
      const f = (b.fijada ? 1 : 0) - (a.fijada ? 1 : 0);
      if (f) return f;
      if (orden === 'limite') {
        const fa = a.fechaLimite || '~', fb = b.fechaLimite || '~'; // '~' manda las sin límite al final
        if (fa !== fb) return fa < fb ? -1 : 1;
      }
      return (b.modificada || '').localeCompare(a.modificada || '');
    });

    for (const nt of lista) contLista.append(tarjetaNota(nt));
  }

  function tarjetaNota(nt) {
    const card = ui.el('div', {
      class: 'tarjeta', style: { cursor: 'pointer' },
      onClick: () => abrirEditor(nt),
    });

    // Título + acciones
    const icPin = iconoMini('pin', 16); icPin.style.color = 'var(--acento)';
    card.append(ui.el('div', { class: 'fila espaciado', style: { flexWrap: 'nowrap' } },
      ui.el('div', { class: 'fila', style: { gap: '7px', minWidth: 0, flexWrap: 'nowrap' } },
        nt.fijada ? icPin : null,
        ui.el('strong', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, nt.titulo || 'Sin título')),
      ui.el('div', { class: 'acciones' },
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar nota', onClick: (e) => { e.stopPropagation(); abrirEditor(nt); } }, ui.icon('editar')),
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar nota', onClick: (e) => { e.stopPropagation(); borrarNota(nt); } }, ui.icon('basura')))));

    // Chips: una por cada parte presente + vencimiento, alarma y etiquetas
    const chips = ui.el('div', { class: 'fila', style: { gap: '6px', marginTop: '6px' } });
    for (const c of chipsPartes(nt)) chips.append(c);
    if (nt.fechaLimite) chips.append(chipVencimiento(nt.fechaLimite));
    if (nt.alarma) chips.append(ui.el('span', { class: 'chip' }, ui.icon('alarma'), fmtFechaHora(nt.alarma) || nt.alarma));
    for (const t of (nt.etiquetas || [])) {
      chips.append(ui.el('span', {
        class: 'chip chip-acento', role: 'button',
        style: { cursor: 'pointer' },
        onClick: (e) => { e.stopPropagation(); filtroEtiqueta = filtroEtiqueta === t ? null : t; pintarFiltros(); pintarLista(); },
      }, ui.icon('etiqueta'), t));
    }
    if (chips.childNodes.length) card.append(chips);

    // Cuerpo: primero el extracto del texto, después la lista marcable
    const ex = extracto(nt.contenido);
    if (ex) card.append(ui.el('p', { class: 'texto-suave texto-chico', style: { margin: '6px 0 0' } }, ex));

    if ((nt.items || []).length) {
      const contItems = ui.el('div', { style: { marginTop: '6px' } });
      nt.items.slice(0, 4).forEach((it) => {
        const chk = ui.el('input', { type: 'checkbox', checked: it.hecho, 'aria-label': 'Marcar ' + it.texto });
        chk.addEventListener('change', async () => {
          it.hecho = chk.checked;
          try { await db.put('notas', nt); } catch (e) { ui.toast('No se pudo guardar el cambio: ' + e.message, 'error'); }
          pintarLista(); // sin tocar "modificada" para que la nota no salte de lugar
        });
        contItems.append(ui.el('label', {
          class: 'fila', style: { gap: '8px', marginTop: '4px', cursor: 'pointer', flexWrap: 'nowrap' },
          onClick: (e) => e.stopPropagation(),
        }, chk, ui.el('span', {
          class: 'texto-chico',
          style: it.hecho ? { textDecoration: 'line-through', color: 'var(--texto-suave)' } : {},
        }, it.texto)));
      });
      if (nt.items.length > 4) contItems.append(ui.el('div', { class: 'texto-suave texto-chico', style: { marginTop: '4px' } }, `+${nt.items.length - 4} ítems más`));
      card.append(contItems);
    }

    // Miniaturas
    if ((nt.imagenes || []).length) {
      const filaImg = ui.el('div', { class: 'fila', style: { gap: '6px', marginTop: '8px' } });
      nt.imagenes.slice(0, 4).forEach(b => {
        const url = URL.createObjectURL(b); urlsLista.push(url);
        filaImg.append(ui.el('img', {
          src: url, alt: 'Imagen de la nota',
          style: { width: '52px', height: '52px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--borde)', cursor: 'zoom-in' },
          onClick: (e) => { e.stopPropagation(); verImagen(b); },
        }));
      });
      if (nt.imagenes.length > 4) filaImg.append(ui.el('span', { class: 'chip' }, `+${nt.imagenes.length - 4}`));
      card.append(filaImg);
    }

    return card;
  }

  function verImagen(blob) {
    const url = URL.createObjectURL(blob);
    ui.modal({
      titulo: 'Imagen',
      ancho: '760px',
      cuerpo: ui.el('img', { src: url, alt: 'Imagen ampliada', style: { maxWidth: '100%', borderRadius: '10px', display: 'block', margin: '0 auto 10px' } }),
      alCerrar: () => { URL.revokeObjectURL(url); reTrabarScroll(); },
    });
  }

  async function borrarNota(nt) {
    if (!(await ui.confirmar(`¿Borrar la nota "${nt.titulo || 'Sin título'}"? Si tiene alarma, también se borra.`))) return;
    try {
      for (const a of await alarmasDeNota(nt.id)) await db.del('alarmas', a.id);
      await db.del('notas', nt.id);
      ui.toast('Nota borrada');
    } catch (e) { ui.toast('No se pudo borrar: ' + e.message, 'error'); }
    await recargar();
  }

  // ---------- Editor (crear / editar) ----------
  async function abrirEditor(nota) {
    // Copia de trabajo para no tocar la cache hasta guardar
    const n = nota ? {
      ...nota,
      contenido: nota.contenido || '',
      items: (nota.items || []).map(i => ({ ...i })),
      etiquetas: [...(nota.etiquetas || [])],
      imagenes: [...(nota.imagenes || [])],
      audioBlob: nota.audioBlob || null,
    } : {
      titulo: '', contenido: '', items: [], audioBlob: null, mime: null,
      duracionAudio: null, imagenes: [], fecha: ui.hoyISO(), fechaLimite: null,
      alarma: null, etiquetas: [], fijada: false,
    };

    // Qué secciones arrancan desplegadas: las partes que la nota ya tiene.
    // En una nota nueva abrimos texto, que es lo más común (se puede quitar).
    const abiertas = { texto: false, lista: false, audio: false, imagenes: false };
    for (const p of ORDEN_PARTES) abiertas[p] = TIENE[p](n);
    if (!nota) abiertas.texto = true;

    const etiquetasExistentes = [...new Set(cacheNotas.flatMap(x => x.etiquetas || []))].sort((a, b) => a.localeCompare(b));
    const urlsImgs = [];
    const urlsAudio = [];
    const secciones = { texto: null, lista: null, audio: null, imagenes: null };
    let pintarImgs = () => {};
    let pintarAudio = () => {};

    const cuerpo = ui.el('div');
    const inTitulo = ui.campo({ tipo: 'text', etiqueta: 'Título', valor: n.titulo, placeholder: '¿De qué es la nota?' });

    // --- Fila para agregar partes ---
    const contAgregar = ui.el('div', { class: 'campo' });
    const contPartes = ui.el('div');

    function pintarAgregar() {
      contAgregar.innerHTML = '';
      const faltan = ORDEN_PARTES.filter(p => !abiertas[p]);
      contAgregar.append(ui.el('span', { class: 'campo-etiqueta' },
        faltan.length ? 'Armá la nota con las partes que quieras' : 'La nota ya tiene las cuatro partes'));
      if (!faltan.length) return;
      const fila = ui.el('div', { class: 'fila', style: { gap: '6px' } });
      for (const p of faltan) {
        const agregar = () => agregarParte(p);
        fila.append(ui.el('span', {
          class: 'chip', role: 'button', tabindex: '0',
          style: { cursor: 'pointer', userSelect: 'none' },
          onClick: agregar,
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); agregar(); } },
        }, ui.icon('mas'), PARTES[p].t));
      }
      contAgregar.append(fila);
    }

    // Reordena/monta las secciones abiertas en el orden fijo (append mueve el nodo,
    // así no se pierde lo que el usuario ya escribió).
    function pintarPartes() {
      for (const p of ORDEN_PARTES) {
        if (abiertas[p]) {
          if (!secciones[p]) secciones[p] = crearSeccion(p);
          contPartes.append(secciones[p]);
        } else if (secciones[p]) {
          secciones[p].remove();
          secciones[p] = null;
        }
      }
      pintarAgregar();
    }

    function agregarParte(p) {
      abiertas[p] = true;
      pintarPartes();
      if (p === 'texto' || p === 'lista') {
        const foco = secciones[p] && secciones[p].querySelector('textarea, input:not([type="file"]):not([type="checkbox"])');
        if (foco) ui.alPintar(() => foco.focus());
      }
    }

    async function quitarParte(p) {
      if (TIENE[p](n)) {
        const ok = await ui.confirmar(`¿Quitar ${PARTES[p].t.toLowerCase()} de la nota? Se pierde lo que cargaste ahí.`, 'Quitar');
        reTrabarScroll();
        if (!ok) return;
      }
      if (p === 'texto') n.contenido = '';
      else if (p === 'lista') n.items = [];
      else if (p === 'audio') {
        urlsAudio.forEach(u => URL.revokeObjectURL(u)); urlsAudio.length = 0;
        n.audioBlob = null; n.mime = null; n.duracionAudio = null;
      } else {
        urlsImgs.forEach(u => URL.revokeObjectURL(u)); urlsImgs.length = 0;
        n.imagenes = [];
      }
      abiertas[p] = false;
      pintarPartes();
    }

    function cabeceraParte(p) {
      return ui.el('div', { class: 'fila espaciado', style: { flexWrap: 'nowrap', marginBottom: '4px' } },
        ui.el('span', { class: 'campo-etiqueta', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          iconoMini(PARTES[p].ic, 15), PARTES[p].t),
        ui.el('button', {
          class: 'btn-icono', 'aria-label': 'Quitar ' + PARTES[p].t, title: 'Quitar ' + PARTES[p].t,
          onClick: () => quitarParte(p),
        }, ui.icon('cerrar')));
    }

    // --- Sección texto ---
    function seccionTexto() {
      const wrap = ui.el('div', { class: 'campo' }, cabeceraParte('texto'));
      const ta = ui.el('textarea', { class: 'input', rows: 5, placeholder: 'Escribí acá…', 'aria-label': 'Texto de la nota' });
      ta.value = n.contenido || '';
      ta.addEventListener('input', () => { n.contenido = ta.value; });
      wrap.append(ta);
      return wrap;
    }

    // --- Sección lista ---
    function seccionLista() {
      const wrap = ui.el('div', { class: 'campo' }, cabeceraParte('lista'));
      const contItems = ui.el('div');
      const inNuevo = ui.el('input', { class: 'input', placeholder: 'Escribí un ítem y apretá Enter…', 'aria-label': 'Nuevo ítem' });
      const agregar = () => {
        const t = inNuevo.value.trim();
        if (!t) return;
        n.items.push({ texto: t, hecho: false });
        inNuevo.value = '';
        pintarItems();
        inNuevo.focus();
      };
      inNuevo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });

      function pintarItems() {
        contItems.innerHTML = '';
        if (!n.items.length) contItems.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'Todavía no hay ítems.'));
        n.items.forEach((it, i) => {
          const chk = ui.el('input', { type: 'checkbox', checked: it.hecho, 'aria-label': 'Marcar ' + it.texto });
          chk.addEventListener('change', () => { it.hecho = chk.checked; pintarItems(); });
          const icArriba = iconoMini('flecha_izq', 16); icArriba.style.transform = 'rotate(90deg)';
          const icAbajo = iconoMini('flecha_der', 16); icAbajo.style.transform = 'rotate(90deg)';
          const btnArriba = ui.el('button', {
            class: 'btn-icono', 'aria-label': 'Subir ítem',
            style: i === 0 ? { opacity: '.3' } : {},
            onClick: () => { if (i > 0) { [n.items[i - 1], n.items[i]] = [n.items[i], n.items[i - 1]]; pintarItems(); } },
          }, icArriba);
          const btnAbajo = ui.el('button', {
            class: 'btn-icono', 'aria-label': 'Bajar ítem',
            style: i === n.items.length - 1 ? { opacity: '.3' } : {},
            onClick: () => { if (i < n.items.length - 1) { [n.items[i], n.items[i + 1]] = [n.items[i + 1], n.items[i]]; pintarItems(); } },
          }, icAbajo);
          contItems.append(ui.el('div', { class: 'lista-item' },
            chk,
            ui.el('span', {
              class: 'principal',
              style: it.hecho ? { textDecoration: 'line-through', color: 'var(--texto-suave)' } : {},
            }, it.texto),
            ui.el('div', { class: 'acciones' }, btnArriba, btnAbajo,
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar ítem', onClick: () => { n.items.splice(i, 1); pintarItems(); } }, ui.icon('basura')))));
        });
      }
      pintarItems();
      wrap.append(contItems, ui.el('div', { class: 'fila', style: { flexWrap: 'nowrap', marginTop: '6px' } },
        inNuevo, ui.el('button', { class: 'btn btn-chico', onClick: agregar }, ui.icon('mas'), 'Agregar')));
      return wrap;
    }

    // --- Sección audio ---
    function seccionAudio() {
      const wrap = ui.el('div', { class: 'campo' }, cabeceraParte('audio'));
      const body = ui.el('div');
      const grabar = async () => {
        const r = await ui.grabarAudio('Grabar nota de voz'); // maneja permisos y errores con su propio toast
        reTrabarScroll();
        if (r) { n.audioBlob = r.blob; n.mime = r.mime; n.duracionAudio = r.duracion; pintarAudio(); }
      };
      pintarAudio = () => {
        urlsAudio.forEach(u => URL.revokeObjectURL(u)); urlsAudio.length = 0;
        body.innerHTML = '';
        if (n.audioBlob) {
          const url = URL.createObjectURL(n.audioBlob); urlsAudio.push(url);
          body.append(
            ui.el('audio', { controls: true, src: url, class: 'reproductor' }),
            ui.el('div', { class: 'fila', style: { marginTop: '8px' } },
              n.duracionAudio ? ui.el('span', { class: 'chip' }, ui.icon('mic'), fmtSeg(n.duracionAudio)) : null,
              ui.el('button', { class: 'btn btn-chico', onClick: grabar }, ui.icon('mic'), 'Regrabar'),
              ui.el('button', {
                class: 'btn btn-chico btn-peligro',
                onClick: () => { n.audioBlob = null; n.mime = null; n.duracionAudio = null; pintarAudio(); },
              }, ui.icon('basura'), 'Borrar grabación')));
        } else {
          body.append(
            ui.el('button', { class: 'btn btn-primario', onClick: grabar }, ui.icon('mic'), 'Grabar audio'),
            ui.el('p', { class: 'texto-suave texto-chico', style: { margin: '6px 0 0' } },
              'Si no grabás nada, la nota se guarda igual sin audio.'));
        }
      };
      wrap.append(body);
      pintarAudio();
      return wrap;
    }

    // --- Sección imágenes ---
    function seccionImagenes() {
      const wrap = ui.el('div', { class: 'campo' }, cabeceraParte('imagenes'));
      const body = ui.el('div');
      const inFile = ui.el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'oculto', 'aria-label': 'Elegir imágenes' });
      inFile.addEventListener('change', () => {
        const fs = Array.from(inFile.files || []);
        if (!fs.length) return;
        let agregadas = 0;
        for (const f of fs) if (f.type.startsWith('image/')) { n.imagenes.push(f); agregadas++; }
        if (agregadas < fs.length) ui.toast('Algunos archivos no eran imágenes y se ignoraron.', 'error');
        inFile.value = '';
        pintarImgs();
      });
      pintarImgs = () => {
        urlsImgs.forEach(u => URL.revokeObjectURL(u)); urlsImgs.length = 0;
        body.innerHTML = '';
        const fila = ui.el('div', { class: 'fila', style: { gap: '10px' } });
        n.imagenes.forEach((b, i) => {
          const url = URL.createObjectURL(b); urlsImgs.push(url);
          const btnDel = ui.el('button', {
            'aria-label': 'Borrar imagen',
            style: {
              position: 'absolute', top: '-6px', right: '-6px', width: '22px', height: '22px',
              borderRadius: '50%', border: '0', background: 'var(--peligro)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0',
            },
            onClick: () => { n.imagenes.splice(i, 1); pintarImgs(); },
          }, iconoMini('cerrar', 12));
          fila.append(ui.el('div', { style: { position: 'relative' } },
            ui.el('img', {
              src: url, alt: 'Imagen ' + (i + 1),
              style: { width: '74px', height: '74px', objectFit: 'cover', borderRadius: '10px', border: '1px solid var(--borde)', cursor: 'zoom-in', display: 'block' },
              onClick: () => verImagen(b),
            }), btnDel));
        });
        fila.append(ui.el('button', { class: 'btn btn-chico', onClick: () => inFile.click() }, ui.icon('subir'), 'Agregar imágenes'));
        body.append(fila);
      };
      wrap.append(body, inFile);
      pintarImgs();
      return wrap;
    }

    function crearSeccion(p) {
      if (p === 'texto') return seccionTexto();
      if (p === 'lista') return seccionLista();
      if (p === 'audio') return seccionAudio();
      return seccionImagenes();
    }

    // --- Fechas y alarma ---
    const inFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha', valor: n.fecha || ui.hoyISO() });
    const inLimite = ui.campo({ tipo: 'date', etiqueta: 'Fecha límite (opcional)', valor: n.fechaLimite || '' });
    const inAlarma = ui.campo({ tipo: 'datetime-local', etiqueta: 'Alarma (opcional)', valor: n.alarma || '' });

    // --- Etiquetas ---
    const contEtiq = ui.el('div', { class: 'campo' });
    function pintarEtiq() {
      contEtiq.innerHTML = '';
      contEtiq.append(ui.el('span', { class: 'campo-etiqueta' }, 'Etiquetas'));
      if (n.etiquetas.length) {
        const fila = ui.el('div', { class: 'fila', style: { gap: '6px' } });
        for (const t of n.etiquetas) {
          fila.append(ui.el('span', { class: 'chip chip-acento' }, ui.icon('etiqueta'), t,
            ui.el('span', {
              role: 'button', 'aria-label': 'Quitar etiqueta ' + t,
              style: { cursor: 'pointer', display: 'inline-flex' },
              onClick: () => { n.etiquetas = n.etiquetas.filter(x => x !== t); pintarEtiq(); },
            }, ui.icon('cerrar'))));
        }
        contEtiq.append(fila);
      }
      const inTag = ui.el('input', { class: 'input', placeholder: 'Nueva etiqueta y Enter…', 'aria-label': 'Nueva etiqueta' });
      const agregarTag = (valor) => {
        const t = (valor ?? inTag.value).trim().toLowerCase().replace(/\s+/g, ' ');
        if (!t) return;
        if (n.etiquetas.includes(t)) { ui.toast('Esa etiqueta ya está.', 'info'); return; }
        n.etiquetas.push(t);
        inTag.value = '';
        pintarEtiq();
      };
      inTag.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregarTag(); } });
      contEtiq.append(ui.el('div', { class: 'fila', style: { flexWrap: 'nowrap', marginTop: '6px' } },
        inTag, ui.el('button', { class: 'btn btn-chico', onClick: () => agregarTag() }, ui.icon('mas'), 'Agregar')));
      const sugerencias = etiquetasExistentes.filter(t => !n.etiquetas.includes(t));
      if (sugerencias.length) {
        const filaSug = ui.el('div', { class: 'fila', style: { gap: '6px', marginTop: '6px' } },
          ui.el('span', { class: 'texto-suave texto-chico' }, 'Sugeridas:'));
        for (const t of sugerencias) {
          filaSug.append(ui.el('span', {
            class: 'chip', role: 'button', style: { cursor: 'pointer' },
            onClick: () => agregarTag(t),
          }, ui.icon('etiqueta'), t));
        }
        contEtiq.append(filaSug);
      }
    }
    pintarEtiq();

    const chkFijada = ui.campo({ tipo: 'checkbox', etiqueta: 'Fijar arriba de la lista', valor: n.fijada });

    // Armar cuerpo
    cuerpo.append(inTitulo, contAgregar, contPartes,
      ui.el('div', { class: 'fila-campos' }, inFecha, inLimite),
      inAlarma,
      ui.el('p', { class: 'texto-suave texto-chico', style: { marginTop: '-6px' } },
        'La alarma suena mientras la app esté abierta. Para quitarla, borrá el valor del campo.'),
      contEtiq, chkFijada);
    if (nota && nota.creada) {
      cuerpo.append(ui.el('p', { class: 'texto-suave texto-chico mt' },
        `Creada: ${fmtFechaHora(nota.creada)} · Última modificación: ${fmtFechaHora(nota.modificada || nota.creada)}`));
    }
    pintarPartes();

    ui.modal({
      titulo: nota ? 'Editar nota' : 'Nueva nota',
      cuerpo,
      ancho: '720px',
      alCerrar: () => {
        urlsImgs.forEach(u => URL.revokeObjectURL(u)); urlsImgs.length = 0;
        urlsAudio.forEach(u => URL.revokeObjectURL(u)); urlsAudio.length = 0;
      },
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        {
          texto: 'Guardar', clase: 'btn-primario',
          onClick: async (cerrar) => {
            const titulo = inTitulo.input.value.trim();
            const contenido = String(n.contenido || '').trim();
            const items = n.items.filter(i => String(i.texto || '').trim());
            const candidata = { contenido, items, audioBlob: n.audioBlob, imagenes: n.imagenes };
            if (!titulo && !partesDe(candidata).length) {
              ui.toast('La nota está vacía: ponele un título o agregale alguna parte.', 'error', 3200);
              return;
            }
            const ahoraIso = new Date().toISOString();
            const reg = {
              ...(nota || {}), // conserva id, lugarId y campos futuros
              titulo,
              tipo: derivarTipo(candidata), // derivado, por compatibilidad
              contenido,
              items,
              audioBlob: n.audioBlob || null,
              mime: n.audioBlob ? (n.mime || null) : null,
              duracionAudio: n.audioBlob ? (n.duracionAudio || null) : null,
              imagenes: n.imagenes,
              fecha: inFecha.input.value || ui.hoyISO(),
              fechaLimite: inLimite.input.value || null,
              alarma: inAlarma.input.value || null,
              etiquetas: n.etiquetas,
              fijada: chkFijada.input.checked,
              creada: (nota && nota.creada) || ahoraIso,
              modificada: ahoraIso,
            };
            try {
              const guardada = await db.put('notas', reg);
              await sincronizarAlarma(guardada);
            } catch (e) {
              ui.toast('No se pudo guardar: ' + e.message, 'error');
              return;
            }
            cerrar();
            ui.toast(nota ? 'Nota actualizada' : 'Nota creada');
            await recargar();
          },
        },
      ],
    });
    if (!nota) ui.alPintar(() => inTitulo.input.focus());
  }

  async function recargar() {
    try { cacheNotas = await db.getAll('notas'); }
    catch (e) { ui.toast('No se pudieron cargar las notas: ' + e.message, 'error'); cacheNotas = []; }
    pintarFiltros();
    pintarLista();
  }

  await recargar();
}

export default { id: 'notas', nombre: 'Notas', icono: 'nota', render };
