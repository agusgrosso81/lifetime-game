// musica.js — Integración con Spotify: qué suena ahora, historial propio,
// estadísticas offline y descubrimiento de temas de tus artistas.
// Auth: Authorization Code + PKCE (sin client secret). Tokens en musicaCache.
import { db } from '../db.js';
import { ui } from '../ui.js';

const API = 'https://api.spotify.com/v1';
const URL_AUTH = 'https://accounts.spotify.com/authorize';
const URL_TOKEN = 'https://accounts.spotify.com/api/token';
const SCOPES = 'user-read-recently-played user-top-read user-read-currently-playing';

// Spotify compara la dirección carácter por carácter, así que tiene que salir SIEMPRE
// igual. Se le saca el 'index.html' final: según cómo se haya llegado a la app, el
// navegador puede mostrar la carpeta o el archivo, y para Spotify serían dos direcciones
// distintas (una registrada y la otra no).
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/i, '');

// Al volver del login de Spotify la URL no trae hash, así que la app abre el
// dashboard. Si detectamos el ?code con nuestro state, llevamos al usuario acá
// para terminar el canje (window.navegar existe apenas app.js termina de cargar).
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('code') && (q.get('state') || '').startsWith('musica') && !location.hash.includes('musica')) {
    const ir = () => { if (window.navegar) window.navegar('musica'); else setTimeout(ir, 120); };
    setTimeout(ir, 80);
  }
})();

// ---------- Utilidades ----------

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function copiarTexto(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    ui.toast('Copiado al portapapeles');
  } catch {
    // Fallback para contextos sin clipboard API
    const ta = ui.el('textarea', { value: txt, style: { position: 'fixed', opacity: '0' } });
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); ui.toast('Copiado al portapapeles'); }
    catch { ui.toast('No se pudo copiar automáticamente. Copialo a mano: ' + txt, 'error', 6000); }
    ta.remove();
  }
}

const cortar = (s, n) => (s && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');

function fmtMs(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// inicio/fin de un trayecto → milisegundos (tolera ISO completo, 'HH:MM' + fecha, o timestamp)
function msTrayecto(t, campo) {
  const v = t[campo];
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes('T')) { const d = new Date(s); return isNaN(d) ? null : d.getTime(); }
  if (/^\d{1,2}:\d{2}/.test(s) && t.fecha) {
    const [h, m] = s.split(':').map(Number);
    const base = ui.desdeISO(t.fecha);
    base.setHours(h, m, 0, 0);
    return base.getTime();
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.getTime();
}

// Fila de lista con foto (o placeholder), título, subtítulo y acciones
function itemLista({ num, imagen, titulo, sub, href, acciones }) {
  const foto = imagen
    ? ui.el('img', { src: imagen, alt: '', loading: 'lazy', style: { width: '42px', height: '42px', borderRadius: '8px', objectFit: 'cover', flexShrink: '0' } })
    : ui.el('div', { style: { width: '42px', height: '42px', borderRadius: '8px', background: 'var(--fondo-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' } }, ui.icon('musica'));
  const tit = href
    ? ui.el('a', { href, target: '_blank', rel: 'noopener' }, titulo)
    : titulo;
  return ui.el('div', { class: 'lista-item' },
    (num !== null && num !== undefined)
      ? ui.el('span', { class: 'texto-suave texto-chico', style: { width: '18px', textAlign: 'right', flexShrink: '0', fontVariantNumeric: 'tabular-nums' } }, num)
      : null,
    foto,
    ui.el('div', { class: 'principal' },
      ui.el('div', { class: 'titulo' }, tit),
      sub ? ui.el('div', { class: 'sub' }, sub) : null),
    acciones ? ui.el('div', { class: 'acciones' }, acciones) : null);
}

// ---------- Auth PKCE ----------

async function iniciarLogin(clientId) {
  if (!window.isSecureContext || !crypto.subtle) {
    ui.toast('Para conectar Spotify la app tiene que abrirse por HTTPS o por 127.0.0.1.', 'error', 5500);
    return;
  }
  if (location.hostname === 'localhost') {
    ui.toast('Spotify no acepta "localhost". Abrí la app en http://127.0.0.1:' + (location.port || 80) + ' y probá de nuevo.', 'error', 7000);
    return;
  }
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = 'musica-' + b64url(crypto.getRandomValues(new Uint8Array(8)));
    await db.put('musicaCache', { clave: 'pkce', valor: { verifier, state } });
    const p = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
      state,
    });
    location.href = URL_AUTH + '?' + p.toString();
  } catch (e) {
    ui.toast('No se pudo iniciar el login: ' + (e && e.message || e), 'error', 5000);
  }
}

async function canjearCodigo(code, state) {
  const clientId = ((await db.getSetting('spotifyClientId', '')) || '').trim();
  const pkce = await db.get('musicaCache', 'pkce');
  if (!clientId || !pkce || !pkce.valor || pkce.valor.state !== state) return false;
  let r;
  try {
    r = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: clientId,
        code_verifier: pkce.valor.verifier,
      }),
    });
  } catch { return false; }
  if (!r.ok) return false;
  let d;
  try { d = await r.json(); } catch { return false; }
  if (!d.access_token) return false;
  await db.put('musicaCache', {
    clave: 'tokens',
    valor: {
      access_token: d.access_token,
      refresh_token: d.refresh_token || '',
      expira: Date.now() + (d.expires_in || 3600) * 1000,
    },
  });
  await db.del('musicaCache', 'pkce');
  return true;
}

// Devuelve un access_token vigente (refresca si venció) o null.
async function tokenValido() {
  const reg = await db.get('musicaCache', 'tokens');
  if (!reg || !reg.valor || !reg.valor.access_token) return null;
  const t = reg.valor;
  if (Date.now() < (t.expira || 0) - 60000) return t.access_token;
  const clientId = ((await db.getSetting('spotifyClientId', '')) || '').trim();
  if (!clientId || !t.refresh_token) return null;
  try {
    const r = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: clientId,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.access_token) return null;
    const nuevo = {
      access_token: d.access_token,
      refresh_token: d.refresh_token || t.refresh_token,
      expira: Date.now() + (d.expires_in || 3600) * 1000,
    };
    await db.put('musicaCache', { clave: 'tokens', valor: nuevo });
    return nuevo.access_token;
  } catch { return null; }
}

// GET a la API de Spotify. Devuelve el JSON, o null (204, error o sin sesión).
async function spGet(path, reintentar = true) {
  const token = await tokenValido();
  if (!token) {
    ui.toast('La sesión de Spotify venció. Tocá "Conectar con Spotify" de nuevo.', 'error', 4500);
    return null;
  }
  let r;
  try {
    r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  } catch {
    ui.toast('Sin conexión: no pude hablar con Spotify. Revisá tu internet.', 'error');
    return null;
  }
  if (r.status === 204) return null; // nada sonando
  if (r.status === 401) {
    if (reintentar) {
      // Forzamos refresh marcando el token como vencido y reintentamos una vez
      const reg = await db.get('musicaCache', 'tokens');
      if (reg && reg.valor) { reg.valor.expira = 0; await db.put('musicaCache', reg); }
      return spGet(path, false);
    }
    ui.toast('Spotify pidió iniciar sesión de nuevo. Reconectá desde este módulo.', 'error', 4500);
    return null;
  }
  if (r.status === 403) {
    ui.toast('Spotify rechazó el pedido (403). Si tu app está "en desarrollo", agregá tu mail en User Management del dashboard de Spotify.', 'error', 6000);
    return null;
  }
  if (r.status === 429) {
    ui.toast('Hicimos muchas solicitudes seguidas a Spotify. Esperá un minuto y probá de nuevo.', 'error', 5000);
    return null;
  }
  if (!r.ok) {
    ui.toast('Spotify respondió un error (' + r.status + '). Probá más tarde.', 'error');
    return null;
  }
  try { return await r.json(); } catch { return null; }
}

// ---------- Sincronización de historial ----------

async function sincronizarHistorial() {
  const data = await spGet('/me/player/recently-played?limit=50');
  if (!data || !Array.isArray(data.items)) return null;
  const existentes = new Set((await db.getAll('musicaRegistro')).map(r => r.id));
  let trayectos = [];
  try { trayectos = await db.getAll('trayectos'); } catch { trayectos = []; }
  const nuevos = [];
  for (const it of data.items) {
    if (!it || !it.track || !it.played_at) continue;
    if (existentes.has(it.played_at)) continue; // dedup por playedAt exacto
    const t = it.track;
    const imgs = (t.album && t.album.images) || [];
    const reg = {
      id: it.played_at, // id = playedAt: dedup natural
      trackId: t.id || '',
      nombre: t.name || '(sin nombre)',
      artista: (t.artists || []).map(a => a.name).join(', '),
      album: (t.album && t.album.name) || '',
      imagen: imgs.length ? imgs[imgs.length - 1].url : '',
      durMs: t.duration_ms || 0,
      playedAt: it.played_at,
    };
    // ¿Sonó durante algún trayecto registrado?
    const ms = new Date(it.played_at).getTime();
    const tray = trayectos.find(tr => {
      const i = msTrayecto(tr, 'inicio'), f = msTrayecto(tr, 'fin');
      return i !== null && f !== null && ms >= i && ms <= f;
    });
    if (tray) reg.trayectoId = tray.id;
    nuevos.push(reg);
  }
  if (nuevos.length) await db.putMany('musicaRegistro', nuevos);
  return nuevos.length;
}

// ---------- Refresco de "Ahora" ----------

let intervaloAhora = null;
function pararRefresco() {
  if (intervaloAhora) { clearInterval(intervaloAhora); intervaloAhora = null; }
}

// ---------- Pantallas sin sesión ----------

function tarjetaGuia() {
  const uri = redirectUri();
  // Reglas de Spotify: exige HTTPS, salvo direcciones de loopback POR IP.
  // 'localhost' está explícitamente prohibido; hay que usar 127.0.0.1 o [::1].
  const esLoopbackIP = ['127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  const esLocalhost = location.hostname === 'localhost';
  const uriValida = location.protocol === 'https:' || esLoopbackIP;
  // Misma app y mismo puerto, pero servida por IP de loopback en vez de 'localhost'.
  const uriArreglada = uri.replace('//localhost', '//127.0.0.1');
  const paso = (...c) => ui.el('li', { style: { marginBottom: '9px' } }, ...c);

  const cajaUri = ui.el('div', { class: 'fila', style: { margin: '8px 0 2px' } },
    ui.el('code', { style: { background: 'var(--fondo-3)', border: '1px solid var(--borde)', borderRadius: '8px', padding: '7px 10px', fontSize: '.84rem', wordBreak: 'break-all', flex: '1', minWidth: '120px' } }, uri),
    ui.el('button', { class: 'btn btn-chico', onClick: () => copiarTexto(uri) }, ui.icon('copiar'), 'Copiar'));

  const card = ui.el('div', { class: 'tarjeta' },
    ui.el('h3', {}, ui.icon('spotify'), 'Cómo conectar tu Spotify'),
    ui.el('p', { class: 'texto-suave' }, 'Se hace una sola vez, es gratis y sirve la cuenta gratuita de Spotify.'),
    ui.el('ol', { style: { paddingLeft: '20px', margin: '0 0 10px' } },
      paso('Entrá a ', ui.el('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com/dashboard'), ' e iniciá sesión con tu cuenta de Spotify.'),
      paso('Tocá ', ui.el('strong', {}, '"Create app"'), '. En App name y Description poné lo que quieras (ej: "Lifetime Game").'),
      paso('En ', ui.el('strong', {}, '"Redirect URIs"'), ' pegá EXACTAMENTE esta dirección y tocá "Add":', cajaUri),
      paso('En "Which API/SDKs are you planning to use?" marcá ', ui.el('strong', {}, 'Web API'), ', aceptá los términos y tocá "Save".'),
      paso('Abrí la app que creaste, entrá a "Settings" y copiá el ', ui.el('strong', {}, 'Client ID'), '.'),
      paso('Pegalo en los Ajustes de esta app, en el campo "Spotify Client ID".')),
    uriValida
      ? ui.el('p', { class: 'texto-chico texto-ok' }, 'Esta dirección es válida para Spotify. ✔')
      : esLocalhost
        ? ui.el('div', { class: 'texto-chico texto-alerta' },
            ui.el('p', {}, 'Spotify NO acepta direcciones con "localhost": las rechaza al guardarlas. ' +
              'Pero sí acepta la misma app abierta por su IP de loopback.'),
            ui.el('p', {}, 'Cerrá esta pestaña y abrí la app en esta otra dirección, que es idéntica pero con 127.0.0.1:'),
            ui.el('div', { class: 'fila', style: { margin: '6px 0' } },
              ui.el('code', { style: { background: 'var(--fondo-3)', border: '1px solid var(--borde)', borderRadius: '8px', padding: '7px 10px', fontSize: '.84rem', wordBreak: 'break-all', flex: '1', minWidth: '120px' } }, uriArreglada),
              ui.el('button', { class: 'btn btn-chico', onClick: () => copiarTexto(uriArreglada) }, ui.icon('copiar'), 'Copiar'),
              ui.el('a', { class: 'btn btn-chico btn-primario', href: uriArreglada }, 'Abrir')),
            ui.el('p', {}, 'Después registrá ESA dirección en Spotify. En el celular no hace falta nada de esto: ' +
              'con la app publicada por HTTPS (GitHub Pages) anda directo.'))
        : ui.el('p', { class: 'texto-chico texto-alerta' },
            'Ojo: Spotify solo acepta http:// en direcciones de loopback por IP (127.0.0.1). ' +
            'Estás usando http desde otra dirección (por ejemplo la IP de tu red), así que el login NO va a funcionar. ' +
            'Para usar esto en el celu, serví la app por HTTPS: lo más fácil es subirla a GitHub Pages.'),
    ui.el('p', { class: 'texto-suave texto-chico' },
      'Permisos que se piden: historial reciente, tus tops y lo que está sonando. Nada más: no podemos tocar tu cuenta ni tus playlists.'));
  return card;
}

function pintarGuia(cont) {
  cont.append(
    tarjetaGuia(),
    ui.el('div', { class: 'tarjeta' },
      ui.el('p', { class: 'texto-suave' }, 'Cuando tengas el Client ID, pegalo en Ajustes y volvé a esta pestaña.'),
      ui.el('button', { class: 'btn btn-primario', onClick: () => window.navegar('ajustes') },
        ui.icon('ajustes'), 'Ir a Ajustes')));
}

function pintarConectar(cont, clientId) {
  let guiaVisible = false;
  const zonaGuia = ui.el('div');
  const uri = redirectUri();

  // Spotify solo acepta direcciones cargadas de antemano, y cada dispositivo abre la app
  // en una dirección distinta (la PC en 127.0.0.1, el celular en la de GitHub Pages).
  // Mostrarla acá evita el error "redirect_uri: Not matching information", que aparece
  // en una página en blanco de Spotify y no explica nada.
  const cajaUri = ui.el('div', { class: 'fila', style: { margin: '8px 0' } },
    ui.el('code', {
      style: {
        background: 'var(--fondo-3)', border: '1px solid var(--borde)', borderRadius: '8px',
        padding: '7px 10px', fontSize: '.82rem', wordBreak: 'break-all', flex: '1', minWidth: '120px',
      },
    }, uri),
    ui.el('button', { class: 'btn btn-chico', onClick: () => copiarTexto(uri) }, ui.icon('copiar'), 'Copiar'));

  cont.append(
    ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, ui.icon('spotify'), 'Conectar con Spotify'),
      ui.el('p', { class: 'texto-suave' },
        'El Client ID ya está configurado. Falta autorizar tu cuenta: te mando a Spotify, aceptás y volvés acá.'),
      ui.el('div', { class: 'tarjeta', style: { background: 'var(--fondo-3)' } },
        ui.el('p', { class: 'texto-chico sin-margen' },
          ui.el('strong', {}, 'Antes de tocar conectar: '),
          'esta es la dirección de ', ui.el('strong', {}, 'este dispositivo'),
          '. Tiene que estar cargada en tu app de Spotify, en "Redirect URIs":'),
        cajaUri,
        ui.el('p', { class: 'texto-chico texto-suave sin-margen' },
          'Cada dirección va por separado: la de la computadora no sirve para el celular. ' +
          'En la misma app de Spotify podés tener las dos cargadas.'),
        ui.el('a', {
          class: 'btn btn-chico mt', href: 'https://developer.spotify.com/dashboard',
          target: '_blank', rel: 'noopener',
        }, 'Abrir el panel de Spotify')),
      ui.el('div', { class: 'fila mt' },
        ui.el('button', { class: 'btn btn-primario', onClick: () => iniciarLogin(clientId) },
          ui.icon('spotify'), 'Conectar con Spotify'),
        ui.el('button', { class: 'btn btn-sec', onClick: () => {
          guiaVisible = !guiaVisible;
          zonaGuia.innerHTML = '';
          if (guiaVisible) zonaGuia.append(tarjetaGuia());
        } }, ui.icon('info'), 'Ver la guía')),
      ui.el('details', { class: 'mt' },
        ui.el('summary', { class: 'texto-chico texto-suave', style: { cursor: 'pointer' } },
          'Me apareció una página en blanco que dice "redirect_uri: Not matching information"'),
        ui.el('p', { class: 'texto-chico texto-suave' },
          'Ese error significa que la dirección de arriba no está cargada en Spotify, o que no ' +
          'quedó escrita idéntica. Copiala con el botón, pegala en "Redirect URIs" de tu app en ' +
          'el panel de Spotify, tocá "Add" y después "Save". Fijate que no le falte ni le sobre ' +
          'la barra del final. Esperá un minuto y volvé a probar.'))),
    zonaGuia);
}

// ---------- Pestaña AHORA ----------

async function tabAhora(c) {
  pararRefresco();
  const cardAhora = ui.el('div', { class: 'tarjeta' }, ui.el('p', { class: 'texto-suave' }, 'Consultando qué suena…'));
  const msgSync = ui.el('p', { class: 'texto-suave texto-chico' }, 'Sincronizando historial…');
  const listaUltimas = ui.el('div');
  let sincronizando = false;

  const cardSync = ui.el('div', { class: 'tarjeta' },
    ui.el('div', { class: 'tarjeta-titulo' },
      ui.el('h3', {}, ui.icon('descargar'), 'Historial de escucha'),
      ui.el('button', { class: 'btn btn-primario btn-chico', onClick: () => sync(true) }, 'Sincronizar historial')),
    ui.el('p', { class: 'texto-suave texto-chico' },
      'Spotify solo entrega las últimas 50 reproducciones, así que conviene sincronizar seguido para no perder nada. Acá se acumulan para tus stats.'),
    msgSync, listaUltimas);
  c.append(cardAhora, cardSync);

  const pintarAhora = async () => {
    const d = await spGet('/me/player/currently-playing');
    if (!c.isConnected) { pararRefresco(); return; }
    cardAhora.innerHTML = '';
    if (!d || !d.item) {
      cardAhora.append(ui.estadoVacio('No está sonando nada en Spotify ahora mismo.', 'musica'));
      return;
    }
    const t = d.item;
    const imgs = (t.album && t.album.images) || [];
    const img = imgs.length ? imgs[0].url : '';
    const prog = d.progress_ms || 0, dur = t.duration_ms || 0;
    cardAhora.append(
      ui.el('div', { class: 'fila espaciado mb' },
        ui.el('span', { class: 'chip ' + (d.is_playing ? 'chip-ok' : 'chip-alerta') },
          ui.icon(d.is_playing ? 'play' : 'pausa'), d.is_playing ? 'Sonando ahora' : 'En pausa')),
      ui.el('div', { class: 'fila', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
        img
          ? ui.el('img', { src: img, alt: 'Tapa del álbum', style: { width: '92px', height: '92px', borderRadius: '10px', objectFit: 'cover', flexShrink: '0' } })
          : ui.el('div', { style: { width: '92px', height: '92px', borderRadius: '10px', background: 'var(--fondo-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' } }, ui.icon('musica', 'grande')),
        ui.el('div', { style: { minWidth: '0', flex: '1' } },
          ui.el('div', { style: { fontWeight: '700', fontSize: '1.05rem' } }, t.name || '(sin nombre)'),
          ui.el('div', { class: 'texto-suave' }, (t.artists || []).map(a => a.name).join(', ')),
          t.album && t.album.name ? ui.el('div', { class: 'texto-suave texto-chico' }, t.album.name) : null)),
      ui.el('div', { class: 'mt' },
        ui.barraProgreso(prog, dur || 1, { texto: fmtMs(prog) + ' / ' + fmtMs(dur) })));
  };

  const pintarUltimas = async () => {
    const regs = (await db.getAll('musicaRegistro')).sort((a, b) => a.playedAt < b.playedAt ? 1 : -1).slice(0, 5);
    if (!c.isConnected) return;
    listaUltimas.innerHTML = '';
    if (!regs.length) return;
    listaUltimas.append(ui.el('p', { class: 'texto-chico texto-suave mt', style: { marginBottom: '0' } }, 'Últimas sincronizadas:'));
    for (const r of regs) {
      const d = new Date(r.playedAt);
      listaUltimas.append(itemLista({
        imagen: r.imagen,
        titulo: r.nombre,
        sub: r.artista + ' · ' + ui.fmtFecha(ui.hoyISO(d)) + ' ' + ui.ahoraHM(d),
        acciones: ui.el('button', { class: 'btn-icono', 'aria-label': 'Borrar', onClick: async () => {
          if (!(await ui.confirmar('¿Borrar esta reproducción del registro?'))) return;
          await db.del('musicaRegistro', r.id);
          ui.toast('Reproducción borrada');
          pintarUltimas();
        } }, ui.icon('basura')),
      }));
    }
  };

  const sync = async (manual) => {
    if (sincronizando) return;
    sincronizando = true;
    msgSync.textContent = 'Sincronizando historial…';
    const n = await sincronizarHistorial();
    sincronizando = false;
    if (!c.isConnected) return;
    if (n === null) {
      msgSync.textContent = 'No se pudo sincronizar ahora. Probá de nuevo en un rato.';
    } else {
      const total = await db.count('musicaRegistro');
      msgSync.textContent = (n
        ? `Se sumaron ${n} tema${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}.`
        : 'Sin novedades desde la última vez.') + ` Total registrado: ${total}.`;
      if (manual) ui.toast(n ? `+${n} tema${n === 1 ? '' : 's'} al historial` : 'Historial al día');
    }
    pintarUltimas();
  };

  await pintarAhora();
  sync(false); // auto-sync al entrar
  // Refresco cada 30 s mientras esta pestaña siga en pantalla
  intervaloAhora = setInterval(() => {
    if (!c.isConnected) { pararRefresco(); return; }
    pintarAhora();
  }, 30000);
}

// ---------- Pestaña TOPS ----------

async function tabTops(c) {
  pararRefresco();
  const rango = await db.getSetting('musica.rangoTops', 'short_term');
  if (!c.isConnected) return;
  const sel = ui.campo({ tipo: 'select', etiqueta: 'Período', valor: rango, opciones: [
    { v: 'short_term', t: 'Últimas 4 semanas' },
    { v: 'medium_term', t: 'Últimos 6 meses' },
    { v: 'long_term', t: 'Desde siempre' }] });
  const zona = ui.el('div');
  c.append(sel, zona);

  const pintar = async () => {
    zona.innerHTML = '';
    zona.append(ui.el('p', { class: 'texto-suave' }, 'Cargando tus tops…'));
    const r = sel.input.value;
    const [arts, tracks] = await Promise.all([
      spGet('/me/top/artists?time_range=' + r + '&limit=10'),
      spGet('/me/top/tracks?time_range=' + r + '&limit=10'),
    ]);
    if (!zona.isConnected) return;
    zona.innerHTML = '';
    if (!arts && !tracks) {
      zona.append(ui.estadoVacio('No pude traer tus tops. Revisá la conexión y probá de nuevo.', 'grafico'));
      return;
    }
    if (arts && arts.items && arts.items.length) {
      const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Top 10 artistas'));
      arts.items.forEach((a, i) => {
        const imgs = a.images || [];
        card.append(itemLista({
          num: i + 1,
          imagen: imgs.length ? imgs[imgs.length - 1].url : '',
          titulo: a.name,
          sub: (a.genres || []).slice(0, 2).join(', ') || 'Sin géneros listados',
        }));
      });
      zona.append(card);
    }
    if (tracks && tracks.items && tracks.items.length) {
      const card = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Top 10 canciones'));
      tracks.items.forEach((t, i) => {
        const imgs = (t.album && t.album.images) || [];
        card.append(itemLista({
          num: i + 1,
          imagen: imgs.length ? imgs[imgs.length - 1].url : '',
          titulo: t.name,
          sub: (t.artists || []).map(x => x.name).join(', '),
        }));
      });
      zona.append(card);
    }
    if ((!arts || !arts.items || !arts.items.length) && (!tracks || !tracks.items || !tracks.items.length)) {
      zona.append(ui.estadoVacio('Spotify todavía no tiene tops para mostrar en este período. Escuchá un poco más y volvé.', 'musica'));
    }
  };

  sel.input.addEventListener('change', async () => {
    await db.setSetting('musica.rangoTops', sel.input.value);
    pintar();
  });
  pintar();
}

// ---------- Pestaña MIS STATS ----------

async function tabStats(c) {
  pararRefresco();
  const regs = await db.getAll('musicaRegistro');
  if (!c.isConnected) return;
  if (!regs.length) {
    c.append(ui.estadoVacio('Todavía no hay historial acumulado. Entrá a la pestaña "Ahora" y sincronizá.', 'grafico'));
    return;
  }

  // --- Métricas generales ---
  const totalMin = regs.reduce((s, r) => s + (r.durMs || 0), 0) / 60000;
  const artistasSet = new Set(regs.map(r => (r.artista || '').split(',')[0].trim()).filter(Boolean));
  const cancionesSet = new Set(regs.map(r => r.trackId || (r.nombre + '|' + r.artista)));
  const met = (valor, etiqueta) => ui.el('div', { class: 'tarjeta metrica' },
    ui.el('div', { class: 'valor' }, valor), ui.el('div', { class: 'etiqueta' }, etiqueta));
  c.append(ui.el('div', { class: 'grilla grilla-2' },
    met(String(regs.length), 'Reproducciones registradas'),
    met(ui.fmtDuracion(totalMin), 'Tiempo de escucha estimado'),
    met(String(artistasSet.size), 'Artistas distintos'),
    met(String(cancionesSet.size), 'Canciones distintas')));

  // --- Artistas más escuchados (top 8, barras) ---
  const porArtista = {};
  for (const r of regs) {
    const a = (r.artista || '').split(',')[0].trim() || '(desconocido)';
    porArtista[a] = (porArtista[a] || 0) + 1;
  }
  const topArtistas = Object.entries(porArtista).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const cvArtistas = ui.el('canvas', { class: 'grafico' });
  c.append(ui.el('div', { class: 'tarjeta' },
    ui.el('h3', {}, 'Artistas más escuchados'),
    cvArtistas,
    ui.el('p', { class: 'texto-chico texto-suave', style: { marginTop: '6px' } },
      topArtistas.map(([a, n], i) => `${i + 1}. ${a} (${n})`).join(' · '))));

  // --- Canciones más repetidas (top 10) ---
  const porCancion = new Map();
  for (const r of regs) {
    const k = r.trackId || (r.nombre + '|' + r.artista);
    if (!porCancion.has(k)) porCancion.set(k, { nombre: r.nombre, artista: r.artista, imagen: r.imagen, n: 0 });
    porCancion.get(k).n++;
  }
  const topCanciones = [...porCancion.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  const cardCanciones = ui.el('div', { class: 'tarjeta' }, ui.el('h3', {}, 'Canciones más repetidas'));
  topCanciones.forEach((t, i) => {
    cardCanciones.append(itemLista({
      num: i + 1,
      imagen: t.imagen,
      titulo: t.nombre,
      sub: t.artista,
      acciones: ui.el('span', { class: 'chip chip-acento' }, t.n + '×'),
    }));
  });
  c.append(cardCanciones);

  // --- Distribución por franja horaria (de a 3 h) y por día de semana ---
  const franjas = new Array(8).fill(0);
  const dias = new Array(7).fill(0);
  for (const r of regs) {
    const d = new Date(r.playedAt);
    if (isNaN(d)) continue;
    franjas[Math.floor(d.getHours() / 3)]++;
    dias[d.getDay()]++;
  }
  const etiquetasFranja = ['0-3', '3-6', '6-9', '9-12', '12-15', '15-18', '18-21', '21-24'];
  const cvFranjas = ui.el('canvas', { class: 'grafico' });
  const cvDias = ui.el('canvas', { class: 'grafico' });
  const ordenDias = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo
  c.append(
    ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, '¿A qué hora escuchás?'),
      cvFranjas),
    ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, '¿Qué días escuchás?'),
      cvDias));

  ui.alPintar(() => {
    ui.graficoBarras(cvArtistas, topArtistas.map(([a, n]) => ({ etiqueta: cortar(a, 8), valor: n })));
    ui.graficoBarras(cvFranjas, etiquetasFranja.map((e, i) => ({ etiqueta: e + 'h', valor: franjas[i] })));
    ui.graficoBarras(cvDias, ordenDias.map(i => ({ etiqueta: ui.DIAS_CORTO[i], valor: dias[i] })));
  });

  // --- Música en movimiento (join con trayectos) ---
  const porTray = new Map();
  for (const r of regs) {
    if (!r.trayectoId) continue;
    if (!porTray.has(r.trayectoId)) porTray.set(r.trayectoId, []);
    porTray.get(r.trayectoId).push(r);
  }
  const cardMov = ui.el('div', { class: 'tarjeta' },
    ui.el('h3', {}, ui.icon('mapa'), 'Música en movimiento'),
    ui.el('p', { class: 'texto-suave texto-chico' }, 'Temas que sonaron mientras se grababa un trayecto en el módulo Ubicación.'));
  if (!porTray.size) {
    cardMov.append(ui.el('p', { class: 'texto-suave texto-chico' },
      'Todavía no hay cruces. Grabá un trayecto con música sonando y sincronizá el historial después.'));
  } else {
    const entradas = [];
    for (const [id, temas] of porTray) {
      let tr = null;
      try { tr = await db.get('trayectos', id); } catch { tr = null; }
      temas.sort((a, b) => a.playedAt < b.playedAt ? -1 : 1);
      entradas.push({ tr, temas });
    }
    entradas.sort((a, b) => a.temas[0].playedAt < b.temas[0].playedAt ? 1 : -1);
    if (!c.isConnected) return;
    for (const { tr, temas } of entradas) {
      const fecha = tr && tr.fecha ? ui.fmtFecha(tr.fecha) : ui.fmtFecha(ui.hoyISO(new Date(temas[0].playedAt)));
      const modo = (tr && tr.modo) ? String(tr.modo) : 'trayecto';
      const iconoModo = /cami|pie|walk/i.test(modo) ? 'caminar' : 'vehiculo';
      const sub = [];
      if (tr && tr.distanciaM) sub.push((tr.distanciaM / 1000).toFixed(1) + ' km');
      if (tr && tr.duracionMin) sub.push(ui.fmtDuracion(tr.duracionMin));
      const caja = ui.el('div', { style: { background: 'var(--fondo-3)', border: '1px solid var(--borde)', borderRadius: 'var(--radio-chico)', padding: '10px 12px', marginTop: '10px' } },
        ui.el('div', { class: 'fila espaciado' },
          ui.el('div', { class: 'fila', style: { gap: '7px' } },
            ui.icon(iconoModo),
            ui.el('strong', {}, tr ? (modo.charAt(0).toUpperCase() + modo.slice(1)) : 'Trayecto eliminado'),
            ui.el('span', { class: 'texto-suave texto-chico' }, fecha)),
          sub.length ? ui.el('span', { class: 'chip' }, sub.join(' · ')) : null));
      for (const t of temas) {
        caja.append(ui.el('div', { class: 'lista-item', style: { padding: '7px 0' } },
          ui.el('span', { class: 'texto-suave texto-chico', style: { flexShrink: '0', fontVariantNumeric: 'tabular-nums' } }, ui.ahoraHM(new Date(t.playedAt))),
          ui.el('div', { class: 'principal' },
            ui.el('div', { class: 'titulo', style: { fontSize: '.9rem' } }, t.nombre),
            ui.el('div', { class: 'sub' }, t.artista))));
      }
      cardMov.append(caja);
    }
  }
  c.append(cardMov);

  // --- Mantenimiento del historial ---
  c.append(ui.el('div', { class: 'tarjeta' },
    ui.el('h3', {}, 'Mantenimiento'),
    ui.el('p', { class: 'texto-suave texto-chico' }, 'Estas stats se calculan solo con lo guardado en este dispositivo (funcionan sin internet).'),
    ui.el('button', { class: 'btn btn-peligro btn-chico', onClick: async () => {
      if (!(await ui.confirmar(`¿Borrar TODO el historial de escucha registrado (${regs.length} reproducciones)? Esto no toca tu cuenta de Spotify.`, 'Borrar historial'))) return;
      await db.clear('musicaRegistro');
      ui.toast('Historial borrado');
      if (c.isConnected) { c.innerHTML = ''; tabStats(c); }
    } }, ui.icon('basura'), 'Borrar todo el historial')));
}

// ---------- Pestaña DESCUBRIR ----------

async function generarDescubrimientos() {
  const top = await spGet('/me/top/artists?time_range=medium_term&limit=5');
  if (!top || !Array.isArray(top.items) || !top.items.length) return null;
  const candidatos = [];
  for (const art of top.items) {
    if (!art || !art.id) continue;
    const albums = await spGet('/artists/' + art.id + '/albums?limit=10&include_groups=album,single');
    if (!albums || !Array.isArray(albums.items)) continue;
    // Dedup por nombre de álbum (reediciones) y moderación: máx. 3 álbumes por artista
    const vistos = new Set();
    const elegidos = [];
    for (const al of albums.items) {
      const k = (al.name || '').toLowerCase();
      if (!al.id || vistos.has(k)) continue;
      vistos.add(k);
      elegidos.push(al);
      if (elegidos.length >= 3) break;
    }
    for (const al of elegidos) {
      const pistas = await spGet('/albums/' + al.id + '/tracks?limit=50');
      if (!pistas || !Array.isArray(pistas.items)) continue;
      const imgs = al.images || [];
      for (const p of pistas.items) {
        if (!p || !p.id) continue;
        candidatos.push({
          trackId: p.id,
          nombre: p.name || '(sin nombre)',
          artista: (p.artists || []).map(a => a.name).join(', '),
          album: al.name || '',
          imagen: imgs.length ? imgs[imgs.length - 1].url : '',
        });
      }
    }
  }
  if (!candidatos.length) return null;
  // Filtrar lo que ya escuchaste (por id de track y por nombre+artista, por si son reediciones)
  const regs = await db.getAll('musicaRegistro');
  const idsEscuchados = new Set(regs.map(r => r.trackId).filter(Boolean));
  const nombresEscuchados = new Set(regs.map(r => ((r.nombre || '') + '|' + (r.artista || '')).toLowerCase()));
  const yaVi = new Set();
  let nuevos = candidatos.filter(cd => {
    const k = (cd.nombre + '|' + cd.artista).toLowerCase();
    if (idsEscuchados.has(cd.trackId) || nombresEscuchados.has(k) || yaVi.has(k)) return false;
    yaVi.add(k);
    return true;
  });
  // Mezclar para variar y recortar
  for (let i = nuevos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nuevos[i], nuevos[j]] = [nuevos[j], nuevos[i]];
  }
  nuevos = nuevos.slice(0, 30);
  const valor = { fecha: Date.now(), items: nuevos };
  await db.put('musicaCache', { clave: 'descubrir', valor });
  return valor;
}

async function obtenerDescubrimientos(forzar) {
  const dias = Number(await db.getSetting('musica.diasDescubrir', 3)) || 3;
  const cache = await db.get('musicaCache', 'descubrir');
  const vigente = cache && cache.valor && Array.isArray(cache.valor.items) && cache.valor.items.length
    && (Date.now() - cache.valor.fecha) < dias * 86400000;
  if (!forzar && vigente) return cache.valor;
  const nuevo = await generarDescubrimientos();
  // Si falló la regeneración pero había caché, devolvemos lo viejo antes que nada
  if (!nuevo && cache && cache.valor && Array.isArray(cache.valor.items) && cache.valor.items.length) return cache.valor;
  return nuevo;
}

async function tabDescubrir(c) {
  pararRefresco();
  const dias = Number(await db.getSetting('musica.diasDescubrir', 3)) || 3;
  if (!c.isConnected) return;

  const inDias = ui.campo({ tipo: 'number', etiqueta: 'Regenerar automáticamente cada (días)', valor: dias, min: 1, max: 60 });
  inDias.input.addEventListener('change', () => {
    const v = Math.max(1, Number(inDias.input.value) || 3);
    inDias.input.value = v;
    db.setSetting('musica.diasDescubrir', v);
  });
  const zona = ui.el('div');
  const btnRegen = ui.el('button', { class: 'btn btn-primario', onClick: () => pintar(true) }, ui.icon('buscar'), 'Regenerar ahora');

  c.append(
    ui.el('div', { class: 'tarjeta' },
      ui.el('h3', {}, ui.icon('objetivo'), 'Para descubrir'),
      ui.el('p', { class: 'texto-suave texto-chico' },
        'Siendo honestos: Spotify cerró su API de recomendaciones para apps nuevas, así que acá no hay magia de Spotify. ' +
        'Estas sugerencias salen de tu propio historial: buscamos álbumes y singles de tus 5 artistas más escuchados (últimos 6 meses) ' +
        'y te mostramos los temas que todavía no aparecen en tu registro.'),
      inDias,
      btnRegen),
    zona);

  const pintar = async (forzar) => {
    btnRegen.disabled = true;
    zona.innerHTML = '';
    zona.append(ui.el('p', { class: 'texto-suave' }, forzar ? 'Buscando temas nuevos… puede tardar unos segundos.' : 'Cargando sugerencias…'));
    let data = null;
    try { data = await obtenerDescubrimientos(!!forzar); } catch { data = null; }
    btnRegen.disabled = false;
    if (!zona.isConnected) return;
    zona.innerHTML = '';
    if (!data || !data.items || !data.items.length) {
      zona.append(ui.estadoVacio('No pude armar sugerencias. Necesitás conexión, algo de historial en Spotify… y que te queden temas sin escuchar de tus artistas.', 'buscar'));
      return;
    }
    const f = new Date(data.fecha);
    const card = ui.el('div', { class: 'tarjeta' },
      ui.el('div', { class: 'tarjeta-titulo' },
        ui.el('h3', {}, 'Temas de tus artistas que todavía no escuchaste'),
        ui.el('span', { class: 'texto-chico texto-suave' }, 'Generado el ' + ui.fmtFecha(ui.hoyISO(f)) + ' ' + ui.ahoraHM(f))));
    for (const t of data.items) {
      const url = 'https://open.spotify.com/track/' + t.trackId;
      card.append(itemLista({
        imagen: t.imagen,
        titulo: t.nombre,
        sub: t.artista + (t.album ? ' · ' + t.album : ''),
        href: url,
        acciones: ui.el('a', { class: 'btn btn-chico', href: url, target: '_blank', rel: 'noopener' }, ui.icon('play'), 'Abrir'),
      }));
    }
    card.append(ui.el('p', { class: 'texto-chico texto-suave mt' },
      'Los links abren en Spotify. Después de escucharlos, sincronizá el historial y van a dejar de aparecer acá.'));
    zona.append(card);
  };
  pintar(false);
}

// ---------- Render principal ----------

async function render(cont) {
  pararRefresco();
  cont.append(ui.el('div', { class: 'cabecera-modulo' }, ui.el('h2', {}, ui.icon('musica'), 'Música')));

  const clientId = ((await db.getSetting('spotifyClientId', '')) || '').trim();

  // ¿Volvemos del login de Spotify? (state con prefijo 'musica' = es nuestro, no de Google)
  const q = new URLSearchParams(location.search);
  if (q.get('code') && (q.get('state') || '').startsWith('musica')) {
    const ok = await canjearCodigo(q.get('code'), q.get('state'));
    history.replaceState(null, '', location.pathname + location.hash);
    ui.toast(ok ? '¡Spotify conectado! 🎉' : 'No se pudo completar la conexión. Probá conectar de nuevo.', ok ? 'ok' : 'error', 4500);
  } else if (q.get('error') && (q.get('state') || '').startsWith('musica')) {
    history.replaceState(null, '', location.pathname + location.hash);
    ui.toast('Autorización cancelada en Spotify.', 'info');
  }

  if (!clientId) { pintarGuia(cont); return; }

  const tokens = await db.get('musicaCache', 'tokens');
  if (!tokens || !tokens.valor || !tokens.valor.access_token) {
    pintarConectar(cont, clientId);
    return;
  }

  // Con sesión: encabezado + pestañas
  cont.append(ui.el('div', { class: 'fila espaciado mb' },
    ui.el('span', { class: 'chip chip-ok' }, ui.icon('spotify'), 'Spotify conectado'),
    ui.el('button', { class: 'btn btn-sec btn-chico', onClick: async () => {
      if (!(await ui.confirmar('¿Desvincular tu cuenta de Spotify? Tu historial guardado en la app NO se borra.', 'Desvincular'))) return;
      await db.del('musicaCache', 'tokens');
      await db.del('musicaCache', 'pkce');
      pararRefresco();
      ui.toast('Cuenta desvinculada');
      window.navegar('musica');
    } }, 'Desvincular')));

  ui.tabs([
    { id: 'ahora', texto: 'Ahora', render: c => { tabAhora(c); } },
    { id: 'tops', texto: 'Tops', render: c => { tabTops(c); } },
    { id: 'stats', texto: 'Mis stats', render: c => { tabStats(c); } },
    { id: 'descubrir', texto: 'Descubrir', render: c => { tabDescubrir(c); } },
  ], cont);
}

export default { id: 'musica', nombre: 'Música', icono: 'musica', render };
