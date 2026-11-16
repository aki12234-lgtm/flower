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
// The plant is a crocheted cord lying on the cloth: heavier than the knitting,
// round, shading the fabric under it, with flowers worked in rounds. It grows a
// stitch at a time, and the yarn it is being worked from hangs from each end.
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
  dye *= 0.93 + 0.14 * hash21(floor(p) + 3.0);

  float e = 0.07;
  float h0 = yarnH(p, 1.0);
  float gx = (yarnH(p + vec2(e, 0.0), 1.0) - h0) / e;
  float gy = (yarnH(p + vec2(0.0, e), 1.0) - h0) / e;
  // (stitch space has y up; the screen, and the light, have it down)
  vec3 n = normalize(vec3(-gx * 0.85, gy * 0.85, 1.0));
  vec3 c = wool(dye, n, h0, p);
  // cloth never lies quite flat
  c *= 0.90 + 0.20 * vnoise(p * 0.045 + 11.0);
  vec2 uv = px / uRes - 0.5;
  c *= 1.0 - smoothstep(0.35, 0.95, length(uv * vec2(1.0, 1.15))) * 0.30;
  outColour = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

const WORK_VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec2 aTan; in vec3 aCol; in float aKind; in float aSize;
uniform vec2 uRes; uniform vec2 uShift;
out vec2 vUv; out vec2 vTan; out vec3 vCol; out float vKind; out float vSize;
void main() {
  vUv = aUv; vTan = aTan; vCol = aCol; vKind = aKind; vSize = aSize;
  vec2 p = (aPos + uShift) / uRes;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

// kind 0: crocheted cord (uv: along in device pixels, across -1..1; size: its width)
// kind 1: a round, worked from the middle out (uv: -1..1 both ways; size: stitches round)
// kind 2: plain yarn, unworked (the tail hanging from the hook)
const WORK_FS = `${COMMON}
in vec2 vUv; in vec2 vTan; in vec3 vCol; in float vKind; in float vSize;
uniform float uShadow;
out vec4 outColour;
void main() {
  vec2 across = vec2(-vTan.y, vTan.x);
  float edge, dome;
  vec2 p;            // where on the yarn, in stitches
  vec2 gdir;         // which way the dome falls away, in (across, along)
  if (vKind > 0.5 && vKind < 1.5) {
    float r = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    edge = r;
    dome = sqrt(max(0.0, 1.0 - r * r * 0.82));
    p = vec2(ang / 6.2832 * vSize, r * 3.0);
    gdir = vUv * 0.75;
  } else {
    float v = vUv.y;
    edge = abs(v);
    dome = sqrt(max(0.0, 1.0 - v * v));
    // one stitch across the face of the cord: the chain you see from the front
    p = vKind > 1.5 ? vec2(v * 0.5 + 0.5, vUv.x / (vSize * 1.6)) : vec2(v * 0.60 + 0.5, vUv.x / (vSize * 0.56));
    gdir = vec2(v * 0.95, 0.0);
  }
  // the outline of a yarn is fibre, not a line
  bool isRound = vKind > 0.5 && vKind < 1.5;
  float fluff = vnoise(vUv * vec2(isRound ? 22.0 : 0.33, isRound ? 22.0 : 9.0) + vSize) - 0.5;
  float alpha = 1.0 - smoothstep(0.84, 1.0, edge + fluff * (isRound ? 0.13 : 0.20));
  if (uShadow > 0.5) {
    outColour = vec4(0.06, 0.04, 0.07, 0.40 * (1.0 - smoothstep(0.35, 1.0, edge)));
    return;
  }
  if (alpha < 0.01) discard;

  float e = 0.07;
  float h0, gx, gy;
  if (vKind > 1.5) {
    // plies only, wound round
    h0 = 0.6 + 0.4 * sin((p.y * 3.0 + p.x * 1.6) * 6.2832);
    gx = 0.0; gy = cos((p.y * 3.0 + p.x * 1.6) * 6.2832) * 1.2;
  } else {
    h0 = yarnH(p, 1.0);
    gx = (yarnH(p + vec2(e, 0.0), 1.0) - h0) / e;
    gy = (yarnH(p + vec2(0.0, e), 1.0) - h0) / e;
  }
  vec2 lean;
  if (vKind > 0.5 && vKind < 1.5) {
    float r = max(length(vUv), 1e-3);
    vec2 er = vUv / r;
    vec2 et = vec2(-er.y, er.x);
    lean = gdir - (et * gx + er * gy) * 0.62;
  } else {
    lean = gdir - vec2(gx, gy) * 0.62;
  }
  // from the work's own directions to the screen's
  vec2 ns = across * lean.x + vTan * lean.y;
  vec3 n = normalize(vec3(ns, dome * 0.85 + 0.30));
  vec3 dye = toLinear(vCol) * (0.94 + 0.12 * hash21(floor(p) + 5.0));
  vec3 c = wool(dye, n, h0, p);
  // round things are darker at the edge that turns away
  c *= 0.62 + 0.38 * dome;
  outColour = vec4(pow(c, vec3(1.0 / 2.2)), alpha);
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

const STRIDE = 11;   // pos 2, uv 2, tangent 2, colour 3, kind 1, size 1

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
    this.work = program(gl, WORK_VS, WORK_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.mesh = gl.createBuffer();
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
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

    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat.cells);
    gl.useProgram(this.cloth);
    gl.uniform1i(gl.getUniformLocation(this.cloth, 'uCells'), 0);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uOrigin'), grid.x0, grid.y0);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uCell'), cw, ch);
    gl.uniform2f(gl.getUniformLocation(this.cloth, 'uRes'), this.pw, this.ph);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const qa = gl.getAttribLocation(this.cloth, 'aPos');
    gl.enableVertexAttribArray(qa);
    gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(qa);

    const data = this.buildWork(plant, reveal, v, time);
    if (!data.length) return;
    gl.useProgram(this.work);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    let off = 0;
    const locs = [];
    for (const [name, n] of [['aPos', 2], ['aUv', 2], ['aTan', 2], ['aCol', 3], ['aKind', 1], ['aSize', 1]]) {
      const loc = gl.getAttribLocation(this.work, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, STRIDE * 4, off * 4);
        locs.push(loc);
      }
      off += n;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(gl.getUniformLocation(this.work, 'uRes'), this.pw, this.ph);
    const count = data.length / STRIDE;
    // the shade it throws on the cloth, then the work itself
    gl.uniform1f(gl.getUniformLocation(this.work, 'uShadow'), 1);
    gl.uniform2f(gl.getUniformLocation(this.work, 'uShift'), 5 * d, 8 * d);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.uniform1f(gl.getUniformLocation(this.work, 'uShadow'), 0);
    gl.uniform2f(gl.getUniformLocation(this.work, 'uShift'), 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.disable(gl.BLEND);
    for (const loc of locs) gl.disableVertexAttribArray(loc);
  }

  /** Every triangle of the plant, in device pixels, in the order to lay them down. */
  buildWork(plant, reveal, v, time) {
    const d = this.dpr;
    const out = [];
    const P = (p) => ({
      x: (v.W / 2 + (p.x - v.ex) * v.zoom) * d,
      y: (v.H / 2 - (p.y - v.lookY) * v.zoom) * d,
      w: (p.w || 1) * v.zoom * d,
    });
    const vert = (x, y, u, w, tx, ty, c, kind, size) => out.push(x, y, u, w, tx, ty, c[0], c[1], c[2], kind, size);
    const WIDE = 1.12;       // room past the edge for the fibre to stand out into

    /** A cord along screen points, `T` wide. Returns where it ended, and heading where. */
    const cord = (raw, T, col, kind, upTo = Infinity) => {
      // a cord cannot turn a square corner: it goes round it
      let pts = raw;
      for (let pass = 0; pass < 2 && pts.length > 2; pass++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        next.push(pts[pts.length - 1]);
        pts = next;
      }
      let arc = 0;
      let prev = null;
      let end = null;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        if (i) arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        let here = { x: pts[i].x, y: pts[i].y, arc, tx, ty };
        if (arc > upTo && prev) {
          // stop exactly on the last whole stitch
          const t = (upTo - prev.arc) / Math.max(1e-6, arc - prev.arc);
          here = { x: prev.x + (pts[i].x - prev.x) * t, y: prev.y + (pts[i].y - prev.y) * t, arc: upTo, tx, ty };
        }
        if (prev) {
          const quad = [[prev, -1], [prev, 1], [here, 1], [prev, -1], [here, 1], [here, -1]];
          for (const [q, side] of quad) {
            vert(q.x - q.ty * side * T * 0.5 * WIDE, q.y + q.tx * side * T * 0.5 * WIDE, q.arc, side * WIDE, q.tx, q.ty, col, kind, T);
          }
        }
        prev = here;
        end = here;
        if (arc >= upTo) break;
      }
      return end;
    };
    /** A round: an ellipse at (cx, cy), its long axis along (ax, ay). */
    const round = (cx, cy, rx, ry, ax, ay, col, around) => {
      const corner = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [u, w] of corner) {
        vert(cx + ax * u * rx * WIDE - ay * w * ry * WIDE, cy + ay * u * rx * WIDE + ax * w * ry * WIDE,
          u * WIDE, w * WIDE, ax, ay, col, 1, around);
      }
    };

    const flowerHue = flowerHueFor(plant);
    const ends = [];
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const hsl = stemColour(section, makeRng(1013 + section.step * 7919));
      const col = yarnOf(hsl);
      for (const seg of section.segments) {
        const all = seg.points.map(P);
        if (all.length < 2) continue;
        const T = clamp(all[0].w * 3.6, 12 * d, 28 * d) * (seg.depth > 0 ? 0.84 : 1);
        let upTo = Infinity;
        if (growing) {
          // as far as it has got, in whole stitches: a chain gains a link, it does not slide
          let len = 0;
          for (let i = 1; i < seg.points.length && seg.points[i].k <= kMax; i++) {
            len += Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y);
          }
          const pitch = T * 0.56;
          upTo = Math.floor(len / pitch) * pitch;
          if (upTo <= 0) continue;
        }
        const end = cord(all, T, col, 0, upTo);
        // the ends are finished off: a small tight round
        round(all[0].x, all[0].y, T * 0.5, T * 0.5, 1, 0, col, 7);
        if (end) {
          round(end.x, end.y, T * 0.5, T * 0.5, end.tx, end.ty, col, 7);
          if (growing) ends.push({ ...end, T, col });
        }
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const p = P(node);
        const ax = Math.cos(node.angle);
        const ay = -Math.sin(node.angle);
        if (node.kind === 'leaf') {
          const L = Math.max(24 * d, node.size * v.zoom * d * 2.2) * open;
          round(p.x + ax * L * 0.5, p.y + ay * L * 0.5, L * 0.5, L * 0.24, ax, ay, yarnOf({ h: 112, s: 48, l: 34 }), 14);
          continue;
        }
        const pet = yarnOf(bloomColour(hsl, node, flowerHue, pig));
        const R = Math.max(19 * d, node.size * v.zoom * d * 1.3) * open;
        const cx = p.x + ax * R * 0.95;
        const cy = p.y + ay * R * 0.95;
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        // petals a round each, opening one after another
        const shown = Math.ceil(petals * open);
        for (let i = 0; i < shown; i++) {
          const a = spin + (i / petals) * Math.PI * 2;
          round(cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56, R * 0.50, R * 0.40, Math.cos(a), Math.sin(a), pet, 15);
        }
        round(cx, cy, R * 0.30, R * 0.30, 1, 0, yarnOf({ h: 44, s: 76, l: 50 }), 9);
      }
    }

    // the yarn the work is still attached to, hanging from every end being worked
    const live = ends.length ? ends : (plant.tips || []).filter((t) => t.alive !== false).map((t) => {
      const last = [...plant.sections].reverse().find((s) => s.segments.some((g) => g.tipId === t.id)) || plant.sections[0];
      const p = P({ x: t.x, y: t.y, w: t.width || 3 });
      return { x: p.x, y: p.y, T: clamp(p.w * 3.6, 12 * d, 28 * d), col: yarnOf(stemColour(last, makeRng(1013 + last.step * 7919))) };
    });
    for (const e of live) {
      const sway = Math.sin(time * 0.0016 + e.x * 0.01) * 6 * d;
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const u = 1 - t;
        // a slack loop: out from the stitch, and down under its own weight
        const bx = [e.x, e.x + 20 * d + sway, e.x + 26 * d - sway, e.x + 10 * d + sway * 1.6];
        const by = [e.y, e.y - 12 * d, e.y + 26 * d, e.y + 54 * d];
        pts.push({
          x: u * u * u * bx[0] + 3 * u * u * t * bx[1] + 3 * u * t * t * bx[2] + t * t * t * bx[3],
          y: u * u * u * by[0] + 3 * u * u * t * by[1] + 3 * u * t * t * by[2] + t * t * t * by[3],
        });
      }
      cord(pts, e.T * 0.30, e.col, 2);
    }
    return out;
  }
}
