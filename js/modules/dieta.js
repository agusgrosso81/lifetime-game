// dieta.js — Módulo de dieta: comidas del día, agua, base de alimentos y estadísticas.
// Stores usados: alimentos, comidas, envases, agua.
import { db } from '../db.js';
import { ui } from '../ui.js';

const TIPOS_DEF = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];

// Colores fijos para macros (coinciden entre barras, torta y chips)
const COL = { prot: '#42c98d', carb: '#f2c14e', grasa: '#f7734f', agua: '#4fd0e0' };

// ~25 alimentos comunes argentinos, valores aproximados por porción
const SEED_ALIMENTOS = [
  { nombre: 'Milanesa con puré', porcion: '1 plato', unidad: 'plato', kcal: 650, prot: 35, carb: 55, grasa: 30 },
  { nombre: 'Fideos con salsa', porcion: '1 plato', unidad: 'plato', kcal: 550, prot: 15, carb: 90, grasa: 12 },
  { nombre: 'Arroz cocido', porcion: '1 taza', unidad: 'taza', kcal: 205, prot: 4, carb: 45, grasa: 0.5 },
  { nombre: 'Asado', porcion: '200 g', unidad: 'porción', kcal: 600, prot: 40, carb: 0, grasa: 48 },
  { nombre: 'Empanada de carne', porcion: '1 unidad', unidad: 'unidad', kcal: 280, prot: 10, carb: 25, grasa: 15 },
  { nombre: 'Pizza', porcion: '2 porciones', unidad: 'porción', kcal: 540, prot: 22, carb: 60, grasa: 22 },
  { nombre: 'Hamburguesa completa', porcion: '1 unidad', unidad: 'unidad', kcal: 650, prot: 30, carb: 50, grasa: 35 },
  { nombre: 'Papas fritas', porcion: '1 porción', unidad: 'porción', kcal: 400, prot: 5, carb: 50, grasa: 20 },
  { nombre: 'Ensalada mixta', porcion: '1 plato', unidad: 'plato', kcal: 90, prot: 2, carb: 10, grasa: 5 },
  { nombre: 'Pollo al horno', porcion: '1/4 pollo', unidad: 'porción', kcal: 350, prot: 40, carb: 0, grasa: 20 },
  { nombre: 'Huevo', porcion: '1 unidad', unidad: 'unidad', kcal: 75, prot: 6, carb: 0.5, grasa: 5 },
  { nombre: 'Tortilla de papas', porcion: '1 porción', unidad: 'porción', kcal: 320, prot: 9, carb: 30, grasa: 18 },
  { nombre: 'Sándwich de jamón y queso', porcion: '1 unidad', unidad: 'unidad', kcal: 350, prot: 18, carb: 35, grasa: 15 },
  { nombre: 'Pan', porcion: '2 rodajas', unidad: 'rodaja', kcal: 160, prot: 5, carb: 30, grasa: 2 },
  { nombre: 'Factura', porcion: '1 unidad', unidad: 'unidad', kcal: 220, prot: 4, carb: 27, grasa: 11 },
  { nombre: 'Galletitas dulces', porcion: '6 unidades', unidad: 'unidad', kcal: 250, prot: 3, carb: 38, grasa: 9 },
  { nombre: 'Yogur', porcion: '1 pote', unidad: 'pote', kcal: 120, prot: 5, carb: 17, grasa: 3 },
  { nombre: 'Leche con cacao', porcion: '1 taza', unidad: 'taza', kcal: 180, prot: 8, carb: 24, grasa: 6 },
  { nombre: 'Queso', porcion: '50 g', unidad: 'porción', kcal: 180, prot: 12, carb: 1, grasa: 14 },
  { nombre: 'Dulce de leche', porcion: '2 cucharadas', unidad: 'cda', kcal: 130, prot: 2, carb: 22, grasa: 3 },
  { nombre: 'Banana', porcion: '1 unidad', unidad: 'unidad', kcal: 105, prot: 1, carb: 27, grasa: 0.5 },
  { nombre: 'Manzana', porcion: '1 unidad', unidad: 'unidad', kcal: 95, prot: 0.5, carb: 25, grasa: 0.3 },
  { nombre: 'Naranja', porcion: '1 unidad', unidad: 'unidad', kcal: 62, prot: 1, carb: 15, grasa: 0.2 },
  { nombre: 'Avena', porcion: '1/2 taza', unidad: 'taza', kcal: 150, prot: 5, carb: 27, grasa: 3 },
  { nombre: 'Atún al natural', porcion: '1 lata', unidad: 'lata', kcal: 130, prot: 28, carb: 0, grasa: 1.5 },
  { nombre: 'Mate cocido con azúcar', porcion: '1 taza', unidad: 'taza', kcal: 45, prot: 0.5, carb: 11, grasa: 0 },
];

const SEED_ENVASES = [
  { nombre: 'Vaso', ml: 250 },
  { nombre: 'Botella chica', ml: 500 },
  { nombre: 'Botella grande', ml: 1000 },
  { nombre: 'Termo', ml: 750 },
];

// Número tolerante: acepta coma decimal ("0,5") y basura → 0
const num = v => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r1 = v => Math.round(v * 10) / 10;

function sumaItems(items) {
  const t = { kcal: 0, prot: 0, carb: 0, grasa: 0 };
  for (const it of items || []) { t.kcal += num(it.kcal); t.prot += num(it.prot); t.carb += num(it.carb); t.grasa += num(it.grasa); }
  return t;
}

function moverDia(iso, n) { const d = ui.desdeISO(iso); d.setDate(d.getDate() + n); return ui.hoyISO(d); }

async function objetivos() {
  return {
    kcal: await db.getSetting('dieta.objetivoKcal', 2000),
    prot: await db.getSetting('dieta.objetivoProt', 70),
    carb: await db.getSetting('dieta.objetivoCarb', 260),
    grasa: await db.getSetting('dieta.objetivoGrasa', 70),
    agua: await db.getSetting('dieta.objetivoAgua', 2000),
  };
}

// Siembra inicial: solo si el store está vacío Y nunca se sembró (si el usuario borró todo, no re-sembramos)
async function sembrarSiHaceFalta() {
  if (!(await db.getSetting('dieta.seedAlimentos', false)) && (await db.count('alimentos')) === 0) {
    await db.putMany('alimentos', SEED_ALIMENTOS.map(a => ({ ...a })));
    await db.setSetting('dieta.seedAlimentos', true);
  }
  if (!(await db.getSetting('dieta.seedEnvases', false)) && (await db.count('envases')) === 0) {
    await db.putMany('envases', SEED_ENVASES.map(e => ({ ...e })));
    await db.setSetting('dieta.seedEnvases', true);
  }
}

// Línea punteada del objetivo sobre un gráfico de línea ya dibujado.
// Replica la escala interna de ui.graficoLinea; solo dibuja si el objetivo entra en el rango visible.
function dibujarObjetivo(canvas, vals, objetivo, altura) {
  if (!vals.length) return;
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  if (objetivo > max || objetivo < min) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const mx = 14, baseY = altura - 22, topY = 14;
  const y = baseY - ((objetivo - min) / (max - min || 1)) * (baseY - topY);
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = (getComputedStyle(document.documentElement).getPropertyValue('--alerta') || '#f2c14e').trim();
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(w - mx, y); ctx.stroke();
  ctx.restore();
}

// Fila etiqueta + valor/objetivo + barra de progreso
function filaProgreso(etq, actual, objetivo, unidad, color) {
  return ui.el('div', { class: 'mb' },
    ui.el('div', { class: 'fila espaciado', style: { marginBottom: '4px' } },
      ui.el('span', { class: 'texto-chico', style: { fontWeight: '600' } }, etq),
      ui.el('span', { class: 'texto-chico texto-suave' }, `${actual} / ${objetivo} ${unidad}`)),
    ui.barraProgreso(actual, objetivo, { color }));
}

async function render(cont) {
  await sembrarSiHaceFalta();
  cont.append(ui.el('div', { class: 'cabecera-modulo' }, ui.el('h2', {}, ui.icon('comida'), 'Dieta')));

  // Fecha seleccionada, compartida entre Hoy y Agua (así no perdés el día al cambiar de pestaña)
  let fechaSel = ui.hoyISO();
  // Filtro del buscador de Alimentos (persiste mientras el módulo está abierto)
  let filtroAlimentos = '';

  function barraFecha(alCambiar) {
    const esHoy = fechaSel === ui.hoyISO();
    return ui.el('div', { class: 'tarjeta', style: { padding: '8px 10px' } },
      ui.el('div', { class: 'fila espaciado', style: { flexWrap: 'nowrap' } },
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Día anterior', onClick: () => { fechaSel = moverDia(fechaSel, -1); alCambiar(); } }, ui.icon('flecha_izq')),
        ui.el('div', { class: 'texto-centrado', style: { flex: '1', minWidth: 0 } },
          ui.el('div', { style: { fontWeight: '700' } }, esHoy ? 'Hoy' : ui.fmtFecha(fechaSel)),
          esHoy
            ? ui.el('div', { class: 'texto-suave texto-chico' }, ui.fmtFecha(fechaSel))
            : ui.el('button', { class: 'btn btn-chico btn-sec', style: { marginTop: '2px' }, onClick: () => { fechaSel = ui.hoyISO(); alCambiar(); } }, 'Volver a hoy')),
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Día siguiente', onClick: () => { fechaSel = moverDia(fechaSel, 1); alCambiar(); } }, ui.icon('flecha_der'))));
  }

  // ==================== HOY ====================

  async function modalObjetivos(rep) {
    const obj = await objetivos();
    const fK = ui.campo({ tipo: 'number', etiqueta: 'Calorías (kcal)', valor: obj.kcal, min: 1 });
    const fP = ui.campo({ tipo: 'number', etiqueta: 'Proteínas (g)', valor: obj.prot, min: 1 });
    const fC = ui.campo({ tipo: 'number', etiqueta: 'Carbohidratos (g)', valor: obj.carb, min: 1 });
    const fG = ui.campo({ tipo: 'number', etiqueta: 'Grasas (g)', valor: obj.grasa, min: 1 });
    ui.modal({
      titulo: 'Objetivos diarios',
      cuerpo: ui.el('div', {}, fK, ui.el('div', { class: 'fila-campos' }, fP, fC), fG),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          await db.setSetting('dieta.objetivoKcal', num(fK.input.value) > 0 ? num(fK.input.value) : 2000);
          await db.setSetting('dieta.objetivoProt', num(fP.input.value) > 0 ? num(fP.input.value) : 70);
          await db.setSetting('dieta.objetivoCarb', num(fC.input.value) > 0 ? num(fC.input.value) : 260);
          await db.setSetting('dieta.objetivoGrasa', num(fG.input.value) > 0 ? num(fG.input.value) : 70);
          cerrar(); ui.toast('Objetivos guardados'); rep();
        } },
      ],
    });
  }

  async function modalTipos(rep) {
    const tipos = await db.getSetting('dieta.tiposComida', TIPOS_DEF);
    const lista = ui.el('div', {});
    const filas = [];
    const agregarFila = (valor) => {
      const inp = ui.el('input', { class: 'input', value: valor, placeholder: 'Nombre de la comida', style: { flex: '1', minWidth: 0 } });
      const fila = ui.el('div', { class: 'fila mb', style: { flexWrap: 'nowrap' } },
        inp,
        ui.el('button', { class: 'btn-icono', 'aria-label': 'Quitar', onClick: () => {
          fila.remove();
          const ix = filas.indexOf(fila); if (ix >= 0) filas.splice(ix, 1);
        } }, ui.icon('basura')));
      fila.inp = inp;
      filas.push(fila);
      lista.append(fila);
    };
    tipos.forEach(agregarFila);
    const cuerpo = ui.el('div', {},
      ui.el('p', { class: 'texto-suave texto-chico' },
        'Renombrá, borrá o agregá tipos de comida. Ojo: si renombrás uno, los registros viejos quedan con el nombre anterior (igual se siguen mostrando).'),
      lista,
      ui.el('button', { class: 'btn btn-sec btn-chico', onClick: () => agregarFila('') }, ui.icon('mas'), 'Agregar tipo'));
    ui.modal({
      titulo: 'Tipos de comida',
      cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          const nuevos = filas.map(f => f.inp.value.trim()).filter(Boolean);
          if (!nuevos.length) { ui.toast('Dejá al menos un tipo de comida', 'error'); return; }
          await db.setSetting('dieta.tiposComida', nuevos);
          cerrar(); ui.toast('Tipos guardados'); rep();
        } },
      ],
    });
  }

  async function modalAgregarItem(tipo, rep) {
    const alimentos = (await db.getAll('alimentos')).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const cuerpo = ui.el('div', {});
    const m = ui.modal({ titulo: `Agregar a ${tipo}`, cuerpo });

    const agregar = async (item) => {
      const delDia = await db.getBy('comidas', 'fecha', fechaSel);
      let reg = delDia.find(x => x.tipo === tipo);
      if (!reg) reg = { fecha: fechaSel, tipo, hora: ui.ahoraHM(), items: [] };
      if (!Array.isArray(reg.items)) reg.items = [];
      reg.items.push(item);
      await db.put('comidas', reg);
      m.cerrar();
      ui.toast(`${item.nombre} agregado a ${tipo}`);
      rep();
    };

    ui.tabs([
      { id: 'buscar', texto: 'Buscar', render: (cc) => {
        const fCant = ui.campo({ tipo: 'number', etiqueta: 'Cantidad (multiplica la porción)', valor: 1, min: 0, step: '0.5' });
        const fBusca = ui.campo({ tipo: 'text', etiqueta: 'Buscar alimento', placeholder: 'Escribí para filtrar…' });
        const res = ui.el('div', {});
        const pintarRes = () => {
          res.innerHTML = '';
          const q = fBusca.input.value.trim().toLowerCase();
          const vis = alimentos.filter(a => !q || (a.nombre || '').toLowerCase().includes(q));
          if (!vis.length) {
            res.append(ui.estadoVacio(alimentos.length
              ? 'Nada con ese nombre. Probá la pestaña Manual.'
              : 'La base de alimentos está vacía. Cargala en la pestaña Alimentos o usá Manual.', 'buscar'));
            return;
          }
          for (const a of vis.slice(0, 30)) {
            res.append(ui.el('div', { class: 'lista-item', style: { cursor: 'pointer' }, onClick: () => {
              const cant = num(fCant.input.value) || 1;
              if (cant <= 0) { ui.toast('La cantidad tiene que ser mayor a 0', 'error'); return; }
              agregar({
                nombre: a.nombre, cantidad: cant,
                kcal: r1(num(a.kcal) * cant), prot: r1(num(a.prot) * cant),
                carb: r1(num(a.carb) * cant), grasa: r1(num(a.grasa) * cant),
              });
            } },
              ui.el('div', { class: 'principal' },
                ui.el('div', { class: 'titulo' }, a.nombre),
                ui.el('div', { class: 'sub' }, `${a.porcion || '1 porción'} · ${Math.round(num(a.kcal))} kcal · P ${r1(num(a.prot))} · C ${r1(num(a.carb))} · G ${r1(num(a.grasa))}`)),
              ui.icon('mas')));
          }
        };
        fBusca.input.addEventListener('input', pintarRes);
        cc.append(fCant, fBusca,
          ui.el('p', { class: 'texto-suave texto-chico' }, 'Tocá un alimento para agregarlo con esa cantidad.'),
          res);
        pintarRes();
        fBusca.input.focus();
      } },
      { id: 'manual', texto: 'Manual', render: (cc) => {
        const fN = ui.campo({ tipo: 'text', etiqueta: 'Nombre', placeholder: 'Ej: guiso de la abuela' });
        const fK = ui.campo({ tipo: 'number', etiqueta: 'Calorías (kcal)', valor: '', min: 0 });
        const fP = ui.campo({ tipo: 'number', etiqueta: 'Proteínas (g)', valor: '', min: 0, step: '0.1' });
        const fC = ui.campo({ tipo: 'number', etiqueta: 'Carbohidratos (g)', valor: '', min: 0, step: '0.1' });
        const fG = ui.campo({ tipo: 'number', etiqueta: 'Grasas (g)', valor: '', min: 0, step: '0.1' });
        cc.append(fN, fK, ui.el('div', { class: 'fila-campos' }, fP, fC), fG,
          ui.el('button', { class: 'btn btn-primario', onClick: () => {
            const nombre = fN.input.value.trim();
            if (!nombre) { ui.toast('Poné un nombre', 'error'); return; }
            agregar({ nombre, cantidad: 1, kcal: r1(num(fK.input.value)), prot: r1(num(fP.input.value)), carb: r1(num(fC.input.value)), grasa: r1(num(fG.input.value)) });
          } }, ui.icon('check'), 'Agregar'));
      } },
    ], cuerpo);
  }

  async function pintarHoy(c) {
    c.innerHTML = '';
    const rep = () => pintarHoy(c);
    const tipos = await db.getSetting('dieta.tiposComida', TIPOS_DEF);
    const obj = await objetivos();
    const delDia = await db.getBy('comidas', 'fecha', fechaSel);

    c.append(barraFecha(rep));

    // Total del día con progreso contra objetivos
    const tot = sumaItems(delDia.flatMap(x => x.items || []));
    c.append(ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, ui.icon('objetivo'), 'Total del día'),
        ui.el('div', { class: 'fila' },
          ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => modalObjetivos(rep) }, ui.icon('objetivo'), 'Objetivos'),
          ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => modalTipos(rep) }, ui.icon('ajustes'), 'Comidas'))),
      filaProgreso('Calorías', Math.round(tot.kcal), obj.kcal, 'kcal', null),
      filaProgreso('Proteínas', r1(tot.prot), obj.prot, 'g', COL.prot),
      filaProgreso('Carbohidratos', r1(tot.carb), obj.carb, 'g', COL.carb),
      filaProgreso('Grasas', r1(tot.grasa), obj.grasa, 'g', COL.grasa)));

    // Secciones por tipo (más los tipos "viejos" que tengan registros ese día, para no esconder datos)
    const extras = delDia.map(x => x.tipo).filter(t => !tipos.includes(t));
    for (const tipo of [...tipos, ...extras]) {
      const reg = delDia.find(x => x.tipo === tipo);
      const st = sumaItems(reg ? reg.items : []);
      const card = ui.el('div', { class: 'tarjeta' },
        ui.el('div', { class: 'tarjeta-titulo' },
          ui.el('h3', {}, tipo),
          ui.el('div', { class: 'fila' },
            reg && (reg.items || []).length ? ui.el('span', { class: 'chip chip-acento' }, `${Math.round(st.kcal)} kcal`) : null,
            ui.el('button', { class: 'btn btn-chico btn-primario', onClick: () => modalAgregarItem(tipo, rep) }, ui.icon('mas'), 'Agregar'))));
      if (!reg || !(reg.items || []).length) {
        card.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Sin registros todavía.'));
      } else {
        card.append(ui.el('p', { class: 'texto-suave texto-chico' },
          `P ${r1(st.prot)} g · C ${r1(st.carb)} g · G ${r1(st.grasa)} g${reg.hora ? ' · primer registro ' + reg.hora : ''}`));
        reg.items.forEach((it, i) => {
          card.append(ui.el('div', { class: 'lista-item' },
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, it.nombre + (num(it.cantidad) !== 1 ? ` ×${num(it.cantidad)}` : '')),
              ui.el('div', { class: 'sub' }, `${Math.round(num(it.kcal))} kcal · P ${r1(num(it.prot))} · C ${r1(num(it.carb))} · G ${r1(num(it.grasa))} g`)),
            ui.el('div', { class: 'acciones' },
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar ítem', onClick: async () => {
                reg.items.splice(i, 1);
                if (reg.items.length) await db.put('comidas', reg);
                else await db.del('comidas', reg.id); // sin ítems no dejamos el registro vacío
                ui.toast('Ítem borrado');
                rep();
              } }, ui.icon('basura')))));
        });
      }
      c.append(card);
    }
  }

  // ==================== AGUA ====================

  async function registrarAgua(ml, envaseId, rep) {
    if (!(ml > 0)) { ui.toast('La cantidad tiene que ser mayor a 0', 'error'); return; }
    await db.put('agua', { fecha: fechaSel, hora: ui.ahoraHM(), ml: Math.round(ml), envaseId: envaseId || null });
    ui.toast(`+${Math.round(ml)} ml de agua`);
    rep();
  }

  function modalCantidadLibre(rep) {
    const fMl = ui.campo({ tipo: 'number', etiqueta: 'Mililitros', valor: '', min: 1, placeholder: 'Ej: 330' });
    ui.modal({
      titulo: 'Registrar otra cantidad',
      cuerpo: ui.el('div', {}, fMl),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Registrar', clase: 'btn-primario', onClick: async (cerrar) => {
          const ml = num(fMl.input.value);
          if (!(ml > 0)) { ui.toast('Poné una cantidad mayor a 0', 'error'); return; }
          cerrar();
          await registrarAgua(ml, null, rep);
        } },
      ],
    });
    fMl.input.focus();
  }

  async function modalObjetivoAgua(rep) {
    const actual = await db.getSetting('dieta.objetivoAgua', 2000);
    const fMl = ui.campo({ tipo: 'number', etiqueta: 'Objetivo diario (ml)', valor: actual, min: 1 });
    ui.modal({
      titulo: 'Objetivo de agua',
      cuerpo: ui.el('div', {}, fMl),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          await db.setSetting('dieta.objetivoAgua', num(fMl.input.value) > 0 ? Math.round(num(fMl.input.value)) : 2000);
          cerrar(); ui.toast('Objetivo guardado'); rep();
        } },
      ],
    });
  }

  function formEnvase(env, rep) {
    const fN = ui.campo({ tipo: 'text', etiqueta: 'Nombre', valor: env ? env.nombre : '', placeholder: 'Ej: Botella del cole' });
    const fMl = ui.campo({ tipo: 'number', etiqueta: 'Mililitros', valor: env ? env.ml : '', min: 1 });
    ui.modal({
      titulo: env ? 'Editar envase' : 'Nuevo envase',
      cuerpo: ui.el('div', {}, fN, fMl),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          const nombre = fN.input.value.trim();
          const ml = Math.round(num(fMl.input.value));
          if (!nombre || !(ml > 0)) { ui.toast('Completá nombre y mililitros (mayor a 0)', 'error'); return; }
          await db.put('envases', { ...(env || {}), nombre, ml });
          cerrar(); ui.toast('Envase guardado'); rep();
        } },
      ],
    });
  }

  async function modalEnvases(rep) {
    const envases = (await db.getAll('envases')).sort((a, b) => num(a.ml) - num(b.ml));
    const cuerpo = ui.el('div', {});
    const m = ui.modal({ titulo: 'Tus envases', cuerpo });
    if (!envases.length) {
      cuerpo.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'No tenés envases. Creá uno para registrar agua con un solo toque.'));
    }
    for (const e of envases) {
      cuerpo.append(ui.el('div', { class: 'lista-item' },
        ui.icon('gota'),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, e.nombre),
          ui.el('div', { class: 'sub' }, `${e.ml} ml`)),
        ui.el('div', { class: 'acciones' },
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => { m.cerrar(); formEnvase(e, rep); } }, ui.icon('editar')),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
            if (!(await ui.confirmar(`¿Borrar el envase "${e.nombre}"? Los registros de agua ya hechos no se tocan.`))) return;
            await db.del('envases', e.id);
            m.cerrar(); ui.toast('Envase borrado'); rep();
          } }, ui.icon('basura')))));
    }
    cuerpo.append(ui.el('button', { class: 'btn btn-primario mt mb', onClick: () => { m.cerrar(); formEnvase(null, rep); } }, ui.icon('mas'), 'Nuevo envase'));
  }

  async function pintarAgua(c) {
    c.innerHTML = '';
    const rep = () => pintarAgua(c);
    const objAgua = await db.getSetting('dieta.objetivoAgua', 2000);
    const envases = (await db.getAll('envases')).sort((a, b) => num(a.ml) - num(b.ml));
    const regs = await db.getBy('agua', 'fecha', fechaSel);
    regs.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    const total = regs.reduce((s, r) => s + num(r.ml), 0);
    const pct = objAgua ? Math.round(total / objAgua * 100) : 0;

    c.append(barraFecha(rep));

    // Progreso grande del día
    const card = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, ui.icon('gota'), 'Agua del día'),
        ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => modalObjetivoAgua(rep) }, ui.icon('objetivo'), 'Objetivo')),
      ui.el('div', { class: 'metrica' },
        ui.el('div', { class: 'valor', style: total >= objAgua ? { color: 'var(--ok)' } : {} }, `${total} ml`),
        ui.el('div', { class: 'etiqueta' }, `de ${objAgua} ml (${pct}%)`)),
      ui.barraProgreso(total, objAgua, { color: COL.agua, texto: `${Math.min(100, pct)}%` }));
    if (total >= objAgua && objAgua > 0) {
      card.append(ui.el('p', { class: 'texto-ok texto-chico mt sin-margen texto-centrado' }, '¡Objetivo cumplido, seguí así!'));
    }
    c.append(card);

    // Botones grandes por envase + cantidad libre
    const cardBot = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, 'Registrar'),
        ui.el('button', { class: 'btn btn-chico btn-sec', onClick: () => modalEnvases(rep) }, ui.icon('editar'), 'Envases')));
    const grilla = ui.el('div', { class: 'grilla grilla-2' });
    for (const e of envases) {
      grilla.append(ui.el('button', {
        class: 'btn',
        style: { flexDirection: 'column', gap: '3px', padding: '14px 8px', width: '100%' },
        onClick: () => registrarAgua(num(e.ml), e.id, rep),
      },
        ui.icon('gota'),
        ui.el('span', {}, e.nombre),
        ui.el('span', { class: 'texto-suave texto-chico' }, `${e.ml} ml`)));
    }
    grilla.append(ui.el('button', {
      class: 'btn btn-sec',
      style: { flexDirection: 'column', gap: '3px', padding: '14px 8px', width: '100%' },
      onClick: () => modalCantidadLibre(rep),
    }, ui.icon('mas'), ui.el('span', {}, 'Otra cantidad')));
    cardBot.append(grilla);
    if (!envases.length) {
      cardBot.append(ui.el('p', { class: 'texto-suave texto-chico mt sin-margen' }, 'Tip: creá envases (Vaso, Botella…) para registrar con un solo toque.'));
    }
    c.append(cardBot);

    // Historial del día con deshacer
    const cardHist = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Historial del día'));
    if (!regs.length) {
      cardHist.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Todavía no registraste agua este día.'));
    } else {
      [...regs].reverse().forEach(r => {
        const env = envases.find(e => e.id === r.envaseId);
        cardHist.append(ui.el('div', { class: 'lista-item' },
          ui.icon('gota'),
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo' }, `${r.ml} ml`),
            ui.el('div', { class: 'sub' }, `${r.hora || ''}${env ? ' · ' + env.nombre : ''}`)),
          ui.el('div', { class: 'acciones' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Deshacer', onClick: async () => {
              await db.del('agua', r.id);
              ui.toast('Registro borrado');
              rep();
            } }, ui.icon('basura')))));
      });
    }
    c.append(cardHist);
  }

  // ==================== ALIMENTOS ====================

  function formAlimento(a, rep) {
    const fN = ui.campo({ tipo: 'text', etiqueta: 'Nombre', valor: a ? a.nombre : '', placeholder: 'Ej: ñoquis con tuco' });
    const fPor = ui.campo({ tipo: 'text', etiqueta: 'Porción', valor: a ? (a.porcion || '') : '', placeholder: 'Ej: 1 plato, 2 unidades' });
    const fU = ui.campo({ tipo: 'text', etiqueta: 'Unidad', valor: a ? (a.unidad || '') : '', placeholder: 'Ej: plato, unidad, taza' });
    const fK = ui.campo({ tipo: 'number', etiqueta: 'Calorías (kcal)', valor: a ? a.kcal : '', min: 0 });
    const fP = ui.campo({ tipo: 'number', etiqueta: 'Proteínas (g)', valor: a ? a.prot : '', min: 0, step: '0.1' });
    const fC = ui.campo({ tipo: 'number', etiqueta: 'Carbohidratos (g)', valor: a ? a.carb : '', min: 0, step: '0.1' });
    const fG = ui.campo({ tipo: 'number', etiqueta: 'Grasas (g)', valor: a ? a.grasa : '', min: 0, step: '0.1' });
    ui.modal({
      titulo: a ? 'Editar alimento' : 'Nuevo alimento',
      cuerpo: ui.el('div', {},
        fN,
        ui.el('div', { class: 'fila-campos' }, fPor, fU),
        fK,
        ui.el('div', { class: 'fila-campos' }, fP, fC),
        fG,
        ui.el('p', { class: 'texto-suave texto-chico' }, 'Los valores son por porción. Después, al cargar una comida, podés usar medias porciones (0,5) o varias (2, 3…).')),
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: async (cerrar) => {
          const nombre = fN.input.value.trim();
          if (!nombre) { ui.toast('Poné un nombre', 'error'); return; }
          await db.put('alimentos', {
            ...(a || {}),
            nombre,
            porcion: fPor.input.value.trim() || '1 porción',
            unidad: fU.input.value.trim() || 'porción',
            kcal: num(fK.input.value), prot: num(fP.input.value),
            carb: num(fC.input.value), grasa: num(fG.input.value),
          });
          cerrar(); ui.toast('Alimento guardado'); rep();
        } },
      ],
    });
  }

  async function pintarAlimentos(c) {
    c.innerHTML = '';
    const rep = () => pintarAlimentos(c);
    const alimentos = (await db.getAll('alimentos')).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    const fBusca = ui.el('input', { class: 'input', placeholder: 'Buscar alimento…', value: filtroAlimentos, style: { flex: '1', minWidth: 0 } });
    const lista = ui.el('div', {});
    const pintarLista = () => {
      lista.innerHTML = '';
      const q = filtroAlimentos.trim().toLowerCase();
      const vis = alimentos.filter(a => !q || (a.nombre || '').toLowerCase().includes(q));
      if (!vis.length) {
        lista.append(ui.estadoVacio(alimentos.length
          ? 'No hay alimentos con ese nombre.'
          : 'La base está vacía. Agregá tu primer alimento con el botón Nuevo.', 'comida'));
        return;
      }
      for (const a of vis) {
        lista.append(ui.el('div', { class: 'lista-item' },
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo' }, a.nombre),
            ui.el('div', { class: 'sub' }, `${a.porcion || '1 porción'} · ${Math.round(num(a.kcal))} kcal · P ${r1(num(a.prot))} g · C ${r1(num(a.carb))} g · G ${r1(num(a.grasa))} g`)),
          ui.el('div', { class: 'acciones' },
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => formAlimento(a, rep) }, ui.icon('editar')),
            ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
              if (!(await ui.confirmar(`¿Borrar "${a.nombre}" de la base? Lo que ya registraste en tus comidas no se toca.`))) return;
              await db.del('alimentos', a.id);
              ui.toast('Alimento borrado');
              rep();
            } }, ui.icon('basura')))));
      }
    };
    fBusca.addEventListener('input', () => { filtroAlimentos = fBusca.value; pintarLista(); });

    c.append(ui.el('div', { class: 'fila mb', style: { flexWrap: 'nowrap' } },
      fBusca,
      ui.el('button', { class: 'btn btn-primario', style: { flexShrink: 0 }, onClick: () => formAlimento(null, rep) }, ui.icon('mas'), 'Nuevo')));
    c.append(ui.el('div', { class: 'tarjeta' }, lista));
    pintarLista();
  }

  // ==================== ESTADÍSTICAS ====================

  async function pintarStats(c) {
    c.innerHTML = '';
    const obj = await objetivos();

    // Últimos 14 días (incluye hoy)
    const dias = [];
    for (let i = 13; i >= 0; i--) dias.push(moverDia(ui.hoyISO(), -i));
    const comidas = await db.getRango('comidas', 'fecha', dias[0], dias[dias.length - 1]);
    const aguas = await db.getRango('agua', 'fecha', dias[0], dias[dias.length - 1]);

    const porDia = {};
    dias.forEach(d => { porDia[d] = { kcal: 0, prot: 0, carb: 0, grasa: 0, agua: 0, conComida: false }; });
    for (const cm of comidas) {
      const p = porDia[cm.fecha]; if (!p) continue;
      const t = sumaItems(cm.items);
      p.kcal += t.kcal; p.prot += t.prot; p.carb += t.carb; p.grasa += t.grasa;
      if ((cm.items || []).length) p.conComida = true;
    }
    for (const r of aguas) { const p = porDia[r.fecha]; if (p) p.agua += num(r.ml); }

    const etq = d => String(Number(d.slice(8, 10)));
    const datosKcal = dias.map(d => ({ etiqueta: etq(d), valor: Math.round(porDia[d].kcal) }));
    const datosAgua = dias.map(d => ({ etiqueta: etq(d), valor: Math.round(porDia[d].agua) }));

    // Cumplimiento: kcal entre 80% y 110% del objetivo; agua desde el 80% (tomar de más no resta)
    const okKcal = dias.filter(d => porDia[d].kcal >= obj.kcal * 0.8 && porDia[d].kcal <= obj.kcal * 1.1).length;
    const okAgua = dias.filter(d => porDia[d].agua >= obj.agua * 0.8).length;

    c.append(ui.el('div', { class: 'grilla grilla-2 mb' },
      ui.el('div', { class: 'tarjeta metrica sin-margen' },
        ui.el('div', { class: 'valor' }, `${okKcal} / 14`),
        ui.el('div', { class: 'etiqueta' }, 'días con kcal en objetivo (80–110%)')),
      ui.el('div', { class: 'tarjeta metrica sin-margen' },
        ui.el('div', { class: 'valor' }, `${okAgua} / 14`),
        ui.el('div', { class: 'etiqueta' }, 'días con agua cumplida (desde 80%)'))));

    const cvKcal = ui.el('canvas', { class: 'grafico' });
    c.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, `Calorías por día (objetivo: ${obj.kcal} kcal)`),
      cvKcal,
      ui.el('p', { class: 'texto-suave texto-chico sin-margen mt' }, 'La línea punteada marca tu objetivo cuando entra en la escala del gráfico.')));

    const cvAgua = ui.el('canvas', { class: 'grafico' });
    c.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, `Agua por día (objetivo: ${obj.agua} ml)`),
      cvAgua));

    // Torta de macros promedio (sobre los días que tienen comidas registradas)
    const conDatos = dias.filter(d => porDia[d].conComida);
    const n = conDatos.length;
    const prom = k => n ? r1(conDatos.reduce((s, d) => s + porDia[d][k], 0) / n) : 0;
    const pProt = prom('prot'), pCarb = prom('carb'), pGrasa = prom('grasa');
    const hayMacros = (pProt + pCarb + pGrasa) > 0;

    const cardTorta = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Macros promedio por día (g)'));
    let cvTorta = null;
    if (!hayMacros) {
      cardTorta.append(ui.estadoVacio('Registrá comidas con macros para ver la distribución.', 'grafico'));
    } else {
      cvTorta = ui.el('canvas', { class: 'grafico' });
      cardTorta.append(cvTorta,
        ui.el('p', { class: 'texto-suave texto-chico sin-margen mt' },
          `Promedio sobre ${n} día${n === 1 ? '' : 's'} con registros de los últimos 14.`));
    }
    c.append(cardTorta);

    // Dibujar recién cuando los canvas ya están en el DOM
    ui.alPintar(() => {
      ui.graficoLinea(cvKcal, datosKcal, { altura: 180 });
      dibujarObjetivo(cvKcal, datosKcal.map(d => d.valor), obj.kcal, 180);
      ui.graficoLinea(cvAgua, datosAgua, { altura: 180, color: COL.agua });
      dibujarObjetivo(cvAgua, datosAgua.map(d => d.valor), obj.agua, 180);
      if (cvTorta) {
        ui.graficoTorta(cvTorta, [
          { etiqueta: `Proteínas ${pProt} g`, valor: pProt, color: COL.prot },
          { etiqueta: `Carbos ${pCarb} g`, valor: pCarb, color: COL.carb },
          { etiqueta: `Grasas ${pGrasa} g`, valor: pGrasa, color: COL.grasa },
        ]);
      }
    });
  }

  // ==================== Pestañas ====================

  ui.tabs([
    { id: 'hoy', texto: 'Hoy', render: (c) => { pintarHoy(c); } },
    { id: 'agua', texto: 'Agua', render: (c) => { pintarAgua(c); } },
    { id: 'alimentos', texto: 'Alimentos', render: (c) => { pintarAlimentos(c); } },
    { id: 'stats', texto: 'Estadísticas', render: (c) => { pintarStats(c); } },
  ], cont);
}

export default { id: 'dieta', nombre: 'Dieta', icono: 'comida', render };
