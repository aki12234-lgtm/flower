// Plasticine: a stop-motion set, photographed.
//
// Plasticine is read from forms and light, not from marks. Everything is a fat
// rounded solid (a rolled coil, a ball pressed a little flat) in one soft
// chalky colour, sitting in real depth under a big soft studio lamp: shading
// turns slowly right round each form, every piece lays a soft shadow on what
// is near it, it goes dark and warm where two pieces meet, and the lens is a
// real one, so what is far off goes soft. The surface is matte with a broad
// faint sheen, gently uneven where it was smoothed with a thumb, with a fine
// tooth to it.
//
// So this look builds its own set, in three dimensions, out of such pieces:
// a rounded ground in the place's colours, hills going back, trees, stones,
// cacti, coral, clouds all the way up the column; and the plant in front as
// rolled coils, petals pressed from balls, a bead for each heart. Each piece is
// ray-traced as the exact solid it is (a capsule or an ellipsoid) inside a box
// drawn for it, so it is perfectly round at any size, and then the whole set is
// lit at once: a shadow map from the lamp, ambient occlusion from the depth,
// a cool fill and a warm bounce, and depth of field on the way out.
//
// It moves as a model does, a frame at a time.

import { Renderer2D } from '../flat/renderer2d.js';
import { stemColour, flowerHueFor, bloomColour, PIGMENT, PLACES } from '../gl/scene.js';
import { makeRng } from '../rng.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mixn = (a, b, t) => a + (b - a) * t;
const FOV = 0.62;          // a normal lens, not the flat look's long one: the set has depth
const NEAR = 30, FAR = 30000;
const SHADOW = 2048;

// ------------------------------------------------------------ colour ------

function rgbOf(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
/** A stick of plasticine: chalk in it, so never very dark and never a pure hue. */
function stick(rgb, soft = 0.16) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((q) => clamp(mixn(mixn(l, q, 0.86), 0.92, soft), 0.06, 0.95));
}
const stickHsl = (c) => stick(rgbOf(c.h, clamp(c.s, 42, 80), clamp(c.l + 6, 42, 62)), 0.12);
const shade = (rgb, k) => rgb.map((q) => clamp(q * k, 0, 1));
const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// ------------------------------------------------------------ vectors -----

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function lookAt(eye, at, up) {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function perspective(fov, aspect, n, f) {
  const t = 1 / Math.tan(fov / 2);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
}
function ortho(s, n, f) {
  return [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1];
}
function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function mat4inv(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map((v) => v / (det || 1));
}

// ------------------------------------------------------------- pieces -----

/** Solids, sixteen numbers each: centre, three vectors, colour and kind. */
class Solids {
  constructor() { this.d = []; this.n = 0; }
  /** A rolled coil from a to b, r thick, round at both ends. */
  coil(a, b, r, c) {
    this.d.push(...mul(add(a, b), 0.5), ...mul(sub(b, a), 0.5), r, 0, 0, 0, 0, 0, c[0], c[1], c[2], 0); this.n++;
  }
  /** A ball pressed into shape: centre and its three half-axes. */
  lump(c, A, B, C, col) { this.d.push(...c, ...A, ...B, ...C, col[0], col[1], col[2], 1); this.n++; }
  ball(c, r, col, sx = 1, sy = 1, sz = 1) { this.lump(c, [r * sx, 0, 0], [0, r * sy, 0], [0, 0, r * sz], col); }
}

// ------------------------------------------------------------- shaders ----

const NOISE = `
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const SOLID_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aCorner;
layout(location = 1) in vec3 iC;
layout(location = 2) in vec3 iU;
layout(location = 3) in vec3 iV;
layout(location = 4) in vec3 iW;
layout(location = 5) in vec4 iCol;
uniform mat4 uViewProj;
out vec3 vWorld;
flat out vec3 vC; flat out vec3 vU; flat out float vR; flat out vec4 vCol; flat out mat3 vInv; flat out float vSize;
void main() {
  vec3 X, Y, Z;
  if (iCol.a < 0.5) {
    float r = iV.x; float l = length(iU);
    vec3 d = l > 1e-4 ? iU / l : vec3(0.0, 1.0, 0.0);
    vec3 p = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 e1 = normalize(cross(d, p)); vec3 e2 = cross(d, e1);
    X = d * (l + r); Y = e1 * r; Z = e2 * r;
    vInv = mat3(1.0);
  } else {
    X = iU; Y = iV; Z = iW;
    vInv = inverse(mat3(iU, iV, iW));
  }
  vC = iC; vU = iU; vR = iV.x; vCol = iCol;
  vSize = length(X) + length(Y) + length(Z);
  vec3 w = iC + X * aCorner.x * 1.02 + Y * aCorner.y * 1.02 + Z * aCorner.z * 1.02;
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

const solidFS = (shadow) => `#version 300 es
precision highp float;
in vec3 vWorld;
flat in vec3 vC; flat in vec3 vU; flat in float vR; flat in vec4 vCol; flat in mat3 vInv; flat in float vSize;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec3 uRayDir;
uniform float uOrtho;
uniform float uPixel;     // how wide a pixel is, per unit of distance
${shadow ? '' : 'layout(location = 0) out vec4 oAlbedo;\nlayout(location = 1) out vec4 oNormal;'}
${NOISE}
float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) {
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  float h = b * b - a * c;
  if (h >= 0.0 && a > 1e-6) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
  }
  vec3 oc = ro - pa; b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c;
  float t0 = h > 0.0 ? -b - sqrt(h) : -1.0;
  oc = ro - pb; b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c;
  float t1 = h > 0.0 ? -b - sqrt(h) : -1.0;
  if (t0 < 0.0) return t1;
  if (t1 < 0.0) return t0;
  return min(t0, t1);
}
void main() {
  vec3 rd = uOrtho > 0.5 ? uRayDir : normalize(vWorld - uEye);
  vec3 ro = vWorld - rd * vSize * 2.2;
  float t; vec3 n;
  if (vCol.a < 0.5) {
    vec3 pa = vC - vU, pb = vC + vU;
    t = capsule(ro, rd, pa, pb, vR);
    if (t < 0.0) discard;
    vec3 p = ro + rd * t;
    vec3 ba = pb - pa;
    float k = clamp(dot(p - pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    n = (p - pa - ba * k) / vR;
  } else {
    vec3 o = vInv * (ro - vC), d = vInv * rd;
    float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
    float h = b * b - a * c;
    if (h < 0.0) discard;
    t = (-b - sqrt(h)) / a;
    vec3 q = o + d * t;
    n = normalize(transpose(vInv) * q);
  }
  vec3 p = ro + rd * t;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
${shadow ? '' : `
  // The surface of the stuff: smoothed with a thumb, so gently uneven, with a
  // fine tooth that only shows close to. Fixed to the piece, not the screen.
  float far = length(p - uEye) * uPixel;
  float e = 1.2;
  vec3 q = p + vCol.rgb * 97.0;
  #define DENT(x) (n3((x) * 0.020) * 7.0 + n3((x) * 0.055 + 11.0) * 2.2)
  #define TOOTH(x) (n3((x) * 0.16) * 0.55 + n3((x) * 0.37 + 5.0) * 0.18)
  float d0 = DENT(q), g0 = TOOTH(q);
  vec3 grad = vec3(DENT(q + vec3(e, 0, 0)) - d0, DENT(q + vec3(0, e, 0)) - d0, DENT(q + vec3(0, 0, e)) - d0) / e;
  vec3 gt = vec3(TOOTH(q + vec3(e, 0, 0)) - g0, TOOTH(q + vec3(0, e, 0)) - g0, TOOTH(q + vec3(0, 0, e)) - g0) / e;
  grad += gt * (1.0 - smoothstep(0.9, 2.4, far));
  grad -= n * dot(grad, n);
  n = normalize(n - grad * 1.25);
  // a little more or less chalk in one handful than the next
  float tint = 0.95 + 0.10 * n3(q * 0.012);
  oAlbedo = vec4(vCol.rgb * tint, 1.0);
  oNormal = vec4(n * 0.5 + 0.5, 1.0);`}
}`;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const LIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAlbedo, uNormal, uDepth, uShadow;
uniform mat4 uInvViewProj, uViewProj, uLightViewProj;
uniform vec3 uEye, uL;
uniform vec2 uRes;
uniform float uFocus, uCocK, uNight, uTake;
uniform vec3 uWallTop, uWallLow, uLamp, uSky, uBounce;
out vec4 outColour;
${NOISE}
float linearZ(float d) { float z = d * 2.0 - 1.0; return (2.0 * ${NEAR.toFixed(1)} * ${FAR.toFixed(1)}) / (${FAR.toFixed(1)} + ${NEAR.toFixed(1)} - z * (${FAR.toFixed(1)} - ${NEAR.toFixed(1)})); }
vec3 worldAt(vec2 uv, float d) {
  vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return w.xyz / w.w;
}
const vec2 POISSON[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
void main() {
  float d = texture(uDepth, vUv).r;
  float jit = 0.37;
  if (d >= 0.99999) {
    // the painted sweep behind the set, lit brighter in the middle
    vec3 rd = normalize(worldAt(vUv, 1.0) - uEye);
    float up = clamp(rd.y * 1.6 + 0.5, 0.0, 1.0);
    vec3 wall = mix(uWallLow, uWallTop, up);
    wall *= 0.92 + 0.10 * n3(rd * 7.0);
    float pool = 1.0 - smoothstep(0.0, 0.9, length((vUv - vec2(0.45, 0.62)) * vec2(1.0, 1.3)));
    wall = pow(wall, vec3(2.2)) * (0.78 + 0.42 * pool);
    outColour = vec4(wall, 1.0);
    return;
  }
  vec3 p = worldAt(vUv, d);
  vec3 n = normalize(texture(uNormal, vUv).xyz * 2.0 - 1.0);
  vec3 albedo = pow(texture(uAlbedo, vUv).rgb, vec3(2.2));
  vec3 V = normalize(uEye - p);
  float dist = length(uEye - p);

  // the lamp's shadow, soft: it is a big lamp
  vec4 ls = uLightViewProj * vec4(p + n * 2.5, 1.0);
  vec3 lp = ls.xyz / ls.w * 0.5 + 0.5;
  float lit = 1.0;
  if (lp.x > 0.0 && lp.x < 1.0 && lp.y > 0.0 && lp.y < 1.0 && lp.z < 1.0) {
    lit = 0.0;
    float a = jit * 6.2832; mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    for (int i = 0; i < 12; i++) {
      vec2 o = rot * POISSON[i] * (4.0 / ${SHADOW.toFixed(1)});
      lit += lp.z - 0.0012 <= texture(uShadow, lp.xy + o).r ? 1.0 : 0.0;
    }
    lit /= 12.0;
  }

  // dark where pieces meet: occlusion from the depth around the point
  float occ = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i) + jit;
    vec3 s = normalize(vec3(h21(vec2(fi, 1.3)) * 2.0 - 1.0, h21(vec2(fi, 7.1)) * 2.0 - 1.0, h21(vec2(fi, 3.7)) * 2.0 - 1.0));
    if (dot(s, n) < 0.0) s = -s;
    float rad = mix(6.0, 60.0, fract(fi * 0.618)) ;
    vec3 q = p + n * 1.5 + s * rad;
    vec4 c = uViewProj * vec4(q, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float sceneZ = linearZ(texture(uDepth, uv).r);
    float qZ = linearZ(c.z / c.w * 0.5 + 0.5);
    float diff = qZ - sceneZ;
    occ += diff > 1.0 ? smoothstep(0.0, 1.0, rad * 2.0 / diff) : 0.0;
  }
  float ao = 1.0 - occ / 14.0 * 0.85;
  ao = ao * ao;

  vec3 L = normalize(uL);
  float ndl = dot(n, L);
  float wrap = clamp((ndl + 0.30) / 1.30, 0.0, 1.0);
  vec3 col = albedo * uLamp * wrap * lit * 1.55;
  // light goes a little way into it: the edge of the light is warm and full of colour
  col += albedo * albedo * vec3(1.0, 0.60, 0.45) * wrap * (1.0 - wrap) * 1.2 * mix(0.4, 1.0, lit);
  // the room: cool from above, warm back up off the ground
  vec3 amb = mix(uBounce, uSky, n.y * 0.5 + 0.5);
  col += albedo * amb * 0.62 * ao;
  col *= mix(1.0, ao, 0.45);
  // a broad faint sheen, as on anything smoothed by hand
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  col += uLamp * pow(ndh, 18.0) * 0.07 * lit;
  col += albedo * uSky * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.25 * ao;
  // far off, the air of the studio
  col = mix(col, pow(uWallLow, vec3(2.2)) * 0.9, smoothstep(2500.0, 9000.0, dist) * 0.45);
  outColour = vec4(col, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uLit, uDepth;
uniform vec2 uRes;
uniform float uFocus, uCocK, uCocMax, uTake;
out vec4 outColour;
${NOISE}
float linearZ(float d) { float z = d * 2.0 - 1.0; return (2.0 * ${NEAR.toFixed(1)} * ${FAR.toFixed(1)}) / (${FAR.toFixed(1)} + ${NEAR.toFixed(1)} - z * (${FAR.toFixed(1)} - ${NEAR.toFixed(1)})); }
/** Circle of confusion in pixels: positive behind the focus, negative in front of it. */
float coc(vec2 uv) {
  float z = linearZ(texture(uDepth, uv).r);
  return clamp((z - uFocus) / z * uCocK, -uCocMax, uCocMax);
}
vec3 tone(vec3 c) {
  c = c / (1.0 + c * 0.55);
  return pow(c, vec3(1.0 / 2.2));
}
void main() {
  vec2 px = 1.0 / uRes;
  float c0 = coc(vUv);
  vec3 sum = texture(uLit, vUv).rgb * 0.36
    + (texture(uLit, vUv + px * vec2(0.6, 0.6)).rgb + texture(uLit, vUv + px * vec2(-0.6, 0.6)).rgb
     + texture(uLit, vUv + px * vec2(0.6, -0.6)).rgb + texture(uLit, vUv + px * vec2(-0.6, -0.6)).rgb) * 0.16;
  float wsum = 1.0;
  float R = uCocMax;
  for (int i = 0; i < 32; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 32.0) * R;
    float a = fi * 2.39996;
    vec2 o = vec2(cos(a), sin(a)) * r;
    vec2 uv = vUv + o * px;
    float cs = coc(uv);
    // what is behind cannot spill over what is in front of it
    float reach = cs > 0.0 ? min(cs, abs(c0) + 0.5) : -cs;
    float w = smoothstep(r - 1.0, r + 0.5, reach);
    sum += texture(uLit, uv).rgb * w; wsum += w;
  }
  vec3 col = tone(sum / wsum);
  // a gentle warm grade and the lens's own fall-off
  col = mix(col, col * vec3(1.03, 1.0, 0.95), 0.6);
  float v = length((vUv - 0.5) * vec2(1.0, 1.1));
  col *= 1.0 - smoothstep(0.42, 1.0, v) * 0.32;
  col += (h21(gl_FragCoord.xy) - 0.5) * 0.006;
  outColour = vec4(col, 1.0);
}`;

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  const loc = {};
  p.u = (name) => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(p, name)));
  return p;
}

// ----------------------------------------------------------------- set ----

/**
 * The set for a place, in its colours: a rounded ground, hills going back,
 * things standing about, and clouds (or bubbles, or rock) all the way up.
 * Built once per place. The plant stands at x 0, z 0, and grows up the y axis.
 */
function buildSet(kind) {
  const place = PLACES[kind % PLACES.length];
  const toon = place.toon;
  const ink = Object.fromEntries(toon.inks.map(([n, c]) => [n, stick(hex(c))]));
  const inks = toon.inks.map(([, c]) => stick(hex(c)));
  const ground = stick(hex(toon.ground));
  const rng = makeRng(7001 + kind * 131);
  const R = (a, b) => a + (b - a) * rng();
  const S = new Solids();
  const id = place.id;
  const any = (...names) => names.map((n) => ink[n]).find(Boolean) || inks[0];
  const near = (x, z) => Math.abs(x) < 260 && z > -500;

  // the ground: one great pressed slab, and soft swells on it
  S.lump([0, -260, -2600], [9000, 0, 0], [0, 260, 0], [0, 0, 3600], ground);
  for (let i = 0; i < 70; i++) {
    const x = R(-4200, 4200), z = R(-5200, 500);
    if (near(x, z)) continue;
    const w = R(160, 520);
    S.lump([x, -w * 0.32, z], [w, 0, 0], [0, w * R(0.38, 0.5), 0], [0, 0, w * R(0.6, 0.9)], shade(ground, R(0.92, 1.06)));
  }
  // hills going back
  const far = toon.far ? stick(hex(toon.far)) : any('lilac', 'pale rock', 'rock');
  const mid = any('dark green', 'dark sand', 'rock', 'water');
  for (let x = -7000; x < 7000; x += R(900, 1500)) {
    const h = R(900, 1900);
    S.lump([x, -h * 0.2, R(-7600, -6200)], [R(900, 1400), 0, 0], [0, h, 0], [0, 0, R(500, 800)], shade(far, R(0.94, 1.04)));
  }
  for (let x = -6000; x < 6000; x += R(700, 1100)) {
    const h = R(500, 900);
    S.lump([x, -h * 0.3, R(-4600, -3800)], [R(700, 1000), 0, 0], [0, h, 0], [0, 0, R(400, 600)], shade(mid, R(0.94, 1.05)));
  }
  // what stands about on it
  const things = id === 'cave' ? 46 : 90;
  for (let i = 0; i < things; i++) {
    const x = R(-3200, 3200), z = R(-3400, 260);
    if (near(x, z)) continue;
    const pick = rng();
    if (id === 'field' || id === 'forest') {
      if (pick < 0.5) {
        const h = id === 'forest' ? R(420, 760) : R(260, 480);
        const w = R(110, 190);
        S.coil([x, -10, z], [x, h * 0.62, z], R(14, 20), any('brown'));
        const crown = shade(rng() < 0.5 ? any('lime', 'green') : any('dark green', 'green'), R(0.95, 1.05));
        S.ball([x, h * 0.72, z], w, crown, 1, R(0.9, 1.15), 0.9);
        if (rng() < 0.6) S.ball([x + R(-0.6, 0.6) * w, h * R(0.55, 0.7), z + w * 0.4], w * R(0.45, 0.6), shade(crown, 1.05));
      } else if (pick < 0.8) {
        for (let k = 0; k < 3; k++) S.ball([x + (k - 1) * R(40, 56), R(10, 30), z + R(-20, 20)], R(48, 70), shade(any('lime', 'green'), R(0.92, 1.05)), 1, 0.9, 1);
      } else S.ball([x, 0, z], R(40, 80), any('cream', 'lilac'), 1.2, 0.6, 1);
    } else if (id === 'cave') {
      const h = R(200, 520); let r = R(50, 80); let y = 0;
      const col = shade(any('pale rock', 'rock'), R(0.9, 1.05));
      while (r > 12 && y < h) { S.ball([x, y, z], r, col, 1, 0.9, 1); y += r * 0.9; r *= 0.78; }
    } else if (id === 'ocean') {
      if (pick < 0.5) {
        const col = any('coral', 'pink');
        let a = [x, 0, z];
        for (let k = 0; k < 4; k++) { const b = add(a, [R(-50, 50), R(60, 110), R(-30, 30)]); S.coil(a, b, R(14, 20), col); a = b; }
        S.ball(a, 26, any('orange', 'yellow'));
      } else S.ball([x, 0, z], R(40, 90), shade(any('lilac', 'cream'), R(0.92, 1.05)), 1.2, 0.6, 1);
    } else if (id === 'dunes') {
      if (pick < 0.45) {
        const h = R(220, 420);
        S.coil([x, 0, z], [x, h, z], R(30, 40), any('green'));
        const side = rng() < 0.5 ? -1 : 1;
        S.coil([x + side * 20, h * 0.42, z], [x + side * 90, h * 0.5, z], 22, any('green'));
        S.coil([x + side * 90, h * 0.5, z], [x + side * 90, h * 0.78, z], 22, any('green'));
      } else S.ball([x, 0, z], R(60, 130), shade(any('mesa', 'red', 'orange'), R(0.92, 1.05)), 1.3, 0.7, 1);
    } else {
      if (pick < 0.5) S.ball([x, 0, z], R(40, 90), shade(any('rock', 'lilac'), R(0.92, 1.05)), 1.3, 0.6, 1);
      else S.coil([x, 0, z], [x + R(-80, 80), R(10, 30), z + R(-60, 60)], R(10, 16), any('driftwood', 'brown'));
    }
  }
  if (id === 'beach') {
    // the sea, rolled waves across behind
    const sea = [any('sea'), any('shallows')];
    for (let row = 0; row < 4; row++) for (let x = -6000; x < 6000; x += 210) {
      S.coil([x, 0, -1700 - row * 160], [x + 190, 0, -1700 - row * 160], R(40, 60), shade(sea[row % 2], R(0.96, 1.04)));
    }
  }
  // up the column: clouds, or bubbles, or the roof
  if (id === 'ocean') {
    const bubble = stick(hex('#cfe6ff'), 0.3);
    for (let i = 0; i < 220; i++) S.ball([R(-2400, 2400), R(300, 13000), R(-2600, -400)], R(10, 34), bubble);
  } else if (id === 'cave') {
    const col = any('rock');
    for (let i = 0; i < 160; i++) {
      const x = R(-3000, 3000), z = R(-3000, -600), y = R(1600, 13000);
      let r = R(50, 90); let yy = y;
      for (let k = 0; k < 5 && r > 12; k++) { S.ball([x, yy, z], r, shade(col, R(0.9, 1.05)), 1, 0.9, 1); yy -= r * 0.9; r *= 0.75; }
    }
  } else {
    const cloud = stick(hex('#fbf7ee'), 0.45);
    for (let y = 700; y < 13500; y += R(420, 760)) {
      const x = R(-1800, 1800), z = R(-2600, -900), w = R(70, 110), n = 3 + Math.floor(R(0, 3));
      for (let k = 0; k < n; k++) S.ball([x + (k - (n - 1) / 2) * w * 0.95, y + (k % 2) * w * 0.35, z + R(-30, 30)], w * R(0.8, 1.15), cloud, 1, 0.9, 0.85);
      S.ball([x, y - w * 0.25, z], n * w * 0.55, cloud, 1, 0.42, 0.7);
    }
  }
  const sky = toon.sky.map((c) => stick(hex(c), 0.12));
  return { solids: S, sky, ground };
}

// ------------------------------------------------------------ renderer ----

export class RendererClay {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (clay)';
    this.renderScale = 1;
    // the flat renderer, for nothing but how the game frames a view
    this.flat = new Renderer2D(canvasOf(8, 8), { width: 800, height: 600, dpr: 1 });
    this.solid = program(gl, SOLID_VS, solidFS(false));
    this.shadowProg = program(gl, SOLID_VS, solidFS(true));
    this.light = program(gl, QUAD_VS, LIGHT_FS);
    this.post = program(gl, QUAD_VS, POST_FS);

    const C = [];
    const f = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    for (const q of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]) {
      for (const i of [q[0], q[1], q[2], q[0], q[2], q[3]]) C.push(...f[i]);
    }
    this.cube = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cube);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(C), gl.STATIC_DRAW);
    this.tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.setBuf = gl.createBuffer();
    this.plantBuf = gl.createBuffer();

    this.shadowTex = this.depthTexture(SHADOW, SHADOW);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.kind = 0; this.night = 0; this.set = null; this.setKind = -1;
    this.g = null;
    this.held = null;
    this.mats = null;
    this.resize();
  }

  colourTexture(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }

  depthTexture(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }

  resize() {
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.w = cw; this.h = ch; this.dpr = dpr;
    this.pw = Math.max(1, Math.round(cw * dpr));
    this.ph = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== this.pw || this.canvas.height !== this.ph) {
      this.canvas.width = this.pw;
      this.canvas.height = this.ph;
    }
    Object.assign(this.flat.opts, { width: cw, height: ch, dpr });
    this.flat.resize();
    const gl = this.gl;
    if (!this.g || this.g.w !== this.pw || this.g.h !== this.ph) {
      if (this.g) {
        for (const t of [this.g.albedo, this.g.normal, this.g.depth, this.g.lit]) gl.deleteTexture(t);
        gl.deleteFramebuffer(this.g.fbo); gl.deleteFramebuffer(this.g.litFbo);
      }
      const albedo = this.colourTexture(this.pw, this.ph);
      const normal = this.colourTexture(this.pw, this.ph);
      const lit = this.colourTexture(this.pw, this.ph);
      const depth = this.depthTexture(this.pw, this.ph);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, albedo, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normal, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      const litFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, litFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lit, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.g = { w: this.pw, h: this.ph, albedo, normal, depth, lit, fbo, litFbo };
    }
  }

  invalidate() { this.flat.invalidate(); }
  setLook() {}
  camYToPlaceAt(y, frac, zoom) { return this.flat.camYToPlaceAt(y, frac, zoom); }
  camYToCentre(y) { return this.flat.camYToCentre(y); }
  camXToCentre(x) { return this.flat.camXToCentre(x); }
  setWorld(kind, nightness) { this.kind = kind; this.night = nightness; this.flat.setWorld(kind, nightness); }

  /**
   * The camera: the flat look's framing of the plant's plane, taken with a
   * normal lens from a little above, so the ground runs away into the set.
   */
  camera(cam) {
    const l = this.flat.lens(cam);
    const dist = (this.h / 2) / Math.tan(FOV / 2) / l.zoom;
    const target = [l.ex, l.lookY, 0];
    const eye = [l.ex, l.lookY + dist * 0.20, dist * 0.98];
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(FOV, this.w / this.h, NEAR, FAR);
    const viewProj = mat4mul(proj, view);
    return { eye, target, dist: Math.hypot(...sub(eye, target)), viewProj };
  }

  project(cam, x, y) {
    const { viewProj: m } = this.camera(cam);
    const cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13], cw = m[3] * x + m[7] * y + m[15];
    return { x: (cx / cw * 0.5 + 0.5) * this.w, y: (0.5 - cy / cw * 0.5) * this.h };
  }

  /** The plant as it would be made: coils, petals pressed from balls, a bead for a heart. */
  plantSolids(plant, reveal) {
    const S = new Solids();
    const flowerHue = flowerHueFor(plant);
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const hsl = stemColour(section, makeRng(1013 + section.step * 7919));
      const sc = stickHsl(hsl);
      for (const seg of section.segments) {
        const pts = growing ? seg.points.filter((p) => p.k <= kMax) : seg.points;
        if (pts.length < 2) continue;
        const r = clamp(pts[0].w * 1.7, 6, 12) * (seg.depth > 0 ? 0.8 : 1);
        // rolled by hand: a little fatter here and thinner there, and not quite in one plane
        const wob = (p) => Math.sin(p.x * 0.031 + p.y * 0.017) * r * 0.35 + Math.sin(p.y * 0.053) * r * 0.2;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const rr = r;   // (one thickness down a run: any step between two coils shows as a seam)
          S.coil([a.x, a.y, wob(a)], [b.x, b.y, wob(b)], rr, sc);
        }
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const ax = Math.cos(node.angle);
        const ay = Math.sin(node.angle);
        const base = [node.x, node.y, 0];
        if (node.kind === 'leaf') {
          const L = Math.max(26, node.size * 2.3) * open;
          const along = norm([ax, ay, 0.35]);
          const side = norm(cross(along, [0, 0, 1]));
          const tw = norm(add(side, [0, 0, 0.45]));
          const C = norm(cross(along, tw));
          S.lump(add(base, mul(along, L * 0.5)), mul(along, L * 0.5), mul(tw, L * 0.22), mul(C, L * 0.07), stick(hex('#59b05a'), 0.14));
          continue;
        }
        const R = Math.max(28, node.size * 1.45) * open;
        const c = add(base, [ax * R * 0.9, ay * R * 0.9, R * 0.15]);
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        const by = stickHsl(bloomColour(hsl, node, flowerHue, pig));
        const shown = Math.ceil(petals * open);
        for (let i = 0; i < shown; i++) {
          const a = spin + (i / petals) * Math.PI * 2;
          const d = [Math.cos(a), Math.sin(a), 0];
          // each petal cups forward a little, as a pressed ball does when it is pinched
          const A = mul(norm(add(d, [0, 0, 0.32])), R * 0.46);
          const B = mul([-d[1], d[0], 0], R * 0.33);
          const Cc = mul(norm(cross(A, B)), R * 0.11);
          S.lump(add(c, add(mul(d, R * 0.52), [0, 0, (i % 2) * 2])), A, B, Cc, shade(by, i % 2 ? 0.94 : 1.04));
        }
        S.ball(add(c, [0, 0, R * 0.16]), R * 0.27, stick(hex('#ffcf45'), 0.1), 1, 1, 0.7);
      }
    }
    return S;
  }

  drawSolids(prog, buf, S, upload) {
    const gl = this.gl;
    if (!S.n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (upload) gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(S.d), upload);
    const at = [[1, 3, 0], [2, 3, 12], [3, 3, 24], [4, 3, 36], [5, 4, 48]];
    for (const [loc, size, off] of at) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 64, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cube);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, S.n);
    for (const [loc] of at) { gl.vertexAttribDivisor(loc, 0); gl.disableVertexAttribArray(loc); }
  }

  quad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    // a model is moved between exposures: growth goes a frame at a time
    const FRAME = 1000 / 12;
    const take = Math.floor(time / FRAME);
    if (reveal) {
      if (!this.held || this.held.step !== reveal.step || this.held.take !== take || reveal.progress >= 1) {
        this.held = { step: reveal.step, take, reveal: { ...reveal } };
      }
      reveal = this.held.reveal;
    } else this.held = null;

    const gl = this.gl;
    this.flat.ensureWorld?.();
    let fresh = false;
    if (this.setKind !== this.kind) { this.set = buildSet(this.kind); this.setKind = this.kind; fresh = true; }
    const camera = this.camera(cam);
    const plantS = this.plantSolids(plant, reveal);

    // the lamp: big, up and to the left, and in front
    const L = norm([-0.55, 0.78, 0.62]);
    const halfW = camera.dist * Math.tan(FOV / 2) * (this.w / this.h);
    const span = Math.max(halfW, camera.dist * Math.tan(FOV / 2)) * 1.7;
    const lt = [camera.target[0], camera.target[1] - span * 0.25, -span * 0.3];
    const lightView = lookAt(add(lt, mul(L, 9000)), lt, [0, 1, 0]);
    const lightVP = mat4mul(ortho(span, 100, 18000), lightView);

    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);

    // the shadow, from the lamp
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.shadowProg.u('uViewProj'), false, lightVP);
    gl.uniform3fv(this.shadowProg.u('uRayDir'), mul(L, -1));
    gl.uniform1f(this.shadowProg.u('uOrtho'), 1);
    this.drawSolids(this.shadowProg, this.setBuf, this.set.solids, fresh ? gl.STATIC_DRAW : 0);
    this.drawSolids(this.shadowProg, this.plantBuf, plantS, gl.DYNAMIC_DRAW);

    // the pieces, as seen
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.g.fbo);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 1, 0]);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(this.solid.u('uViewProj'), false, camera.viewProj);
    gl.uniform3fv(this.solid.u('uEye'), camera.eye);
    gl.uniform1f(this.solid.u('uOrtho'), 0);
    gl.uniform1f(this.solid.u('uPixel'), 2 * Math.tan(FOV / 2) / this.ph);
    this.drawSolids(this.solid, this.setBuf, this.set.solids, 0);
    this.drawSolids(this.solid, this.plantBuf, plantS, 0);

    // lit
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.g.litFbo);
    gl.useProgram(this.light);
    const tex = (prog, name, unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u(name), unit); };
    tex(this.light, 'uAlbedo', 0, this.g.albedo);
    tex(this.light, 'uNormal', 1, this.g.normal);
    tex(this.light, 'uDepth', 2, this.g.depth);
    tex(this.light, 'uShadow', 3, this.shadowTex);
    gl.uniformMatrix4fv(this.light.u('uInvViewProj'), false, mat4inv(camera.viewProj));
    gl.uniformMatrix4fv(this.light.u('uViewProj'), false, camera.viewProj);
    gl.uniformMatrix4fv(this.light.u('uLightViewProj'), false, lightVP);
    gl.uniform3fv(this.light.u('uEye'), camera.eye);
    gl.uniform3fv(this.light.u('uL'), L);
    gl.uniform2f(this.light.u('uRes'), this.pw, this.ph);
    const n = clamp(this.night, 0, 1);
    const sky = this.set.sky;
    const wall = n < 0.5 ? sky[0].map((q, i) => mixn(q, sky[1][i], n * 2)) : sky[1].map((q, i) => mixn(q, sky[2][i], n * 2 - 1));
    const cave = PLACES[this.kind % PLACES.length].id === 'cave';
    gl.uniform3fv(this.light.u('uWallTop'), wall.map((q) => Math.min(1, q * 1.12 + 0.06)));
    gl.uniform3fv(this.light.u('uWallLow'), wall.map((q) => Math.min(1, q * 1.0 + 0.02)));
    const dim = cave ? 0.75 : mixn(1, 0.55, n);
    gl.uniform3fv(this.light.u('uLamp'), [mixn(1.0, 0.70, n) * dim, mixn(0.95, 0.78, n) * dim, mixn(0.86, 1.0, n) * dim]);
    gl.uniform3fv(this.light.u('uSky'), [mixn(0.70, 0.30, n), mixn(0.78, 0.34, n), mixn(0.92, 0.62, n)]);
    gl.uniform3fv(this.light.u('uBounce'), this.set.ground.map((q) => Math.pow(q, 2.2) * 1.4 + 0.05));
    gl.uniform1f(this.light.u('uTake'), take % 61);
    this.quad();

    // through the lens
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.useProgram(this.post);
    tex(this.post, 'uLit', 0, this.g.lit);
    tex(this.post, 'uDepth', 1, this.g.depth);
    gl.uniform2f(this.post.u('uRes'), this.pw, this.ph);
    gl.uniform1f(this.post.u('uFocus'), camera.dist);
    gl.uniform1f(this.post.u('uCocK'), 9 * this.dpr);
    gl.uniform1f(this.post.u('uCocMax'), 7 * this.dpr);
    gl.uniform1f(this.post.u('uTake'), take % 61);
    this.quad();
  }
}
