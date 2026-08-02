// economia.js — Módulo "Plata": movimientos de dinero, presupuestos por categoría y metas de ahorro.
// Stores: transacciones, categoriasEco, metasAhorro. Moneda global en setting 'moneda'.
// Settings propios: 'economia.seed', 'economia.metodos', 'economia.saldoInicial'.
import { db } from '../db.js';
import { ui } from '../ui.js';

// ---------- Seeds ----------
const SEED_CATEGORIAS = [
  // gastos
  { nombre: 'Comida',     tipo: 'gasto',   color: '#f7734f' },
  { nombre: 'Transporte', tipo: 'gasto',   color: '#f2c14e' },
  { nombre: 'Salidas',    tipo: 'gasto',   color: '#f75f8f' },
  { nombre: 'Ropa',       tipo: 'gasto',   color: '#a06ef7' },
  { nombre: 'Estudio',    tipo: 'gasto',   color: '#4f8ef7' },
  { nombre: 'Regalos',    tipo: 'gasto',   color: '#42c98d' },
  { nombre: 'Otros',      tipo: 'gasto',   color: '#95a5a6' },
  // ingresos
  { nombre: 'Mesada',     tipo: 'ingreso', color: '#42c98d' },
  { nombre: 'Trabajo',    tipo: 'ingreso', color: '#4f8ef7' },
  { nombre: 'Regalo',     tipo: 'ingreso', color: '#f2c14e' },
  { nombre: 'Otros',      tipo: 'ingreso', color: '#95a5a6' },
];
const METODOS_DEFAULT = ['Efectivo', 'Transferencia', 'Tarjeta'];

async function seedCategorias() {
  const cant = await db.count('categoriasEco');
  const yaSembrado = await db.getSetting('economia.seed', false);
  if (cant === 0 && !yaSembrado) {
    await db.putMany('categoriasEco', SEED_CATEGORIAS.map(c => ({ ...c })));
    await db.setSetting('economia.seed', true);
  }
}

// ---------- Helpers de mes ('YYYY-MM') ----------
function mesActual() { return ui.hoyISO().slice(0, 7); }
function mesNombre(ym) {
  const [a, m] = ym.split('-').map(Number);
  return `${ui.MESES[m - 1]} ${a}`;
}
function mesSuma(ym, delta) {
  let [a, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; a--; }
  while (m > 12) { m -= 12; a++; }
  return `${a}-${String(m).padStart(2, '0')}`;
}
function diasEnMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
function transDelMes(ym) {
  return db.getRango('transacciones', 'fecha', ym + '-01', ym + '-31');
}

// Acepta "1500", "1500.50", "1500,50" y "1.500,50" (formato argentino). También negativos.
function parseMonto(v) {
  let s = String(v ?? '').trim().replace(/\s|\$/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

// ---------- Compatibilidad con registros viejos ----------
// Movimientos guardados por versiones anteriores pueden no tener 'tipo' o traer el
// monto como texto. Se normalizan al vuelo (sin tocar lo guardado): todo lo que no
// diga 'ingreso' cuenta como gasto, y un monto ilegible cuenta como 0.
function tipoDe(o) { return o && o.tipo === 'ingreso' ? 'ingreso' : 'gasto'; }
function esIngreso(t) { return tipoDe(t) === 'ingreso'; }
function montoDe(t) { const n = Number(t.monto); return isFinite(n) ? n : 0; }
function sumaMontos(lista) { return lista.reduce((s, t) => s + montoDe(t), 0); }

const CAT_FALLBACK = { nombre: 'Sin categoría', color: '#95a5a6', tipo: 'gasto' };
function catDe(cats, id) { return cats.find(c => c.id === id) || CAT_FALLBACK; }

// ---------- Saldo inicial (setting 'economia.saldoInicial') ----------
// Devuelve { monto, configurado }: 'configurado' distingue "nunca lo cargué"
// de "lo cargué y vale 0", para mostrar la sugerencia solo cuando corresponde.
async function leerSaldoInicial() {
  const guardado = await db.getSetting('economia.saldoInicial', null);
  const hayValor = guardado !== null && guardado !== undefined && guardado !== '';
  const n = Number(guardado);
  const valido = hayValor && isFinite(n);
  return { monto: valido ? n : 0, configurado: valido };
}

// ---------- Render principal ----------
async function render(cont) {
  await seedCategorias();

  let mesSel = mesActual(); // compartido entre Resumen y Movimientos
  let tabsCtl = null;
  const refrescarTab = () => { if (tabsCtl) tabsCtl.ir(tabsCtl.activa); };

  // Cabecera: el botón "Nuevo movimiento" vive acá para estar SIEMPRE a mano,
  // sin importar en qué pestaña esté parado el usuario.
  cont.append(ui.el('div', { class: 'cabecera-modulo' },
    ui.el('h2', {}, ui.icon('dinero'), 'Plata'),
    ui.el('div', { class: 'fila', style: { gap: '8px' } },
      ui.el('button', { class: 'btn btn-chico', onClick: () => modalCategorias(refrescarTab) },
        ui.icon('etiqueta'), 'Categorías'),
      ui.el('button', { class: 'btn btn-primario', onClick: () => modalTransaccion(null, refrescarTab) },
        ui.icon('mas'), 'Nuevo movimiento'))));

  // Selector de mes con flechas (compartido)
  function selectorMes(onCambio) {
    return ui.el('div', { class: 'fila espaciado mb', style: { flexWrap: 'nowrap' } },
      ui.el('button', { class: 'btn-icono', 'aria-label': 'Mes anterior', onClick: () => { mesSel = mesSuma(mesSel, -1); onCambio(); } }, ui.icon('flecha_izq')),
      ui.el('strong', { style: { textTransform: 'capitalize' } }, mesNombre(mesSel)),
      ui.el('button', { class: 'btn-icono', 'aria-label': 'Mes siguiente', onClick: () => { mesSel = mesSuma(mesSel, 1); onCambio(); } }, ui.icon('flecha_der')));
  }

  // ==================================================================
  // TAB 1: RESUMEN
  // ==================================================================
  async function renderResumen(tc) {
    const moneda = await db.getSetting('moneda', '$');
    const fmt = n => ui.fmtMonto(n, moneda);

    const caja = ui.el('div');
    tc.append(caja);

    async function pintar() {
      caja.innerHTML = '';
      // Se releen en cada pintada: pueden haber cambiado desde el modal de categorías.
      const cats = await db.getAll('categoriasEco');

      // ---- Saldo total = saldo inicial + ingresos − gastos (toda la historia) ----
      const { monto: saldoInicial, configurado: siConfigurado } = await leerSaldoInicial();
      const todas = await db.getAll('transacciones');
      const ingTotal = sumaMontos(todas.filter(esIngreso));
      const gasTotal = sumaMontos(todas.filter(t => !esIngreso(t)));
      const saldo = saldoInicial + ingTotal - gasTotal;

      const cardSaldo = ui.el('div', { class: 'tarjeta metrica' },
        ui.el('div', { class: 'valor ' + (saldo >= 0 ? 'texto-ok' : 'texto-peligro'), style: { fontSize: '2rem' } }, fmt(saldo)),
        ui.el('div', { class: 'etiqueta' }, 'Saldo total (toda la historia)'),
        ui.el('div', { class: 'texto-chico texto-suave', style: { marginTop: '6px' } },
          `Inicial ${fmt(saldoInicial)} + ingresos ${fmt(ingTotal)} − gastos ${fmt(gasTotal)}`));

      if (!siConfigurado) {
        // Sugerencia sutil: solo un renglón suave, sin cartel ni interrupción.
        cardSaldo.append(ui.el('div', { class: 'texto-chico texto-suave', style: { marginTop: '4px', opacity: '.85' } },
          '¿Ya tenías plata antes de arrancar? Cargala como saldo inicial.'));
      }

      cardSaldo.append(ui.el('div', { class: 'fila', style: { justifyContent: 'center', marginTop: '10px' } },
        ui.el('button', { class: 'btn btn-sec btn-chico', onClick: () => modalSaldoInicial(pintar) },
          ui.icon('editar'), 'Saldo inicial')));
      caja.append(cardSaldo);

      // ---- Accesos rápidos: cargar plata desde la primera pantalla ----
      const estiloRapido = { padding: '15px 8px', fontSize: '14.5px' };
      caja.append(ui.el('div', { class: 'grilla grilla-2 mb' },
        ui.el('button', {
          class: 'btn btn-peligro', style: estiloRapido,
          onClick: () => modalTransaccion(null, pintar, 'gasto'),
        }, ui.icon('mas'), 'Registrar gasto'),
        ui.el('button', {
          class: 'btn btn-ok', style: estiloRapido,
          onClick: () => modalTransaccion(null, pintar, 'ingreso'),
        }, ui.icon('mas'), 'Registrar ingreso')));

      caja.append(selectorMes(pintar));

      // Métricas del mes
      const trans = await transDelMes(mesSel);
      const ingresos = sumaMontos(trans.filter(esIngreso));
      const gastos = sumaMontos(trans.filter(t => !esIngreso(t)));
      const balance = ingresos - gastos;
      caja.append(ui.el('div', { class: 'grilla grilla-3 mb' },
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor texto-ok' }, fmt(ingresos)), ui.el('div', { class: 'etiqueta' }, 'Ingresos')),
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor texto-peligro' }, fmt(gastos)), ui.el('div', { class: 'etiqueta' }, 'Gastos')),
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor ' + (balance >= 0 ? 'texto-ok' : 'texto-peligro') }, fmt(balance)),
          ui.el('div', { class: 'etiqueta' }, 'Balance'))));

      // Comparación con el mes anterior
      const transPrev = await transDelMes(mesSuma(mesSel, -1));
      const gastosPrev = sumaMontos(transPrev.filter(t => !esIngreso(t)));
      let comparacion;
      if (gastosPrev > 0 && gastos > 0) {
        const pct = Math.round((gastos - gastosPrev) / gastosPrev * 100);
        if (pct === 0) comparacion = ui.el('span', {}, 'Gastaste lo mismo que el mes pasado.');
        else comparacion = ui.el('span', { class: pct > 0 ? 'texto-peligro' : 'texto-ok' },
          `Gastaste ${Math.abs(pct)}% ${pct > 0 ? 'más' : 'menos'} que el mes pasado.`);
      } else if (gastosPrev === 0 && gastos > 0) {
        comparacion = ui.el('span', { class: 'texto-suave' }, 'El mes pasado no registraste gastos, así que no hay con qué comparar.');
      } else {
        comparacion = ui.el('span', { class: 'texto-suave' }, 'Sin gastos registrados este mes.');
      }
      caja.append(ui.el('div', { class: 'tarjeta' }, ui.el('p', { class: 'sin-margen' }, comparacion)));

      // Torta de gastos por categoría
      const gastosMes = trans.filter(t => !esIngreso(t));
      const cardTorta = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Gastos por categoría'));
      if (!gastosMes.length) {
        cardTorta.append(ui.estadoVacio('Sin gastos este mes. ¡El bolsillo agradece!', 'dinero'));
      } else {
        const porCat = {};
        for (const t of gastosMes) porCat[t.categoria || '_'] = (porCat[t.categoria || '_'] || 0) + montoDe(t);
        const datos = Object.entries(porCat)
          .map(([id, valor]) => { const c = catDe(cats, id); return { etiqueta: c.nombre, valor, color: c.color }; })
          .sort((a, b) => b.valor - a.valor);
        const canvas = ui.el('canvas', { class: 'grafico' });
        cardTorta.append(canvas);
        ui.alPintar(() => ui.graficoTorta(canvas, datos));
      }
      caja.append(cardTorta);

      // Línea de gasto acumulado por día
      const cardLinea = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Gasto acumulado del mes'));
      const esMesActual = mesSel === mesActual();
      const ultimoDia = esMesActual ? new Date().getDate() : diasEnMes(mesSel);
      const porDia = {};
      for (const t of gastosMes) {
        const d = Number(String(t.fecha || '').slice(8, 10));
        if (d) porDia[d] = (porDia[d] || 0) + montoDe(t);
      }
      const datosLinea = [];
      let acum = 0;
      for (let d = 1; d <= ultimoDia; d++) { acum += porDia[d] || 0; datosLinea.push({ etiqueta: String(d), valor: Math.round(acum) }); }
      if (datosLinea.length < 2 || acum === 0) {
        cardLinea.append(ui.el('p', { class: 'texto-suave texto-chico sin-margen' }, 'Todavía no hay suficientes datos para dibujar la curva.'));
      } else {
        const canvas = ui.el('canvas', { class: 'grafico' });
        cardLinea.append(canvas);
        ui.alPintar(() => ui.graficoLinea(canvas, datosLinea, { color: '#f7734f' }));
      }
      caja.append(cardLinea);
    }
    await pintar();
  }

  // ---------- Modal de saldo inicial ----------
  async function modalSaldoInicial(alGuardar) {
    const moneda = await db.getSetting('moneda', '$');
    const { monto: actual, configurado } = await leerSaldoInicial();

    const inp = ui.campo({
      tipo: 'text', etiqueta: `Saldo inicial (${moneda})`,
      valor: configurado ? String(actual) : '',
      inputmode: 'decimal', placeholder: '0', autocomplete: 'off',
    });

    const cuerpo = ui.el('div', {},
      ui.el('p', { class: 'texto-chico texto-suave' },
        'La plata que ya tenías antes de empezar a usar la app. Se suma al saldo total, pero no cuenta como movimiento de ningún mes.'),
      inp,
      ui.el('p', { class: 'texto-chico texto-suave sin-margen' },
        'Podés escribir 1500, 1500.50 o 1.500,50. Si arrancás debiendo, poné un número negativo.'));

    let cerrarModal = null;
    const guardar = async () => {
      const txt = inp.input.value.trim();
      const monto = txt === '' ? 0 : parseMonto(txt);
      if (isNaN(monto)) {
        ui.toast('No entendí ese monto. Escribilo así: 1500 o 1.500,50', 'error', 4000);
        inp.input.focus(); inp.input.select();
        return;
      }
      await db.setSetting('economia.saldoInicial', monto);
      ui.toast('Saldo inicial guardado');
      if (cerrarModal) cerrarModal();
      if (alGuardar) alGuardar();
    };
    inp.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });

    const modalRef = ui.modal({
      titulo: 'Saldo inicial',
      cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
      ],
    });
    cerrarModal = modalRef.cerrar;
    ui.alPintar(() => { inp.input.focus(); inp.input.select(); });
  }

  // ==================================================================
  // TAB 2: MOVIMIENTOS
  // ==================================================================
  async function renderMovimientos(tc) {
    const moneda = await db.getSetting('moneda', '$');
    const fmt = n => ui.fmtMonto(n, moneda);

    const caja = ui.el('div');
    tc.append(caja);
    tc.append(ui.el('button', { class: 'btn-flotante', 'aria-label': 'Agregar movimiento', onClick: () => modalTransaccion(null, pintar) }, ui.icon('mas')));

    async function pintar() {
      caja.innerHTML = '';
      caja.append(selectorMes(pintar));
      const cats = await db.getAll('categoriasEco');
      const trans = (await transDelMes(mesSel)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

      if (!trans.length) {
        caja.append(ui.estadoVacio('No hay movimientos este mes. Tocá el + para agregar el primero.', 'dinero'));
      } else {
        // Agrupar por fecha
        const grupos = {};
        for (const t of trans) (grupos[t.fecha] = grupos[t.fecha] || []).push(t);
        for (const fecha of Object.keys(grupos)) {
          const dia = grupos[fecha];
          const netoDia = dia.reduce((s, t) => s + (esIngreso(t) ? montoDe(t) : -montoDe(t)), 0);
          const card = ui.el('div', { class: 'tarjeta' },
            ui.el('div', { class: 'fila espaciado mb' },
              ui.el('strong', {}, ui.fmtFecha(fecha)),
              ui.el('span', { class: 'texto-chico ' + (netoDia >= 0 ? 'texto-ok' : 'texto-peligro') },
                (netoDia >= 0 ? '+' : '−') + fmt(Math.abs(netoDia)))));
          for (const t of dia) {
            const c = catDe(cats, t.categoria);
            const titulo = t.descripcion || c.nombre;
            const sub = [titulo !== c.nombre ? c.nombre : null, t.metodo || null].filter(Boolean).join(' · ');
            card.append(ui.el('div', { class: 'lista-item' },
              ui.el('span', { class: 'punto-color', style: { background: c.color } }),
              ui.el('div', { class: 'principal' },
                ui.el('div', { class: 'titulo' }, titulo),
                sub ? ui.el('div', { class: 'sub' }, sub) : null),
              ui.el('span', {
                class: esIngreso(t) ? 'texto-ok' : 'texto-peligro',
                style: { fontWeight: '700', whiteSpace: 'nowrap' },
              }, (esIngreso(t) ? '+' : '−') + fmt(montoDe(t))),
              ui.el('div', { class: 'acciones' },
                ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalTransaccion(t, pintar) }, ui.icon('editar')),
                ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
                  const ok = await ui.confirmar(`¿Eliminar este movimiento de ${fmt(montoDe(t))}?`);
                  if (ok !== true) return;
                  await db.del('transacciones', t.id);
                  ui.toast('Movimiento eliminado');
                  pintar();
                } }, ui.icon('basura')))));
          }
          caja.append(card);
        }
      }

      // Totales del mes al pie
      const ingresos = sumaMontos(trans.filter(esIngreso));
      const gastos = sumaMontos(trans.filter(t => !esIngreso(t)));
      caja.append(ui.el('div', { class: 'grilla grilla-3 mt' },
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor texto-ok' }, fmt(ingresos)), ui.el('div', { class: 'etiqueta' }, 'Ingresos del mes')),
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor texto-peligro' }, fmt(gastos)), ui.el('div', { class: 'etiqueta' }, 'Gastos del mes')),
        ui.el('div', { class: 'tarjeta metrica sin-margen' },
          ui.el('div', { class: 'valor ' + (ingresos - gastos >= 0 ? 'texto-ok' : 'texto-peligro') }, fmt(ingresos - gastos)),
          ui.el('div', { class: 'etiqueta' }, 'Balance del mes'))));
    }
    await pintar();
  }

  // ---------- Modal de transacción (nueva o edición) ----------
  // t: registro a editar (o null). alGuardar: callback para refrescar la vista.
  // tipoInicial: 'gasto' | 'ingreso' preseleccionado al crear uno nuevo.
  async function modalTransaccion(t, alGuardar, tipoInicial = 'gasto') {
    let cats = await db.getAll('categoriasEco');
    const moneda = await db.getSetting('moneda', '$');
    const metodos = await db.getSetting('economia.metodos', METODOS_DEFAULT);
    let tipo = t ? tipoDe(t) : (tipoInicial === 'ingreso' ? 'ingreso' : 'gasto');
    let metodoSel = t ? (t.metodo || '') : (metodos[0] || '');

    // Chips de tipo
    const filaTipo = ui.el('div', { class: 'fila mb' });
    const pintarTipo = () => {
      filaTipo.innerHTML = '';
      for (const [v, texto] of [['gasto', 'Gasto'], ['ingreso', 'Ingreso']]) {
        filaTipo.append(ui.el('button', {
          class: 'btn btn-chico ' + (tipo === v ? (v === 'gasto' ? 'btn-peligro' : 'btn-ok') : 'btn-sec'),
          onClick: () => { tipo = v; pintarTipo(); pintarCats(); },
        }, texto));
      }
    };
    pintarTipo();

    // Monto: input de texto libre (nada de type=number, que en el celu bloquea la coma).
    const inMonto = ui.campo({
      tipo: 'text', etiqueta: `Monto (${moneda})`,
      valor: t ? montoDe(t) : '',
      inputmode: 'decimal', placeholder: '0', autocomplete: 'off',
    });
    const ayudaMonto = ui.el('p', { class: 'texto-chico texto-suave', style: { marginTop: '-6px' } },
      'Podés escribir 1500, 1500.50 o 1.500,50.');

    const selCat = ui.campo({ tipo: 'select', etiqueta: 'Categoría', valor: t ? t.categoria : '', opciones: [] });
    const avisoCat = ui.el('p', { class: 'texto-chico texto-suave', style: { marginTop: '-6px' } });
    const pintarCats = () => {
      const deTipo = cats.filter(c => tipoDe(c) === tipo);
      selCat.input.innerHTML = '';
      for (const c of deTipo) selCat.input.append(ui.el('option', { value: c.id }, c.nombre));
      const valorPrevio = t && tipoDe(t) === tipo ? t.categoria : null;
      if (valorPrevio && deTipo.some(c => c.id === valorPrevio)) selCat.input.value = valorPrevio;
      // Si no hay categorías de este tipo, ofrecer crear una sin salir del modal.
      avisoCat.innerHTML = '';
      avisoCat.classList.toggle('oculto', deTipo.length > 0);
      if (!deTipo.length) {
        avisoCat.append(
          `No tenés categorías de ${tipo}. `,
          ui.el('button', {
            class: 'btn btn-chico', style: { marginLeft: '4px' },
            onClick: () => modalCategorias(async () => { cats = await db.getAll('categoriasEco'); pintarCats(); }),
          }, ui.icon('mas'), 'Crear una'));
      }
    };
    pintarCats();

    const inFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha', valor: t ? t.fecha : ui.hoyISO() });
    const inDesc = ui.campo({ tipo: 'text', etiqueta: 'Descripción (opcional)', valor: t ? (t.descripcion || '') : '', placeholder: 'Ej: birra con los pibes' });

    // Chips de método de pago
    const filaMetodo = ui.el('div', { class: 'fila mb' });
    const pintarMetodos = async () => {
      const lista = await db.getSetting('economia.metodos', METODOS_DEFAULT);
      filaMetodo.innerHTML = '';
      for (const m of lista) {
        filaMetodo.append(ui.el('button', {
          class: 'chip ' + (metodoSel === m ? 'chip-acento' : ''),
          style: { cursor: 'pointer' },
          onClick: () => { metodoSel = (metodoSel === m) ? '' : m; pintarMetodos(); },
        }, m));
      }
      filaMetodo.append(ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar métodos', onClick: () => modalMetodos(pintarMetodos) }, ui.icon('editar')));
      if (!lista.length) filaMetodo.append(ui.el('span', { class: 'texto-suave texto-chico' }, 'Sin métodos: agregá uno con el lápiz.'));
    };
    await pintarMetodos();

    const cuerpo = ui.el('div', {},
      ui.el('div', { class: 'campo-etiqueta mb', style: { marginBottom: '5px' } }, 'Tipo'), filaTipo,
      inMonto,
      ayudaMonto,
      selCat,
      avisoCat,
      ui.el('div', { class: 'fila-campos' }, inFecha, inDesc),
      ui.el('div', { class: 'campo-etiqueta', style: { marginBottom: '5px' } }, 'Método de pago'), filaMetodo);

    let cerrarModal = null;
    const guardar = async () => {
      const txt = inMonto.input.value.trim();
      if (!txt) {
        ui.toast('Escribí cuánta plata fue (ej: 1500)', 'error');
        inMonto.input.focus();
        return;
      }
      const monto = parseMonto(txt);
      if (isNaN(monto)) {
        ui.toast(`No entendí "${txt}". Escribí solo números, así: 1500 o 1.500,50`, 'error', 4500);
        inMonto.input.focus(); inMonto.input.select();
        return;
      }
      if (monto <= 0) {
        ui.toast('El monto tiene que ser mayor a cero', 'error');
        inMonto.input.focus(); inMonto.input.select();
        return;
      }
      if (!selCat.input.value) {
        ui.toast(`Primero creá una categoría de ${tipo} con el botón de acá abajo`, 'error', 4000);
        return;
      }
      const fecha = inFecha.input.value || ui.hoyISO();
      const reg = {
        ...(t || {}),
        fecha,
        tipo,
        monto,
        categoria: selCat.input.value,
        descripcion: inDesc.input.value.trim(),
        metodo: metodoSel,
      };
      await db.put('transacciones', reg);
      // Que el movimiento recién cargado se vea sí o sí: si es de otro mes, saltamos ahí.
      mesSel = fecha.slice(0, 7);
      ui.toast(t ? 'Movimiento actualizado' : (tipo === 'ingreso' ? 'Ingreso agregado' : 'Gasto agregado'));
      if (cerrarModal) cerrarModal();
      if (alGuardar) alGuardar();
    };

    inMonto.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
    inDesc.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });

    const modalRef = ui.modal({
      titulo: t ? 'Editar movimiento' : (tipo === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo gasto'),
      cuerpo,
      botones: [
        { texto: 'Cancelar', clase: 'btn-sec' },
        { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
      ],
    });
    cerrarModal = modalRef.cerrar;
    // Foco directo al monto: es lo primero que uno quiere escribir.
    ui.alPintar(() => { inMonto.input.focus(); inMonto.input.select(); });
  }

  // ---------- Modal de gestión de métodos de pago ----------
  async function modalMetodos(alCambiar) {
    const lista = ui.el('div');
    const inNuevo = ui.el('input', { class: 'input', type: 'text', placeholder: 'Nuevo método (ej: MODO)' });

    const agregar = async () => {
      const nombre = inNuevo.value.trim();
      if (!nombre) return ui.toast('Escribí un nombre para el método', 'error');
      const metodos = await db.getSetting('economia.metodos', METODOS_DEFAULT);
      if (metodos.some(m => m.toLowerCase() === nombre.toLowerCase())) return ui.toast('Ese método ya existe', 'error');
      await db.setSetting('economia.metodos', [...metodos, nombre]);
      inNuevo.value = '';
      pintar();
      if (alCambiar) alCambiar();
    };
    inNuevo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });

    const pintar = async () => {
      const metodos = await db.getSetting('economia.metodos', METODOS_DEFAULT);
      lista.innerHTML = '';
      if (!metodos.length) lista.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'No hay métodos cargados.'));
      for (const m of metodos) {
        lista.append(ui.el('div', { class: 'lista-item' },
          ui.el('div', { class: 'principal' }, ui.el('div', { class: 'titulo' }, m)),
          ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
            const ok = await ui.confirmar(`¿Eliminar el método "${m}"? Los movimientos ya cargados lo conservan.`);
            if (ok !== true) return;
            const actuales = await db.getSetting('economia.metodos', METODOS_DEFAULT);
            await db.setSetting('economia.metodos', actuales.filter(x => x !== m));
            ui.toast('Método eliminado');
            pintar();
            if (alCambiar) alCambiar();
          } }, ui.icon('basura'))));
      }
    };
    await pintar();

    ui.modal({
      titulo: 'Métodos de pago',
      cuerpo: ui.el('div', {},
        lista,
        ui.el('div', { class: 'fila mt' },
          inNuevo,
          ui.el('button', { class: 'btn btn-primario', onClick: () => agregar() }, ui.icon('mas'), 'Agregar'))),
      botones: [{ texto: 'Listo', clase: 'btn-primario' }],
    });
  }

  // ==================================================================
  // TAB 3: PRESUPUESTOS
  // ==================================================================
  async function renderPresupuestos(tc) {
    const moneda = await db.getSetting('moneda', '$');
    const fmt = n => ui.fmtMonto(n, moneda);
    const caja = ui.el('div');
    tc.append(caja);

    async function pintar() {
      caja.innerHTML = '';
      const ym = mesActual();
      const hoyDia = new Date().getDate();
      const totalDias = diasEnMes(ym);
      const cats = (await db.getAll('categoriasEco')).filter(c => tipoDe(c) === 'gasto');
      const gastosMes = (await transDelMes(ym)).filter(t => !esIngreso(t));
      const gastadoPor = {};
      for (const t of gastosMes) gastadoPor[t.categoria] = (gastadoPor[t.categoria] || 0) + montoDe(t);

      caja.append(ui.el('p', { class: 'texto-suave texto-chico' },
        `Presupuestos de ${mesNombre(ym)} · día ${hoyDia} de ${totalDias}`));

      const conPres = cats.filter(c => Number(c.presupuestoMensual) > 0);
      const sinPres = cats.filter(c => !(Number(c.presupuestoMensual) > 0));

      if (!conPres.length) {
        caja.append(ui.estadoVacio('Ninguna categoría tiene presupuesto todavía. Asignale uno acá abajo.', 'objetivo'));
      }

      for (const c of conPres) {
        const pres = Number(c.presupuestoMensual);
        const gastado = gastadoPor[c.id] || 0;
        const pct = gastado / pres * 100;
        let chip = null;
        if (pct > 100) chip = ui.el('span', { class: 'chip chip-peligro' }, 'Te pasaste');
        else if (pct > 80) chip = ui.el('span', { class: 'chip chip-alerta' }, `Ojo: ${Math.round(pct)}%`);
        else chip = ui.el('span', { class: 'chip chip-ok' }, 'Vas bien');

        const card = ui.el('div', { class: 'tarjeta' },
          ui.el('div', { class: 'tarjeta-titulo' },
            ui.el('h3', {}, ui.el('span', { class: 'punto-color', style: { background: c.color } }), c.nombre),
            chip),
          ui.barraProgreso(gastado, pres, {
            color: pct > 100 ? 'var(--peligro)' : c.color,
            texto: `${fmt(gastado)} de ${fmt(pres)}`,
          }));

        // Proyección a fin de mes al ritmo actual
        if (gastado > 0) {
          const proyeccion = gastado / hoyDia * totalDias;
          card.append(ui.el('p', {
            class: 'texto-chico mt sin-margen ' + (proyeccion > pres ? 'texto-alerta' : 'texto-suave'),
          }, `Al ritmo actual llegarías a ${fmt(Math.round(proyeccion))} a fin de mes.`));
        }

        // Edición inline del presupuesto
        const inPres = ui.el('input', {
          class: 'input', type: 'text', value: pres,
          style: { maxWidth: '130px' }, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Presupuesto mensual',
        });
        const guardarPres = async () => {
          const nuevo = inPres.value.trim() === '' ? 0 : parseMonto(inPres.value);
          if (isNaN(nuevo) || nuevo < 0) return ui.toast('Monto de presupuesto inválido. Escribí algo como 20000', 'error', 3500);
          c.presupuestoMensual = nuevo || null; // 0 = quitar presupuesto
          await db.put('categoriasEco', c);
          ui.toast(nuevo ? 'Presupuesto actualizado' : 'Presupuesto quitado');
          pintar();
        };
        inPres.addEventListener('change', guardarPres);
        inPres.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inPres.blur(); } });
        card.append(ui.el('div', { class: 'fila mt' },
          ui.el('span', { class: 'texto-chico texto-suave' }, 'Presupuesto mensual:'), inPres,
          ui.el('span', { class: 'texto-chico texto-suave' }, '(0 para quitarlo)')));
        caja.append(card);
      }

      if (sinPres.length) {
        const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Sin presupuesto'));
        for (const c of sinPres) {
          card.append(ui.el('div', { class: 'lista-item' },
            ui.el('span', { class: 'punto-color', style: { background: c.color } }),
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, c.nombre),
              ui.el('div', { class: 'sub' }, `Gastado este mes: ${fmt(gastadoPor[c.id] || 0)}`)),
            ui.el('button', { class: 'btn btn-chico', onClick: () => {
              const inp = ui.campo({ tipo: 'text', etiqueta: `Presupuesto mensual para ${c.nombre}`, valor: '', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
              let cerrarPres = null;
              const guardar = async () => {
                const monto = parseMonto(inp.input.value);
                if (isNaN(monto) || monto <= 0) {
                  ui.toast('Poné un monto mayor a cero (ej: 20000)', 'error');
                  inp.input.focus(); inp.input.select();
                  return;
                }
                c.presupuestoMensual = monto;
                await db.put('categoriasEco', c);
                ui.toast('Presupuesto asignado');
                if (cerrarPres) cerrarPres();
                pintar();
              };
              inp.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
              const mp = ui.modal({
                titulo: 'Asignar presupuesto',
                cuerpo: inp,
                botones: [
                  { texto: 'Cancelar', clase: 'btn-sec' },
                  { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
                ],
              });
              cerrarPres = mp.cerrar;
              ui.alPintar(() => { inp.input.focus(); inp.input.select(); });
            } }, 'Asignar')));
        }
        caja.append(card);
      }

      if (!cats.length) {
        caja.append(ui.estadoVacio('No hay categorías de gasto. Crealas desde el botón Categorías arriba.', 'etiqueta'));
      }
    }
    await pintar();
  }

  // ==================================================================
  // TAB 4: METAS DE AHORRO
  // ==================================================================
  async function renderMetas(tc) {
    const moneda = await db.getSetting('moneda', '$');
    const fmt = n => ui.fmtMonto(n, moneda);
    const caja = ui.el('div');
    tc.append(ui.el('div', { class: 'fila espaciado mb' },
      ui.el('h3', { class: 'sin-margen' }, 'Metas de ahorro'),
      ui.el('button', { class: 'btn btn-primario btn-chico', onClick: () => modalMeta(null) }, ui.icon('mas'), 'Nueva meta')));
    tc.append(caja);

    async function pintar() {
      caja.innerHTML = '';
      const metas = await db.getAll('metasAhorro');
      if (!metas.length) {
        caja.append(ui.estadoVacio('Sin metas todavía. Creá una: unas zapas nuevas, un viaje, lo que quieras.', 'objetivo'));
        return;
      }
      for (const m of metas) {
        const ahorrado = Number(m.ahorrado) || 0;
        const objetivo = Number(m.objetivo) || 1;
        const pct = Math.round(ahorrado / objetivo * 100);
        const falta = Math.max(0, objetivo - ahorrado);
        const cumplida = ahorrado >= objetivo;

        const card = ui.el('div', { class: 'tarjeta' },
          ui.el('div', { class: 'tarjeta-titulo' },
            ui.el('h3', {}, ui.icon('objetivo'), m.nombre),
            ui.el('div', { class: 'fila', style: { gap: '4px' } },
              cumplida ? ui.el('span', { class: 'chip chip-ok' }, ui.icon('check'), 'Meta cumplida') : null,
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalMeta(m) }, ui.icon('editar')),
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
                const ok = await ui.confirmar(`¿Eliminar la meta "${m.nombre}"?`);
                if (ok !== true) return;
                await db.del('metasAhorro', m.id);
                ui.toast('Meta eliminada');
                pintar();
              } }, ui.icon('basura')))),
          ui.barraProgreso(ahorrado, objetivo, {
            color: cumplida ? 'var(--ok)' : null,
            texto: `${pct}% · ${fmt(ahorrado)} de ${fmt(objetivo)}`,
          }));

        // Info de fecha límite y ritmo semanal necesario
        if (!cumplida && m.fechaLimite) {
          const dias = ui.diasHasta(m.fechaLimite);
          let texto;
          if (dias < 0) texto = ui.el('span', { class: 'texto-peligro' }, `La fecha límite (${ui.fmtFecha(m.fechaLimite)}) ya pasó y te faltan ${fmt(falta)}.`);
          else if (dias < 7) texto = ui.el('span', { class: 'texto-alerta' }, `¡Queda menos de una semana! Te faltan ${fmt(falta)} para el ${ui.fmtFecha(m.fechaLimite)}.`);
          else {
            const porSemana = Math.ceil(falta / (dias / 7));
            texto = ui.el('span', { class: 'texto-suave' },
              `Te faltan ${fmt(falta)} · a razón de ${fmt(porSemana)} por semana llegás para el ${ui.fmtFecha(m.fechaLimite)}.`);
          }
          card.append(ui.el('p', { class: 'texto-chico mt sin-margen' }, texto));
        } else if (!cumplida) {
          card.append(ui.el('p', { class: 'texto-chico mt sin-margen texto-suave' }, `Te faltan ${fmt(falta)}.`));
        }
        if (m.notas) card.append(ui.el('p', { class: 'texto-chico texto-suave sin-margen mt' }, m.notas));

        card.append(ui.el('div', { class: 'fila mt' },
          ui.el('button', { class: 'btn btn-ok btn-chico', onClick: () => modalAporte(m, +1) }, '+ Aporte'),
          ui.el('button', { class: 'btn btn-sec btn-chico', onClick: () => modalAporte(m, -1) }, '− Retiro')));
        caja.append(card);
      }
    }

    // Modal de aporte (+1) o retiro (-1)
    function modalAporte(m, signo) {
      const inp = ui.campo({ tipo: 'text', etiqueta: `Monto (${moneda})`, valor: '', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
      let cerrarModal = null;
      const guardar = async () => {
        const monto = parseMonto(inp.input.value);
        if (isNaN(monto) || monto <= 0) {
          ui.toast('Poné un monto mayor a cero (ej: 1500)', 'error');
          inp.input.focus(); inp.input.select();
          return;
        }
        const actual = Number(m.ahorrado) || 0;
        const nuevo = actual + signo * monto;
        if (nuevo < 0) return ui.toast(`No podés retirar más de lo ahorrado (${fmt(actual)})`, 'error', 3500);
        m.ahorrado = nuevo;
        await db.put('metasAhorro', m);
        if (signo > 0 && nuevo >= Number(m.objetivo)) ui.toast('¡Meta cumplida! Felicitaciones 🎉', 'ok', 4000);
        else ui.toast(signo > 0 ? 'Aporte registrado' : 'Retiro registrado');
        if (cerrarModal) cerrarModal();
        pintar();
      };
      inp.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
      const mo = ui.modal({
        titulo: signo > 0 ? `Aporte a "${m.nombre}"` : `Retiro de "${m.nombre}"`,
        cuerpo: ui.el('div', {},
          inp,
          ui.el('p', { class: 'texto-suave texto-chico' }, `Ahorrado actual: ${fmt(Number(m.ahorrado) || 0)}`)),
        botones: [
          { texto: 'Cancelar', clase: 'btn-sec' },
          { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
        ],
      });
      cerrarModal = mo.cerrar;
      ui.alPintar(() => { inp.input.focus(); inp.input.select(); });
    }

    // Modal de alta/edición de meta
    function modalMeta(m) {
      const inNombre = ui.campo({ tipo: 'text', etiqueta: 'Nombre', valor: m ? m.nombre : '', placeholder: 'Ej: Zapatillas nuevas' });
      const inObjetivo = ui.campo({ tipo: 'text', etiqueta: `Objetivo (${moneda})`, valor: m ? m.objetivo : '', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
      const inAhorrado = ui.campo({ tipo: 'text', etiqueta: `Ya ahorrado (${moneda})`, valor: m ? m.ahorrado : '0', inputmode: 'decimal', autocomplete: 'off' });
      const inFecha = ui.campo({ tipo: 'date', etiqueta: 'Fecha límite (opcional)', valor: m ? (m.fechaLimite || '') : '' });
      const inNotas = ui.campo({ tipo: 'textarea', etiqueta: 'Notas (opcional)', valor: m ? (m.notas || '') : '' });
      let cerrarModal = null;
      const guardar = async () => {
        const nombre = inNombre.input.value.trim();
        const objetivo = parseMonto(inObjetivo.input.value);
        const ahorrado = parseMonto(inAhorrado.input.value || '0');
        if (!nombre) return ui.toast('La meta necesita un nombre', 'error');
        if (isNaN(objetivo) || objetivo <= 0) return ui.toast('El objetivo tiene que ser mayor a cero', 'error');
        if (isNaN(ahorrado) || ahorrado < 0) return ui.toast('Lo ahorrado no puede ser negativo', 'error');
        await db.put('metasAhorro', {
          ...(m || {}),
          nombre, objetivo, ahorrado,
          fechaLimite: inFecha.input.value || null,
          notas: inNotas.input.value.trim(),
        });
        ui.toast(m ? 'Meta actualizada' : 'Meta creada');
        if (cerrarModal) cerrarModal();
        pintar();
      };
      const mo = ui.modal({
        titulo: m ? 'Editar meta' : 'Nueva meta',
        cuerpo: ui.el('div', {}, inNombre, ui.el('div', { class: 'fila-campos' }, inObjetivo, inAhorrado), inFecha, inNotas),
        botones: [
          { texto: 'Cancelar', clase: 'btn-sec' },
          { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
        ],
      });
      cerrarModal = mo.cerrar;
      ui.alPintar(() => inNombre.input.focus());
    }

    await pintar();
  }

  // ==================================================================
  // Gestión de categorías (modal desde la cabecera)
  // ==================================================================
  async function modalCategorias(alCerrarCambios) {
    const lista = ui.el('div');
    let huboCambios = false;

    const pintar = async () => {
      const moneda = await db.getSetting('moneda', '$');
      const cats = await db.getAll('categoriasEco');
      lista.innerHTML = '';
      for (const tipo of ['gasto', 'ingreso']) {
        const deTipo = cats.filter(c => tipoDe(c) === tipo);
        lista.append(ui.el('h4', { class: 'mt', style: { marginBottom: '4px' } }, tipo === 'gasto' ? 'Gastos' : 'Ingresos'));
        if (!deTipo.length) lista.append(ui.el('p', { class: 'texto-suave texto-chico' }, 'No hay categorías de este tipo.'));
        for (const c of deTipo) {
          lista.append(ui.el('div', { class: 'lista-item' },
            ui.el('span', { class: 'punto-color', style: { background: c.color } }),
            ui.el('div', { class: 'principal' },
              ui.el('div', { class: 'titulo' }, c.nombre),
              tipo === 'gasto' && Number(c.presupuestoMensual) > 0
                ? ui.el('div', { class: 'sub' }, `Presupuesto: ${ui.fmtMonto(Number(c.presupuestoMensual), moneda)}`)
                : null),
            ui.el('div', { class: 'acciones' },
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Editar', onClick: () => modalCategoria(c) }, ui.icon('editar')),
              ui.el('button', { class: 'btn-icono', 'aria-label': 'Eliminar', onClick: async () => {
                const usos = await db.getBy('transacciones', 'categoria', c.id);
                const extra = usos.length ? ` Hay ${usos.length} movimiento(s) que quedarán como "Sin categoría".` : '';
                const ok = await ui.confirmar(`¿Eliminar la categoría "${c.nombre}"?${extra}`);
                if (ok !== true) return;
                await db.del('categoriasEco', c.id);
                huboCambios = true;
                ui.toast('Categoría eliminada');
                pintar();
              } }, ui.icon('basura')))));
        }
      }
    };

    // Alta/edición de una categoría
    const modalCategoria = (c) => {
      const inNombre = ui.campo({ tipo: 'text', etiqueta: 'Nombre', valor: c ? c.nombre : '' });
      const selTipo = ui.campo({ tipo: 'select', etiqueta: 'Tipo', valor: c ? tipoDe(c) : 'gasto', opciones: [
        { v: 'gasto', t: 'Gasto' }, { v: 'ingreso', t: 'Ingreso' }] });
      const inColor = ui.campo({ tipo: 'color', etiqueta: 'Color', valor: c ? c.color : '#4f8ef7' });
      const inPres = ui.campo({ tipo: 'text', etiqueta: 'Presupuesto mensual (opcional, solo gastos)', valor: c && c.presupuestoMensual ? c.presupuestoMensual : '', inputmode: 'decimal', placeholder: 'Sin presupuesto', autocomplete: 'off' });
      const togglePres = () => inPres.classList.toggle('oculto', selTipo.input.value !== 'gasto');
      selTipo.input.addEventListener('change', togglePres);
      togglePres();
      let cerrarModal = null;
      const guardar = async () => {
        const nombre = inNombre.input.value.trim();
        if (!nombre) return ui.toast('La categoría necesita un nombre', 'error');
        const tipo = selTipo.input.value;
        let pres = null;
        if (tipo === 'gasto' && inPres.input.value.trim()) {
          pres = parseMonto(inPres.input.value);
          if (isNaN(pres) || pres <= 0) return ui.toast('Presupuesto inválido: dejalo vacío o poné un monto mayor a cero', 'error', 3500);
        }
        await db.put('categoriasEco', {
          ...(c || {}),
          nombre, tipo,
          color: inColor.input.value,
          presupuestoMensual: pres,
        });
        huboCambios = true;
        ui.toast(c ? 'Categoría actualizada' : 'Categoría creada');
        if (cerrarModal) cerrarModal();
        pintar();
      };
      inNombre.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
      const mo = ui.modal({
        titulo: c ? 'Editar categoría' : 'Nueva categoría',
        cuerpo: ui.el('div', {}, inNombre, ui.el('div', { class: 'fila-campos' }, selTipo, inColor), inPres),
        botones: [
          { texto: 'Cancelar', clase: 'btn-sec' },
          { texto: 'Guardar', clase: 'btn-primario', onClick: () => guardar() },
        ],
      });
      cerrarModal = mo.cerrar;
      ui.alPintar(() => inNombre.input.focus());
    };

    await pintar();
    ui.modal({
      titulo: 'Categorías',
      cuerpo: ui.el('div', {},
        lista,
        ui.el('button', { class: 'btn btn-primario mt', onClick: () => modalCategoria(null) }, ui.icon('mas'), 'Nueva categoría')),
      botones: [{ texto: 'Listo', clase: 'btn-primario' }],
      alCerrar: () => { if (huboCambios && alCerrarCambios) alCerrarCambios(); },
    });
  }

  // ---------- Tabs ----------
  tabsCtl = ui.tabs([
    { id: 'resumen', texto: 'Resumen', render: renderResumen },
    { id: 'movimientos', texto: 'Movimientos', render: renderMovimientos },
    { id: 'presupuestos', texto: 'Presupuestos', render: renderPresupuestos },
    { id: 'metas', texto: 'Metas', render: renderMetas },
  ], cont);
}

export default { id: 'economia', nombre: 'Plata', icono: 'dinero', render };
