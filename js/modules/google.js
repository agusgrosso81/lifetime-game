// google.js — Integraciones con Google: backup en Drive, exportación a Sheets,
// notas para NotebookLM, calendario .ics y resumen semanal por Gmail.
// OAuth con Google Identity Services (token model). Solo escribe settings 'google.*'.
import { db } from '../db.js';
import { ui } from '../ui.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const K_TOKEN = 'google.token';
const K_SHEET = 'google.sheetId';
const CARPETA_DRIVE = 'Lifetime Game';

// ---------- Google Identity Services ----------
let _gisPromise = null;
let tokenClient = null;
let tokenClientIdUsado = null;
let tokenMem = null;         // { token, expira } en memoria
let _resolverToken = null;   // resolutor del pedido de token en curso

// Inyecta el script de GIS on demand (una sola vez).
function cargarGIS() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve(true);
  if (_gisPromise) return _gisPromise;
  _gisPromise = new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => {
        _gisPromise = null;
        ui.toast('No se pudo cargar Google. Revisá tu conexión a internet e intentá de nuevo.', 'error', 4500);
        resolve(false);
      };
      document.head.append(s);
    } catch (e) {
      _gisPromise = null;
      ui.toast('No se pudo cargar Google: ' + e.message, 'error', 4500);
      resolve(false);
    }
  });
  return _gisPromise;
}

// Devuelve un access token válido o null. Reusa memoria/setting; si expiró, repide.
async function obtenerToken() {
  if (tokenMem && tokenMem.expira > Date.now() + 60000) return tokenMem.token;
  const guardado = await db.getSetting(K_TOKEN, null);
  if (guardado && guardado.token && guardado.expira > Date.now() + 60000) {
    tokenMem = guardado;
    return guardado.token;
  }
  const clientId = ((await db.getSetting('googleClientId', '')) || '').trim();
  if (!clientId) {
    ui.toast('Primero pegá tu Google Client ID en Ajustes.', 'error', 4000);
    return null;
  }
  if (!(await cargarGIS())) return null;
  return new Promise((resolve) => {
    try {
      if (!tokenClient || tokenClientIdUsado !== clientId) {
        // callback y error_callback se fijan en el init: derivan al pedido en curso.
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: (resp) => { const r = _resolverToken; _resolverToken = null; if (r) r(resp, null); },
          error_callback: (err) => { const r = _resolverToken; _resolverToken = null; if (r) r(null, err); },
        });
        tokenClientIdUsado = clientId;
      }
      _resolverToken = async (resp, err) => {
        if (resp && resp.access_token) {
          const seg = Number(resp.expires_in || 3600);
          tokenMem = { token: resp.access_token, expira: Date.now() + Math.max(60, seg - 60) * 1000 };
          await db.setSetting(K_TOKEN, tokenMem);
          resolve(resp.access_token);
        } else if (err) {
          ui.toast('Google rechazó el acceso (' + ((err && err.type) || 'error') + '). Revisá que este origen esté autorizado y que tu Gmail sea usuario de prueba.', 'error', 6000);
          resolve(null);
        } else {
          ui.toast('Google no dio el permiso. Probá de nuevo.', 'error', 4000);
          resolve(null);
        }
      };
      tokenClient.requestAccessToken();
    } catch (e) {
      _resolverToken = null;
      ui.toast('Error pidiendo acceso a Google: ' + e.message, 'error', 5000);
      resolve(null);
    }
  });
}

// fetch con Bearer + manejo de 401 (repide token una vez).
async function gFetch(url, opts = {}, reintento = false) {
  const token = await obtenerToken();
  if (!token) throw new Error('Sin autorización de Google');
  let resp;
  try {
    resp = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  } catch (e) {
    throw new Error('No hubo respuesta de Google. Revisá tu conexión a internet.');
  }
  if (resp.status === 401 && !reintento) {
    tokenMem = null;
    await db.setSetting(K_TOKEN, null);
    return gFetch(url, opts, true);
  }
  if (!resp.ok) {
    let msg = '';
    try {
      const j = await resp.json();
      msg = j && j.error ? (j.error.message || JSON.stringify(j.error)) : '';
    } catch { /* sin cuerpo json */ }
    const err = new Error('Google respondió ' + resp.status + (msg ? ': ' + msg : ''));
    err.status = resp.status;
    throw err;
  }
  return resp;
}

// ---------- Drive ----------
async function buscarOCrearCarpeta(nombre, padreId = null) {
  let q = `name='${nombre}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (padreId) q += ` and '${padreId}' in parents`;
  const r = await gFetch('https://www.googleapis.com/drive/v3/files?fields=files(id,name)&q=' + encodeURIComponent(q));
  const j = await r.json();
  if (j.files && j.files.length) return j.files[0].id;
  const body = { name: nombre, mimeType: 'application/vnd.google-apps.folder' };
  if (padreId) body.parents = [padreId];
  const c = await gFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await c.json()).id;
}

// Sube texto a Drive (multipart) y devuelve {id, name}.
async function subirADrive(nombre, contenido, mime, carpetaId) {
  const boundary = 'orgz' + Date.now();
  const meta = { name: nombre, parents: [carpetaId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n` +
    contenido +
    `\r\n--${boundary}--`;
  const r = await gFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body,
  });
  return r.json();
}

// ---------- Datos para Sheets ----------
async function armarDatosHojas() {
  const [materias, trans, calif, exam, ses, reg, com, agua, tray] = await Promise.all([
    db.getAll('materias'), db.getAll('transacciones'), db.getAll('calificaciones'),
    db.getAll('examenes'), db.getAll('sesionesEstudio'), db.getAll('registroTiempo'),
    db.getAll('comidas'), db.getAll('agua'), db.getAll('trayectos'),
  ]);
  const nomMat = id => { const m = materias.find(x => x.id === id); return m ? m.nombre : ''; };
  const porFecha = (a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''));

  const kcalComida = c => (Array.isArray(c.items) ? c.items : []).reduce((s, i) => s + (Number(i.kcal) || 0), 0);

  const aguaDia = {};
  for (const r of agua) aguaDia[r.fecha] = (aguaDia[r.fecha] || 0) + (Number(r.ml) || 0);

  return [
    {
      titulo: 'Transacciones',
      filas: [['Fecha', 'Tipo', 'Monto', 'Categoría', 'Descripción', 'Método'],
        ...trans.sort(porFecha).map(t => [t.fecha || '', t.tipo || '', Number(t.monto) || 0, t.categoria || '', t.descripcion || '', t.metodo || ''])],
    },
    {
      titulo: 'Calificaciones',
      filas: [['Materia', 'Fecha', 'Descripción', 'Nota', 'Peso'],
        ...calif.sort(porFecha).map(c => [nomMat(c.materiaId), c.fecha || '', c.descripcion || '', Number(c.nota) || 0, Number(c.peso) || 1])],
    },
    {
      titulo: 'Examenes',
      filas: [['Materia', 'Fecha', 'Tema', 'Tipo', 'Estado', 'Nota'],
        ...exam.sort(porFecha).map(e => [nomMat(e.materiaId), e.fecha || '', e.tema || '', e.tipo || '', e.estado || '', e.nota != null && e.nota !== '' ? Number(e.nota) : ''])],
    },
    {
      titulo: 'SesionesEstudio',
      filas: [['Materia', 'Fecha', 'Inicio', 'Fin', 'Método', 'Minutos', 'Notas'],
        ...ses.sort(porFecha).map(s => [nomMat(s.materiaId), s.fecha || '', s.inicio || '', s.fin || '', s.metodo || '', Number(s.minutos) || 0, s.notas || ''])],
    },
    {
      titulo: 'RegistroTiempo',
      filas: [['Fecha', 'Categoría', 'Inicio', 'Fin', 'Minutos', 'Notas'],
        ...reg.sort(porFecha).map(r => [r.fecha || '', r.categoria || '', r.inicio || '', r.fin || '', Number(r.minutos) || 0, r.notas || ''])],
    },
    {
      titulo: 'Comidas',
      filas: [['Fecha', 'Tipo', 'Kcal totales'],
        ...com.sort(porFecha).map(c => [c.fecha || '', c.tipo || '', Math.round(kcalComida(c))])],
    },
    {
      titulo: 'Agua',
      filas: [['Fecha', 'Ml totales'],
        ...Object.keys(aguaDia).sort().map(f => [f, Math.round(aguaDia[f])])],
    },
    {
      titulo: 'Trayectos',
      filas: [['Fecha', 'Modo', 'Km', 'Duración (min)', 'Vel. media (km/h)'],
        ...tray.sort(porFecha).map(t => [t.fecha || '', t.modo || '', Number(((Number(t.distanciaM) || 0) / 1000).toFixed(2)), Math.round(Number(t.duracionMin) || 0), Number((Number(t.velMediaKmh) || 0).toFixed(1))])],
    },
  ];
}

// Crea las hojas que falten; si la primera hoja no es de ningún dataset, la renombra.
async function asegurarHojas(sheetId, titulos) {
  const r = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`);
  const info = await r.json();
  const existentes = (info.sheets || []).map(s => s.properties.title);
  const requests = [];
  const faltan = titulos.filter(t => !existentes.includes(t));
  if (faltan.length && existentes.length && !titulos.includes(existentes[0])) {
    requests.push({
      updateSheetProperties: { properties: { sheetId: info.sheets[0].properties.sheetId, title: faltan[0] }, fields: 'title' },
    });
    faltan.shift();
  }
  for (const t of faltan) requests.push({ addSheet: { properties: { title: t } } });
  if (requests.length) {
    await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  }
}

async function exportarASheets() {
  const hojas = await armarDatosHojas();
  const titulos = hojas.map(h => h.titulo);

  // Reusar planilla si sigue existiendo; si no, crear una nueva.
  let sheetId = await db.getSetting(K_SHEET, null);
  if (sheetId) {
    try {
      await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId`);
    } catch (e) {
      if (e.status === 404 || e.status === 403) sheetId = null; else throw e;
    }
  }
  if (!sheetId) {
    const r = await gFetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: 'Lifetime Game — datos' } }),
    });
    sheetId = (await r.json()).spreadsheetId;
    await db.setSetting(K_SHEET, sheetId);
  }

  await asegurarHojas(sheetId, titulos);
  // Limpiar contenido viejo y escribir todo de una.
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ranges: titulos.map(t => `'${t}'!A:Z`) }),
  });
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: hojas.map(h => ({ range: `'${h.titulo}'!A1`, values: h.filas })),
    }),
  });
  return sheetId;
}

// ---------- Markdown para NotebookLM ----------
function notaAMarkdown(n, nivel = 1) {
  const lineas = ['#'.repeat(nivel) + ' ' + (n.titulo || 'Sin título'), ''];
  const meta = [];
  if (n.fecha) meta.push('Fecha: ' + ui.fmtFecha(String(n.fecha).slice(0, 10), true));
  if (Array.isArray(n.etiquetas) && n.etiquetas.length) meta.push('Etiquetas: ' + n.etiquetas.join(', '));
  if (meta.length) lineas.push('_' + meta.join(' — ') + '_', '');
  if (n.tipo === 'checklist' && Array.isArray(n.items)) {
    for (const it of n.items) lineas.push(`- [${it.hecho ? 'x' : ' '}] ${it.texto || ''}`);
  } else if (n.contenido) {
    lineas.push(String(n.contenido));
  } else {
    lineas.push('(sin contenido)');
  }
  return lineas.join('\n');
}

function slugArchivo(s) {
  return String(s || 'sin-titulo').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'nota';
}

// ---------- iCal (.ics) ----------
function escICS(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsUTC(d) { // Date → 20260801T153000Z
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsDia(iso) { return String(iso).slice(0, 10).replace(/-/g, ''); }

async function generarICS() {
  const [examenes, materias, alarmas] = await Promise.all([
    db.getAll('examenes'), db.getAll('materias'), db.getAll('alarmas'),
  ]);
  const nomMat = id => { const m = materias.find(x => x.id === id); return m ? m.nombre : 'Materia'; };
  const hoy = ui.hoyISO();
  const ahoraStr = `${hoy}T${ui.ahoraHM()}`;
  const stamp = icsUTC(new Date());

  const pendientes = examenes.filter(e => e.estado === 'pendiente' && e.fecha && e.fecha.slice(0, 10) >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const futuras = alarmas.filter(a => a.fecha && a.fecha > ahoraStr)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lifetime Game//App personal//ES',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Lifetime Game',
  ];
  for (const e of pendientes) {
    const d = ui.desdeISO(e.fecha.slice(0, 10));
    d.setDate(d.getDate() + 1); // DTEND exclusivo para eventos de día completo
    lineas.push(
      'BEGIN:VEVENT',
      `UID:examen-${e.id}@lifetimegame`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDia(e.fecha)}`,
      `DTEND;VALUE=DATE:${icsDia(ui.hoyISO(d))}`,
      `SUMMARY:${escICS('Examen: ' + nomMat(e.materiaId) + (e.tema ? ' — ' + e.tema : ''))}`,
      e.tipo ? `DESCRIPTION:${escICS('Tipo: ' + e.tipo)}` : null,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatorio de examen',
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  for (const a of futuras) {
    const d = new Date(a.fecha); // 'YYYY-MM-DDTHH:MM' se interpreta en hora local
    if (isNaN(d)) continue;
    const fin = new Date(d.getTime() + 30 * 60000);
    lineas.push(
      'BEGIN:VEVENT',
      `UID:alarma-${a.id}@lifetimegame`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUTC(d)}`,
      `DTEND:${icsUTC(fin)}`,
      `SUMMARY:${escICS(a.mensaje || 'Alarma de Lifetime Game')}`,
      a.refTipo ? `DESCRIPTION:${escICS('Origen: ' + a.refTipo)}` : null,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Alarma',
      'TRIGGER:-PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lineas.push('END:VCALENDAR');
  return {
    texto: lineas.filter(l => l !== null).join('\r\n'),
    examenes: pendientes.length,
    alarmas: futuras.length,
  };
}

// ---------- Resumen semanal (Gmail / mailto) ----------
async function armarResumen() {
  const hoy = ui.hoyISO();
  const hace7 = ui.hoyISO(new Date(Date.now() - 6 * 86400000));
  const moneda = await db.getSetting('moneda', '$');
  const [examenes, materias, calif, ses, com, agua, trans, tray, metas] = await Promise.all([
    db.getAll('examenes'), db.getAll('materias'), db.getAll('calificaciones'),
    db.getRango('sesionesEstudio', 'fecha', hace7, hoy),
    db.getRango('comidas', 'fecha', hace7, hoy),
    db.getRango('agua', 'fecha', hace7, hoy),
    db.getRango('transacciones', 'fecha', hace7, hoy),
    db.getRango('trayectos', 'fecha', hace7, hoy),
    db.getAll('metasAhorro'),
  ]);
  const nomMat = id => { const m = materias.find(x => x.id === id); return m ? m.nombre : 'Materia'; };
  const L = [];
  L.push('RESUMEN SEMANAL — ORGANIZADOR');
  L.push(`Del ${ui.fmtFecha(hace7)} al ${ui.fmtFecha(hoy)}`);
  L.push('');

  // Exámenes próximos
  L.push('PROXIMOS EXAMENES');
  const prox = examenes.filter(e => e.estado === 'pendiente' && e.fecha && e.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 8);
  if (prox.length) {
    for (const e of prox) {
      const dias = ui.diasHasta(e.fecha);
      L.push(`- ${ui.fmtFecha(e.fecha)}: ${nomMat(e.materiaId)}${e.tema ? ' — ' + e.tema : ''} (${dias === 0 ? 'HOY' : 'faltan ' + dias + ' días'})`);
    }
  } else L.push('- Sin exámenes pendientes. Tranquilo.');
  L.push('');

  // Promedios por materia (histórico, ponderado por peso)
  L.push('PROMEDIOS POR MATERIA');
  const acum = {};
  for (const c of calif) {
    const p = Number(c.peso) || 1;
    if (!acum[c.materiaId]) acum[c.materiaId] = { s: 0, w: 0 };
    acum[c.materiaId].s += (Number(c.nota) || 0) * p;
    acum[c.materiaId].w += p;
  }
  const proms = Object.entries(acum).filter(([, v]) => v.w > 0);
  if (proms.length) {
    for (const [mid, v] of proms) L.push(`- ${nomMat(mid)}: ${(v.s / v.w).toFixed(2)}`);
  } else L.push('- Sin calificaciones cargadas.');
  L.push('');

  // Estudio
  const minEstudio = ses.reduce((s, x) => s + (Number(x.minutos) || 0), 0);
  L.push('ESTUDIO DE LA SEMANA');
  L.push(`- ${ui.fmtDuracion(minEstudio)} en ${ses.length} sesión${ses.length === 1 ? '' : 'es'}`);
  L.push('');

  // Dieta
  const kcalDia = {};
  for (const c of com) {
    const k = (Array.isArray(c.items) ? c.items : []).reduce((s, i) => s + (Number(i.kcal) || 0), 0);
    kcalDia[c.fecha] = (kcalDia[c.fecha] || 0) + k;
  }
  const diasK = Object.keys(kcalDia);
  const aguaDia = {};
  for (const a of agua) aguaDia[a.fecha] = (aguaDia[a.fecha] || 0) + (Number(a.ml) || 0);
  const diasA = Object.keys(aguaDia);
  L.push('DIETA');
  L.push(diasK.length
    ? `- Kcal promedio: ${Math.round(diasK.reduce((s, f) => s + kcalDia[f], 0) / diasK.length)} kcal/día (${diasK.length} días con registro)`
    : '- Sin comidas registradas.');
  L.push(diasA.length
    ? `- Agua promedio: ${Math.round(diasA.reduce((s, f) => s + aguaDia[f], 0) / diasA.length)} ml/día`
    : '- Sin agua registrada.');
  L.push('');

  // Gastos por categoría
  L.push('GASTOS DE LA SEMANA');
  const gastos = trans.filter(t => t.tipo === 'gasto');
  if (gastos.length) {
    const porCat = {};
    for (const g of gastos) porCat[g.categoria || 'Sin categoría'] = (porCat[g.categoria || 'Sin categoría'] || 0) + (Number(g.monto) || 0);
    const total = Object.values(porCat).reduce((s, v) => s + v, 0);
    for (const [cat, v] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) L.push(`- ${cat}: ${ui.fmtMonto(v, moneda)}`);
    L.push(`- TOTAL: ${ui.fmtMonto(total, moneda)}`);
  } else L.push('- Sin gastos registrados. Bien ahí.');
  L.push('');

  // Caminata
  const kmCamin = tray.filter(t => /camin|pie|walk/i.test(t.modo || ''))
    .reduce((s, t) => s + (Number(t.distanciaM) || 0), 0) / 1000;
  L.push('MOVIMIENTO');
  L.push(`- Km caminados: ${kmCamin.toFixed(1)} km en ${tray.length} trayecto${tray.length === 1 ? '' : 's'} registrados`);
  L.push('');

  // Metas de ahorro
  L.push('METAS DE AHORRO');
  if (metas.length) {
    for (const m of metas) {
      const pct = m.objetivo ? Math.round((Number(m.ahorrado) || 0) / Number(m.objetivo) * 100) : 0;
      L.push(`- ${m.nombre}: ${ui.fmtMonto(Number(m.ahorrado) || 0, moneda)} de ${ui.fmtMonto(Number(m.objetivo) || 0, moneda)} (${pct}%)`);
    }
  } else L.push('- Sin metas creadas.');
  L.push('');
  L.push('Generado por tu Lifetime Game.');

  return {
    asunto: `Resumen semanal Lifetime Game — ${ui.fmtFecha(hoy, true)}`,
    cuerpo: L.join('\n'),
  };
}

// ---------- Helpers de UI ----------
function enlace(url, texto) {
  return ui.el('a', { href: url, target: '_blank', rel: 'noopener' }, texto);
}

// Botón con estado de carga: se deshabilita y cambia el texto mientras corre fn.
function botonAccion({ icono, texto, cargando = 'Trabajando…', clase = 'btn-primario' }, fn) {
  const lbl = ui.el('span', {}, texto);
  const btn = ui.el('button', { class: 'btn ' + clase }, ui.icon(icono), lbl);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    lbl.textContent = cargando;
    try {
      await fn();
    } catch (e) {
      ui.toast(e && e.message ? e.message : String(e), 'error', 5500);
    }
    btn.disabled = false;
    lbl.textContent = texto;
  });
  return btn;
}

function nodoGuia(origen) {
  const btnCopiar = ui.el('button', { class: 'btn btn-chico', onClick: async () => {
    try {
      await navigator.clipboard.writeText(origen);
      ui.toast('Origen copiado al portapapeles');
    } catch {
      ui.toast('No se pudo copiar. El origen es: ' + origen, 'info', 6000);
    }
  } }, ui.icon('copiar'), 'Copiar');

  const esOrigenValido = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);

  return ui.el('div', {},
    ui.el('p', {}, 'Para conectar con Drive y Sheets necesitás un Client ID de Google (gratis, se hace una sola vez):'),
    ui.el('ol', { style: { paddingLeft: '20px', margin: '0 0 12px' } },
      ui.el('li', {}, 'Entrá a ', enlace('https://console.cloud.google.com', 'console.cloud.google.com'), ' y creá un proyecto nuevo (nombre libre, ej. "Lifetime Game").'),
      ui.el('li', {}, 'Andá a "APIs y servicios" → "Pantalla de consentimiento OAuth": elegí External, poné un nombre a la app y agregá tu Gmail como usuario de prueba (test user).'),
      ui.el('li', {}, 'En "APIs y servicios" → "Biblioteca", buscá y habilitá "Google Drive API" y "Google Sheets API".'),
      ui.el('li', {}, 'En "APIs y servicios" → "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth" → tipo "Aplicación web".'),
      ui.el('li', {}, 'En "Orígenes de JavaScript autorizados" agregá exactamente el origen que aparece acá abajo.'),
      ui.el('li', {}, 'Creá la credencial, copiá el Client ID (termina en .apps.googleusercontent.com) y pegalo en Ajustes → Integraciones.')),
    ui.el('div', { class: 'fila mb' },
      ui.el('span', { class: 'chip chip-acento', style: { fontSize: '.85rem', userSelect: 'all' } }, origen),
      btnCopiar),
    !esOrigenValido
      ? ui.el('p', { class: 'texto-alerta texto-chico' },
          'Ojo: con http:// y una IP de red (como este origen) Google no permite OAuth. Abrí la app desde localhost o subila a HTTPS (ej: GitHub Pages).')
      : ui.el('p', { class: 'texto-suave texto-chico' },
          'Este origen sirve para OAuth de Google (localhost o HTTPS).'),
    ui.el('p', { class: 'texto-suave texto-chico' },
      'Mientras tanto, Calendario y Gmail (acá abajo) funcionan sin configurar nada.'));
}

// ---------- Render ----------
async function render(cont) {
  cont.append(ui.el('div', { class: 'cabecera-modulo' },
    ui.el('h2', {}, ui.icon('nube'), 'Google')));

  const cuerpo = ui.el('div');
  cont.append(cuerpo);

  const pintar = async () => {
    cuerpo.innerHTML = '';
    const clientId = ((await db.getSetting('googleClientId', '')) || '').trim();
    const origen = location.origin;

    // ----- Tarjeta Estado (se declara antes para poder refrescarla desde las acciones) -----
    const estadoCuerpo = ui.el('div');
    const pintarEstado = async () => {
      estadoCuerpo.innerHTML = '';
      const tk = tokenMem && tokenMem.expira > Date.now() ? tokenMem : await db.getSetting(K_TOKEN, null);
      const activo = tk && tk.token && tk.expira > Date.now();
      if (!clientId) {
        estadoCuerpo.append(
          ui.el('p', { class: 'texto-suave' }, 'Falta configurar el Client ID de Google en Ajustes.'),
          ui.el('button', { class: 'btn btn-sec', onClick: () => window.navegar('ajustes') }, ui.icon('ajustes'), 'Ir a Ajustes'));
        return;
      }
      if (activo) {
        estadoCuerpo.append(
          ui.el('div', { class: 'fila mb' },
            ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), 'Conectado'),
            ui.el('span', { class: 'texto-suave texto-chico' }, 'El permiso vence a las ' + ui.ahoraHM(new Date(tk.expira)) + ' (se renueva solo cuando haga falta).')),
          ui.el('button', { class: 'btn btn-sec', onClick: async () => {
            try {
              if (window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.revoke) {
                google.accounts.oauth2.revoke(tk.token, () => {});
              }
            } catch { /* revoke es best-effort */ }
            tokenMem = null;
            await db.setSetting(K_TOKEN, null);
            ui.toast('Sesión de Google cerrada');
            pintarEstado();
          } }, ui.icon('cerrar'), 'Desconectar'));
      } else {
        estadoCuerpo.append(ui.el('p', { class: 'texto-suave' },
          'Client ID configurado. Sin sesión activa: al usar Drive o Sheets se te va a pedir permiso.'));
      }
    };

    // ----- Guía (sin client ID) o botón de ayuda (con client ID) -----
    if (!clientId) {
      cuerpo.append(ui.el('div', { class: 'tarjeta' },
        ui.el('h3', {}, 'Conectar con Google'),
        nodoGuia(origen)));
    }

    // ----- Funciones que requieren OAuth -----
    if (clientId) {
      // 1. Backup en Drive
      const resBackup = ui.el('div', { class: 'mt' });
      const listaBackups = ui.el('div');
      let listaVisible = false;

      const refrescarLista = async () => {
        listaBackups.innerHTML = '';
        listaBackups.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'Buscando backups…'));
        const carpetaId = await buscarOCrearCarpeta(CARPETA_DRIVE);
        const q = `'${carpetaId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
        const r = await gFetch('https://www.googleapis.com/drive/v3/files?orderBy=createdTime%20desc&fields=' +
          encodeURIComponent('files(id,name,createdTime,size)') + '&q=' + encodeURIComponent(q));
        const j = await r.json();
        const archivos = (j.files || []).filter(f => /\.json$/i.test(f.name));
        listaBackups.innerHTML = '';
        if (!archivos.length) {
          listaBackups.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'Todavía no hay backups en la carpeta ' + CARPETA_DRIVE + '.'));
          return;
        }
        for (const f of archivos) {
          const creado = f.createdTime ? ui.fmtFecha(f.createdTime.slice(0, 10)) + ' ' + ui.ahoraHM(new Date(f.createdTime)) : '';
          const kb = f.size ? Math.max(1, Math.round(Number(f.size) / 1024)) + ' KB' : '';
          const btnRest = ui.el('button', { class: 'btn btn-chico' }, 'Restaurar');
          btnRest.addEventListener('click', async () => {
            btnRest.disabled = true; btnRest.textContent = 'Bajando…';
            try {
              const rr = await gFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
              const data = await rr.json();
              const seguir = await ui.confirmar(`¿Restaurar el backup "${f.name}"?`, 'Continuar');
              if (seguir) {
                const reemplazar = await ui.confirmar('¿Reemplazar los datos actuales? (Cancelar = combinar con lo existente)', 'Reemplazar');
                await db.importarJSON(data, reemplazar);
                ui.toast('Backup restaurado. Recargando…');
                setTimeout(() => location.reload(), 900);
                return;
              }
            } catch (e) {
              ui.toast('No se pudo restaurar: ' + e.message, 'error', 5000);
            }
            btnRest.disabled = false; btnRest.textContent = 'Restaurar';
          });
          const btnBorrar = ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar backup' }, ui.icon('basura'));
          btnBorrar.addEventListener('click', async () => {
            if (!(await ui.confirmar(`¿Borrar "${f.name}" de Drive?`))) return;
            try {
              await gFetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' });
              ui.toast('Backup borrado');
              await refrescarLista();
            } catch (e) { ui.toast('No se pudo borrar: ' + e.message, 'error', 5000); }
          });
          listaBackups.append(ui.el('div', { class: 'lista-item' },
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, f.name),
              ui.el('div', { class: 'sub' }, [creado, kb].filter(Boolean).join(' — '))),
            ui.el('div', { class: 'acciones' }, btnRest, btnBorrar)));
        }
      };

      cuerpo.append(ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('subir'), 'Backup en Drive')),
        ui.el('p', { class: 'texto-suave texto-chico' },
          'Sube una copia de todos tus datos (sin audios ni imágenes) a la carpeta "' + CARPETA_DRIVE + '" de tu Drive.'),
        ui.el('div', { class: 'fila' },
          botonAccion({ icono: 'subir', texto: 'Subir backup ahora', cargando: 'Subiendo…' }, async () => {
            const carpetaId = await buscarOCrearCarpeta(CARPETA_DRIVE);
            const data = await db.exportarJSON(false);
            const nombre = `lifetime-game-backup-${ui.hoyISO()}.json`;
            const subido = await subirADrive(nombre, JSON.stringify(data), 'application/json', carpetaId);
            resBackup.innerHTML = '';
            resBackup.append(ui.el('p', { class: 'texto-chico' },
              'Listo: se subió ', ui.el('strong', {}, subido.name), '. ',
              enlace(`https://drive.google.com/drive/folders/${carpetaId}`, 'Abrir carpeta en Drive')));
            ui.toast('Backup subido a Drive');
            if (listaVisible) await refrescarLista();
            pintarEstado();
          }),
          botonAccion({ icono: 'buscar', texto: 'Ver backups guardados', cargando: 'Buscando…', clase: 'btn-sec' }, async () => {
            listaVisible = true;
            await refrescarLista();
            pintarEstado();
          })),
        resBackup,
        listaBackups));

      // 2. Exportar a Sheets
      const resSheets = ui.el('div', { class: 'mt' });
      const sheetGuardado = await db.getSetting(K_SHEET, null);
      if (sheetGuardado) {
        resSheets.append(ui.el('p', { class: 'texto-chico' },
          'Última planilla: ', enlace(`https://docs.google.com/spreadsheets/d/${sheetGuardado}`, 'abrir en Google Sheets')));
      }
      cuerpo.append(ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('grafico'), 'Exportar a Google Sheets')),
        ui.el('p', { class: 'texto-suave texto-chico' },
          'Crea (o actualiza) la planilla "Lifetime Game — datos" con una hoja por tema: transacciones, calificaciones, exámenes, sesiones de estudio, registro de tiempo, comidas, agua y trayectos. Ideal para hacer tus propios gráficos.'),
        botonAccion({ icono: 'grafico', texto: 'Exportar ahora', cargando: 'Exportando…' }, async () => {
          const sheetId = await exportarASheets();
          resSheets.innerHTML = '';
          resSheets.append(ui.el('p', { class: 'texto-chico' },
            'Listo: ', enlace(`https://docs.google.com/spreadsheets/d/${sheetId}`, 'abrir la planilla en Google Sheets')));
          ui.toast('Datos exportados a Sheets');
          pintarEstado();
        }),
        resSheets));

      // 3. Notas para NotebookLM
      const notasTodas = (await db.getAll('notas')).filter(n => n.tipo !== 'audio');
      const selNota = ui.campo({
        tipo: 'select', etiqueta: 'Qué exportar',
        valor: 'todas',
        opciones: [
          { v: 'todas', t: `Todas las notas juntas (${notasTodas.length})` },
          ...notasTodas.map(n => ({ v: n.id, t: 'Solo: ' + (n.titulo || 'Sin título') })),
        ],
      });
      const resNlm = ui.el('div', { class: 'mt' });
      cuerpo.append(ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('nota'), 'Notas para NotebookLM')),
        ui.el('p', { class: 'texto-suave texto-chico' },
          'NotebookLM no tiene API pública, pero sí puede leer archivos de tu Drive. Este botón arma un Markdown con tus notas de texto y checklists y lo sube a la carpeta ' + CARPETA_DRIVE + '/NotebookLM.'),
        notasTodas.length ? selNota : ui.estadoVacio('No tenés notas de texto o checklist para exportar.', 'nota'),
        notasTodas.length ? botonAccion({ icono: 'subir', texto: 'Generar y subir a Drive', cargando: 'Subiendo…' }, async () => {
          const sel = selNota.input.value;
          let md, nombre;
          if (sel === 'todas') {
            const partes = ['# Notas de Lifetime Game', '', 'Exportado: ' + ui.fmtFecha(ui.hoyISO(), true), ''];
            for (const n of notasTodas) partes.push(notaAMarkdown(n, 2), '', '---', '');
            md = partes.join('\n');
            nombre = `notas-lifetime-game-${ui.hoyISO()}.md`;
          } else {
            const n = notasTodas.find(x => x.id === sel);
            if (!n) throw new Error('No se encontró la nota elegida');
            md = notaAMarkdown(n, 1);
            nombre = `nota-${slugArchivo(n.titulo)}-${ui.hoyISO()}.md`;
          }
          const orgId = await buscarOCrearCarpeta(CARPETA_DRIVE);
          const nlmId = await buscarOCrearCarpeta('NotebookLM', orgId);
          const subido = await subirADrive(nombre, md, 'text/markdown', nlmId);
          resNlm.innerHTML = '';
          resNlm.append(ui.el('p', { class: 'texto-chico' },
            'Listo: ', ui.el('strong', {}, subido.name), ' — ',
            enlace(`https://drive.google.com/file/d/${subido.id}/view`, 'ver en Drive')));
          ui.toast('Archivo subido a Drive');
          pintarEstado();
        }) : null,
        resNlm,
        ui.el('p', { class: 'texto-suave texto-chico mt' }, 'Después, para usarlo:'),
        ui.el('ol', { class: 'texto-suave texto-chico', style: { paddingLeft: '20px', margin: '0' } },
          ui.el('li', {}, 'Entrá a ', enlace('https://notebooklm.google.com', 'notebooklm.google.com'), ' y creá un cuaderno nuevo.'),
          ui.el('li', {}, 'Tocá "Agregar fuente" → "Google Drive".'),
          ui.el('li', {}, 'Elegí el archivo que subiste y listo: le podés hacer preguntas sobre tus notas.'))));
    }

    // ----- 4. Google Calendar (.ics, sin OAuth) -----
    const infoIcs = ui.el('p', { class: 'texto-suave texto-chico' }, 'Contando eventos…');
    (async () => {
      try {
        const [ex, al] = await Promise.all([db.getAll('examenes'), db.getAll('alarmas')]);
        const hoy = ui.hoyISO();
        const ahoraStr = `${hoy}T${ui.ahoraHM()}`;
        const nEx = ex.filter(e => e.estado === 'pendiente' && e.fecha && e.fecha.slice(0, 10) >= hoy).length;
        const nAl = al.filter(a => a.fecha && a.fecha > ahoraStr).length;
        infoIcs.textContent = `Ahora mismo hay ${nEx} examen${nEx === 1 ? '' : 'es'} pendiente${nEx === 1 ? '' : 's'} y ${nAl} alarma${nAl === 1 ? '' : 's'} futura${nAl === 1 ? '' : 's'} para exportar.`;
      } catch { infoIcs.textContent = ''; }
    })();
    cuerpo.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, ui.icon('calendario'), 'Google Calendar'),
        ui.el('span', { class: 'chip chip-ok' }, 'Sin configuración')),
      ui.el('p', { class: 'texto-suave texto-chico' },
        'Descarga un archivo .ics con tus exámenes pendientes (con aviso un día antes) y tus alarmas futuras, listo para importar en cualquier calendario.'),
      infoIcs,
      botonAccion({ icono: 'descargar', texto: 'Descargar lifetime-game.ics', cargando: 'Armando…' }, async () => {
        const r = await generarICS();
        if (!r.examenes && !r.alarmas) {
          ui.toast('No hay exámenes pendientes ni alarmas futuras para exportar.', 'info', 4000);
          return;
        }
        ui.descargarArchivo('lifetime-game.ics', r.texto, 'text/calendar');
        ui.toast(`Descargado: ${r.examenes} examen(es) y ${r.alarmas} alarma(s)`);
      }),
      ui.el('p', { class: 'texto-suave texto-chico mt' }, 'Para importarlo:'),
      ui.el('ol', { class: 'texto-suave texto-chico', style: { paddingLeft: '20px', margin: '0' } },
        ui.el('li', {}, 'En la compu: ', enlace('https://calendar.google.com', 'calendar.google.com'), ' → rueda de Configuración → "Importar y exportar" → elegí el archivo.'),
        ui.el('li', {}, 'En el celular: tocá el archivo descargado y se abre directo en tu app de calendario.'))));

    // ----- 5. Gmail (sin OAuth) -----
    const notaMail = ui.el('p', { class: 'texto-suave texto-chico mt' },
      'El destinatario queda en blanco: ponete tu propio mail para mandártelo, o el de quien quieras.');
    cuerpo.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, ui.icon('nota'), 'Resumen semanal por Gmail'),
        ui.el('span', { class: 'chip chip-ok' }, 'Sin configuración')),
      ui.el('p', { class: 'texto-suave texto-chico' },
        'Arma un mail con el resumen de tu última semana: exámenes próximos, promedios, estudio, dieta, gastos, caminatas y metas de ahorro.'),
      ui.el('div', { class: 'fila' },
        botonAccion({ icono: 'subir', texto: 'Mandarme el resumen semanal', cargando: 'Armando…' }, async () => {
          const { asunto, cuerpo: texto } = await armarResumen();
          const url = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto);
          const w = window.open(url, '_blank');
          if (!w) ui.toast('El navegador bloqueó la ventana. Permití popups para este sitio.', 'error', 5000);
          else ui.toast('Se abrió Gmail con el resumen listo');
        }),
        botonAccion({ icono: 'nota', texto: 'Usar mi app de mail', cargando: 'Armando…', clase: 'btn-sec' }, async () => {
          const { asunto, cuerpo: texto } = await armarResumen();
          location.href = 'mailto:?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto);
        })),
      notaMail));

    // ----- Estado -----
    cuerpo.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon('info'), 'Estado')),
      estadoCuerpo));
    await pintarEstado();
  };

  await pintar();
}

export default { id: 'google', nombre: 'Google', icono: 'nube', render };
