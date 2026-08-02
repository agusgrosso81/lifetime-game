// app.js — Shell principal: registro de módulos, router, tema, alarmas y notificaciones.
import { db } from './db.js';
import { ui } from './ui.js';

import dashboard from './modules/dashboard.js';
import estudio from './modules/estudio.js';
import tiempo from './modules/tiempo.js';
import dieta from './modules/dieta.js';
import notas from './modules/notas.js';
import economia from './modules/economia.js';
import ubicacion from './modules/ubicacion.js';
import musica from './modules/musica.js';
import google from './modules/google.js';
import cuenta, { necesitaBienvenida, pantallaBienvenida } from './cuenta.js';
import ajustes from './modules/ajustes.js';
import { sync } from './sync.js';

// Cada módulo: { id, nombre, icono, render(contenedor) }  — render puede ser async.
const MODULOS = [dashboard, estudio, tiempo, dieta, notas, economia, ubicacion, musica, google, cuenta, ajustes];

const nav = document.getElementById('nav');
const contenido = document.getElementById('contenido');
let moduloActivo = null;

function pintarNav() {
  nav.innerHTML = '';
  for (const m of MODULOS) {
    nav.append(ui.el('button', {
      class: 'nav-item' + (moduloActivo === m.id ? ' activa' : ''),
      onClick: () => navegar(m.id),
      'aria-label': m.nombre,
    }, ui.icon(m.icono), ui.el('span', {}, m.nombre)));
  }
}

export async function navegar(id) {
  const m = MODULOS.find(x => x.id === id) || MODULOS[0];
  moduloActivo = m.id;
  if (location.hash !== '#' + m.id) history.replaceState(null, '', '#' + m.id);
  pintarNav();
  contenido.innerHTML = '';
  try {
    await m.render(contenido);
  } catch (e) {
    console.error('Error en módulo', m.id, e);
    contenido.append(ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, 'Ups, algo falló en este módulo'),
      ui.el('p', { class: 'texto-suave texto-chico' }, String(e && e.message || e))));
  }
  window.scrollTo(0, 0);
}
window.navegar = navegar; // para accesos rápidos entre módulos

// ---------- Tema ----------
export async function aplicarTema() {
  const tema = await db.getSetting('tema', 'oscuro');
  document.documentElement.dataset.tema = tema;
  const acento = await db.getSetting('colorAcento', null);
  if (acento) {
    document.documentElement.style.setProperty('--acento', acento);
    const r = parseInt(acento.slice(1, 3), 16), g = parseInt(acento.slice(3, 5), 16), b = parseInt(acento.slice(5, 7), 16);
    document.documentElement.style.setProperty('--acento-suave', `rgba(${r},${g},${b},0.16)`);
  }
}

// ---------- Alarmas ----------
// Revisa cada 20 s las alarmas vencidas mientras la app esté abierta.
// Módulos crean alarmas con db.put('alarmas', {fecha:'YYYY-MM-DDTHH:MM', mensaje, refTipo, refId, repetir})
async function chequearAlarmas() {
  const ahora = new Date();
  const ahoraStr = `${ui.hoyISO(ahora)}T${ui.ahoraHM(ahora)}`;
  const todas = await db.getAll('alarmas');
  for (const a of todas) {
    if (a.disparada || a.fecha > ahoraStr) continue;
    a.disparada = true;
    // Repetición: reprogramar en vez de marcar
    if (a.repetir) {
      const d = new Date(a.fecha);
      if (a.repetir === 'diaria') d.setDate(d.getDate() + 1);
      else if (a.repetir === 'semanal') d.setDate(d.getDate() + 7);
      a.fecha = `${ui.hoyISO(d)}T${ui.ahoraHM(d)}`;
      a.disparada = false;
    }
    await db.put('alarmas', a);
    notificar('⏰ ' + (a.mensaje || 'Alarma'), a.refTipo ? `(${a.refTipo})` : '');
    try { sonarAlarma(); } catch {}
  }
}

export function notificar(titulo, cuerpo = '') {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(titulo, { body: cuerpo, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png' }));
        return;
      }
      new Notification(titulo, { body: cuerpo });
    } catch { /* sin soporte */ }
  }
  ui.toast(titulo + (cuerpo ? ' — ' + cuerpo : ''), 'info', 6000);
}

export async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

function sonarAlarma() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.frequency.value = 880; gain.gain.value = 0.12;
  osc.start();
  let n = 0;
  const int = setInterval(() => {
    n++;
    osc.frequency.value = n % 2 ? 660 : 880;
    if (n > 5) { clearInterval(int); osc.stop(); ctx.close(); }
  }, 220);
}

// ---------- Service worker ----------
async function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    // Si aparece una versión nueva de la app, avisar y recargar al aceptar.
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          ui.modal({
            titulo: 'Hay una versión nueva',
            cuerpo: ui.el('p', {}, 'Se actualizó Lifetime Game. ¿Querés recargar para usar la versión nueva?'),
            botones: [
              { texto: 'Después', clase: 'btn-sec' },
              { texto: 'Recargar', clase: 'btn-primario', onClick: (c) => { nuevo.postMessage('actualizar'); c(); } },
            ],
          });
        }
      });
    });
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return; recargando = true; location.reload();
    });
  } catch (e) { console.warn('SW no registrado:', e.message); }
}

// ---------- Init ----------
(async function init() {
  // Esperar a que la base esté abierta y el usuario cargado: si no, el primer módulo
  // leería con el usuario equivocado y mostraría la pantalla vacía de otra cuenta.
  await db.listo;
  await aplicarTema();
  registrarSW();

  // Primer arranque: elegir entre usar el aparato solo o conectarse a un servidor.
  if (await necesitaBienvenida()) {
    nav.classList.add('oculto');
    await pantallaBienvenida(contenido, async (destino) => {
      nav.classList.remove('oculto');
      contenido.innerHTML = '';
      pintarNav();
      await navegar(destino || 'dashboard');
      sync.iniciar();
    });
    return;
  }

  pintarNav();
  const hash = location.hash.replace('#', '');
  await navegar(hash || 'dashboard');
  sync.iniciar();
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (id && id !== moduloActivo) navegar(id);
  });
  chequearAlarmas();
  setInterval(chequearAlarmas, 20000);
})();
