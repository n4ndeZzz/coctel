// Simulación de fluidos tipo "stable fluids" (Stam) en WebGL, sin librerías.
// Advección semi-lagrangiana, divergencia, presión por Jacobi, resta de
// gradiente, confinamiento de vorticidad y un campo de tinta RGBA:
//   r = tinta A, g = tinta B, b = hilo común, a = filamento (vetas de marmoleado).
// La coreografía (separados → encuentro → mezcla → armonía) se escribe como
// un campo de fuerzas y unos emisores automáticos guiados por las fichas.

import { mulberry32 } from './profile.js';

const MAX_EMISORES = 16;
const DURACION = { separados: [0, 3, 6.5], encuentro: [3, 6.5, 8, 11], mezcla: [8, 11, 14, 17.5], armonia: [14, 17.5] };

// ------------------------------------------------------------------ shaders

const VS_BASE = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FS_COPY = `
varying vec2 vUv;
uniform sampler2D uTexture;
void main () { gl_FragColor = texture2D(uTexture, vUv); }`;

const FS_SCALE = `
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uValue;
void main () { gl_FragColor = uValue * texture2D(uTexture, vUv); }`;

const FS_CLEAR = `
void main () { gl_FragColor = vec4(0.0); }`;

const FS_EMIT = `
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float uAspect;
uniform int uCount;
uniform vec4 uEmit[${MAX_EMISORES}];
uniform vec4 uVal[${MAX_EMISORES}];
void main () {
  vec4 base = texture2D(uTarget, vUv);
  vec4 add = vec4(0.0);
  for (int i = 0; i < ${MAX_EMISORES}; i++) {
    if (i >= uCount) break;
    vec2 d = vUv - uEmit[i].xy;
    d.x *= uAspect;
    add += uVal[i] * exp(-dot(d, d) / uEmit[i].z);
  }
  gl_FragColor = base + add;
}`;

const GLSL_NOISE = `
float hash12 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm (vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.03 + 17.1) * 0.35; }
`;

// Campo de fuerzas de la coreografía. Trabaja en un espacio q alineado con el
// eje de separación (horizontal en pantallas anchas, vertical en celulares).
const FS_FORCE = `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform float uDt;
uniform float uTime;
uniform float uAspect;
uniform float uSimH;
uniform float uRelax;
uniform vec2 uAxis;
uniform vec4 uW;
uniform vec2 uCA;
uniform vec2 uCB;
uniform float uSpinA;
uniform float uSpinB;
uniform float uSpinShared;
uniform float uR;
uniform float uSint;
uniform float uShear;
uniform vec2 uTurb;
uniform vec2 uDrift;
uniform float uNoiseAmp;
uniform float uSeed;
${GLSL_NOISE}
vec2 perp (vec2 v) { return vec2(-v.y, v.x); }
vec2 cell (vec2 q, vec2 c, float spin, float R) {
  vec2 d = q - c;
  return spin * perp(d) * exp(-dot(d, d) / (R * R));
}
vec2 curlNoise (vec2 p, float t) {
  float e = 0.06;
  vec2 o = vec2(t * 0.31, -t * 0.23);
  float n1 = fbm(p + o + vec2(0.0, e));
  float n2 = fbm(p + o - vec2(0.0, e));
  float n3 = fbm(p + o + vec2(e, 0.0));
  float n4 = fbm(p + o - vec2(e, 0.0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
void main () {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 ax = uAxis;
  vec2 px = perp(uAxis);
  vec2 q = vec2(dot(p, ax), dot(p, px));

  vec2 cells = cell(q, uCA, uSpinA, uR) + cell(q, uCB, uSpinB, uR);
  float sx = q.x / sqrt(q.x * q.x + 0.004);

  vec2 sep  = cells + vec2(sx * 0.05 * exp(-q.x * q.x / 0.01), 0.0);
  vec2 meet = 0.5 * cells + vec2(-q.x * 0.42, -q.y * 0.08) * exp(-q.y * q.y / 0.14);
  vec2 mixv = 0.55 * cells + vec2(-q.x * 0.12, uShear * sx * exp(-q.x * q.x / 0.05));
  vec2 shared = uSpinShared * perp(q) * exp(-dot(q, q) / (uR * uR * 2.3));
  vec2 harm = mix(cells * 0.75, shared, 0.3 + 0.62 * uSint);

  vec2 target = uW.x * sep + uW.y * meet + uW.z * mixv + uW.w * harm;
  vec2 tv = (target.x * ax + target.y * px) * uSimH;

  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec4 dye = texture2D(uDye, vUv);
  float a = max(dye.r, 0.0);
  float b = max(dye.g, 0.0);
  float wb = (b + 0.02) / (a + b + 0.04);
  float turb = mix(uTurb.x, uTurb.y, wb);
  float drift = mix(uDrift.x, uDrift.y, wb);
  vec2 n = curlNoise(p * 3.2 + uSeed, uTime * (0.06 + 0.5 * drift));

  vel += uDt * uRelax * (tv - vel);
  vel += uDt * n * turb * uNoiseAmp * uSimH;
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

const FS_BILERP = `
vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}`;

const FS_ADVECT = `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform vec4 uDiss;
#ifdef VEL_VISC
uniform sampler2D uDye;
uniform vec2 uViscAB;
#endif
${FS_BILERP}
void main () {
#ifdef MANUAL_FILTERING
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
  vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  vec4 result = texture2D(uSource, coord);
#endif
  vec4 diss = uDiss;
#ifdef VEL_VISC
  vec4 d = texture2D(uDye, vUv);
  float a = max(d.r, 0.0);
  float b = max(d.g, 0.0);
  float wb = b / (a + b + 0.001);
  float pres = clamp((a + b) * 1.5, 0.0, 1.0);
  diss = vec4(mix(uDiss.x, mix(uViscAB.x, uViscAB.y, wb), pres));
#endif
  gl_FragColor = result / (1.0 + diss * dt);
}`;

const FS_DIVERGENCE = `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const FS_CURL = `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const FS_VORTICITY = `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uDye;
uniform vec2 uCurlAB;
uniform float dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  vec4 d = texture2D(uDye, vUv);
  float a = max(d.r, 0.0);
  float b = max(d.g, 0.0);
  float wb = (b + 0.02) / (a + b + 0.04);
  force *= mix(uCurlAB.x, uCurlAB.y, wb) * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
  vel = clamp(vel, -1000.0, 1000.0);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

const FS_PRESSURE = `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const FS_GRADIENT = `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B) * 0.5;
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const FS_BLUR = `
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 uDir;
void main () {
  vec4 c = texture2D(uTexture, vUv) * 0.2270270270;
  c += texture2D(uTexture, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(uTexture, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(uTexture, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(uTexture, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}`;

// Render final: tinta en agua oscura. Capas, vetas, relieve de seda y el hilo.
const FS_DISPLAY = `
varying vec2 vUv;
uniform sampler2D uDye;
uniform sampler2D uBlur;
uniform vec2 uDyeTexel;
uniform vec2 uBlurTexel;
uniform vec2 uOutRes;
uniform float uAspect;
uniform float uSeed;
uniform float uTime;
uniform float uBicubic;
uniform float uHiloPres;
uniform vec3 uA0;
uniform vec3 uA1;
uniform vec3 uA2;
uniform vec3 uB0;
uniform vec3 uB1;
uniform vec3 uB2;
uniform vec3 uHilo;
uniform vec3 uBg;
uniform vec4 uPA;
uniform vec4 uPB;
uniform vec4 uQA;
uniform vec4 uQB;
${GLSL_NOISE}
${FS_BILERP}
vec4 cubic (float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}
vec4 texBicubic (sampler2D sam, vec2 uv, vec2 ts) {
  vec2 tc = uv / ts - 0.5;
  vec2 fxy = fract(tc);
  tc -= fxy;
  vec4 xc = cubic(fxy.x);
  vec4 yc = cubic(fxy.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / s) * ts.xxyy;
  vec4 s0 = texture2D(sam, off.xz);
  vec4 s1 = texture2D(sam, off.yz);
  vec4 s2 = texture2D(sam, off.xw);
  vec4 s3 = texture2D(sam, off.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
vec4 samp (sampler2D sam, vec2 uv, vec2 ts) {
#ifdef MANUAL_FILTERING
  return bilerp(sam, uv, ts);
#else
  if (uBicubic > 0.5) return texBicubic(sam, uv, ts);
  return texture2D(sam, uv);
#endif
}
vec4 tap (sampler2D sam, vec2 uv, vec2 ts) {
#ifdef MANUAL_FILTERING
  return bilerp(sam, uv, ts);
#else
  return texture2D(sam, uv);
#endif
}

// P = tension, capas, transparencia, desenfoque · Q = grano, densidad, contraste
void ink (float cS, float cB, vec3 c0, vec3 c1, vec3 c2, vec4 P, vec4 Q, float n,
          out vec3 col, out float alpha, out vec3 bcol, out float balpha) {
  float k = 1.1 + 2.4 * Q.y;
  float c = mix(cS, cB, P.w * 0.55);
  float cov = 1.0 - exp(-c * k);
  float covB = 1.0 - exp(-cB * k * 0.8);
  float w = mix(0.46, 0.05, P.x);
  float edge = smoothstep(0.38 - w, 0.38 + w, cov);

  float x = log(1.0 + c * 3.0) * P.y * 0.95;
  float bw = mix(0.42, 0.08, P.x);
  float band = smoothstep(0.5 - bw, 0.5 + bw, 0.5 + 0.5 * cos(6.2831853 * x));

  vec3 base = mix(c1, c0, smoothstep(0.06, 0.6, cov));
  base = mix(base, c2, smoothstep(0.7, 1.0, cov) * (0.25 + 0.45 * Q.z));
  col = mix(base, mix(c0, c1, 0.55) * 1.04, band * (0.2 + 0.22 * (1.0 - P.z)));

  alpha = edge * (1.0 - 0.45 * P.z) * (1.0 - 0.3 * P.w);
  alpha *= 1.0 + (n - 0.5) * Q.x * 0.22;
  alpha = clamp(alpha, 0.0, 1.0);

  bcol = mix(c2, c0, 0.38);
  balpha = covB * (0.22 + 0.5 * P.w) * (0.6 + 0.4 * P.z);
}

void main () {
  vec2 uv = vUv;
  vec4 d = max(samp(uDye, uv, uDyeTexel), 0.0);
  vec4 db = max(samp(uBlur, uv, uBlurTexel), 0.0);
  vec4 dl = max(tap(uDye, uv - vec2(uDyeTexel.x, 0.0), uDyeTexel), 0.0);
  vec4 dr = max(tap(uDye, uv + vec2(uDyeTexel.x, 0.0), uDyeTexel), 0.0);
  vec4 dd = max(tap(uDye, uv - vec2(0.0, uDyeTexel.y), uDyeTexel), 0.0);
  vec4 du = max(tap(uDye, uv + vec2(0.0, uDyeTexel.y), uDyeTexel), 0.0);
  vec4 gx = (dr - dl) / (2.0 * uDyeTexel.x);
  vec4 gy = (du - dd) / (2.0 * uDyeTexel.y);

  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float nStatic = hash12(floor(uv * uOutRes / 3.0) + uSeed);

  vec3 colA; float aA; vec3 bA; float baA;
  vec3 colB; float aB; vec3 bB; float baB;
  ink(d.r, db.r, uA0, uA1, uA2, uPA, uQA, nStatic, colA, aA, bA, baA);
  ink(d.g, db.g, uB0, uB1, uB2, uPB, uQB, nStatic, colB, aB, bB, baB);

  // Fondo: casi negro cálido, con un leve resplandor central.
  vec3 col = uBg * (1.18 - 0.4 * length(p));

  // Capa profunda (desenfocada)
  float bs = baA + baB + 1e-4;
  vec3 backCol = (bA * baA + bB * baB) / bs;
  float backA = 1.0 - (1.0 - baA) * (1.0 - baB);
  col = mix(col, backCol, backA * 0.7);

  // Capa frontal
  float fs = aA + aB + 1e-4;
  float wa = aA / fs;
  float wb = aB / fs;
  vec3 front = colA * wa + colB * wb;
  float frontA = 1.0 - (1.0 - aA) * (1.0 - aB);

  // Relieve de seda: normal a partir del gradiente de la tinta comprimida.
  vec2 g = vec2(gx.r / (1.0 + d.r) + gx.g / (1.0 + d.g), gy.r / (1.0 + d.r) + gy.g / (1.0 + d.g));
  vec3 nrm = normalize(vec3(-g * 0.0045, 1.0));
  vec3 Ld = normalize(vec3(-0.45, 0.55, 0.7));
  float diff = dot(nrm, Ld);
  float spec = pow(max(dot(reflect(-Ld, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);
  float tens = uPA.x * wa + uPB.x * wb;
  front *= 0.8 + 0.32 * diff;
  col = mix(col, front, frontA);
  col += vec3(1.0, 0.93, 0.82) * spec * frontA * (0.06 + 0.12 * tens);

  // Vetas (filamento): líneas finas de grosor constante en pantalla.
  float capas = uPA.y * wa + uPB.y * wb;
  float grano = uQA.x * wa + uQB.x * wb;
  float N = 2.5 + capas * 1.2 + grano * 3.0;
  float fr = fract(d.a * N);
  float dist = min(fr, 1.0 - fr);
  float foot = length(vec2(gx.a / uOutRes.x, gy.a / uOutRes.y)) * N + 1e-5;
  float lw = mix(1.5, 0.85, tens) * foot;
  float line = 1.0 - smoothstep(lw * 0.5, lw * 1.5, dist);
  line *= (1.0 - smoothstep(0.1, 0.32, foot)) * smoothstep(0.03, 0.2, d.a);
  vec3 lineCol = mix(front, vec3(0.96, 0.9, 0.8), 0.4);
  col = mix(col, lineCol, line * frontA * 0.34);

  // Hilo común ámbar-crema: más visible donde las dos tintas se tocan.
  float inter = 4.0 * wa * wb * frontA;
  // Fuera de las masas el hilo es apenas una hebra tenue.
  float hv = smoothstep(0.03, 0.35, d.b) * (0.45 + 0.55 * uHiloPres);
  float glow = smoothstep(0.01, 0.25, db.b) * uHiloPres;
  float dentro = 0.3 + 0.7 * smoothstep(0.05, 0.6, frontA);
  col = mix(col, uHilo * 1.08, clamp(hv * dentro * (0.6 + 0.35 * inter), 0.0, 0.9));
  col += uHilo * glow * 0.08 * dentro;

  // Viñeta sutil y grano fino.
  vec2 vq = uv - 0.5;
  col *= 1.0 - 0.38 * smoothstep(0.32, 0.88, length(vq * vec2(1.0, 1.0)));
  col += (hash12(uv * uOutRes + fract(uTime * 0.37) * 91.0) - 0.5) * 0.028;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------- utilidades

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, t) => a + (b - a) * t;

function hexARgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function esMovil() {
  const ua = navigator.userAgent || '';
  const tactil = matchMedia('(pointer: coarse)').matches;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (tactil && Math.min(screen.width, screen.height) < 900);
}

function compilar(gl, tipo, fuente) {
  const sh = gl.createShader(tipo);
  gl.shaderSource(sh, fuente);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

class Programa {
  constructor(gl, vs, fs) {
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('Programa: ' + gl.getProgramInfoLog(p));
    }
    this.programa = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      this.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
  }
  usar() {
    this.gl.useProgram(this.programa);
    return this.u;
  }
}

function soportaRender(gl, interno, formato, tipo) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, interno, 4, 4, 0, formato, tipo, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return ok;
}

function formatoSoportado(gl, interno, formato, tipo) {
  if (soportaRender(gl, interno, formato, tipo)) return { interno, formato };
  if (interno === gl.R16F) return formatoSoportado(gl, gl.RG16F, gl.RG, tipo);
  if (interno === gl.RG16F) return formatoSoportado(gl, gl.RGBA16F, gl.RGBA, tipo);
  return null;
}

function detectarCapacidades(gl, esGL2) {
  let tipo = null;
  let lineal = false;
  if (esGL2) {
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    tipo = gl.HALF_FLOAT;
    lineal = true; // en WebGL2 las texturas de media precisión filtran linealmente
  } else {
    const hf = gl.getExtension('OES_texture_half_float');
    if (hf) {
      tipo = hf.HALF_FLOAT_OES;
      lineal = !!gl.getExtension('OES_texture_half_float_linear');
    } else if (gl.getExtension('OES_texture_float')) {
      tipo = gl.FLOAT;
      lineal = !!gl.getExtension('OES_texture_float_linear');
    }
  }
  if (!tipo) return null;
  let rgba, rg, r;
  if (esGL2) {
    rgba = formatoSoportado(gl, gl.RGBA16F, gl.RGBA, tipo);
    rg = formatoSoportado(gl, gl.RG16F, gl.RG, tipo);
    r = formatoSoportado(gl, gl.R16F, gl.RED, tipo);
  } else {
    rgba = rg = r = formatoSoportado(gl, gl.RGBA, gl.RGBA, tipo);
  }
  if (!rgba || !rg || !r) return null;
  const alta = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return { tipo, lineal, rgba, rg, r, precision: alta && alta.precision > 0 ? 'highp' : 'mediump' };
}

// ------------------------------------------------------------------- clase

export class FluidSim {
  constructor(canvas, { movimientoReducido = false } = {}) {
    this.canvas = canvas;
    const attrs = {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };
    let gl = canvas.getContext('webgl2', attrs);
    const esGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('sin WebGL');
    this.gl = gl;
    this.esGL2 = esGL2;
    this.cap = detectarCapacidades(gl, esGL2);
    if (!this.cap) throw new Error('sin texturas flotantes renderizables');

    this.movil = esMovil();
    this.calidad = this.movil
      ? { sim: 128, tinta: 512, iteraciones: 12, dpr: 1.5 }
      : { sim: 176, tinta: 1024, iteraciones: 24, dpr: 2 };
    this.reducido = movimientoReducido;
    this.escalaTiempo = movimientoReducido ? 1.9 : 1;
    this.movimiento = movimientoReducido ? 0.5 : 1;

    this.maxTextura = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    );

    this._geometria();
    this._programas();
    this._ajustarLienzo();
    this._framebuffers();

    this.sistema = null;
    this.tiempo = 0;
    this.corriendo = false;
    this.pausado = false;
    this.fase = 'separados';
    this._fps = { cuadros: 0, acum: 0, valor: 0, lentos: 0 };
    this._puntero = { activo: false, x: 0, y: 0, dx: 0, dy: 0, movido: false };
    this._enlazarPuntero();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.detener();
      if (this.alPerderContexto) this.alPerderContexto();
    });
  }

  // ----------------------------------------------------------- preparación

  _geometria() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.disable(gl.BLEND);
  }

  _programas() {
    const gl = this.gl;
    const pre = (defs = []) => `precision ${this.cap.precision} float;\nprecision mediump sampler2D;\n` +
      defs.map((d) => `#define ${d}\n`).join('');
    const manual = this.cap.lineal ? [] : ['MANUAL_FILTERING'];
    const vs = compilar(gl, gl.VERTEX_SHADER, VS_BASE);
    const fs = (src, defs = []) => compilar(gl, gl.FRAGMENT_SHADER, pre(defs) + src);
    const P = (src, defs) => new Programa(gl, vs, fs(src, defs));
    this.p = {
      copiar: P(FS_COPY),
      escalar: P(FS_SCALE),
      limpiar: P(FS_CLEAR),
      emitir: P(FS_EMIT),
      fuerza: P(FS_FORCE),
      advVel: P(FS_ADVECT, [...manual, 'VEL_VISC']),
      advTinta: P(FS_ADVECT, manual),
      divergencia: P(FS_DIVERGENCE),
      curl: P(FS_CURL),
      vorticidad: P(FS_VORTICITY),
      presion: P(FS_PRESSURE),
      gradiente: P(FS_GRADIENT),
      blur: P(FS_BLUR),
      pantalla: P(FS_DISPLAY, manual),
    };
  }

  _ajustarLienzo() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.calidad.dpr);
    const w = Math.max(1, Math.round((this.canvas.clientWidth || window.innerWidth) * dpr));
    const h = Math.max(1, Math.round((this.canvas.clientHeight || window.innerHeight) * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  get aspecto() {
    return this.canvas.width / this.canvas.height;
  }

  _resolucion(base) {
    let a = this.aspecto;
    if (a < 1) a = 1 / a;
    const min = Math.round(base);
    const max = Math.min(Math.round(base * a), this.maxTextura);
    return this.canvas.width >= this.canvas.height ? { w: max, h: min } : { w: min, h: max };
  }

  _fbo(w, h, fmt, filtro, tipo = this.cap.tipo) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.interno, w, h, 0, fmt.formato, tipo, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      tex,
      fbo,
      w,
      h,
      tx: 1 / w,
      ty: 1 / h,
      unir(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return id;
      },
    };
  }

  _doble(w, h, fmt, filtro) {
    let a = this._fbo(w, h, fmt, filtro);
    let b = this._fbo(w, h, fmt, filtro);
    return {
      w,
      h,
      tx: 1 / w,
      ty: 1 / h,
      get leer() { return a; },
      get escribir() { return b; },
      cambiar() { [a, b] = [b, a]; },
    };
  }

  _borrar(f) {
    if (!f) return;
    const gl = this.gl;
    for (const x of 'leer' in f ? [f.leer, f.escribir] : [f]) {
      gl.deleteTexture(x.tex);
      gl.deleteFramebuffer(x.fbo);
    }
  }

  // Redimensiona conservando el contenido.
  _redoble(viejo, w, h, fmt, filtro) {
    if (viejo && viejo.w === w && viejo.h === h) return viejo;
    const nuevo = this._doble(w, h, fmt, filtro);
    if (viejo) {
      const u = this.p.copiar.usar();
      this.gl.uniform2f(u.texelSize, 1 / w, 1 / h);
      this.gl.uniform1i(u.uTexture, viejo.leer.unir(0));
      this._dibujar(nuevo.leer);
      this._borrar(viejo);
    }
    return nuevo;
  }

  _framebuffers() {
    const gl = this.gl;
    const sim = this._resolucion(this.calidad.sim);
    const tin = this._resolucion(this.calidad.tinta);
    const filtro = this.cap.lineal ? gl.LINEAR : gl.NEAREST;
    this.tinta = this._redoble(this.tinta, tin.w, tin.h, this.cap.rgba, filtro);
    this.velocidad = this._redoble(this.velocidad, sim.w, sim.h, this.cap.rg, filtro);
    this._borrar(this.divergencia);
    this._borrar(this.curl);
    this._borrar(this.presion);
    this.divergencia = this._fbo(sim.w, sim.h, this.cap.r, gl.NEAREST);
    this.curl = this._fbo(sim.w, sim.h, this.cap.r, gl.NEAREST);
    this.presion = this._doble(sim.w, sim.h, this.cap.r, gl.NEAREST);
    const bw = Math.max(32, Math.round(tin.w / 4));
    const bh = Math.max(32, Math.round(tin.h / 4));
    this._borrar(this.blurA);
    this._borrar(this.blurB);
    this.blurA = this._fbo(bw, bh, this.cap.rgba, filtro);
    this.blurB = this._fbo(bw, bh, this.cap.rgba, filtro);
  }

  _dibujar(destino) {
    const gl = this.gl;
    if (!destino) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, destino.w, destino.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, destino.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  _limpiarTodo() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    for (const f of [this.tinta, this.velocidad, this.presion]) {
      for (const x of [f.leer, f.escribir]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, x.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    for (const x of [this.blurA, this.blurB, this.divergencia, this.curl]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, x.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  // ------------------------------------------------------------- interacción

  _enlazarPuntero() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    };
    c.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      Object.assign(this._puntero, { activo: true, x, y, dx: 0, dy: 0, movido: false });
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const pt = this._puntero;
      if (!pt.activo) return;
      const [x, y] = pos(e);
      pt.dx += x - pt.x;
      pt.dy += y - pt.y;
      pt.x = x;
      pt.y = y;
      pt.movido = true;
    });
    const fin = () => { this._puntero.activo = false; };
    c.addEventListener('pointerup', fin);
    c.addEventListener('pointercancel', fin);
    c.addEventListener('pointerleave', fin);
  }

  // ---------------------------------------------------------------- control

  definirSistema(sistema) {
    this.sistema = sistema;
    this.tiempo = 0;
    this.angulo = 0;
    this._fps.lentos = 0;
    const rng = mulberry32(sistema.seed);
    this.rng = rng;
    this.giro = rng() < 0.5 ? -1 : 1;
    this.corte = rng() < 0.5 ? -1 : 1;
    this.semillaShader = (sistema.seed % 1000) / 10;
    const emisores = (f) => [0, 1, 2].map((k) => ({ fase: f.fase * 6.283 + k * 2.094 + rng() * 0.8, radio: 0.12 + 0.07 * k + rng() * 0.05 }));
    this.emA = emisores(sistema.a);
    this.emB = emisores(sistema.b);
    this.gotaA = 0.4 + rng() * 0.6;
    this.gotaB = 0.7 + rng() * 0.6;
    this.colores = {};
    for (const [k, f] of [['A', sistema.a], ['B', sistema.b]]) {
      this.colores[k] = [f.paleta.principal, f.paleta.secundario, f.paleta.profundo].map(hexARgb);
    }
    this.colores.hilo = hexARgb(sistema.hiloComun.color);
    this._limpiarTodo();
  }

  iniciar() {
    if (this.corriendo) return;
    this.corriendo = true;
    this.pausado = false;
    this._ultimo = performance.now();
    const bucle = (ahora) => {
      if (!this.corriendo) return;
      this._raf = requestAnimationFrame(bucle);
      let dt = (ahora - this._ultimo) / 1000;
      this._ultimo = ahora;
      if (this.pausado || document.hidden || !this.sistema) return;
      this._medir(dt);
      dt = Math.min(dt, 1 / 30);
      if (this._ajustarLienzo()) this._framebuffers();
      this.tiempo += dt;
      this._paso(dt);
      this._actualizarBlur();
      this._render(null, this.canvas.width, this.canvas.height, false);
    };
    this._raf = requestAnimationFrame(bucle);
  }

  detener() {
    this.corriendo = false;
    cancelAnimationFrame(this._raf);
  }

  pausar(p) {
    this.pausado = p;
    this._ultimo = performance.now();
  }

  // Resolución adaptativa: si va lento, baja iteraciones y luego densidad de píxeles.
  _medir(dt) {
    const f = this._fps;
    f.cuadros++;
    f.acum += dt;
    if (f.acum < 1.5) return;
    f.valor = Math.round(f.cuadros / f.acum);
    // Menos de ~10 fps suele ser el navegador estrangulando una pestaña oculta,
    // no la GPU: en ese caso no se toca la calidad.
    const lento = f.valor < 40 && f.valor >= 10 && this.tiempo > 2;
    f.lentos = lento ? f.lentos + 1 : 0;
    if (f.lentos >= 2) {
      f.lentos = 0;
      const q = this.calidad;
      const piso = this.movil ? 8 : 12;
      if (q.iteraciones > piso) q.iteraciones = Math.max(piso, Math.round(q.iteraciones * 0.75));
      else if (q.dpr > 1) q.dpr = Math.max(1, q.dpr - 0.25);
    }
    f.cuadros = 0;
    f.acum = 0;
  }

  info() {
    const q = this.calidad;
    return {
      fase: this.fase,
      tiempo: this.tiempo,
      fps: this._fps.valor,
      resumen: `${this.esGL2 ? 'WebGL2' : 'WebGL1'} · ${this.cap.precision} · sim ${this.velocidad.w}×${this.velocidad.h} · tinta ${this.tinta.w}×${this.tinta.h} · jacobi ${q.iteraciones}${this.cap.lineal ? '' : ' · filtrado manual'}${this.reducido ? ' · movimiento reducido' : ''}`,
    };
  }

  // ------------------------------------------------------------- coreografía

  _coreografia(dt) {
    const s = this.sistema;
    const A = s.a;
    const B = s.b;
    const sint = s.sintonia;
    const t = this.tiempo;
    const tt = t / this.escalaTiempo;
    const mov = this.movimiento;
    const D = DURACION;

    const wSep = 1 - smooth(D.separados[1], D.separados[2], tt);
    const wMeet = smooth(D.encuentro[0], D.encuentro[1], tt) * (1 - smooth(D.encuentro[2], D.encuentro[3], tt));
    const wMix = smooth(D.mezcla[0], D.mezcla[1], tt) * (1 - smooth(D.mezcla[2], D.mezcla[3], tt));
    const wHarm = smooth(D.armonia[0], D.armonia[1], tt);
    const pesos = { separados: wSep, encuentro: wMeet, mezcla: wMix, armonia: wHarm };
    this.fase = Object.entries(pesos).sort((x, y) => y[1] - x[1])[0][0];

    const aspecto = this.aspecto;
    const eje = aspecto >= 1 ? [1, 0] : [0, 1];
    const perp = [-eje[1], eje[0]];
    const L = 0.5 * Math.max(aspecto, 1);
    const W = 0.5 * Math.min(aspecto, 1);
    const R = Math.min(L * 0.52, W * 0.85);

    const sep = L * (0.44 * wSep + 0.22 * wMeet + 0.12 * wMix + (0.17 - 0.09 * sint) * wHarm);
    this.angulo += (dt / this.escalaTiempo) * mov * (wMix * 0.12 + wHarm * (0.08 + 0.2 * sint)) * this.giro;
    const ca = Math.cos(this.angulo);
    const sa = Math.sin(this.angulo);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const cA = rot(-sep, 0);
    const cB = rot(sep, 0);

    const vaiven = (f, ph) => {
      const d = f.corriente.deriva;
      return 1 - d + d * Math.tanh(3 * Math.sin(tt * 0.37 + ph));
    };
    const spinA = (0.45 + 1.2 * A.corriente.velocidad) * this.giro * vaiven(A, A.fase * 6.28) * mov;
    const spinB = -(0.45 + 1.2 * B.corriente.velocidad) * this.giro * vaiven(B, B.fase * 6.28 + 1.7) * mov;
    const vMedia = (A.corriente.velocidad + B.corriente.velocidad) / 2;
    const spinShared = (0.3 + 0.35 * vMedia) * this.giro * mov;
    const shear = (0.1 + 0.12 * vMedia) * this.corte * mov;

    // q → uv
    const aUv = (q) => {
      const px = q[0] * eje[0] + q[1] * perp[0];
      const py = q[0] * eje[1] + q[1] * perp[1];
      return [px / aspecto + 0.5, py + 0.5];
    };

    const simH = this.velocidad.h; // 1 unidad de p = alto completo del lienzo
    const emV = [];
    const emT = [];
    const valV = [];
    const valT = [];
    const pres = s.hiloComun.presencia;
    const arranque = 1 + 1.6 * (1 - smooth(0, 2.2, tt));
    const ritmoEmision = (wSep * 1.0 + wMeet * 0.8 + wMix * 0.6 + wHarm * 0.42) * arranque;

    const emitirTinta = (f, centro, ems, canal, spin) => {
      const rate = (0.7 + 1.1 * f.densidad) * ritmoEmision;
      const r2 = Math.pow(0.03 + 0.035 * (1 - f.tensionSuperficial), 2);
      const omega = (0.25 + 0.6 * f.corriente.velocidad) * Math.sign(spin) * mov;
      for (const e of ems) {
        const th = e.fase + tt * omega;
        const q = [centro[0] + R * e.radio * Math.cos(th), centro[1] + R * e.radio * Math.sin(th) * 0.9];
        const uv = aUv(q);
        e.uv = uv;
        e.r2 = r2;
        emT.push(uv[0], uv[1], r2, 0);
        const v = rate * dt;
        valT.push(canal === 0 ? v : 0, canal === 1 ? v : 0, v * 0.05 * pres, dt * 0.25);
        // empuje tangencial (aceleración)
        const tq = [-Math.sin(th) * Math.sign(spin), Math.cos(th) * Math.sign(spin)];
        const tx = tq[0] * eje[0] + tq[1] * perp[0];
        const ty = tq[0] * eje[1] + tq[1] * perp[1];
        const acc = (0.15 + 0.35 * f.corriente.velocidad) * mov * simH * dt;
        emV.push(uv[0], uv[1], r2 * 2.5, 0);
        valV.push(tx * acc, ty * acc, 0, 0);
      }
    };
    emitirTinta(A, cA, this.emA, 0, spinA || 1);
    emitirTinta(B, cB, this.emB, 1, spinB || -1);

    // Gotas: pulsos que dejan anillos en el filamento (suminagashi).
    const gota = (f, ems, canal, clave) => {
      if (t < this[clave]) return;
      const e = ems[Math.floor(this.rng() * ems.length)];
      const amp = (0.6 + 0.5 * f.densidad) * (0.5 + 0.5 * wSep + 0.3);
      emT.push(e.uv[0], e.uv[1], e.r2 * 2.4, 0);
      valT.push(canal === 0 ? amp : 0, canal === 1 ? amp : 0, 0.12 * pres, 0.45 + this.rng() * 0.7);
      this[clave] = t + ((1.1 + this.rng() * 1.8) / (0.6 + 0.8 * f.corriente.velocidad)) * this.escalaTiempo;
    };
    gota(A, this.emA, 0, 'gotaA');
    gota(B, this.emB, 1, 'gotaB');

    // Hilo común: dos hebras que cruzan ambas masas desde el encuentro.
    const wHilo = (wMeet * 0.7 + wMix + wHarm) * pres;
    if (wHilo > 0.01) {
      const m = mov * (0.6 + 0.4 * vMedia);
      for (const signo of [1, -1]) {
        const q = [
          signo * Math.min(L * 0.3, R * 0.95) * Math.sin(tt * 0.29 * m + this.semillaShader),
          R * 0.6 * Math.sin(tt * 0.47 * m + signo * 1.3 + this.semillaShader),
        ];
        const uv = aUv(rot(q[0], q[1]));
        emT.push(uv[0], uv[1], 0.00007, 0);
        valT.push(0, 0, 9 * wHilo * dt, 0.12 * dt);
      }
    }

    // Puntero: remueve con suavidad, solo velocidad.
    const pt = this._puntero;
    if (pt.movido) {
      const k = 0.55 * simH;
      const vx = Math.max(-0.08, Math.min(0.08, pt.dx)) * aspecto;
      const vy = Math.max(-0.08, Math.min(0.08, pt.dy));
      emV.push(pt.x, pt.y, 0.004, 0);
      valV.push((vx * k) / Math.max(dt, 1 / 120) * 0.6, (vy * k) / Math.max(dt, 1 / 120) * 0.6, 0, 0);
      pt.dx = 0;
      pt.dy = 0;
      pt.movido = false;
    }

    return {
      pesos: [wSep, wMeet, wMix, wHarm],
      eje,
      cA,
      cB,
      R,
      spinA,
      spinB,
      spinShared,
      shear,
      simH,
      emV,
      valV,
      emT,
      valT,
    };
  }

  // ----------------------------------------------------------------- paso

  _emitir(destino, em, val) {
    const n = em.length / 4;
    if (!n) return;
    const gl = this.gl;
    const u = this.p.emitir.usar();
    gl.uniform2f(u.texelSize, destino.tx, destino.ty);
    gl.uniform1i(u.uTarget, destino.leer.unir(0));
    gl.uniform1f(u.uAspect, this.aspecto);
    gl.uniform1i(u.uCount, Math.min(n, MAX_EMISORES));
    gl.uniform4fv(u.uEmit, new Float32Array(em.slice(0, MAX_EMISORES * 4)));
    gl.uniform4fv(u.uVal, new Float32Array(val.slice(0, MAX_EMISORES * 4)));
    this._dibujar(destino.escribir);
    destino.cambiar();
  }

  _paso(dt) {
    const gl = this.gl;
    const s = this.sistema;
    const A = s.a;
    const B = s.b;
    const c = this._coreografia(dt);
    const vel = this.velocidad;
    const tin = this.tinta;
    const escalaRes = vel.h / 128;
    let u;

    // 1. Campo de fuerzas
    u = this.p.fuerza.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uVelocity, vel.leer.unir(0));
    gl.uniform1i(u.uDye, tin.leer.unir(1));
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uTime, this.tiempo / this.escalaTiempo);
    gl.uniform1f(u.uAspect, this.aspecto);
    gl.uniform1f(u.uSimH, c.simH);
    gl.uniform1f(u.uRelax, 1.2);
    gl.uniform2f(u.uAxis, c.eje[0], c.eje[1]);
    gl.uniform4f(u.uW, ...c.pesos);
    gl.uniform2f(u.uCA, c.cA[0], c.cA[1]);
    gl.uniform2f(u.uCB, c.cB[0], c.cB[1]);
    gl.uniform1f(u.uSpinA, c.spinA);
    gl.uniform1f(u.uSpinB, c.spinB);
    gl.uniform1f(u.uSpinShared, c.spinShared);
    gl.uniform1f(u.uR, c.R);
    gl.uniform1f(u.uSint, s.sintonia);
    gl.uniform1f(u.uShear, c.shear);
    gl.uniform2f(u.uTurb, A.corriente.turbulencia, B.corriente.turbulencia);
    gl.uniform2f(u.uDrift, A.corriente.deriva, B.corriente.deriva);
    gl.uniform1f(u.uNoiseAmp, 0.14 * this.movimiento);
    gl.uniform1f(u.uSeed, this.semillaShader);
    this._dibujar(vel.escribir);
    vel.cambiar();

    // 2. Emisores
    this._emitir(vel, c.emV, c.valV);
    this._emitir(tin, c.emT, c.valT);

    // 3. Vorticidad
    u = this.p.curl.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uVelocity, vel.leer.unir(0));
    this._dibujar(this.curl);

    u = this.p.vorticidad.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uVelocity, vel.leer.unir(0));
    gl.uniform1i(u.uCurl, this.curl.unir(1));
    gl.uniform1i(u.uDye, tin.leer.unir(2));
    const curlDe = (f) => (3 + 26 * f.corriente.turbulencia) * escalaRes * this.movimiento;
    gl.uniform2f(u.uCurlAB, curlDe(A), curlDe(B));
    gl.uniform1f(u.dt, dt);
    this._dibujar(vel.escribir);
    vel.cambiar();

    // 4. Proyección (incompresibilidad)
    u = this.p.divergencia.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uVelocity, vel.leer.unir(0));
    this._dibujar(this.divergencia);

    u = this.p.escalar.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uTexture, this.presion.leer.unir(0));
    gl.uniform1f(u.uValue, 0.8);
    this._dibujar(this.presion.escribir);
    this.presion.cambiar();

    u = this.p.presion.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uDivergence, this.divergencia.unir(0));
    for (let i = 0; i < this.calidad.iteraciones; i++) {
      gl.uniform1i(u.uPressure, this.presion.leer.unir(1));
      this._dibujar(this.presion.escribir);
      this.presion.cambiar();
    }

    u = this.p.gradiente.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform1i(u.uPressure, this.presion.leer.unir(0));
    gl.uniform1i(u.uVelocity, vel.leer.unir(1));
    this._dibujar(vel.escribir);
    vel.cambiar();

    // 5. Advección de velocidad (viscosidad por tinta) y de tinta
    u = this.p.advVel.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform2f(u.dyeTexelSize, vel.tx, vel.ty);
    const v0 = vel.leer.unir(0);
    gl.uniform1i(u.uVelocity, v0);
    gl.uniform1i(u.uSource, v0);
    gl.uniform1i(u.uDye, tin.leer.unir(1));
    gl.uniform1f(u.dt, dt);
    gl.uniform4f(u.uDiss, 0.3, 0.3, 0.3, 0.3);
    const visc = (f) => 0.12 + 1.4 * f.viscosidad;
    gl.uniform2f(u.uViscAB, visc(A), visc(B));
    this._dibujar(vel.escribir);
    vel.cambiar();

    u = this.p.advTinta.usar();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    gl.uniform2f(u.dyeTexelSize, tin.tx, tin.ty);
    gl.uniform1i(u.uVelocity, vel.leer.unir(0));
    gl.uniform1i(u.uSource, tin.leer.unir(1));
    gl.uniform1f(u.dt, dt);
    const persistencia = (f) => 0.04 + 0.3 * (1 - f.densidad);
    gl.uniform4f(u.uDiss, persistencia(A), persistencia(B), 0.16, 0.035);
    this._dibujar(tin.escribir);
    tin.cambiar();
  }

  _actualizarBlur() {
    const gl = this.gl;
    let u = this.p.copiar.usar();
    gl.uniform2f(u.texelSize, this.blurA.tx, this.blurA.ty);
    gl.uniform1i(u.uTexture, this.tinta.leer.unir(0));
    this._dibujar(this.blurA);
    u = this.p.blur.usar();
    gl.uniform2f(u.texelSize, this.blurA.tx, this.blurA.ty);
    for (let i = 0; i < 2; i++) {
      const paso = 1 + i;
      gl.uniform2f(u.uDir, this.blurA.tx * paso, 0);
      gl.uniform1i(u.uTexture, this.blurA.unir(0));
      this._dibujar(this.blurB);
      gl.uniform2f(u.uDir, 0, this.blurA.ty * paso);
      gl.uniform1i(u.uTexture, this.blurB.unir(0));
      this._dibujar(this.blurA);
    }
  }

  _render(destino, w, h, exportar) {
    const gl = this.gl;
    const s = this.sistema;
    const u = this.p.pantalla.usar();
    const tin = this.tinta;
    gl.uniform2f(u.texelSize, 1 / w, 1 / h);
    gl.uniform1i(u.uDye, tin.leer.unir(0));
    gl.uniform1i(u.uBlur, this.blurA.unir(1));
    gl.uniform2f(u.uDyeTexel, tin.tx, tin.ty);
    gl.uniform2f(u.uBlurTexel, this.blurA.tx, this.blurA.ty);
    gl.uniform2f(u.uOutRes, w, h);
    gl.uniform1f(u.uAspect, w / h);
    gl.uniform1f(u.uSeed, this.semillaShader);
    gl.uniform1f(u.uTime, exportar ? 0 : this.tiempo);
    gl.uniform1f(u.uBicubic, exportar ? 1 : 0);
    gl.uniform1f(u.uHiloPres, s.hiloComun.presencia);
    const [a0, a1, a2] = this.colores.A;
    const [b0, b1, b2] = this.colores.B;
    gl.uniform3f(u.uA0, ...a0);
    gl.uniform3f(u.uA1, ...a1);
    gl.uniform3f(u.uA2, ...a2);
    gl.uniform3f(u.uB0, ...b0);
    gl.uniform3f(u.uB1, ...b1);
    gl.uniform3f(u.uB2, ...b2);
    gl.uniform3f(u.uHilo, ...this.colores.hilo);
    gl.uniform3f(u.uBg, 14 / 255, 11 / 255, 9 / 255);
    const P = (f) => [f.tensionSuperficial, f.profundidad.capas, f.profundidad.transparencia, f.profundidad.desenfoque];
    const Q = (f) => [f.grano, f.densidad, f.contraste, f.temperatura];
    gl.uniform4f(u.uPA, ...P(s.a));
    gl.uniform4f(u.uPB, ...P(s.b));
    gl.uniform4f(u.uQA, ...Q(s.a));
    gl.uniform4f(u.uQB, ...Q(s.b));
    this._dibujar(destino);
  }

  // Renderiza el estado actual en un framebuffer fuera de pantalla y devuelve los píxeles.
  renderizarExportacion(w, h) {
    const gl = this.gl;
    const destino = this._fbo(w, h, { interno: gl.RGBA, formato: gl.RGBA }, gl.LINEAR, gl.UNSIGNED_BYTE);
    this._render(destino, w, h, true);
    const pixeles = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, destino.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixeles);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._borrar(destino);
    return { pixeles, w, h };
  }
}
