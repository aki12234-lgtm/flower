// Plasticine: a model set, photographed.
//
// What makes a thing read as plasticine is not marks on a surface. It is the
// forms and the light. Everything is a fat rounded lump, a rolled coil, a ball
// pressed a little flat, in one plain soft colour each, with no edges anywhere
// and no detail smaller than a fingertip could make; and it is a small thing
// under a big soft lamp, so the shading turns slowly right round every form,
// each piece lays a soft shadow on what is behind it, and it is dark and warm
// where two pieces touch. The surface is matte, a little grainy, and very
// slightly uneven where it was smoothed over.
//
// So this look builds its own set out of such pieces: a plain wall the colour
// of the place's sky, rounded hills and trees and stones and clouds in the
// place's colours, and the plant in front as coils, flattened balls and beads.
// Each piece is drawn as the true rounded solid it is (its height and its
// slope worked out exactly, pixel by pixel), and then the whole set is lit at
// once: a soft key lamp with real shadows marched across the model, the dark
// that gathers in the joins, a cool fill, and the faint wax shine.
//
// It moves as a model does, a frame at a time.

import { Renderer2D } from '../flat/renderer2d.js';
import { stemColour, flowerHueFor, bloomColour, PIGMENT, PLACES } from '../gl/scene.js';
import { makeRng } from '../rng.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mixn = (a, b, t) => a + (b - a) * t;
const ZMAX = 420;      // the deepest the set gets, in the same units as across

function rgbOf(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
/**
 * A stick of plasticine in a colour. The stuff has chalk in it: it is never
 * very dark and never a pure hue, which is most of why a set made of it looks
 * soft.
 */
function stick(rgb, soft = 0.20) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((q) => clamp(mixn(mixn(l, q, 0.82), 0.93, soft) , 0.05, 0.96));
}
const stickHsl = (c) => stick(rgbOf(c.h, clamp(c.s, 40, 80), clamp(c.l + 6, 40, 62)), 0.14);
const shade = (rgb, k) => rgb.map((q) => clamp(q * k, 0, 1));
const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// ------------------------------------------------------------- the pieces --
//
// A piece is one of two solids, lying on the set with its back at `base`:
//   a coil:  a round rod from (x0,y0) to (x1,y1), r0 thick at one end, r1 at the other
//   a lump:  a ball pressed flat, centred (x0,y0), half as long as (x1,y1), r0 across
// `rise` is how far it stands off its base at its highest.

const PIECE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aEnds;
layout(location = 2) in vec4 aShape;    // r0, r1, base, rise
layout(location = 3) in vec4 aColour;   // rgb, kind
uniform vec2 uSize; uniform vec2 uEye; uniform float uZoom;
out vec2 vAt; flat out vec4 vEnds; flat out vec4 vShape; flat out vec4 vColour;
void main() {
  vec2 a = aEnds.xy, b = aEnds.zw;
  float kind = aColour.a;
  vec2 mid, along, across;
  float pad = 2.0 / uZoom;
  if (kind < 0.5) {
    vec2 d = b - a; float len = max(length(d), 1e-4); vec2 u = d / len;
    float r = max(aShape.x, aShape.y) + pad;
    mid = (a + b) * 0.5; along = u * (len * 0.5 + r); across = vec2(-u.y, u.x) * r;
  } else {
    float len = max(length(b), 1e-4); vec2 u = b / len;
    mid = a; along = u * (len + pad); across = vec2(-u.y, u.x) * (aShape.x + pad);
  }
  vec2 w = mid + along * aCorner.x + across * aCorner.y;
  vAt = w; vEnds = aEnds; vShape = aShape; vColour = aColour;
  vec2 s = vec2(uSize.x * 0.5 + (w.x - uEye.x) * uZoom, uSize.y * 0.5 - (w.y - uEye.y) * uZoom);
  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const PIECE_FS = `#version 300 es
precision highp float;
in vec2 vAt; flat in vec4 vEnds; flat in vec4 vShape; flat in vec4 vColour;
layout(location = 0) out vec4 oColour;
layout(location = 1) out vec4 oForm;     // height in two bytes, then the slope
void main() {
  vec2 a = vEnds.xy, b = vEnds.zw;
  float inward; vec2 out_;                 // how far in from the rim, and which way is out
  float rise = vShape.w;
  float least;
  if (vColour.a < 0.5) {
    vec2 d = b - a;
    float t = clamp(dot(vAt - a, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    float r = mix(vShape.x, vShape.y, t);
    vec2 off = vAt - (a + d * t);
    float dist = length(off);
    inward = r - dist;
    out_ = off / max(dist, 1e-4);
    least = r;
    rise *= r / max(vShape.x, vShape.y);
  } else {
    float len = length(b); vec2 u = b / len; vec2 v = vec2(-u.y, u.x);
    vec2 e = vec2(dot(vAt - a, u) / len, dot(vAt - a, v) / vShape.x);
    float q = length(e);
    vec2 grad = (u * e.x / len + v * e.y / vShape.x) / max(q, 1e-4);
    inward = (1.0 - q) / max(length(grad), 1e-6);
    out_ = normalize(grad);
    least = min(len, vShape.x);
  }
  if (inward <= 0.0) discard;
  // Round all the way over if it is a small thing; if it is a big slab, a fat
  // soft shoulder and then nearly level, as a pressed-out sheet is.
  float E = min(least, rise * 2.6);
  float t = clamp(inward / E, 0.0, 1.0);
  float k = sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
  float z = vShape.z + rise * k + rise * 0.10 * smoothstep(E, max(least, E * 1.3), min(inward, least));
  float slope = t < 1.0 ? rise * (1.0 - t) / (E * max(k, 0.06)) * smoothstep(0.0, 0.14, 1.0 - t) : 0.0;
  vec2 n = normalize(vec3(out_ * slope, 1.0)).xy;
  float zn = clamp(z / ${ZMAX.toFixed(1)}, 0.0, 0.9999);
  gl_FragDepth = 1.0 - zn;
  float hi = floor(zn * 255.0) / 255.0;
  oColour = vec4(vColour.rgb, 1.0);
  oForm = vec4(hi, fract(zn * 255.0), n.x * 0.5 + 0.5, -n.y * 0.5 + 0.5);
}`;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const LIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uColour;
uniform sampler2D uForm;
uniform vec2 uRes;        // device pixels
uniform float uPx;        // device pixels to a unit of the set, as it is framed now
uniform vec2 uOrigin;     // where the set's origin is, in device pixels
uniform vec3 uWall;
uniform float uNight;
uniform float uTake;
out vec4 outColour;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
/** How high the set stands at a device pixel, in units of the set. */
float high(vec2 p) {
  p = clamp(p, vec2(0.0), uRes - 1.0);
  vec4 f = texelFetch(uForm, ivec2(p.x, uRes.y - 1.0 - p.y), 0);
  return (f.r + f.g / 255.0) * ${ZMAX.toFixed(1)};
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 form = texelFetch(uForm, ip, 0);
  vec3 dye = texelFetch(uColour, ip, 0).rgb;
  float h0 = (form.r + form.g / 255.0) * ${ZMAX.toFixed(1)};
  bool wall = h0 < 0.01;
  vec3 N = vec3(form.b * 2.0 - 1.0, form.a * 2.0 - 1.0, 0.0);
  if (wall) N.xy = vec2(0.0);
  N.z = sqrt(max(1.0 - dot(N.xy, N.xy), 0.0));

  // The surface: smoothed over with a thumb, so never quite even, and with the
  // fine tooth the stuff has. (Fixed to the set, so it does not swim.)
  vec2 q = (p - uOrigin) / uPx;
  float e = 1.2;
  float s0 = vnoise(q * 0.06) * 0.9 + vnoise(q * 0.23 + 9.0) * 0.35;
  float sx = vnoise((q + vec2(e, 0.0)) * 0.06) * 0.9 + vnoise((q + vec2(e, 0.0)) * 0.23 + 9.0) * 0.35;
  float sy = vnoise((q + vec2(0.0, e)) * 0.06) * 0.9 + vnoise((q + vec2(0.0, e)) * 0.23 + 9.0) * 0.35;
  float tooth = hash21(floor(q * 1.6)) * 0.6 + vnoise(q * 2.4) * 0.4;
  float tx = hash21(floor((q + vec2(0.7, 0.0)) * 1.6)) * 0.6 + vnoise((q + vec2(0.7, 0.0)) * 2.4) * 0.4;
  float ty = hash21(floor((q + vec2(0.0, 0.7)) * 1.6)) * 0.6 + vnoise((q + vec2(0.0, 0.7)) * 2.4) * 0.4;
  float rough = wall ? 0.30 : 1.0;
  N = normalize(N + vec3(-(sx - s0) / e * 2.6 - (tx - tooth) * 0.09, -(sy - s0) / e * 2.6 - (ty - tooth) * 0.09, 0.0) * rough);

  // The lamp: big, soft, up and to the left, and well in front.
  vec3 L = normalize(vec3(-0.30, -0.42, 0.86));
  vec2 toward = normalize(L.xy);
  float climb = L.z / length(L.xy);                 // how fast a ray to the lamp leaves the set
  // Its shadow: walk towards the lamp across the model; whatever stands above
  // the ray is in the way, and the nearer it comes to the ray the darker.
  float lit = 1.0;
  float jit = hash21(p + uTake);
  for (int i = 0; i < 26; i++) {
    float d = (float(i) + jit) * (1.6 + float(i) * 0.36);        // units of the set
    float ray = h0 + 0.8 + d * climb;
    float hs = high(p + toward * d * uPx);
    lit = min(lit, clamp((ray - hs) / (d * 0.95 + 2.0) + 0.5, 0.0, 1.0));
  }
  lit = smoothstep(0.0, 1.0, lit);
  // And the dark that gathers where one piece meets another, or meets the wall.
  float occ = 0.0;
  for (int i = 0; i < 10; i++) {
    float a = (float(i) + jit) * 0.6283;
    vec2 dir = vec2(cos(a), sin(a));
    for (int k = 0; k < 3; k++) {
      float r = k == 0 ? 3.0 : (k == 1 ? 8.0 : 20.0);
      float hs = high(p + dir * r * uPx);
      occ += clamp((hs - h0 - 0.4) / r, 0.0, 1.0) * (k == 2 ? 0.7 : 1.0);
    }
  }
  float ao = 1.0 - clamp(occ / 30.0 * 2.3, 0.0, 0.72);

  vec3 base = pow(wall ? uWall : dye, vec3(2.2));
  base *= 0.96 + 0.08 * tooth * (wall ? 0.5 : 1.0);
  // a paler bloom on the high places, where it has been handled
  base = mix(base, base * 1.10 + 0.012, smoothstep(0.55, 1.1, s0) * 0.5);

  float ndl = dot(N, L);
  float wrap = clamp((ndl + 0.30) / 1.30, 0.0, 1.0);
  vec3 lamp = mix(vec3(1.0, 0.955, 0.88), vec3(0.62, 0.70, 1.0), uNight) * mix(1.0, 0.62, uNight);
  vec3 sky = mix(vec3(0.66, 0.74, 0.90), vec3(0.30, 0.34, 0.62), uNight);
  vec3 bounce = mix(vec3(0.95, 0.80, 0.66), vec3(0.34, 0.30, 0.48), uNight);
  vec3 col = base * lamp * wrap * lit * 1.38;
  // light goes a little way into it: the edge of every shadow is warm and saturated
  float term = wrap * (1.0 - wrap) * 4.0;
  col += base * base * vec3(1.0, 0.72, 0.60) * (term * 0.10 + (1.0 - lit) * wrap * 0.10);
  // the room: cool from above, warm back off the table from below
  col += base * mix(bounce, sky, clamp(-N.y * 0.5 + 0.5, 0.0, 1.0)) * 0.46 * ao;
  col *= mix(1.0, ao, 0.55);
  // wax: a very broad, very faint shine, and a pale edge where it turns away
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col += lamp * pow(max(dot(N, H), 0.0), 9.0) * 0.045 * lit * (wall ? 0.4 : 1.0);
  col += base * sky * pow(1.0 - N.z, 2.4) * 0.30 * ao;

  col = col / (1.0 + col * 0.18);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 sc = p / uRes - 0.5;
  col *= 1.0 - smoothstep(0.38, 1.0, length(sc * vec2(1.0, 1.15))) * 0.30;
  col += (hash21(p * 1.3 + uTake) - 0.5) * 0.014;
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
  return p;
}

// ---------------------------------------------------------------- the set --

/** A list of pieces, eight numbers and a colour each. */
class Pieces {
  constructor() { this.data = []; this.n = 0; }
  coil(x0, y0, x1, y1, r0, r1, base, rise, c) { this.data.push(x0, y0, x1, y1, r0, r1, base, rise, c[0], c[1], c[2], 0); this.n++; }
  lump(x, y, ax, ay, across, base, rise, c) { this.data.push(x, y, ax, ay, across, 0, base, rise, c[0], c[1], c[2], 1); this.n++; }
  ball(x, y, r, base, c, flat = 0.9) { this.lump(x, y, r, 0, r, base, r * flat, c); }
}

/**
 * The set for a place: built once, in the place's own colours. Hills in three
 * rows going back, things standing on the front one, clouds up the wall as far
 * as the plant will ever climb, and stars above those.
 */
function buildSet(kind) {
  const place = PLACES[kind % PLACES.length];
  const toon = place.toon;
  const ink = Object.fromEntries(toon.inks.map(([n, c]) => [n, stick(hex(c))]));
  const inks = toon.inks.map(([, c]) => stick(hex(c)));
  const ground = stick(hex(toon.ground));
  const rng = makeRng(7001 + kind * 131);
  const R = (a, b) => a + (b - a) * rng();
  const P = new Pieces();
  const id = place.id;
  const far = toon.far ? stick(hex(toon.far)) : (ink.lilac || ink['pale rock'] || inks[4]);
  const mid = ink['dark green'] || ink['dark sand'] || ink.rock || ink.water || shade(ground, 0.8);

  // the far row: big soft shapes low on the wall
  for (let x = -5200; x < 5200; x += R(520, 760)) {
    const tall = id === 'field' || id === 'dunes' || id === 'cave' ? R(300, 520) : R(220, 340);
    P.lump(x, -220 + tall * 0.25, R(360, 520), 0, tall, 2, 30, id === 'beach' ? far : shade(far, R(0.94, 1.04)));
  }
  // the middle row
  for (let x = -5200; x < 5200; x += R(360, 520)) {
    P.lump(x, -330, R(330, 460), 0, R(330, 440), 14, 34, shade(mid, R(0.95, 1.05)));
  }
  // things that stand on the set, behind the front row
  const stand = (x) => {
    const pick = rng();
    const y = R(40, 70);
    if (id === 'field' || id === 'forest') {
      if (pick < 0.55) {            // a tree: a rolled trunk and a fat pressed crown
        const h = R(150, 300), w = R(54, 96);
        P.coil(x, y - 60, x, y + h * 0.5, 10, 8, 30, 10, ink.brown || inks[5]);
        P.lump(x, y + h * 0.62, w, 0, h * 0.46, 34, 30, shade(rng() < 0.5 ? ink.lime || ground : ink['dark green'] || mid, R(0.95, 1.05)));
        if (rng() < 0.5) P.ball(x + R(-w, w) * 0.5, y + h * R(0.35, 0.5), R(26, 40), 44, shade(ink['dark green'] || mid, 1.04));
      } else if (pick < 0.8) {      // a bush: three balls
        for (let i = 0; i < 3; i++) P.ball(x + (i - 1) * R(26, 34), y - 30 + R(0, 16), R(26, 40), 32 + i, shade(ink.lime || ground, R(0.92, 1.05)));
      } else P.lump(x, y - 34, R(40, 70), 0, R(26, 40), 32, 24, ink.cream || ink.lilac || inks[3]);
    } else if (id === 'cave') {
      const h = R(160, 360);        // a stalagmite: a fat rod going to a point
      P.coil(x, y - 80, x, y + h, R(34, 52), 8, 30, 30, shade(ink['pale rock'] || ink.rock, R(0.9, 1.05)));
    } else {
      if (pick < 0.6) P.lump(x, y - 34, R(44, 90), 0, R(28, 50), 32, 26, shade(ink.rock || ink.mesa || ink.coral || ink.lilac || inks[5], R(0.92, 1.06)));
      else if (id === 'ocean') { const h = R(90, 200); P.coil(x, y - 60, x + R(-20, 20), y + h, 16, 10, 30, 16, ink.coral || ink.pink); P.ball(x, y + h, 20, 34, ink.orange || ink.yellow); }
      else if (id === 'dunes') { const h = R(110, 220); P.coil(x, y - 60, x, y + h, 20, 17, 30, 20, ink.green); P.coil(x + 14, y + h * 0.4, x + 52, y + h * 0.62, 12, 11, 32, 12, ink.green); }
      else { P.coil(x, y - 60, x + R(-30, 30), y + R(80, 150), 9, 6, 30, 9, ink.driftwood || ink.brown); }
    }
  };
  for (let x = -5000; x < 5000; x += R(170, 380)) if (Math.abs(x) > 150) stand(x);
  // the front row, which the plant stands in
  for (let x = -5200; x < 5200; x += R(250, 330)) {
    P.lump(x, -420 + R(-14, 14), R(300, 380), 0, 440, 46, 30, shade(ground, R(0.96, 1.04)));
  }
  P.lump(0, -2400, 9000, 0, 2020, 44, 30, ground);
  if (id === 'beach' || id === 'ocean') {
    // the sea, in rolled waves across the front
    const sea = [ink.sea || ink.water, ink.shallows || ink.light];
    for (let row = 0; row < 3; row++) for (let x = -5200; x < 5200; x += 150) {
      P.lump(x + row * 50, -150 - row * 70, 96, 0, 46, 62 + row * 8, 20, shade(sea[row % 2], R(0.96, 1.05)));
    }
  }
  // clouds, all the way up
  const cloud = stick(hex('#fbf7ee'), 0.5);
  if (id !== 'cave' && id !== 'ocean') {
    for (let y = 420; y < 12000; y += R(330, 620)) {
      const x = R(-1500, 1500), n = 3 + Math.floor(R(0, 3)), w = R(46, 74);
      for (let i = 0; i < n; i++) P.lump(x + (i - (n - 1) / 2) * w * 0.9, y + R(-10, 10) + (i % 2) * 14, w * R(0.8, 1.15), 0, w * R(0.55, 0.8), 6 + i, 22, cloud);
      P.lump(x, y - w * 0.3, n * w * 0.52, 0, w * 0.42, 5, 18, cloud);
    }
  } else if (id === 'ocean') {
    for (let y = 300; y < 12000; y += R(160, 320)) P.ball(R(-1500, 1500), y, R(8, 22), 6, stick(hex('#bfe0ff'), 0.4));
  } else {
    for (let x = -5000; x < 5000; x += R(150, 340)) { const h = R(140, 420); P.coil(x, 1500 + R(0, 60), x, 1500 - h, R(34, 56), 8, 30, 30, shade(ink.rock, R(0.9, 1.05))); }
  }
  // and stars, little beads pressed on the wall
  const star = stick(hex('#ffd93b'), 0.25);
  for (let i = 0; i < 260; i++) P.ball(R(-1800, 1800), R(2600, 12000), R(4, 9), 3, star);
  return { pieces: P, sky: toon.sky.map((c) => stick(hex(c), 0.16)) };
}

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
    this.piece = program(gl, PIECE_VS, PIECE_FS);
    this.light = program(gl, QUAD_VS, LIGHT_FS);
    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.setBuf = gl.createBuffer();
    this.plantBuf = gl.createBuffer();
    this.kind = 0; this.night = 0; this.set = null; this.setKind = -1;
    this.gbuf = null;
    this.held = null;
    this.resize();
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
    if (!this.gbuf || this.gbuf.w !== this.pw || this.gbuf.h !== this.ph) {
      if (this.gbuf) { gl.deleteFramebuffer(this.gbuf.fbo); gl.deleteTexture(this.gbuf.colour); gl.deleteTexture(this.gbuf.form); gl.deleteRenderbuffer(this.gbuf.depth); }
      const tex = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.pw, this.ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        return t;
      };
      const colour = tex(), form = tex();
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.pw, this.ph);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, form, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.gbuf = { w: this.pw, h: this.ph, fbo, colour, form, depth };
    }
  }

  invalidate() { this.flat.invalidate(); }
  setLook() {}
  camYToPlaceAt(y, frac, zoom) { return this.flat.camYToPlaceAt(y, frac, zoom); }
  camYToCentre(y) { return this.flat.camYToCentre(y); }
  camXToCentre(x) { return this.flat.camXToCentre(x); }
  project(cam, x, y) { return this.flat.project(cam, x, y); }
  setWorld(kind, nightness) { this.kind = kind; this.night = nightness; this.flat.setWorld(kind, nightness); }

  /** The plant, as it would be made: rolled coils, flattened balls, a bead for the heart. */
  plantPieces(plant, reveal) {
    const P = new Pieces();
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
        const r = clamp(pts[0].w * 2.2, 8.5, 14) * (seg.depth > 0 ? 0.8 : 1);
        const base = seg.depth > 0 ? 70 : 74;
        for (let i = 1; i < pts.length; i++) P.coil(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, r, r, base, r * 1.0, sc);
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const ax = Math.cos(node.angle);
        const ay = Math.sin(node.angle);
        if (node.kind === 'leaf') {
          const L = Math.max(22, node.size * 2.4) * open;
          P.lump(node.x + ax * L * 0.52, node.y + ay * L * 0.52, ax * L * 0.52, ay * L * 0.52, L * 0.24, 68, 9, stick(hex('#4fae52'), 0.16));
          continue;
        }
        const R = Math.max(30, node.size * 1.5) * open;
        const cx = node.x + ax * R * 0.9;
        const cy = node.y + ay * R * 0.9;
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        const by = stickHsl(bloomColour(hsl, node, flowerHue, pig));
        const shown = Math.ceil(petals * open);
        for (let i = 0; i < shown; i++) {
          const a = spin + (i / petals) * Math.PI * 2;
          P.lump(cx + Math.cos(a) * R * 0.58, cy + Math.sin(a) * R * 0.58, Math.cos(a) * R * 0.46, Math.sin(a) * R * 0.46, R * 0.36, 80 + (i % 2) * 3, R * 0.34, shade(by, i % 2 ? 0.93 : 1.04));
        }
        P.ball(cx, cy, R * 0.30, 94, stick(hex('#ffd24a'), 0.12), 0.8);
      }
    }
    return P;
  }

  drawPieces(buf, P, usage) {
    const gl = this.gl;
    if (!P.n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (usage) gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P.data), usage);
    for (const [loc, off] of [[1, 0], [2, 16], [3, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, P.n);
    for (const loc of [1, 2, 3]) { gl.vertexAttribDivisor(loc, 0); gl.disableVertexAttribArray(loc); }
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
    this.flat.ensureWorld();
    const v = this.flat.view(cam, time);
    const zoom = v.zoom;
    const eye = [v.ex, v.lookY];
    let fresh = false;
    if (this.setKind !== this.kind) { this.set = buildSet(this.kind); this.setKind = this.kind; fresh = true; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuf.fbo);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0.5, 0.5]);
    gl.clearDepth(1.0); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.piece);
    gl.uniform2f(gl.getUniformLocation(this.piece, 'uSize'), this.w, this.h);
    gl.uniform2f(gl.getUniformLocation(this.piece, 'uEye'), eye[0], eye[1]);
    gl.uniform1f(gl.getUniformLocation(this.piece, 'uZoom'), zoom);
    this.drawPieces(this.setBuf, this.set.pieces, fresh ? gl.STATIC_DRAW : 0);
    this.drawPieces(this.plantBuf, this.plantPieces(plant, reveal), gl.DYNAMIC_DRAW);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.light);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gbuf.colour);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gbuf.form);
    gl.uniform1i(gl.getUniformLocation(this.light, 'uColour'), 0);
    gl.uniform1i(gl.getUniformLocation(this.light, 'uForm'), 1);
    gl.uniform2f(gl.getUniformLocation(this.light, 'uRes'), this.pw, this.ph);
    gl.uniform1f(gl.getUniformLocation(this.light, 'uPx'), zoom * this.dpr);
    gl.uniform2f(gl.getUniformLocation(this.light, 'uOrigin'), (this.w / 2 - eye[0] * zoom) * this.dpr, (this.h / 2 + eye[1] * zoom) * this.dpr);
    const n = clamp(this.night, 0, 1);
    const sky = this.set.sky;
    const wall = n < 0.5 ? sky[0].map((q, i) => mixn(q, sky[1][i], n * 2)) : sky[1].map((q, i) => mixn(q, sky[2][i], n * 2 - 1));
    gl.uniform3f(gl.getUniformLocation(this.light, 'uWall'), wall[0], wall[1], wall[2]);
    gl.uniform1f(gl.getUniformLocation(this.light, 'uNight'), n);
    gl.uniform1f(gl.getUniformLocation(this.light, 'uTake'), take % 61);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
