// Plasticine: the whole picture modelled in relief on a board.
//
// A plasticine picture is not a scene with a clay texture on it. It is pieces
// of the stuff, each one a single colour, pressed down next to each other on a
// board: every piece rounds over at its edge, there is a crease where two
// meet, and the hand is left all over it. So this look is flat, like the
// knitting, and what is worked out is its relief:
//
//  - the world is the flat renderer's picture, and every patch of colour in it
//    becomes a piece: it pillows up in the middle and sinks to a seam at its
//    edge;
//  - the plant is laid on top afterwards the way it would be, stems rolled into
//    coils, petals and leaves as flattened balls, each standing proud of the
//    ground and shading it;
//  - the surface carries thumb dents, the loops of actual fingerprints here and
//    there, and the streaks of colour that never quite mixed in;
//  - and it is lit as a small thing under a lamp: soft, matte, a little waxy,
//    dark in the creases.
//
// It moves as a model does, a frame at a time.

import { RendererCrafted } from '../flat/crafted.js';
import { stemColour, flowerHueFor, bloomColour, PIGMENT } from '../gl/scene.js';
import { makeRng } from '../rng.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function rgbOf(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
/** A stick of plasticine in a colour: strong, plain, never very dark. */
const stickOf = (c) => rgbOf(c.h, clamp(c.s * 1.1, 45, 82), clamp(c.l * 1.05 + 8, 40, 62));
const css = (rgb) => `rgb(${rgb.map((q) => Math.round(clamp(q, 0, 1) * 255)).join(',')})`;
const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Where the pieces are: for the world, how far from an edge between colours;
// for the plant, how high each part was made, and the seams between its parts.
const RAW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uWorld;    // the flat picture
uniform sampler2D uPlant;    // the plant, in colour
uniform sampler2D uHigh;     // the plant, as heights
uniform vec2 uPx;            // one CSS pixel, in uv
uniform vec2 uCover;         // how much of the world picture the frame takes up
out vec4 o;
float edge(sampler2D t, vec2 uv, float r) {
  vec3 c = texture(t, uv).rgb;
  float e = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7854;
    vec3 d = texture(t, uv + vec2(cos(a), sin(a)) * uPx * r).rgb - c;
    e = max(e, dot(abs(d), vec3(0.45, 0.6, 0.35)));
  }
  return e;
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float w = 1.0 - smoothstep(0.035, 0.11, edge(uWorld, uv * uCover, 1.6));
  vec4 pl = texture(uPlant, uv);
  float seam = 1.0 - smoothstep(0.03, 0.10, edge(uPlant, uv, 1.3)) * step(0.5, pl.a);
  o = vec4(w, texture(uHigh, uv).r, pl.a, seam);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 o;
void main() {
  vec4 s = texture(uSrc, vUv) * 0.1964825501511404;
  s += (texture(uSrc, vUv + uStep * 1.411764705882353) + texture(uSrc, vUv - uStep * 1.411764705882353)) * 0.2969069646728344;
  s += (texture(uSrc, vUv + uStep * 3.2941176470588234) + texture(uSrc, vUv - uStep * 3.2941176470588234)) * 0.09447039785044732;
  s += (texture(uSrc, vUv + uStep * 5.176470588235294) + texture(uSrc, vUv - uStep * 5.176470588235294)) * 0.010381362401148057;
  o = s;
}`;

const CLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uWorld;
uniform sampler2D uPlant;
uniform sampler2D uNear;     // the relief, softened a little: the shape of each piece
uniform sampler2D uWide;     // and softened a lot: what stands round a point
uniform vec2 uSize;          // the frame, in CSS pixels
uniform vec2 uOrigin;        // where the world's origin falls in it
uniform float uZoom;
uniform float uTake;         // which exposure this is
uniform vec2 uCover;
vec2 fb(vec2 p) { return vec2(p.x / uSize.x, 1.0 - p.y / uSize.y); }
out vec4 outColour;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.17)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
/**
 * Fingerprints: not stripes everywhere, but a print here and a print there,
 * each an oval of ridges looping round its own middle, where a fingertip came
 * down. q is in the board's own units.
 */
float prints(vec2 q) {
  const float CELL = 64.0;
  vec2 g = floor(q / CELL);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(float(i), float(j));
    vec2 r = hash22(c * 1.31 + 5.0);
    if (r.x > 0.17) continue;                         // no finger came down here
    vec2 centre = (c + 0.2 + 0.6 * hash22(c + 9.0)) * CELL;
    float ang = r.y * 6.2832;
    vec2 d = q - centre;
    d = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y);
    d.y *= 0.72;                                      // a fingertip is longer than wide
    float rad = 21.0 + 13.0 * hash21(c + 3.0);
    float fall = (1.0 - smoothstep(rad * 0.45, rad, length(d))) * smoothstep(-0.2, 0.5, vnoise(d * 0.06 + c * 3.0) - 0.25 + r.x * 2.0);
    if (fall <= 0.0) continue;
    // the ridges loop round a point off-centre, and wander
    vec2 core = vec2(0.0, rad * 0.25);
    float ring = length((d - core) * vec2(1.0, 1.35)) + vnoise(d * 0.09 + c) * 7.0;
    float ridge = 0.5 + 0.5 * cos(ring * 6.2832 / 2.7);
    // where the finger pressed, the clay is down a little, and ridged
    h += fall * (ridge * 0.026 - 0.05);
  }
  return h;
}
/** Everything about the surface that is not the pieces themselves. */
float worked(vec2 q) {
  float dents = (vnoise(q * 0.024) - 0.5) * 0.16 + (vnoise(q * 0.07 + 40.0) - 0.5) * 0.06;
  float grain = (vnoise(q * 1.7) - 0.5) * 0.012;
  return dents + prints(q) + grain;
}
/** The height of the model at a point of the frame (CSS pixels). */
float heightAt(vec2 p) {
  vec4 n = texture(uNear, fb(p));
  // the ground: each piece pillows up, and sinks to the seam at its edge
  float ground = 0.26 * smoothstep(0.30, 0.98, n.r);
  // the plant, laid on it: round over the top, tucked in at the seams between its parts
  float body = smoothstep(0.02, 0.62, n.g) * (0.72 + 0.28 * smoothstep(0.55, 1.0, n.a));
  float on = smoothstep(0.22, 0.55, n.b);
  float h = mix(ground, 0.30 + 0.95 * body, on);
  return h + worked((p - uOrigin) / uZoom) * mix(1.0, 0.75, on);
}
vec3 stick(vec3 c) {
  // plasticine is strong plain colour with white in it: nothing is very dark
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.22);
  c = mix(c, vec3(1.0), 0.0);
  return clamp(c * 0.86 + 0.10, 0.0, 1.0);
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 uv = p / uSize;
  vec2 q = (p - uOrigin) / uZoom;

  float e = 0.75;
  float h0 = heightAt(p);
  float hx = heightAt(p + vec2(e, 0.0));
  float hy = heightAt(p + vec2(0.0, e));
  vec3 N = normalize(vec3(-(hx - h0) / e * 11.0, -(hy - h0) / e * 11.0, 1.0));

  vec4 pl = texture(uPlant, uv);
  vec3 base = mix(stick(texture(uWorld, uv * uCover).rgb), pl.rgb / max(pl.a, 0.001), smoothstep(0.35, 0.65, pl.a));
  // two colours kneaded together never quite become one
  float marble = vnoise(q * vec2(0.035, 0.11) + vnoise(q * 0.02) * 4.0);
  base *= 0.94 + 0.12 * marble;
  base = pow(base, vec3(2.2));

  vec4 wide = texture(uWide, fb(p));
  vec4 near = texture(uNear, fb(p));
  // a crease is dark: light does not get down between two pieces
  float pit = clamp(1.0 - 1.15 * smoothstep(0.98, 0.25, near.r) * (1.0 - smoothstep(0.3, 0.6, near.b)), 0.0, 1.0);
  float seams = mix(1.0, 0.55 + 0.45 * smoothstep(0.45, 1.0, near.a), smoothstep(0.35, 0.65, pl.a));
  // and the plant stands off the ground, so the ground beside it is in its shade
  vec2 toLight = vec2(-0.60, -0.80);
  float thrown = texture(uWide, fb(p + toLight * 9.0)).b;
  float shade = 1.0 - 0.50 * smoothstep(0.10, 0.75, thrown) * (1.0 - smoothstep(0.25, 0.6, near.b));
  float ao = mix(0.66, 1.0, pit) * seams * shade;
  // (and a little dark gathers right round the foot of anything proud)
  ao *= 1.0 - 0.22 * smoothstep(0.05, 0.5, wide.b) * (1.0 - smoothstep(0.2, 0.6, near.b));

  vec3 L = normalize(vec3(toLight * 0.78, 0.66));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndl = dot(N, L);
  float wrap = clamp((ndl + 0.38) / 1.38, 0.0, 1.0);
  vec3 lamp = vec3(1.0, 0.965, 0.90);
  vec3 fill = vec3(0.60, 0.68, 0.80);
  vec3 col = base * (lamp * wrap * 1.30 + fill * 0.36 * (0.6 + 0.4 * N.z)) * ao;
  // light goes a little way into it, so the turned-away side glows its own colour
  col += base * base * (1.0 - wrap) * 0.16 * ao;
  // it is waxy: one broad soft shine, brightest on the ridges of a print
  float ndh = max(dot(N, H), 0.0);
  col += lamp * (pow(ndh, 30.0) * 0.13 + pow(ndh, 6.0) * 0.035) * ao;

  col = col / (1.0 + col * 0.22);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 sc = uv - 0.5;
  col *= 1.0 - smoothstep(0.40, 0.98, length(sc * vec2(1.0, 1.15))) * 0.26;
  col += (hash21(p + uTake) - 0.5) * 0.012;
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
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  return p;
}

export class RendererClay {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (clay)';
    this.renderScale = 1;
    this.flat = new RendererCrafted(canvasOf(8, 8), { width: 800, height: 600, dpr: 1 });
    this.raw = program(gl, VS, RAW_FS);
    this.blur = program(gl, VS, BLUR_FS);
    this.clay = program(gl, VS, CLAY_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.texWorld = this.texture();
    this.texPlant = this.texture();
    this.texHigh = this.texture();
    this.targets = null;
    this.plantC = canvasOf(8, 8);
    this.plantH = canvasOf(8, 8);
    this.held = null;
    this.resize();
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
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
    if (!this.targets || this.targets.w !== cw || this.targets.h !== ch) {
      const gl = this.gl;
      if (this.targets) for (const t of this.targets.all) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
      const all = [0, 1, 2, 3].map(() => this.target(cw, ch));
      this.targets = { w: cw, h: ch, all, raw: all[0], tmp: all[1], near: all[2], wide: all[3] };
    }
  }

  invalidate() { this.flat.invalidate(); }
  setLook() {}
  camYToPlaceAt(y, frac, zoom) { return this.flat.camYToPlaceAt(y, frac, zoom); }
  camYToCentre(y) { return this.flat.camYToCentre(y); }
  camXToCentre(x) { return this.flat.camXToCentre(x); }
  project(cam, x, y) { return this.flat.project(cam, x, y); }
  setWorld(kind, nightness) { this.flat.setWorld(kind, nightness); }

  pass(prog, target, textures, uniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.pw, target ? target.h : this.ph);
    gl.useProgram(prog);
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit++);
    }
    for (const [name, v] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(prog, name);
      if (typeof v === 'number') gl.uniform1f(loc, v); else gl.uniform2f(loc, v[0], v[1]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    // a model is moved between exposures: growth and weather go a frame at a time
    const FRAME = 1000 / 12;
    const take = Math.floor(time / FRAME);
    if (reveal) {
      if (!this.held || this.held.step !== reveal.step || this.held.take !== take || reveal.progress >= 1) {
        this.held = { step: reveal.step, take, reveal: { ...reveal } };
      }
      reveal = this.held.reveal;
    } else this.held = null;

    const flat = this.flat;
    flat.ensureWorld();
    const v = flat.view(cam, take * FRAME);
    const d = this.dpr;
    // the flat picture, a CSS pixel a sample: plenty for something made of lumps
    const c3 = Math.max(1, Math.round(3 * d));
    const grid = { cw: c3, ch: c3, gx: 0, gy: 0, cols: Math.ceil(this.pw / c3), rows: Math.ceil(this.ph / c3), x0: 0, y0: 0 };
    flat.drawCells(v, take * FRAME, plant, grid);
    this.drawPlant(plant, reveal, v);

    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const up = (tex, src) => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
    gl.activeTexture(gl.TEXTURE0);
    up(this.texWorld, flat.low);
    up(this.texPlant, this.plantC);
    up(this.texHigh, this.plantH);

    const T = this.targets;
    const px = [1 / T.w, 1 / T.h];
    const cover = [this.w / flat.low.width, this.h / flat.low.height];
    this.pass(this.raw, T.raw, { uWorld: this.texWorld, uPlant: this.texPlant, uHigh: this.texHigh }, { uPx: px, uCover: cover });
    this.pass(this.blur, T.tmp, { uSrc: T.raw.tex }, { uStep: [px[0] * 0.8, 0] });
    this.pass(this.blur, T.near, { uSrc: T.tmp.tex }, { uStep: [0, px[1] * 0.8] });
    this.pass(this.blur, T.tmp, { uSrc: T.near.tex }, { uStep: [px[0] * 2.6, 0] });
    this.pass(this.blur, T.wide, { uSrc: T.tmp.tex }, { uStep: [0, px[1] * 2.6] });
    this.pass(this.clay, null, { uWorld: this.texWorld, uPlant: this.texPlant, uNear: T.near.tex, uWide: T.wide.tex }, {
      uSize: [this.w, this.h],
      uOrigin: [v.W / 2 - v.ex * v.zoom, v.H / 2 + v.lookY * v.zoom],
      uZoom: v.zoom,
      uTake: take % 97,
      uCover: cover,
    });
  }

  /**
   * The plant as it would be made: stems rolled into coils, leaves and petals
   * as flattened balls, a ball for the heart. Drawn twice, once in its colours
   * and once as how high each part stands.
   */
  drawPlant(plant, reveal, v) {
    const d = this.dpr;
    const C = this.plantC;
    const Hc = this.plantH;
    if (C.width !== this.pw || C.height !== this.ph) { C.width = this.pw; C.height = this.ph; }
    if (Hc.width !== this.w || Hc.height !== this.h) { Hc.width = this.w; Hc.height = this.h; }
    const cc = C.getContext('2d');
    const hc = Hc.getContext('2d');
    cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, C.width, C.height); cc.setTransform(d, 0, 0, d, 0, 0);
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.fillStyle = '#000'; hc.fillRect(0, 0, Hc.width, Hc.height);
    for (const ctx of [cc, hc]) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
    const X = (x) => v.W / 2 + (x - v.ex) * v.zoom;
    const Y = (y) => v.H / 2 - (y - v.lookY) * v.zoom;
    const grey = (h) => { const g = Math.round(clamp(h, 0, 1) * 255); return `rgb(${g},${g},${g})`; };
    const blob = (x, y, rx, ry, rot, colour, high) => {
      for (const [ctx, style] of [[cc, colour], [hc, grey(high)]]) {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), rot, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const flowerHue = flowerHueFor(plant);
    const z = v.zoom;
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const hsl = stemColour(section, makeRng(1013 + section.step * 7919));
      const sc = stickOf(hsl);
      for (const seg of section.segments) {
        const pts = growing ? seg.points.filter((p) => p.k <= kMax) : seg.points;
        if (pts.length < 2) continue;
        // a coil rolled under the palm: fat, and the same all the way along
        const lw = clamp(pts[0].w * z * 3.4, 9, 22) * (seg.depth > 0 ? 0.78 : 1);
        for (const [ctx, style] of [[cc, css(sc)], [hc, grey(seg.depth > 0 ? 0.62 : 0.78)]]) {
          ctx.strokeStyle = style;
          ctx.lineWidth = lw;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
          ctx.stroke();
        }
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
          const L = Math.max(16, node.size * z * 2.3) * open;
          blob(px + ax * L * 0.5, py + ay * L * 0.5, L * 0.5, L * 0.25, Math.atan2(ay, ax), css(stickOf({ h: 108, s: 55, l: 40 })), 0.55);
          continue;
        }
        const R = Math.max(22, node.size * z * 1.35) * open;
        const cx = px + ax * R * 0.95;
        const cy = py + ay * R * 0.95;
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        const by = stickOf(bloomColour(hsl, node, flowerHue, pig));
        // a flattened ball a petal, in two sticks of nearly the same colour
        const pets = [css(by.map((q) => q * 1.06 + 0.02)), css(by.map((q) => q * 0.86))];
        const shown = Math.ceil(petals * open);
        for (let i = 0; i < shown; i++) {
          const a = spin + (i / petals) * Math.PI * 2;
          blob(cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56, R * 0.50, R * 0.40, a, pets[i % 2], 0.70);
        }
        blob(cx, cy, R * 0.30, R * 0.30, 0, css(stickOf({ h: 46, s: 85, l: 54 })), 1.0);
      }
    }
  }
}
