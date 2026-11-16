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
const STITCH = [6.5, 4.75];

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
 * Stocking stitch. Knitting is not a grid of marks: it is loops pulled through
 * loops. What shows of each loop on the right side is a V, two legs of yarn
 * that rise out between the legs of the stitch below, lean apart, and go under
 * the foot of the stitch above. So the rows have no edge to them at all, and
 * what the eye follows is the columns, braided.
 *
 * m is in stitch widths both ways (a row is uRow of one high), y up the work.
 * Returns the height of the yarn there, 0..1; who is the stitch it belongs to
 * (column, row), and uv where on the leg it is (across -1..1, along).
 */
uniform float uRow;
float knit(vec2 m, out vec2 who, out vec2 uv) {
  vec2 cell = vec2(floor(m.x), floor(m.y / uRow));
  float best = 0.0, top = 0.0;
  who = cell; uv = vec2(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 id = cell + vec2(float(dx), float(dy));
      // no two stitches are pulled alike
      vec2 j = vec2(hash21(id + 1.7), hash21(id + 9.1)) - 0.5;
      vec2 base = vec2(id.x + 0.5 + j.x * 0.09, (id.y + j.y * 0.10) * uRow);
      float fat = 1.0 + (hash21(id + 4.3) - 0.5) * 0.14;
      for (int sd = -1; sd <= 1; sd += 2) {
        float side = float(sd);
        vec2 A = base + vec2(side * 0.115, -0.30 * uRow);
        vec2 B = base + vec2(side * 0.375, 1.12 * uRow);
        vec2 ab = B - A;
        float t = clamp(dot(m - A, ab) / dot(ab, ab), 0.0, 1.0);
        // a leg bows out a little on its way up
        vec2 c = A + ab * t + vec2(side * 0.03 * sin(t * 3.1416), 0.0);
        // loose fibre: the edge of a leg is never a clean line
        c += (vec2(vnoise(m * 14.0 + id), vnoise(m * 14.0 - id)) - 0.5) * 0.035;
        vec2 dv = m - c;
        float r = 0.225 * fat * (0.86 + 0.20 * sin(t * 3.1416));
        float d = length(dv);
        if (d > r) continue;
        float u = dot(dv, normalize(vec2(ab.y, -ab.x))) / r;
        float along = t * length(ab) / 0.205;
        float prof = sqrt(1.0 - (d / r) * (d / r));
        // two plies twisted together: the slanting ridges down each leg
        float ply = cos((along * 0.50 - side * u * 0.36) * 6.2832);
        // high where it comes out over the stitch below, low where it goes under the one above
        float z = prof * (1.0 - 0.50 * t) + 0.02 * float(dy + 1);
        if (z > best) { best = z; top = prof * (1.0 - 0.22 * t) * (0.84 + 0.16 * ply); who = id; uv = vec2(u, along); }
      }
    }
  }
  return top;
}
float yarnH(vec2 m, out vec2 who, out vec2 uv) {
  float fuzz = vnoise(m * 9.0) * 0.6 + vnoise(m * 23.0) * 0.4;
  return max(knit(m, who, uv), 0.16) * 0.90 + fuzz * 0.10;
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
/**
 * Wool under a raking light. n is the surface normal (z towards the eye, y
 * down the screen), h its height, p where on the yarn we are.
 */
vec3 wool(vec3 dye, vec3 n, float h, vec2 uv) {
  vec3 L = normalize(vec3(-0.50, -0.58, 0.64));
  float ndl = dot(n, L);
  // wool wraps light round itself: no hard terminator
  float diff = clamp(ndl * 0.66 + 0.34, 0.0, 1.0);
  // down between the legs very little arrives, and what does is the yarn's own colour
  float cav = mix(0.30, 1.0, smoothstep(0.10, 0.62, h));
  vec3 c = dye;
  // the fibres lie along the yarn: fine streaks down each leg, some paler
  float fib = vnoise(vec2(uv.x * 5.0, uv.y * 0.8) + 3.0) * vnoise(vec2(uv.x * 11.0, uv.y * 1.7) + 7.0);
  c *= 0.84 + 0.60 * fib;
  vec3 lit = c * (0.32 + 0.86 * diff) * cav;
  // and the halo of loose fibre catches light at a grazing angle
  lit += c * pow(1.0 - clamp(n.z, 0.0, 1.0), 1.6) * 0.34 * (0.4 + diff);
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
ivec2 texel(vec2 who, ivec2 size) {
  return clamp(ivec2(int(who.x), -int(who.y) - 1), ivec2(0), size - 1);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (px - uOrigin) / uCell;
  vec2 m = vec2(q.x, -q.y * uRow);                  // y up the work, in stitch widths
  // Knitted cloth never lies true: the columns wander and the rows sag a little.
  m += vec2(vnoise(m * 0.11 + 3.0) - 0.5, vnoise(m * 0.09 + 17.0) - 0.5) * 0.55;
  m += vec2(vnoise(m * 0.9 + 31.0) - 0.5, vnoise(m * 0.8 + 5.0) - 0.5) * 0.06;

  vec2 who, uv, w2, u2;
  float e = 0.045;
  float h0 = yarnH(m, who, uv);
  float gx = (yarnH(m + vec2(e, 0.0), w2, u2) - h0) / e;
  float gy = (yarnH(m + vec2(0.0, e), w2, u2) - h0) / e;

  // A stitch is one yarn, and the stitch is its V, not a square: so where two
  // colours meet, they meet along the legs.
  ivec2 size = textureSize(uCells, 0);
  ivec2 ci = texel(who, size);
  vec3 dye = toLinear(texelFetch(uCells, ci, 0).rgb);
  // wool is not as loud as ink
  float l = dot(dye, vec3(0.2126, 0.7152, 0.0722));
  dye = mix(vec3(l), dye, 0.88) * 0.94 + 0.012;
  vec4 pl = texelFetch(uPlant, ci, 0);
  float bulk = step(0.5, pl.a);
  if (bulk > 0.5) {
    dye = toLinear(pl.rgb);
    float pl2 = dot(dye, vec3(0.2126, 0.7152, 0.0722));
    dye = mix(vec3(pl2), dye, 1.06);
  }
  // the dye does not take evenly: it drifts along the yarn, which runs with the row
  dye *= 0.94 + 0.12 * vnoise(vec2(who.x * 0.35 + who.y * 13.7, who.y * 0.5));
  dye *= 0.97 + 0.06 * hash21(who + 3.0);

  // (m has y up; the screen, and the light, have it down)
  vec3 n = normalize(vec3(-gx * 0.50, gy * 0.50, 1.0));
  vec3 c = wool(dye, n, h0, uv);
  // The plant is the same cloth in another yarn. It sits a hair fuller than
  // the ground, enough to lay a little shade on the stitches down-light of it.
  if (bulk < 0.5) {
    float a = texelFetch(uPlant, clamp(ci + ivec2(-1, -1), ivec2(0), size - 1), 0).a;
    float b = texelFetch(uPlant, clamp(ci + ivec2(-1, 0), ivec2(0), size - 1), 0).a;
    float d2 = texelFetch(uPlant, clamp(ci + ivec2(0, -1), ivec2(0), size - 1), 0).a;
    c *= 1.0 - 0.16 * max(a, max(b, d2));
  }
  // cloth never lies quite flat
  c *= 0.88 + 0.24 * vnoise(m * 0.05 + 11.0);
  vec2 sc = px / uRes - 0.5;
  c *= 1.0 - smoothstep(0.35, 0.95, length(sc * vec2(1.0, 1.15))) * 0.30;
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
    gl.uniform1f(gl.getUniformLocation(this.cloth, 'uRow'), ch / cw);
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
        const lw = clamp((pts[0].w * v.zoom * d * 3.2) / g.cw, 3.2, 6.5) * (seg.depth > 0 ? 0.8 : 1);
        const run = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.stroke(); };
        // a stem in three yarns: a dark edge, its own colour, and a pale stitch up the lit side
        const sy = yarnOf(hsl);
        ctx.lineWidth = lw; ctx.strokeStyle = css(sy.map((q) => q * 0.62)); run();
        ctx.lineWidth = lw - 1.7; ctx.strokeStyle = css(sy); run();
        ctx.save(); ctx.translate(-lw * 0.16, -lw * 0.10);
        ctx.lineWidth = Math.max(1, lw * 0.22); ctx.strokeStyle = css(sy.map((q) => Math.min(1, q * 1.28 + 0.05))); run();
        ctx.restore();
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
          const lf = yarnOf({ h: 112, s: 48, l: 34 });
          const lx = px + ax * L * 0.5, ly = py + ay * L * 0.5 * (g.cw / g.ch), rot = Math.atan2(ay, ax);
          blob(lx, ly, L * 0.5, L * 0.27, rot, css(lf.map((q) => q * 0.60)));
          blob(lx, ly, L * 0.5 - 0.9, L * 0.27 - 0.9, rot, css(lf));
          // the lit half of the blade, and the rib down the middle
          ctx.save(); ctx.beginPath(); ctx.ellipse(lx, ly, Math.max(0.8, L * 0.5 - 0.9), Math.max(0.8, L * 0.27 - 0.9), rot, Math.PI, Math.PI * 2); ctx.fillStyle = css(lf.map((q) => Math.min(1, q * 1.22 + 0.03))); ctx.fill(); ctx.restore();
          ctx.strokeStyle = css(lf.map((q) => q * 0.60)); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ax * L * 0.86, py + ay * L * 0.86 * (g.cw / g.ch)); ctx.stroke();
          continue;
        }
        const R = Math.max(5, (node.size * v.zoom * d * 1.3) / g.cw) * open;
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
          const k = g.cw / g.ch;
          const ex = cx + Math.cos(a) * R * 0.58, ey = cy + Math.sin(a) * R * 0.58 * k;
          // each petal: a dark edge, its body, a pale tip, and a vein back to the heart
          blob(ex, ey, R * 0.48, R * 0.48 * k, 0, css(by.map((q) => q * 0.52)));
          blob(ex, ey, R * 0.48 - 0.9, (R * 0.48 - 0.9) * k, 0, pets[i % 2]);
          blob(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78 * k, R * 0.20, R * 0.20 * k, 0, css(by.map((q) => Math.min(1, q * 1.36 + 0.08))));
          ctx.strokeStyle = css(by.map((q) => q * 0.52)); ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62 * k); ctx.stroke();
        }
        const kk = g.cw / g.ch;
        const heart = yarnOf({ h: 44, s: 76, l: 52 });
        blob(cx, cy, R * 0.30, R * 0.30 * kk, 0, css(heart.map((q) => q * 0.62)));
        blob(cx, cy, R * 0.30 - 0.8, (R * 0.30 - 0.8) * kk, 0, css(heart));
        if (R > 6) blob(cx, cy, 0.8, 0.8, 0, css(heart.map((q) => q * 0.55)));
      }
    }
    const oc = out.getContext('2d');
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, out.width, out.height);
    oc.imageSmoothingEnabled = false;
    oc.drawImage(c, 0, 0, out.width, out.height);
  }
}
