// ui.js — Helpers de interfaz compartidos por todos los módulos.
// import { ui } from '../ui.js';

// ---------- Iconos (SVG inline, stroke = currentColor) ----------
const ICONOS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  libro: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  comida: '<path d="M7 2v9a2 2 0 0 0 2 2v9"/><path d="M5 2v5M9 2v5"/><path d="M17 2c-2 2-2.5 5-2.5 8H17v12"/>',
  gota: '<path d="M12 2.7 6.6 9.8a6.5 6.5 0 1 0 10.8 0z"/>',
  nota: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  dinero: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M15 8.8c-.6-1-1.7-1.4-3-1.4-1.6 0-2.9.8-2.9 2.2 0 2.9 6 1.5 6 4.4 0 1.5-1.4 2.3-3.1 2.3-1.4 0-2.6-.5-3.2-1.6"/>',
  mapa: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/>',
  musica: '<circle cx="6.5" cy="17.5" r="2.8"/><circle cx="17.5" cy="15.5" r="2.8"/><path d="M9.3 17.5V5.7L20.3 3.5v12"/>',
  ajustes: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  basura: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1.6 1.6 0 0 0 1.6 1.5h6.8A1.6 1.6 0 0 0 17 20l1-13"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  editar: '<path d="M17 3.5a2.4 2.4 0 0 1 3.4 3.4L8 19.3 3.5 20.5 4.7 16z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pausa: '<path d="M7.5 4.5v15M16.5 4.5v15"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.5M8.5 21.5h7"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 2.8V7M16 2.8V7"/>',
  alarma: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 2M4.5 4 2.5 6M19.5 4l2 2"/>',
  grafico: '<path d="M4 20h16"/><path d="M6.5 20v-6M11 20V9M15.5 20v-9M20 20V5"/>',
  descargar: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 18.5V20a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 20v-1.5"/>',
  subir: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 18.5V20a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 20v-1.5"/>',
  buscar: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.7-4.7"/>',
  pin: '<path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.6"/>',
  etiqueta: '<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 12.5a1.4 1.4 0 0 1 0 2L14.5 21a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.5"/>',
  caminar: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21.5 12 15l-2.5-2 1-5.5 3.5-1 3 3.5 2.5 1"/><path d="m10.5 7.5-3 2-1 4M12 15l3 2.5 1 4"/>',
  vehiculo: '<path d="M5 16.5 6.5 10a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5l1.5 6.5"/><rect x="3.5" y="14" width="17" height="6" rx="1.5"/><circle cx="7.5" cy="20" r="1.6"/><circle cx="16.5" cy="20" r="1.6"/>',
  fuego: '<path d="M12 22c4.4 0 7-2.8 7-6.8 0-3.6-2.2-6.2-4.2-8.2-.4 1.6-1.3 3-2.8 3-1-2-1-5-.4-7C7.5 4.8 5 9.5 5 13.5 5 19.2 7.6 22 12 22z"/>',
  luna: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3"/>',
  flecha_der: '<path d="m9 5.5 7 6.5-7 6.5"/>',
  flecha_izq: '<path d="m15 5.5-7 6.5 7 6.5"/>',
  cerrar: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
  ejercicio: '<path d="M7.5 8v8M16.5 8v8M3.5 10.5v3M20.5 10.5v3"/><path d="M7.5 12h9"/><rect x="5.5" y="7" width="2" height="10" rx="1"/><rect x="16.5" y="7" width="2" height="10" rx="1"/>',
  ocio: '<rect x="2.5" y="7" width="19" height="11" rx="3"/><path d="M7 11v3M5.5 12.5h3M15.5 11.2h.01M17.8 13.3h.01"/>',
  transporte: '<rect x="4" y="3.5" width="16" height="14" rx="2.5"/><path d="M4 10.5h16M8 17.5 6.5 21M16 17.5l1.5 3.5"/><circle cx="8" cy="14" r="1.2"/><circle cx="16" cy="14" r="1.2"/>',
  google: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8" transform="rotate(45 12 12)"/>',
  nube: '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.3 11a3.8 3.8 0 0 1-.8 7.5z"/>',
  campana: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  objetivo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  copiar: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M5.5 15.5h-1a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  spotify: '<circle cx="12" cy="12" r="9"/><path d="M6.8 9.5c3.6-1 7.5-.6 10.5 1.1M7.5 12.6c3-.8 6.1-.4 8.6 1M8.2 15.6c2.3-.6 4.6-.3 6.6.8"/>',
};

function el(tag, attrs = {}, ...hijos) {
  const svgTags = ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text'];
  const e = svgTags.includes(tag)
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    e.append(h.nodeType ? h : document.createTextNode(String(h)));
  }
  return e;
}

function icon(nombre, cls = '') {
  const d = ICONOS[nombre] || ICONOS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'icono ' + cls);
  svg.innerHTML = d;
  return svg;
}

// ---------- Modal ----------
// ui.modal({ titulo, cuerpo (Node|string), botones: [{texto, clase, onClick(cerrar)}], alCerrar })
// Devuelve { cerrar }. Si un botón no llama a cerrar(), el modal queda abierto.
function modal({ titulo = '', cuerpo = '', botones = null, alCerrar = null, ancho = null }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const caja = el('div', { class: 'modal', style: ancho ? { maxWidth: ancho } : {} });
  const cerrar = () => { overlay.remove(); document.body.classList.remove('modal-abierto'); if (alCerrar) alCerrar(); };
  const head = el('div', { class: 'modal-head' },
    el('h3', {}, titulo),
    el('button', { class: 'btn-icono', onClick: cerrar, 'aria-label': 'Cerrar' }, icon('cerrar')));
  const body = el('div', { class: 'modal-cuerpo' });
  if (typeof cuerpo === 'string') body.innerHTML = cuerpo; else body.append(cuerpo);
  caja.append(head, body);
  if (botones && botones.length) {
    const pie = el('div', { class: 'modal-pie' });
    for (const b of botones) {
      pie.append(el('button', { class: 'btn ' + (b.clase || ''), onClick: () => b.onClick ? b.onClick(cerrar) : cerrar() }, b.texto));
    }
    caja.append(pie);
  }
  overlay.append(caja);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cerrar(); });
  document.body.append(overlay);
  document.body.classList.add('modal-abierto');
  return { cerrar, cuerpo: body };
}

function confirmar(mensaje, textoOk = 'Eliminar') {
  return new Promise(resolve => {
    modal({
      titulo: 'Confirmar',
      cuerpo: el('p', { class: 'texto-confirmar' }, mensaje),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec', onClick: c => { c(); resolve(false); } },
        { texto: textoOk, clase: 'btn-peligro', onClick: c => { c(); resolve(true); } },
      ],
      alCerrar: () => resolve(false),
    });
  });
}

// ---------- Toast ----------
let toastCont = null;
function toast(msj, tipo = 'ok', ms = 2600) {
  if (!toastCont) { toastCont = el('div', { class: 'toast-cont' }); document.body.append(toastCont); }
  const t = el('div', { class: 'toast toast-' + tipo }, msj);
  toastCont.append(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 350); }, ms);
}

// ---------- Formularios ----------
// campo({tipo:'text'|'number'|'date'|'time'|'datetime-local'|'select'|'textarea'|'color'|'checkbox', etiqueta, valor, opciones:[{v,t}], ...attrs})
// Devuelve wrapper .campo; el input queda en wrapper.input
function campo(def) {
  const { tipo = 'text', etiqueta = '', valor = '', opciones = [], ...attrs } = def;
  let input;
  if (tipo === 'select') {
    input = el('select', { class: 'input', ...attrs },
      opciones.map(o => el('option', { value: o.v, selected: String(o.v) === String(valor) || null }, o.t)));
  } else if (tipo === 'textarea') {
    input = el('textarea', { class: 'input', rows: attrs.rows || 3, ...attrs }); input.value = valor || '';
  } else if (tipo === 'checkbox') {
    input = el('input', { type: 'checkbox', checked: !!valor, ...attrs });
  } else {
    input = el('input', { class: 'input', type: tipo, value: valor ?? '', ...attrs });
  }
  const wrap = tipo === 'checkbox'
    ? el('label', { class: 'campo campo-check' }, input, el('span', {}, etiqueta))
    : el('label', { class: 'campo' }, etiqueta ? el('span', { class: 'campo-etiqueta' }, etiqueta) : null, input);
  wrap.input = input;
  return wrap;
}

// ---------- Tabs ----------
// tabs([{id, texto, render(cont)}], contenedor, tabInicial?) — re-renderiza al cambiar
function tabs(defs, contenedor, inicial = null) {
  const barra = el('div', { class: 'tabs' });
  const cont = el('div', { class: 'tab-contenido' });
  let activa = inicial || defs[0].id;
  const pintar = () => {
    barra.innerHTML = '';
    for (const d of defs) {
      barra.append(el('button', {
        class: 'tab' + (d.id === activa ? ' activa' : ''),
        onClick: () => { activa = d.id; pintar(); },
      }, d.texto));
    }
    cont.innerHTML = '';
    defs.find(d => d.id === activa).render(cont);
  };
  contenedor.append(barra, cont);
  pintar();
  return { get activa() { return activa; }, ir(id) { activa = id; pintar(); } };
}

function estadoVacio(mensaje, icono = 'info') {
  return el('div', { class: 'estado-vacio' }, icon(icono, 'grande'), el('p', {}, mensaje));
}

// ---------- Fechas (siempre hora LOCAL, formato argentino) ----------
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function hoyISO(d = new Date()) { // 'YYYY-MM-DD' en hora local
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ahoraHM(d = new Date()) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function desdeISO(iso) { // 'YYYY-MM-DD' → Date local (mediodía para evitar líos de zona)
  const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12);
}
function fmtFecha(iso, largo = false) { // '2026-08-01' → 'sáb 1 ago' | 'sábado 1 de agosto de 2026'
  if (!iso) return '';
  const d = desdeISO(iso.slice(0, 10));
  return largo
    ? `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
    : `${DIAS_CORTO[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
}
function diasHasta(iso) { // días desde hoy hasta la fecha (negativo = pasó)
  const ms = desdeISO(iso.slice(0, 10)) - desdeISO(hoyISO());
  return Math.round(ms / 86400000);
}
function fmtDuracion(min) { // 95 → '1 h 35 min'
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function fmtMonto(n, moneda = '$') {
  const v = Number(n) || 0;
  const signo = v < 0 ? '-' : '';
  return signo + moneda + ' ' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ---------- Pintado diferido ----------
// Ejecuta fn una vez, cuando el DOM recién insertado ya tiene medidas.
// Usar SIEMPRE en lugar de requestAnimationFrame: los navegadores no disparan rAF
// en páginas ocultas (pestaña en segundo plano, PWA restaurada minimizada), y sin
// esto los gráficos y mapas quedarían en blanco para siempre.
function alPintar(fn) {
  let hecho = false;
  const correr = () => {
    if (hecho) return; hecho = true;
    try { fn(); } catch (e) { console.error('Error al pintar:', e); }
  };
  if (document.visibilityState === 'hidden') setTimeout(correr, 0);
  else { requestAnimationFrame(correr); setTimeout(correr, 300); } // red de seguridad
}

// ---------- Gráficos (canvas, sin librerías, respetan el tema) ----------
function _cssVar(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function _prepCanvas(canvas, altura) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const h = altura || canvas.clientHeight || 160;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

// barras: datos = [{etiqueta, valor, color?}]
function graficoBarras(canvas, datos, { altura = 170, formato = v => String(v) } = {}) {
  const { ctx, w, h } = _prepCanvas(canvas, altura);
  if (!datos.length) return;
  const max = Math.max(...datos.map(d => d.valor), 1);
  const margen = 26, baseY = h - 22;
  const bw = Math.min(46, (w - margen) / datos.length * 0.62);
  const paso = (w - margen) / datos.length;
  ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  const colorTexto = _cssVar('--texto-suave') || '#888';
  datos.forEach((d, i) => {
    const x = margen / 2 + paso * i + paso / 2;
    const bh = (d.valor / max) * (baseY - 26);
    ctx.fillStyle = d.color || _cssVar('--acento') || '#4f8ef7';
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, baseY - bh, bw, bh, 5);
    ctx.fill();
    ctx.fillStyle = colorTexto;
    ctx.fillText(d.etiqueta, x, h - 7);
    if (d.valor > 0) ctx.fillText(formato(d.valor), x, baseY - bh - 6);
  });
}

// línea: datos = [{etiqueta, valor}]
function graficoLinea(canvas, datos, { altura = 170, color = null, relleno = true, formato = v => String(v) } = {}) {
  const { ctx, w, h } = _prepCanvas(canvas, altura);
  if (datos.length < 2) return;
  const vals = datos.map(d => d.valor);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const mx = 14, baseY = h - 22, topY = 14;
  const px = i => mx + (w - mx * 2) * (i / (datos.length - 1));
  const py = v => baseY - ((v - min) / (max - min || 1)) * (baseY - topY);
  const c = color || _cssVar('--acento') || '#4f8ef7';
  ctx.beginPath();
  datos.forEach((d, i) => i ? ctx.lineTo(px(i), py(d.valor)) : ctx.moveTo(px(i), py(d.valor)));
  ctx.strokeStyle = c; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
  if (relleno) {
    ctx.lineTo(px(datos.length - 1), baseY); ctx.lineTo(px(0), baseY); ctx.closePath();
    ctx.globalAlpha = 0.14; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.font = '10px system-ui'; ctx.fillStyle = _cssVar('--texto-suave') || '#888'; ctx.textAlign = 'center';
  const cada = Math.ceil(datos.length / 7);
  datos.forEach((d, i) => { if (i % cada === 0) ctx.fillText(d.etiqueta, px(i), h - 7); });
}

// torta/dona: datos = [{etiqueta, valor, color}]
function graficoTorta(canvas, datos, { altura = 190, dona = true } = {}) {
  const { ctx, w, h } = _prepCanvas(canvas, altura);
  const total = datos.reduce((s, d) => s + d.valor, 0);
  if (!total) return;
  const cx = h / 2, cy = h / 2, r = h / 2 - 10;
  let ang = -Math.PI / 2;
  const paleta = ['#4f8ef7', '#f7734f', '#42c98d', '#f2c14e', '#a06ef7', '#f75f8f', '#4fd0e0', '#95a5a6'];
  datos.forEach((d, i) => {
    const a2 = ang + (d.valor / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, ang, a2); ctx.closePath();
    ctx.fillStyle = d.color || paleta[i % paleta.length]; ctx.fill();
    ang = a2;
  });
  if (dona) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // leyenda a la derecha
  ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  const lx = h + 12; let ly = 20;
  datos.forEach((d, i) => {
    if (ly > altura - 6) return;
    ctx.fillStyle = d.color || paleta[i % paleta.length];
    ctx.beginPath(); ctx.roundRect(lx, ly - 9, 11, 11, 3); ctx.fill();
    ctx.fillStyle = _cssVar('--texto') || '#ddd';
    const pct = Math.round(d.valor / total * 100);
    ctx.fillText(`${d.etiqueta} (${pct}%)`, lx + 17, ly + 1);
    ly += 20;
  });
}

// barra de progreso simple → devuelve Node
function barraProgreso(actual, objetivo, { color = null, texto = null } = {}) {
  const pct = Math.max(0, Math.min(100, objetivo ? (actual / objetivo) * 100 : 0));
  return el('div', { class: 'progreso' },
    el('div', { class: 'progreso-relleno', style: { width: pct + '%', background: color || 'var(--acento)' } }),
    texto !== null ? el('span', { class: 'progreso-texto' }, texto) : null);
}

// ---------- Audio (grabación compartida: clases y notas de voz) ----------
// grabarAudio() → abre modal con grabadora; resuelve {blob, mime, duracion} o null si cancela
function grabarAudio(titulo = 'Grabar audio') {
  return new Promise(async (resolve) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('No se pudo acceder al micrófono. Revisá permisos (necesita HTTPS o localhost).', 'error', 4500);
      return resolve(null);
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
               : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    let inicio = Date.now(), timerInt, resuelto = false;
    const tiempo = el('div', { class: 'grabadora-tiempo' }, '00:00');
    const estado = el('div', { class: 'grabadora-estado grabando' }, 'Grabando…');
    const fin = (guardar) => {
      if (resuelto) return; resuelto = true;
      clearInterval(timerInt);
      if (rec.state !== 'inactive') {
        rec.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          if (guardar) {
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            resolve({ blob, mime: rec.mimeType || 'audio/webm', duracion: Math.round((Date.now() - inicio) / 1000) });
          } else resolve(null);
        };
        rec.stop();
      } else { stream.getTracks().forEach(t => t.stop()); resolve(null); }
    };
    const m = modal({
      titulo,
      cuerpo: el('div', { class: 'grabadora' }, icon('mic', 'grande pulso'), tiempo, estado),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec', onClick: c => { fin(false); c(); } },
        { texto: 'Guardar', clase: 'btn-primario', onClick: c => { fin(true); c(); } },
      ],
      alCerrar: () => fin(false),
    });
    rec.start();
    timerInt = setInterval(() => {
      const s = Math.round((Date.now() - inicio) / 1000);
      tiempo.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  });
}

// reproductor para un blob de audio → Node
function reproductorAudio(blob) {
  const url = URL.createObjectURL(blob);
  const a = el('audio', { controls: true, src: url, class: 'reproductor' });
  return a;
}

function descargarArchivo(nombre, contenido, tipo = 'application/json') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const ui = {
  el, icon, modal, confirmar, toast, campo, tabs, estadoVacio,
  DIAS, DIAS_CORTO, MESES,
  hoyISO, ahoraHM, desdeISO, fmtFecha, diasHasta, fmtDuracion, fmtMonto,
  alPintar, graficoBarras, graficoLinea, graficoTorta, barraProgreso,
  grabarAudio, reproductorAudio, descargarArchivo,
};
