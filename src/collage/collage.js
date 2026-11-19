// Collage: the scene cut out of paper and stuck down.
//
// The pieces are cut to the flat picture (the illustrated look's, drawn out of
// sight): every shape in it is one ink, so every run of one ink is one piece
// of paper, and there are as many pieces as there are things, not as many as
// there are shades of light. Its lines are not drawn at all: a collage has no
// outlines, only edges where one sheet stops and the next shows.
//
// The world is torn, the plant is cut. Torn edges wander, and the upper sheet
// shows the white core of the paper along its tear; which sheet is the upper is
// the one nearer, and in a picture of land that is the one lower down. The
// plant is cut out with scissors from stronger paper, clean-edged, and stuck
// on last, over everything, standing a little off the page so that it throws
// a shadow. And no two papers came from the same place: one is a magazine page
// in halftone, one a page of small type, one plain sugar paper.

import { Renderer2D } from '../flat/renderer2d.js';

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uWorld;
uniform sampler2D uPlant;
uniform vec2 uRes;      // device pixels
uniform float uPx;      // device pixels to a CSS pixel
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
float fbm(vec2 p) {
  return vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 + vnoise(p * 4.1 + 3.3) * 0.15
    + vnoise(p * 8.3 + 1.7) * 0.1;
}

vec2 uvAt(vec2 p) {
  vec2 uv = p * uPx / uRes;
  return vec2(clamp(uv.x, 0.001, 0.999), clamp(1.0 - uv.y, 0.001, 0.999));
}
/**
 * The world's ink at p (CSS px from top left). An edge in the sketch is
 * antialiased, and a pixel half of one ink and half of another is a third
 * piece one pixel wide: so a colour no neighbour shares gives way to one that
 * a neighbour does.
 */
vec3 worldAt(vec2 p) {
  vec3 c = texture(uWorld, uvAt(p)).rgb;
  vec3 a = texture(uWorld, uvAt(p + vec2(1.0, 0.0))).rgb;
  vec3 b = texture(uWorld, uvAt(p + vec2(0.0, 1.0))).rgb;
  vec3 d = texture(uWorld, uvAt(p - vec2(1.0, 0.0))).rgb;
  vec3 e = texture(uWorld, uvAt(p - vec2(0.0, 1.0))).rgb;
  float t = 0.02;
  if (distance(c, a) < t || distance(c, b) < t || distance(c, d) < t || distance(c, e) < t) return c;
  if (distance(a, d) < t) return a;
  if (distance(b, e) < t) return b;
  return distance(c, a) < distance(c, b) ? a : b;
}
vec4 plantAt(vec2 p) {
  vec4 c = texture(uPlant, uvAt(p));
  if (c.a < 0.5) return vec4(0.0);
  return vec4(c.rgb / max(c.a, 1e-3), 1.0);
}

/**
 * Which piece a colour is. Coarse on purpose: the sketch shades a field in
 * five greens a few percent apart, and five strips of near-identical paper
 * torn and laid edge to edge are a scribble, not a meadow.
 */
float keyOf(vec3 c) {
  vec3 q = floor(sqrt(c) * 11.0 + 0.5);
  return q.r + q.g * 12.0 + q.b * 144.0;
}

/** Torn: where a point is taken to lie, for deciding which piece it is on. */
vec2 torn(vec2 p) {
  vec2 big = vec2(fbm(p * 0.035 + 3.0), fbm(p * 0.035 + 17.0)) - 0.5;
  vec2 fine = vec2(vnoise(p * 0.6 + 5.0), vnoise(p * 0.6 + 29.0)) - 0.5;
  return p + big * 7.0 + fine * 1.6;
}
/** Cut: scissors wander too, but slowly. */
vec2 cut(vec2 p) {
  return p + (vec2(vnoise(p * 0.05 + 11.0), vnoise(p * 0.05 + 37.0)) - 0.5) * 2.2;
}

/** Paper of a colour: never quite the ink, a little chalky and a little warm. */
vec3 paper(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.92);
  return clamp(mix(c, vec3(0.95, 0.92, 0.86), 0.12), 0.0, 1.0);
}

/** What each paper was before it was cut up. */
vec3 printOn(vec3 base, vec2 p, float key, float bias) {
  float t = fract(hash21(vec2(key, 7.0)) + bias);
  float ang = hash21(vec2(key, 13.0)) * 3.1416;
  float s = sin(ang), c = cos(ang);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 ink = base * vec3(0.66, 0.64, 0.70);
  if (t < 0.3) {
    // a magazine page: the colour is a halftone, and you can see the dots
    float pitch = 2.8 + hash21(vec2(key, 3.0)) * 1.0;
    vec2 g = fract(q / pitch) - 0.5;
    float d = smoothstep(0.36, 0.26, length(g));
    return mix(base * 1.07, ink, d * 0.42);
  } else if (t < 0.48) {
    // a page of type, too small to read, which is what it is from here
    float lh = 4.6;
    float row = floor(q.y / lh);
    float f = fract(q.y / lh);
    float inRow = smoothstep(0.08, 0.3, f) * smoothstep(0.78, 0.56, f);
    float word = step(0.3, vnoise(vec2(q.x * 0.28, row * 3.7 + key)));
    float glyph = step(0.3, hash21(floor(vec2(q.x / 1.4, row)) + key));
    float margin = step(0.12, vnoise(vec2(row * 0.7, key)));
    return mix(base * 1.05, ink * 0.85, inRow * word * glyph * margin * 0.5);
  } else if (t < 0.8) {
    // sugar paper: no print, only the fibre and a little mottle
    float f = fbm(q * vec2(0.8, 0.1) + key) - 0.5;
    float m = fbm(q * 0.04 + key) - 0.5;
    return base * (1.0 + f * 0.10 + m * 0.10);
  } else {
    // a photograph, out of focus: blotches of its own darker and lighter
    float b = fbm(q * 0.03 + key) - 0.5;
    return base * (1.0 + b * 0.34);
  }
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uPx;

  // ---- the world: torn pieces ----
  vec2 tp = torn(p);
  vec3 wc = worldAt(tp);
  float wk = keyOf(wc);
  // Which sheet is on top along a tear: the nearer, which is the lower one on
  // screen. So a change of piece just above here means this is the upper sheet
  // and the tear is along its top: its white core shows. A change just below
  // means this is the under sheet, in the shadow of the one over it.
  float rim = 0.0, under = 0.0;
  float rw = 1.0 + 1.6 * vnoise(p * 0.18);
  for (int i = 0; i < 5; i++) {
    float a = 3.1416 + float(i) * 0.7854;          // from left, over the top, to right
    vec2 d = vec2(cos(a), sin(a));                  // (y down: sin < 0 is up)
    if (keyOf(worldAt(torn(p + d * rw))) != wk) rim = 1.0;
    for (int k = 1; k <= 3; k++) {
      vec2 e = vec2(-d.x, -d.y) * float(k) * 1.6;   // the mirror: below
      if (keyOf(worldAt(torn(p + e))) != wk) under = max(under, 1.0 - float(k - 1) / 3.0);
    }
  }
  // a scrap too small to tear (a flower, a tuft) keeps a clean edge
  // (the rim is along a piece's top, so what it needs is paper below it)
  float body = 1.0;
  for (int k = 1; k <= 3; k++) {
    if (keyOf(worldAt(tp + vec2(0.0, 3.5 * float(k)))) != wk) body = 0.0;
  }
  rim *= body;
  vec3 col = printOn(paper(wc), p, wk, 0.0);
  col *= 0.96 + hash21(vec2(wk, 41.0)) * 0.08;
  col *= 1.0 - under * 0.16;
  vec3 core = vec3(0.975, 0.96, 0.925) * (0.92 + 0.08 * vnoise(p * 1.9));
  float fray = smoothstep(0.3, 0.62, vnoise(p * vec2(0.9, 0.4) + 4.0));
  col = mix(col, core, rim * mix(0.55, 1.0, fray));

  // ---- the plant: cut out and stuck on top ----
  vec2 cp = cut(p);
  vec4 pc = plantAt(cp);
  // cut a little wide, as scissors round a small shape always are: a margin of
  // the white sheet it was cut from goes round it
  float margin = 0.0;
  if (pc.a < 0.5) {
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      if (plantAt(cp + vec2(cos(a), sin(a)) * 2.4).a > 0.5) margin = 1.0;
    }
  }
  // its shadow on the page: it stands a little proud, lit from the upper left
  float sh = 0.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472;
    vec2 o = vec2(-2.6, -3.2) + vec2(cos(a), sin(a)) * 1.8;
    vec2 q = cut(p + o);
    float m = plantAt(q).a;
    for (int j = 0; j < 4 && m < 0.5; j++) {
      float b = float(j) * 1.5708 + 0.4;
      m = max(m, plantAt(q + vec2(cos(b), sin(b)) * 2.4).a);
    }
    sh += m;
  }
  col *= 1.0 - (sh / 6.0) * 0.30 * (1.0 - max(pc.a, margin));
  col = mix(col, vec3(0.975, 0.965, 0.94) * (0.95 + 0.05 * vnoise(p * 1.3)), margin);
  if (pc.a > 0.5) {
    float pk = keyOf(pc.rgb);
    vec3 pcol = printOn(paper(pc.rgb), p, pk, 0.37);
    pcol *= 0.97 + hash21(vec2(pk, 59.0)) * 0.06;
    // where one cut piece lies on another, a hairline of shadow under the edge
    float edge = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5708 + 0.785;
      vec4 q = plantAt(cut(p + vec2(cos(a), sin(a)) * 1.4));
      if (q.a > 0.5 && keyOf(q.rgb) != pk) edge = 1.0;
    }
    pcol *= 1.0 - edge * 0.14;
    col = pcol;
  }

  // the sheet it is all stuck down on has a grain, and the glue cockles it
  col *= 0.975 + 0.04 * vnoise(p * 0.7) + 0.03 * (fbm(p * 0.008) - 0.5);
  outColour = vec4(clamp(col, 0.0, 1.0), 1.0);
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

const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/**
 * The flat picture, drawn as the pieces are to be cut: the world on one sheet,
 * the plant alone on a clear one, and no lines.
 */
class Sketch extends Renderer2D {
  constructor(canvas) {
    super(canvas);
    this.line = 'rgba(0,0,0,0)';
  }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    this.ensureWorld();
    this.ensurePlant(plant, reveal);
    const v = this.view(cam, time);
    const moving = this.moving.at(time * 0.001, plant, v);
    const ctx = this.ctx;
    // the world, everything in it, in its order: the plant is not in this sheet
    this.drawSky(ctx, v);
    const items = this.world.items;
    let m = 0;
    for (const it of items) {
      while (m < moving.length && moving[m].z < it.z) moving[m++].draw(ctx, v);
      if (!it.sky) it.draw(ctx, v);
    }
    while (m < moving.length) moving[m++].draw(ctx, v);
    // and the plant on its own
    if (!this.plantSheet || this.plantSheet.width !== this.pw || this.plantSheet.height !== this.ph) {
      this.plantSheet = canvasOf(this.pw, this.ph);
    }
    const pc = this.plantSheet.getContext('2d');
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, this.pw, this.ph);
    this.drawPlant(pc, v);
  }
}

export class RendererCollage {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (collage)';
    this.renderScale = 1;
    const hidden = document.createElement('canvas');
    hidden.className = 'stage';
    hidden.style.visibility = 'hidden';
    hidden.style.pointerEvents = 'none';
    hidden.setAttribute('aria-hidden', 'true');
    (canvas.parentNode || document.body).insertBefore(hidden, canvas);
    this.hidden = hidden;
    try { this.sketch = new Sketch(hidden); } catch (err) { hidden.remove(); throw err; }
    this.prog = program(gl, VS, FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // NEAREST: an ink is an exact colour, and a blend of two is a third piece
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.texWorld = tex();
    this.texPlant = tex();
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
    this.sketch.resize();
  }

  set fixedScale(v) { this.sketch.fixedScale = v; }
  get fixedScale() { return this.sketch.fixedScale; }
  invalidate() { this.sketch.invalidate(); }
  setLook() {}
  camYToPlaceAt(...a) { return this.sketch.camYToPlaceAt(...a); }
  camYToCentre(...a) { return this.sketch.camYToCentre?.(...a); }
  camXToCentre(...a) { return this.sketch.camXToCentre?.(...a); }
  project(...a) { return this.sketch.project(...a); }
  setWorld(...a) { this.sketch.setWorld(...a); }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    this.sketch.render(plant, cam, time, sections, reveal);
    const gl = this.gl;
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texWorld);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.hidden);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texPlant);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.plantSheet);
    gl.useProgram(this.prog);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uWorld'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uPlant'), 1);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRes'), this.pw, this.ph);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uPx'), this.dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(a);
  }
}
