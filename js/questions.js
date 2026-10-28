// Preguntas de la conversación y codificación compacta de las respuestas.
// Las respuestas de un perfil tienen la forma:
//   { sabor, aroma, ritmo, color: '#rrggbb', distancia: 0..1, intensidad: 0..1 }

export const PALETA = [
  { hex: '#e07a3f', nombre: 'Atardecer' },
  { hex: '#f2a07b', nombre: 'Durazno' },
  { hex: '#c9a227', nombre: 'Oro viejo' },
  { hex: '#7a1f3d', nombre: 'Vino' },
  { hex: '#d4949e', nombre: 'Rosa polvo' },
  { hex: '#9c86c2', nombre: 'Lavanda' },
  { hex: '#8fb3d9', nombre: 'Cielo de la tarde' },
  { hex: '#1f4e6b', nombre: 'Mar profundo' },
  { hex: '#2fa39a', nombre: 'Turquesa' },
  { hex: '#2f5d45', nombre: 'Bosque' },
];

export const PREGUNTAS_PERFIL = [
  {
    id: 'sabor',
    tipo: 'opcion',
    texto: {
      a: '¿Qué sabor buscas primero en una bebida?',
      b: '¿Qué sabor busca esa persona en una bebida?',
    },
    opciones: [
      ['dulce', 'Dulce'],
      ['amargo', 'Amargo'],
      ['citrico', 'Cítrico'],
      ['especiado', 'Especiado'],
      ['cremoso', 'Cremoso'],
    ],
  },
  {
    id: 'aroma',
    tipo: 'opcion',
    texto: {
      a: '¿Qué aroma te hace sentir en casa?',
      b: '¿Qué aroma la hace sentir en casa?',
    },
    opciones: [
      ['vainilla', 'Vainilla'],
      ['tonka', 'Haba tonka'],
      ['madera', 'Madera'],
      ['citricos', 'Cítricos'],
      ['flores', 'Flores'],
      ['hierbas', 'Hierbas frescas'],
      ['cafe', 'Café o cacao'],
    ],
  },
  {
    id: 'ritmo',
    tipo: 'opcion',
    texto: {
      a: '¿Cómo es tu ritmo?',
      b: '¿Y cómo es su ritmo?',
    },
    opciones: [
      ['calma', 'Calma'],
      ['constante', 'Constante'],
      ['energico', 'Enérgico'],
      ['impredecible', 'Impredecible'],
    ],
  },
  {
    id: 'color',
    tipo: 'color',
    texto: {
      a: 'Un color que te lleve a un momento especial.',
      b: 'Un color que a esa persona la lleve a un momento especial.',
    },
  },
  {
    id: 'distancia',
    tipo: 'slider',
    texto: {
      a: '¿Qué tan cerca o lejos queda ese momento?',
      b: '¿Qué tan cerca o lejos queda ese momento para esa persona?',
    },
    extremos: ['Reciente', 'Muy lejano'],
    valores: ['Reciente', 'Hace poco', 'Hace un tiempo', 'Hace años', 'Muy lejano'],
  },
  {
    id: 'intensidad',
    tipo: 'slider',
    texto: {
      a: '¿Qué tan intenso es lo que sientes por ese recuerdo?',
      b: '¿Qué tan intenso es lo que siente por ese recuerdo?',
    },
    extremos: ['Ligero', 'Intenso'],
    valores: ['Ligero', 'Suave', 'Presente', 'Profundo', 'Intenso'],
  },
];

export const PREGUNTA_COMPARTIDA = {
  id: 'sintonia',
  tipo: 'slider',
  texto: { c: '¿Qué tan entrelazados se sienten?' },
  extremos: ['Cada uno en lo suyo', 'Muy entrelazados'],
  valores: ['Cada uno en lo suyo', 'Cerca', 'Acompasados', 'Unidos', 'Muy entrelazados'],
};

export function textoDeValor(pregunta, v) {
  const lista = pregunta.valores;
  return lista[Math.min(lista.length - 1, Math.floor(v * lista.length))];
}

export function respuestasVacias() {
  const perfil = () => ({ sabor: null, aroma: null, ritmo: null, color: null, distancia: 0.5, intensidad: 0.5 });
  return { a: perfil(), b: perfil(), sintonia: 0.5 };
}

// --- Codificación para el enlace (#m=...) y para la seed -------------------

const opcionesDe = (id) => PREGUNTAS_PERFIL.find((p) => p.id === id).opciones.map((o) => o[0]);

function codificarPerfil(p) {
  return [
    opcionesDe('sabor').indexOf(p.sabor),
    opcionesDe('aroma').indexOf(p.aroma),
    opcionesDe('ritmo').indexOf(p.ritmo),
    p.color.replace('#', '').toLowerCase(),
    Math.round(p.distancia * 100),
    Math.round(p.intensidad * 100),
  ].join('.');
}

export function codificar(r) {
  return ['1', codificarPerfil(r.a), codificarPerfil(r.b), Math.round(r.sintonia * 100)].join('-');
}

function decodificarPerfil(s) {
  const partes = s.split('.');
  if (partes.length !== 6) return null;
  const [is, ia, ir, hex, d, i] = partes;
  const sabor = opcionesDe('sabor')[+is];
  const aroma = opcionesDe('aroma')[+ia];
  const ritmo = opcionesDe('ritmo')[+ir];
  if (!sabor || !aroma || !ritmo || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = (x) => Math.min(100, Math.max(0, parseInt(x, 10) || 0)) / 100;
  return { sabor, aroma, ritmo, color: '#' + hex.toLowerCase(), distancia: n(d), intensidad: n(i) };
}

export function decodificar(cadena) {
  if (!cadena) return null;
  const partes = cadena.split('-');
  if (partes.length !== 4 || partes[0] !== '1') return null;
  const a = decodificarPerfil(partes[1]);
  const b = decodificarPerfil(partes[2]);
  if (!a || !b) return null;
  const s = Math.min(100, Math.max(0, parseInt(partes[3], 10) || 0)) / 100;
  return { a, b, sintonia: s };
}

// Solo para el modo ?debug=1: respuestas al azar para probar rápido.
export function respuestasAlAzar() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const perfil = () => ({
    sabor: pick(opcionesDe('sabor')),
    aroma: pick(opcionesDe('aroma')),
    ritmo: pick(opcionesDe('ritmo')),
    color: pick(PALETA).hex,
    distancia: Math.round(Math.random() * 100) / 100,
    intensidad: Math.round(Math.random() * 100) / 100,
  });
  return { a: perfil(), b: perfil(), sintonia: Math.round(Math.random() * 100) / 100 };
}
