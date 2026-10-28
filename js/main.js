import {
  PALETA,
  PREGUNTAS_PERFIL,
  PREGUNTA_COMPARTIDA,
  textoDeValor,
  respuestasVacias,
  codificar,
  decodificar,
  respuestasAlAzar,
} from './questions.js';
import { construirSistema } from './profile.js';
import { FluidSim } from './fluid.js';
import { capturar, descargar, enlaceCompartible, copiarTexto, nombreArchivo } from './export.js';

const $ = (sel) => document.querySelector(sel);
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const movimientoReducido = matchMedia('(prefers-reduced-motion: reduce)');

const T_SALIDA = movimientoReducido.matches ? 300 : 520;
const T_AVANCE = 480;

// ------------------------------------------------------------------ estado

const estado = {
  respuestas: respuestasVacias(),
  paso: 0,
  sistema: null,
  captura: null,
  bloqueado: false,
};

const QUIEN = { a: 'Tú', b: 'Alguien con quien compartes', c: 'Entre los dos' };

const PASOS = [
  { tipo: 'interludio', perfil: 'a', titulo: 'Primero, tú.', texto: 'Sin pensarlo mucho.' },
  ...PREGUNTAS_PERFIL.map((q) => ({ tipo: 'pregunta', perfil: 'a', q })),
  { tipo: 'interludio', perfil: 'b', titulo: 'Ahora, alguien con quien compartes.', texto: 'Responde como lo haría esa persona.' },
  ...PREGUNTAS_PERFIL.map((q) => ({ tipo: 'pregunta', perfil: 'b', q })),
  { tipo: 'interludio', perfil: 'c', titulo: 'Y entre los dos…' },
  { tipo: 'pregunta', perfil: 'c', q: PREGUNTA_COMPARTIDA },
];
const TOTAL_PREGUNTAS = PASOS.filter((p) => p.tipo === 'pregunta').length;

// ---------------------------------------------------------------- pantallas

let pantallaActual = $('#portada');

function mostrarPantalla(id) {
  const nueva = document.getElementById(id);
  if (nueva === pantallaActual) return;
  const vieja = pantallaActual;
  vieja.classList.remove('is-active');
  vieja.setAttribute('inert', '');
  nueva.removeAttribute('inert');
  // Doble rAF para que la transición de opacidad se dispare.
  requestAnimationFrame(() => requestAnimationFrame(() => nueva.classList.add('is-active')));
  pantallaActual = nueva;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ conversación

const pasoEl = $('#paso');
const btnAtras = $('#btn-atras');
const btnSeguir = $('#btn-seguir');

function valorActual(p) {
  if (p.perfil === 'c') return estado.respuestas.sintonia;
  return estado.respuestas[p.perfil][p.q.id];
}

function guardar(p, valor) {
  if (p.perfil === 'c') estado.respuestas.sintonia = valor;
  else estado.respuestas[p.perfil][p.q.id] = valor;
  actualizarNav();
}

function pasoRespondido(p) {
  if (p.tipo === 'interludio') return true;
  const v = valorActual(p);
  return v !== null && v !== undefined;
}

function actualizarNav() {
  const p = PASOS[estado.paso];
  const primero = estado.paso === 0;
  btnAtras.setAttribute('aria-hidden', primero ? 'true' : 'false');
  btnAtras.tabIndex = primero ? -1 : 0;
  btnSeguir.disabled = !pasoRespondido(p);
  btnSeguir.textContent = estado.paso === PASOS.length - 1 ? 'Mezclar' : 'Seguir';

  const hechas = PASOS.slice(0, estado.paso).filter((x) => x.tipo === 'pregunta').length;
  $('#progreso').style.width = `${(hechas / TOTAL_PREGUNTAS) * 100}%`;
}

function titulo(texto, extraClase = '') {
  const h = document.createElement('h2');
  h.className = `step__title ${extraClase}`;
  h.id = 'paso-titulo';
  h.tabIndex = -1;
  h.textContent = texto;
  return h;
}

function construirInterludio(p) {
  const frag = document.createDocumentFragment();
  frag.append(titulo(p.titulo, 'step__title--interlude'));
  if (p.texto) {
    const t = document.createElement('p');
    t.className = 'step__hint';
    t.textContent = p.texto;
    frag.append(t);
  }
  return frag;
}

// Grupo de radio accesible con foco itinerante.
function grupoRadio(contenedor, items, seleccionado, alElegir) {
  contenedor.setAttribute('role', 'radiogroup');
  contenedor.setAttribute('aria-labelledby', 'paso-titulo');
  const botones = items.map(({ valor, crear }) => {
    const b = crear();
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.valor = valor;
    contenedor.append(b);
    return b;
  });
  const marcar = (valor) => {
    let alguno = false;
    botones.forEach((b) => {
      const on = b.dataset.valor === valor;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      alguno ||= on;
    });
    if (!alguno && botones[0]) botones[0].tabIndex = 0;
  };
  marcar(seleccionado);
  botones.forEach((b, i) => {
    b.addEventListener('click', () => {
      marcar(b.dataset.valor);
      alElegir(b.dataset.valor, true);
    });
    b.addEventListener('keydown', (e) => {
      const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!delta) return;
      e.preventDefault();
      const sig = botones[(i + delta + botones.length) % botones.length];
      sig.focus();
      marcar(sig.dataset.valor);
      alElegir(sig.dataset.valor, false);
    });
  });
  return { botones, marcar };
}

function construirOpciones(p) {
  const frag = document.createDocumentFragment();
  frag.append(titulo(p.q.texto[p.perfil]));
  const cont = document.createElement('div');
  cont.className = 'options';
  grupoRadio(
    cont,
    p.q.opciones.map(([valor, etiqueta]) => ({
      valor,
      crear: () => {
        const b = document.createElement('button');
        b.className = 'option';
        b.textContent = etiqueta;
        return b;
      },
    })),
    valorActual(p),
    (valor, avanzar) => {
      guardar(p, valor);
      if (avanzar) setTimeout(() => PASOS[estado.paso] === p && siguiente(), T_AVANCE);
    },
  );
  frag.append(cont);
  return frag;
}

function construirColor(p) {
  const frag = document.createDocumentFragment();
  frag.append(titulo(p.q.texto[p.perfil]));
  const cont = document.createElement('div');
  cont.className = 'swatches';
  const nombre = document.createElement('p');
  nombre.className = 'color-name';
  nombre.setAttribute('aria-live', 'polite');

  const actual = valorActual(p);
  const enPaleta = PALETA.some((c) => c.hex === actual);

  const { marcar } = grupoRadio(
    cont,
    PALETA.map(({ hex, nombre: n }) => ({
      valor: hex,
      crear: () => {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.style.setProperty('--c', hex);
        b.setAttribute('aria-label', n);
        return b;
      },
    })),
    actual,
    (valor) => {
      guardar(p, valor);
      libre.classList.remove('tiene-color');
      libre.removeAttribute('aria-current');
      nombre.textContent = PALETA.find((c) => c.hex === valor).nombre;
    },
  );

  // Selector libre
  const libre = document.createElement('label');
  libre.className = 'swatch swatch--libre';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = actual && !enPaleta ? actual : '#c97b5a';
  input.setAttribute('aria-label', 'Elegir otro color');
  const mas = document.createElement('span');
  mas.className = 'swatch__plus';
  mas.setAttribute('aria-hidden', 'true');
  mas.textContent = '+';
  libre.append(input, mas);
  cont.append(libre);

  const usarLibre = () => {
    const hex = input.value.toLowerCase();
    marcar(null);
    libre.style.setProperty('--c', hex);
    libre.classList.add('tiene-color');
    libre.setAttribute('aria-current', 'true');
    mas.textContent = '';
    guardar(p, hex);
    nombre.textContent = 'Un color propio';
  };
  input.addEventListener('input', usarLibre);
  input.addEventListener('change', usarLibre);

  if (actual && !enPaleta) {
    libre.style.setProperty('--c', actual);
    libre.classList.add('tiene-color');
    mas.textContent = '';
    nombre.textContent = 'Un color propio';
  } else if (enPaleta) {
    nombre.textContent = PALETA.find((c) => c.hex === actual).nombre;
  }

  frag.append(cont, nombre);
  return frag;
}

function construirSlider(p) {
  const frag = document.createDocumentFragment();
  const texto = p.perfil === 'c' ? p.q.texto.c : p.q.texto[p.perfil];
  frag.append(titulo(texto));
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const valor = document.createElement('p');
  valor.className = 'slider__value';
  valor.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(Math.round(valorActual(p) * 100));
  input.setAttribute('aria-labelledby', 'paso-titulo');
  const ends = document.createElement('div');
  ends.className = 'slider__ends';
  ends.setAttribute('aria-hidden', 'true');
  ends.innerHTML = `<span></span><span></span>`;
  ends.children[0].textContent = p.q.extremos[0];
  ends.children[1].textContent = p.q.extremos[1];

  const actualizar = () => {
    const v = +input.value / 100;
    const t = textoDeValor(p.q, v);
    valor.textContent = t;
    input.setAttribute('aria-valuetext', t);
    guardar(p, v);
  };
  input.addEventListener('input', actualizar);
  actualizar();
  wrap.append(valor, input, ends);
  frag.append(wrap);
  return frag;
}

function construirPaso(p) {
  if (p.tipo === 'interludio') return construirInterludio(p);
  if (p.q.tipo === 'opcion') return construirOpciones(p);
  if (p.q.tipo === 'color') return construirColor(p);
  return construirSlider(p);
}

async function irAPaso(indice, { animar = true } = {}) {
  if (estado.bloqueado) return;
  estado.bloqueado = true;
  const p = PASOS[indice];
  const quien = $('#quien');
  if (animar) {
    pasoEl.classList.add('is-out');
    if (quien.textContent !== QUIEN[p.perfil]) quien.style.opacity = '0';
    await esperar(T_SALIDA);
  }
  estado.paso = indice;
  pasoEl.replaceChildren(construirPaso(p));
  quien.textContent = QUIEN[p.perfil];
  quien.style.opacity = '1';
  actualizarNav();
  pasoEl.classList.remove('is-out');
  pasoEl.classList.add('is-in');
  void pasoEl.offsetWidth;
  pasoEl.classList.remove('is-in');
  $('#paso-titulo').focus({ preventScroll: true });
  estado.bloqueado = false;
}

function siguiente() {
  const p = PASOS[estado.paso];
  if (!pasoRespondido(p) || estado.bloqueado) return;
  if (estado.paso < PASOS.length - 1) irAPaso(estado.paso + 1);
  else terminarConversacion();
}

function anterior() {
  if (estado.paso > 0) irAPaso(estado.paso - 1);
}

btnSeguir.addEventListener('click', siguiente);
btnAtras.addEventListener('click', anterior);

$('#conversacion').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.closest('button, label')) return;
  e.preventDefault();
  siguiente();
});

async function terminarConversacion() {
  estado.bloqueado = true;
  mostrarPantalla('reposo');
  await esperar(movimientoReducido.matches ? 1200 : 2000);
  estado.bloqueado = false;
  iniciarSimulacion();
}

// --------------------------------------------------------------- simulación

const lienzo = $('#lienzo');
let fluido = null;
let errorWebGL = false;

function iniciarSimulacion() {
  estado.sistema = construirSistema(estado.respuestas);
  history.replaceState(null, '', `${location.pathname}${location.search}#m=${estado.sistema.codigo}`);
  mostrarPantalla('simulacion');

  if (!fluido && !errorWebGL) {
    try {
      fluido = new FluidSim(lienzo, { movimientoReducido: movimientoReducido.matches });
      fluido.alPerderContexto = () => mostrarSinWebGL();
    } catch (err) {
      console.warn('[armonía] WebGL no disponible:', err.message);
      errorWebGL = true;
    }
  }
  if (!fluido) {
    mostrarSinWebGL();
    return;
  }
  $('#sin-webgl').hidden = true;
  $('#btn-capturar').hidden = false;
  fluido.definirSistema(estado.sistema);
  fluido.iniciar();
  if (DEBUG) mostrarDebug();
}

function mostrarSinWebGL() {
  $('#sin-webgl').hidden = false;
  $('#btn-capturar').hidden = true;
  lienzo.hidden = true;
}

// ------------------------------------------------------------------ captura

const vista = $('#vista-previa');
const img = $('#imagen-captura');
const estadoCaptura = $('#estado-captura');
let focoPrevio = null;

async function abrirCaptura() {
  if (!fluido || !vista.hidden) return;
  fluido.pausar(true);
  const destello = $('#destello');
  destello.classList.remove('is-on');
  void destello.offsetWidth;
  destello.classList.add('is-on');

  focoPrevio = document.activeElement;
  img.classList.remove('is-ready');
  estadoCaptura.textContent = '';
  vista.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => vista.classList.add('is-open')));
  $('#btn-descargar').disabled = true;
  $('#btn-descargar').focus();

  try {
    await esperar(60); // deja pintar el destello antes del trabajo pesado
    liberarCaptura();
    estado.captura = await capturar(fluido);
    img.src = estado.captura.url;
    await img.decode().catch(() => {});
    img.classList.add('is-ready');
    $('#btn-descargar').disabled = false;
  } catch (err) {
    console.error(err);
    estadoCaptura.textContent = 'No se pudo preparar la imagen. Inténtalo de nuevo.';
  }
}

function liberarCaptura() {
  if (estado.captura) URL.revokeObjectURL(estado.captura.url);
  estado.captura = null;
}

async function cerrarCaptura({ reanudar = true } = {}) {
  if (vista.hidden) return;
  vista.classList.remove('is-open');
  await esperar(500);
  vista.hidden = true;
  img.removeAttribute('src');
  liberarCaptura();
  if (reanudar && fluido) fluido.pausar(false);
  if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
}

$('#btn-capturar').addEventListener('click', abrirCaptura);
$('#btn-seguir-fluyendo').addEventListener('click', () => cerrarCaptura());

$('#btn-descargar').addEventListener('click', async () => {
  if (!estado.captura) return;
  const r = await descargar(estado.captura, nombreArchivo(estado.sistema.seedTexto));
  estadoCaptura.textContent =
    r === 'compartido' ? 'Listo.' : r === 'pestana' ? 'Mantén presionada la imagen para guardarla.' : r === 'cancelado' ? '' : 'Imagen descargada.';
});

$('#btn-enlace').addEventListener('click', async () => {
  const ok = await copiarTexto(enlaceCompartible(estado.sistema.codigo));
  estadoCaptura.textContent = ok
    ? 'Enlace copiado. Con él vuelve a nacer esta misma mezcla.'
    : 'No se pudo copiar. El enlace está en la barra de direcciones.';
});

vista.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    cerrarCaptura();
    return;
  }
  if (e.key !== 'Tab') return;
  const focos = [...vista.querySelectorAll('button:not([disabled])')];
  const primero = focos[0];
  const ultimo = focos[focos.length - 1];
  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primero.focus();
  }
});

// ------------------------------------------------------------------ reinicio

async function reiniciar() {
  await cerrarCaptura({ reanudar: false });
  if (fluido) fluido.detener();
  $('#debug').hidden = true;
  estado.respuestas = respuestasVacias();
  estado.sistema = null;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  $('#portada-sub').textContent = 'Cuéntanos un poco de ti. Y de alguien más.';
  mostrarPantalla('portada');
  setTimeout(() => $('#btn-entrar').focus({ preventScroll: true }), 900);
}

document.querySelectorAll('[data-accion="reiniciar"]').forEach((b) => b.addEventListener('click', reiniciar));

// -------------------------------------------------------------------- portada

const desdeEnlace = () => decodificar(new URLSearchParams(location.hash.slice(1)).get('m'));

$('#btn-entrar').addEventListener('click', () => {
  const compartidas = desdeEnlace();
  if (compartidas) {
    estado.respuestas = compartidas;
    terminarConversacion();
    return;
  }
  mostrarPantalla('conversacion');
  irAPaso(0, { animar: false });
});

if (desdeEnlace()) {
  $('#portada-sub').textContent = 'Alguien guardó este momento para ti.';
}

// ---------------------------------------------------------------------- debug

let debugRaf = 0;
function mostrarDebug() {
  const el = $('#debug');
  el.hidden = false;
  const fichas = JSON.stringify(
    {
      perfilA: estado.sistema.a,
      perfilB: estado.sistema.b,
      sintonia: estado.sistema.sintonia,
      hiloComun: estado.sistema.hiloComun,
      seed: estado.sistema.seed,
    },
    null,
    2,
  );
  cancelAnimationFrame(debugRaf);
  let ultimo = 0;
  const tick = (t) => {
    if (el.hidden) return;
    if (t - ultimo > 250 && fluido) {
      ultimo = t;
      const f = fluido.info();
      el.textContent = `fase: ${f.fase}  t=${f.tiempo.toFixed(1)}s  ${f.fps} fps\n${f.resumen}\n\n${fichas}`;
    }
    debugRaf = requestAnimationFrame(tick);
  };
  debugRaf = requestAnimationFrame(tick);
}

if (DEBUG) {
  const azar = $('#btn-azar');
  azar.hidden = false;
  azar.addEventListener('click', () => {
    estado.respuestas = respuestasAlAzar();
    terminarConversacion();
  });
  window.__armonia = { estado, construirSistema, codificar, get fluido() { return fluido; } };
}
