// cuenta.js — Pantalla de bienvenida, cuenta, conexión al servidor y panel de admin.
// Vive en js/ (no en js/modules/) porque app.js lo usa también para la bienvenida.
import { db } from './db.js';
import { ui } from './ui.js';
import { sync } from './sync.js';

// ---------- Estado visual de la sincronización ----------
const PINTA = {
  'sin-configurar': { icono: 'gota', texto: 'Solo este dispositivo', clase: '' },
  'ok':             { icono: 'check', texto: 'Al día', clase: 'chip-ok' },
  'sincronizando':  { icono: 'sincronizar', texto: 'Sincronizando…', clase: 'chip-acento' },
  'sin-conexion':   { icono: 'wifi_no', texto: 'Sin conexión', clase: 'chip-alerta' },
  'error':          { icono: 'info', texto: 'Error al sincronizar', clase: 'chip-peligro' },
  'sesion-vencida': { icono: 'candado', texto: 'Sesión vencida', clase: 'chip-peligro' },
};

export function chipEstadoSync() {
  const chip = ui.el('span', { class: 'chip' });
  const pintar = (e) => {
    const p = PINTA[e.estado] || PINTA['sin-configurar'];
    chip.className = 'chip ' + p.clase;
    chip.innerHTML = '';
    chip.append(ui.icon(p.icono), ui.el('span', {}, p.texto + (e.pendientes ? ` (${e.pendientes})` : '')));
    chip.title = e.mensaje || '';
  };
  sync.alCambiar(pintar);
  return chip;
}

function haceCuanto(ts) {
  if (!ts) return 'nunca';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} días`;
}

// ---------- Bienvenida ----------
export async function necesitaBienvenida() {
  const elegido = await db._getSettingCrudo('servidor.modoElegido', null);
  return !elegido;
}

export async function pantallaBienvenida(cont, alTerminar) {
  const caja = ui.el('div', { class: 'tarjeta', style: { maxWidth: '520px', margin: '10vh auto 0' } },
    ui.el('h2', { class: 'texto-centrado' }, 'Lifetime Game'),
    ui.el('p', { class: 'texto-suave texto-centrado' },
      'El juego que dura toda la vida. Antes de arrancar, elegí cómo querés guardar tus datos. ' +
      'Esto se puede cambiar después.'),
    ui.el('button', {
      class: 'btn btn-primario mt', style: { width: '100%', padding: '14px' },
      onClick: async () => { await db._setSettingCrudo('servidor.modoElegido', 'local'); alTerminar(); },
    }, ui.icon('gota'), 'Usar solo en este dispositivo'),
    ui.el('p', { class: 'texto-chico texto-suave' },
      'Todo se guarda acá y no sale nunca de tu aparato. Andá tranquilo: podés conectarte a un servidor más adelante sin perder nada.'),
    ui.el('button', {
      class: 'btn mt', style: { width: '100%', padding: '14px' },
      onClick: async () => { await db._setSettingCrudo('servidor.modoElegido', 'servidor'); alTerminar('cuenta'); },
    }, ui.icon('nube'), 'Conectarme a un servidor'),
    ui.el('p', { class: 'texto-chico texto-suave' },
      'Tus datos quedan en todos tus dispositivos y varias personas pueden usar el mismo servidor, cada una con lo suyo. ' +
      'Necesitás la dirección del servidor y, si no sos el primero, un código de invitación.'));
  cont.append(caja);
}

// ---------- Formulario de conexión ----------
function seccionConectar(repintar) {
  const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('nube'), 'Conectarme a un servidor'));

  const inDir = ui.campo({
    tipo: 'text', etiqueta: 'Dirección del servidor', valor: '',
    placeholder: 'http://100.x.x.x:8770', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false',
  });
  const ayuda = ui.el('p', { class: 'texto-chico texto-suave' },
    'Te la da quien administra el servidor. Con Tailscale suele empezar con 100. y termina en :8770.');
  const resultado = ui.el('div', { class: 'mb' });

  let servidorOk = null;
  const formularios = ui.el('div', { class: 'oculto' });

  const btnProbar = ui.el('button', { class: 'btn btn-primario', onClick: async () => {
    btnProbar.disabled = true;
    resultado.innerHTML = '';
    resultado.append(ui.el('p', { class: 'texto-chico texto-suave' }, 'Probando…'));
    const r = await sync.probar(inDir.input.value);
    resultado.innerHTML = '';
    if (!r.ok) {
      resultado.append(ui.el('p', { class: 'texto-chico texto-peligro' }, r.mensaje));
      formularios.classList.add('oculto');
    } else {
      servidorOk = r;
      resultado.append(ui.el('p', { class: 'texto-chico texto-ok' },
        `Conectado. Servidor versión ${r.version}. ` +
        (r.requiereInvitacion ? 'Para crear una cuenta vas a necesitar un código de invitación.'
                              : 'Sos el primero: tu cuenta va a quedar como administradora.')));
      formularios.classList.remove('oculto');
    }
    btnProbar.disabled = false;
  } }, ui.icon('buscar'), 'Probar conexión');

  // --- Entrar ---
  const inUsuario = ui.campo({ tipo: 'text', etiqueta: 'Usuario', autocapitalize: 'off', spellcheck: 'false' });
  const inPass = ui.campo({ tipo: 'password', etiqueta: 'Contraseña' });
  const errEntrar = ui.el('p', { class: 'texto-chico texto-peligro' });
  const btnEntrar = ui.el('button', { class: 'btn btn-primario', onClick: async () => {
    errEntrar.textContent = '';
    btnEntrar.disabled = true;
    const r = await sync.login({ direccion: servidorOk.raiz, usuario: inUsuario.input.value.trim().toLowerCase(), contrasena: inPass.input.value });
    btnEntrar.disabled = false;
    if (!r.ok) { errEntrar.textContent = r.mensaje; return; }
    await despuesDeEntrar(r.usuario, repintar);
  } }, 'Entrar');

  // --- Crear cuenta ---
  const rUsuario = ui.campo({ tipo: 'text', etiqueta: 'Usuario', placeholder: 'sin espacios ni acentos', autocapitalize: 'off', spellcheck: 'false' });
  const rNombre = ui.campo({ tipo: 'text', etiqueta: 'Tu nombre', placeholder: 'Para el saludo del inicio' });
  const rPass = ui.campo({ tipo: 'password', etiqueta: 'Contraseña', placeholder: 'mínimo 8 caracteres' });
  const rPass2 = ui.campo({ tipo: 'password', etiqueta: 'Repetir contraseña' });
  const rCodigo = ui.campo({ tipo: 'text', etiqueta: 'Código de invitación', placeholder: 'ABCD-1234', autocapitalize: 'characters' });
  const errCrear = ui.el('p', { class: 'texto-chico texto-peligro' });
  const btnCrear = ui.el('button', { class: 'btn btn-primario', onClick: async () => {
    errCrear.textContent = '';
    const usuario = rUsuario.input.value.trim().toLowerCase();
    if (usuario.length < 3) { errCrear.textContent = 'El usuario necesita al menos 3 caracteres.'; return; }
    if (!/^[a-z0-9._-]+$/.test(usuario)) { errCrear.textContent = 'El usuario solo puede tener letras, números, punto, guion y guion bajo.'; return; }
    if (rPass.input.value.length < 8) { errCrear.textContent = 'La contraseña necesita al menos 8 caracteres.'; return; }
    if (rPass.input.value !== rPass2.input.value) { errCrear.textContent = 'Las dos contraseñas no coinciden.'; return; }
    btnCrear.disabled = true;
    const r = await sync.registrar({
      direccion: servidorOk.raiz, usuario, nombre: rNombre.input.value.trim() || usuario,
      contrasena: rPass.input.value, codigo: rCodigo.input.value.trim().toUpperCase(),
    });
    btnCrear.disabled = false;
    if (!r.ok) { errCrear.textContent = r.mensaje; return; }
    await despuesDeEntrar(r.usuario, repintar);
  } }, 'Crear cuenta');

  const contTabs = ui.el('div');
  ui.tabs([
    { id: 'entrar', texto: 'Entrar', render: (c) => c.append(inUsuario, inPass, errEntrar, btnEntrar) },
    { id: 'crear', texto: 'Crear cuenta', render: (c) => c.append(rUsuario, rNombre, rPass, rPass2, rCodigo, errCrear, btnCrear) },
  ], contTabs);
  formularios.append(contTabs);

  card.append(inDir, ayuda, btnProbar, ui.el('div', { class: 'mb' }), resultado, formularios);
  return card;
}

// Al entrar por primera vez desde un aparato que venía usándose sin cuenta, hay datos
// locales que se pueden perder de vista. Se le pregunta qué hacer antes de seguir.
async function despuesDeEntrar(usuario, repintar) {
  const hayLocales = await db.hayDatosLocales();
  if (hayLocales) {
    await new Promise(resolve => {
      ui.modal({
        titulo: '¿Qué hacemos con lo que ya tenías?',
        cuerpo: ui.el('div', {},
          ui.el('p', {}, `Este dispositivo tiene datos guardados sin cuenta. Ahora entraste como ${usuario.usuario}.`),
          ui.el('p', { class: 'texto-chico texto-suave' },
            'Si los llevás a tu cuenta, pasan a ser tuyos y se suben al servidor. ' +
            'Si los dejás aparte, quedan guardados en este aparato y los volvés a ver si cerrás sesión.')),
        botones: [
          { texto: 'Dejarlos aparte', clase: 'btn-sec', onClick: (c) => { c(); resolve(); } },
          { texto: 'Llevarlos a mi cuenta', clase: 'btn-primario', onClick: async (c) => {
            const n = await db.adoptarLocales(usuario.id);
            ui.toast(`Se pasaron ${n} registros a tu cuenta`);
            c(); resolve();
          } },
        ],
        alCerrar: () => resolve(),
      });
    });
  }
  await db._setSettingCrudo('servidor.modoElegido', 'servidor');
  ui.toast(`¡Hola ${usuario.nombre || usuario.usuario}!`);
  sync.sincronizar();
  repintar();
}

// ---------- Estado de la cuenta ----------
async function seccionEstado(repintar) {
  const u = db.usuarioActual();
  const card = ui.el('div', { class: 'tarjeta' });

  if (!u) {
    card.append(
      ui.el('h3', {}, ui.icon('gota'), 'Solo este dispositivo'),
      ui.el('p', { class: 'texto-suave' },
        'Tus datos se guardan acá y no salen del aparato. Funciona perfecto así, ' +
        'pero no vas a tenerlos en otros dispositivos ni podés compartir el servidor con nadie.'),
      ui.el('p', { class: 'texto-chico texto-suave' },
        'Si te conectás a un servidor, vas a poder llevarte todo lo que ya cargaste.'));
    return card;
  }

  const e = sync.estado();
  const pendientes = await db.pendientesDeSync().catch(() => 0);
  const dir = await db._getSettingCrudo('servidor.url', '');
  const p = PINTA[e.estado] || PINTA.ok;

  // Ojo: card.append() es la API del DOM y convierte null en el texto "null".
  // Por eso se arma con ui.el, que sí descarta los hijos vacíos.
  card.append(ui.el('div', {},
    ui.el('div', { class: 'fila espaciado' },
      ui.el('h3', { class: 'sin-margen' }, ui.icon('usuario'), u.nombre || u.usuario),
      chipEstadoSync()),
    ui.el('p', { class: 'texto-chico texto-suave sin-margen' },
      `Usuario: ${u.usuario}${u.rol === 'admin' ? ' · administrador' : ''}`),
    ui.el('p', { class: 'texto-chico texto-suave' }, `Servidor: ${dir}`),
    e.mensaje ? ui.el('p', { class: 'texto-chico texto-peligro' }, e.mensaje) : null,
    ui.el('div', { class: 'grilla grilla-2 mb' },
      ui.el('div', { class: 'metrica' },
        ui.el('div', { class: 'valor' }, pendientes),
        ui.el('div', { class: 'etiqueta' }, pendientes === 1 ? 'cambio sin subir' : 'cambios sin subir')),
      ui.el('div', { class: 'metrica' },
        ui.el('div', { class: 'valor', style: { fontSize: '1rem', paddingTop: '8px' } }, haceCuanto(e.ultima)),
        ui.el('div', { class: 'etiqueta' }, 'última sincronización'))),
    ui.el('div', { class: 'fila' },
      ui.el('button', { class: 'btn btn-primario', onClick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        const r = await sync.sincronizar({ forzado: true });
        b.disabled = false;
        ui.toast(r.ok ? `Listo: ${r.subidos} subidos, ${r.bajados} bajados` : r.mensaje, r.ok ? 'ok' : 'error', 4500);
        repintar();
      } }, ui.icon('sincronizar'), 'Sincronizar ahora'),
      ui.el('button', { class: 'btn btn-sec', onClick: async () => {
        if (!(await ui.confirmar('Vas a cerrar sesión en este dispositivo. Los datos que ya bajaste se quedan acá, pero no vas a poder sincronizar hasta volver a entrar.', 'Cerrar sesión'))) return;
        await sync.logout();
        ui.toast('Sesión cerrada');
        repintar();
      } }, 'Cerrar sesión'))));
  return card;
}

// ---------- Cambiar contraseña ----------
function seccionContrasena() {
  const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('candado'), 'Cambiar contraseña'));
  const a = ui.campo({ tipo: 'password', etiqueta: 'Contraseña actual' });
  const n1 = ui.campo({ tipo: 'password', etiqueta: 'Nueva contraseña', placeholder: 'mínimo 8 caracteres' });
  const n2 = ui.campo({ tipo: 'password', etiqueta: 'Repetir la nueva' });
  const err = ui.el('p', { class: 'texto-chico texto-peligro' });
  card.append(a, n1, n2, err,
    ui.el('p', { class: 'texto-chico texto-suave' }, 'Al cambiarla se cierran las sesiones abiertas en tus otros dispositivos.'),
    ui.el('button', { class: 'btn btn-primario', onClick: async (ev) => {
      err.textContent = '';
      if (n1.input.value.length < 8) { err.textContent = 'La nueva contraseña necesita al menos 8 caracteres.'; return; }
      if (n1.input.value !== n2.input.value) { err.textContent = 'Las dos contraseñas nuevas no coinciden.'; return; }
      ev.currentTarget.disabled = true;
      const r = await sync.cambiarContrasena(a.input.value, n1.input.value);
      ev.currentTarget.disabled = false;
      if (!r.ok) { err.textContent = r.mensaje; return; }
      a.input.value = n1.input.value = n2.input.value = '';
      ui.toast('Contraseña cambiada');
    } }, 'Cambiar contraseña'));
  return card;
}

// ---------- Panel de admin ----------
async function seccionAdmin(repintar) {
  const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, ui.icon('objetivo'), 'Administración del servidor'));
  const cont = ui.el('div');
  card.append(cont);

  const pintar = async () => {
    cont.innerHTML = '';
    let invitaciones = [], usuarios = [];
    try {
      invitaciones = (await sync.admin('/invitaciones')).invitaciones || [];
      usuarios = (await sync.admin('/usuarios')).usuarios || [];
    } catch (e) {
      cont.append(ui.el('p', { class: 'texto-chico texto-peligro' }, 'No se pudo cargar: ' + e.message));
      return;
    }

    cont.append(
      ui.el('button', { class: 'btn btn-primario mb', onClick: async () => {
        try {
          const r = await sync.admin('/invitaciones', { metodo: 'POST', cuerpo: {} });
          ui.modal({
            titulo: 'Código de invitación',
            cuerpo: ui.el('div', { class: 'texto-centrado' },
              ui.el('p', { class: 'texto-suave' }, 'Pasale este código a quien quieras sumar. Sirve una sola vez y vence en 30 días.'),
              ui.el('div', { style: { fontSize: '1.7rem', fontWeight: '700', letterSpacing: '2px', margin: '14px 0' } }, r.codigo),
              ui.el('button', { class: 'btn', onClick: () => {
                navigator.clipboard.writeText(r.codigo).then(() => ui.toast('Código copiado')).catch(() => ui.toast('No se pudo copiar', 'error'));
              } }, ui.icon('copiar'), 'Copiar')),
            botones: [{ texto: 'Listo', clase: 'btn-primario' }],
          });
          pintar();
        } catch (e) { ui.toast(e.message, 'error'); }
      } }, ui.icon('mas'), 'Generar invitación'));

    const sinUsar = invitaciones.filter(i => !i.usado_por);
    cont.append(ui.el('h4', {}, `Invitaciones (${sinUsar.length} sin usar)`));
    if (!invitaciones.length) cont.append(ui.el('p', { class: 'texto-chico texto-suave' }, 'Todavía no generaste ninguna.'));
    for (const i of invitaciones.slice(0, 12)) {
      const vencida = i.expira && i.expira < Date.now() && !i.usado_por;
      cont.append(ui.el('div', { class: 'lista-item' },
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo', style: { fontFamily: 'monospace' } }, i.codigo),
          ui.el('div', { class: 'sub' }, i.usado_por ? `usada por ${i.usado_por_nombre || '—'}` : (vencida ? 'vencida' : 'sin usar'))),
        ui.el('div', { class: 'acciones' },
          i.usado_por ? ui.el('span', { class: 'chip chip-ok' }, 'usada') :
          ui.el('button', { class: 'btn-icono', title: 'Borrar', 'aria-label': 'Borrar', onClick: async () => {
            if (!(await ui.confirmar('¿Borrar esta invitación sin usar?', 'Borrar'))) return;
            await sync.admin('/invitaciones/' + encodeURIComponent(i.codigo), { metodo: 'DELETE' });
            pintar();
          } }, ui.icon('basura')))));
    }

    cont.append(ui.el('h4', { class: 'mt' }, `Usuarios (${usuarios.length})`));
    const yo = db.usuarioActual();
    for (const u of usuarios) {
      const soyYo = yo && u.id === yo.id;
      cont.append(ui.el('div', { class: 'lista-item' },
        ui.icon('usuario'),
        ui.el('div', { class: 'principal' },
          ui.el('div', { class: 'titulo' }, (u.nombre || u.usuario) + (soyYo ? ' (vos)' : '')),
          ui.el('div', { class: 'sub' },
            `${u.usuario} · ${u.rol}${u.activo ? '' : ' · desactivado'} · ${u.resumen ? u.resumen.registros + ' registros' : ''}`)),
        ui.el('div', { class: 'acciones' },
          soyYo ? null : ui.el('button', {
            class: 'btn btn-chico ' + (u.activo ? 'btn-sec' : 'btn-ok'),
            onClick: async () => {
              const accion = u.activo ? 'desactivar' : 'activar';
              if (!(await ui.confirmar(`¿Seguro que querés ${accion} a ${u.usuario}?` + (u.activo ? ' No va a poder entrar más, pero sus datos quedan guardados.' : ''), accion === 'desactivar' ? 'Desactivar' : 'Activar'))) return;
              await sync.admin('/usuarios/' + encodeURIComponent(u.id), { metodo: 'PATCH', cuerpo: { activo: u.activo ? 0 : 1 } });
              pintar();
            },
          }, u.activo ? 'Desactivar' : 'Activar'))));
    }
  };
  await pintar();
  return card;
}

// ---------- Módulo ----------
async function render(cont) {
  const repintar = () => { cont.innerHTML = ''; render(cont); };
  cont.append(ui.el('div', { class: 'cabecera-modulo' }, ui.el('h2', {}, ui.icon('usuario'), 'Cuenta')));

  const u = db.usuarioActual();
  cont.append(await seccionEstado(repintar));

  if (!u) {
    cont.append(seccionConectar(repintar));
  } else {
    if (u.rol === 'admin') cont.append(await seccionAdmin(repintar));
    cont.append(seccionContrasena());
  }
}

export default { id: 'cuenta', nombre: 'Cuenta', icono: 'usuario', render };
