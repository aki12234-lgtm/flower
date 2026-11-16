// Crochet: the whole picture as one piece of knitting, with the plant worked on
// top of it.
//
// It is flat, because it is a piece of cloth: the world is the picture knitted
// into it, one stitch one colour, the way a jumper carries a picture. What
// makes it yarn and not a drawing of yarn is that every stitch is relief under
// a light. Each is a V of two round legs of plied yarn, with a gap beside it
// that the light does not reach, and the shading is worked out from that
// height, pixel by pixel, rather than painted on.
//
// The plant is in the cloth, not on it: it is worked over the same stitches in
// a heavier yarn, the way a motif is darned into knitting, so it follows the
// rows and columns of the fabric it belongs to. It stands a little prouder than
// the ground and presses a shade into the stitches beside it, and that is all
// that sets it apart. It grows the only way such a thing can: a stitch at a
// time.
//
// The world itself is the flat renderer's (every place, bird and deer), drawn
// small off-screen: all this keeps of it is one colour per stitch.

import { RendererCrafted } from '../flat/crafted.js';
import { stemColour, flowerHueFor, bloomColour, PIGMENT } from '../gl/scene.js';
import { makeRng } from '../rng.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mod = (a, n) => ((a % n) + n) % n;

/** One knitted stitch, in CSS pixels. */
const STITCH = [10, 8.5];

/** HSL (degrees, percent, percent) to sRGB 0..1. */
function rgbOf(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
/** A yarn of a colour: dyed wool holds its colour, and is never very pale or very dark. */
const yarnOf = (c) => rgbOf(c.h, clamp(c.s * 1.05, 34, 80), clamp(c.l * 1.1 + 6, 34, 64));

const COMMON = `#version 300 es
precision highp float;
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
/**
 * Stocking stitch, as a height: p in stitches, x across the row and y up the
 * work. Each stitch is a V, two legs of yarn leaning out from the bottom of the
 * cell, and each leg runs on past the top of its own cell into the row above,
 * which is what makes knitting a fabric and not a pattern of marks. A leg is
 * round in section and twisted from plies.
 */
float stitches(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  float h = 0.0;
  for (int dy = 0; dy <= 1; dy++) {
    float t = f.y + float(dy);
    if (t > 1.42) continue;
    for (int dx = -1; dx <= 1; dx++) {
      float jit = (hash21(cell + vec2(float(dx), -float(dy))) - 0.5) * 0.10;
      for (int sd = -1; sd <= 1; sd += 2) {
        float side = float(sd);
        float cx = 0.5 + float(dx) + jit + side * (0.07 + 0.36 * t - 0.07 * t * t);
        float d = abs(f.x - cx);
        float w = 0.275 * (1.0 - 0.18 * smoothstep(1.0, 1.42, t));
        if (d > w) continue;
        float round_ = sqrt(1.0 - (d / w) * (d / w));
        float ply = 0.5 + 0.5 * sin((t * 4.6 + side * (f.x - cx) / w * 1.25) * 6.2832);
        float lift = dy == 0 ? 1.0 : 0.80;
        h = max(h, round_ * lift * (0.84 + 0.16 * ply));
      }
    }
  }
  return h;
}
/** The yarn's surface at p: stitches, the yarn behind the gaps, and its own fuzz. */
float yarnH(vec2 p, float fine) {
  float fuzz = vnoise(p * 7.0 * fine) * 0.6 + vnoise(p * 19.0 * fine) * 0.4;
  return max(stitches(p), 0.20) * 0.92 + fuzz * 0.08;
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
/**
 * Wool under a raking light. n is the surface normal (z towards the eye, y
 * down the screen), h its height, p where on the yarn we are.
 */
vec3 wool(vec3 dye, vec3 n, float h, vec2 p) {
  vec3 L = normalize(vec3(-0.50, -0.58, 0.64));
  float ndl = dot(n, L);
  // wool wraps light round itself: no hard terminator
  float diff = clamp(ndl * 0.72 + 0.28, 0.0, 1.0);
  // down between two stitches very little arrives
  float cav = mix(0.26, 1.0, smoothstep(0.16, 0.74, h));
  vec3 c = dye;
  // loose fibres lying across the stitches, paler than the yarn under them
  float fib = smoothstep(0.60, 0.95, vnoise(p * vec2(3.0, 17.0)) * vnoise(p * vec2(21.0, 4.0) + 7.0) * 2.5);
  c = mix(c, c * 1.30 + 0.04, fib * 0.40);
  vec3 lit = c * (0.30 + 0.92 * diff) * cav;
  // and the fibre catches light at a grazing angle: the pale edge every leg has
  lit += c * pow(1.0 - clamp(n.z, 0.0, 1.0), 1.7) * 0.42 * (0.4 + diff);
  return lit;
}`;

const QUAD_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const CLOTH_FS = `${COMMON}
uniform sampler2D uCells;
uniform sampler2D uPlant;   // the plant, a stitch a texel; clear where it is not
uniform vec2 uOrigin;   // where cell (0,0) starts, in device pixels from the top left
uniform vec2 uCell;     // a stitch, in device pixels
uniform vec2 uRes;
out vec4 outColour;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (px - uOrigin) / uCell;
  vec2 p = vec2(q.x, -q.y);                         // stitch space: y up the work
  // A stitch is one colour, and a stitch is its V: the legs lean out over the
  // cells either side, so a pixel belongs to whichever stitch's leg it is on.
  vec2 f = fract(p);
  float lean = (f.x - 0.5) * (0.5 + f.y);
  ivec2 size = textureSize(uCells, 0);
  ivec2 ci = clamp(ivec2(floor(q)), ivec2(0), size - 1);
  vec3 dye = toLinear(texelFetch(uCells, ci, 0).rgb);
  // wool is not as loud as ink, and no two stitches take the dye alike
  float l = dot(dye, vec3(0.2126, 0.7152, 0.0722));
  dye = mix(vec3(l), dye, 0.88) * 0.94 + 0.012;
  // the plant's stitches: its own yarn, and more of it
  vec4 pl = texelFetch(uPlant, ci, 0);
  float bulk = step(0.5, pl.a);
  if (bulk > 0.5) {
    dye = toLinear(pl.rgb);
    float pl2 = dot(dye, vec3(0.2126, 0.7152, 0.0722));
    dye = mix(vec3(pl2), dye, 1.06);
  }
  dye *= 0.93 + 0.14 * hash21(floor(p) + 3.0);

  float e = 0.07;
  float h0 = yarnH(p, 1.0);
  float gx = (yarnH(p + vec2(e, 0.0), 1.0) - h0) / e;
  float gy = (yarnH(p + vec2(0.0, e), 1.0) - h0) / e;
  // (stitch space has y up; the screen, and the light, have it down)
  // (the same stitch as the ground's: any wider and the legs close up into a flat block)
  float proud = 1.0;
  vec3 n = normalize(vec3(-gx * 0.85 * proud, gy * 0.85 * proud, 1.0));
  vec3 c = wool(dye, n, h0, p);
  // Heavier yarn stands above the ground it is worked into, so the stitches
  // beside it, away from the light, sit in its shade, and the ones towards the
  // light are pressed down against it. No more than that: it is in the cloth.
  if (bulk < 0.5) {
    float a = texelFetch(uPlant, clamp(ci + ivec2(-1, -1), ivec2(0), size - 1), 0).a;
    float b = texelFetch(uPlant, clamp(ci + ivec2(-1, 0), ivec2(0), size - 1), 0).a;
    float d2 = texelFetch(uPlant, clamp(ci + ivec2(0, -1), ivec2(0), size - 1), 0).a;
    float e2 = texelFetch(uPlant, clamp(ci + ivec2(1, 0), ivec2(0), size - 1), 0).a;
    float f2 = texelFetch(uPlant, clamp(ci + ivec2(0, 1), ivec2(0), size - 1), 0).a;
    c *= 1.0 - 0.30 * max(a, max(b, d2)) - 0.10 * max(e2, f2);
  } else c *= 1.08;
  // cloth never lies quite flat
  c *= 0.90 + 0.20 * vnoise(p * 0.045 + 11.0);
  vec2 uv = px / uRes - 0.5;
  c *= 1.0 - smoothstep(0.35, 0.95, length(uv * vec2(1.0, 1.15))) * 0.30;
  outColour = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
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

export class RendererYarn {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (yarn)';
    this.renderScale = 1;
    // the flat renderer, off-screen: it knows every place and how to frame it
    const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    this.flat = new RendererCrafted(off, { width: 800, height: 600, dpr: 1 });
    this.cloth = program(gl, QUAD_VS, CLOTH_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.tex = texture();
    this.plantTex = texture();
    this.plantCells = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
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
  }

  invalidate() { this.flat.invalidate(); }
  setLook() {}
  camYToPlaceAt(y, frac, zoom) { return this.flat.camYToPlaceAt(y, frac, zoom); }
  camYToCentre(y) { return this.flat.camYToCentre(y); }
  camXToCentre(x) { return this.flat.camXToCentre(x); }
  project(cam, x, y) { return this.flat.project(cam, x, y); }
  setWorld(kind, nightness) { this.flat.setWorld(kind, nightness); }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    const flat = this.flat;
    flat.ensureWorld();
    const v = flat.view(cam, time);
    const d = this.dpr;
    const gl = this.gl;
    const cw = Math.max(3, Math.round(STITCH[0] * d));
    const ch = Math.max(3, Math.round(STITCH[1] * d));
    // the knitting is fixed to the ground, so it does not swim under the plant
    const gx = Math.round(mod((v.W / 2 - v.ex * v.zoom) * d, cw));
    const gy = Math.round(mod((v.H / 2 + v.lookY * v.zoom) * d, ch));
    const grid = { cw, ch, gx, gy, cols: Math.ceil(this.pw / cw) + 2, rows: Math.ceil(this.ph / ch) + 2, x0: gx - cw, y0: gy - ch };
    flat.drawCells(v, time, plant, grid);

    this.drawPlantCells(plant, reveal, v, grid);

    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.plantTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.plantCells);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat.cells);
    gl.useProgram(this.cloth);
    gl.uniform1i(gl.getUniformLocation(this.cloth, 'uCells'), 0);
    gl.uniform1i(gl.getUniformLocation(this.cloth, 'uPlant'), 1);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uOrigin'), grid.x0, grid.y0);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uCell'), cw, ch);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uRes'), this.pw, this.ph);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const qa = gl.getAttribLocation(this.cloth, 'aPos');
    gl.enableVertexAttribArray(qa);
    gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(qa);
  }

  /**
   * The plant as stitches: drawn at one texel a stitch, so whatever it covers
   * is whole stitches of the cloth and nothing between. A stem is a few
   * stitches wide, a flower a handful of rounds of them.
   */
  drawPlantCells(plant, reveal, v, g) {
    // Drawn three times the size and then one sample taken per stitch: a
    // stitch is one yarn or another, never a blend of the two beside it.
    const S = 3;
    const out = this.plantCells;
    if (out.width !== g.cols || out.height !== g.rows) { out.width = g.cols; out.height = g.rows; }
    if (!this.plantHi) this.plantHi = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    const c = this.plantHi;
    if (c.width !== g.cols * S || c.height !== g.rows * S) { c.width = g.cols * S; c.height = g.rows * S; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const d = this.dpr;
    // device pixels to stitches
    const X = (x) => ((v.W / 2 + (x - v.ex) * v.zoom) * d - g.x0) / g.cw;
    const Y = (y) => ((v.H / 2 - (y - v.lookY) * v.zoom) * d - g.y0) / g.ch;
    const css = (rgb) => `rgb(${rgb.map((q) => Math.round(q * 255)).join(',')})`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const flowerHue = flowerHueFor(plant);
    const blob = (x, y, rx, ry, rot, colour) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(0.8, rx), Math.max(0.8, ry), rot, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const hsl = stemColour(section, makeRng(1013 + section.step * 7919));
      ctx.strokeStyle = css(yarnOf(hsl));
      for (const seg of section.segments) {
        const pts = growing ? seg.points.filter((p) => p.k <= kMax) : seg.points;
        if (pts.length < 2) continue;
        // never thinner than two stitches: one alone is a line of dots
        ctx.lineWidth = clamp((pts[0].w * v.zoom * d * 3.2) / g.cw, 2.2, 4.5) * (seg.depth > 0 ? 0.8 : 1);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const ax = Math.cos(node.angle);
        const ay = -Math.sin(node.angle);
        const px = X(node.x);
        const py = Y(node.y);
        if (node.kind === 'leaf') {
          const L = Math.max(3, (node.size * v.zoom * d * 2.2) / g.cw) * open;
          blob(px + ax * L * 0.5, py + ay * L * 0.5 * (g.cw / g.ch), L * 0.5, L * 0.26, Math.atan2(ay, ax), css(yarnOf({ h: 112, s: 48, l: 34 })));
          continue;
        }
        const R = Math.max(3.4, (node.size * v.zoom * d * 1.3) / g.cw) * open;
        const cx = px + ax * R * 0.95;
        const cy = py + ay * R * 0.95 * (g.cw / g.ch);
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        // two shades of the one yarn, petal by petal, so a flower a few stitches
        // across is still petals and not a patch
        const bc = bloomColour(hsl, node, flowerHue, pig);
        const by = yarnOf(bc);
        const pets = [css(by.map((q) => Math.min(1, q * 1.16 + 0.03))), css(by.map((q) => q * 0.78))];
        // a petal at a time, as it opens
        const shown = Math.ceil(petals * open);
        for (let i = 0; i < shown; i++) {
          const a = spin + (i / petals) * Math.PI * 2;
          blob(cx + Math.cos(a) * R * 0.58, cy + Math.sin(a) * R * 0.58 * (g.cw / g.ch), R * 0.46, R * 0.46 * (g.cw / g.ch), 0, pets[i % 2]);
        }
        blob(cx, cy, R * 0.30, R * 0.30 * (g.cw / g.ch), 0, css(yarnOf({ h: 44, s: 76, l: 52 })));
      }
    }
    const oc = out.getContext('2d');
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, out.width, out.height);
    oc.imageSmoothingEnabled = false;
    oc.drawImage(c, 0, 0, out.width, out.height);
  }
}
