// Ficha interna: convierte las respuestas de cada perfil en parámetros visuales.
// El visitante nunca la ve (salvo en el modo ?debug=1).

import { codificar } from './questions.js';

// ---------------------------------------------------------------- utilidades

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const r3 = (x) => Math.round(x * 1000) / 1000;

// cyrb53: hash corto y estable de una cadena.
function hash(str, semilla = 0) {
  let h1 = 0xdeadbeef ^ semilla;
  let h2 = 0x41c6ce57 ^ semilla;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexARgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function rgbAHex(rgb) {
  return '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbAHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslARgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

// Gira el tono hacia un tono objetivo, como mucho `grados`.
function girarHacia(h, objetivo, grados) {
  let d = ((objetivo - h + 540) % 360) - 180;
  return h + clamp(d, -grados, grados);
}

function mezclarTono(h1, h2, t) {
  const d = ((h2 - h1 + 540) % 360) - 180;
  return h1 + d * t;
}

// --------------------------------------------------------------- mapeos base

const SABOR = {
  dulce: { temp: 0.55, densidad: 0.72, viscosidad: 0.55, tension: 0.22, grano: 0.18, turb: 0.25, contraste: 0.4, luz: 0.04 },
  amargo: { temp: -0.05, densidad: 0.62, viscosidad: 0.42, tension: 0.86, grano: 0.3, turb: 0.35, contraste: 0.92, luz: -0.08 },
  citrico: { temp: -0.6, densidad: 0.32, viscosidad: 0.2, tension: 0.78, grano: 0.82, turb: 0.4, contraste: 0.55, luz: 0.06 },
  especiado: { temp: 0.7, densidad: 0.66, viscosidad: 0.45, tension: 0.5, grano: 0.45, turb: 0.55, contraste: 0.6, luz: 0 },
  cremoso: { temp: 0.3, densidad: 0.86, viscosidad: 0.86, tension: 0.18, grano: 0.12, turb: 0.15, contraste: 0.35, luz: 0.05 },
};

const AROMA = {
  vainilla: { color: '#e9cb98', grano: -0.06, temp: 0.15 },
  tonka: { color: '#d6a465', grano: 0.04, temp: 0.2 },
  madera: { color: '#8a5631', grano: 0.14, temp: 0.1 },
  citricos: { color: '#cbd45c', grano: 0.18, temp: -0.2 },
  flores: { color: '#c690ae', grano: -0.04, temp: 0 },
  hierbas: { color: '#74a36c', grano: 0.1, temp: -0.15 },
  cafe: { color: '#6a4330', grano: 0.1, temp: 0.12 },
};

const RITMO = {
  calma: { velocidad: 0.18, turbulencia: 0.1, deriva: 0 },
  constante: { velocidad: 0.42, turbulencia: 0.28, deriva: 0.1 },
  energico: { velocidad: 0.8, turbulencia: 0.68, deriva: 0.25 },
  impredecible: { velocidad: 0.58, turbulencia: 0.88, deriva: 0.9 },
};

// Ámbar-crema: la vainilla y el haba tonka que compartían los dos cocteles.
const HILO_COMUN = '#e8c690';

// ------------------------------------------------------------------- fichas

function construirFicha(r, semilla, etiqueta) {
  const rng = mulberry32(hash(etiqueta, semilla));
  const j = (amp) => (rng() * 2 - 1) * amp;

  const s = SABOR[r.sabor];
  const ar = AROMA[r.aroma];
  const ri = RITMO[r.ritmo];
  const d = r.distancia;
  const i = r.intensidad;

  const temperatura = clamp(s.temp * 0.75 + ar.temp + j(0.05), -1, 1);
  const tonoTemp = temperatura >= 0 ? 32 : 205;

  // Color principal: el color elegido, matizado por temperatura e intensidad.
  let [h, sat, l] = rgbAHsl(hexARgb(r.color));
  h = girarHacia(h, tonoTemp, Math.abs(temperatura) * 10) + j(5);
  sat = clamp(sat * (0.6 + 0.55 * i), 0.16, 0.88);
  l = clamp(l + s.luz + j(0.025), 0.4, 0.7);
  const principal = [h, sat, l];

  // Secundario: el aroma.
  let [h2, s2, l2] = rgbAHsl(hexARgb(ar.color));
  h2 = girarHacia(h2, tonoTemp, Math.abs(temperatura) * 6) + j(4);
  s2 = clamp(s2 * (0.75 + 0.35 * i), 0.12, 0.85);
  l2 = clamp(l2 + j(0.02), 0.36, 0.78);
  const secundario = [h2, s2, l2];

  // Profundo: la sombra de ambos.
  const profundo = [
    mezclarTono(h, h2, 0.35),
    clamp(sat * 0.55 + 0.1, 0.1, 0.7),
    clamp(0.2 + 0.06 * (1 - s.contraste) + j(0.015), 0.12, 0.28),
  ];

  const ficha = {
    paleta: {
      principal: rgbAHex(hslARgb(principal)),
      secundario: rgbAHex(hslARgb(secundario)),
      profundo: rgbAHex(hslARgb(profundo)),
    },
    temperatura: r3(temperatura),
    grano: r3(clamp01(s.grano * 0.8 + ar.grano + 0.1 + j(0.04))),
    densidad: r3(clamp01(s.densidad * 0.65 + i * 0.35 + j(0.03))),
    viscosidad: r3(clamp01(s.viscosidad + (ri.velocidad < 0.3 ? 0.08 : 0) + j(0.03))),
    corriente: {
      velocidad: r3(clamp01(ri.velocidad + j(0.04))),
      turbulencia: r3(clamp01(ri.turbulencia * 0.72 + s.turb * 0.28 + j(0.04))),
      deriva: r3(clamp01(ri.deriva + j(0.03))),
    },
    profundidad: {
      capas: Math.round(2 + 3 * d),
      transparencia: r3(clamp01(0.12 + 0.6 * d + j(0.03))),
      desenfoque: r3(clamp01(0.04 + 0.72 * d + j(0.03))),
    },
    tensionSuperficial: r3(clamp01(s.tension * (1 - 0.45 * d) + j(0.03))),
    contraste: r3(clamp01(s.contraste * (1 - 0.35 * d) + i * 0.2)),
    fase: r3(rng()), // desfase propio de sus corrientes
  };
  return ficha;
}

export function construirSistema(respuestas) {
  const codigo = codificar(respuestas);
  const seed = hash(codigo);
  const a = construirFicha(respuestas.a, seed, 'A');
  const b = construirFicha(respuestas.b, seed, 'B');
  const sintonia = clamp01(respuestas.sintonia);
  const aromaComun = ['vainilla', 'tonka'];
  const extra = aromaComun.includes(respuestas.a.aroma) || aromaComun.includes(respuestas.b.aroma) ? 0.08 : 0;
  return {
    a,
    b,
    sintonia: r3(sintonia),
    hiloComun: { color: HILO_COMUN, presencia: r3(clamp01(0.22 + 0.68 * sintonia + extra)) },
    seed,
    seedTexto: seed.toString(36),
    codigo,
  };
}
