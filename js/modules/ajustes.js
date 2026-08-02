// ajustes.js — Configuración global: tema, colores, escala de notas, moneda,
// notificaciones, integraciones (client IDs de Spotify/Google) y backup local.
import { db } from '../db.js';
import { ui } from '../ui.js';

async function render(cont) {
  cont.append(ui.el('div', { class: 'cabecera-modulo' }, ui.el('h2', {}, ui.icon('ajustes'), 'Ajustes')));

  // ---------- Apariencia ----------
  const tema = await db.getSetting('tema', 'oscuro');
  const acento = await db.getSetting('colorAcento', '#4f8ef7');
  const cardApariencia = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Apariencia'));
  const selTema = ui.campo({ tipo: 'select', etiqueta: 'Tema', valor: tema, opciones: [
    { v: 'oscuro', t: 'Oscuro' }, { v: 'claro', t: 'Claro' }] });
  selTema.input.addEventListener('change', async () => {
    await db.setSetting('tema', selTema.input.value);
    document.documentElement.dataset.tema = selTema.input.value;
  });
  const colAcento = ui.campo({ tipo: 'color', etiqueta: 'Color de acento', valor: acento });
  colAcento.input.addEventListener('change', async () => {
    await db.setSetting('colorAcento', colAcento.input.value);
    const { aplicarTema } = await import('../app.js');
    aplicarTema();
  });
  cardApariencia.append(selTema, colAcento);

  // ---------- Estudio ----------
  const escala = await db.getSetting('escalaNotas', 10);
  const aprobado = await db.getSetting('notaAprobado', 6);
  const cardEstudio = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Estudio'));
  const inEscala = ui.campo({ tipo: 'number', etiqueta: 'Escala de notas (máximo)', valor: escala, min: 1 });
  const inAprobado = ui.campo({ tipo: 'number', etiqueta: 'Nota mínima para aprobar', valor: aprobado, min: 1, step: '0.5' });
  inEscala.input.addEventListener('change', () => db.setSetting('escalaNotas', Number(inEscala.input.value) || 10));
  inAprobado.input.addEventListener('change', () => db.setSetting('notaAprobado', Number(inAprobado.input.value) || 6));
  cardEstudio.append(inEscala, inAprobado);

  // ---------- General ----------
  const moneda = await db.getSetting('moneda', '$');
  const nombre = await db.getSetting('nombreUsuario', '');
  const cardGeneral = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'General'));
  const inNombre = ui.campo({ tipo: 'text', etiqueta: 'Tu nombre (para el saludo del inicio)', valor: nombre, placeholder: 'Opcional' });
  inNombre.input.addEventListener('change', () => db.setSetting('nombreUsuario', inNombre.input.value.trim()));
  const inMoneda = ui.campo({ tipo: 'text', etiqueta: 'Símbolo de moneda', valor: moneda, placeholder: '$' });
  inMoneda.input.addEventListener('change', () => db.setSetting('moneda', inMoneda.input.value || '$'));
  cardGeneral.append(inNombre, inMoneda);

  // ---------- Notificaciones ----------
  const cardNotif = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Notificaciones y alarmas'));
  const estadoNotif = ui.el('p', { class: 'texto-suave texto-chico' });
  const actualizarEstado = () => {
    if (!('Notification' in window)) estadoNotif.textContent = 'Este navegador no soporta notificaciones.';
    else if (Notification.permission === 'granted') estadoNotif.textContent = '✅ Notificaciones activadas.';
    else if (Notification.permission === 'denied') estadoNotif.textContent = '❌ Bloqueadas. Activalas desde la configuración del sitio en el navegador.';
    else estadoNotif.textContent = 'Todavía no diste permiso.';
  };
  actualizarEstado();
  cardNotif.append(estadoNotif,
    ui.el('button', { class: 'btn btn-primario', onClick: async () => {
      const { pedirPermisoNotificaciones } = await import('../app.js');
      const ok = await pedirPermisoNotificaciones();
      ui.toast(ok ? 'Notificaciones activadas' : 'No se activaron', ok ? 'ok' : 'error');
      actualizarEstado();
    } }, ui.icon('campana'), 'Activar notificaciones'),
    ui.el('p', { class: 'texto-suave texto-chico mt' },
      'Las alarmas suenan mientras la app esté abierta (aunque sea en segundo plano reciente). ' +
      'Para alarmas con la app totalmente cerrada, exportá tus exámenes/alarmas a Google Calendar desde la pestaña Google.'));

  // ---------- Integraciones ----------
  const spotifyId = await db.getSetting('spotifyClientId', '');
  const googleId = await db.getSetting('googleClientId', '');
  const cardInteg = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Integraciones'));
  const inSpotify = ui.campo({ tipo: 'text', etiqueta: 'Spotify Client ID', valor: spotifyId, placeholder: 'Pegalo desde developer.spotify.com' });
  inSpotify.input.addEventListener('change', () => db.setSetting('spotifyClientId', inSpotify.input.value.trim()));
  const inGoogle = ui.campo({ tipo: 'text', etiqueta: 'Google OAuth Client ID', valor: googleId, placeholder: 'Pegalo desde console.cloud.google.com' });
  inGoogle.input.addEventListener('change', () => db.setSetting('googleClientId', inGoogle.input.value.trim()));
  cardInteg.append(inSpotify, inGoogle,
    ui.el('p', { class: 'texto-suave texto-chico' },
      'Las guías paso a paso para crear estas credenciales (gratis) están en las pestañas Música y Google.'));

  // ---------- Datos ----------
  const cardDatos = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Copia de seguridad'));
  cardDatos.append(
    ui.el('div', { class: 'fila' },
      ui.el('button', { class: 'btn', onClick: async () => {
        const data = await db.exportarJSON(false);
        ui.descargarArchivo(`organizador-backup-${ui.hoyISO()}.json`, JSON.stringify(data, null, 1));
        ui.toast('Backup descargado (sin audios/imágenes)');
      } }, ui.icon('descargar'), 'Exportar datos'),
      ui.el('button', { class: 'btn', onClick: () => {
        const inp = ui.el('input', { type: 'file', accept: '.json' });
        inp.addEventListener('change', async () => {
          const f = inp.files[0]; if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            const reemplazar = await ui.confirmar('¿Reemplazar los datos actuales? (Cancelar = combinar con lo existente)', 'Reemplazar');
            await db.importarJSON(data, reemplazar);
            ui.toast('Datos importados. Recargando…');
            setTimeout(() => location.reload(), 900);
          } catch (e) { ui.toast('Archivo inválido: ' + e.message, 'error'); }
        });
        inp.click();
      } }, ui.icon('subir'), 'Importar datos')),
    ui.el('p', { class: 'texto-suave texto-chico mt' },
      'El backup incluye todo menos audios e imágenes (pesan mucho). También podés hacer backup completo a Google Drive desde la pestaña Google.'),
    ui.el('button', { class: 'btn btn-peligro mt', onClick: async () => {
      if (!(await ui.confirmar('Esto borra TODOS los datos de la app en este dispositivo. ¿Seguro?', 'Borrar todo'))) return;
      if (!(await ui.confirmar('Última confirmación: se pierde todo lo no exportado.', 'Sí, borrar'))) return;
      for (const s of db.STORES) await db.clear(s);
      ui.toast('Datos borrados');
      setTimeout(() => location.reload(), 800);
    } }, ui.icon('basura'), 'Borrar todos los datos'));

  cont.append(cardApariencia, cardEstudio, cardGeneral, cardNotif, cardInteg, cardDatos);
}

export default { id: 'ajustes', nombre: 'Ajustes', icono: 'ajustes', render };
