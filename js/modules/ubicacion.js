// ubicacion.js — Mapa, recorridos con GPS y lugares favoritos.
// Usa Leaflet (global L, ya cargado por index.html). Stores: trayectos, lugares.
import { db } from '../db.js';
import { ui } from '../ui.js';

const COLOR_MODO = { caminando: '#42c98d', mixto: '#f2c14e', vehiculo: '#4f8ef7' };
const ICONO_MODO = { caminando: 'caminar', mixto: 'transporte', vehiculo: 'vehiculo' };
const OPCIONES_MODO = [
  { v: 'caminando', t: 'Caminando' },
  { v: 'mixto', t: 'Mixto' },
  { v: 'vehiculo', t: 'Vehículo' },
];
const CENTRO_DEF = [-34.6037, -58.3816]; // Obelisco, por si no hay GPS ni datos
const COLOR_VIVO = '#f75f6d';

// ---------- Estado del módulo ----------
let tabsCtrl = null;   // controlador de ui.tabs
let mapaTab = null;    // mapa Leaflet de la pestaña Mapa (se destruye al cambiar de pestaña)
let centrarEn = null;  // {lat, lng, id} pedido desde Lugares para centrar el mapa
let avisoGpsDado = false;

// Recorrido en curso (vive acá aunque cambies de pestaña; espejado en settings)
const rec = {
  activo: false, puntos: [], inicioTs: null, distM: 0,
  watchId: null, wakeLock: null, timer: null,
  polyline: null, ui: null, seguir: true,
};

// Re-pedir wake lock al volver a la app (se pierde al minimizar)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rec.activo) pedirWakeLock();
});

// ---------- Cálculos ----------
function haversine(a, b) { // metros entre dos puntos {lat,lng}
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function distanciaAcum(puntos) {
  let d = 0;
  for (let i = 1; i < puntos.length; i++) d += haversine(puntos[i - 1], puntos[i]);
  return d;
}

// Stats finales de un conjunto de puntos: distancia, duración, vel media y modo
function calcularStats(puntos) {
  let dist = 0; const tramos = [];
  for (let i = 1; i < puntos.length; i++) {
    const d = haversine(puntos[i - 1], puntos[i]);
    const dt = (puntos[i].t - puntos[i - 1].t) / 1000;
    dist += d;
    if (dt > 0.5) tramos.push({ d, vel: (d / dt) * 3.6 }); // km/h del tramo
  }
  const durMin = puntos.length > 1 ? (puntos[puntos.length - 1].t - puntos[0].t) / 60000 : 0;
  const velMedia = durMin > 0 ? (dist / 1000) / (durMin / 60) : 0;
  const vels = tramos.map(t => t.vel).sort((x, y) => x - y);
  const n = vels.length;
  const mediana = n ? (n % 2 ? vels[(n - 1) / 2] : (vels[n / 2 - 1] + vels[n / 2]) / 2) : 0;
  const modo = mediana < 7 ? 'caminando' : mediana > 14 ? 'vehiculo' : 'mixto';
  const distCam = tramos.filter(t => t.vel < 7).reduce((s, t) => s + t.d, 0);
  const pctCaminando = dist > 0 ? Math.round((distCam / dist) * 100) : 0;
  return {
    distanciaM: Math.round(dist),
    duracionMin: Math.round(durMin * 10) / 10,
    velMediaKmh: Math.round(velMedia * 10) / 10,
    modo, pctCaminando,
  };
}

// km caminados que aporta un trayecto (mixto: según su % caminando)
function kmCaminados(t) {
  if (t.modo === 'caminando') return t.distanciaM / 1000;
  if (t.modo === 'mixto') return (t.distanciaM / 1000) * (((t.pctCaminando ?? 50)) / 100);
  return 0;
}

function fmtSeg(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`;
}

function fmtKm(m) { return (m / 1000).toFixed(1) + ' km'; }

// ---------- GPX ----------
function escXML(s) {
  return String(s || '').replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
function generarGPX(t) {
  const pts = (t.puntos || []).map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Organizador" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escXML(t.nombre || 'Recorrido ' + t.fecha)}</name>
${t.notas ? '    <desc>' + escXML(t.notas) + '</desc>\n' : ''}    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

// ---------- Mapa (helpers Leaflet) ----------
function crearMapa(div, centro, zoom) {
  const mapa = L.map(div).setView(centro, zoom);
  const capa = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19,
  });
  capa.addTo(mapa);
  return { mapa, capa };
}

function destruirMapaTab() {
  if (mapaTab) { try { mapaTab.remove(); } catch { /* ya destruido */ } mapaTab = null; }
  rec.polyline = null; // vivía en el mapa destruido
  rec.ui = null;
}

function repintar() { if (tabsCtrl) tabsCtrl.ir(tabsCtrl.activa); }

// ---------- Wake lock ----------
async function pedirWakeLock() {
  try {
    if ('wakeLock' in navigator) rec.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* sin soporte o denegado: no es crítico */ }
}
function soltarWakeLock() {
  try { if (rec.wakeLock) rec.wakeLock.release(); } catch { /* nada */ }
  rec.wakeLock = null;
}

// ---------- Grabación de recorrido ----------
async function espejarEnCurso() {
  try {
    await db.setSetting('ubicacion.enCurso', { inicioTs: rec.inicioTs, puntos: rec.puntos });
  } catch { /* si falla el espejo no cortamos la grabación */ }
}

function velActualKmh() {
  const n = rec.puntos.length;
  if (!n) return null;
  const u = rec.puntos[n - 1];
  if (Date.now() - u.t > 15000) return 0; // sin puntos recientes: quieto o sin señal
  if (u.vel !== null && u.vel !== undefined) return u.vel * 3.6;
  if (n < 2) return null;
  const a = rec.puntos[n - 2], dt = (u.t - a.t) / 1000;
  return dt > 0 ? (haversine(a, u) / dt) * 3.6 : null;
}

function actualizarPanelVivo() {
  if (!rec.ui || !rec.ui.dur || !rec.ui.dur.isConnected) return;
  const seg = Math.max(0, (Date.now() - (rec.inicioTs || Date.now())) / 1000);
  rec.ui.dur.textContent = fmtSeg(seg);
  rec.ui.dist.textContent = (rec.distM / 1000).toFixed(2) + ' km';
  const va = velActualKmh();
  rec.ui.velAct.textContent = va === null ? '—' : va.toFixed(1) + ' km/h';
  const horas = seg / 3600;
  rec.ui.velProm.textContent = horas > 0.003 ? ((rec.distM / 1000) / horas).toFixed(1) + ' km/h' : '—';
}

function alNuevoPunto(p) {
  if (rec.polyline && mapaTab) {
    try {
      rec.polyline.addLatLng([p.lat, p.lng]);
      if (rec.seguir) mapaTab.panTo([p.lat, p.lng]);
    } catch { /* mapa en transición */ }
  }
  actualizarPanelVivo();
}

function iniciarRecorrido() {
  if (rec.activo) return;
  if (!('geolocation' in navigator)) {
    ui.toast('Este dispositivo no tiene GPS disponible.', 'error');
    return;
  }
  rec.activo = true;
  if (!rec.inicioTs) rec.inicioTs = Date.now();
  espejarEnCurso();
  pedirWakeLock();
  try {
    rec.watchId = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      if (c.accuracy > 50) return; // descartamos puntos imprecisos
      const p = {
        lat: c.latitude, lng: c.longitude,
        t: pos.timestamp || Date.now(),
        vel: (typeof c.speed === 'number' && !isNaN(c.speed)) ? c.speed : null,
        acc: Math.round(c.accuracy),
      };
      if (rec.puntos.length) rec.distM += haversine(rec.puntos[rec.puntos.length - 1], p);
      rec.puntos.push(p);
      if (rec.puntos.length % 20 === 0) espejarEnCurso();
      alNuevoPunto(p);
    }, err => {
      ui.toast(err.code === 1
        ? 'GPS sin permiso: activá la ubicación para este sitio (necesita HTTPS o localhost).'
        : 'GPS sin señal por ahora, sigo intentando…', 'error', 5000);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  } catch (e) {
    rec.activo = false;
    ui.toast('No se pudo iniciar el GPS: ' + e.message, 'error');
    return;
  }
  if (!rec.timer) rec.timer = setInterval(actualizarPanelVivo, 1000);
}

function detenerWatch() {
  if (rec.watchId !== null) {
    try { navigator.geolocation.clearWatch(rec.watchId); } catch { /* nada */ }
    rec.watchId = null;
  }
  if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
  soltarWakeLock();
  rec.activo = false;
}

function limpiarRecorrido() {
  detenerWatch();
  rec.puntos = []; rec.inicioTs = null; rec.distM = 0; rec.polyline = null;
  db.setSetting('ubicacion.enCurso', null);
}

// Modal final: nombre/notas, modo editable y confirmación de guardado
function abrirModalGuardar(alFin) {
  if (rec.puntos.length < 2) {
    ui.toast('Muy pocos puntos GPS para guardar el recorrido: se descartó.', 'error', 4500);
    limpiarRecorrido();
    if (alFin) alFin();
    return;
  }
  const st = calcularStats(rec.puntos);
  const inNombre = ui.campo({ etiqueta: 'Nombre', valor: '', placeholder: 'Ej: Vuelta de la escuela' });
  const selModo = ui.campo({ tipo: 'select', etiqueta: 'Modo (detectado automáticamente, podés corregirlo)', valor: st.modo, opciones: OPCIONES_MODO });
  const inNotas = ui.campo({ tipo: 'textarea', etiqueta: 'Notas', valor: '', placeholder: 'Opcional' });
  const resumen = ui.el('div', { class: 'fila mb' },
    ui.el('span', { class: 'chip chip-acento' }, fmtKm(st.distanciaM)),
    ui.el('span', { class: 'chip' }, ui.fmtDuracion(st.duracionMin)),
    ui.el('span', { class: 'chip' }, st.velMediaKmh + ' km/h'),
    ui.el('span', { class: 'chip chip-ok' }, st.pctCaminando + '% caminando'));
  ui.modal({
    titulo: 'Guardar recorrido',
    cuerpo: ui.el('div', {}, resumen, inNombre, selModo, inNotas),
    botones: [
      { texto: 'Descartar', clase: 'btn-peligro', onClick: async c => {
        if (await ui.confirmar('¿Descartar este recorrido? Se pierden los puntos registrados.', 'Descartar')) {
          limpiarRecorrido(); c(); ui.toast('Recorrido descartado');
          if (alFin) alFin();
        }
      } },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async c => {
        const ini = new Date(rec.puntos[0].t);
        const fin = new Date(rec.puntos[rec.puntos.length - 1].t);
        await db.put('trayectos', {
          fecha: ui.hoyISO(ini), inicio: ui.ahoraHM(ini), fin: ui.ahoraHM(fin),
          puntos: rec.puntos, modo: selModo.input.value,
          distanciaM: st.distanciaM, velMediaKmh: st.velMediaKmh,
          duracionMin: st.duracionMin, pctCaminando: st.pctCaminando,
          nombre: inNombre.input.value.trim(), notas: inNotas.input.value.trim(),
        });
        limpiarRecorrido(); c(); ui.toast('Recorrido guardado 🎉');
        if (alFin) alFin();
      } },
    ],
  });
}

// ---------- Lugares: CRUD ----------
function modalLugar(lugar, latlng, alGuardar) {
  const esNuevo = !lugar;
  const base = lugar || { nombre: '', notas: '', color: '#f7734f', lat: latlng.lat, lng: latlng.lng, visitas: [] };
  const inNombre = ui.campo({ etiqueta: 'Nombre', valor: base.nombre, placeholder: 'Ej: Casa de Juli' });
  const inColor = ui.campo({ tipo: 'color', etiqueta: 'Color', valor: base.color || '#f7734f' });
  const inNotas = ui.campo({ tipo: 'textarea', etiqueta: 'Notas', valor: base.notas || '', placeholder: 'Opcional' });
  ui.modal({
    titulo: esNuevo ? 'Crear lugar acá' : 'Editar lugar',
    cuerpo: ui.el('div', {}, inNombre, inColor, inNotas,
      ui.el('p', { class: 'texto-chico texto-suave' }, `Ubicación: ${base.lat.toFixed(5)}, ${base.lng.toFixed(5)}`)),
    botones: [
      { texto: 'Cancelar', clase: 'btn-sec' },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async c => {
        const nombre = inNombre.input.value.trim();
        if (!nombre) { ui.toast('Poné un nombre para el lugar', 'error'); return; }
        base.nombre = nombre;
        base.notas = inNotas.input.value.trim();
        base.color = inColor.input.value;
        await db.put('lugares', base);
        c(); ui.toast(esNuevo ? 'Lugar creado' : 'Lugar actualizado');
        if (alGuardar) alGuardar();
      } },
    ],
  });
}

async function registrarVisita(lugar, alFin) {
  lugar.visitas = lugar.visitas || [];
  lugar.visitas.push({ fecha: ui.hoyISO(), hora: ui.ahoraHM() });
  await db.put('lugares', lugar);
  ui.toast('Visita registrada en ' + lugar.nombre);
  if (alFin) alFin();
}

function ultimaVisita(lugar) {
  const vs = lugar.visitas || [];
  if (!vs.length) return null;
  return vs.reduce((a, b) => ((a.fecha + (a.hora || '')) > (b.fecha + (b.hora || '')) ? a : b));
}

function modalVisitas(lugar) {
  const lista = ui.el('div');
  const pintarLista = () => {
    lista.innerHTML = '';
    const vs = [...(lugar.visitas || [])].sort((a, b) =>
      (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')));
    if (!vs.length) {
      lista.append(ui.estadoVacio('Sin visitas todavía. Registrá la primera acá abajo.', 'pin'));
      return;
    }
    for (const v of vs) {
      lista.append(ui.el('div', { class: 'lista-item' },
        ui.icon('calendario'),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, ui.fmtFecha(v.fecha)),
          ui.el('div', { class: 'sub' }, v.hora || '')),
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar visita', onClick: async () => {
          lugar.visitas = (lugar.visitas || []).filter(x => x !== v);
          await db.put('lugares', lugar);
          pintarLista();
        } }, ui.icon('basura'))));
    }
  };
  pintarLista();
  ui.modal({
    titulo: `Visitas a ${lugar.nombre} (${(lugar.visitas || []).length})`,
    cuerpo: ui.el('div', {}, lista,
      ui.el('button', { class: 'btn btn-primario mt', onClick: async () => {
        await registrarVisita(lugar, null);
        pintarLista();
      } }, ui.icon('pin'), 'Registrar visita ahora')),
    botones: [{ texto: 'Cerrar', clase: 'btn-sec' }],
    alCerrar: () => repintar(),
  });
}

// ---------- Seeds ----------
async function sembrar() {
  const ya = await db.getSetting('ubicacion.seed', false);
  if (ya) return;
  const lugares = await db.getAll('lugares');
  if (!lugares.length) {
    await db.put('lugares', {
      nombre: 'Obelisco (ejemplo)', lat: -34.6037, lng: -58.3816, color: '#f7734f',
      notas: 'Lugar de ejemplo: borralo tranquilo y creá los tuyos tocando el mapa.',
      visitas: [],
    });
  }
  await db.setSetting('ubicacion.seed', true);
}

// ---------- Pestaña MAPA ----------
function agregarMarcadorLugar(mapa, lugar, alCambiar) {
  const color = lugar.color || '#f7734f';
  const m = L.circleMarker([lugar.lat, lugar.lng], {
    radius: 9, color, fillColor: color, fillOpacity: 0.75, weight: 2,
  });
  const uv = ultimaVisita(lugar);
  const popup = ui.el('div', { style: { minWidth: '160px' } },
    ui.el('div', { class: 'fila', style: { gap: '6px' } },
      ui.el('span', { class: 'punto-color', style: { background: color } }),
      ui.el('strong', {}, lugar.nombre)),
    lugar.notas ? ui.el('div', { class: 'texto-chico', style: { margin: '4px 0' } }, lugar.notas) : null,
    ui.el('div', { class: 'texto-chico texto-suave' },
      `${(lugar.visitas || []).length} visitas${uv ? ' · última ' + ui.fmtFecha(uv.fecha) : ''}`),
    ui.el('div', { class: 'fila', style: { marginTop: '7px', gap: '6px' } },
      ui.el('button', { class: 'btn btn-chico', onClick: () => modalLugar(lugar, null, alCambiar) }, 'Editar'),
      ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => registrarVisita(lugar, alCambiar) }, 'Visita')));
  m.bindPopup(popup);
  m.addTo(mapa);
  return m;
}

function dibujarPolilineaViva(mapa) {
  if (!rec.puntos.length) return;
  if (rec.polyline) { try { mapa.removeLayer(rec.polyline); } catch { /* nada */ } }
  rec.polyline = L.polyline(rec.puntos.map(p => [p.lat, p.lng]),
    { color: COLOR_VIVO, weight: 4, opacity: 0.85 }).addTo(mapa);
  if (rec.activo) {
    const u = rec.puntos[rec.puntos.length - 1];
    mapa.setView([u.lat, u.lng], Math.max(mapa.getZoom(), 15));
  }
}

// Panel bajo el mapa: botón iniciar / stats en vivo / recorrido pendiente de guardar
async function pintarPanel(panel) {
  panel.innerHTML = '';

  // Recuperación tras recarga: si hay un recorrido espejado y acá no hay nada
  if (!rec.activo && !rec.puntos.length) {
    const enCurso = await db.getSetting('ubicacion.enCurso', null);
    if (enCurso && Array.isArray(enCurso.puntos) && enCurso.puntos.length) {
      rec.puntos = enCurso.puntos;
      rec.inicioTs = enCurso.inicioTs || enCurso.puntos[0].t;
      rec.distM = distanciaAcum(rec.puntos);
      if (mapaTab) dibujarPolilineaViva(mapaTab);
    }
  }

  if (rec.activo) {
    const met = etiqueta => {
      const valor = ui.el('div', { class: 'valor' }, '—');
      const caja = ui.el('div', { class: 'metrica' }, valor, ui.el('div', { class: 'etiqueta' }, etiqueta));
      return { valor, caja };
    };
    const dur = met('Duración'), dist = met('Distancia'),
          velAct = met('Vel. actual'), velProm = met('Vel. promedio');
    rec.ui = { dur: dur.valor, dist: dist.valor, velAct: velAct.valor, velProm: velProm.valor };
    const chSeguir = ui.campo({ tipo: 'checkbox', etiqueta: 'Seguir mi posición en el mapa', valor: rec.seguir });
    chSeguir.input.addEventListener('change', () => { rec.seguir = chSeguir.input.checked; });
    panel.append(ui.el('div', { class: 'tarjeta mt' },
      ui.el('div', { class: 'fila espaciado' },
        ui.el('span', { class: 'chip chip-peligro' }, ui.icon('pin'), 'Grabando recorrido'),
        ui.el('span', { class: 'texto-chico texto-suave' }, `${rec.puntos.length} puntos`)),
      ui.el('div', { class: 'grilla grilla-2 mt' }, dur.caja, dist.caja, velAct.caja, velProm.caja),
      chSeguir,
      ui.el('button', { class: 'btn btn-peligro', style: { width: '100%', padding: '13px' }, onClick: () => {
        detenerWatch();
        abrirModalGuardar(() => repintar());
      } }, ui.icon('stop'), 'Terminar'),
      ui.el('p', { class: 'texto-chico texto-suave mt sin-margen' },
        '⚠️ El registro funciona con la app abierta y pantalla encendida.')));
    actualizarPanelVivo();
    return;
  }

  if (rec.puntos.length) {
    // Hay un recorrido sin terminar (recarga o modal cerrado sin guardar)
    panel.append(ui.el('div', { class: 'tarjeta mt' },
      ui.el('p', {},
        ui.el('strong', {}, 'Recorrido sin terminar: '),
        `${rec.puntos.length} puntos, ${(rec.distM / 1000).toFixed(2)} km.`),
      ui.el('div', { class: 'fila' },
        ui.el('button', { class: 'btn btn-ok', onClick: () => {
          iniciarRecorrido();
          if (mapaTab) dibujarPolilineaViva(mapaTab);
          pintarPanel(panel);
        } }, ui.icon('play'), 'Continuar'),
        ui.el('button', { class: 'btn btn-primario', onClick: () => abrirModalGuardar(() => repintar()) },
          ui.icon('check'), 'Guardar'),
        ui.el('button', { class: 'btn btn-peligro', onClick: async () => {
          if (await ui.confirmar('¿Descartar el recorrido sin terminar?', 'Descartar')) {
            limpiarRecorrido(); repintar();
          }
        } }, ui.icon('basura'), 'Descartar'))));
    return;
  }

  panel.append(
    ui.el('button', { class: 'btn btn-primario mt', style: { width: '100%', padding: '14px', fontSize: '16px' }, onClick: () => {
      iniciarRecorrido();
      if (mapaTab) dibujarPolilineaViva(mapaTab);
      pintarPanel(panel);
    } }, ui.icon('play'), 'Iniciar recorrido'),
    ui.el('p', { class: 'texto-chico texto-suave mt' },
      'Se registran puntos GPS mientras te movés. El registro funciona con la app abierta y pantalla encendida. ' +
      'Tocá el mapa para crear un lugar.'));
}

async function renderMapa(c) {
  destruirMapaTab();
  const divMapa = ui.el('div', { class: 'mapa-cont' });
  const avisoRed = ui.el('p', { class: 'texto-chico texto-suave', style: { display: 'none', margin: '6px 0 0' } },
    'Sin conexión: el mapa puede verse gris, pero tus recorridos y lugares se registran igual.');
  const panel = ui.el('div');
  c.append(divMapa, avisoRed, panel);
  const lugares = await db.getAll('lugares');
  const pedidoCentrar = centrarEn; centrarEn = null;

  ui.alPintar(() => {
    if (!divMapa.isConnected) return;
    // Centro inicial: pedido desde Lugares > recorrido en curso > primer lugar > default
    let centro = CENTRO_DEF, zoom = 12;
    if (pedidoCentrar) { centro = [pedidoCentrar.lat, pedidoCentrar.lng]; zoom = 17; }
    else if (rec.puntos.length) {
      const u = rec.puntos[rec.puntos.length - 1];
      centro = [u.lat, u.lng]; zoom = 16;
    } else if (lugares.length) { centro = [lugares[0].lat, lugares[0].lng]; zoom = 14; }

    let mapa, capa;
    try { ({ mapa, capa } = crearMapa(divMapa, centro, zoom)); }
    catch (e) { ui.toast('No se pudo crear el mapa: ' + e.message, 'error'); return; }
    mapaTab = mapa;
    ui.alPintar(() => { try { mapa.invalidateSize(); } catch { /* nada */ } });

    let avisado = false;
    capa.on('tileerror', () => { if (!avisado) { avisado = true; avisoRed.style.display = 'block'; } });
    if (!navigator.onLine) avisoRed.style.display = 'block';

    // Marcadores de lugares
    const marcadores = {};
    for (const l of lugares) marcadores[l.id] = agregarMarcadorLugar(mapa, l, repintar);
    if (pedidoCentrar && marcadores[pedidoCentrar.id]) marcadores[pedidoCentrar.id].openPopup();

    // Tocar el mapa => crear lugar ahí
    mapa.on('click', ev => modalLugar(null, ev.latlng, repintar));

    // Recorrido en curso: polyline en vivo
    if (rec.puntos.length) dibujarPolilineaViva(mapa);

    // Centrar en la ubicación actual si no hay otro criterio
    if (!pedidoCentrar && !rec.puntos.length) {
      try {
        navigator.geolocation.getCurrentPosition(pos => {
          if (mapaTab !== mapa) return; // ya cambió de pestaña
          const ll = [pos.coords.latitude, pos.coords.longitude];
          mapa.setView(ll, 16);
          L.circleMarker(ll, { radius: 7, color: '#4f8ef7', fillColor: '#4f8ef7', fillOpacity: 0.9, weight: 2 })
            .addTo(mapa).bindPopup('Estás acá');
        }, () => {
          if (!avisoGpsDado) {
            avisoGpsDado = true;
            ui.toast('No pudimos ubicarte: la app necesita permiso de ubicación y HTTPS o localhost.', 'info', 5000);
          }
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      } catch {
        ui.toast('Este navegador no permite usar la ubicación.', 'error');
      }
    }
  });

  pintarPanel(panel);
}

// ---------- Pestaña TRAYECTOS ----------
function modalTrayecto(t) {
  let mapaMini = null;
  const divMapa = ui.el('div', {
    style: { height: '230px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--borde)', marginBottom: '10px' },
  });
  const stats = ui.el('div', { class: 'fila mb', style: { gap: '6px' } },
    ui.el('span', { class: 'chip chip-acento' }, fmtKm(t.distanciaM)),
    ui.el('span', { class: 'chip' }, ui.fmtDuracion(t.duracionMin)),
    ui.el('span', { class: 'chip' }, (t.velMediaKmh ?? 0) + ' km/h'),
    ui.el('span', { class: 'chip chip-ok' }, (t.pctCaminando ?? 0) + '% caminando'),
    ui.el('span', { class: 'chip' }, `${(t.puntos || []).length} puntos`));
  const detalle = ui.el('p', { class: 'texto-chico texto-suave' },
    `${ui.fmtFecha(t.fecha, true)} · de ${t.inicio || '?'} a ${t.fin || '?'}`);
  const inNombre = ui.campo({ etiqueta: 'Nombre', valor: t.nombre || '', placeholder: 'Opcional' });
  const selModo = ui.campo({ tipo: 'select', etiqueta: 'Modo', valor: t.modo, opciones: OPCIONES_MODO });
  const inNotas = ui.campo({ tipo: 'textarea', etiqueta: 'Notas', valor: t.notas || '', placeholder: 'Opcional' });

  ui.modal({
    titulo: t.nombre || 'Recorrido ' + ui.fmtFecha(t.fecha),
    cuerpo: ui.el('div', {}, divMapa, detalle, stats, inNombre, selModo, inNotas),
    botones: [
      { texto: 'Borrar', clase: 'btn-peligro', onClick: async c => {
        if (await ui.confirmar('¿Borrar este recorrido? No se puede deshacer.')) {
          await db.del('trayectos', t.id);
          c(); ui.toast('Recorrido borrado'); repintar();
        }
      } },
      { texto: 'GPX', clase: 'btn-sec', onClick: () => {
        const nombre = ((t.nombre || 'recorrido-' + t.fecha).replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_')) + '.gpx';
        ui.descargarArchivo(nombre, generarGPX(t), 'application/gpx+xml');
        ui.toast('GPX descargado');
      } },
      { texto: 'Guardar', clase: 'btn-primario', onClick: async c => {
        t.nombre = inNombre.input.value.trim();
        t.modo = selModo.input.value;
        t.notas = inNotas.input.value.trim();
        await db.put('trayectos', t);
        c(); ui.toast('Cambios guardados'); repintar();
      } },
    ],
    alCerrar: () => { if (mapaMini) { try { mapaMini.remove(); } catch { /* nada */ } mapaMini = null; } },
  });

  // El mapa chico se crea recién cuando el modal ya está en el DOM
  ui.alPintar(() => {
    if (!divMapa.isConnected) return;
    try {
      const { mapa } = crearMapa(divMapa, CENTRO_DEF, 13);
      mapaMini = mapa;
      const latlngs = (t.puntos || []).map(p => [p.lat, p.lng]);
      if (latlngs.length) {
        const pl = L.polyline(latlngs, { color: COLOR_MODO[t.modo] || '#4f8ef7', weight: 4 }).addTo(mapa);
        mapa.fitBounds(pl.getBounds(), { padding: [18, 18] });
        L.circleMarker(latlngs[0], { radius: 6, color: '#42c98d', fillColor: '#42c98d', fillOpacity: 1 }).addTo(mapa).bindPopup('Inicio');
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#f75f6d', fillColor: '#f75f6d', fillOpacity: 1 }).addTo(mapa).bindPopup('Fin');
      }
      ui.alPintar(() => { try { mapa.invalidateSize(); } catch { /* nada */ } });
    } catch (e) { ui.toast('No se pudo mostrar el mapita: ' + e.message, 'error'); }
  });
}

async function renderTrayectos(c) {
  destruirMapaTab();
  const ts = await db.getAll('trayectos');
  if (!ts.length) {
    c.append(ui.estadoVacio('Todavía no guardaste recorridos. Iniciá uno desde la pestaña Mapa.', 'mapa'));
    return;
  }
  ts.sort((a, b) => ((b.fecha || '') + (b.inicio || '')).localeCompare((a.fecha || '') + (a.inicio || '')));
  const card = ui.el('div', { class: 'tarjeta' });
  for (const t of ts) {
    card.append(ui.el('div', { class: 'lista-item', style: { cursor: 'pointer' }, onClick: () => modalTrayecto(t) },
      ui.el('span', { style: { color: COLOR_MODO[t.modo] || 'var(--acento)', display: 'inline-flex' } },
        ui.icon(ICONO_MODO[t.modo] || 'mapa')),
      ui.el('div', { class: 'principal' },
        ui.el('div', { class: 'titulo' }, t.nombre || 'Recorrido ' + ui.fmtFecha(t.fecha)),
        ui.el('div', { class: 'sub' },
          `${ui.fmtFecha(t.fecha)} · ${fmtKm(t.distanciaM)} · ${ui.fmtDuracion(t.duracionMin)} · ${t.velMediaKmh ?? 0} km/h` +
          (t.notas ? ' · ' + t.notas : ''))),
      ui.el('span', { class: 'texto-suave', style: { display: 'inline-flex' } }, ui.icon('flecha_der'))));
  }
  c.append(card);
}

// ---------- Pestaña LUGARES ----------
async function renderLugares(c) {
  destruirMapaTab();
  const ls = await db.getAll('lugares');
  ls.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  c.append(ui.el('div', { class: 'fila espaciado mb' },
    ui.el('p', { class: 'texto-chico texto-suave sin-margen' }, 'Tocá el mapa para crear lugares donde quieras.'),
    ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => {
      try {
        navigator.geolocation.getCurrentPosition(
          pos => modalLugar(null, { lat: pos.coords.latitude, lng: pos.coords.longitude }, repintar),
          () => ui.toast('No pudimos ubicarte: revisá el permiso de ubicación (necesita HTTPS o localhost).', 'error', 5000),
          { enableHighAccuracy: true, timeout: 10000 });
      } catch { ui.toast('Este navegador no permite usar la ubicación.', 'error'); }
    } }, ui.icon('pin'), 'Agregar acá')));

  if (!ls.length) {
    c.append(ui.estadoVacio('Sin lugares guardados. Creá uno tocando el mapa o con "Agregar acá".', 'pin'));
    return;
  }

  const card = ui.el('div', { class: 'tarjeta' });
  for (const l of ls) {
    const uv = ultimaVisita(l);
    const nv = (l.visitas || []).length;
    card.append(ui.el('div', { class: 'lista-item' },
      ui.el('span', { class: 'punto-color', style: { background: l.color || '#f7734f' } }),
      ui.el('div', { class: 'principal', style: { cursor: 'pointer' }, onClick: () => {
        centrarEn = { lat: l.lat, lng: l.lng, id: l.id };
        if (tabsCtrl) tabsCtrl.ir('mapa');
      } },
        ui.el('div', { class: 'titulo' }, l.nombre),
        ui.el('div', { class: 'sub' },
          `${nv} visitas${uv ? ' · última ' + ui.fmtFecha(uv.fecha) : ''}${l.notas ? ' · ' + l.notas : ''}`)),
      ui.el('div', { class: 'acciones' },
        ui.el('button', { class: 'btn-icono', title: 'Registrar visita', 'aria-label': 'Registrar visita',
          onClick: () => registrarVisita(l, repintar) }, ui.icon('check')),
        ui.el('button', { class: 'btn-icono', title: 'Ver visitas', 'aria-label': 'Ver visitas',
          onClick: () => modalVisitas(l) }, ui.icon('calendario')),
        ui.el('button', { class: 'btn-icono', title: 'Editar', 'aria-label': 'Editar',
          onClick: () => modalLugar(l, null, repintar) }, ui.icon('editar')),
        ui.el('button', { class: 'btn-icono', title: 'Borrar', 'aria-label': 'Borrar',
          onClick: async () => {
            if (await ui.confirmar(`¿Borrar el lugar "${l.nombre}" y sus visitas?`)) {
              await db.del('lugares', l.id);
              ui.toast('Lugar borrado'); repintar();
            }
          } }, ui.icon('basura')))));
  }
  c.append(card);
}

// ---------- Pestaña ESTADÍSTICAS ----------
async function renderStats(c) {
  destruirMapaTab();
  const ts = await db.getAll('trayectos');
  const ls = await db.getAll('lugares');
  const hayVisitas = ls.some(l => (l.visitas || []).length);
  if (!ts.length && !hayVisitas) {
    c.append(ui.estadoVacio('Cuando guardes recorridos y visitas vas a ver acá tus estadísticas.', 'grafico'));
    return;
  }

  const hoy = ui.hoyISO();
  const hace7 = ui.hoyISO(new Date(Date.now() - 6 * 86400000));
  const mesPrefijo = hoy.slice(0, 7);
  const semana = ts.filter(t => t.fecha >= hace7 && t.fecha <= hoy);

  const kmCam = arr => arr.reduce((s, t) => s + kmCaminados(t), 0);
  const minTot = arr => arr.reduce((s, t) => s + (t.duracionMin || 0), 0);

  // Velocidad media caminando histórica (solo trayectos 100% caminando)
  const cams = ts.filter(t => t.modo === 'caminando');
  const velCam = minTot(cams) > 0
    ? (cams.reduce((s, t) => s + (t.distanciaM || 0), 0) / 1000) / (minTot(cams) / 60) : 0;

  // Días activos del mes y récord de día con más km
  const diasMes = new Set(ts.filter(t => (t.fecha || '').startsWith(mesPrefijo)).map(t => t.fecha)).size;
  const porDia = {};
  for (const t of ts) porDia[t.fecha] = (porDia[t.fecha] || 0) + (t.distanciaM || 0);
  let recordFecha = null, recordM = 0;
  for (const [f, m] of Object.entries(porDia)) if (m > recordM) { recordM = m; recordFecha = f; }

  const met = (valor, etiqueta) => ui.el('div', { class: 'metrica' },
    ui.el('div', { class: 'valor' }, valor), ui.el('div', { class: 'etiqueta' }, etiqueta));

  if (ts.length) {
    c.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, 'Esta semana'),
      ui.el('div', { class: 'grilla grilla-3' },
        met(kmCam(semana).toFixed(1) + ' km', 'Caminados'),
        met(ui.fmtDuracion(minTot(semana)), 'En movimiento'),
        met(String(semana.length), 'Salidas'))));

    c.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, 'Histórico'),
      ui.el('div', { class: 'grilla grilla-3' },
        met(kmCam(ts).toFixed(1) + ' km', 'Caminados'),
        met(ui.fmtDuracion(minTot(ts)), 'En movimiento'),
        met(velCam ? velCam.toFixed(1) + ' km/h' : '—', 'Vel. caminando'),
        met(String(diasMes), 'Días activos del mes'),
        met(recordFecha ? (recordM / 1000).toFixed(1) + ' km' : '—',
          recordFecha ? 'Récord (' + ui.fmtFecha(recordFecha) + ')' : 'Récord de día'),
        met(String(ts.length), 'Recorridos'))));

    // Barras: km por día, últimos 7 días
    const dias7 = [...Array(7)].map((_, i) => ui.hoyISO(new Date(Date.now() - (6 - i) * 86400000)));
    const datosDias = dias7.map(f => ({
      etiqueta: ui.DIAS_CORTO[ui.desdeISO(f).getDay()],
      valor: Math.round(((porDia[f] || 0) / 1000) * 10) / 10,
    }));
    const cvDias = ui.el('canvas', { class: 'grafico' });
    c.append(ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Km por día (últimos 7)'), cvDias));
    ui.alPintar(() => ui.graficoBarras(cvDias, datosDias, { formato: v => String(v) }));
  }

  // Top 5 lugares más visitados
  const top = ls.map(l => ({ l, n: (l.visitas || []).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  if (top.length) {
    const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Lugares más visitados'));
    const maxN = top[0].n;
    for (const { l, n } of top) {
      const uv = ultimaVisita(l);
      card.append(ui.el('div', { class: 'lista-item' },
        ui.el('span', { class: 'punto-color', style: { background: l.color || '#f7734f' } }),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, l.nombre),
          ui.el('div', { style: { marginTop: '4px' } },
            ui.barraProgreso(n, maxN, { color: l.color || 'var(--acento)' })),
          ui.el('div', { class: 'sub' }, `${n} visitas${uv ? ' · última ' + ui.fmtFecha(uv.fecha) : ''}`))));
    }
    c.append(card);
  }

  // Distribución horaria: en qué franjas de 3 h te movés más (según puntos GPS)
  if (ts.length) {
    const franjas = Array(8).fill(0);
    for (const t of ts) for (const p of (t.puntos || [])) {
      const h = new Date(p.t).getHours();
      franjas[Math.floor(h / 3)]++;
    }
    if (franjas.some(v => v > 0)) {
      const datosFranjas = franjas.map((v, i) => ({ etiqueta: `${i * 3}-${i * 3 + 3}h`, valor: v }));
      const cvFranjas = ui.el('canvas', { class: 'grafico' });
      c.append(ui.el('div', { class: 'tarjeta' },
        ui.el('h3', {}, '¿A qué hora te movés?'),
        ui.el('p', { class: 'texto-chico texto-suave' }, 'Puntos GPS registrados por franja horaria.'),
        cvFranjas));
      ui.alPintar(() => ui.graficoBarras(cvFranjas, datosFranjas, { formato: v => String(v) }));
    }
  }
}

// ---------- Render principal ----------
async function render(cont) {
  cont.append(ui.el('div', { class: 'cabecera-modulo' },
    ui.el('h2', {}, ui.icon('mapa'), 'Mapa')));

  if (typeof L === 'undefined') {
    cont.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, 'Falta Leaflet'),
      ui.el('p', { class: 'texto-suave' },
        'No se cargó la librería de mapas (vendor/leaflet). Recargá la app; si estás sin conexión y nunca se descargó, conectate una vez.')));
    return;
  }

  await sembrar();

  tabsCtrl = ui.tabs([
    { id: 'mapa', texto: 'Mapa', render: c2 => { renderMapa(c2); } },
    { id: 'trayectos', texto: 'Trayectos', render: c2 => { renderTrayectos(c2); } },
    { id: 'lugares', texto: 'Lugares', render: c2 => { renderLugares(c2); } },
    { id: 'stats', texto: 'Stats', render: c2 => { renderStats(c2); } },
  ], cont);
}

export default { id: 'ubicacion', nombre: 'Mapa', icono: 'mapa', render };
