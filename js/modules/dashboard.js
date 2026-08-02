// dashboard.js — Pantalla de inicio: resumen del día de hoy.
// SOLO LEE de los stores de los demás módulos (robusto con stores vacíos).
// Config propia: 'dashboard.ocultas' = array de ids de tarjetas que el usuario escondió.
import { db } from '../db.js';
import { ui } from '../ui.js';

const SECCIONES = [
  { id: 'examenes',   nombre: 'Próximos exámenes' },
  { id: 'agenda',     nombre: 'Hoy en tu agenda' },
  { id: 'metricas',   nombre: 'Tu día en números' },
  { id: 'pendientes', nombre: 'Pendientes' },
  { id: 'racha',      nombre: 'Racha de estudio' },
  { id: 'accesos',    nombre: 'Accesos rápidos' },
];

// getAll que nunca revienta: si un store falla, devuelve []
async function seguro(store) {
  try { return (await db.getAll(store)) || []; } catch { return []; }
}

// Tarjeta con título e ícono
function tarjeta(icono, titulo) {
  const c = ui.el('div', { class: 'tarjeta' });
  c.append(ui.el('div', { class: 'tarjeta-titulo' }, ui.el('h3', {}, ui.icon(icono), titulo)));
  return c;
}

// Estado vacío corto con botón para ir al módulo correspondiente
function vacioCorto(mensaje, moduloId, textoBtn) {
  return ui.el('div', { class: 'texto-centrado', style: { padding: '8px 0 4px' } },
    ui.el('p', { class: 'texto-suave texto-chico' }, mensaje),
    ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => window.navegar(moduloId) }, textoBtn));
}

// Celda de métrica
function metrica(valor, etiqueta, extra = null) {
  return ui.el('div', { class: 'metrica' },
    ui.el('div', { class: 'valor' }, valor),
    ui.el('div', { class: 'etiqueta' }, etiqueta),
    extra ? ui.el('div', { style: { marginTop: '7px' } }, extra) : null);
}

async function render(cont) {
  const raiz = ui.el('div');
  cont.append(raiz);

  // ---------- Configuración de tarjetas visibles ----------
  const abrirConfig = async () => {
    const ocultas = (await db.getSetting('dashboard.ocultas', [])) || [];
    const cuerpo = ui.el('div', {},
      ui.el('p', { class: 'texto-suave texto-chico' }, 'Elegí qué tarjetas querés ver en el inicio.'));
    const checks = SECCIONES.map(s => ({
      s,
      campo: ui.campo({ tipo: 'checkbox', etiqueta: s.nombre, valor: !ocultas.includes(s.id) }),
    }));
    checks.forEach(x => cuerpo.append(x.campo));
    ui.modal({
      titulo: 'Personalizar inicio',
      cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          const nuevas = checks.filter(x => !x.campo.input.checked).map(x => x.s.id);
          await db.setSetting('dashboard.ocultas', nuevas);
          cerrar();
          ui.toast('Inicio actualizado');
          pintar();
        } },
      ],
    });
  };

  // ---------- Pintado principal ----------
  const pintar = async () => {
    raiz.innerHTML = '';
    const hoy = ui.hoyISO();
    const ahoraHM = ui.ahoraHM();
    const diaHoy = new Date().getDay();
    const mesActual = hoy.slice(0, 7); // 'YYYY-MM'

    // Carga en paralelo de todo lo necesario (cada store tolera fallas)
    const [
      nombreUsuario, ocultasRaw, objetivoAguaRaw, objetivoKcalRaw, moneda,
      materias, examenes, bloques, categoriasT,
      aguaRegs, comidas, transacciones, sesiones, notas,
    ] = await Promise.all([
      db.getSetting('nombreUsuario', ''),
      db.getSetting('dashboard.ocultas', []),
      db.getSetting('dieta.objetivoAgua', 2000),
      db.getSetting('dieta.objetivoKcal', 2000),
      db.getSetting('moneda', '$'),
      seguro('materias'), seguro('examenes'), seguro('bloquesHorario'), seguro('categoriasTiempo'),
      seguro('agua'), seguro('comidas'), seguro('transacciones'), seguro('sesionesEstudio'), seguro('notas'),
    ]);
    const ocultas = Array.isArray(ocultasRaw) ? ocultasRaw : [];
    const visible = id => !ocultas.includes(id);
    const objetivoAgua = Number(objetivoAguaRaw) || 2000;
    const objetivoKcal = Number(objetivoKcalRaw) || 2000;
    const esDeHoy = r => String(r.fecha || '').slice(0, 10) === hoy;

    // ---------- Saludo + fecha ----------
    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buen día' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    raiz.append(ui.el('div', { class: 'cabecera-modulo' },
      ui.el('div', {},
        ui.el('h2', {}, `¡${saludo}${nombreUsuario ? ', ' + nombreUsuario : ''}!`),
        ui.el('p', { class: 'texto-suave sin-margen' }, ui.fmtFecha(hoy, true))),
      ui.el('button', { class: 'btn-icono', title: 'Personalizar inicio', 'aria-label': 'Personalizar inicio', onClick: abrirConfig },
        ui.icon('ajustes'))));

    if (ocultas.length >= SECCIONES.length) {
      raiz.append(ui.el('div', { class: 'tarjeta' },
        ui.estadoVacio('Ocultaste todas las tarjetas del inicio.', 'info'),
        ui.el('div', { class: 'texto-centrado' },
          ui.el('button', { class: 'btn btn-primario', onClick: abrirConfig }, ui.icon('ajustes'), 'Personalizar inicio'))));
      return;
    }

    // ---------- Próximos exámenes (14 días) ----------
    if (visible('examenes')) {
      const matPorId = {};
      for (const m of materias) matPorId[m.id] = m;
      const proximos = examenes
        .filter(e => e.fecha && e.estado !== 'rendido')
        .map(e => ({ ...e, dias: ui.diasHasta(e.fecha) }))
        .filter(e => e.dias >= 0 && e.dias <= 14)
        .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

      const card = tarjeta('libro', 'Próximos exámenes');
      if (!proximos.length) {
        card.append(vacioCorto('Sin exámenes en los próximos 14 días. ¡A respirar tranquilo!', 'estudio', 'Ir a Estudio'));
      } else {
        for (const e of proximos) {
          const mat = matPorId[e.materiaId];
          const clsChip = e.dias <= 2 ? 'chip chip-peligro' : e.dias <= 5 ? 'chip chip-alerta' : 'chip';
          const txtChip = e.dias === 0 ? '¡Hoy!' : e.dias === 1 ? 'Mañana' : `En ${e.dias} días`;
          card.append(ui.el('div', { class: 'lista-item', style: { cursor: 'pointer' }, onClick: () => window.navegar('estudio') },
            ui.el('span', { class: 'punto-color', style: { background: (mat && mat.color) || 'var(--acento)' } }),
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, (mat && mat.nombre) || 'Materia'),
              ui.el('div', { class: 'sub' },
                [e.tipo, e.tema, ui.fmtFecha(e.fecha)].filter(Boolean).join(' · '))),
            ui.el('div', { class: 'acciones' }, ui.el('span', { class: clsChip }, txtChip))));
        }
      }
      raiz.append(card);
    }

    // ---------- Hoy en tu agenda ----------
    if (visible('agenda')) {
      const catPorId = {}, catPorNombre = {};
      for (const c of categoriasT) {
        catPorId[c.id] = c;
        if (c.nombre) catPorNombre[String(c.nombre).toLowerCase()] = c;
      }
      const catDe = b => catPorId[b.categoria] || catPorNombre[String(b.categoria || '').toLowerCase()] || null;
      const bloquesHoy = bloques
        .filter(b => Number(b.dia) === diaHoy)
        .sort((a, b) => (String(a.horaInicio || '') < String(b.horaInicio || '') ? -1 : 1));

      const card = tarjeta('calendario', 'Hoy en tu agenda');
      if (!bloquesHoy.length) {
        card.append(vacioCorto('No tenés bloques cargados para hoy.', 'tiempo', 'Armar horario'));
      } else {
        for (const b of bloquesHoy) {
          const cat = catDe(b);
          const enCurso = b.horaInicio && b.horaFin && b.horaInicio <= ahoraHM && ahoraHM < b.horaFin;
          card.append(ui.el('div', { class: 'lista-item' },
            ui.el('span', { class: 'punto-color', style: { background: (cat && cat.color) || b.color || 'var(--acento)' } }),
            ui.icon((cat && cat.icono) || 'reloj'),
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, b.titulo || (cat && cat.nombre) || 'Bloque'),
              ui.el('div', { class: 'sub' },
                [`${b.horaInicio || '?'}–${b.horaFin || '?'}`, cat && cat.nombre].filter(Boolean).join(' · '))),
            enCurso ? ui.el('div', { class: 'acciones' }, ui.el('span', { class: 'chip chip-acento' }, 'Ahora')) : null));
        }
      }
      raiz.append(card);
    }

    // ---------- Métricas del día ----------
    if (visible('metricas')) {
      const aguaHoy = aguaRegs.filter(esDeHoy).reduce((t, r) => t + (Number(r.ml) || 0), 0);
      const kcalHoy = comidas.filter(esDeHoy).reduce((t, c) => {
        if (Array.isArray(c.items) && c.items.length) {
          return t + c.items.reduce((s, i) => s + (Number(i.kcal) || 0), 0);
        }
        return t + (Number(c.kcal) || 0); // por si el módulo guarda el total directo
      }, 0);
      const gastosHoy = transacciones.filter(t => t.tipo === 'gasto' && esDeHoy(t))
        .reduce((s, t) => s + (Number(t.monto) || 0), 0);
      const gastosMes = transacciones.filter(t => t.tipo === 'gasto' && String(t.fecha || '').slice(0, 7) === mesActual)
        .reduce((s, t) => s + (Number(t.monto) || 0), 0);
      const minHoy = sesiones.filter(esDeHoy).reduce((s, x) => s + (Number(x.minutos) || 0), 0);

      const card = tarjeta('grafico', 'Tu día en números');
      card.append(ui.el('div', { class: 'grilla grilla-2' },
        metrica(`${aguaHoy} ml`, `de ${objetivoAgua} ml de agua`,
          ui.barraProgreso(aguaHoy, objetivoAgua, { color: '#4fd0e0', texto: `${Math.min(999, Math.round(aguaHoy / objetivoAgua * 100))}%` })),
        metrica(`${Math.round(kcalHoy)} kcal`, `de ${objetivoKcal} kcal`,
          ui.barraProgreso(kcalHoy, objetivoKcal, { color: '#f7734f', texto: `${Math.min(999, Math.round(kcalHoy / objetivoKcal * 100))}%` })),
        metrica(minHoy ? ui.fmtDuracion(minHoy) : '0 min', 'estudiados hoy'),
        metrica(ui.fmtMonto(gastosHoy, moneda), `gastado hoy · ${ui.fmtMonto(gastosMes, moneda)} en el mes`)));
      raiz.append(card);
    }

    // ---------- Pendientes (notas) ----------
    if (visible('pendientes')) {
      const pend = [];
      for (const n of notas) {
        const items = Array.isArray(n.items) ? n.items : [];
        // Las notas son mixtas: puede haber lista aunque también tengan texto o audio,
        // así que miramos los ítems y no el campo 'tipo' (que quedó como derivado).
        const sinMarcar = items.filter(i => !i.hecho).length;
        const dias = n.fechaLimite ? ui.diasHasta(n.fechaLimite) : null;
        const porFecha = dias !== null && dias <= 7; // incluye vencidas (dias < 0)
        if (sinMarcar > 0 || porFecha) pend.push({ n, dias, sinMarcar, total: items.length });
      }
      // Primero las que tienen fecha límite (más urgente arriba), después checklists sueltas
      pend.sort((a, b) => {
        if (a.dias === null && b.dias === null) return 0;
        if (a.dias === null) return 1;
        if (b.dias === null) return -1;
        return a.dias - b.dias;
      });

      const card = tarjeta('nota', 'Pendientes');
      if (!pend.length) {
        card.append(vacioCorto('Nada pendiente por acá. ¡Bien ahí!', 'notas', 'Ir a Notas'));
      } else {
        const MAX = 6;
        for (const p of pend.slice(0, MAX)) {
          let chip;
          if (p.dias === null) {
            chip = ui.el('span', { class: 'chip chip-acento' }, `${p.sinMarcar}/${p.total}`);
          } else if (p.dias < 0) {
            chip = ui.el('span', { class: 'chip chip-peligro' }, 'Vencida');
          } else if (p.dias === 0) {
            chip = ui.el('span', { class: 'chip chip-peligro' }, '¡Hoy!');
          } else if (p.dias <= 2) {
            chip = ui.el('span', { class: 'chip chip-alerta' }, p.dias === 1 ? 'Mañana' : `En ${p.dias} días`);
          } else {
            chip = ui.el('span', { class: 'chip' }, `En ${p.dias} días`);
          }
          const titulo = p.n.titulo
            || (typeof p.n.contenido === 'string' && p.n.contenido.trim() ? p.n.contenido.trim().slice(0, 40) : 'Nota sin título');
          const subPartes = [];
          if (p.sinMarcar > 0) subPartes.push(`${p.sinMarcar} de ${p.total} ítems pendientes`);
          if (p.n.fechaLimite) subPartes.push('límite: ' + ui.fmtFecha(p.n.fechaLimite));
          card.append(ui.el('div', { class: 'lista-item', style: { cursor: 'pointer' }, onClick: () => window.navegar('notas') },
            ui.icon(p.total ? 'check' : 'nota'),
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, titulo),
              subPartes.length ? ui.el('div', { class: 'sub' }, subPartes.join(' · ')) : null),
            ui.el('div', { class: 'acciones' }, chip)));
        }
        if (pend.length > MAX) {
          card.append(ui.el('div', { class: 'texto-centrado mt' },
            ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => window.navegar('notas') },
              `Ver todas (${pend.length})`)));
        }
      }
      raiz.append(card);
    }

    // ---------- Racha de estudio ----------
    if (visible('racha')) {
      const fechasSesion = new Set(sesiones.map(s => String(s.fecha || '').slice(0, 10)).filter(Boolean));
      let racha = 0;
      const d = new Date();
      // Si hoy todavía no estudiaste, la racha no se corta: se cuenta desde ayer
      if (!fechasSesion.has(ui.hoyISO(d))) d.setDate(d.getDate() - 1);
      while (fechasSesion.has(ui.hoyISO(d))) { racha++; d.setDate(d.getDate() - 1); }

      const card = tarjeta('objetivo', 'Racha de estudio');
      if (!racha) {
        card.append(vacioCorto('Todavía no hay racha. Con una sesión de estudio hoy, arrancás una.', 'estudio', 'Ir a Estudio'));
      } else {
        card.append(ui.el('div', { class: 'fila', style: { justifyContent: 'center', padding: '4px 0 8px' } },
          racha >= 2 ? ui.icon('fuego', 'grande') : null,
          ui.el('div', { class: 'texto-centrado' },
            ui.el('div', { style: { fontSize: '1.5rem', fontWeight: '700' } },
              `${racha} ${racha === 1 ? 'día' : 'días'} seguido${racha === 1 ? '' : 's'}`),
            ui.el('div', { class: 'texto-suave texto-chico' },
              racha >= 2 ? '¡Seguí así, no cortes la racha!' : 'Estudiá también mañana para encender la racha.'))));
        // Mini gráfico: minutos de estudio de los últimos 7 días
        const dias7 = [];
        for (let i = 6; i >= 0; i--) {
          const dd = new Date(); dd.setDate(dd.getDate() - i);
          const iso = ui.hoyISO(dd);
          const min = sesiones.filter(s => String(s.fecha || '').slice(0, 10) === iso)
            .reduce((t, s) => t + (Number(s.minutos) || 0), 0);
          dias7.push({ etiqueta: ui.DIAS_CORTO[dd.getDay()], valor: min });
        }
        if (dias7.some(x => x.valor > 0)) {
          const canvas = ui.el('canvas', { class: 'grafico' });
          card.append(canvas);
          ui.alPintar(() => ui.graficoBarras(canvas, dias7, { altura: 130, formato: v => `${v}'` }));
        }
      }
      raiz.append(card);
    }

    // ---------- Accesos rápidos ----------
    if (visible('accesos')) {
      const acceso = (icono, texto, moduloId) =>
        ui.el('button', { class: 'btn', style: { width: '100%' }, onClick: () => window.navegar(moduloId) },
          ui.icon(icono), texto);
      const card = tarjeta('mas', 'Accesos rápidos');
      card.append(ui.el('div', { class: 'grilla grilla-2' },
        acceso('gota', 'Registrar agua', 'dieta'),
        acceso('nota', 'Nueva nota', 'notas'),
        acceso('caminar', 'Iniciar recorrido', 'ubicacion'),
        acceso('dinero', 'Registrar gasto', 'economia')));
      raiz.append(card);
    }
  };

  await pintar();
}

export default { id: 'dashboard', nombre: 'Inicio', icono: 'home', render };
